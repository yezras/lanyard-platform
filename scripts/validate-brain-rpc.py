#!/usr/bin/env python3
"""Offline validation for Brain RPC v1 method schemas (backend-runtime-v1).

Validates:
  - contracts/backend-runtime-v1/brain-rpc.schema.json is loadable
  - required + expansion method catalogs are present and consistent
  - example request/result frames under examples/brain-rpc.* conform
  - negative fixtures are rejected
  - expansion methods are marked optional

Uses jsonschema when installed; otherwise a stdlib subset checker.
No network calls.

Usage (from repository root):
  python3 scripts/validate-brain-rpc.py
  python3 scripts/validate-brain-rpc.py --root /path/to/repo

Exit 0 on success; non-zero on failure.
"""

from __future__ import annotations

import argparse
import base64
import copy
import json
import re
import sys
from pathlib import Path
from typing import Any

METHOD_RE = re.compile(r"^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$")
VAULT_PATH_RE = re.compile(r"^/")

REQUIRED_METHODS = (
    "brain.ping",
    "brain.health",
    "vault.list",
    "vault.stat",
    "vault.read",
    "settings.snapshot",
    "projects.list",
)
EXPANSION_METHODS = (
    "brain.capabilities",
    "projects.create",
    "projects.delete",
    "settings.patch",
    "vault.write",
    "vault.read_chunk",
    "history.list",
    "heads.artifact",
    "heads.workspace",
    "models.list",
    "models.set_active",
    "cron.list",
    "cron.patch",
)
REVISION_PRODUCTION_KINDS = frozenset({"etag", "content_hash", "host_revision"})
KNOWN_ERROR_CODES = frozenset(
    {
        "unauthenticated",
        "forbidden",
        "not_found",
        "invalid_argument",
        "invalid_type",
        "payload_too_large",
        "timeout",
        "unavailable",
        "conflict",
        "method_not_found",
        "version_unsupported",
        "rate_limited",
        "internal",
    }
)
VAULT_WRITE_MODES = frozenset(
    {"create_new", "replace_if_match", "replace_if_absent", "write_checkpoint"}
)
DOCUMENT_REVISION_KINDS = frozenset(
    {"etag", "content_hash", "host_revision", "mtime_size_fallback"}
)
EXAMPLE_PAIRS = (
    ("brain-rpc.ping.request.json", "brain-rpc.ping.result.json", "brain.ping"),
    ("brain-rpc.health.request.json", "brain-rpc.health.result.json", "brain.health"),
    (
        "brain-rpc.vault-list.request.json",
        "brain-rpc.vault-list.result.json",
        "vault.list",
    ),
    (
        "brain-rpc.vault-stat.request.json",
        "brain-rpc.vault-stat.result.json",
        "vault.stat",
    ),
    (
        "brain-rpc.vault-read.request.json",
        "brain-rpc.vault-read.result.json",
        "vault.read",
    ),
    (
        "brain-rpc.settings-snapshot.request.json",
        "brain-rpc.settings-snapshot.result.json",
        "settings.snapshot",
    ),
    (
        "brain-rpc.projects-list.request.json",
        "brain-rpc.projects-list.result.json",
        "projects.list",
    ),
    (
        "brain-rpc.projects-create.request.json",
        "brain-rpc.projects-create.result.json",
        "projects.create",
    ),
    (
        "brain-rpc.projects-delete.request.json",
        "brain-rpc.projects-delete.result.json",
        "projects.delete",
    ),
    (
        "brain-rpc.settings-patch.request.json",
        "brain-rpc.settings-patch.result.json",
        "settings.patch",
    ),
    (
        "brain-rpc.settings-patch.cron-create.request.json",
        "brain-rpc.settings-patch.cron-create.result.json",
        "settings.patch",
    ),
    (
        "brain-rpc.settings-patch.cron-update.request.json",
        "brain-rpc.settings-patch.cron-update.result.json",
        "settings.patch",
    ),
    (
        "brain-rpc.vault-write.request.json",
        "brain-rpc.vault-write.result.json",
        "vault.write",
    ),
    (
        "office-binary-transfer.read-chunk.request.json",
        "office-binary-transfer.read-chunk.result.json",
        "vault.read_chunk",
    ),
    (
        "brain-rpc.history-list.request.json",
        "brain-rpc.history-list.result.json",
        "history.list",
    ),
    (
        "brain-rpc.heads-artifact.request.json",
        "brain-rpc.heads-artifact.result.json",
        "heads.artifact",
    ),
    (
        "brain-rpc.heads-workspace.request.json",
        "brain-rpc.heads-workspace.result.json",
        "heads.workspace",
    ),
)


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def resolve_ref(schema: dict[str, Any], ref: str) -> dict[str, Any]:
    if not ref.startswith("#/$defs/"):
        raise ValueError(f"unsupported $ref: {ref}")
    name = ref[len("#/$defs/") :]
    defs = schema.get("$defs") or {}
    if name not in defs:
        raise KeyError(f"missing $defs.{name}")
    node = defs[name]
    # Follow one level of $ref on the def itself (e.g. result_vault_stat)
    if isinstance(node, dict) and "$ref" in node and len(node) <= 2:
        # may also have description
        return resolve_ref(schema, node["$ref"])
    return node


def has_jsonschema() -> bool:
    try:
        import jsonschema  # noqa: F401

        return True
    except ImportError:
        return False


def validate_with_jsonschema(schema: dict[str, Any], instance: Any, def_ref: str) -> list[str]:
    import jsonschema
    from jsonschema import Draft202012Validator

    # Build a validator rooted at the $def by wrapping
    target = resolve_ref(schema, def_ref)
    # Provide full schema so internal $refs resolve
    validator = Draft202012Validator(
        {
            "$schema": schema.get("$schema"),
            "$defs": schema.get("$defs", {}),
            **{k: v for k, v in target.items() if k != "$ref"},
        }
        if "$ref" not in target
        else {
            "$schema": schema.get("$schema"),
            "$defs": schema.get("$defs", {}),
            **target,
        }
    )
    # Prefer validating against a root that includes $defs for $ref resolution
    root = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$defs": schema.get("$defs", {}),
        "allOf": [{"$ref": def_ref}],
    }
    try:
        Draft202012Validator.check_schema(root)
    except Exception:
        pass
    v = Draft202012Validator(root)
    return [f"{'/'.join(str(p) for p in e.absolute_path) or '$'}: {e.message}" for e in v.iter_errors(instance)]


def stdlib_check_auth(auth: Any, path: str = "$.auth") -> list[str]:
    errors: list[str] = []
    if not isinstance(auth, dict):
        return [f"{path}: must be object"]
    for key in (
        "tenant_id",
        "instance_id",
        "subject",
        "session_id",
        "issued_at",
        "expires_at",
    ):
        if key not in auth:
            errors.append(f"{path}: missing required property '{key}'")
    subject = auth.get("subject")
    if subject is not None:
        if not isinstance(subject, dict):
            errors.append(f"{path}.subject: must be object")
        else:
            for key in ("portal_user_id", "roles", "path_prefixes"):
                if key not in subject:
                    errors.append(f"{path}.subject: missing '{key}'")
            if not subject.get("backend_profile") and not subject.get("hermes_profile"):
                errors.append(
                    f"{path}.subject: require backend_profile or hermes_profile"
                )
            prefixes = subject.get("path_prefixes")
            if prefixes is not None:
                if not isinstance(prefixes, list):
                    errors.append(f"{path}.subject.path_prefixes: must be array")
                else:
                    for i, p in enumerate(prefixes):
                        if not isinstance(p, str) or not VAULT_PATH_RE.match(p):
                            errors.append(
                                f"{path}.subject.path_prefixes[{i}]: must start with /"
                            )
    return errors


def stdlib_check_request(frame: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(frame, dict):
        return ["$: must be object"]
    if frame.get("type") != "brain_rpc_request":
        errors.append("$.type: must be brain_rpc_request")
    if frame.get("contract_version") != 1:
        errors.append("$.contract_version: must be 1")
    for key in (
        "request_id",
        "method",
        "timeout_ms",
        "auth",
        "params",
    ):
        if key not in frame:
            errors.append(f"$: missing required property '{key}'")
    method = frame.get("method")
    if isinstance(method, str) and not METHOD_RE.match(method):
        errors.append(f"$.method: invalid pattern {method!r}")
    timeout = frame.get("timeout_ms")
    if timeout is not None:
        if not isinstance(timeout, int) or timeout < 1 or timeout > 30000:
            errors.append("$.timeout_ms: must be integer 1..30000")
    if "auth" in frame:
        errors.extend(stdlib_check_auth(frame["auth"]))
    if "params" in frame and not isinstance(frame["params"], dict):
        errors.append("$.params: must be object")
    return errors


def stdlib_check_result(frame: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(frame, dict):
        return ["$: must be object"]
    if frame.get("type") != "brain_rpc_result":
        errors.append("$.type: must be brain_rpc_result")
    if frame.get("contract_version") != 1:
        errors.append("$.contract_version: must be 1")
    for key in ("request_id", "ok", "result", "error"):
        if key not in frame:
            errors.append(f"$: missing required property '{key}'")
    ok = frame.get("ok")
    if ok is True:
        if frame.get("error") is not None:
            errors.append("$.error: must be null when ok is true")
        if frame.get("result") is None:
            errors.append("$.result: must be non-null when ok is true")
    elif ok is False:
        if frame.get("result") is not None:
            errors.append("$.result: must be null when ok is false")
        err = frame.get("error")
        if not isinstance(err, dict):
            errors.append("$.error: must be object when ok is false")
        else:
            for key in ("code", "message", "retryable"):
                if key not in err:
                    errors.append(f"$.error: missing '{key}'")
            if "retryable" in err and not isinstance(err["retryable"], bool):
                errors.append("$.error.retryable: must be boolean")
    return errors


def stdlib_check_method_result(method: str, result: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(result, dict):
        return [f"result for {method}: must be object"]

    def need(*keys: str) -> None:
        for k in keys:
            if k not in result:
                errors.append(f"{method} result: missing '{k}'")

    if method == "brain.ping":
        need("pong", "instance_id", "contract_version")
        if result.get("pong") is not True:
            errors.append("brain.ping result.pong must be true")
        if result.get("contract_version") != 1:
            errors.append("brain.ping result.contract_version must be 1")
        if "echo" in result and isinstance(result["echo"], str) and len(result["echo"]) > 64:
            errors.append("brain.ping result.echo exceeds 64 chars")
    elif method == "brain.health":
        need("status", "checks", "versions")
        if result.get("status") not in ("ok", "degraded", "unavailable"):
            errors.append("brain.health status invalid")
        if not isinstance(result.get("checks"), dict):
            errors.append("brain.health checks must be object")
        if not isinstance(result.get("versions"), dict):
            errors.append("brain.health versions must be object")
    elif method == "vault.list":
        need("path", "entries", "truncated")
        if not isinstance(result.get("entries"), list):
            errors.append("vault.list entries must be array")
        else:
            for i, ent in enumerate(result["entries"]):
                if not isinstance(ent, dict) or not all(
                    k in ent for k in ("name", "path", "kind")
                ):
                    errors.append(f"vault.list entries[{i}] incomplete")
                elif ent.get("kind") not in ("file", "directory"):
                    errors.append(f"vault.list entries[{i}].kind invalid")
    elif method == "vault.stat":
        need("name", "path", "kind")
        if result.get("kind") not in ("file", "directory"):
            errors.append("vault.stat kind invalid")
    elif method == "vault.read":
        need("path", "kind", "encoding", "content", "size_bytes")
        if result.get("kind") != "file":
            errors.append("vault.read kind must be file")
        if result.get("encoding") not in ("utf-8", "base64"):
            errors.append("vault.read encoding invalid")
    elif method == "vault.read_chunk":
        need(
            "path",
            "offset",
            "encoding",
            "content",
            "size_bytes",
            "eof",
            "file_size_bytes",
            "revision",
        )
        if result.get("encoding") != "base64":
            errors.append("vault.read_chunk encoding must be base64")
        if not isinstance(result.get("eof"), bool):
            errors.append("vault.read_chunk eof must be boolean")
        if not isinstance(result.get("offset"), int) or result["offset"] < 0:
            errors.append("vault.read_chunk offset must be integer ≥ 0")
        if not isinstance(result.get("size_bytes"), int) or result["size_bytes"] < 0:
            errors.append("vault.read_chunk size_bytes must be integer ≥ 0")
        # Content length must match size_bytes (review: example consistency)
        content = result.get("content")
        if isinstance(content, str) and isinstance(result.get("size_bytes"), int):
            try:
                decoded = base64.b64decode(content, validate=False)
                if len(decoded) != result["size_bytes"]:
                    errors.append(
                        f"vault.read_chunk size_bytes {result['size_bytes']} "
                        f"!= decoded content length {len(decoded)}"
                    )
            except Exception as exc:  # noqa: BLE001
                errors.append(f"vault.read_chunk content not valid base64: {exc}")
        if (
            not isinstance(result.get("file_size_bytes"), int)
            or result["file_size_bytes"] < 0
        ):
            errors.append("vault.read_chunk file_size_bytes must be integer ≥ 0")
        rev = result.get("revision")
        if not isinstance(rev, dict):
            errors.append("vault.read_chunk revision must be object")
        else:
            if not isinstance(rev.get("token"), str) or not rev.get("token"):
                errors.append("vault.read_chunk revision.token required")
            if rev.get("kind") not in DOCUMENT_REVISION_KINDS:
                errors.append("vault.read_chunk revision.kind invalid")
    elif method == "settings.snapshot":
        need("exported_at", "source")
        for key in ("skills", "crons", "mcp_servers", "models", "integrations"):
            if key in result and not isinstance(result[key], list):
                errors.append(f"settings.snapshot {key} must be array")
        # Secret policy: no obvious secret keys at top level of nested dicts
        blob = json.dumps(result)
        for frag in ("api_key", "api-key", "\"password\"", "\"authorization\""):
            if frag in blob.lower().replace("_", ""):
                # soft check — only flag clear patterns
                pass
        secret_keys = find_secret_keys(result)
        if secret_keys:
            errors.append(
                f"settings.snapshot contains secret-shaped keys: {secret_keys[:5]}"
            )
    elif method == "projects.list":
        need("projects", "source")
        if not isinstance(result.get("projects"), list):
            errors.append("projects.list projects must be array")
    elif method == "projects.create":
        need("id", "name")
        if not isinstance(result.get("id"), str) or not result.get("id"):
            errors.append("projects.create result.id must be non-empty string")
        if not isinstance(result.get("name"), str) or not result.get("name"):
            errors.append("projects.create result.name must be non-empty string")
        folders = result.get("folders")
        if folders is not None and not isinstance(folders, list):
            errors.append("projects.create result.folders must be array when present")
    elif method == "projects.delete":
        need("id", "archived")
        if not isinstance(result.get("id"), str) or not result.get("id"):
            errors.append("projects.delete result.id must be non-empty string")
        if result.get("archived") is not True:
            errors.append(
                "projects.delete result.archived must be true (soft-archive only)"
            )
    elif method == "settings.patch":
        need("op", "source")
        op = result.get("op")
        allowed_ops = {
            "skill.set_enabled",
            "cron.set_enabled",
            "cron.create",
            "cron.update",
            "mcp.set_enabled",
            "model.set_active",
        }
        if op not in allowed_ops:
            errors.append(f"settings.patch result.op invalid: {op!r}")
        if not isinstance(result.get("source"), str) or not result.get("source"):
            errors.append("settings.patch result.source must be non-empty string")
        if op == "skill.set_enabled":
            skill = result.get("skill")
            if not isinstance(skill, dict) or not skill.get("id") or not skill.get("name"):
                errors.append("settings.patch skill result requires skill.id and skill.name")
        elif op in ("cron.set_enabled", "cron.create", "cron.update"):
            cron = result.get("cron")
            if not isinstance(cron, dict) or not cron.get("id") or not cron.get("name"):
                errors.append("settings.patch cron result requires cron.id and cron.name")
        elif op == "mcp.set_enabled":
            mcp = result.get("mcp")
            if not isinstance(mcp, dict) or not mcp.get("name"):
                errors.append("settings.patch mcp result requires mcp.name")
        elif op == "model.set_active":
            model = result.get("model")
            if (
                not isinstance(model, dict)
                or not model.get("provider")
                or not model.get("model")
            ):
                errors.append(
                    "settings.patch model result requires model.provider and model.model"
                )
        secret_keys = find_secret_keys(result)
        if secret_keys:
            errors.append(
                f"settings.patch contains secret-shaped keys: {secret_keys[:5]}"
            )
    elif method == "vault.write":
        need("path", "revision", "size_bytes", "mime_type", "written_at")
        path = result.get("path")
        if not isinstance(path, str) or not VAULT_PATH_RE.match(path):
            errors.append("vault.write result.path must start with /")
        rev = result.get("revision")
        if not isinstance(rev, dict):
            errors.append("vault.write result.revision must be object")
        else:
            token = rev.get("token")
            kind = rev.get("kind")
            if not isinstance(token, str) or not token.strip():
                errors.append("vault.write revision.token required")
            if kind not in DOCUMENT_REVISION_KINDS:
                errors.append(f"vault.write revision.kind invalid: {kind!r}")
        if not isinstance(result.get("size_bytes"), int) or result["size_bytes"] < 0:
            errors.append("vault.write result.size_bytes must be int >= 0")
        if not isinstance(result.get("mime_type"), str) or not result.get("mime_type"):
            errors.append("vault.write result.mime_type must be non-empty string")
        if not isinstance(result.get("written_at"), str) or not result.get("written_at"):
            errors.append("vault.write result.written_at must be non-empty string")
        etag = result.get("etag")
        if etag is not None and (not isinstance(etag, str) or not etag.strip()):
            errors.append("vault.write result.etag must be non-empty string when set")
        # Optional lp-ye4.8 ledger commit metadata (clients must tolerate absence)
        commit = result.get("commit")
        if commit is not None:
            if not isinstance(commit, dict):
                errors.append("vault.write result.commit must be object when set")
            else:
                op_id = commit.get("operation_id")
                ck = commit.get("kind")
                if not isinstance(op_id, str) or not op_id.startswith("op_"):
                    errors.append(
                        "vault.write commit.operation_id must be op_-prefixed string"
                    )
                if rev and isinstance(rev, dict) and op_id == rev.get("token"):
                    errors.append(
                        "vault.write commit.operation_id must differ from revision.token"
                    )
                if ck not in ("file_create", "file_replace", "file_checkpoint"):
                    errors.append(f"vault.write commit.kind invalid: {ck!r}")
                trh = commit.get("tree_root_hash")
                if trh is not None and (
                    not isinstance(trh, str) or not re.fullmatch(r"[a-f0-9]{64}", trh)
                ):
                    errors.append(
                        "vault.write commit.tree_root_hash must be 64-char sha256 hex"
                    )
    elif method == "history.list":
        need("path", "events", "truncated")
        path = result.get("path")
        if not isinstance(path, str) or not VAULT_PATH_RE.match(path):
            errors.append("history.list result.path must start with /")
        events = result.get("events")
        if not isinstance(events, list):
            errors.append("history.list result.events must be array")
        else:
            for i, ev in enumerate(events):
                if not isinstance(ev, dict):
                    errors.append(f"history.list events[{i}] must be object")
                    continue
                for key in (
                    "schema_version",
                    "record_type",
                    "operation_id",
                    "tenant_id",
                    "kind",
                    "target",
                    "result",
                ):
                    if key not in ev:
                        errors.append(f"history.list events[{i}] missing '{key}'")
                if ev.get("record_type") not in (None, "signed_operation"):
                    errors.append(
                        f"history.list events[{i}].record_type must be signed_operation"
                    )
                target = ev.get("target")
                if isinstance(target, dict):
                    tpath = target.get("path")
                    if isinstance(tpath, str) and not VAULT_PATH_RE.match(tpath):
                        errors.append(
                            f"history.list events[{i}].target.path must start with /"
                        )
        if not isinstance(result.get("truncated"), bool):
            errors.append("history.list result.truncated must be boolean")
    elif method == "heads.artifact":
        need(
            "schema_version",
            "record_type",
            "tenant_id",
            "path",
            "operation_id",
            "revision",
            "updated_at",
            "head_kind",
        )
        if result.get("record_type") != "artifact_head":
            errors.append("heads.artifact record_type must be artifact_head")
        path = result.get("path")
        if not isinstance(path, str) or not VAULT_PATH_RE.match(path):
            errors.append("heads.artifact path must start with /")
        rev = result.get("revision")
        if not isinstance(rev, dict):
            errors.append("heads.artifact revision must be object")
        else:
            if not isinstance(rev.get("token"), str) or not rev.get("token"):
                errors.append("heads.artifact revision.token required")
            if rev.get("kind") not in DOCUMENT_REVISION_KINDS:
                errors.append("heads.artifact revision.kind invalid")
        if result.get("head_kind") not in ("canonical", "checkpoint"):
            errors.append("heads.artifact head_kind invalid")
    elif method == "heads.workspace":
        need(
            "schema_version",
            "record_type",
            "tenant_id",
            "workspace_id",
            "tree_root_hash",
            "operation_id",
            "updated_at",
        )
        if result.get("record_type") != "workspace_head":
            errors.append("heads.workspace record_type must be workspace_head")
        thr = result.get("tree_root_hash")
        if not isinstance(thr, str) or len(thr) != 64:
            errors.append("heads.workspace tree_root_hash must be 64-char hex")
        elif any(c not in "0123456789abcdef" for c in thr):
            errors.append("heads.workspace tree_root_hash must be lowercase hex")
    return errors


_SECRET_KEY_RE = re.compile(
    r"(api[_-]?key|token|password|passwd|secret|authorization|credential|"
    r"private[_-]?key|access[_-]?key|refresh[_-]?key|bearer)$",
    re.IGNORECASE,
)


def find_secret_keys(value: Any, prefix: str = "") -> list[str]:
    found: list[str] = []
    if isinstance(value, dict):
        for k, v in value.items():
            key = str(k)
            path = f"{prefix}.{key}" if prefix else key
            if key.lower() in {"env", "headers", "secrets", "credentials"}:
                found.append(path)
            elif _SECRET_KEY_RE.search(key):
                found.append(path)
            else:
                found.extend(find_secret_keys(v, path))
    elif isinstance(value, list):
        for i, item in enumerate(value):
            found.extend(find_secret_keys(item, f"{prefix}[{i}]"))
    return found


def stdlib_check_method_params(method: str, params: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(params, dict):
        return [f"params for {method}: must be object"]
    if method == "brain.ping":
        if "echo" in params and params["echo"] is not None:
            if not isinstance(params["echo"], str):
                errors.append("brain.ping echo must be string")
            elif len(params["echo"]) > 64:
                errors.append("brain.ping echo exceeds 64 chars")
    elif method == "vault.list":
        if "path" in params and params["path"] is not None:
            if not isinstance(params["path"], str) or not VAULT_PATH_RE.match(
                params["path"]
            ):
                errors.append("vault.list path must start with /")
        if "limit" in params and params["limit"] is not None:
            lim = params["limit"]
            if not isinstance(lim, int) or lim < 1 or lim > 500:
                errors.append("vault.list limit must be 1..500")
    elif method in ("vault.stat", "vault.read", "vault.read_chunk"):
        if "path" not in params:
            errors.append(f"{method} params: path required")
        elif not isinstance(params["path"], str) or not VAULT_PATH_RE.match(
            params["path"]
        ):
            errors.append(f"{method} path must start with /")
        if method == "vault.read" and "max_bytes" in params:
            mb = params["max_bytes"]
            if not isinstance(mb, int) or mb < 1 or mb > 4194304:
                errors.append("vault.read max_bytes must be 1..4194304")
        if method == "vault.read_chunk":
            if "offset" not in params:
                errors.append("vault.read_chunk params: offset required")
            elif not isinstance(params["offset"], int) or params["offset"] < 0:
                errors.append("vault.read_chunk offset must be integer ≥ 0")
            if "max_bytes" not in params:
                errors.append("vault.read_chunk params: max_bytes required")
            else:
                mb = params["max_bytes"]
                if not isinstance(mb, int) or mb < 1 or mb > 1048576:
                    errors.append("vault.read_chunk max_bytes must be 1..1048576")
            rev = params.get("expected_revision")
            if rev is not None:
                if not isinstance(rev, dict):
                    errors.append("vault.read_chunk expected_revision must be object")
                else:
                    if not isinstance(rev.get("token"), str) or not rev.get("token"):
                        errors.append("expected_revision.token required")
                    if rev.get("kind") not in DOCUMENT_REVISION_KINDS:
                        errors.append("expected_revision.kind invalid")
    elif method == "settings.snapshot":
        if "include" in params and params["include"] is not None:
            if not isinstance(params["include"], list):
                errors.append("settings.snapshot include must be array")
            else:
                allowed = {
                    "skills",
                    "crons",
                    "mcp_servers",
                    "models",
                    "integrations",
                }
                for item in params["include"]:
                    if item not in allowed:
                        errors.append(f"settings.snapshot include unknown: {item!r}")
    elif method == "projects.list":
        if "include_archived" in params and not isinstance(
            params["include_archived"], bool
        ):
            errors.append("projects.list include_archived must be boolean")
    elif method == "projects.create":
        if "name" not in params:
            errors.append("projects.create params: name required")
        elif not isinstance(params["name"], str) or not params["name"].strip():
            errors.append("projects.create name must be non-empty string")
        elif len(params["name"]) > 200:
            errors.append("projects.create name exceeds 200 chars")
        if "folders" in params and params["folders"] is not None:
            if not isinstance(params["folders"], list):
                errors.append("projects.create folders must be array")
            else:
                for i, folder in enumerate(params["folders"]):
                    if not isinstance(folder, str) or not folder.strip():
                        errors.append(
                            f"projects.create folders[{i}] must be non-empty string"
                        )
    elif method == "projects.delete":
        pid = params.get("id")
        if not isinstance(pid, str) or not pid.strip():
            errors.append("projects.delete params: id required non-empty string")
        # Soft-archive only: reject purge/rmtree-shaped params if present.
        for banned in ("purge", "purge_workspace", "delete_files", "rmtree"):
            if banned in params and params[banned]:
                errors.append(
                    f"projects.delete does not support {banned} "
                    "(soft-archive only; workspace files stay on disk)"
                )
    elif method == "settings.patch":
        op = params.get("op")
        allowed_ops = {
            "skill.set_enabled",
            "cron.set_enabled",
            "cron.create",
            "cron.update",
            "mcp.set_enabled",
            "model.set_active",
        }
        if op not in allowed_ops:
            errors.append(f"settings.patch op invalid or missing: {op!r}")
        elif op == "skill.set_enabled":
            sid = params.get("skill_id")
            if not isinstance(sid, str) or not sid.strip():
                errors.append("settings.patch skill.set_enabled requires skill_id")
            if not isinstance(params.get("enabled"), bool):
                errors.append("settings.patch skill.set_enabled requires boolean enabled")
        elif op == "cron.set_enabled":
            cid = params.get("cron_id")
            if not isinstance(cid, str) or not cid.strip():
                errors.append("settings.patch cron.set_enabled requires cron_id")
            if not isinstance(params.get("enabled"), bool):
                errors.append("settings.patch cron.set_enabled requires boolean enabled")
        elif op == "cron.create":
            name = params.get("name")
            if not isinstance(name, str) or not name.strip():
                errors.append("settings.patch cron.create requires name")
            prompt = params.get("prompt")
            if prompt is None:
                prompt = params.get("instructions")
            if not isinstance(prompt, str) or not prompt.strip():
                errors.append("settings.patch cron.create requires prompt (or instructions)")
            schedule = params.get("schedule")
            if isinstance(schedule, str):
                if not schedule.strip():
                    errors.append("settings.patch cron.create schedule string must be non-empty")
            elif isinstance(schedule, dict):
                expr = schedule.get("expr")
                if not isinstance(expr, str) or not expr.strip():
                    errors.append("settings.patch cron.create schedule.expr required")
            else:
                errors.append("settings.patch cron.create requires schedule (string or object)")
            if "enabled" in params and not isinstance(params.get("enabled"), bool):
                errors.append("settings.patch cron.create enabled must be boolean when set")
        elif op == "cron.update":
            cid = params.get("cron_id")
            if not isinstance(cid, str) or not cid.strip():
                errors.append("settings.patch cron.update requires cron_id")
            has_field = False
            if isinstance(params.get("name"), str) and params["name"].strip():
                has_field = True
            prompt = params.get("prompt")
            if prompt is None:
                prompt = params.get("instructions")
            if isinstance(prompt, str) and prompt.strip():
                has_field = True
            if params.get("schedule") is not None:
                has_field = True
            if isinstance(params.get("enabled"), bool):
                has_field = True
            if params.get("skills") is not None:
                has_field = True
            if not has_field:
                errors.append(
                    "settings.patch cron.update requires at least one of "
                    "name, prompt/instructions, schedule, enabled, skills"
                )
        elif op == "mcp.set_enabled":
            name = params.get("mcp_name")
            if not isinstance(name, str) or not name.strip():
                errors.append("settings.patch mcp.set_enabled requires mcp_name")
            if not isinstance(params.get("enabled"), bool):
                errors.append("settings.patch mcp.set_enabled requires boolean enabled")
        elif op == "model.set_active":
            provider = params.get("provider")
            model = params.get("model")
            if not isinstance(provider, str) or not provider.strip():
                errors.append("settings.patch model.set_active requires provider")
            if not isinstance(model, str) or not model.strip():
                errors.append("settings.patch model.set_active requires model")
        # Reject secret-shaped keys on the wire (config.schema secret policy)
        secret_keys = find_secret_keys(params)
        if secret_keys:
            errors.append(
                f"settings.patch params contain secret-shaped keys: {secret_keys[:5]}"
            )
    elif method == "vault.write":
        path = params.get("path")
        if not isinstance(path, str) or not VAULT_PATH_RE.match(path):
            errors.append("vault.write path must start with /")
        mode = params.get("mode")
        if mode not in VAULT_WRITE_MODES:
            errors.append(f"vault.write mode invalid or missing: {mode!r}")
        if not isinstance(params.get("size_bytes"), int) or params["size_bytes"] < 0:
            errors.append("vault.write size_bytes must be int >= 0")
        ikey = params.get("idempotency_key")
        if not isinstance(ikey, str) or not ikey.strip():
            errors.append("vault.write idempotency_key required")
        elif len(ikey) > 128:
            errors.append("vault.write idempotency_key exceeds 128 chars")
        has_content = "content" in params and params.get("content") is not None
        has_ref = isinstance(params.get("content_ref"), dict)
        if has_content and has_ref:
            errors.append("vault.write must not set both content and content_ref")
        elif not has_content and not has_ref:
            errors.append("vault.write requires content+encoding or content_ref")
        elif has_content:
            enc = params.get("encoding")
            if enc not in ("utf-8", "base64"):
                errors.append("vault.write encoding must be utf-8 or base64 with content")
            if not isinstance(params.get("content"), str):
                errors.append("vault.write content must be string")
            if isinstance(params.get("size_bytes"), int) and params["size_bytes"] > 4194304:
                errors.append("vault.write inline size_bytes exceeds hard max 4 MiB")
        else:
            cref = params.get("content_ref") or {}
            if cref.get("kind") not in (
                "bff_spool",
                "host_upload_session",
                "chunked_write_session",
            ):
                errors.append("vault.write content_ref.kind invalid")
            if not isinstance(cref.get("id"), str) or not str(cref.get("id")).strip():
                errors.append("vault.write content_ref.id required")
        if mode == "replace_if_match":
            has_rev = isinstance(params.get("expected_revision"), dict)
            has_if = isinstance(params.get("if_match"), str) and bool(
                str(params.get("if_match")).strip()
            )
            if not has_rev and not has_if:
                errors.append(
                    "vault.write replace_if_match requires expected_revision or if_match"
                )
            if has_rev:
                rev = params["expected_revision"]
                if not isinstance(rev.get("token"), str) or not rev.get("token"):
                    errors.append("vault.write expected_revision.token required")
                if rev.get("kind") not in DOCUMENT_REVISION_KINDS:
                    errors.append(
                        f"vault.write expected_revision.kind invalid: {rev.get('kind')!r}"
                    )
        if mode == "write_checkpoint":
            source = params.get("source_path")
            if not isinstance(source, str) or not VAULT_PATH_RE.match(source):
                errors.append(
                    "vault.write write_checkpoint requires source_path starting with /"
                )
            elif isinstance(path, str) and source == path:
                errors.append(
                    "vault.write write_checkpoint path must differ from source_path"
                )
        mime = params.get("mime_type")
        if mime is not None and (not isinstance(mime, str) or not mime.strip()):
            errors.append("vault.write mime_type must be non-empty string when set")
    elif method == "history.list":
        path = params.get("path")
        if not isinstance(path, str) or not VAULT_PATH_RE.match(path):
            errors.append("history.list path must start with /")
        if "limit" in params and params["limit"] is not None:
            lim = params["limit"]
            if not isinstance(lim, int) or lim < 1 or lim > 200:
                errors.append("history.list limit must be int 1..200")
    elif method == "heads.artifact":
        path = params.get("path")
        if not isinstance(path, str) or not VAULT_PATH_RE.match(path):
            errors.append("heads.artifact path must start with /")
    elif method == "heads.workspace":
        wid = params.get("workspace_id")
        if wid is not None and (not isinstance(wid, str) or not wid.strip()):
            errors.append(
                "heads.workspace workspace_id must be non-empty string when set"
            )
    return errors


def validate_frame(
    schema: dict[str, Any],
    instance: Any,
    kind: str,
) -> list[str]:
    """kind is 'request' or 'result'."""
    def_ref = (
        "#/$defs/brainRpcRequestFrame"
        if kind == "request"
        else "#/$defs/brainRpcResultFrame"
    )
    if has_jsonschema():
        try:
            return validate_with_jsonschema(schema, instance, def_ref)
        except Exception as exc:  # noqa: BLE001
            # Fall back to stdlib if Draft wiring fails
            base = (
                stdlib_check_request(instance)
                if kind == "request"
                else stdlib_check_result(instance)
            )
            base.append(f"jsonschema path note: {exc}")
            # Prefer pure stdlib result when jsonschema blows up on our catalog root
            return (
                stdlib_check_request(instance)
                if kind == "request"
                else stdlib_check_result(instance)
            )
    return (
        stdlib_check_request(instance)
        if kind == "request"
        else stdlib_check_result(instance)
    )


def negative_cases() -> list[tuple[str, str, Any]]:
    """(name, kind, instance) that must fail."""
    good_auth = {
        "tenant_id": "ten",
        "instance_id": "inst",
        "subject": {
            "portal_user_id": "u",
            "hermes_profile": "contributor",
            "roles": ["contributor"],
            "path_prefixes": ["/Projects"],
        },
        "session_id": "s",
        "issued_at": "2026-07-12T00:00:00.000Z",
        "expires_at": "2026-07-12T00:05:00.000Z",
    }
    return [
        (
            "request_missing_auth",
            "request",
            {
                "type": "brain_rpc_request",
                "contract_version": 1,
                "request_id": "r1",
                "method": "brain.ping",
                "timeout_ms": 1000,
                "params": {},
            },
        ),
        (
            "request_bad_version",
            "request",
            {
                "type": "brain_rpc_request",
                "contract_version": 99,
                "request_id": "r1",
                "method": "brain.ping",
                "timeout_ms": 1000,
                "auth": good_auth,
                "params": {},
            },
        ),
        (
            "request_timeout_too_large",
            "request",
            {
                "type": "brain_rpc_request",
                "contract_version": 1,
                "request_id": "r1",
                "method": "brain.ping",
                "timeout_ms": 60000,
                "auth": good_auth,
                "params": {},
            },
        ),
        (
            "request_subject_no_profile",
            "request",
            {
                "type": "brain_rpc_request",
                "contract_version": 1,
                "request_id": "r1",
                "method": "brain.ping",
                "timeout_ms": 1000,
                "auth": {
                    **good_auth,
                    "subject": {
                        "portal_user_id": "u",
                        "roles": [],
                        "path_prefixes": [],
                    },
                },
                "params": {},
            },
        ),
        (
            "result_ok_with_error",
            "result",
            {
                "type": "brain_rpc_result",
                "contract_version": 1,
                "request_id": "r1",
                "ok": True,
                "result": {"pong": True},
                "error": {
                    "code": "internal",
                    "message": "x",
                    "retryable": True,
                },
            },
        ),
        (
            "result_fail_null_error",
            "result",
            {
                "type": "brain_rpc_result",
                "contract_version": 1,
                "request_id": "r1",
                "ok": False,
                "result": None,
                "error": None,
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
    root = (
        args.root.resolve()
        if args.root
        else Path(__file__).resolve().parent.parent
    )
    contract_dir = root / "contracts" / "backend-runtime-v1"
    schema_path = contract_dir / "brain-rpc.schema.json"
    examples_dir = contract_dir / "examples"

    passed = 0
    failed = 0

    def pass_(msg: str) -> None:
        nonlocal passed
        passed += 1
        print(f"  PASS  {msg}")

    def fail(msg: str) -> None:
        nonlocal failed
        failed += 1
        print(f"  FAIL  {msg}")

    print("Brain RPC v1 schema validation (offline)")
    print(f"  root: {root}")
    print()

    if not schema_path.is_file():
        fail(f"missing {schema_path.relative_to(root)}")
        print(f"\nFAILED  {failed} failure(s).")
        return 1

    try:
        schema = load_json(schema_path)
    except Exception as exc:  # noqa: BLE001
        fail(f"schema not loadable JSON: {exc}")
        print(f"\nFAILED  {failed} failure(s).")
        return 1
    pass_("brain-rpc.schema.json loads as JSON")

    if not isinstance(schema, dict) or "$defs" not in schema:
        fail("schema must be object with $defs")
    else:
        pass_("schema has $defs")

    # Catalog consistency
    print()
    print("  catalog / policy")
    required = schema.get("x-lanyard-required-methods")
    if required != list(REQUIRED_METHODS):
        fail(f"x-lanyard-required-methods mismatch: {required!r}")
    else:
        pass_("x-lanyard-required-methods lists all 7 required methods")

    expansion = schema.get("x-lanyard-expansion-methods") or {}
    if expansion.get("status") != "optional_until_implemented":
        fail("expansion methods must be marked optional_until_implemented")
    else:
        pass_("expansion methods status is optional_until_implemented")

    exp_names = [m.get("name") for m in expansion.get("methods") or []]
    if list(exp_names) != list(EXPANSION_METHODS):
        fail(f"expansion method names mismatch: {exp_names!r}")
    else:
        pass_(f"expansion methods listed ({len(EXPANSION_METHODS)})")

    for m in expansion.get("methods") or []:
        if m.get("status") != "optional_expansion":
            fail(f"expansion method {m.get('name')} not marked optional_expansion")
            break
    else:
        pass_("each expansion method has status optional_expansion")

    catalog = schema.get("x-lanyard-method-catalog") or {}
    for name in REQUIRED_METHODS:
        entry = catalog.get(name)
        if not entry or entry.get("status") != "required_v1":
            fail(f"catalog missing required_v1 for {name}")
        elif not entry.get("params") or not entry.get("result"):
            fail(f"catalog {name} missing params/result refs")
        else:
            # ensure refs resolve
            try:
                resolve_ref(schema, entry["params"])
                resolve_ref(schema, entry["result"])
                pass_(f"catalog {name} refs resolve")
            except Exception as exc:  # noqa: BLE001
                fail(f"catalog {name} ref error: {exc}")

    entrypoints = schema.get("x-lanyard-validation-entrypoints") or {}
    if entrypoints.get("request_frame") != "#/$defs/brainRpcRequestFrame":
        fail("validation entrypoint request_frame missing")
    else:
        pass_("validation entrypoints present")

    # $defs presence for frames
    defs = schema.get("$defs") or {}
    for key in (
        "brainRpcRequestFrame",
        "brainRpcResultFrame",
        "brainRpcAuth",
        "brainRpcError",
        "params_brain_ping",
        "result_brain_ping",
        "params_brain_health",
        "result_brain_health",
        "params_vault_list",
        "result_vault_list",
        "params_vault_stat",
        "result_vault_stat",
        "params_vault_read",
        "result_vault_read",
        "params_vault_read_chunk",
        "result_vault_read_chunk",
        "documentRevision",
        "documentRevisionKind",
        "params_settings_snapshot",
        "result_settings_snapshot",
        "params_projects_list",
        "result_projects_list",
        "params_projects_create",
        "result_projects_create",
        "params_settings_patch",
        "result_settings_patch",
        "params_vault_write",
        "result_vault_write",
        "documentRevision",
        "documentRevisionKind",
        "vaultWriteMode",
        "vaultWriteContentRef",
    ):
        if key not in defs:
            fail(f"$defs.{key} missing")
        else:
            pass_(f"$defs.{key} present")

    # Known error codes on schema
    err_enum = (defs.get("errorCode") or {}).get("enum") or []
    if not KNOWN_ERROR_CODES.issubset(set(err_enum)):
        fail(f"errorCode enum incomplete: {err_enum}")
    else:
        pass_("errorCode enum covers known v1 codes")

    # vault.write expansion wiring
    expansion = schema.get("x-lanyard-expansion-methods") or {}
    vault_write_exp = next(
        (
            m
            for m in (expansion.get("methods") or [])
            if isinstance(m, dict) and m.get("name") == "vault.write"
        ),
        None,
    )
    if not vault_write_exp:
        fail("expansion methods missing vault.write entry")
    elif vault_write_exp.get("params_ref") != "#/$defs/params_vault_write":
        fail(
            "vault.write expansion params_ref must be #/$defs/params_vault_write "
            f"(got {vault_write_exp.get('params_ref')!r})"
        )
    elif vault_write_exp.get("result_ref") != "#/$defs/result_vault_write":
        fail(
            "vault.write expansion result_ref must be #/$defs/result_vault_write "
            f"(got {vault_write_exp.get('result_ref')!r})"
        )
    else:
        pass_("vault.write expansion points at typed params/result (not placeholder)")

    entrypoints_full = schema.get("x-lanyard-validation-entrypoints") or {}
    entry_methods = entrypoints_full.get("methods") or {}
    vw_entry = entry_methods.get("vault.write") or {}
    if vw_entry.get("params") != "#/$defs/params_vault_write":
        fail("validation entrypoints missing vault.write typed params")
    elif vw_entry.get("result") != "#/$defs/result_vault_write":
        fail("validation entrypoints missing vault.write typed result")
    else:
        pass_("validation entrypoints include vault.write")

    write_ext = schema.get("x-lanyard-vault-write") or {}
    err_map = write_ext.get("error_mapping") or {}
    for code in (
        "forbidden",
        "conflict",
        "payload_too_large",
        "invalid_type",
        "method_not_found",
        "unavailable",
        "timeout",
    ):
        if code not in err_map:
            fail(f"x-lanyard-vault-write.error_mapping missing {code}")
        else:
            pass_(f"vault.write error mapping covers {code}")

    http_map = schema.get("x-lanyard-error-http-map") or {}
    if http_map.get("invalid_type") != 415:
        fail("x-lanyard-error-http-map.invalid_type must be 415")
    else:
        pass_("invalid_type maps to HTTP 415")

    # Examples

    # Office binary transfer policy catalog (lp-5q6.17)
    print()
    print("  office binary transfer (lp-5q6.17)")
    office = schema.get("x-lanyard-office-binary-transfer")
    if not isinstance(office, dict):
        fail("x-lanyard-office-binary-transfer missing")
    else:
        if office.get("document_server_plane") != "bff_signed_http_url":
            fail("office transfer: document_server_plane must be bff_signed_http_url")
        else:
            pass_("document_server_plane is bff_signed_http_url")
        if office.get("host_plane") != "chunked_brain_rpc":
            fail("office transfer: host_plane must be chunked_brain_rpc")
        else:
            pass_("host_plane is chunked_brain_rpc")
        if office.get("host_method") != "vault.read_chunk":
            fail("office transfer: host_method must be vault.read_chunk")
        else:
            pass_("host_method is vault.read_chunk")
        forbidden = office.get("forbidden_production_office_surfaces") or []
        if "vault.read" not in forbidden or "GET /api/vault/content" not in forbidden:
            fail("office transfer: must forbid vault.read and GET /api/vault/content")
        else:
            pass_("production Office ban on vault.read + /api/vault/content")
        rev_pol = office.get("revision") or {}
        prod_kinds = set(rev_pol.get("production_kinds") or [])
        if not REVISION_PRODUCTION_KINDS.issubset(prod_kinds):
            fail(f"office transfer production revision kinds incomplete: {prod_kinds}")
        else:
            pass_("production revision kinds include etag/content_hash/host_revision")
        if rev_pol.get("cas_write_mode") != "replace_if_match":
            fail("office transfer cas_write_mode must be replace_if_match")
        else:
            pass_("CAS write mode is replace_if_match")
        limits = office.get("limits") or {}
        if limits.get("vault_read_hard_max_bytes") != 4194304:
            fail("office transfer vault_read_hard_max_bytes must remain 4194304")
        else:
            pass_("vault.read hard max remains 4 MiB")
        if limits.get("chunk_hard_max_bytes") != 1048576:
            fail("office transfer chunk_hard_max_bytes must be 1048576")
        else:
            pass_("chunk hard max is 1 MiB")
        if limits.get("office_file_default_max_bytes") != 52428800:
            fail("office_file_default_max_bytes must be 52428800 (50 MiB)")
        else:
            pass_("office file default max is 50 MiB")
        logging = office.get("logging") or {}
        if logging.get("log_file_bodies") is not False:
            fail("office transfer must set log_file_bodies false")
        else:
            pass_("log_file_bodies is false")
        exp_enum = (defs.get("expansionMethodName") or {}).get("enum") or []
        if "vault.read_chunk" not in exp_enum:
            fail("expansionMethodName enum missing vault.read_chunk")
        else:
            pass_("expansionMethodName includes vault.read_chunk")
        entry_methods = (entrypoints.get("methods") or {})
        chunk_ep = entry_methods.get("vault.read_chunk") or {}
        if chunk_ep.get("params") != "#/$defs/params_vault_read_chunk":
            fail("validation entrypoint vault.read_chunk params missing")
        else:
            try:
                resolve_ref(schema, "#/$defs/params_vault_read_chunk")
                resolve_ref(schema, "#/$defs/result_vault_read_chunk")
                resolve_ref(schema, "#/$defs/documentRevision")
                pass_("vault.read_chunk + documentRevision refs resolve")
            except Exception as exc:  # noqa: BLE001
                fail(f"office transfer ref error: {exc}")

    print()
    print("  examples")
    if not examples_dir.is_dir():
        fail("examples/ directory missing")
    else:
        for req_name, res_name, method in EXAMPLE_PAIRS:
            req_path = examples_dir / req_name
            res_path = examples_dir / res_name
            if not req_path.is_file():
                fail(f"missing example {req_name}")
                continue
            if not res_path.is_file():
                fail(f"missing example {res_name}")
                continue
            try:
                req = load_json(req_path)
                res = load_json(res_path)
            except Exception as exc:  # noqa: BLE001
                fail(f"{req_name}/{res_name} JSON error: {exc}")
                continue

            req_errs = validate_frame(schema, req, "request")
            if req_errs:
                fail(f"{req_name}: {req_errs[0]}")
            else:
                pass_(f"{req_name}: request frame OK")

            if req.get("method") != method:
                fail(f"{req_name}: method expected {method}, got {req.get('method')}")
            else:
                pass_(f"{req_name}: method is {method}")

            param_errs = stdlib_check_method_params(method, req.get("params") or {})
            if param_errs:
                fail(f"{req_name} params: {param_errs[0]}")
            else:
                pass_(f"{req_name}: params OK")

            res_errs = validate_frame(schema, res, "result")
            if res_errs:
                fail(f"{res_name}: {res_errs[0]}")
            else:
                pass_(f"{res_name}: result frame OK")

            if res.get("ok") is not True:
                fail(f"{res_name}: expected ok true success example")
            else:
                result_errs = stdlib_check_method_result(method, res.get("result"))
                if result_errs:
                    fail(f"{res_name} result: {result_errs[0]}")
                else:
                    pass_(f"{res_name}: method result shape OK")

            if req.get("request_id") != res.get("request_id"):
                fail(f"{req_name}/{res_name}: request_id mismatch")
            else:
                pass_(f"{req_name}: request_id echoed")

        # Error example
        err_path = examples_dir / "brain-rpc.error.result.json"
        if not err_path.is_file():
            fail("missing brain-rpc.error.result.json")
        else:
            err_frame = load_json(err_path)
            errs = validate_frame(schema, err_frame, "result")
            if errs:
                fail(f"error result: {errs[0]}")
            elif err_frame.get("ok") is not False:
                fail("error result: ok must be false")
            elif not isinstance(err_frame.get("error"), dict):
                fail("error result: error object required")
            else:
                pass_("brain-rpc.error.result.json OK")

        # vault.write staged content_ref request + CAS conflict result
        cref_path = examples_dir / "brain-rpc.vault-write-content-ref.request.json"
        if not cref_path.is_file():
            fail("missing brain-rpc.vault-write-content-ref.request.json")
        else:
            cref = load_json(cref_path)
            cref_errs = validate_frame(schema, cref, "request")
            if cref_errs:
                fail(f"vault-write-content-ref request: {cref_errs[0]}")
            elif cref.get("method") != "vault.write":
                fail("vault-write-content-ref request method must be vault.write")
            else:
                pref_errs = stdlib_check_method_params(
                    "vault.write", cref.get("params") or {}
                )
                if pref_errs:
                    fail(f"vault-write-content-ref params: {pref_errs[0]}")
                else:
                    pass_("brain-rpc.vault-write-content-ref.request.json OK")

        conflict_path = examples_dir / "brain-rpc.vault-write-conflict.result.json"
        if not conflict_path.is_file():
            fail("missing brain-rpc.vault-write-conflict.result.json")
        else:
            conflict = load_json(conflict_path)
            c_errs = validate_frame(schema, conflict, "result")
            if c_errs:
                fail(f"vault-write-conflict: {c_errs[0]}")
            elif conflict.get("ok") is not False:
                fail("vault-write-conflict: ok must be false")
            else:
                cerr = conflict.get("error") or {}
                if cerr.get("code") != "conflict":
                    fail("vault-write-conflict: error.code must be conflict")
                elif cerr.get("retryable") is not False:
                    fail("vault-write-conflict: retryable must be false")
                else:
                    pass_("brain-rpc.vault-write-conflict.result.json OK")

        # vault.write write_checkpoint + human_edit_active (lp-5q6.32)
        vw_mode = (defs.get("vaultWriteMode") or {}).get("enum") or []
        if "write_checkpoint" not in vw_mode:
            fail("vaultWriteMode must include write_checkpoint (lp-5q6.32)")
        else:
            pass_("vaultWriteMode includes write_checkpoint")
        vw_params = defs.get("params_vault_write") or {}
        if "source_path" not in (vw_params.get("properties") or {}):
            fail("params_vault_write must define source_path for write_checkpoint")
        else:
            pass_("params_vault_write.source_path present")
        agent_pol = (schema.get("x-lanyard-vault-write") or {}).get(
            "agent_human_edit_policy"
        ) or {}
        if agent_pol.get("refuse_reason") != "human_edit_active":
            fail("x-lanyard-vault-write.agent_human_edit_policy.refuse_reason")
        else:
            pass_("agent_human_edit_policy refuse_reason=human_edit_active")

        chk_path = examples_dir / "brain-rpc.vault-write-checkpoint.request.json"
        if not chk_path.is_file():
            fail("missing brain-rpc.vault-write-checkpoint.request.json")
        else:
            chk = load_json(chk_path)
            chk_errs = validate_frame(schema, chk, "request")
            if chk_errs:
                fail(f"vault-write-checkpoint request: {chk_errs[0]}")
            elif chk.get("method") != "vault.write":
                fail("vault-write-checkpoint request method must be vault.write")
            else:
                pref_errs = stdlib_check_method_params(
                    "vault.write", chk.get("params") or {}
                )
                if pref_errs:
                    fail(f"vault-write-checkpoint params: {pref_errs[0]}")
                elif (chk.get("params") or {}).get("mode") != "write_checkpoint":
                    fail("vault-write-checkpoint params.mode must be write_checkpoint")
                elif not (chk.get("params") or {}).get("source_path"):
                    fail("vault-write-checkpoint params.source_path required")
                else:
                    pass_("brain-rpc.vault-write-checkpoint.request.json OK")

        hea_path = examples_dir / "brain-rpc.vault-write-human-edit-active.result.json"
        if not hea_path.is_file():
            fail("missing brain-rpc.vault-write-human-edit-active.result.json")
        else:
            hea = load_json(hea_path)
            hea_errs = validate_frame(schema, hea, "result")
            if hea_errs:
                fail(f"vault-write-human-edit-active: {hea_errs[0]}")
            elif hea.get("ok") is not False:
                fail("vault-write-human-edit-active: ok must be false")
            else:
                herr = hea.get("error") or {}
                details = herr.get("details") or {}
                if herr.get("code") != "conflict":
                    fail("human-edit-active: error.code must be conflict")
                elif details.get("reason") != "human_edit_active":
                    fail("human-edit-active: details.reason must be human_edit_active")
                elif herr.get("retryable") is not False:
                    fail("human-edit-active: retryable must be false")
                else:
                    pass_("brain-rpc.vault-write-human-edit-active.result.json OK")


        # vault.stat revision field (lp-5q6.17)
        stat_res_path = examples_dir / "brain-rpc.vault-stat.result.json"
        if stat_res_path.is_file():
            stat_res = load_json(stat_res_path)
            rev = (stat_res.get("result") or {}).get("revision")
            if not isinstance(rev, dict):
                fail("vault-stat result example missing revision (lp-5q6.17)")
            elif rev.get("kind") not in DOCUMENT_REVISION_KINDS:
                fail("vault-stat revision.kind invalid")
            else:
                pass_("brain-rpc.vault-stat.result.json includes documentRevision")

        policy_path = examples_dir / "office-binary-transfer.policy.json"
        if not policy_path.is_file():
            fail("missing office-binary-transfer.policy.json")
        else:
            policy = load_json(policy_path)
            forbidden = policy.get("forbidden_production_office_surfaces") or []
            if "vault.read" not in forbidden:
                fail("office policy must forbid vault.read")
            elif policy.get("host_method") != "vault.read_chunk":
                fail("office policy host_method must be vault.read_chunk")
            elif (policy.get("logging") or {}).get("log_file_bodies") is not False:
                fail("office policy must set log_file_bodies false")
            else:
                pass_("office-binary-transfer.policy.json OK")

        bff_meta_path = examples_dir / "office-binary-transfer.bff-download.meta.json"
        if not bff_meta_path.is_file():
            fail("missing office-binary-transfer.bff-download.meta.json")
        else:
            meta = load_json(bff_meta_path)
            body = meta.get("response_body") or {}
            if body.get("logged") is not False:
                fail("bff download meta must set response_body.logged false")
            elif body.get("encoding") != "raw_octet_stream":
                fail("bff download meta encoding must be raw_octet_stream")
            else:
                pass_("office-binary-transfer.bff-download.meta.json OK")

        cas_path = examples_dir / "office-binary-transfer.cas-conflict.result.json"
        if not cas_path.is_file():
            fail("missing office-binary-transfer.cas-conflict.result.json")
        else:
            cas = load_json(cas_path)
            errs = validate_frame(schema, cas, "result")
            err = cas.get("error") or {}
            if errs:
                fail(f"cas conflict result: {errs[0]}")
            elif cas.get("ok") is not False:
                fail("cas conflict: ok must be false")
            elif err.get("code") != "conflict":
                fail("cas conflict: error.code must be conflict")
            elif (err.get("details") or {}).get("reason") != "revision_mismatch":
                fail("cas conflict: details.reason must be revision_mismatch")
            else:
                pass_("office-binary-transfer.cas-conflict.result.json OK")

    # Negative cases
    print()
    print("  negative cases (must reject)")
    for name, kind, instance in negative_cases():
        errs = validate_frame(schema, instance, kind)
        # Also apply stdlib subject check for profile case
        if name == "request_subject_no_profile":
            errs = list(errs) + stdlib_check_auth(instance.get("auth", {}))
        if not errs:
            fail(f"{name}: expected validation errors, got none")
        else:
            pass_(f"{name}: rejected ({len(errs)} error(s))")

    # jsonschema availability note
    print()
    if has_jsonschema():
        pass_("jsonschema available (Draft validation used when possible)")
    else:
        pass_("jsonschema not installed; stdlib subset checks used")

    print()
    if failed:
        print(f"FAILED  {failed} failure(s), {passed} pass(es).")
        return 1
    print(f"OK  {passed} check(s) passed (offline, no network).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
