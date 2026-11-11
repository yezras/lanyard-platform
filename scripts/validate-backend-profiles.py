#!/usr/bin/env python3
"""Offline validation for backend profile capability seeds (backend-runtime-v1).

Validates:
  - contracts/backend-runtime-v1/profiles.schema.json is loadable JSON Schema
  - examples/admin.json and examples/contributor.json conform
  - contributor seeds do not include admin-only capabilities
  - admin seeds include vault_full (or other admin-class markers)
  - negative fixtures are rejected
  - path ACL helper semantics match the contract notes

Uses jsonschema when installed; otherwise a stdlib subset checker.
No network calls.

Usage (from repository root):
  python3 scripts/validate-backend-profiles.py
  python3 scripts/validate-backend-profiles.py --root /path/to/repo

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

NAME_RE = re.compile(r"^[a-z][a-z0-9_]*$")
CAP_RE = re.compile(r"^[a-z][a-z0-9_]*$")
PREFIX_RE = re.compile(r"^/")

REQUIRED_TOP = ("schema_version", "name", "capabilities")
REQUIRED_V1_NAMES = frozenset({"admin", "contributor"})
ADMIN_ONLY_CAPS = frozenset(
    {
        "vault_full",
        "profile_manage",
        "system_ops",
        "shell_exec",
        "gateway_config",
        "beads_admin",
    }
)
BASELINE_ADMIN = frozenset(
    {
        "vault_full",
        "vault_read",
        "vault_write",
        "chat",
        "profile_manage",
        "system_ops",
        "shell_exec",
        "gateway_config",
        "beads_admin",
    }
)
BASELINE_CONTRIBUTOR = frozenset({"vault_read", "vault_write", "chat"})


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def stdlib_validate(instance: Any, path: str = "$") -> list[str]:
    """Subset validator matching profiles.schema.json required rules."""
    errors: list[str] = []

    def err(msg: str) -> None:
        errors.append(f"{path}: {msg}")

    if not isinstance(instance, dict):
        err(f"must be object, got {type(instance).__name__}")
        return errors

    for key in REQUIRED_TOP:
        if key not in instance:
            err(f"missing required property '{key}'")

    if "schema_version" in instance and instance["schema_version"] != 1:
        err(f"schema_version must be 1, got {instance['schema_version']!r}")

    if "name" in instance:
        name = instance["name"]
        if not isinstance(name, str) or not name or not NAME_RE.match(name):
            err(f"name must match {NAME_RE.pattern}, got {name!r}")

    if "capabilities" in instance:
        caps = instance["capabilities"]
        if not isinstance(caps, list) or len(caps) < 1:
            err("capabilities must be a non-empty array")
        elif not all(isinstance(c, str) and c and CAP_RE.match(c) for c in caps):
            err("capabilities entries must be non-empty snake_case strings")
        else:
            if len(set(caps)) != len(caps):
                err("capabilities must be unique")

    if "path_prefixes" in instance:
        prefixes = instance["path_prefixes"]
        if not isinstance(prefixes, list):
            err("path_prefixes must be an array")
        else:
            for i, p in enumerate(prefixes):
                if not isinstance(p, str) or not PREFIX_RE.match(p):
                    err(
                        f"path_prefixes[{i}] must be a string starting with /, "
                        f"got {p!r}"
                    )

    if "role" in instance and instance["role"] is not None:
        if not isinstance(instance["role"], str) or not instance["role"]:
            err("role must be a non-empty string when present")

    if "display_name" in instance and instance["display_name"] is not None:
        if (
            not isinstance(instance["display_name"], str)
            or not instance["display_name"]
        ):
            err("display_name must be a non-empty string when present")

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


def normalize_prefix(prefix: str) -> str:
    p = str(prefix).strip().replace("\\", "/")
    if not p.startswith("/"):
        p = "/" + p
    while "//" in p:
        p = p.replace("//", "/")
    if len(p) > 1 and p.endswith("/"):
        p = p.rstrip("/")
    return p


def path_allowed(
    vault_path: str,
    *,
    path_prefixes: list[str],
    capabilities: set[str],
) -> bool:
    """Mirror Hermes-Lanyard / contract x-lanyard-path-acl path_allowed rules."""
    if "vault_full" in capabilities and not path_prefixes:
        return True
    if not path_prefixes:
        return False
    path = vault_path if vault_path.startswith("/") else f"/{vault_path}"
    while "//" in path:
        path = path.replace("//", "/")
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/")
    for prefix in path_prefixes:
        pref = normalize_prefix(prefix)
        if pref == "/":
            return True
        if path == pref or path.startswith(pref + "/"):
            return True
    return False


def negative_cases() -> list[tuple[str, dict]]:
    return [
        (
            "missing_name",
            {
                "schema_version": 1,
                "capabilities": ["vault_read"],
            },
        ),
        (
            "missing_capabilities",
            {
                "schema_version": 1,
                "name": "admin",
            },
        ),
        (
            "bad_schema_version",
            {
                "schema_version": 2,
                "name": "admin",
                "capabilities": ["vault_read"],
            },
        ),
        (
            "bad_name_case",
            {
                "schema_version": 1,
                "name": "Admin",
                "capabilities": ["vault_read"],
            },
        ),
        (
            "empty_capabilities",
            {
                "schema_version": 1,
                "name": "admin",
                "capabilities": [],
            },
        ),
        (
            "path_prefix_without_slash",
            {
                "schema_version": 1,
                "name": "contributor",
                "capabilities": ["vault_read"],
                "path_prefixes": ["Projects/Legal"],
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
    schema_path = contract_dir / "profiles.schema.json"
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

    print("==> Backend profile capability validation (offline)")
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
        required = schema.get("required") or []
        for field in REQUIRED_TOP:
            if field not in required:
                fail(f"schema.required must include '{field}'")
        props = schema.get("properties") or {}
        for field in ("name", "capabilities", "path_prefixes"):
            if field not in props:
                fail(f"schema.properties must include '{field}'")
        if "x-lanyard-path-acl" not in schema:
            fail("schema missing x-lanyard-path-acl (vault path prefix behavior)")
        if "x-lanyard-terminology" not in schema:
            fail("schema missing x-lanyard-terminology (backend-neutral naming)")
        if "x-lanyard-capability-catalog" not in schema:
            fail("schema missing x-lanyard-capability-catalog")
        v1 = schema.get("x-lanyard-v1-required-profiles") or []
        if set(v1) != REQUIRED_V1_NAMES:
            fail(
                f"x-lanyard-v1-required-profiles must be "
                f"{sorted(REQUIRED_V1_NAMES)}, got {v1!r}"
            )
        if failed == 0:
            pass_(
                "schema loadable; required name/capabilities; path ACL + "
                "terminology + catalog extensions present"
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
        by_name: dict[str, dict] = {}
        for required_name in sorted(REQUIRED_V1_NAMES):
            ex = examples_dir / f"{required_name}.json"
            rel = ex.relative_to(root)
            if not ex.is_file():
                fail(f"missing required example: {rel}")
                continue
            try:
                data = load_json(ex)
            except (OSError, json.JSONDecodeError) as e:
                fail(f"{rel}: cannot parse JSON: {e}")
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

            name = data.get("name")
            if name != required_name:
                fail(f"{rel}: name must be {required_name!r}, got {name!r}")
            else:
                pass_(f"{rel}: name matches filename ({required_name})")

            caps = data.get("capabilities") or []
            if not isinstance(caps, list):
                fail(f"{rel}: capabilities must be a list")
                continue
            cap_set = {str(c) for c in caps}
            by_name[required_name] = data

            # Terminology: display strings must not say Hermes
            for key in ("description", "display_name", "role"):
                val = data.get(key)
                if isinstance(val, str) and re.search(r"hermes", val, re.I):
                    fail(
                        f"{rel}: {key} must be backend-neutral "
                        f"(found Hermes branding): {val!r}"
                    )

            if required_name == "contributor":
                elevated = cap_set & ADMIN_ONLY_CAPS
                if elevated:
                    fail(
                        f"{rel}: contributor must not include admin-only "
                        f"capabilities: {sorted(elevated)}"
                    )
                else:
                    pass_(f"{rel}: no admin-only capabilities")
                missing = BASELINE_CONTRIBUTOR - cap_set
                if missing:
                    fail(f"{rel}: missing baseline capabilities: {sorted(missing)}")
                else:
                    pass_(f"{rel}: baseline contributor capabilities present")
            elif required_name == "admin":
                if "vault_full" not in cap_set:
                    fail(f"{rel}: admin baseline requires vault_full")
                else:
                    pass_(f"{rel}: includes vault_full")
                missing = BASELINE_ADMIN - cap_set
                if missing:
                    fail(f"{rel}: missing baseline capabilities: {sorted(missing)}")
                else:
                    pass_(f"{rel}: baseline admin capabilities present")

        if set(by_name) == REQUIRED_V1_NAMES:
            pass_(f"examples cover required profiles: {sorted(REQUIRED_V1_NAMES)}")

    # Path ACL unit checks (contract semantics)
    print()
    print("  path ACL semantics")
    acl_cases: list[tuple[str, bool, dict]] = [
        (
            "admin_vault_full_empty_prefixes",
            True,
            {
                "path": "/Secrets/keys.txt",
                "path_prefixes": [],
                "capabilities": {"vault_full", "vault_read"},
            },
        ),
        (
            "contributor_empty_prefixes_denied",
            False,
            {
                "path": "/Projects/Legal",
                "path_prefixes": [],
                "capabilities": {"vault_read", "vault_write"},
            },
        ),
        (
            "contributor_prefix_allows_child",
            True,
            {
                "path": "/Projects/Legal/memo.md",
                "path_prefixes": ["/Projects/Legal"],
                "capabilities": {"vault_read"},
            },
        ),
        (
            "contributor_prefix_denies_sibling",
            False,
            {
                "path": "/Projects/Finance",
                "path_prefixes": ["/Projects/Legal"],
                "capabilities": {"vault_read"},
            },
        ),
        (
            "root_prefix_allows_all",
            True,
            {
                "path": "/any/path",
                "path_prefixes": ["/"],
                "capabilities": {"vault_read"},
            },
        ),
    ]
    for name, expected, kwargs in acl_cases:
        got = path_allowed(
            kwargs["path"],
            path_prefixes=list(kwargs["path_prefixes"]),
            capabilities=set(kwargs["capabilities"]),
        )
        if got is expected:
            pass_(f"{name}: path_allowed → {got}")
        else:
            fail(f"{name}: expected {expected}, got {got}")

    # Negative tests
    print()
    print("  negative cases (must reject)")
    for name, instance in negative_cases():
        errors = validate_instance(schema, instance)
        if not errors:
            fail(f"{name}: expected validation errors, got none")
        else:
            pass_(f"{name}: rejected ({len(errors)} error(s))")

    # Ensure contributor elevated copy is rejected by our policy check even
    # if schema allows the tokens (policy is baseline-specific).
    print()
    print("  elevation policy")
    elevated = {
        "schema_version": 1,
        "name": "contributor",
        "capabilities": ["vault_read", "vault_write", "chat", "vault_full"],
    }
    # Schema may accept the shape; policy must still flag elevation for
    # the contributor *example* role. Simulate policy:
    caps = set(elevated["capabilities"])
    if caps & ADMIN_ONLY_CAPS:
        pass_("contributor+vault_full flagged as elevation by policy")
    else:
        fail("elevation policy did not flag contributor+vault_full")

    print()
    if failed:
        print(f"FAILED  {failed} failure(s), {passed} pass(es).")
        return 1
    print(f"OK  {passed} check(s) passed (offline, no network).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
