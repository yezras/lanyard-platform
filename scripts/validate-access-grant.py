#!/usr/bin/env python3
"""Offline validation for access-grant domain (lp-ye4.9).

Validates:
  - contracts/backend-runtime-v1/access-grant.schema.json is loadable
  - required $defs exist (subject, signature, capability, actor kinds)
  - example fixtures conform (human session, agent, delegated agent)
  - negative payloads reject (expired shape is still schema-valid; structural
    negatives only here — expiry is a BFF runtime check)

Uses jsonschema when installed; otherwise a stdlib subset checker.
No network calls.

Usage (from repository root):
  python3 scripts/validate-access-grant.py
  python3 scripts/validate-access-grant.py --root /path/to/repo

Exit 0 on success; non-zero on failure.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

GRANT_ID_RE = re.compile(r"^grant_[A-Za-z0-9._:-]+$")
VAULT_PATH_RE = re.compile(r"^/")
CAPABILITY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_.*:-]*$")

REQUIRED_DEFS = (
    "grantSubject",
    "grantSignature",
    "grantCapability",
    "actorKind",
    "vaultPath",
    "signatureAlgorithm",
)

REQUIRED_FIELDS = (
    "schema_version",
    "record_type",
    "grant_id",
    "tenant_id",
    "subject",
    "path_prefixes",
    "capabilities",
    "issued_at",
    "expires_at",
    "signature",
)

ALLOWED_FIELDS = frozenset(
    {
        *REQUIRED_FIELDS,
        "instance_id",
        "session_id",
        "not_before",
        "issuer",
        "backend_profile",
        "meta",
    }
)

ACTOR_KINDS = frozenset({"human", "agent", "system", "delegated_agent"})
SIG_ALGS = frozenset({"ed25519", "hmac-sha256", "none"})

EXAMPLES = (
    "access-grant.human-session.json",
    "access-grant.agent.json",
    "access-grant.delegated-agent.json",
)


def fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)


def ok(msg: str) -> None:
    print(f"  ok: {msg}")


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def validate_grant(payload: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(payload, dict):
        return ["root must be object"]

    for k in payload:
        if k not in ALLOWED_FIELDS:
            errors.append(f"unknown property '{k}'")

    for req in REQUIRED_FIELDS:
        if req not in payload:
            errors.append(f"missing required '{req}'")

    if payload.get("schema_version") != 1:
        errors.append("schema_version must be 1")
    if payload.get("record_type") != "access_grant":
        errors.append("record_type must be access_grant")

    gid = payload.get("grant_id")
    if not isinstance(gid, str) or not GRANT_ID_RE.match(gid):
        errors.append("grant_id must match grant_… pattern")

    for key in ("tenant_id", "issued_at", "expires_at"):
        if key in payload and (
            not isinstance(payload[key], str) or not payload[key]
        ):
            errors.append(f"{key} must be non-empty string")

    subject = payload.get("subject")
    if not isinstance(subject, dict):
        errors.append("subject must be object")
    else:
        kind = subject.get("kind")
        if kind not in ACTOR_KINDS:
            errors.append(f"invalid subject.kind {kind!r}")
        if not isinstance(subject.get("subject_id"), str) or not subject.get(
            "subject_id"
        ):
            errors.append("subject.subject_id required")
        allowed_sub = {
            "kind",
            "subject_id",
            "display_name",
            "portal_user_id",
            "agent_id",
            "run_id",
        }
        for k in subject:
            if k not in allowed_sub:
                errors.append(f"subject unknown property '{k}'")

    prefixes = payload.get("path_prefixes")
    if not isinstance(prefixes, list):
        errors.append("path_prefixes must be array")
    else:
        for i, p in enumerate(prefixes):
            if not isinstance(p, str) or not VAULT_PATH_RE.match(p):
                errors.append(f"path_prefixes[{i}] must start with /")

    caps = payload.get("capabilities")
    if not isinstance(caps, list) or len(caps) < 1:
        errors.append("capabilities must be non-empty array")
    else:
        for i, c in enumerate(caps):
            if not isinstance(c, str) or not CAPABILITY_RE.match(c):
                errors.append(f"capabilities[{i}] invalid")

    sig = payload.get("signature")
    if not isinstance(sig, dict):
        errors.append("signature must be object")
    else:
        if sig.get("alg") not in SIG_ALGS:
            errors.append(f"invalid signature.alg {sig.get('alg')!r}")
        for k in ("key_id", "value", "signed_at"):
            if not isinstance(sig.get(k), str) or not sig.get(k):
                errors.append(f"signature.{k} required")
        allowed_sig = {"alg", "key_id", "value", "signed_at", "signed_fields"}
        for k in sig:
            if k not in allowed_sig:
                errors.append(f"signature unknown property '{k}'")

    return errors


def try_jsonschema(schema: dict[str, Any], payload: Any) -> list[str] | None:
    try:
        import jsonschema  # type: ignore
    except ImportError:
        return None
    validator = jsonschema.Draft202012Validator(schema)
    return [
        f"{'/'.join(str(x) for x in e.path) or '$'}: {e.message}"
        for e in validator.iter_errors(payload)
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
    root = (
        args.root.resolve()
        if args.root
        else Path(__file__).resolve().parent.parent
    )
    contract = root / "contracts" / "backend-runtime-v1"
    schema_path = contract / "access-grant.schema.json"
    examples_dir = contract / "examples"

    failed = 0
    print("Access-grant domain validation (lp-ye4.9)")
    print(f"  root: {root}")

    if not schema_path.is_file():
        fail(f"missing schema {schema_path}")
        return 1

    try:
        schema = load_json(schema_path)
    except Exception as exc:  # noqa: BLE001
        fail(f"schema not loadable: {exc}")
        return 1
    ok("schema JSON loadable")

    defs = schema.get("$defs") or {}
    for name in REQUIRED_DEFS:
        if name not in defs:
            fail(f"missing $defs.{name}")
            failed += 1
        else:
            ok(f"$defs.{name}")

    if schema.get("type") != "object":
        fail("schema type must be object")
        failed += 1
    else:
        ok("schema type object")

    # Actor kinds include delegated_agent for unknown-agent identity.
    actor_enum = (defs.get("actorKind") or {}).get("enum") or []
    for kind in ("human", "agent", "system", "delegated_agent"):
        if kind not in actor_enum:
            fail(f"actorKind missing {kind}")
            failed += 1
        else:
            ok(f"actorKind includes {kind}")

    # Signature key_id is required on grantSignature.
    sig_req = (defs.get("grantSignature") or {}).get("required") or []
    if "key_id" not in sig_req:
        fail("grantSignature must require key_id")
        failed += 1
    else:
        ok("grantSignature requires key_id")

    for name in EXAMPLES:
        path = examples_dir / name
        if not path.is_file():
            fail(f"missing example {name}")
            failed += 1
            continue
        try:
            payload = load_json(path)
        except Exception as exc:  # noqa: BLE001
            fail(f"example {name} not loadable: {exc}")
            failed += 1
            continue

        js_errors = try_jsonschema(schema, payload)
        if js_errors is not None:
            if js_errors:
                fail(f"example {name} jsonschema: {js_errors[0]}")
                failed += 1
            else:
                ok(f"example {name} (jsonschema)")
        else:
            errs = validate_grant(payload)
            if errs:
                fail(f"example {name}: {errs[0]}")
                failed += 1
            else:
                ok(f"example {name} (stdlib)")

        # Delegated agent fixture must carry run identity + grant path prefixes.
        if name == "access-grant.delegated-agent.json":
            sub = payload.get("subject") or {}
            if sub.get("kind") != "delegated_agent":
                fail("delegated fixture subject.kind")
                failed += 1
            elif not sub.get("run_id"):
                fail("delegated fixture missing run_id")
                failed += 1
            elif not payload.get("path_prefixes"):
                fail("delegated fixture missing path_prefixes")
                failed += 1
            else:
                ok("delegated fixture identity + path_prefixes")

    negatives: list[tuple[str, dict[str, Any]]] = [
        (
            "bad grant_id",
            {
                "schema_version": 1,
                "record_type": "access_grant",
                "grant_id": "not-valid",
                "tenant_id": "t",
                "subject": {"kind": "agent", "subject_id": "a"},
                "path_prefixes": ["/Projects"],
                "capabilities": ["vault.write"],
                "issued_at": "2026-01-01T00:00:00Z",
                "expires_at": "2026-01-02T00:00:00Z",
                "signature": {
                    "alg": "none",
                    "key_id": "k",
                    "value": "unsigned",
                    "signed_at": "2026-01-01T00:00:00Z",
                },
            },
        ),
        (
            "empty capabilities",
            {
                "schema_version": 1,
                "record_type": "access_grant",
                "grant_id": "grant_emptycaps1",
                "tenant_id": "t",
                "subject": {"kind": "human", "subject_id": "u"},
                "path_prefixes": ["/Projects"],
                "capabilities": [],
                "issued_at": "2026-01-01T00:00:00Z",
                "expires_at": "2026-01-02T00:00:00Z",
                "signature": {
                    "alg": "none",
                    "key_id": "k",
                    "value": "unsigned",
                    "signed_at": "2026-01-01T00:00:00Z",
                },
            },
        ),
        (
            "unknown property bag",
            {
                "schema_version": 1,
                "record_type": "access_grant",
                "grant_id": "grant_loose1",
                "tenant_id": "t",
                "subject": {"kind": "system", "subject_id": "sys"},
                "path_prefixes": ["/"],
                "capabilities": ["vault.read"],
                "issued_at": "2026-01-01T00:00:00Z",
                "expires_at": "2026-01-02T00:00:00Z",
                "signature": {
                    "alg": "none",
                    "key_id": "k",
                    "value": "unsigned",
                    "signed_at": "2026-01-01T00:00:00Z",
                },
                "extra_loose_bag": {"x": 1},
            },
        ),
        (
            "invalid subject kind",
            {
                "schema_version": 1,
                "record_type": "access_grant",
                "grant_id": "grant_badkind1",
                "tenant_id": "t",
                "subject": {"kind": "robot", "subject_id": "r"},
                "path_prefixes": ["/Projects"],
                "capabilities": ["vault.write"],
                "issued_at": "2026-01-01T00:00:00Z",
                "expires_at": "2026-01-02T00:00:00Z",
                "signature": {
                    "alg": "ed25519",
                    "key_id": "k",
                    "value": "abc",
                    "signed_at": "2026-01-01T00:00:00Z",
                },
            },
        ),
    ]

    for label, payload in negatives:
        js_errors = try_jsonschema(schema, payload)
        if js_errors is not None:
            if not js_errors:
                fail(f"negative '{label}' unexpectedly accepted by jsonschema")
                failed += 1
            else:
                ok(f"negative rejected (jsonschema): {label}")
        else:
            errs = validate_grant(payload)
            if not errs:
                fail(f"negative '{label}' unexpectedly accepted")
                failed += 1
            else:
                ok(f"negative rejected: {label}")

    print()
    if failed:
        print(f"FAILED: {failed} check(s)")
        return 1
    print("All access-grant checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
