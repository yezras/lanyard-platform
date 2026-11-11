"""Relay v1 NDJSON frame helpers for the offline fake relay harness.

Wire shape mirrors Portal ``@lanyard/shared`` relay types and Hermes
``relay-connector-contract.md`` (contract.relay: 1).

Direction (Portal relay = connector side):

* gateway → connector: hello, outbound, interrupt, going_idle, inbound_ack,
  brain_rpc_result
* connector → gateway: descriptor, inbound, outbound_result, interrupt_inbound,
  going_idle_ack, brain_rpc_request

No network I/O; frames are plain dicts serialized as newline-delimited JSON.
"""

from __future__ import annotations

import json
from typing import Any, Mapping

RELAY_CONTRACT_VERSION = 1
LANYARD_WEB_PLATFORM = "lanyard_web"
BRAIN_RPC_CONTRACT_VERSION = 1
BRAIN_RPC_DEFAULT_TIMEOUT_MS = 10_000
BRAIN_RPC_MAX_TIMEOUT_MS = 30_000

GATEWAY_TO_CONNECTOR_TYPES = frozenset(
    {
        "hello",
        "outbound",
        "interrupt",
        "going_idle",
        "inbound_ack",
        "brain_rpc_result",
    }
)
CONNECTOR_TO_GATEWAY_TYPES = frozenset(
    {
        "descriptor",
        "inbound",
        "outbound_result",
        "interrupt_inbound",
        "going_idle_ack",
        "brain_rpc_request",
    }
)
ALL_FRAME_TYPES = GATEWAY_TO_CONNECTOR_TYPES | CONNECTOR_TO_GATEWAY_TYPES


class FrameError(ValueError):
    """Raised when a relay frame is missing or invalid."""


def serialize_frame(frame: Mapping[str, Any]) -> str:
    """Serialize one frame as a single NDJSON line (trailing newline)."""
    if not isinstance(frame, Mapping) or "type" not in frame:
        raise FrameError("relay frame must be an object with a type field")
    return json.dumps(dict(frame), separators=(",", ":"), ensure_ascii=False) + "\n"


def parse_frame(line: str) -> dict[str, Any]:
    """Parse one NDJSON line into a frame dict."""
    trimmed = line.strip()
    if not trimmed:
        raise FrameError("empty relay frame line")
    try:
        parsed = json.loads(trimmed)
    except json.JSONDecodeError as exc:
        raise FrameError(f"invalid JSON frame: {exc}") from exc
    if not isinstance(parsed, dict) or "type" not in parsed:
        raise FrameError("relay frame missing type field")
    if not isinstance(parsed["type"], str) or not parsed["type"]:
        raise FrameError("relay frame type must be a non-empty string")
    return parsed


def parse_frame_buffer(buffer: str) -> list[dict[str, Any]]:
    """Parse a multi-line NDJSON buffer into frames (blank lines ignored)."""
    frames: list[dict[str, Any]] = []
    for line in buffer.split("\n"):
        if not line.strip():
            continue
        frames.append(parse_frame(line))
    return frames


def require_non_empty_str(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise FrameError(f"{field} must be a non-empty string")
    return value


def validate_hello_frame(frame: Mapping[str, Any]) -> dict[str, str]:
    """Validate a gateway hello frame.

    Required fields (Hermes/Portal wire):
      type == "hello", platform (str), botId (str)

    Returns a normalized ``{"type","platform","botId"}`` dict.
    """
    if not isinstance(frame, Mapping):
        raise FrameError("hello frame must be an object")
    if frame.get("type") != "hello":
        raise FrameError(f"expected type=hello, got {frame.get('type')!r}")
    platform = require_non_empty_str(frame.get("platform"), "hello.platform")
    bot_id = require_non_empty_str(frame.get("botId"), "hello.botId")
    return {"type": "hello", "platform": platform, "botId": bot_id}


def is_hello_frame(frame: Mapping[str, Any] | None) -> bool:
    if not isinstance(frame, Mapping):
        return False
    try:
        validate_hello_frame(frame)
        return True
    except FrameError:
        return False


def is_brain_rpc_request(frame: Mapping[str, Any] | None) -> bool:
    return isinstance(frame, Mapping) and frame.get("type") == "brain_rpc_request"


def is_brain_rpc_result(frame: Mapping[str, Any] | None) -> bool:
    return isinstance(frame, Mapping) and frame.get("type") == "brain_rpc_result"


def clamp_brain_rpc_timeout_ms(timeout_ms: int | float | None = None) -> int:
    if timeout_ms is None:
        return BRAIN_RPC_DEFAULT_TIMEOUT_MS
    try:
        n = int(timeout_ms)
    except (TypeError, ValueError):
        return BRAIN_RPC_DEFAULT_TIMEOUT_MS
    if n < 1:
        return BRAIN_RPC_DEFAULT_TIMEOUT_MS
    return min(n, BRAIN_RPC_MAX_TIMEOUT_MS)


def make_hello(platform: str = LANYARD_WEB_PLATFORM, bot_id: str = "bot-conformance") -> dict[str, Any]:
    return {"type": "hello", "platform": platform, "botId": bot_id}


def make_inbound(
    text: str,
    *,
    chat_id: str = "chat-conformance",
    user_id: str = "user-conformance",
    platform: str = LANYARD_WEB_PLATFORM,
    message_id: str | None = None,
    buffer_id: str | None = None,
    metadata: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a connector→gateway inbound chat frame (Portal inject path)."""
    event: dict[str, Any] = {
        "text": text,
        "message_type": "text",
        "source": {
            "platform": platform,
            "chat_id": chat_id,
            "chat_type": "dm",
            "chat_name": "Conformance Chat",
            "user_id": user_id,
            "user_name": "Conformance User",
            "thread_id": None,
            "chat_topic": None,
            "profile": "default",
        },
    }
    if message_id is not None:
        event["message_id"] = message_id
    if metadata is not None:
        event["metadata"] = dict(metadata)
    frame: dict[str, Any] = {"type": "inbound", "event": event}
    if buffer_id is not None:
        frame["bufferId"] = buffer_id
    return frame


def make_interrupt_inbound(
    session_key: str,
    chat_id: str,
) -> dict[str, Any]:
    """Build connector→gateway mid-turn interrupt (Portal interrupt path)."""
    return {
        "type": "interrupt_inbound",
        "session_key": require_non_empty_str(session_key, "session_key"),
        "chat_id": require_non_empty_str(chat_id, "chat_id"),
    }


def make_brain_rpc_request(
    method: str,
    *,
    request_id: str,
    params: Mapping[str, Any] | None = None,
    tenant_id: str = "ten_conformance",
    instance_id: str = "inst_conformance",
    portal_user_id: str = "usr_conformance",
    backend_profile: str = "contributor",
    roles: list[str] | None = None,
    path_prefixes: list[str] | None = None,
    session_id: str = "sess_conformance",
    timeout_ms: int | None = None,
    issued_at: str = "2026-07-12T00:00:00.000Z",
    expires_at: str = "2026-07-12T00:05:00.000Z",
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    """Build connector→gateway brain_rpc_request frame."""
    subject: dict[str, Any] = {
        "portal_user_id": portal_user_id,
        "backend_profile": backend_profile,
        "hermes_profile": backend_profile,  # wire alias used by Hermes-Lanyard today
        "roles": list(roles) if roles is not None else [backend_profile],
        "path_prefixes": list(path_prefixes) if path_prefixes is not None else ["/"],
    }
    return {
        "type": "brain_rpc_request",
        "contract_version": BRAIN_RPC_CONTRACT_VERSION,
        "request_id": require_non_empty_str(request_id, "request_id"),
        "method": require_non_empty_str(method, "method"),
        "timeout_ms": clamp_brain_rpc_timeout_ms(timeout_ms),
        "auth": {
            "tenant_id": tenant_id,
            "instance_id": instance_id,
            "subject": subject,
            "session_id": session_id,
            "issued_at": issued_at,
            "expires_at": expires_at,
        },
        "params": dict(params) if params is not None else {},
        "idempotency_key": idempotency_key,
    }


def make_brain_rpc_result(
    request_id: str,
    *,
    ok: bool = True,
    result: Any = None,
    error: Mapping[str, Any] | None = None,
    meta: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    frame: dict[str, Any] = {
        "type": "brain_rpc_result",
        "contract_version": BRAIN_RPC_CONTRACT_VERSION,
        "request_id": require_non_empty_str(request_id, "request_id"),
        "ok": bool(ok),
        "result": result if ok else None,
        "error": None if ok else (dict(error) if error is not None else {
            "code": "internal",
            "message": "unspecified error",
            "retryable": False,
        }),
    }
    if meta is not None:
        frame["meta"] = dict(meta)
    return frame


def make_outbound_send(
    content: str,
    *,
    request_id: str = "req-send-1",
    chat_id: str = "chat-conformance",
    platform: str = LANYARD_WEB_PLATFORM,
) -> dict[str, Any]:
    return {
        "type": "outbound",
        "requestId": request_id,
        "action": {
            "op": "send",
            "chat_id": chat_id,
            "content": content,
        },
        "platform": platform,
    }


def make_outbound_result(
    request_id: str,
    *,
    success: bool = True,
    message_id: str | None = "m1",
    error: str | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {"success": success}
    if message_id is not None:
        result["message_id"] = message_id
    if error is not None:
        result["error"] = error
    return {
        "type": "outbound_result",
        "requestId": request_id,
        "result": result,
    }
