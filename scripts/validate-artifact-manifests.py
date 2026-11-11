#!/usr/bin/env python3
"""Offline validation for backend artifact manifests (backend-runtime-v1).

Validates:
  - contracts/backend-runtime-v1/artifact-manifest.schema.json is loadable JSON Schema
  - every *.manifest.json under contracts/backend-runtime-v1/examples/ conforms
  - negative fixtures (missing kind/version/entrypoint) are rejected

Uses jsonschema when installed; otherwise a stdlib subset checker that enforces
the required fields and enums for this contract. No network calls.

Usage (from repository root):
  python3 scripts/validate-artifact-manifests.py
  python3 scripts/validate-artifact-manifests.py --root /path/to/repo

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

KINDS = frozenset({"hermes_upstream", "hermes_lanyard", "lanyard_agent"})
REQUIRED_TOP = (
    "schema_version",
    "kind",
    "version",
    "entrypoint",
    "contract",
    "capabilities",
    "provenance",
)
REQUIRED_CONTRACT = ("runtime_layout", "relay", "brain_rpc")
REQUIRED_CAPABILITIES = ("profiles", "brain_rpc_methods")
RPC_METHOD_RE = re.compile(r"^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$")
GIT_SHA_RE = re.compile(r"^[0-9a-fA-F]{7,64}$")


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def stdlib_validate(instance: Any, path: str = "$") -> list[str]:
    """Subset validator matching artifact-manifest.schema.json required rules."""
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

    if "kind" in instance:
        if not isinstance(instance["kind"], str) or instance["kind"] not in KINDS:
            err(
                f"kind must be one of {sorted(KINDS)}, got {instance.get('kind')!r}"
            )

    if "version" in instance:
        if not isinstance(instance["version"], str) or not instance["version"]:
            err("version must be a non-empty string")

    if "entrypoint" in instance:
        if not isinstance(instance["entrypoint"], str) or not instance["entrypoint"]:
            err("entrypoint must be a non-empty string")

    contract = instance.get("contract")
    if "contract" in instance:
        if not isinstance(contract, dict):
            err("contract must be an object")
        else:
            for ck in REQUIRED_CONTRACT:
                if ck not in contract:
                    err(f"contract missing required property '{ck}'")
                else:
                    val = contract[ck]
                    if not isinstance(val, int) or isinstance(val, bool) or val < 1:
                        err(f"contract.{ck} must be an integer >= 1, got {val!r}")

    caps = instance.get("capabilities")
    if "capabilities" in instance:
        if not isinstance(caps, dict):
            err("capabilities must be an object")
        else:
            for ck in REQUIRED_CAPABILITIES:
                if ck not in caps:
                    err(f"capabilities missing required property '{ck}'")
            profiles = caps.get("profiles")
            if "profiles" in caps:
                if (
                    not isinstance(profiles, list)
                    or len(profiles) < 1
                    or not all(isinstance(p, str) and p for p in profiles)
                ):
                    err("capabilities.profiles must be a non-empty array of strings")
            methods = caps.get("brain_rpc_methods")
            if "brain_rpc_methods" in caps:
                if (
                    not isinstance(methods, list)
                    or len(methods) < 1
                    or not all(isinstance(m, str) and m for m in methods)
                ):
                    err(
                        "capabilities.brain_rpc_methods must be a non-empty "
                        "array of strings"
                    )
                elif isinstance(methods, list):
                    for m in methods:
                        if isinstance(m, str) and not RPC_METHOD_RE.match(m):
                            err(
                                f"capabilities.brain_rpc_methods entry "
                                f"{m!r} must look like namespace.method"
                            )
            features = caps.get("features")
            if features is not None:
                if not isinstance(features, dict) or not all(
                    isinstance(v, bool) for v in features.values()
                ):
                    err("capabilities.features must be an object of booleans")

    prov = instance.get("provenance")
    if "provenance" in instance:
        if not isinstance(prov, dict):
            err("provenance must be an object")
        else:
            if "source_repo" not in prov:
                err("provenance missing required property 'source_repo'")
            elif not isinstance(prov["source_repo"], str) or not prov["source_repo"]:
                err("provenance.source_repo must be a non-empty string")
            has_sha = "git_sha" in prov
            has_tag = "release_tag" in prov
            if not has_sha and not has_tag:
                err("provenance requires at least one of git_sha or release_tag")
            if has_sha:
                sha = prov["git_sha"]
                if not isinstance(sha, str) or not GIT_SHA_RE.match(sha):
                    err(
                        "provenance.git_sha must be a hex string of length 7–64"
                    )
            if has_tag:
                tag = prov["release_tag"]
                if not isinstance(tag, str) or not tag:
                    err("provenance.release_tag must be a non-empty string")

    return errors


def jsonschema_validate(schema: dict, instance: Any) -> list[str]:
    try:
        import jsonschema  # type: ignore
    except ImportError:
        return []

    validator_cls = jsonschema.validators.validator_for(schema)
    validator_cls.check_schema(schema)
    validator = validator_cls(schema)
    return [
        f"{'/'.join(str(p) for p in e.absolute_path) or '$'}: {e.message}"
        for e in validator.iter_errors(instance)
    ]


def validate_instance(
    schema: dict, instance: Any, *, prefer_jsonschema: bool
) -> list[str]:
    if prefer_jsonschema:
        js_errors = jsonschema_validate(schema, instance)
        if js_errors is not None and (
            # empty list means success when jsonschema is available
            True
        ):
            # Distinguish "jsonschema missing" (returns []) from success:
            # try import again
            try:
                import jsonschema  # type: ignore  # noqa: F401

                return js_errors
            except ImportError:
                pass
    return stdlib_validate(instance)


def negative_cases(base: dict) -> list[tuple[str, dict]]:
    """Build invalid instances that must be rejected."""
    cases: list[tuple[str, dict]] = []
    for field in ("kind", "version", "entrypoint"):
        bad = copy.deepcopy(base)
        del bad[field]
        cases.append((f"missing_{field}", bad))

    bad_kind = copy.deepcopy(base)
    bad_kind["kind"] = "not_a_backend"
    cases.append(("invalid_kind", bad_kind))

    bad_prov = copy.deepcopy(base)
    bad_prov["provenance"] = {"source_repo": "https://example.com/repo"}
    cases.append(("provenance_without_sha_or_tag", bad_prov))

    return cases


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
    schema_path = contract_dir / "artifact-manifest.schema.json"
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

    print("==> Backend artifact manifest validation (offline)")
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
        for field in ("kind", "version", "entrypoint"):
            if field not in required:
                fail(f"schema.required must include '{field}'")
        kinds = (schema.get("properties") or {}).get("kind", {}).get("enum")
        if not kinds or set(kinds) != set(KINDS):
            fail(f"schema kind.enum must be {sorted(KINDS)}, got {kinds!r}")
        if failed == 0:
            pass_(
                f"schema loadable; required includes kind/version/entrypoint; "
                f"kinds={sorted(KINDS)}"
            )

    try:
        import jsonschema  # type: ignore  # noqa: F401

        use_js = True
        engine = "jsonschema"
    except ImportError:
        use_js = False
        engine = "stdlib-subset"

    print(f"    validator engine: {engine}")
    print()

    if not examples_dir.is_dir():
        fail(f"missing examples directory: {examples_dir.relative_to(root)}")
    else:
        examples = sorted(examples_dir.glob("*.manifest.json"))
        if not examples:
            fail("no *.manifest.json examples found")
        seen_kinds: set[str] = set()
        for ex in examples:
            rel = ex.relative_to(root)
            try:
                data = load_json(ex)
            except (OSError, json.JSONDecodeError) as e:
                fail(f"{rel}: cannot parse JSON: {e}")
                continue
            errors = validate_instance(schema, data, prefer_jsonschema=use_js)
            if errors:
                for e in errors:
                    fail(f"{rel}: {e}")
            else:
                kind = data.get("kind")
                if isinstance(kind, str):
                    seen_kinds.add(kind)
                pass_(f"{rel} validates (kind={kind})")

        missing = KINDS - seen_kinds
        if missing:
            fail(f"examples missing kinds: {sorted(missing)}")
        elif examples:
            pass_(f"examples cover all kinds: {sorted(seen_kinds)}")

    # Negative tests: schema must reject missing kind/version/entrypoint
    print()
    print("  negative cases (must reject)")
    base_path = examples_dir / "hermes-lanyard.manifest.json"
    if base_path.is_file():
        base = load_json(base_path)
        for name, instance in negative_cases(base):
            errors = validate_instance(schema, instance, prefer_jsonschema=use_js)
            if not errors:
                fail(f"{name}: expected validation errors, got none")
            else:
                pass_(f"{name}: rejected ({len(errors)} error(s))")
    else:
        fail("cannot run negative cases: hermes-lanyard example missing")

    print()
    if failed:
        print(f"FAILED  {failed} failure(s), {passed} pass(es).")
        return 1
    print(f"OK  {passed} check(s) passed (offline, no network).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
