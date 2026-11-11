#!/usr/bin/env python3
"""Offline validation for ChatTurnRecord v1 (contracts/chat-corpus-v1).

Validates:
  - chat-turn-record.schema.json is loadable and requires schema_version
  - examples under contracts/chat-corpus-v1/examples/ conform
  - content_sha256 matches UTF-8 SHA-256 of content for examples
  - negative payloads (missing version, bad hash, wrong record_type) reject

Uses jsonschema when installed; otherwise a stdlib subset checker. No network.

Usage (from repository root):
  python3 scripts/validate-chat-turn-record.py
  python3 scripts/validate-chat-turn-record.py --root /path/to/repo

Exit 0 on success; non-zero on failure.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

SHA256_HEX_RE = re.compile(r"^[a-f0-9]{64}$")
REQUIRED_TOP = (
    "schema_version",
    "record_type",
    "tenant_id",
    "user_id",
    "instance_id",
    "thread_id",
    "turn_id",
    "created_at",
    "model",
    "input",
    "output",
    "tool_events",
    "meta",
)
ALLOWED_TOP = frozenset(
    {
        *REQUIRED_TOP,
        "session_key",
        "completed_at",
    }
)
TOOL_STATUSES = frozenset({"pending", "running", "complete", "error"})


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def content_sha256(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def is_datetime(value: str) -> bool:
    if not isinstance(value, str) or not value:
        return False
    try:
        # Accept trailing Z
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def validate_message(
    msg: Any, path: str, errors: list[str], *, role_allowed: set[str]
) -> None:
    if not isinstance(msg, dict):
        errors.append(f"{path}: must be object")
        return
    for key in ("role", "content", "content_sha256"):
        if key not in msg:
            errors.append(f"{path}: missing required '{key}'")
    role = msg.get("role")
    if role is not None and role not in role_allowed:
        errors.append(f"{path}.role: invalid {role!r}, expected one of {sorted(role_allowed)}")
    content = msg.get("content")
    if content is not None and not isinstance(content, str):
        errors.append(f"{path}.content: must be string")
    digest = msg.get("content_sha256")
    if digest is not None:
        if not isinstance(digest, str) or not SHA256_HEX_RE.match(digest):
            errors.append(f"{path}.content_sha256: must be 64 lowercase hex chars")
        elif isinstance(content, str) and content_sha256(content) != digest:
            errors.append(f"{path}.content_sha256: does not match content")


def validate_tool_event(ev: Any, path: str, errors: list[str]) -> None:
    if not isinstance(ev, dict):
        errors.append(f"{path}: must be object")
        return
    for key in ("tool_call_id", "tool_name", "status"):
        if key not in ev:
            errors.append(f"{path}: missing required '{key}'")
    status = ev.get("status")
    if status is not None and status not in TOOL_STATUSES:
        errors.append(f"{path}.status: invalid {status!r}")


def validate_record_stdlib(data: Any, path: str = "$") -> list[str]:
    errors: list[str] = []
    if not isinstance(data, dict):
        return [f"{path}: must be object"]

    for key in REQUIRED_TOP:
        if key not in data:
            errors.append(f"{path}: missing required '{key}'")

    unknown = set(data.keys()) - ALLOWED_TOP
    if unknown:
        errors.append(f"{path}: unknown properties {sorted(unknown)}")

    if data.get("schema_version") != 1:
        errors.append(f"{path}.schema_version: must be integer const 1 (required)")
    if data.get("record_type") != "chat_turn":
        errors.append(f"{path}.record_type: must be 'chat_turn'")

    for id_key in (
        "tenant_id",
        "user_id",
        "instance_id",
        "thread_id",
        "turn_id",
    ):
        val = data.get(id_key)
        if val is not None and (not isinstance(val, str) or not val):
            errors.append(f"{path}.{id_key}: must be non-empty string")

    created = data.get("created_at")
    if created is not None and not is_datetime(created):
        errors.append(f"{path}.created_at: must be RFC3339 date-time")

    model = data.get("model")
    if model is not None:
        if not isinstance(model, dict):
            errors.append(f"{path}.model: must be object")
        else:
            for k in ("provider", "name"):
                if k not in model or not isinstance(model.get(k), str) or not model[k]:
                    errors.append(f"{path}.model.{k}: required non-empty string")

    if "input" in data:
        validate_message(data["input"], f"{path}.input", errors, role_allowed={"user", "system"})
    if "output" in data:
        validate_message(data["output"], f"{path}.output", errors, role_allowed={"assistant"})

    tools = data.get("tool_events")
    if tools is not None:
        if not isinstance(tools, list):
            errors.append(f"{path}.tool_events: must be array")
        else:
            for i, ev in enumerate(tools):
                validate_tool_event(ev, f"{path}.tool_events[{i}]", errors)

    meta = data.get("meta")
    if meta is not None and not isinstance(meta, dict):
        errors.append(f"{path}.meta: must be object")

    return errors


def try_jsonschema_validate(schema: dict[str, Any], data: Any) -> list[str] | None:
    try:
        import jsonschema
        from jsonschema import Draft202012Validator
    except ImportError:
        return None

    validator = Draft202012Validator(schema)
    return sorted(
        f"{'/'.join(str(p) for p in e.path) or '$'}: {e.message}"
        for e in validator.iter_errors(data)
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=None,
        help="Repository root (default: parent of scripts/)",
    )
    args = parser.parse_args()
    root = args.root or Path(__file__).resolve().parent.parent
    contract = root / "contracts" / "chat-corpus-v1"
    schema_path = contract / "chat-turn-record.schema.json"
    examples_dir = contract / "examples"

    failures = 0

    def fail(msg: str) -> None:
        nonlocal failures
        failures += 1
        print(f"FAIL: {msg}", file=sys.stderr)

    def ok(msg: str) -> None:
        print(f"OK: {msg}")

    if not schema_path.is_file():
        fail(f"missing {schema_path.relative_to(root)}")
        return 1

    try:
        schema = load_json(schema_path)
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"schema not loadable: {exc}")
        return 1

    required = schema.get("required")
    if not isinstance(required, list) or "schema_version" not in required:
        fail("schema must require schema_version")
    else:
        ok("schema requires schema_version")

    sv = schema.get("properties", {}).get("schema_version", {})
    if sv.get("const") != 1:
        fail("schema_version const must be 1")
    else:
        ok("schema_version const is 1")

    if not examples_dir.is_dir():
        fail("missing examples/")
        return 1

    examples = sorted(examples_dir.glob("chat-turn.*.json"))
    if not examples:
        fail("no chat-turn.*.json examples")
        return 1

    for ex in examples:
        rel = ex.relative_to(root)
        try:
            data = load_json(ex)
        except (OSError, json.JSONDecodeError) as exc:
            fail(f"{rel}: {exc}")
            continue

        js_errors = try_jsonschema_validate(schema, data)
        if js_errors is not None:
            if js_errors:
                for e in js_errors:
                    fail(f"{rel}: jsonschema: {e}")
            else:
                ok(f"{rel} (jsonschema)")
        else:
            std_errors = validate_record_stdlib(data)
            if std_errors:
                for e in std_errors:
                    fail(f"{rel}: {e}")
            else:
                ok(f"{rel} (stdlib subset)")

        # Always verify content hashes even when jsonschema skips custom hash check
        if isinstance(data, dict):
            for side in ("input", "output"):
                msg = data.get(side)
                if isinstance(msg, dict) and isinstance(msg.get("content"), str):
                    digest = msg.get("content_sha256")
                    expected = content_sha256(msg["content"])
                    if digest != expected:
                        fail(f"{rel}: {side}.content_sha256 mismatch (expected {expected})")

    # Negative cases
    negatives: list[tuple[str, Any]] = [
        ("missing schema_version", {
            "record_type": "chat_turn",
            "tenant_id": "t",
            "user_id": "u",
            "instance_id": "i",
            "thread_id": "th",
            "turn_id": "tu",
            "created_at": "2026-08-07T00:00:00Z",
            "model": {"provider": "p", "name": "m"},
            "input": {
                "role": "user",
                "content": "x",
                "content_sha256": content_sha256("x"),
            },
            "output": {
                "role": "assistant",
                "content": "y",
                "content_sha256": content_sha256("y"),
            },
            "tool_events": [],
            "meta": {},
        }),
        ("wrong schema_version", {
            "schema_version": 2,
            "record_type": "chat_turn",
            "tenant_id": "t",
            "user_id": "u",
            "instance_id": "i",
            "thread_id": "th",
            "turn_id": "tu",
            "created_at": "2026-08-07T00:00:00Z",
            "model": {"provider": "p", "name": "m"},
            "input": {
                "role": "user",
                "content": "x",
                "content_sha256": content_sha256("x"),
            },
            "output": {
                "role": "assistant",
                "content": "y",
                "content_sha256": content_sha256("y"),
            },
            "tool_events": [],
            "meta": {},
        }),
        ("bad content hash", {
            "schema_version": 1,
            "record_type": "chat_turn",
            "tenant_id": "t",
            "user_id": "u",
            "instance_id": "i",
            "thread_id": "th",
            "turn_id": "tu",
            "created_at": "2026-08-07T00:00:00Z",
            "model": {"provider": "p", "name": "m"},
            "input": {
                "role": "user",
                "content": "x",
                "content_sha256": "0" * 64,
            },
            "output": {
                "role": "assistant",
                "content": "y",
                "content_sha256": content_sha256("y"),
            },
            "tool_events": [],
            "meta": {},
        }),
        ("wrong record_type", {
            "schema_version": 1,
            "record_type": "message",
            "tenant_id": "t",
            "user_id": "u",
            "instance_id": "i",
            "thread_id": "th",
            "turn_id": "tu",
            "created_at": "2026-08-07T00:00:00Z",
            "model": {"provider": "p", "name": "m"},
            "input": {
                "role": "user",
                "content": "x",
                "content_sha256": content_sha256("x"),
            },
            "output": {
                "role": "assistant",
                "content": "y",
                "content_sha256": content_sha256("y"),
            },
            "tool_events": [],
            "meta": {},
        }),
    ]

    for name, payload in negatives:
        js_errors = try_jsonschema_validate(schema, payload)
        std_errors = validate_record_stdlib(payload)
        # For hash mismatch, jsonschema alone may accept (pattern only) — stdlib checks hash
        rejected = False
        if js_errors is not None and js_errors:
            rejected = True
        if std_errors:
            rejected = True
        if name == "bad content hash":
            # Explicit integrity check
            rejected = True if std_errors else rejected
            if not any("content_sha256" in e for e in std_errors):
                # force hash check
                rejected = content_sha256(payload["input"]["content"]) != payload["input"][
                    "content_sha256"
                ]
        if not rejected:
            fail(f"negative case should reject: {name}")
        else:
            ok(f"negative rejected: {name}")

    if failures:
        print(f"\n{failures} failure(s)", file=sys.stderr)
        return 1
    print("\nAll chat-turn-record checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
