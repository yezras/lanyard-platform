#!/usr/bin/env python3
"""Materialize BackendRuntimeSecretsEnvelope onto host secret files.

Fetches an AWS Secrets Manager SecretString (or reads --from-file JSON),
validates against contracts/backend-runtime-v1/secrets-envelope.schema.json,
and writes managed files under BACKEND_HOME (or HERMES_HOME):

  $BACKEND_HOME/.env.secrets          # KEY=value from envelope env (mode 0600)
  $BACKEND_HOME/config.secrets.yaml   # config_secret_overlay + projected
                                      # custom_providers (mode 0600)
  $BACKEND_HOME/auth.json             # Hermes OAuth store from oauth and/or
                                      # files[] (mode 0600)
  $BACKEND_HOME/oauth.enc             # Agent OAuth store from files[] (mode 0600)

Idempotent: same envelope → byte-identical managed files (stable key sort).
Never logs secret values (key names, counts, paths, byte lengths only).

Usage (from repo root or host install):
  python3 deploy/scripts/materialize-backend-secrets.py \\
    --from-file contracts/backend-runtime-v1/examples/secrets-envelope.minimal.json

  BACKEND_HOME=/var/lib/company-brain-backend \\
    python3 deploy/scripts/materialize-backend-secrets.py \\
      --secret-arn \"$BACKEND_RUNTIME_SECRETS_ARN\"

Exit 0 on success; non-zero on schema/AWS/file failure (fail closed).
"""

from __future__ import annotations

import argparse
import base64
import copy
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

ENV_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
OAUTH_PROVIDER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
PATH_RELATIVE_RE = re.compile(
    r"^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._][A-Za-z0-9._\/-]*$"
)
MODE_RE = re.compile(r"^0?[0-7]{3,4}$")
KINDS = frozenset({"hermes_upstream", "hermes_lanyard", "lanyard_agent"})
HERMES_KINDS = frozenset({"hermes_upstream", "hermes_lanyard"})
# v1 multi-provider allowlist for envelope files[]
FILES_ALLOWLIST = frozenset({"auth.json", "oauth.enc"})
# Owner-only modes permitted for allowlisted secret files (contract: 0600).
# Caller-supplied group/other bits are clamped to 0600 (never land world-readable).
ALLOWED_SECRET_FILE_MODES = frozenset({0o600, 0o400})

# Characters that force double-quoting in EnvironmentFile-style lines.
_ENV_UNSAFE = re.compile(r'[\s#"\'\\$`]')

# Placeholder sentinels (git templates / unused slots). Never fail solely
# because these appear; do not log their values.
# Note (deferred): bead safety allows failing closed when a *required active*
# provider slot is still a placeholder; no required-marking is enforced yet —
# placeholders always write (Hermes) or count-only. Track as follow-up if product
# needs active-slot placeholder rejection.
_PLACEHOLDER_RE = re.compile(
    r"(placeholder|replace[_-]?me|example|dummy|xxxx|your[_-]?key)",
    re.IGNORECASE,
)
# Prefixes for content_base64 fail-open (whole-value / prefix only — never
# substring-match real base64 ciphertext that happens to contain "example").
_PLACEHOLDER_B64_PREFIXES = (
    "replace_me",
    "placeholder",
    "your_key",
    "your-key",
    "dummy",
    "xxxx",
    "example",
)


def _repo_root_from_script() -> Path:
    # deploy/scripts/this.py → repo root
    return Path(__file__).resolve().parent.parent.parent


def default_schema_path() -> Path:
    return (
        _repo_root_from_script()
        / "contracts"
        / "backend-runtime-v1"
        / "secrets-envelope.schema.json"
    )


def log(msg: str) -> None:
    """Info to stderr; never include secret values."""
    print(msg, file=sys.stderr)


def fail(msg: str, code: int = 1) -> None:
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(code)


def load_json(path: Path) -> Any:
    try:
        with path.open(encoding="utf-8") as f:
            return json.load(f)
    except OSError as e:
        fail(f"cannot read {path}: {e}")
    except json.JSONDecodeError as e:
        fail(f"invalid JSON in {path}: {e}")


def is_placeholder_sentinel(value: str) -> bool:
    """True when value looks like a git/template placeholder (not a live secret)."""
    if not value:
        return True
    return bool(_PLACEHOLDER_RE.search(value))


def is_placeholder_base64_sentinel(value: str) -> bool:
    """True for whole-value / prefix template placeholders in content_base64.

    Used only on the decode-failure path so invalid non-placeholder base64
    fails closed, while git fixtures like REPLACE_ME_base64_oauth_enc_blob
    still materialize offline. Does not substring-search ciphertext.
    """
    if not value or not value.strip():
        return True
    lower = value.strip().lower()
    for prefix in _PLACEHOLDER_B64_PREFIXES:
        if lower == prefix or lower.startswith(prefix + "_") or lower.startswith(
            prefix + "-"
        ):
            return True
    return False


def _validate_oauth(oauth: Any, errors: list[str]) -> None:
    if not isinstance(oauth, dict):
        errors.append(f"oauth must be object, got {type(oauth).__name__}")
        return
    for provider, material in oauth.items():
        ppath = f"oauth.{provider}"
        if not isinstance(provider, str) or not OAUTH_PROVIDER_RE.match(provider):
            errors.append(f"oauth: provider id {provider!r} is invalid")
        if not isinstance(material, dict):
            errors.append(
                f"{ppath}: must be object, got {type(material).__name__}"
            )
            continue
        if "access_token" not in material:
            errors.append(f"{ppath}: missing required property 'access_token'")
        else:
            at = material["access_token"]
            if not isinstance(at, str) or not at:
                # type/emptiness only — never the token value
                errors.append(
                    f"{ppath}.access_token must be a non-empty string, "
                    f"got {type(at).__name__}"
                )
        for key in ("refresh_token", "expires_at", "token_type"):
            if key in material and not isinstance(material[key], str):
                errors.append(
                    f"{ppath}.{key} must be a string, got "
                    f"{type(material[key]).__name__}"
                )
        if "metadata" in material:
            md = material["metadata"]
            if not isinstance(md, dict):
                errors.append(
                    f"{ppath}.metadata must be object, got {type(md).__name__}"
                )
        allowed = {
            "access_token",
            "refresh_token",
            "expires_at",
            "token_type",
            "metadata",
        }
        for k in material:
            if k not in allowed:
                errors.append(f"{ppath}: additional property not allowed: {k!r}")


def _validate_custom_providers(cps: Any, errors: list[str]) -> None:
    if not isinstance(cps, list):
        errors.append(
            f"custom_providers must be array, got {type(cps).__name__}"
        )
        return
    allowed = {
        "id",
        "base_url",
        "api_key_env",
        "key_env",
        "api_key",
        "default_model",
        "models",
        "api_mode",
    }
    for i, entry in enumerate(cps):
        epath = f"custom_providers[{i}]"
        if not isinstance(entry, dict):
            errors.append(f"{epath}: must be object, got {type(entry).__name__}")
            continue
        if "id" not in entry:
            errors.append(f"{epath}: missing required property 'id'")
        elif not isinstance(entry["id"], str) or not entry["id"]:
            errors.append(f"{epath}.id must be a non-empty string")
        if "base_url" not in entry:
            errors.append(f"{epath}: missing required property 'base_url'")
        elif not isinstance(entry["base_url"], str) or not entry["base_url"]:
            errors.append(f"{epath}.base_url must be a non-empty string")
        for env_alias in ("api_key_env", "key_env"):
            if env_alias in entry:
                v = entry[env_alias]
                if not isinstance(v, str) or not ENV_NAME_RE.match(v):
                    errors.append(
                        f"{epath}.{env_alias} must be a valid env name"
                    )
        for str_key in ("api_key", "default_model", "api_mode"):
            if str_key in entry and not isinstance(entry[str_key], str):
                errors.append(
                    f"{epath}.{str_key} must be a string, got "
                    f"{type(entry[str_key]).__name__}"
                )
        if "models" in entry:
            models = entry["models"]
            if not isinstance(models, list):
                errors.append(
                    f"{epath}.models must be array, got {type(models).__name__}"
                )
            else:
                for j, m in enumerate(models):
                    if not isinstance(m, str) or not m:
                        errors.append(
                            f"{epath}.models[{j}] must be a non-empty string"
                        )
        for k in entry:
            if k not in allowed:
                errors.append(f"{epath}: additional property not allowed: {k!r}")


def _validate_files(files: Any, errors: list[str]) -> None:
    if not isinstance(files, list):
        errors.append(f"files must be array, got {type(files).__name__}")
        return
    allowed = {
        "path_relative",
        "encoding",
        "content",
        "content_base64",
        "mode",
    }
    for i, entry in enumerate(files):
        epath = f"files[{i}]"
        if not isinstance(entry, dict):
            errors.append(f"{epath}: must be object, got {type(entry).__name__}")
            continue
        if "path_relative" not in entry:
            errors.append(f"{epath}: missing required property 'path_relative'")
        else:
            pr = entry["path_relative"]
            if not isinstance(pr, str) or not PATH_RELATIVE_RE.match(pr):
                errors.append(
                    f"{epath}.path_relative must be a safe relative path "
                    f"(no absolute, no '..')"
                )
            elif pr not in FILES_ALLOWLIST:
                errors.append(
                    f"{epath}.path_relative {pr!r} not in v1 allowlist "
                    f"{sorted(FILES_ALLOWLIST)}"
                )
        has_content = "content" in entry
        has_b64 = "content_base64" in entry
        if not has_content and not has_b64:
            errors.append(
                f"{epath}: must include content or content_base64"
            )
        if has_content and not isinstance(entry["content"], str):
            errors.append(
                f"{epath}.content must be a string, got "
                f"{type(entry['content']).__name__}"
            )
        if has_b64 and not isinstance(entry["content_base64"], str):
            errors.append(
                f"{epath}.content_base64 must be a string, got "
                f"{type(entry['content_base64']).__name__}"
            )
        if "encoding" in entry:
            enc = entry["encoding"]
            if enc not in ("utf-8", "base64"):
                if isinstance(enc, str):
                    errors.append(
                        f"{epath}.encoding must be 'utf-8' or 'base64', "
                        f"got {enc!r}"
                    )
                else:
                    errors.append(
                        f"{epath}.encoding must be 'utf-8' or 'base64', "
                        f"got {type(enc).__name__}"
                    )
        if "mode" in entry:
            mode = entry["mode"]
            if not isinstance(mode, str) or not MODE_RE.match(mode):
                errors.append(f"{epath}.mode must be an octal mode string")
        for k in entry:
            if k not in allowed:
                errors.append(f"{epath}: additional property not allowed: {k!r}")


def stdlib_validate(instance: Any) -> list[str]:
    """Subset validator matching secrets-envelope.schema.json required rules.

    Never includes env / overlay / oauth / files instance values in error
    strings (types and key names only). schema_version / kind_hint may appear
    (not secrets).
    """
    errors: list[str] = []

    def err(msg: str) -> None:
        errors.append(msg)

    if not isinstance(instance, dict):
        err(f"must be object, got {type(instance).__name__}")
        return errors

    if "schema_version" not in instance:
        err("missing required property 'schema_version'")
    else:
        sv = instance["schema_version"]
        if sv != 1 or isinstance(sv, bool):
            # schema_version is not secret material
            err(f"schema_version must be integer const 1, got {sv!r}")

    if "env" not in instance:
        err("missing required property 'env'")
    else:
        env = instance["env"]
        if not isinstance(env, dict):
            # Do not echo env when it is a non-object (could be a string secret)
            err(f"env must be object, got {type(env).__name__}")
        else:
            for k, v in env.items():
                if not isinstance(k, str) or not ENV_NAME_RE.match(k):
                    err(f"env key {k!r} must be a valid env name")
                if not isinstance(v, str):
                    # type only — never str(v) / repr(v)
                    err(f"env.{k} must be a string, got {type(v).__name__}")

    if "kind_hint" in instance:
        kh = instance["kind_hint"]
        if not isinstance(kh, str) or kh not in KINDS:
            # kind_hint enum members are not secrets; still avoid raw dump if
            # the value is an unexpected type (could be mis-shaped secret).
            if isinstance(kh, str):
                err(f"kind_hint must be one of {sorted(KINDS)}, got {kh!r}")
            else:
                err(
                    f"kind_hint must be one of {sorted(KINDS)}, "
                    f"got {type(kh).__name__}"
                )

    if "config_secret_overlay" in instance:
        cso = instance["config_secret_overlay"]
        if not isinstance(cso, dict):
            err(
                "config_secret_overlay must be object, got "
                f"{type(cso).__name__}"
            )

    if "meta" in instance:
        meta = instance["meta"]
        if not isinstance(meta, dict):
            err(f"meta must be object, got {type(meta).__name__}")

    if "oauth" in instance:
        _validate_oauth(instance["oauth"], errors)

    if "custom_providers" in instance:
        _validate_custom_providers(instance["custom_providers"], errors)

    if "files" in instance:
        _validate_files(instance["files"], errors)

    allowed = {
        "schema_version",
        "kind_hint",
        "env",
        "oauth",
        "custom_providers",
        "config_secret_overlay",
        "files",
        "meta",
    }
    for k in instance:
        if k not in allowed:
            err(f"additional property not allowed: {k!r}")

    return errors


def _path_is_secret_bearing(path_parts: list[Any]) -> bool:
    """True when jsonschema instance at path may contain secret material."""
    if not path_parts:
        return False
    root = path_parts[0]
    if root == "env":
        # env container type-fail or env.<KEY> value
        return True
    if root == "config_secret_overlay":
        return True
    if root == "oauth":
        # oauth.<provider>.access_token etc.
        return True
    if root == "custom_providers":
        # may include inline api_key
        return True
    if root == "files":
        # content / content_base64
        return True
    return False


def _safe_jsonschema_error(e: Any) -> str:
    """Format a jsonschema ValidationError without echoing instance values.

    jsonschema's e.message embeds the instance (e.g. \"123 is not of type
    'string'\"). Secret-bearing paths under env, config_secret_overlay, oauth,
    custom_providers, and files must never appear in logs — report path,
    validator, and type only.
    """
    path_parts = list(e.absolute_path)
    path = "/".join(str(p) for p in path_parts) or "$"
    validator = e.validator or "unknown"
    got_type = type(e.instance).__name__
    expected = e.validator_value

    under_secret = _path_is_secret_bearing(path_parts)
    # env container itself: if type fails, instance may be a string secret.
    env_type_fail = (
        len(path_parts) == 1
        and path_parts[0] == "env"
        and validator == "type"
    )

    if under_secret or env_type_fail:
        if validator == "type":
            return (
                f"{path}: invalid value (details suppressed); "
                f"expected type {expected!r}, got {got_type}"
            )
        if validator == "minLength":
            return (
                f"{path}: invalid value (details suppressed); "
                f"validator=minLength, got type {got_type}"
            )
        if validator == "required":
            if isinstance(e.instance, dict) and isinstance(expected, list):
                missing = [p for p in expected if p not in e.instance]
                if missing:
                    return f"{path}: missing required property {missing[0]!r}"
            return f"{path}: missing required property"
        if validator == "additionalProperties":
            return f"{path}: additional properties not allowed"
        if validator == "pattern":
            # propertyNames under env is key name (safe); under files path is
            # structural. For values that might be content, suppress.
            if (
                len(path_parts) == 1
                and path_parts[0] == "env"
                and isinstance(e.instance, str)
            ):
                return (
                    f"{path}: property name {e.instance!r} is not a valid "
                    "env name"
                )
            return (
                f"{path}: does not match required pattern "
                f"(value suppressed); got type {got_type}"
            )
        return (
            f"{path}: invalid value (details suppressed); "
            f"validator={validator}, got type {got_type}"
        )

    # env propertyNames (pattern): instance is the *key* name, not a secret.
    if (
        len(path_parts) == 1
        and path_parts[0] == "env"
        and validator == "pattern"
        and isinstance(e.instance, str)
    ):
        return (
            f"{path}: property name {e.instance!r} is not a valid env name"
        )

    # Non-secret structural fields: path + validator + types / safe expected.
    if validator == "type":
        return f"{path}: expected type {expected!r}, got {got_type}"
    if validator == "const":
        # schema_version const — value is not secret
        return f"{path}: must be {expected!r}, got {e.instance!r}"
    if validator == "enum":
        if isinstance(e.instance, str):
            return f"{path}: must be one of {expected!r}, got {e.instance!r}"
        return f"{path}: must be one of {expected!r}, got type {got_type}"
    if validator == "required":
        # validator_value is the full required list; compute missing names.
        if isinstance(e.instance, dict) and isinstance(expected, list):
            missing = [p for p in expected if p not in e.instance]
            if missing:
                return f"{path}: missing required property {missing[0]!r}"
        return f"{path}: missing required property"
    if validator == "additionalProperties":
        return f"{path}: additional properties not allowed"
    if validator == "pattern":
        return (
            f"{path}: does not match required pattern "
            f"(value suppressed); got type {got_type}"
        )
    if validator == "anyOf":
        return f"{path}: does not match any allowed schema variant"

    return f"{path}: invalid (validator={validator}, got type {got_type})"


def jsonschema_validate(schema: dict, instance: Any) -> list[str] | None:
    """Return error list, or None if jsonschema is not installed.

    Error strings are sanitized — never include env/overlay/oauth/files values.
    """
    try:
        import jsonschema  # type: ignore
    except ImportError:
        return None

    validator_cls = jsonschema.validators.validator_for(schema)
    validator_cls.check_schema(schema)
    validator = validator_cls(schema)
    return [_safe_jsonschema_error(e) for e in validator.iter_errors(instance)]


def validate_envelope(schema: dict | None, instance: Any) -> list[str]:
    if schema is not None:
        js_errors = jsonschema_validate(schema, instance)
        if js_errors is not None:
            return js_errors
    return stdlib_validate(instance)


def fetch_secret_string(secret_id: str, region: str | None) -> str:
    """Call aws secretsmanager get-secret-value; return SecretString only."""
    cmd = [
        "aws",
        "secretsmanager",
        "get-secret-value",
        "--secret-id",
        secret_id,
        "--query",
        "SecretString",
        "--output",
        "text",
    ]
    if region:
        cmd.extend(["--region", region])
    env = os.environ.copy()
    # Never echo AWS CLI debug with secret body
    env.pop("AWS_CLI_FILE_ENCODING", None)
    try:
        proc = subprocess.run(
            cmd,
            check=False,
            capture_output=True,
            text=True,
            env=env,
        )
    except FileNotFoundError:
        fail("aws CLI not found; install AWS CLI or use --from-file")

    if proc.returncode != 0:
        # Log stderr without assuming it contains secret material (AWS errors
        # typically mention resource/auth, not SecretString body).
        err_text = (proc.stderr or proc.stdout or "").strip()
        # Redact anything that looks like a long token just in case.
        err_text = re.sub(r"(?i)(secretstring|value)[=:].*", r"\1=<redacted>", err_text)
        fail(
            f"aws secretsmanager get-secret-value failed "
            f"(exit {proc.returncode}): {err_text or 'no details'}"
        )

    body = proc.stdout
    if body is None or body.strip() == "" or body.strip() == "None":
        fail("SecretString empty or missing from GetSecretValue response")
    return body


def parse_envelope_text(text: str, source: str) -> dict:
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        fail(f"invalid JSON from {source}: {e}")
    if not isinstance(data, dict):
        fail(f"envelope from {source} must be a JSON object")
    return data


def format_env_value(value: str) -> str:
    """Format a value for systemd EnvironmentFile / dotenv-compatible line."""
    if value == "" or _ENV_UNSAFE.search(value) or "=" in value:
        escaped = (
            value.replace("\\", "\\\\")
            .replace('"', '\\"')
            .replace("\n", "\\n")
            .replace("\r", "\\r")
        )
        return f'"{escaped}"'
    return value


def render_env_secrets(env: dict[str, str]) -> str:
    """Render KEY=value lines with stable key sort. Trailing newline."""
    lines: list[str] = [
        "# Managed by materialize-backend-secrets — do not edit by hand",
        "# Source: BackendRuntimeSecretsEnvelope env map",
    ]
    for key in sorted(env.keys()):
        lines.append(f"{key}={format_env_value(env[key])}")
    return "\n".join(lines) + "\n"


def render_config_secrets_yaml(overlay: dict) -> str:
    """Render config.secrets.yaml with stable key sort (idempotent)."""
    header = (
        "# Managed by materialize-backend-secrets — do not edit by hand\n"
        "# Source: BackendRuntimeSecretsEnvelope config_secret_overlay "
        "+ projected custom_providers\n"
    )
    try:
        import yaml  # type: ignore

        body = yaml.safe_dump(
            overlay,
            default_flow_style=False,
            sort_keys=True,
            allow_unicode=True,
        )
        return header + body
    except ImportError:
        # JSON is valid YAML 1.2 for pure object graphs; keep stable sort.
        body = json.dumps(overlay, indent=2, sort_keys=True, ensure_ascii=False)
        return header + body + "\n"


def build_hermes_auth_store(oauth: dict[str, Any]) -> dict[str, Any]:
    """Project structured oauth into Hermes auth.json layout.

    Shape matches exported Hermes auth stores and fixture examples:
      {"providers": {"<id>": {access_token, refresh_token?, ...}}}
    Provider ids and nested keys are sorted for idempotent rewrites.
    """
    providers: dict[str, Any] = {}
    for provider_id in sorted(oauth.keys()):
        material = oauth[provider_id]
        if not isinstance(material, dict):
            continue
        entry: dict[str, Any] = {}
        for key in ("access_token", "refresh_token", "expires_at", "token_type"):
            if key in material and isinstance(material[key], str):
                entry[key] = material[key]
        if "metadata" in material and isinstance(material["metadata"], dict):
            md = material["metadata"]
            entry["metadata"] = {k: md[k] for k in sorted(md.keys())}
        providers[provider_id] = entry
    return {"providers": providers}


def render_hermes_auth_json(oauth: dict[str, Any]) -> str:
    """Stable-sorted JSON body for $HERMES_HOME/auth.json."""
    store = build_hermes_auth_store(oauth)
    return json.dumps(store, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def project_custom_providers(
    overlay: dict[str, Any] | None,
    custom_providers: list[Any] | None,
) -> dict[str, Any] | None:
    """Merge config_secret_overlay with projected custom_providers.

    Prefer key_env / api_key_env (env indirection). Explicit overlay keys win
    over projection for the same providers.<id> field. Returns None when there
    is nothing to write.
    """
    result: dict[str, Any] = {}
    if isinstance(overlay, dict):
        result = copy.deepcopy(overlay)

    if custom_providers:
        providers = result.get("providers")
        if not isinstance(providers, dict):
            providers = {}
            result["providers"] = providers

        projected_list: list[dict[str, Any]] = []
        for entry in custom_providers:
            if not isinstance(entry, dict):
                continue
            pid = entry.get("id")
            base_url = entry.get("base_url")
            if not isinstance(pid, str) or not isinstance(base_url, str):
                continue
            key_env = entry.get("api_key_env") or entry.get("key_env")
            projected: dict[str, Any] = {"base_url": base_url}
            if isinstance(key_env, str) and key_env:
                projected["key_env"] = key_env
            elif isinstance(entry.get("api_key"), str):
                # Inline only when env indirection is impossible
                projected["api_key"] = entry["api_key"]
            for opt in ("default_model", "api_mode"):
                if opt in entry and isinstance(entry[opt], str):
                    projected[opt] = entry[opt]
            if isinstance(entry.get("models"), list):
                projected["models"] = list(entry["models"])

            existing = providers.get(pid)
            if not isinstance(existing, dict):
                providers[pid] = projected
            else:
                for k, v in projected.items():
                    if k not in existing:
                        existing[k] = v

            list_entry: dict[str, Any] = {
                "name": pid,
                "base_url": base_url,
            }
            if isinstance(key_env, str) and key_env:
                list_entry["key_env"] = key_env
            projected_list.append(list_entry)

        # Hermes list form: only inject when overlay did not already set it
        if "custom_providers" not in result and projected_list:
            result["custom_providers"] = projected_list

    return result if result else None


def parse_mode_string(mode: str | None) -> int:
    if not mode:
        return 0o600
    text = mode.strip()
    if text.startswith("0") and len(text) > 1:
        return int(text, 8)
    return int(text, 8)


def secret_file_mode(mode: str | None) -> int:
    """Resolve mode for allowlisted secret files (auth.json / oauth.enc).

    Contract requires owner-only (default 0600; optional 0400). Caller modes
    with group/other bits (e.g. 0644, 0777) are clamped to 0600 so they cannot
    land world- or group-readable secret files.
    """
    parsed = parse_mode_string(mode)
    if parsed in ALLOWED_SECRET_FILE_MODES:
        return parsed
    log(
        f"warning: files[].mode {parsed:04o} not owner-only "
        f"(allowed {sorted(f'{m:04o}' for m in ALLOWED_SECRET_FILE_MODES)}); "
        f"forcing 0600"
    )
    return 0o600


def atomic_write(path: Path, content: str, mode: int = 0o600) -> None:
    atomic_write_bytes(path, content.encode("utf-8"), mode=mode)


def atomic_write_bytes(path: Path, data: bytes, mode: int = 0o600) -> None:
    path = path.resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=str(path.parent),
    )
    tmp_path = Path(tmp_name)
    try:
        os.write(fd, data)
        os.fchmod(fd, mode)
        os.close(fd)
        fd = -1
        os.replace(str(tmp_path), str(path))
        # Ensure mode after replace (some FS preserve differently)
        os.chmod(path, mode)
    except Exception:
        if fd >= 0:
            try:
                os.close(fd)
            except OSError:
                pass
        try:
            tmp_path.unlink(missing_ok=True)  # type: ignore[call-arg]
        except TypeError:
            # Python < 3.8 missing_ok
            if tmp_path.exists():
                tmp_path.unlink()
        raise


def decode_file_entry(entry: dict[str, Any]) -> bytes:
    """Decode files[] entry body. Never log content.

    Placeholder sentinels in git fixtures may not be valid base64; those are
    written as UTF-8 bytes of the sentinel so offline materialize stays
    fail-open for unused slots. Non-placeholder invalid base64 fails closed
    (decode uses validate=True after explicit padding).
    """
    if "content_base64" in entry and entry["content_base64"] is not None:
        raw = entry["content_base64"]
        if not isinstance(raw, str):
            fail("files[].content_base64 must be a string")
        try:
            # Accept missing padding common in hand-edited fixtures; reject
            # non-alphabet garbage (validate=True) so corrupt blobs never land.
            pad = (-len(raw)) % 4
            return base64.b64decode(raw + ("=" * pad), validate=True)
        except Exception:
            if is_placeholder_base64_sentinel(raw):
                log(
                    "files[].content_base64 is a placeholder sentinel "
                    "(not valid base64); writing sentinel bytes for offline "
                    "fixture materialize"
                )
                return raw.encode("utf-8")
            fail(
                "files[].content_base64 is not valid base64 "
                "(value suppressed)"
            )
    if "content" in entry and entry["content"] is not None:
        raw = entry["content"]
        if not isinstance(raw, str):
            fail("files[].content must be a string")
        return raw.encode("utf-8")
    fail("files[] entry missing content and content_base64")


def materialize_files(
    files: list[Any],
    backend_home: Path,
    *,
    dry_run: bool,
) -> set[str]:
    """Write allowlisted files[]. Returns set of path_relative written.

    Modes are forced owner-only (0600 default; optional 0400). Group/world
    bits from envelope mode strings are clamped and never land on disk.
    """
    written: set[str] = set()
    for i, entry in enumerate(files):
        if not isinstance(entry, dict):
            fail(f"files[{i}] must be object")
        rel = entry.get("path_relative")
        if not isinstance(rel, str):
            fail(f"files[{i}].path_relative must be a string")
        if rel not in FILES_ALLOWLIST:
            fail(
                f"files[{i}].path_relative {rel!r} not in v1 allowlist "
                f"{sorted(FILES_ALLOWLIST)}"
            )
        if not PATH_RELATIVE_RE.match(rel):
            fail(f"files[{i}].path_relative is not a safe relative path")
        data = decode_file_entry(entry)
        mode = secret_file_mode(
            entry["mode"] if isinstance(entry.get("mode"), str) else None
        )
        target = backend_home / rel
        log(
            f"{'dry-run: would write' if dry_run else 'wrote'} "
            f"{target} bytes={len(data)} mode={mode:04o}"
        )
        if not dry_run:
            atomic_write_bytes(target, data, mode=mode)
        written.add(rel)
    return written


def resolve_backend_home(args: argparse.Namespace) -> Path:
    home = args.backend_home or os.environ.get("BACKEND_HOME") or os.environ.get(
        "HERMES_HOME"
    )
    if not home:
        fail(
            "BACKEND_HOME or HERMES_HOME required "
            "(flag --backend-home / env BACKEND_HOME / HERMES_HOME)"
        )
    return Path(home).expanduser()


def effective_kind(
    backend_kind: str | None, envelope: dict[str, Any]
) -> str | None:
    return backend_kind or (
        envelope.get("kind_hint")
        if isinstance(envelope.get("kind_hint"), str)
        else None
    )


def materialize(
    envelope: dict,
    backend_home: Path,
    *,
    backend_kind: str | None,
    dry_run: bool,
) -> None:
    env_map = envelope["env"]
    assert isinstance(env_map, dict)

    kind_hint = envelope.get("kind_hint")
    if (
        kind_hint
        and backend_kind
        and kind_hint != backend_kind
    ):
        log(
            f"warning: kind_hint={kind_hint!r} differs from "
            f"BACKEND_KIND={backend_kind!r}; materializing anyway "
            f"(envelope is backend-neutral)"
        )

    kind = effective_kind(backend_kind, envelope)

    env_path = backend_home / ".env.secrets"
    overlay_path = backend_home / "config.secrets.yaml"

    env_body = render_env_secrets(env_map)
    env_keys = sorted(env_map.keys())

    # --- custom_providers → config.secrets.yaml (prefer key_env) ---
    raw_overlay = envelope.get("config_secret_overlay")
    if raw_overlay is not None and not isinstance(raw_overlay, dict):
        fail("config_secret_overlay must be object")
    custom_providers = envelope.get("custom_providers")
    if custom_providers is not None and not isinstance(custom_providers, list):
        fail("custom_providers must be array")

    # Soft check: key_env names should exist under env when projecting
    if isinstance(custom_providers, list):
        for i, entry in enumerate(custom_providers):
            if not isinstance(entry, dict):
                continue
            key_env = entry.get("api_key_env") or entry.get("key_env")
            if isinstance(key_env, str) and key_env not in env_map:
                log(
                    f"warning: custom_providers[{i}] key_env={key_env!r} "
                    f"not present in env (projection still writes key_env ref)"
                )

    merged_overlay = project_custom_providers(
        raw_overlay if isinstance(raw_overlay, dict) else None,
        custom_providers if isinstance(custom_providers, list) else None,
    )

    # --- files[] (opaque auth stores) ---
    files = envelope.get("files")
    if files is not None and not isinstance(files, list):
        fail("files must be array")

    # --- structured oauth ---
    oauth = envelope.get("oauth")
    if oauth is not None and not isinstance(oauth, dict):
        fail("oauth must be object")
    oauth_provider_ids: list[str] = (
        sorted(oauth.keys()) if isinstance(oauth, dict) else []
    )

    log(f"backend_home={backend_home}")
    log(f"effective_kind={kind!r}")
    log(f"env_keys={len(env_keys)} names={env_keys}")
    log(f"target_env={env_path}")
    if oauth_provider_ids:
        log(f"oauth_providers={len(oauth_provider_ids)} ids={oauth_provider_ids}")
    if isinstance(custom_providers, list):
        cp_ids = [
            e.get("id")
            for e in custom_providers
            if isinstance(e, dict) and isinstance(e.get("id"), str)
        ]
        log(f"custom_providers={len(cp_ids)} ids={cp_ids}")
    if isinstance(files, list):
        file_paths = [
            e.get("path_relative")
            for e in files
            if isinstance(e, dict)
        ]
        log(f"files={len(files)} paths={file_paths}")

    if dry_run:
        log("dry-run: would write .env.secrets")
        if merged_overlay is not None:
            log(
                f"dry-run: would write config.secrets.yaml "
                f"(top-level keys={sorted(merged_overlay.keys())})"
            )
        else:
            log(
                "dry-run: no config_secret_overlay/custom_providers; "
                "would remove config.secrets.yaml if present"
            )
        written_files: set[str] = set()
        if isinstance(files, list) and files:
            written_files = materialize_files(
                files, backend_home, dry_run=True
            )
        if isinstance(oauth, dict) and oauth:
            oauth_path = _plan_structured_oauth(
                oauth, kind, written_files, dry_run=True
            )
            if oauth_path:
                written_files.add(oauth_path)
        _remove_stale_oauth_stores(
            backend_home, written_files, dry_run=True
        )
        return

    atomic_write(env_path, env_body, mode=0o600)
    log(f"wrote {env_path} mode=0600 keys={len(env_keys)}")

    if merged_overlay is not None:
        yaml_body = render_config_secrets_yaml(merged_overlay)
        atomic_write(overlay_path, yaml_body, mode=0o600)
        log(
            f"wrote {overlay_path} mode=0600 "
            f"top-level keys={sorted(merged_overlay.keys())}"
        )
    else:
        if overlay_path.is_file():
            overlay_path.unlink()
            log(
                f"removed stale {overlay_path} "
                "(no config_secret_overlay/custom_providers)"
            )
        else:
            log(
                "no config_secret_overlay/custom_providers; "
                "config.secrets.yaml not written"
            )

    written_files: set[str] = set()
    if isinstance(files, list) and files:
        written_files = materialize_files(files, backend_home, dry_run=False)

    if isinstance(oauth, dict) and oauth:
        oauth_path = _plan_structured_oauth(
            oauth, kind, written_files, dry_run=False, backend_home=backend_home
        )
        if oauth_path:
            written_files.add(oauth_path)

    # Stale OAuth store cleanup (mirror config.secrets.yaml lifecycle): when
    # neither files[] nor structured oauth supplies a managed path this run,
    # remove prior material so rotation/shrink does not leave live tokens.
    _remove_stale_oauth_stores(
        backend_home, written_files, dry_run=False
    )


def _remove_stale_oauth_stores(
    backend_home: Path,
    written_files: set[str],
    *,
    dry_run: bool,
) -> None:
    """Unlink allowlisted oauth paths not produced this materialize run."""
    for rel in sorted(FILES_ALLOWLIST):
        if rel in written_files:
            continue
        target = backend_home / rel
        if not target.is_file():
            continue
        if dry_run:
            log(
                f"dry-run: would remove stale {target} "
                f"(not supplied by oauth/files this run)"
            )
            continue
        target.unlink()
        log(
            f"removed stale {target} "
            f"(not supplied by oauth/files this run)"
        )


def _plan_structured_oauth(
    oauth: dict[str, Any],
    kind: str | None,
    written_files: set[str],
    *,
    dry_run: bool,
    backend_home: Path | None = None,
) -> str | None:
    """Write structured oauth into kind-appropriate store when not from files[].

    hermes_* / default → auth.json
    lanyard_agent → only via files[] oauth.enc (encrypted store); structured
    tokens are not written as cleartext oauth.enc. Non-empty structured oauth
    without files[] oauth.enc fails closed for lanyard_agent.

    Returns path_relative written (e.g. "auth.json"), or None when files[]
    already supplied the store / dry-run plan only for agent skip path.
    """
    provider_ids = sorted(oauth.keys())
    # Count placeholders for operator visibility (no values logged)
    placeholder_count = 0
    for pid in provider_ids:
        material = oauth[pid]
        if isinstance(material, dict) and isinstance(
            material.get("access_token"), str
        ):
            if is_placeholder_sentinel(material["access_token"]):
                placeholder_count += 1
    if placeholder_count:
        log(
            f"oauth placeholder_sentinels={placeholder_count}/"
            f"{len(provider_ids)} (written; unused slots do not fail closed)"
        )

    if kind == "lanyard_agent":
        if "oauth.enc" in written_files:
            log(
                "lanyard_agent: oauth.enc provided via files[]; "
                "structured oauth not projected to cleartext"
            )
            return None
        # Fail closed: SM shows oauth but host would have none (no encrypt path
        # in this tool yet). Operators must supply files[] oauth.enc.
        fail(
            "lanyard_agent: structured oauth present but no files[] "
            f"oauth.enc (providers={provider_ids}); supply files[] for "
            "OAuthStore (encryption not performed by materialize)"
        )

    # Hermes-compatible (or unspecified kind): auth.json
    if "auth.json" in written_files:
        log(
            "auth.json provided via files[]; "
            "structured oauth not projected (opaque export wins)"
        )
        return None

    body = render_hermes_auth_json(oauth)
    target_label = "auth.json"
    if dry_run:
        log(
            f"dry-run: would write {target_label} "
            f"oauth_providers={provider_ids} bytes={len(body.encode('utf-8'))}"
        )
        return "auth.json"
    assert backend_home is not None
    target = backend_home / "auth.json"
    atomic_write(target, body, mode=0o600)
    log(
        f"wrote {target} mode=0600 "
        f"oauth_providers={provider_ids} bytes={len(body.encode('utf-8'))}"
    )
    return "auth.json"


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description=(
            "Materialize BackendRuntimeSecretsEnvelope from AWS SM or "
            "--from-file into $BACKEND_HOME/.env.secrets, optional "
            "config.secrets.yaml (overlay + custom_providers), and OAuth "
            "stores (auth.json / oauth.enc)."
        )
    )
    src = p.add_mutually_exclusive_group()
    src.add_argument(
        "--from-file",
        type=Path,
        metavar="PATH",
        help="Read envelope JSON from file (offline / CI; no AWS)",
    )
    src.add_argument(
        "--secret-arn",
        metavar="ARN",
        default=None,
        help="SM secret id/ARN (default: env BACKEND_RUNTIME_SECRETS_ARN)",
    )
    p.add_argument(
        "--backend-home",
        metavar="DIR",
        default=None,
        help="Runtime home directory (default: BACKEND_HOME or HERMES_HOME)",
    )
    p.add_argument(
        "--backend-kind",
        metavar="KIND",
        default=None,
        help="Optional BACKEND_KIND (warning only if kind_hint differs)",
    )
    p.add_argument(
        "--aws-region",
        metavar="REGION",
        default=None,
        help="AWS region for GetSecretValue (default: AWS_REGION)",
    )
    p.add_argument(
        "--schema",
        type=Path,
        default=None,
        help="Path to secrets-envelope.schema.json (default: repo contract)",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and print actions; write nothing",
    )
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    secret_arn = args.secret_arn or os.environ.get("BACKEND_RUNTIME_SECRETS_ARN")
    if not args.from_file and not secret_arn:
        fail(
            "provide --from-file PATH or --secret-arn / "
            "BACKEND_RUNTIME_SECRETS_ARN"
        )

    backend_home = resolve_backend_home(args)
    backend_kind = args.backend_kind or os.environ.get("BACKEND_KIND") or None
    region = args.aws_region or os.environ.get("AWS_REGION") or None

    schema_path = args.schema or default_schema_path()
    schema: dict | None = None
    if schema_path.is_file():
        loaded = load_json(schema_path)
        if not isinstance(loaded, dict):
            fail(f"schema must be object: {schema_path}")
        schema = loaded
        log(f"schema={schema_path}")
    else:
        log(
            f"warning: schema not found at {schema_path}; "
            "using built-in subset validator"
        )

    if args.from_file:
        src_path = args.from_file.expanduser().resolve()
        if not src_path.is_file():
            fail(f"--from-file not found: {src_path}")
        log(f"source=file path={src_path}")
        envelope = load_json(src_path)
        if not isinstance(envelope, dict):
            fail(f"envelope must be a JSON object: {src_path}")
        source_label = f"file:{src_path}"
    else:
        assert secret_arn is not None
        # Log ARN only (not secret body)
        log(f"source=secretsmanager secret_id={secret_arn} region={region or 'default'}")
        text = fetch_secret_string(secret_arn, region)
        envelope = parse_envelope_text(text, "secretsmanager")
        source_label = "secretsmanager"

    errors = validate_envelope(schema, envelope)
    if errors:
        for e in errors:
            log(f"schema validation: {e}")
        fail(
            f"envelope failed schema validation ({len(errors)} error(s)) "
            f"from {source_label}"
        )

    log("schema validation: ok")
    materialize(
        envelope,
        backend_home,
        backend_kind=backend_kind,
        dry_run=args.dry_run,
    )
    if args.dry_run:
        log("dry-run complete (no files written)")
    else:
        log("materialize complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
