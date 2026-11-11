#!/usr/bin/env python3
"""Offline validation for BackendRuntimeSecretsEnvelope (backend-runtime-v1).

Validates:
  - contracts/backend-runtime-v1/secrets-envelope.schema.json is loadable
  - placeholder examples under contracts/backend-runtime-v1/examples/ conform
  - negative fixtures (missing schema_version, non-object env, wrong types,
    invalid oauth / custom_providers / files shapes) are rejected
  - committed examples use placeholder-looking values only (no live-looking keys)

Uses jsonschema when installed; otherwise a stdlib subset checker. No network.

Usage (from repository root):
  python3 scripts/validate-secrets-envelope.py
  python3 scripts/validate-secrets-envelope.py --root /path/to/repo

Exit 0 on success; non-zero on failure.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

KINDS = frozenset({"hermes_upstream", "hermes_lanyard", "lanyard_agent"})
EXAMPLE_GLOB = "secrets-envelope.*.json"

# Reject values that look like live secrets in committed examples.
LIVE_LOOKING = re.compile(
    r"^(sk-live-|sk-proj-|sk-ant-api|xai-|ghp_|github_pat_|AKIA[0-9A-Z]{16})",
    re.IGNORECASE,
)
PLACEHOLDER_HINT = re.compile(
    r"(placeholder|replace[_-]?me|example|dummy|xxxx|your[_-]?key)",
    re.IGNORECASE,
)
ENV_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
OAUTH_PROVIDER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
PATH_RELATIVE_RE = re.compile(
    r"^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._][A-Za-z0-9._\/-]*$"
)
MODE_RE = re.compile(r"^0?[0-7]{3,4}$")

REQUIRED_SCHEMA_FIELDS = (
    "schema_version",
    "env",
    "kind_hint",
    "config_secret_overlay",
    "meta",
    "oauth",
    "custom_providers",
    "files",
)
ALLOWED_TOP = frozenset(
    {
        "schema_version",
        "kind_hint",
        "env",
        "oauth",
        "custom_providers",
        "config_secret_overlay",
        "files",
        "meta",
    }
)


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def _validate_oauth(oauth: Any, path: str, errors: list[str]) -> None:
    if not isinstance(oauth, dict):
        errors.append(f"{path}: oauth must be object, got {type(oauth).__name__}")
        return
    for provider, material in oauth.items():
        ppath = f"{path}.{provider}"
        if not isinstance(provider, str) or not OAUTH_PROVIDER_RE.match(provider):
            errors.append(f"{path}: provider id {provider!r} is invalid")
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
                errors.append(f"{ppath}.access_token must be a non-empty string")
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


def _validate_custom_providers(cps: Any, path: str, errors: list[str]) -> None:
    if not isinstance(cps, list):
        errors.append(
            f"{path}: custom_providers must be array, got {type(cps).__name__}"
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
        epath = f"{path}[{i}]"
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


def _validate_files(files: Any, path: str, errors: list[str]) -> None:
    if not isinstance(files, list):
        errors.append(f"{path}: files must be array, got {type(files).__name__}")
        return
    allowed = {
        "path_relative",
        "encoding",
        "content",
        "content_base64",
        "mode",
    }
    for i, entry in enumerate(files):
        epath = f"{path}[{i}]"
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
                    f"(no absolute, no '..'), got {pr!r}"
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
                errors.append(
                    f"{epath}.encoding must be 'utf-8' or 'base64', got {enc!r}"
                )
        if "mode" in entry:
            mode = entry["mode"]
            if not isinstance(mode, str) or not MODE_RE.match(mode):
                errors.append(f"{epath}.mode must be an octal mode string")
        for k in entry:
            if k not in allowed:
                errors.append(f"{epath}: additional property not allowed: {k!r}")


def stdlib_validate(instance: Any, path: str = "$") -> list[str]:
    """Subset validator matching secrets-envelope.schema.json required rules."""
    errors: list[str] = []

    def err(msg: str) -> None:
        errors.append(f"{path}: {msg}")

    if not isinstance(instance, dict):
        err(f"must be object, got {type(instance).__name__}")
        return errors

    if "schema_version" not in instance:
        err("missing required property 'schema_version'")
    else:
        sv = instance["schema_version"]
        if sv != 1 or isinstance(sv, bool):
            err(f"schema_version must be integer const 1, got {sv!r}")

    if "env" not in instance:
        err("missing required property 'env'")
    else:
        env = instance["env"]
        if not isinstance(env, dict):
            err(f"env must be object, got {type(env).__name__}")
        else:
            for k, v in env.items():
                if not isinstance(k, str) or not ENV_NAME_RE.match(k):
                    err(f"env key {k!r} must be a valid env name")
                if not isinstance(v, str):
                    err(f"env.{k} must be a string, got {type(v).__name__}")

    if "kind_hint" in instance:
        kh = instance["kind_hint"]
        if not isinstance(kh, str) or kh not in KINDS:
            err(
                f"kind_hint must be one of {sorted(KINDS)}, got {kh!r}"
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
        else:
            if "tenant_slug" in meta and not isinstance(meta["tenant_slug"], str):
                err("meta.tenant_slug must be a string when present")
            if "rotated_at" in meta and not isinstance(meta["rotated_at"], str):
                err("meta.rotated_at must be a string when present")
            if "notes" in meta and not isinstance(meta["notes"], str):
                err("meta.notes must be a string when present")

    if "oauth" in instance:
        _validate_oauth(instance["oauth"], f"{path}.oauth", errors)

    if "custom_providers" in instance:
        _validate_custom_providers(
            instance["custom_providers"], f"{path}.custom_providers", errors
        )

    if "files" in instance:
        _validate_files(instance["files"], f"{path}.files", errors)

    for k in instance:
        if k not in ALLOWED_TOP:
            err(f"additional property not allowed: {k!r}")

    return errors


def jsonschema_validate(schema: dict, instance: Any) -> list[str] | None:
    """Return error list, or None if jsonschema is not installed."""
    try:
        import jsonschema  # type: ignore
    except ImportError:
        return None

    validator_cls = jsonschema.validators.validator_for(schema)
    validator_cls.check_schema(schema)
    validator = validator_cls(schema)
    return [
        f"{'/'.join(str(p) for p in e.absolute_path) or '$'}: {e.message}"
        for e in validator.iter_errors(instance)
    ]


def validate_instance(schema: dict, instance: Any) -> list[str]:
    js_errors = jsonschema_validate(schema, instance)
    if js_errors is not None:
        return js_errors
    return stdlib_validate(instance)


def find_live_looking_values(obj: Any, path: str = "$") -> list[str]:
    """Flag values in committed examples that look like real secrets."""
    hits: list[str] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            hits.extend(find_live_looking_values(v, f"{path}.{k}"))
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            hits.extend(find_live_looking_values(item, f"{path}[{i}]"))
    elif isinstance(obj, str):
        if LIVE_LOOKING.search(obj):
            hits.append(f"{path}: live-looking secret value")
        # Long opaque tokens without placeholder markers
        elif (
            len(obj) >= 32
            and not PLACEHOLDER_HINT.search(obj)
            and re.fullmatch(r"[A-Za-z0-9_\-+/=]+", obj)
            and not obj.startswith("2026-")  # timestamps in meta
            and not obj.startswith("https://")  # public base URLs
        ):
            hits.append(f"{path}: long opaque value without placeholder marker")
    return hits


def negative_cases() -> list[tuple[str, Any]]:
    """Invalid instances that must be rejected."""
    return [
        (
            "missing_schema_version",
            {"env": {"OPENAI_API_KEY": "x"}},
        ),
        (
            "schema_version_wrong",
            {"schema_version": 2, "env": {"OPENAI_API_KEY": "x"}},
        ),
        (
            "missing_env",
            {"schema_version": 1},
        ),
        (
            "env_not_object",
            {"schema_version": 1, "env": ["OPENAI_API_KEY"]},
        ),
        (
            "env_value_not_string",
            {"schema_version": 1, "env": {"OPENAI_API_KEY": 123}},
        ),
        (
            "kind_hint_invalid",
            {
                "schema_version": 1,
                "kind_hint": "not_a_kind",
                "env": {"OPENAI_API_KEY": "x"},
            },
        ),
        (
            "config_secret_overlay_not_object",
            {
                "schema_version": 1,
                "env": {"OPENAI_API_KEY": "x"},
                "config_secret_overlay": "nope",
            },
        ),
        (
            "meta_not_object",
            {
                "schema_version": 1,
                "env": {"OPENAI_API_KEY": "x"},
                "meta": "notes",
            },
        ),
        (
            "not_object",
            ["schema_version", 1],
        ),
        (
            "oauth_not_object",
            {
                "schema_version": 1,
                "env": {"OPENAI_API_KEY": "x"},
                "oauth": ["xai-grok"],
            },
        ),
        (
            "oauth_missing_access_token",
            {
                "schema_version": 1,
                "env": {"OPENAI_API_KEY": "x"},
                "oauth": {
                    "xai-grok": {
                        "refresh_token": "oauth-placeholder-refresh"
                    }
                },
            },
        ),
        (
            "oauth_access_token_not_string",
            {
                "schema_version": 1,
                "env": {"OPENAI_API_KEY": "x"},
                "oauth": {"openai-codex": {"access_token": 12345}},
            },
        ),
        (
            "oauth_provider_not_object",
            {
                "schema_version": 1,
                "env": {"OPENAI_API_KEY": "x"},
                "oauth": {"xai-grok": "token-only"},
            },
        ),
        (
            "custom_providers_not_array",
            {
                "schema_version": 1,
                "env": {"OPENAI_API_KEY": "x"},
                "custom_providers": {"id": "meta"},
            },
        ),
        (
            "custom_providers_missing_id",
            {
                "schema_version": 1,
                "env": {"META_API_KEY": "x"},
                "custom_providers": [
                    {
                        "base_url": "https://api.llama.com/compat/v1",
                        "api_key_env": "META_API_KEY",
                    }
                ],
            },
        ),
        (
            "custom_providers_missing_base_url",
            {
                "schema_version": 1,
                "env": {"META_API_KEY": "x"},
                "custom_providers": [
                    {"id": "meta", "api_key_env": "META_API_KEY"}
                ],
            },
        ),
        (
            "custom_providers_bad_api_key_env",
            {
                "schema_version": 1,
                "env": {"OPENAI_API_KEY": "x"},
                "custom_providers": [
                    {
                        "id": "meta",
                        "base_url": "https://example.com/v1",
                        "api_key_env": "bad-env-name!",
                    }
                ],
            },
        ),
        (
            "files_path_absolute",
            {
                "schema_version": 1,
                "env": {"OPENAI_API_KEY": "x"},
                "files": [
                    {
                        "path_relative": "/etc/passwd",
                        "content": "nope",
                    }
                ],
            },
        ),
        (
            "files_path_traversal",
            {
                "schema_version": 1,
                "env": {"OPENAI_API_KEY": "x"},
                "files": [
                    {
                        "path_relative": "../secrets/auth.json",
                        "content": "nope",
                    }
                ],
            },
        ),
        (
            "files_missing_content",
            {
                "schema_version": 1,
                "env": {"OPENAI_API_KEY": "x"},
                "files": [{"path_relative": "auth.json"}],
            },
        ),
        (
            "unknown_top_level",
            {
                "schema_version": 1,
                "env": {"OPENAI_API_KEY": "x"},
                "not_a_field": True,
            },
        ),
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=None,
        help="Repository root (default: parent of scripts/)",
    )
    args = parser.parse_args()

    if args.root is not None:
        root = args.root.resolve()
    else:
        root = Path(__file__).resolve().parent.parent

    contract_dir = root / "contracts" / "backend-runtime-v1"
    schema_path = contract_dir / "secrets-envelope.schema.json"
    examples_dir = contract_dir / "examples"
    arch_doc = root / "docs" / "architecture" / "backend-runtime-secrets.md"

    failed = 0
    passed = 0

    def pass_(msg: str) -> None:
        nonlocal passed
        passed += 1
        print(f"  PASS  {msg}")

    def fail(msg: str) -> None:
        nonlocal failed
        failed += 1
        print(f"  FAIL  {msg}")

    print("==> BackendRuntimeSecretsEnvelope validation (offline)")
    print(f"    root: {root}")
    print()

    if not schema_path.is_file():
        fail(f"missing schema: {schema_path.relative_to(root)}")
        print()
        print(f"FAILED  {failed} failure(s), {passed} pass(es).")
        return 1

    try:
        schema = load_json(schema_path)
    except (OSError, json.JSONDecodeError) as e:
        fail(f"schema not loadable: {e}")
        print()
        print(f"FAILED  {failed} failure(s), {passed} pass(es).")
        return 1

    if not isinstance(schema, dict) or schema.get("type") != "object":
        fail("schema must be a JSON Schema object with type=object")
    else:
        props = schema.get("properties") or {}
        required = set(schema.get("required") or [])
        ok = True
        for field in REQUIRED_SCHEMA_FIELDS:
            if field not in props:
                fail(f"schema.properties must include '{field}'")
                ok = False
        if "schema_version" not in required or "env" not in required:
            fail("schema.required must include schema_version and env")
            ok = False
        sv = props.get("schema_version") or {}
        if sv.get("const") != 1:
            fail("schema_version must have const: 1")
            ok = False
        if schema.get("additionalProperties") is not False:
            fail("schema should set additionalProperties: false")
            ok = False
        defs = schema.get("$defs") or {}
        for d in ("oauthProviderMaterial", "customProviderEntry", "secretFileEntry"):
            if d not in defs:
                fail(f"schema.$defs must include '{d}'")
                ok = False
        mapping = schema.get("x-lanyard-backend-mapping") or {}
        kinds_map = mapping.get("kinds") or {}
        for kind in sorted(KINDS):
            entry = kinds_map.get(kind) or {}
            if "oauth_target" not in entry:
                fail(f"schema mapping for {kind} missing oauth_target")
                ok = False
            if "custom_providers_target" not in entry:
                fail(f"schema mapping for {kind} missing custom_providers_target")
                ok = False
        if ok:
            pass_(
                "schema loadable; required schema_version+env; "
                "oauth/custom_providers/files properties complete"
            )

    try:
        import jsonschema  # type: ignore  # noqa: F401

        engine = "jsonschema"
    except ImportError:
        engine = "stdlib-subset"

    print(f"    validator engine: {engine}")
    print()

    # Architecture doc must map all three kinds + new field targets
    if not arch_doc.is_file():
        fail(f"missing architecture doc: {arch_doc.relative_to(root)}")
    else:
        text = arch_doc.read_text(encoding="utf-8")
        missing_kinds = [k for k in sorted(KINDS) if k not in text]
        if missing_kinds:
            fail(f"architecture doc missing backend kind(s): {missing_kinds}")
        else:
            pass_("architecture doc maps hermes_lanyard/hermes_upstream/lanyard_agent")
        markers = (
            ".env.secrets",
            "config.secrets.yaml",
            "EnvironmentFile",
            "kind_hint",
            "BackendRuntimeSecretsEnvelope",
            "oauth",
            "custom_providers",
            "auth.json",
            "oauth.enc",
        )
        missing_markers = [n for n in markers if n not in text]
        if missing_markers:
            for n in missing_markers:
                fail(f"architecture doc missing marker: {n}")
        else:
            pass_("architecture doc has env/overlay/oauth/custom mapping markers")
        # Per-kind file targets for new fields
        if "hermes_lanyard" in text and "auth.json" in text and "oauth.enc" in text:
            pass_("architecture maps hermes_lanyard and lanyard_agent oauth file targets")
        else:
            fail("architecture missing hermes_lanyard auth.json / agent oauth.enc targets")

    if not examples_dir.is_dir():
        fail(f"missing examples directory: {examples_dir.relative_to(root)}")
    else:
        examples = sorted(examples_dir.glob(EXAMPLE_GLOB))
        if not examples:
            fail(f"no {EXAMPLE_GLOB} examples found")
        else:
            names = {p.name for p in examples}
            for kind_slug in (
                "hermes-lanyard",
                "hermes-upstream",
                "lanyard-agent",
                "minimal",
                "full-matrix",
            ):
                expected = f"secrets-envelope.{kind_slug}.json"
                if expected not in names:
                    fail(f"examples missing {expected}")
                else:
                    pass_(f"example present: {expected}")

            full_matrix = examples_dir / "secrets-envelope.full-matrix.json"
            if full_matrix.is_file():
                try:
                    fm = load_json(full_matrix)
                except (OSError, json.JSONDecodeError) as e:
                    fail(f"full-matrix cannot parse: {e}")
                    fm = None
                if isinstance(fm, dict):
                    for key in ("oauth", "custom_providers", "env"):
                        if key not in fm:
                            fail(f"full-matrix missing top-level '{key}'")
                        else:
                            pass_(f"full-matrix includes '{key}'")
                    if isinstance(fm.get("oauth"), dict):
                        for provider in ("xai-grok", "openai-codex"):
                            if provider not in fm["oauth"]:
                                fail(f"full-matrix.oauth missing {provider}")
                            else:
                                pass_(f"full-matrix.oauth has {provider}")
                    cps = fm.get("custom_providers")
                    if not isinstance(cps, list) or len(cps) < 2:
                        fail("full-matrix.custom_providers must have ≥2 entries")
                    else:
                        pass_("full-matrix.custom_providers multi-entry")

            for ex in examples:
                rel = ex.relative_to(root)
                try:
                    data = load_json(ex)
                except (OSError, json.JSONDecodeError) as e:
                    fail(f"{rel}: cannot parse: {e}")
                    continue
                if not isinstance(data, dict):
                    fail(f"{rel}: top-level must be object")
                    continue

                errors = validate_instance(schema, data)
                if errors:
                    for e in errors:
                        fail(f"{rel}: {e}")
                else:
                    pass_(f"{rel} validates")

                live = find_live_looking_values(data)
                if live:
                    for h in live:
                        fail(f"{rel}: {h}")
                else:
                    pass_(f"{rel}: placeholder-only values")

    print()
    print("  negative cases (must reject)")
    for name, instance in negative_cases():
        errors = validate_instance(schema, instance)
        if not errors:
            fail(f"{name}: expected validation errors, got none")
        else:
            pass_(f"{name}: rejected ({len(errors)} error(s))")

    # kind_hint optional: valid without it (minimal shape)
    no_hint = {"schema_version": 1, "env": {"XAI_API_KEY": "sk-placeholder-x"}}
    errors = validate_instance(schema, no_hint)
    if errors:
        for e in errors:
            fail(f"kind_hint_optional: {e}")
    else:
        pass_("kind_hint optional: envelope without kind_hint validates")

    # Positive: oauth + custom_providers minimal valid shape
    multi = {
        "schema_version": 1,
        "env": {
            "META_API_KEY": "sk-placeholder-meta",
            "LANYARD_OAUTH_KEY": "REPLACE_ME_oauth_key",
        },
        "oauth": {
            "xai-grok": {
                "access_token": "oauth-placeholder-access",
                "metadata": {"account_label": "placeholder-label"},
            }
        },
        "custom_providers": [
            {
                "id": "meta",
                "base_url": "https://api.llama.com/compat/v1",
                "api_key_env": "META_API_KEY",
            }
        ],
    }
    errors = validate_instance(schema, multi)
    if errors:
        for e in errors:
            fail(f"oauth_custom_positive: {e}")
    else:
        pass_("oauth + custom_providers positive envelope validates")

    print()
    if failed:
        print(f"FAILED  {failed} failure(s), {passed} pass(es).")
        return 1
    print(f"OK  {passed} check(s) passed (offline, no network).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
