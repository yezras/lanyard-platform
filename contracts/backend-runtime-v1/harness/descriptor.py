"""CapabilityDescriptor helpers for the relay handshake reply."""

from __future__ import annotations

from typing import Any, Mapping

from .frames import LANYARD_WEB_PLATFORM, RELAY_CONTRACT_VERSION, FrameError

REQUIRED_DESCRIPTOR_KEYS = (
    "contract_version",
    "platform",
    "label",
    "max_message_length",
    "supports_draft_streaming",
    "supports_edit",
    "supports_threads",
    "markdown_dialect",
    "len_unit",
)

DESCRIPTOR_DEFAULTS: dict[str, Any] = {
    "emoji": "\U0001f50c",
    "platform_hint": "",
    "pii_safe": False,
}


def create_lanyard_web_descriptor(
    overrides: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Portal web adapter descriptor advertised at relay handshake."""
    descriptor: dict[str, Any] = {
        "contract_version": RELAY_CONTRACT_VERSION,
        "platform": LANYARD_WEB_PLATFORM,
        "label": "Lanyard Web Portal (conformance harness)",
        "max_message_length": 32_000,
        "supports_draft_streaming": True,
        "supports_edit": True,
        "supports_threads": False,
        "markdown_dialect": "plain",
        "len_unit": "chars",
        "emoji": "\U0001f9f5",
        "platform_hint": (
            "You are chatting through the Lanyard Web Portal "
            "conformance harness. Responses stream as markdown."
        ),
        "pii_safe": False,
    }
    if overrides:
        descriptor.update(dict(overrides))
    return descriptor


def is_valid_capability_descriptor(value: Any) -> bool:
    if not isinstance(value, Mapping):
        return False
    d = value
    if not isinstance(d.get("contract_version"), int):
        return False
    if not isinstance(d.get("platform"), str) or not d["platform"]:
        return False
    if not isinstance(d.get("label"), str) or not d["label"]:
        return False
    if not isinstance(d.get("max_message_length"), int):
        return False
    for key in (
        "supports_draft_streaming",
        "supports_edit",
        "supports_threads",
    ):
        if not isinstance(d.get(key), bool):
            return False
    if not isinstance(d.get("markdown_dialect"), str):
        return False
    if d.get("len_unit") not in ("chars", "utf16"):
        return False
    return True


def validate_descriptor_frame(frame: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(frame, Mapping) or frame.get("type") != "descriptor":
        raise FrameError("expected type=descriptor")
    descriptor = frame.get("descriptor")
    if not is_valid_capability_descriptor(descriptor):
        raise FrameError("descriptor payload missing required CapabilityDescriptor fields")
    missing = [k for k in REQUIRED_DESCRIPTOR_KEYS if k not in descriptor]
    if missing:
        raise FrameError(f"CapabilityDescriptor missing fields: {', '.join(missing)}")
    return {"type": "descriptor", "descriptor": dict(descriptor)}
