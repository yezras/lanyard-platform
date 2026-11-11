#!/usr/bin/env python3
"""Offline validation for connectors v1 catalog (lp-xhf4.1 / lp-hdzm.4).

catalog.json is schema + first-class action classes/command map, not the live
connector list (that is CP canonical_connectors).

Validates:
  - contracts/connectors-v1/catalog.schema.json is loadable
  - catalog.json conforms (first-class enums, command_map covers every action_class)
  - unmapped_gate is every_call
  - free-text names (outlook, slack) stay out of the catalog
  - duplicate command_map argv prefixes reject

Uses jsonschema when installed; otherwise a stdlib subset checker. No network.

Usage (from repository root):
  python3 scripts/validate-connectors-catalog.py
  python3 scripts/validate-connectors-catalog.py --root /path/to/repo

Exit 0 on success; non-zero on failure.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

CONNECTOR_IDS = ("google", "hubspot", "whatsapp", "github")
CONNECTOR_RUNTIMES = ("api", "cli", "mcp", "skill")
CONNECTOR_PRINCIPALS = ("user", "tenant")
CONNECTOR_AUTH_KINDS = ("oauth", "cli_qr", "cli_token")
ACTION_CLASSES = (
    "gmail.read",
    "gmail.draft",
    "gmail.send",
    "calendar.read",
    "calendar.write",
    "drive.read",
    "drive.write",
    "hubspot.read",
    "hubspot.write",
    "whatsapp.read",
    "whatsapp.send",
    "github.read",
    "github.write",
)
ACTION_GATES = ("sticky", "every_call")
REQUIRED_TOP = (
    "schema_version",
    "connector_ids",
    "connector_runtimes",
    "connector_principals",
    "connector_auth_kinds",
    "action_classes",
    "action_gates",
    "unmapped_gate",
    "action_class_gates",
    "connectors",
    "command_map",
)
ILLEGAL_CONNECTOR_IDS = ("outlook", "slack", "google_workspace")


def fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)


def ok(msg: str) -> None:
    print(f"  ok: {msg}")


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def expect_enum_list(value: Any, expected: tuple[str, ...], name: str) -> list[str]:
    errors: list[str] = []
    if not isinstance(value, list):
        return [f"{name} must be array"]
    if list(value) != list(expected):
        errors.append(f"{name} must be {list(expected)}, got {value}")
    return errors


def validate_catalog(payload: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(payload, dict):
        return ["root must be object"]

    extra = set(payload) - set(REQUIRED_TOP)
    if extra:
        errors.append(f"unknown properties: {sorted(extra)}")
    for req in REQUIRED_TOP:
        if req not in payload:
            errors.append(f"missing required '{req}'")

    if payload.get("schema_version") != 1:
        errors.append("schema_version must be 1")

    errors.extend(expect_enum_list(payload.get("connector_ids"), CONNECTOR_IDS, "connector_ids"))
    errors.extend(
        expect_enum_list(payload.get("connector_runtimes"), CONNECTOR_RUNTIMES, "connector_runtimes")
    )
    errors.extend(
        expect_enum_list(
            payload.get("connector_principals"), CONNECTOR_PRINCIPALS, "connector_principals"
        )
    )
    errors.extend(
        expect_enum_list(
            payload.get("connector_auth_kinds"), CONNECTOR_AUTH_KINDS, "connector_auth_kinds"
        )
    )
    errors.extend(
        expect_enum_list(payload.get("action_classes"), ACTION_CLASSES, "action_classes")
    )
    errors.extend(expect_enum_list(payload.get("action_gates"), ACTION_GATES, "action_gates"))

    if payload.get("unmapped_gate") != "every_call":
        errors.append("unmapped_gate must be every_call")

    gates = payload.get("action_class_gates")
    if not isinstance(gates, dict):
        errors.append("action_class_gates must be object")
    else:
        extra_gates = set(gates) - set(ACTION_CLASSES)
        missing_gates = set(ACTION_CLASSES) - set(gates)
        if extra_gates:
            errors.append(f"action_class_gates extra keys: {sorted(extra_gates)}")
        if missing_gates:
            errors.append(f"action_class_gates missing keys: {sorted(missing_gates)}")
        for key, gate in gates.items():
            if gate not in ACTION_GATES:
                errors.append(f"action_class_gates[{key}] invalid gate {gate!r}")

    connectors = payload.get("connectors")
    if not isinstance(connectors, list) or not connectors:
        errors.append("connectors must be non-empty array")
    else:
        seen_ids: set[str] = set()
        for i, row in enumerate(connectors):
            path = f"connectors[{i}]"
            if not isinstance(row, dict):
                errors.append(f"{path} must be object")
                continue
            extra_row = set(row) - {"id", "principal", "auth_kind", "runtimes"}
            if extra_row:
                errors.append(f"{path} unknown properties: {sorted(extra_row)}")
            cid = row.get("id")
            if cid not in CONNECTOR_IDS:
                errors.append(f"{path}.id illegal connector name {cid!r}")
            if isinstance(cid, str):
                if cid in seen_ids:
                    errors.append(f"{path}.id duplicate {cid!r}")
                seen_ids.add(cid)
            if row.get("principal") not in CONNECTOR_PRINCIPALS:
                errors.append(f"{path}.principal invalid")
            if row.get("auth_kind") not in CONNECTOR_AUTH_KINDS:
                errors.append(f"{path}.auth_kind invalid")
            runtimes = row.get("runtimes")
            if not isinstance(runtimes, list) or not runtimes:
                errors.append(f"{path}.runtimes must be non-empty array")
            elif any(rt not in CONNECTOR_RUNTIMES for rt in runtimes):
                errors.append(f"{path}.runtimes contains illegal runtime")

    command_map = payload.get("command_map")
    if not isinstance(command_map, list) or not command_map:
        errors.append("command_map must be non-empty array")
        return errors

    seen_argv: set[tuple[str, ...]] = set()
    covered: set[str] = set()
    for i, entry in enumerate(command_map):
        path = f"command_map[{i}]"
        if not isinstance(entry, dict):
            errors.append(f"{path} must be object")
            continue
        extra_entry = set(entry) - {"argv", "action_class"}
        if extra_entry:
            errors.append(f"{path} unknown properties: {sorted(extra_entry)}")
        argv = entry.get("argv")
        action_class = entry.get("action_class")
        if not isinstance(argv, list) or not argv or any(
            not isinstance(t, str) or not t for t in argv
        ):
            errors.append(f"{path}.argv must be non-empty string array")
            continue
        key = tuple(argv)
        if key in seen_argv:
            errors.append(f"{path} duplicate argv {list(argv)}")
        seen_argv.add(key)
        if action_class not in ACTION_CLASSES:
            errors.append(f"{path}.action_class illegal {action_class!r}")
        else:
            covered.add(action_class)

    missing_classes = set(ACTION_CLASSES) - covered
    if missing_classes:
        errors.append(f"command_map missing action_class coverage: {sorted(missing_classes)}")

    return errors


def try_jsonschema(schema: Any, instance: Any) -> list[str]:
    try:
        import jsonschema  # type: ignore
    except ImportError:
        return []
    try:
        jsonschema.validate(instance, schema)
    except Exception as exc:  # noqa: BLE001 — surface validator output
        return [f"jsonschema: {exc}"]
    return []


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=None)
    args = parser.parse_args()
    root = (args.root or Path.cwd()).resolve()
    contract_dir = root / "contracts" / "connectors-v1"
    schema_path = contract_dir / "catalog.schema.json"
    catalog_path = contract_dir / "catalog.json"

    failed = 0
    for path in (schema_path, catalog_path):
        if not path.is_file():
            fail(f"missing {path.relative_to(root)}")
            failed += 1
    if failed:
        return 1

    try:
        schema = load_json(schema_path)
        catalog = load_json(catalog_path)
    except json.JSONDecodeError as exc:
        fail(f"JSON parse error: {exc}")
        return 1

    if schema.get("$id") != "https://lanyard.platform/contracts/connectors-v1/catalog.schema.json":
        fail("schema $id mismatch")
        failed += 1
    else:
        ok("schema $id")

    defs = schema.get("$defs") or {}
    for name, expected in (
        ("connectorId", CONNECTOR_IDS),
        ("connectorRuntime", CONNECTOR_RUNTIMES),
        ("connectorPrincipal", CONNECTOR_PRINCIPALS),
        ("connectorAuthKind", CONNECTOR_AUTH_KINDS),
        ("actionClass", ACTION_CLASSES),
        ("actionGate", ACTION_GATES),
    ):
        got = tuple((defs.get(name) or {}).get("enum") or ())
        if got != expected:
            fail(f"schema $defs.{name}.enum mismatch: {got}")
            failed += 1
        else:
            ok(f"schema $defs.{name}")

    errors = validate_catalog(catalog)
    errors.extend(try_jsonschema(schema, catalog))
    if errors:
        for err in errors:
            fail(err)
            failed += 1
    else:
        ok(f"catalog.json ({len(catalog['command_map'])} command_map entries)")

    illegal = dict(catalog)
    illegal_ids = list(catalog.get("connector_ids") or []) + ["outlook"]
    illegal["connector_ids"] = illegal_ids
    illegal_errors = validate_catalog(illegal)
    if not illegal_errors:
        fail("expected outlook connector_id to reject")
        failed += 1
    else:
        ok("free-text connector id outlook rejected")

    if try_jsonschema(schema, {"schema_version": 1, "connector_ids": ["outlook"]}):
        ok("jsonschema rejects incomplete/outlook catalog")
    # jsonschema optional; stdlib already rejected outlook above.

    if failed:
        return 1
    print("OK  connectors v1 catalog")
    return 0


if __name__ == "__main__":
    sys.exit(main())
