#!/usr/bin/env python3
"""Offline validation for signed operation ledger domain (lp-ye4.5).

Validates:
  - contracts/backend-runtime-v1/signed-operation.schema.json is loadable
  - required $defs exist (event, actor, target, parents, body hash, result,
    signature, artifact head, workspace head)
  - DocumentRevision shape remains compatible with brain-rpc
  - example fixtures conform (human write, agent checkpoint, conflict,
    workspace tree advance, heads)
  - negative payloads reject

Uses jsonschema when installed; otherwise a stdlib subset checker.
No network calls.

Usage (from repository root):
  python3 scripts/validate-signed-operation.py
  python3 scripts/validate-signed-operation.py --root /path/to/repo

Exit 0 on success; non-zero on failure.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

OPERATION_ID_RE = re.compile(r"^op_[A-Za-z0-9._:-]+$")
SHA256_HEX_RE = re.compile(r"^[a-f0-9]{64}$")
VAULT_PATH_RE = re.compile(r"^/")

REQUIRED_DEFS = (
    "signedOperationEvent",
    "actor",
    "operationTarget",
    "parents",
    "bodyHash",
    "operationResult",
    "operationSignature",
    "artifactHead",
    "workspaceHead",
    "documentRevision",
    "operationKind",
    "actorKind",
)

REQUIRED_EVENT_FIELDS = (
    "schema_version",
    "record_type",
    "operation_id",
    "tenant_id",
    "instance_id",
    "occurred_at",
    "kind",
    "actor",
    "target",
    "parents",
    "result",
    "signature",
)

ALLOWED_EVENT_FIELDS = frozenset(
    {
        *REQUIRED_EVENT_FIELDS,
        "body_hash",
        "idempotency_key",
        "vault_write_mode",
        "advances_artifact_head",
        "advances_workspace_head",
        "meta",
    }
)

ACTOR_KINDS = frozenset({"human", "agent", "system", "delegated_agent"})
OPERATION_KINDS = frozenset(
    {
        "file_create",
        "file_replace",
        "file_checkpoint",
        "file_delete",
        "file_rename",
        "workspace_tree_advance",
        "operation_rejected",
    }
)
RESULT_STATUSES = frozenset({"committed", "rejected"})
RESULT_REASONS = frozenset(
    {
        "ok",
        "revision_mismatch",
        "path_exists",
        "path_missing",
        "human_edit_active",
        "forbidden",
        "invalid_argument",
        "idempotent_replay",
        "other",
    }
)
SIG_ALGS = frozenset({"ed25519", "hmac-sha256", "none"})
REVISION_KINDS = frozenset(
    {"etag", "content_hash", "host_revision", "mtime_size_fallback"}
)
VAULT_WRITE_MODES = frozenset(
    {"create_new", "replace_if_match", "replace_if_absent", "write_checkpoint"}
)
HEAD_KINDS = frozenset({"canonical", "checkpoint"})

EXAMPLE_FILES = (
    "signed-operation.human-write.json",
    "signed-operation.agent-checkpoint.json",
    "signed-operation.conflict.json",
    "signed-operation.workspace-tree-advance.json",
    "artifact-head.canonical.json",
    "artifact-head.checkpoint.json",
    "workspace-head.default.json",
)

# Scenario → expected kind / head advance
SCENARIO_EXPECTATIONS: dict[str, dict[str, Any]] = {
    "signed-operation.human-write.json": {
        "record_type": "signed_operation",
        "kind": "file_replace",
        "actor_kind": "human",
        "vault_write_mode": "replace_if_match",
        "status": "committed",
        "advances_artifact_head": True,
        "advances_workspace_head": True,
    },
    "signed-operation.agent-checkpoint.json": {
        "record_type": "signed_operation",
        "kind": "file_checkpoint",
        "actor_kind": "agent",
        "vault_write_mode": "write_checkpoint",
        "status": "committed",
        "requires_source_path": True,
        "advances_artifact_head": True,
    },
    "signed-operation.conflict.json": {
        "record_type": "signed_operation",
        "kind": "operation_rejected",
        "status": "rejected",
        "reason": "revision_mismatch",
        "advances_artifact_head": False,
        "advances_workspace_head": False,
    },
    "signed-operation.workspace-tree-advance.json": {
        "record_type": "signed_operation",
        "kind": "file_create",
        "vault_write_mode": "create_new",
        "status": "committed",
        "advances_workspace_head": True,
    },
    "artifact-head.canonical.json": {
        "record_type": "artifact_head",
        "head_kind": "canonical",
    },
    "artifact-head.checkpoint.json": {
        "record_type": "artifact_head",
        "head_kind": "checkpoint",
        "requires_source_path": True,
    },
    "workspace-head.default.json": {
        "record_type": "workspace_head",
    },
}


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)


def ok(msg: str) -> None:
    print(f"OK: {msg}")


def validate_revision(rev: Any, path: str, errors: list[str]) -> None:
    if not isinstance(rev, dict):
        errors.append(f"{path}: must be object")
        return
    for key in ("token", "kind"):
        if key not in rev:
            errors.append(f"{path}: missing required '{key}'")
    token = rev.get("token")
    if token is not None and (not isinstance(token, str) or not token):
        errors.append(f"{path}.token: must be non-empty string")
    kind = rev.get("kind")
    if kind is not None and kind not in REVISION_KINDS:
        errors.append(f"{path}.kind: invalid {kind!r}")
    unknown = set(rev.keys()) - {"token", "kind", "size_bytes", "modified_at"}
    if unknown:
        errors.append(f"{path}: unknown properties {sorted(unknown)}")


def validate_actor(actor: Any, path: str, errors: list[str]) -> None:
    if not isinstance(actor, dict):
        errors.append(f"{path}: must be object")
        return
    for key in ("kind", "subject_id"):
        if key not in actor:
            errors.append(f"{path}: missing required '{key}'")
    kind = actor.get("kind")
    if kind is not None and kind not in ACTOR_KINDS:
        errors.append(f"{path}.kind: invalid {kind!r}")
    allowed = {
        "kind",
        "subject_id",
        "display_name",
        "portal_user_id",
        "agent_id",
        "run_id",
        "session_id",
        "backend_profile",
        "grant_id",
    }
    unknown = set(actor.keys()) - allowed
    if unknown:
        errors.append(f"{path}: unknown properties {sorted(unknown)}")


def validate_target(target: Any, path: str, errors: list[str]) -> None:
    if not isinstance(target, dict):
        errors.append(f"{path}: must be object")
        return
    for key in ("scope", "path"):
        if key not in target:
            errors.append(f"{path}: missing required '{key}'")
    p = target.get("path")
    if isinstance(p, str) and not VAULT_PATH_RE.match(p):
        errors.append(f"{path}.path: must start with /")
    sp = target.get("source_path")
    if sp is not None:
        if not isinstance(sp, str) or not VAULT_PATH_RE.match(sp):
            errors.append(f"{path}.source_path: must be vault path")
    allowed = {"scope", "path", "source_path", "workspace_id"}
    unknown = set(target.keys()) - allowed
    if unknown:
        errors.append(f"{path}: unknown properties {sorted(unknown)}")


def validate_body_hash(bh: Any, path: str, errors: list[str]) -> None:
    if not isinstance(bh, dict):
        errors.append(f"{path}: must be object")
        return
    if bh.get("alg") != "sha256":
        errors.append(f"{path}.alg: must be sha256")
    hexv = bh.get("hex")
    if not isinstance(hexv, str) or not SHA256_HEX_RE.match(hexv):
        errors.append(f"{path}.hex: must be 64 lowercase hex chars")


def validate_result(result: Any, path: str, errors: list[str]) -> None:
    if not isinstance(result, dict):
        errors.append(f"{path}: must be object")
        return
    for key in ("status", "reason"):
        if key not in result:
            errors.append(f"{path}: missing required '{key}'")
    status = result.get("status")
    if status is not None and status not in RESULT_STATUSES:
        errors.append(f"{path}.status: invalid {status!r}")
    reason = result.get("reason")
    if reason is not None and reason not in RESULT_REASONS:
        errors.append(f"{path}.reason: invalid {reason!r}")
    for rev_key in ("revision", "prior_revision", "actual_revision"):
        if rev_key in result and result[rev_key] is not None:
            validate_revision(result[rev_key], f"{path}.{rev_key}", errors)


def validate_signature(sig: Any, path: str, errors: list[str]) -> None:
    if not isinstance(sig, dict):
        errors.append(f"{path}: must be object")
        return
    for key in ("alg", "key_id", "value", "signed_at"):
        if key not in sig:
            errors.append(f"{path}: missing required '{key}'")
    alg = sig.get("alg")
    if alg is not None and alg not in SIG_ALGS:
        errors.append(f"{path}.alg: invalid {alg!r}")


def validate_signed_operation(data: Any, path: str = "$") -> list[str]:
    errors: list[str] = []
    if not isinstance(data, dict):
        return [f"{path}: must be object"]

    for key in REQUIRED_EVENT_FIELDS:
        if key not in data:
            errors.append(f"{path}: missing required '{key}'")

    unknown = set(data.keys()) - ALLOWED_EVENT_FIELDS
    if unknown:
        errors.append(f"{path}: unknown properties {sorted(unknown)}")

    if data.get("schema_version") != 1:
        errors.append(f"{path}.schema_version: must be 1")
    if data.get("record_type") != "signed_operation":
        errors.append(f"{path}.record_type: must be signed_operation")

    op_id = data.get("operation_id")
    if isinstance(op_id, str) and not OPERATION_ID_RE.match(op_id):
        errors.append(f"{path}.operation_id: must match op_… pattern")

    kind = data.get("kind")
    if kind is not None and kind not in OPERATION_KINDS:
        errors.append(f"{path}.kind: invalid {kind!r}")

    parents = data.get("parents")
    if parents is not None:
        if not isinstance(parents, list):
            errors.append(f"{path}.parents: must be array")
        else:
            for i, p in enumerate(parents):
                if not isinstance(p, str) or not OPERATION_ID_RE.match(p):
                    errors.append(f"{path}.parents[{i}]: invalid operation_id")

    if "actor" in data:
        validate_actor(data["actor"], f"{path}.actor", errors)
    if "target" in data:
        validate_target(data["target"], f"{path}.target", errors)
    if "body_hash" in data and data["body_hash"] is not None:
        validate_body_hash(data["body_hash"], f"{path}.body_hash", errors)
    if "result" in data:
        validate_result(data["result"], f"{path}.result", errors)
    if "signature" in data:
        validate_signature(data["signature"], f"{path}.signature", errors)

    mode = data.get("vault_write_mode")
    if mode is not None and mode not in VAULT_WRITE_MODES:
        errors.append(f"{path}.vault_write_mode: invalid {mode!r}")

    result = data.get("result") if isinstance(data.get("result"), dict) else {}
    status = result.get("status")
    if status == "rejected":
        if data.get("advances_artifact_head") is True:
            errors.append(
                f"{path}: rejected op must not set advances_artifact_head=true"
            )
        if data.get("advances_workspace_head") is True:
            errors.append(
                f"{path}: rejected op must not set advances_workspace_head=true"
            )

    if kind == "file_checkpoint":
        target = data.get("target") if isinstance(data.get("target"), dict) else {}
        if not target.get("source_path"):
            errors.append(f"{path}: file_checkpoint requires target.source_path")
        elif target.get("source_path") == target.get("path"):
            errors.append(f"{path}: file_checkpoint source_path must differ from path")

    if (
        status == "committed"
        and kind in ("file_create", "file_replace", "file_checkpoint")
        and "revision" not in result
    ):
        errors.append(f"{path}: committed file write requires result.revision")

    # operation_id must not equal revision.token when both present
    rev = result.get("revision") if isinstance(result.get("revision"), dict) else None
    if rev and isinstance(op_id, str) and rev.get("token") == op_id:
        errors.append(
            f"{path}: operation_id must be separate from DocumentRevision.token"
        )

    return errors


def validate_artifact_head(data: Any, path: str = "$") -> list[str]:
    errors: list[str] = []
    if not isinstance(data, dict):
        return [f"{path}: must be object"]
    required = (
        "schema_version",
        "record_type",
        "tenant_id",
        "path",
        "operation_id",
        "revision",
        "updated_at",
        "head_kind",
    )
    for key in required:
        if key not in data:
            errors.append(f"{path}: missing required '{key}'")
    if data.get("schema_version") != 1:
        errors.append(f"{path}.schema_version: must be 1")
    if data.get("record_type") != "artifact_head":
        errors.append(f"{path}.record_type: must be artifact_head")
    if data.get("head_kind") not in HEAD_KINDS and data.get("head_kind") is not None:
        errors.append(f"{path}.head_kind: invalid")
    p = data.get("path")
    if isinstance(p, str) and not VAULT_PATH_RE.match(p):
        errors.append(f"{path}.path: must start with /")
    op_id = data.get("operation_id")
    if isinstance(op_id, str) and not OPERATION_ID_RE.match(op_id):
        errors.append(f"{path}.operation_id: invalid")
    if "revision" in data:
        validate_revision(data["revision"], f"{path}.revision", errors)
    if data.get("head_kind") == "checkpoint" and not data.get("source_path"):
        errors.append(f"{path}: checkpoint head requires source_path")
    rev = data.get("revision") if isinstance(data.get("revision"), dict) else None
    if rev and isinstance(op_id, str) and rev.get("token") == op_id:
        errors.append(
            f"{path}: operation_id must be separate from DocumentRevision.token"
        )
    return errors


def validate_workspace_head(data: Any, path: str = "$") -> list[str]:
    errors: list[str] = []
    if not isinstance(data, dict):
        return [f"{path}: must be object"]
    required = (
        "schema_version",
        "record_type",
        "tenant_id",
        "workspace_id",
        "tree_root_hash",
        "operation_id",
        "updated_at",
    )
    for key in required:
        if key not in data:
            errors.append(f"{path}: missing required '{key}'")
    if data.get("schema_version") != 1:
        errors.append(f"{path}.schema_version: must be 1")
    if data.get("record_type") != "workspace_head":
        errors.append(f"{path}.record_type: must be workspace_head")
    trh = data.get("tree_root_hash")
    if trh is not None and (
        not isinstance(trh, str) or not SHA256_HEX_RE.match(trh)
    ):
        errors.append(f"{path}.tree_root_hash: must be 64 lowercase hex chars")
    op_id = data.get("operation_id")
    if isinstance(op_id, str) and not OPERATION_ID_RE.match(op_id):
        errors.append(f"{path}.operation_id: invalid")
    return errors


def validate_record(data: Any) -> list[str]:
    if not isinstance(data, dict):
        return ["$: must be object"]
    rt = data.get("record_type")
    if rt == "signed_operation":
        return validate_signed_operation(data)
    if rt == "artifact_head":
        return validate_artifact_head(data)
    if rt == "workspace_head":
        return validate_workspace_head(data)
    return [f"$: unknown record_type {rt!r}"]


def try_jsonschema(schema: dict[str, Any], instance: Any) -> list[str]:
    try:
        import jsonschema  # type: ignore
        from jsonschema import Draft202012Validator  # type: ignore
    except ImportError:
        return []

    validator = Draft202012Validator(schema)
    return [
        f"{'/'.join(str(p) for p in e.absolute_path) or '$'}: {e.message}"
        for e in validator.iter_errors(instance)
    ]


def check_schema_structure(schema: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    defs = schema.get("$defs")
    if not isinstance(defs, dict):
        return ["schema missing $defs"]
    for name in REQUIRED_DEFS:
        if name not in defs:
            errors.append(f"schema $defs missing '{name}'")

    # documentRevision required token+kind (CAS compatibility)
    dr = defs.get("documentRevision")
    if isinstance(dr, dict):
        req = set(dr.get("required") or [])
        if "token" not in req or "kind" not in req:
            errors.append("documentRevision must require token and kind")
        if dr.get("additionalProperties") is not False:
            errors.append("documentRevision must set additionalProperties false")

    event = defs.get("signedOperationEvent")
    if isinstance(event, dict):
        req = set(event.get("required") or [])
        for field in REQUIRED_EVENT_FIELDS:
            if field not in req:
                errors.append(f"signedOperationEvent missing required '{field}'")
        props = event.get("properties") or {}
        for field in (
            "actor",
            "target",
            "parents",
            "body_hash",
            "result",
            "signature",
        ):
            if field not in props:
                errors.append(f"signedOperationEvent missing property '{field}'")

    for head_name in ("artifactHead", "workspaceHead"):
        head = defs.get(head_name)
        if not isinstance(head, dict):
            continue
        props = head.get("properties") or {}
        if "operation_id" not in props:
            errors.append(f"{head_name} missing operation_id")
        if head_name == "artifactHead" and "revision" not in props:
            errors.append("artifactHead missing revision (DocumentRevision)")
        if head_name == "workspaceHead" and "tree_root_hash" not in props:
            errors.append("workspaceHead missing tree_root_hash")

    return errors


def check_brain_rpc_revision_compat(root: Path) -> list[str]:
    """Ensure signed-operation documentRevision kinds match brain-rpc."""
    errors: list[str] = []
    brain_path = root / "contracts" / "backend-runtime-v1" / "brain-rpc.schema.json"
    signed_path = (
        root / "contracts" / "backend-runtime-v1" / "signed-operation.schema.json"
    )
    if not brain_path.is_file():
        return ["missing brain-rpc.schema.json for compatibility check"]
    brain = load_json(brain_path)
    signed = load_json(signed_path)
    brain_kinds = set(
        ((brain.get("$defs") or {}).get("documentRevisionKind") or {}).get("enum")
        or []
    )
    signed_kinds = set(
        ((signed.get("$defs") or {}).get("documentRevisionKind") or {}).get("enum")
        or []
    )
    if brain_kinds and signed_kinds != brain_kinds:
        errors.append(
            f"documentRevisionKind mismatch: brain-rpc={sorted(brain_kinds)} "
            f"signed-operation={sorted(signed_kinds)}"
        )
    brain_write_modes = set(
        ((brain.get("$defs") or {}).get("vaultWriteMode") or {}).get("enum") or []
    )
    signed_write_modes = set(
        ((signed.get("$defs") or {}).get("vaultWriteMode") or {}).get("enum") or []
    )
    if brain_write_modes and signed_write_modes != brain_write_modes:
        errors.append(
            f"vaultWriteMode mismatch: brain-rpc={sorted(brain_write_modes)} "
            f"signed-operation={sorted(signed_write_modes)}"
        )
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=None,
        help="Repository root (default: parent of scripts/)",
    )
    args = parser.parse_args()
    root = args.root.resolve() if args.root else Path(__file__).resolve().parent.parent

    contract = root / "contracts" / "backend-runtime-v1"
    schema_path = contract / "signed-operation.schema.json"
    examples = contract / "examples"

    failed = 0

    if not schema_path.is_file():
        fail(f"missing {schema_path.relative_to(root)}")
        return 1

    try:
        schema = load_json(schema_path)
    except json.JSONDecodeError as e:
        fail(f"schema JSON invalid: {e}")
        return 1
    ok(f"loaded {schema_path.relative_to(root)}")

    struct_errors = check_schema_structure(schema)
    if struct_errors:
        for e in struct_errors:
            fail(e)
            failed += 1
    else:
        ok("schema $defs include event/actor/target/parents/body_hash/result/signature/heads")

    compat_errors = check_brain_rpc_revision_compat(root)
    if compat_errors:
        for e in compat_errors:
            fail(e)
            failed += 1
    else:
        ok("DocumentRevision + vaultWriteMode compatible with brain-rpc")

    for name in EXAMPLE_FILES:
        path = examples / name
        if not path.is_file():
            fail(f"missing fixture {path.relative_to(root)}")
            failed += 1
            continue
        try:
            data = load_json(path)
        except json.JSONDecodeError as e:
            fail(f"{name}: invalid JSON: {e}")
            failed += 1
            continue

        errors = validate_record(data)
        js_errors = try_jsonschema(schema, data)
        # When using oneOf top-level, jsonschema validates which branch matches
        all_errors = errors + [f"jsonschema: {e}" for e in js_errors]

        exp = SCENARIO_EXPECTATIONS.get(name, {})
        if exp.get("record_type") and data.get("record_type") != exp["record_type"]:
            all_errors.append(
                f"expected record_type {exp['record_type']}, got {data.get('record_type')}"
            )
        if exp.get("kind") and data.get("kind") != exp["kind"]:
            all_errors.append(f"expected kind {exp['kind']}, got {data.get('kind')}")
        if exp.get("actor_kind"):
            actor = data.get("actor") or {}
            if actor.get("kind") != exp["actor_kind"]:
                all_errors.append(
                    f"expected actor.kind {exp['actor_kind']}, got {actor.get('kind')}"
                )
        if exp.get("vault_write_mode") and data.get("vault_write_mode") != exp[
            "vault_write_mode"
        ]:
            all_errors.append(
                f"expected vault_write_mode {exp['vault_write_mode']}, "
                f"got {data.get('vault_write_mode')}"
            )
        if "status" in exp:
            result = data.get("result") or {}
            if result.get("status") != exp["status"]:
                all_errors.append(
                    f"expected result.status {exp['status']}, got {result.get('status')}"
                )
        if "reason" in exp:
            result = data.get("result") or {}
            if result.get("reason") != exp["reason"]:
                all_errors.append(
                    f"expected result.reason {exp['reason']}, got {result.get('reason')}"
                )
        if "advances_artifact_head" in exp:
            if data.get("advances_artifact_head") is not exp["advances_artifact_head"]:
                all_errors.append(
                    f"expected advances_artifact_head={exp['advances_artifact_head']}"
                )
        if "advances_workspace_head" in exp:
            if data.get("advances_workspace_head") is not exp["advances_workspace_head"]:
                all_errors.append(
                    f"expected advances_workspace_head={exp['advances_workspace_head']}"
                )
        if exp.get("requires_source_path"):
            if data.get("record_type") == "signed_operation":
                target = data.get("target") or {}
                if not target.get("source_path"):
                    all_errors.append("missing target.source_path")
            elif data.get("record_type") == "artifact_head":
                if not data.get("source_path"):
                    all_errors.append("missing source_path on checkpoint head")
        if exp.get("head_kind") and data.get("head_kind") != exp["head_kind"]:
            all_errors.append(
                f"expected head_kind {exp['head_kind']}, got {data.get('head_kind')}"
            )

        if all_errors:
            for e in all_errors:
                fail(f"{name}: {e}")
                failed += 1
        else:
            ok(f"fixture {name}")

    # Negatives
    negatives: list[tuple[str, dict[str, Any]]] = [
        (
            "missing schema_version",
            {
                "record_type": "signed_operation",
                "operation_id": "op_x",
                "tenant_id": "t",
                "instance_id": "i",
                "occurred_at": "2026-01-01T00:00:00Z",
                "kind": "file_create",
                "actor": {"kind": "human", "subject_id": "u"},
                "target": {"scope": "file", "path": "/a"},
                "parents": [],
                "result": {"status": "committed", "reason": "ok"},
                "signature": {
                    "alg": "none",
                    "key_id": "k",
                    "value": "unsigned",
                    "signed_at": "2026-01-01T00:00:00Z",
                },
            },
        ),
        (
            "rejected advances head",
            {
                "schema_version": 1,
                "record_type": "signed_operation",
                "operation_id": "op_rej1",
                "tenant_id": "t",
                "instance_id": "i",
                "occurred_at": "2026-01-01T00:00:00Z",
                "kind": "operation_rejected",
                "actor": {"kind": "human", "subject_id": "u"},
                "target": {"scope": "file", "path": "/a"},
                "parents": [],
                "result": {"status": "rejected", "reason": "revision_mismatch"},
                "signature": {
                    "alg": "none",
                    "key_id": "k",
                    "value": "unsigned",
                    "signed_at": "2026-01-01T00:00:00Z",
                },
                "advances_artifact_head": True,
            },
        ),
        (
            "bad operation_id",
            {
                "schema_version": 1,
                "record_type": "signed_operation",
                "operation_id": "not-valid",
                "tenant_id": "t",
                "instance_id": "i",
                "occurred_at": "2026-01-01T00:00:00Z",
                "kind": "file_create",
                "actor": {"kind": "agent", "subject_id": "a"},
                "target": {"scope": "file", "path": "/a"},
                "parents": [],
                "result": {
                    "status": "committed",
                    "reason": "ok",
                    "revision": {"token": "r1", "kind": "etag"},
                },
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
                "record_type": "signed_operation",
                "operation_id": "op_loose1",
                "tenant_id": "t",
                "instance_id": "i",
                "occurred_at": "2026-01-01T00:00:00Z",
                "kind": "file_create",
                "actor": {"kind": "human", "subject_id": "u"},
                "target": {"scope": "file", "path": "/a"},
                "parents": [],
                "result": {
                    "status": "committed",
                    "reason": "ok",
                    "revision": {"token": "r1", "kind": "etag"},
                },
                "signature": {
                    "alg": "none",
                    "key_id": "k",
                    "value": "unsigned",
                    "signed_at": "2026-01-01T00:00:00Z",
                },
                "extra_loose_bag": {"x": 1},
            },
        ),
    ]

    for label, payload in negatives:
        errors = validate_record(payload)
        if not errors:
            fail(f"negative '{label}' unexpectedly accepted")
            failed += 1
        else:
            ok(f"negative rejected: {label}")

    print()
    if failed:
        print(f"FAILED: {failed} check(s)")
        return 1
    print("All signed-operation checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
