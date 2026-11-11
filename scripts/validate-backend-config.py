#!/usr/bin/env python3
"""Offline validation for backend runtime config (backend-runtime-v1).

Validates:
  - contracts/backend-runtime-v1/config.schema.json is loadable JSON Schema
  - example configs under contracts/backend-runtime-v1/examples/ conform
  - committed examples omit secret-shaped keys
  - negative fixtures (wrong model type, etc.) are rejected when constrained

Uses jsonschema when installed; otherwise a stdlib subset checker that
enforces model/providers/skills/cron shapes for this contract. No network.

Usage (from repository root):
  python3 scripts/validate-backend-config.py
  python3 scripts/validate-backend-config.py --root /path/to/repo

Exit 0 on success; non-zero on failure.
"""

from __future__ import annotations

import argparse
import copy
import json
import re
import sys
from pathlib import Path
from typing import Any

# Keys that must not appear in committed examples (values may be secrets).
# key_env / api_key_env name env vars and are allowed.
FORBIDDEN_SECRET_KEYS = frozenset(
    {
        "api_key",
        "sudo_password",
        "password",
        "passwd",
        "token",
        "access_token",
        "refresh_token",
        "client_secret",
        "private_key",
        "authorization",
        "bearer",
        "secret",
    }
)
# Nested maps that often hold credentials — forbid in committed examples.
FORBIDDEN_NESTED_MAPS = frozenset({"env", "headers", "secrets", "credentials"})

SECRET_KEY_RE = re.compile(
    r"(api[_-]?key|token|password|passwd|secret|authorization|"
    r"private[_-]?key|access[_-]?key|refresh[_-]?key|bearer)$",
    re.IGNORECASE,
)

# Allow-list: keys that look secret-shaped but are env *names*, not values.
ALLOWED_SECRET_SHAPED = frozenset(
    {
        "key_env",
        "api_key_env",
        "auth_mode",
    }
)


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def load_yaml(path: Path) -> Any:
    text = path.read_text(encoding="utf-8")
    try:
        import yaml  # type: ignore

        return yaml.safe_load(text)
    except ImportError as e:
        raise RuntimeError(
            "PyYAML is required to parse .yaml config examples "
            "(or use the sibling .config.json fixtures)"
        ) from e


def load_config_file(path: Path) -> Any:
    if path.suffix == ".json":
        return load_json(path)
    if path.suffix in (".yaml", ".yml"):
        return load_yaml(path)
    raise ValueError(f"unsupported config example suffix: {path.suffix}")


def find_secret_keys(obj: Any, path: str = "$") -> list[str]:
    """Return paths of forbidden secret-shaped keys in committed examples."""
    hits: list[str] = []

    if isinstance(obj, dict):
        for k, v in obj.items():
            key = str(k)
            lowered = key.lower()
            child = f"{path}.{key}"
            if lowered in ALLOWED_SECRET_SHAPED:
                continue
            if lowered in FORBIDDEN_SECRET_KEYS or SECRET_KEY_RE.search(key):
                hits.append(child)
                continue
            if lowered in FORBIDDEN_NESTED_MAPS and isinstance(v, dict) and v:
                hits.append(f"{child} (non-empty forbidden nested map)")
                continue
            hits.extend(find_secret_keys(v, child))
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            hits.extend(find_secret_keys(item, f"{path}[{i}]"))
    return hits


def stdlib_validate(instance: Any, path: str = "$") -> list[str]:
    """Subset validator matching config.schema.json required contract rules."""
    errors: list[str] = []

    def err(msg: str) -> None:
        errors.append(f"{path}: {msg}")

    if not isinstance(instance, dict):
        err(f"must be object, got {type(instance).__name__}")
        return errors

    if "model" in instance:
        model = instance["model"]
        if isinstance(model, str):
            pass
        elif isinstance(model, dict):
            for k in ("default", "model", "name", "provider", "base_url"):
                if k in model and model[k] is not None and not isinstance(
                    model[k], str
                ):
                    err(f"model.{k} must be a string when present")
            if "context_length" in model:
                cl = model["context_length"]
                if not isinstance(cl, int) or isinstance(cl, bool) or cl < 1:
                    err("model.context_length must be integer >= 1")
            if "max_tokens" in model:
                mt = model["max_tokens"]
                if not isinstance(mt, int) or isinstance(mt, bool) or mt < 1:
                    err("model.max_tokens must be integer >= 1")
        else:
            err(
                f"model must be string or object, got {type(model).__name__}"
            )

    if "providers" in instance:
        providers = instance["providers"]
        if not isinstance(providers, dict):
            err("providers must be an object")
        else:
            for name, entry in providers.items():
                if entry is None:
                    continue
                if not isinstance(entry, dict):
                    err(f"providers.{name} must be an object")
                    continue
                for sk in ("base_url", "url", "api", "key_env", "model"):
                    if sk in entry and entry[sk] is not None and not isinstance(
                        entry[sk], str
                    ):
                        err(f"providers.{name}.{sk} must be a string when present")

    if "skills" in instance:
        skills = instance["skills"]
        if not isinstance(skills, dict):
            err("skills must be an object")
        else:
            if "external_dirs" in skills:
                ed = skills["external_dirs"]
                if isinstance(ed, str):
                    pass  # Hermes accepts a single path string
                elif not isinstance(ed, list) or not all(
                    isinstance(x, str) for x in ed
                ):
                    err(
                        "skills.external_dirs must be a string or array of strings"
                    )
            if "creation_nudge_interval" in skills:
                n = skills["creation_nudge_interval"]
                if not isinstance(n, int) or isinstance(n, bool) or n < 0:
                    err("skills.creation_nudge_interval must be integer >= 0")
            for bk in (
                "template_vars",
                "inline_shell",
                "guard_agent_created",
                "write_approval",
            ):
                if bk in skills and not isinstance(skills[bk], bool):
                    err(f"skills.{bk} must be a boolean")

    if "cron" in instance:
        cron = instance["cron"]
        if not isinstance(cron, dict):
            err("cron must be an object")
        else:
            if "provider" in cron and cron["provider"] is not None:
                if not isinstance(cron["provider"], str):
                    err("cron.provider must be a string")
            if "chronos" in cron and cron["chronos"] is not None:
                if not isinstance(cron["chronos"], dict):
                    err("cron.chronos must be an object")
            for bk in ("wrap_response", "mirror_delivery"):
                if bk in cron and not isinstance(cron[bk], bool):
                    err(f"cron.{bk} must be a boolean")
            if "max_parallel_jobs" in cron:
                mpj = cron["max_parallel_jobs"]
                if mpj is not None and (
                    not isinstance(mpj, int)
                    or isinstance(mpj, bool)
                    or mpj < 0
                ):
                    err("cron.max_parallel_jobs must be null or integer >= 0")
            if "output_retention" in cron:
                or_ = cron["output_retention"]
                if not isinstance(or_, int) or isinstance(or_, bool):
                    err("cron.output_retention must be an integer")

    if "_config_version" in instance:
        cv = instance["_config_version"]
        if not isinstance(cv, int) or isinstance(cv, bool) or cv < 1:
            err("_config_version must be integer >= 1")

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


def negative_cases() -> list[tuple[str, dict]]:
    """Invalid instances that must be rejected."""
    return [
        (
            "model_is_number",
            {"model": 42, "skills": {}, "cron": {}},
        ),
        (
            "skills_not_object",
            {
                "model": "x",
                "skills": ["not", "an", "object"],
                "cron": {},
            },
        ),
        (
            "cron_not_object",
            {"model": "x", "skills": {}, "cron": "daily"},
        ),
        (
            "providers_not_object",
            {"model": "x", "providers": ["openrouter"], "skills": {}, "cron": {}},
        ),
        (
            "skills_external_dirs_bad",
            {
                "model": "x",
                "skills": {"external_dirs": [1, 2]},
                "cron": {},
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
    schema_path = contract_dir / "config.schema.json"
    examples_dir = contract_dir / "examples"

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

    print("==> Backend runtime config validation (offline)")
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
        for field in ("model", "providers", "skills", "cron"):
            if field not in props:
                fail(f"schema.properties must include '{field}'")
        if "x-lanyard-secret-policy" not in schema:
            fail("schema missing x-lanyard-secret-policy (examples must exclude secrets)")
        if failed == 0:
            pass_(
                "schema loadable; properties include model/providers/skills/cron; "
                "secret policy present"
            )

    try:
        import jsonschema  # type: ignore  # noqa: F401

        engine = "jsonschema"
    except ImportError:
        engine = "stdlib-subset"

    print(f"    validator engine: {engine}")
    print()

    if not examples_dir.is_dir():
        fail(f"missing examples directory: {examples_dir.relative_to(root)}")
    else:
        # Prefer JSON fixtures for offline stdlib; also validate YAML when present.
        json_examples = sorted(examples_dir.glob("*.config.json"))
        yaml_examples = sorted(examples_dir.glob("*.config.yaml")) + sorted(
            examples_dir.glob("*.config.yml")
        )

        if not json_examples and not yaml_examples:
            fail("no *.config.json / *.config.yaml examples found")

        # Coverage: at least one hermes-lanyard and one minimal example
        names = {p.name for p in json_examples + yaml_examples}
        if not any("hermes-lanyard" in n for n in names):
            fail("examples missing hermes-lanyard config fixture")
        if not any("minimal" in n for n in names):
            fail("examples missing minimal config fixture")

        has_model = False
        has_skills = False
        has_cron = False

        for ex in json_examples:
            rel = ex.relative_to(root)
            try:
                data = load_config_file(ex)
            except (OSError, json.JSONDecodeError, RuntimeError, ValueError) as e:
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

            secrets = find_secret_keys(data)
            if secrets:
                for s in secrets:
                    fail(f"{rel}: secret-shaped key in committed example: {s}")
            else:
                pass_(f"{rel}: no secret-shaped keys")

            if "model" in data:
                has_model = True
            if "skills" in data:
                has_skills = True
            if "cron" in data:
                has_cron = True

        # YAML examples when PyYAML available
        try:
            import yaml  # type: ignore  # noqa: F401

            yaml_ok = True
        except ImportError:
            yaml_ok = False
            if yaml_examples:
                pass_(
                    f"skip {len(yaml_examples)} YAML example(s) "
                    "(PyYAML not installed; JSON fixtures cover schema)"
                )

        if yaml_ok:
            for ex in yaml_examples:
                rel = ex.relative_to(root)
                try:
                    data = load_config_file(ex)
                except (OSError, RuntimeError, ValueError) as e:
                    fail(f"{rel}: cannot parse: {e}")
                    continue
                if data is None:
                    fail(f"{rel}: YAML parsed to null/empty")
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

                secrets = find_secret_keys(data)
                if secrets:
                    for s in secrets:
                        fail(f"{rel}: secret-shaped key in committed example: {s}")
                else:
                    pass_(f"{rel}: no secret-shaped keys")

                if "model" in data:
                    has_model = True
                if "skills" in data:
                    has_skills = True
                if "cron" in data:
                    has_cron = True

        if not has_model:
            fail("examples do not represent model/provider settings")
        else:
            pass_("examples represent model/provider settings")
        if not has_skills:
            fail("examples do not represent skills settings")
        else:
            pass_("examples represent skills settings")
        if not has_cron:
            fail("examples do not represent cron settings")
        else:
            pass_("examples represent cron settings")

        # String-form model must validate (Hermes DEFAULT_CONFIG shape)
        string_model = {
            "model": "anthropic/claude-sonnet-4.6",
            "providers": {},
            "skills": {"external_dirs": []},
            "cron": {"provider": ""},
        }
        errors = validate_instance(schema, string_model)
        if errors:
            for e in errors:
                fail(f"string-model fixture: {e}")
        else:
            pass_("string-form model validates (Hermes bare id)")

    print()
    print("  negative cases (must reject)")
    for name, instance in negative_cases():
        errors = validate_instance(schema, instance)
        if not errors:
            fail(f"{name}: expected validation errors, got none")
        else:
            pass_(f"{name}: rejected ({len(errors)} error(s))")

    # Secret scan must flag a synthetic bad example
    bad_secret = {
        "model": {"default": "x", "api_key": "sk-live-should-not-commit"},
        "skills": {},
        "cron": {},
    }
    secret_hits = find_secret_keys(bad_secret)
    if not secret_hits:
        fail("secret scanner failed to detect model.api_key")
    else:
        pass_(f"secret scanner detects forbidden keys ({secret_hits[0]})")

    print()
    if failed:
        print(f"FAILED  {failed} failure(s), {passed} pass(es).")
        return 1
    print(f"OK  {passed} check(s) passed (offline, no network).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
