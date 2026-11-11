#!/usr/bin/env python3
"""Offline validation for group-rooms-v1 (lac-bx3.9).

Validates:
  - contracts/group-rooms-v1/group-rooms.schema.json is loadable
  - required $defs exist (speaker, wakeDecision, inbound/outbound, thread)
  - examples under contracts/group-rooms-v1/examples/ conform
  - fake-gateway fixture loads through the backend-runtime-v1 harness
  - speaker persona that is not a participant is rejected
  - structural negatives (colon in id, empty persona roster, loop_notice
    with targets, inbound missing target_persona_ids) reject

Uses jsonschema when installed; otherwise a stdlib subset checker.
No network calls.

Usage (from repository root):
  python3 scripts/validate-group-rooms.py
  python3 scripts/validate-group-rooms.py --root /path/to/repo

Exit 0 on success; non-zero on failure.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

ID_RE = re.compile(r"^[^:\s]+$")
WAKE_REASONS = frozenset({"orchestrator", "mention", "keyword", "hop"})
CHAT_TYPES = frozenset({"dm", "group", "channel", "thread", "forum"})
OUTBOUND_OPS = frozenset({"send", "edit", "typing", "follow_up", "get_chat_info"})

REQUIRED_DEFS = (
    "speaker",
    "humanSpeaker",
    "personaSpeaker",
    "historySpeaker",
    "wakeDecision",
    "wakeReason",
    "groupInboundMetadata",
    "groupOutboundMetadata",
    "groupInbound",
    "inboundFrame",
    "outboundFrame",
    "groupThread",
    "fakeGatewayFixture",
    "personaId",
    "threadId",
)

EXAMPLE_PREFIX_TO_DEF = (
    ("speaker.", "speaker"),
    ("wake-decision.", "wakeDecision"),
    ("inbound.", "inboundFrame"),
    ("outbound.", "outboundFrame"),
    ("thread.", "groupThread"),
)

SPEAKER_KEYS_HUMAN = frozenset({"kind", "user_id", "display_name"})
SPEAKER_KEYS_PERSONA = frozenset({"kind", "persona_id", "display_name"})
HISTORY_SPEAKER_KEYS = frozenset({"kind", "id", "display_name"})
WAKE_KEYS = frozenset({"target_persona_ids", "reason"})


def fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)


def ok(msg: str) -> None:
    print(f"OK: {msg}")


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def is_id(value: Any) -> bool:
    return isinstance(value, str) and bool(value) and ID_RE.match(value) is not None


def def_for_example(name: str) -> str | None:
    for prefix, def_name in EXAMPLE_PREFIX_TO_DEF:
        if name.startswith(prefix):
            return def_name
    return None


def try_jsonschema_validate(schema: dict[str, Any], def_name: str, data: Any) -> list[str] | None:
    try:
        from jsonschema import Draft202012Validator
    except ImportError:
        return None

    sub = {
        "$schema": schema.get("$schema", "https://json-schema.org/draft/2020-12/schema"),
        "$defs": schema.get("$defs", {}),
        "$ref": f"#/$defs/{def_name}",
    }
    validator = Draft202012Validator(sub)
    return sorted(
        f"{'/'.join(str(p) for p in e.path) or '$'}: {e.message}"
        for e in validator.iter_errors(data)
    )


def validate_speaker(payload: Any, path: str = "$") -> list[str]:
    errors: list[str] = []
    if not isinstance(payload, dict):
        return [f"{path}: must be object"]
    kind = payload.get("kind")
    if kind == "human":
        unknown = set(payload) - SPEAKER_KEYS_HUMAN
        if unknown:
            errors.append(f"{path}: unknown properties {sorted(unknown)}")
        if not is_id(payload.get("user_id")):
            errors.append(f"{path}.user_id: required id without ':' or whitespace")
        if "persona_id" in payload:
            errors.append(f"{path}: human speaker must not have persona_id")
    elif kind == "persona":
        unknown = set(payload) - SPEAKER_KEYS_PERSONA
        if unknown:
            errors.append(f"{path}: unknown properties {sorted(unknown)}")
        if not is_id(payload.get("persona_id")):
            errors.append(f"{path}.persona_id: required id without ':' or whitespace")
        if "user_id" in payload:
            errors.append(f"{path}: persona speaker must not have user_id")
    else:
        errors.append(f"{path}.kind: must be 'human' or 'persona'")
    display = payload.get("display_name")
    if display is not None and (not isinstance(display, str) or not display):
        errors.append(f"{path}.display_name: must be non-empty string when set")
    return errors


def validate_history_speaker(payload: Any, path: str = "$") -> list[str]:
    errors: list[str] = []
    if not isinstance(payload, dict):
        return [f"{path}: must be object"]
    unknown = set(payload) - HISTORY_SPEAKER_KEYS
    if unknown:
        errors.append(f"{path}: unknown properties {sorted(unknown)}")
    if payload.get("kind") not in {"human", "persona"}:
        errors.append(f"{path}.kind: must be 'human' or 'persona'")
    if not is_id(payload.get("id")):
        errors.append(f"{path}.id: required id without ':' or whitespace")
    display = payload.get("display_name")
    if not isinstance(display, str) or not display:
        errors.append(f"{path}.display_name: required non-empty string")
    return errors


def validate_wake(payload: Any, path: str = "$") -> list[str]:
    errors: list[str] = []
    if not isinstance(payload, dict):
        return [f"{path}: must be object"]
    unknown = set(payload) - WAKE_KEYS
    if unknown:
        errors.append(f"{path}: unknown properties {sorted(unknown)}")
    if "target_persona_ids" not in payload or "reason" not in payload:
        errors.append(f"{path}: required target_persona_ids and reason")
        return errors
    targets = payload.get("target_persona_ids")
    reason = payload.get("reason")
    if not isinstance(targets, list):
        errors.append(f"{path}.target_persona_ids: must be array")
        targets = []
    else:
        if len(targets) != len(set(targets)):
            errors.append(f"{path}.target_persona_ids: must be unique")
        for i, pid in enumerate(targets):
            if not is_id(pid):
                errors.append(f"{path}.target_persona_ids[{i}]: invalid persona id")
    if reason == "loop_notice":
        if targets:
            errors.append(f"{path}: loop_notice requires empty target_persona_ids")
    elif reason in WAKE_REASONS:
        if not targets:
            errors.append(f"{path}: non-loop wake requires ≥1 target_persona_ids")
    else:
        errors.append(f"{path}.reason: invalid {reason!r}")
    return errors


def validate_session_source(payload: Any, path: str) -> list[str]:
    errors: list[str] = []
    if not isinstance(payload, dict):
        return [f"{path}: must be object"]
    for key in (
        "platform",
        "chat_id",
        "chat_type",
        "chat_name",
        "user_id",
        "user_name",
        "thread_id",
        "chat_topic",
    ):
        if key not in payload:
            errors.append(f"{path}: missing required '{key}'")
    if payload.get("chat_type") not in CHAT_TYPES:
        errors.append(f"{path}.chat_type: invalid")
    platform = payload.get("platform")
    if not isinstance(platform, str) or not platform:
        errors.append(f"{path}.platform: non-empty string")
    chat_id = payload.get("chat_id")
    if not isinstance(chat_id, str) or not chat_id:
        errors.append(f"{path}.chat_id: non-empty string")
    return errors


def validate_inbound_metadata(payload: Any, path: str) -> list[str]:
    errors: list[str] = []
    if not isinstance(payload, dict):
        return [f"{path}: must be object"]
    targets = payload.get("target_persona_ids")
    if not isinstance(targets, list) or not targets:
        errors.append(f"{path}.target_persona_ids: required non-empty array")
        targets = []
    else:
        for i, pid in enumerate(targets):
            if not is_id(pid):
                errors.append(f"{path}.target_persona_ids[{i}]: invalid persona id")
    reason = payload.get("wake_reason")
    if reason not in WAKE_REASONS:
        errors.append(f"{path}.wake_reason: required non-loop wake reason")
    target_one = payload.get("target_persona_id")
    if target_one is not None:
        if not is_id(target_one):
            errors.append(f"{path}.target_persona_id: invalid persona id")
        elif target_one not in targets:
            errors.append(f"{path}.target_persona_id: must be a member of target_persona_ids")
    lead = payload.get("lead_persona_id")
    if not is_id(lead):
        errors.append(f"{path}.lead_persona_id: required persona id")
    elif reason == "orchestrator" and targets != [lead]:
        errors.append(
            f"{path}: unmentioned orchestrator wake must stamp target_persona_ids=[lead_persona_id]"
        )
    return errors


def validate_inbound_frame(payload: Any, path: str = "$") -> list[str]:
    errors: list[str] = []
    if not isinstance(payload, dict):
        return [f"{path}: must be object"]
    if payload.get("type") != "inbound":
        errors.append(f"{path}.type: must be 'inbound'")
    event = payload.get("event")
    if not isinstance(event, dict):
        errors.append(f"{path}.event: must be object")
        return errors
    if "text" not in event:
        errors.append(f"{path}.event.text: required")
    elif not isinstance(event["text"], str):
        errors.append(f"{path}.event.text: must be string")
    if not isinstance(event.get("message_type"), str) or not event.get("message_type"):
        errors.append(f"{path}.event.message_type: required non-empty string")
    errors.extend(validate_session_source(event.get("source"), f"{path}.event.source"))
    errors.extend(validate_inbound_metadata(event.get("metadata"), f"{path}.event.metadata"))
    return errors


def validate_outbound_frame(payload: Any, path: str = "$") -> list[str]:
    errors: list[str] = []
    if not isinstance(payload, dict):
        return [f"{path}: must be object"]
    if payload.get("type") != "outbound":
        errors.append(f"{path}.type: must be 'outbound'")
    if not isinstance(payload.get("requestId"), str) or not payload.get("requestId"):
        errors.append(f"{path}.requestId: required non-empty string")
    action = payload.get("action")
    if not isinstance(action, dict):
        errors.append(f"{path}.action: must be object")
        return errors
    if action.get("op") not in OUTBOUND_OPS:
        errors.append(f"{path}.action.op: invalid")
    meta = action.get("metadata")
    if not isinstance(meta, dict):
        errors.append(f"{path}.action.metadata: required object")
        return errors
    if not is_id(meta.get("persona_id")):
        errors.append(f"{path}.action.metadata.persona_id: required persona id")
    errors.extend(validate_history_speaker(meta.get("speaker"), f"{path}.action.metadata.speaker"))
    speaker = meta.get("speaker")
    if isinstance(speaker, dict) and speaker.get("kind") == "persona":
        if speaker.get("id") != meta.get("persona_id"):
            errors.append(f"{path}: outbound speaker.id must equal persona_id")
    return errors


def validate_thread(payload: Any, path: str = "$") -> list[str]:
    errors: list[str] = []
    if not isinstance(payload, dict):
        return [f"{path}: must be object"]
    if payload.get("kind") != "group":
        errors.append(f"{path}.kind: must be 'group'")
    if not is_id(payload.get("thread_id")):
        errors.append(f"{path}.thread_id: required id without ':' or whitespace")
    parts = payload.get("participants")
    if not isinstance(parts, list) or len(parts) < 2:
        errors.append(f"{path}.participants: required array with ≥2 speakers")
        return errors
    humans = 0
    personas = 0
    for i, speaker in enumerate(parts):
        errors.extend(validate_speaker(speaker, f"{path}.participants[{i}]"))
        if isinstance(speaker, dict) and speaker.get("kind") == "human":
            humans += 1
        if isinstance(speaker, dict) and speaker.get("kind") == "persona":
            personas += 1
    if humans < 1:
        errors.append(f"{path}.participants: group thread requires ≥1 human")
    if personas < 1:
        errors.append(f"{path}.participants: group thread requires ≥1 persona")
    persona_ids = persona_ids_from_participants(parts)
    lead = payload.get("lead_persona_id")
    if not is_id(lead):
        errors.append(f"{path}.lead_persona_id: required persona id")
    elif lead not in persona_ids:
        errors.append(f"{path}.lead_persona_id: must be a persona participant")
    orch = payload.get("orchestrator_persona_id")
    if orch is not None and orch != lead:
        errors.append(
            f"{path}: orchestrator_persona_id must equal lead_persona_id"
        )
    return errors


def validate_fixture(payload: Any, path: str = "$") -> list[str]:
    errors: list[str] = []
    if not isinstance(payload, dict):
        return [f"{path}: must be object"]
    if payload.get("schema_version") != 1:
        errors.append(f"{path}.schema_version: must be 1")
    if payload.get("record_type") != "group_rooms_fake_gateway":
        errors.append(f"{path}.record_type: must be group_rooms_fake_gateway")
    errors.extend(validate_thread(payload.get("thread"), f"{path}.thread"))
    errors.extend(validate_wake(payload.get("wake"), f"{path}.wake"))
    errors.extend(validate_inbound_frame(payload.get("inbound"), f"{path}.inbound"))
    errors.extend(validate_outbound_frame(payload.get("outbound"), f"{path}.outbound"))
    errors.extend(room_invariants(payload, path))
    return errors


def persona_ids_from_participants(participants: Any) -> set[str]:
    ids: set[str] = set()
    if not isinstance(participants, list):
        return ids
    for speaker in participants:
        if isinstance(speaker, dict) and speaker.get("kind") == "persona":
            pid = speaker.get("persona_id")
            if isinstance(pid, str):
                ids.add(pid)
    return ids


def room_invariants(payload: Any, path: str = "$") -> list[str]:
    """Cross-field: every persona speaker/target must be a participant."""
    errors: list[str] = []
    if not isinstance(payload, dict):
        return errors
    thread = payload.get("thread")
    if not isinstance(thread, dict):
        return errors
    persona_ids = persona_ids_from_participants(thread.get("participants"))

    wake = payload.get("wake")
    if isinstance(wake, dict):
        targets = wake.get("target_persona_ids")
        if isinstance(targets, list):
            for pid in targets:
                if isinstance(pid, str) and pid not in persona_ids:
                    errors.append(f"{path}.wake: target {pid!r} is not a participant")

    inbound = payload.get("inbound")
    if isinstance(inbound, dict):
        event = inbound.get("event")
        if isinstance(event, dict):
            meta = event.get("metadata")
            if isinstance(meta, dict):
                targets = meta.get("target_persona_ids")
                if isinstance(targets, list):
                    for pid in targets:
                        if isinstance(pid, str) and pid not in persona_ids:
                            errors.append(
                                f"{path}.inbound: target {pid!r} is not a participant"
                            )
                one = meta.get("target_persona_id")
                if isinstance(one, str) and one not in persona_ids:
                    errors.append(
                        f"{path}.inbound: target_persona_id {one!r} is not a participant"
                    )
                lead = meta.get("lead_persona_id")
                if isinstance(lead, str) and lead not in persona_ids:
                    errors.append(
                        f"{path}.inbound: lead_persona_id {lead!r} is not a participant"
                    )

    outbound = payload.get("outbound")
    if isinstance(outbound, dict):
        action = outbound.get("action")
        if isinstance(action, dict):
            meta = action.get("metadata")
            if isinstance(meta, dict):
                pid = meta.get("persona_id")
                if isinstance(pid, str) and pid not in persona_ids:
                    errors.append(
                        f"{path}.outbound: persona {pid!r} is not a participant"
                    )
                speaker = meta.get("speaker")
                if isinstance(speaker, dict) and speaker.get("kind") == "persona":
                    sid = speaker.get("id")
                    if isinstance(sid, str) and sid not in persona_ids:
                        errors.append(
                            f"{path}.outbound: speaker persona {sid!r} is not a participant"
                        )
    return errors


STDLIB_BY_DEF = {
    "speaker": validate_speaker,
    "wakeDecision": validate_wake,
    "inboundFrame": validate_inbound_frame,
    "outboundFrame": validate_outbound_frame,
    "groupThread": validate_thread,
    "fakeGatewayFixture": validate_fixture,
    "historySpeaker": validate_history_speaker,
}


def validate_def_stdlib(def_name: str, data: Any) -> list[str]:
    fn = STDLIB_BY_DEF.get(def_name)
    if fn is None:
        return [f"no stdlib checker for $defs.{def_name}"]
    return fn(data)


def load_fake_gateway(root: Path, fixture: dict[str, Any]) -> None:
    """Inject the fixture inbound through FakeRelayHarness + FakeBackendClient."""
    harness_parent = root / "contracts" / "backend-runtime-v1"
    if str(harness_parent) not in sys.path:
        sys.path.insert(0, str(harness_parent))

    from harness.fake_backend import FakeBackendClient
    from harness.frames import parse_frame, serialize_frame
    from harness.harness import FakeRelayHarness
    from harness.mock_socket import MockSocket

    inbound = fixture["inbound"]
    outbound = fixture["outbound"]
    parsed_in = parse_frame(serialize_frame(inbound))
    parsed_out = parse_frame(serialize_frame(outbound))
    if parsed_in.get("type") != "inbound":
        raise RuntimeError("inbound frame did not round-trip as type=inbound")
    if parsed_out.get("type") != "outbound":
        raise RuntimeError("outbound frame did not round-trip as type=outbound")

    event = inbound["event"]
    meta = event["metadata"]
    relay_sock, gateway_sock = MockSocket.create_pair("relay", "gateway")
    harness = FakeRelayHarness(relay_sock)
    backend = FakeBackendClient(gateway_sock)
    backend.connect_hello()
    harness.accept_hello()
    backend.await_descriptor()
    harness.inject_chat(
        event["text"],
        chat_id=event["source"]["chat_id"],
        user_id=event["source"]["user_id"],
        message_id=event.get("message_id"),
        metadata=meta,
    )
    received = backend.frames_of_type("inbound")
    if len(received) != 1:
        raise RuntimeError(f"expected 1 inbound frame, got {len(received)}")
    got_targets = received[0]["event"].get("metadata", {}).get("target_persona_ids")
    if got_targets != meta["target_persona_ids"]:
        raise RuntimeError(
            f"fake gateway dropped target_persona_ids: {got_targets!r}"
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
    contract = root / "contracts" / "group-rooms-v1"
    schema_path = contract / "group-rooms.schema.json"
    examples_dir = contract / "examples"
    fixture_path = contract / "fixtures" / "fake-gateway-group-room.json"
    invalid_dir = contract / "fixtures" / "invalid"

    failures = 0

    def record_fail(msg: str) -> None:
        nonlocal failures
        failures += 1
        fail(msg)

    if not schema_path.is_file():
        record_fail(f"missing {schema_path.relative_to(root)}")
        return 1

    try:
        schema = load_json(schema_path)
    except (OSError, json.JSONDecodeError) as exc:
        record_fail(f"schema not loadable: {exc}")
        return 1

    defs = schema.get("$defs")
    if not isinstance(defs, dict):
        record_fail("schema missing $defs")
        return 1
    missing_defs = [name for name in REQUIRED_DEFS if name not in defs]
    if missing_defs:
        record_fail(f"schema missing $defs {missing_defs}")
    else:
        ok("schema $defs include Speaker, WakeDecision, inbound/outbound, thread")

    inbound_meta = defs.get("groupInboundMetadata", {})
    required_meta = inbound_meta.get("required") if isinstance(inbound_meta, dict) else None
    if not isinstance(required_meta, list) or "target_persona_ids" not in required_meta:
        record_fail("groupInboundMetadata must require target_persona_ids")
    else:
        ok("group inbound requires target_persona_ids")
    if not isinstance(required_meta, list) or "lead_persona_id" not in required_meta:
        record_fail("groupInboundMetadata must require lead_persona_id")
    else:
        ok("group inbound requires lead_persona_id")
    thread_def = defs.get("groupThread", {})
    required_thread = thread_def.get("required") if isinstance(thread_def, dict) else None
    if not isinstance(required_thread, list) or "lead_persona_id" not in required_thread:
        record_fail("groupThread must require lead_persona_id")
    else:
        ok("group thread requires lead_persona_id")

    if not examples_dir.is_dir():
        record_fail("missing examples/")
        return 1

    examples = sorted(p for p in examples_dir.glob("*.json") if p.is_file())
    if not examples:
        record_fail("no examples/*.json")
        return 1

    for ex in examples:
        rel = ex.relative_to(root)
        def_name = def_for_example(ex.name)
        if def_name is None:
            record_fail(f"{rel}: unknown example prefix")
            continue
        try:
            data = load_json(ex)
        except (OSError, json.JSONDecodeError) as exc:
            record_fail(f"{rel}: {exc}")
            continue

        js_errors = try_jsonschema_validate(schema, def_name, data)
        std_errors = validate_def_stdlib(def_name, data)
        if js_errors is not None:
            if js_errors:
                for err in js_errors:
                    record_fail(f"{rel}: jsonschema: {err}")
            else:
                ok(f"{rel} (jsonschema $defs.{def_name})")
        elif std_errors:
            for err in std_errors:
                record_fail(f"{rel}: {err}")
        else:
            ok(f"{rel} (stdlib subset $defs.{def_name})")

        if std_errors and js_errors is not None and not js_errors:
            for err in std_errors:
                record_fail(f"{rel}: stdlib extra: {err}")

    if not fixture_path.is_file():
        record_fail(f"missing {fixture_path.relative_to(root)}")
    else:
        rel = fixture_path.relative_to(root)
        try:
            fixture = load_json(fixture_path)
        except (OSError, json.JSONDecodeError) as exc:
            record_fail(f"{rel}: {exc}")
            fixture = None
        if isinstance(fixture, dict):
            js_errors = try_jsonschema_validate(schema, "fakeGatewayFixture", fixture)
            std_errors = validate_fixture(fixture)
            if js_errors is not None:
                if js_errors:
                    for err in js_errors:
                        record_fail(f"{rel}: jsonschema: {err}")
                else:
                    ok(f"{rel} (jsonschema)")
            if std_errors:
                if js_errors is None:
                    for err in std_errors:
                        record_fail(f"{rel}: {err}")
                elif not js_errors:
                    for err in std_errors:
                        record_fail(f"{rel}: stdlib extra: {err}")
            elif js_errors is None:
                ok(f"{rel} (stdlib subset)")
            try:
                load_fake_gateway(root, fixture)
            except Exception as exc:  # noqa: BLE001 — prove load, surface any harness error
                record_fail(f"{rel}: fake-gateway load: {exc}")
            else:
                ok(f"{rel} loaded through FakeRelayHarness")

    # Invalid fixtures must reject (speaker-not-participant is the P2 row).
    if not invalid_dir.is_dir():
        record_fail("missing fixtures/invalid/")
    else:
        invalids = sorted(p for p in invalid_dir.glob("*.json") if p.is_file())
        if not invalids:
            record_fail("no fixtures/invalid/*.json")
        for inv in invalids:
            rel = inv.relative_to(root)
            try:
                data = load_json(inv)
            except (OSError, json.JSONDecodeError) as exc:
                record_fail(f"{rel}: {exc}")
                continue
            js_errors = try_jsonschema_validate(schema, "fakeGatewayFixture", data)
            std_errors = validate_fixture(data)
            invariant_errors = room_invariants(data)
            rejected = bool(std_errors or invariant_errors or (js_errors or []))
            speaker_rejected = any("not a participant" in e for e in std_errors + invariant_errors)
            if inv.name == "speaker-not-participant.json" and not speaker_rejected:
                record_fail(f"{rel}: must reject speaker persona that is not a participant")
            elif not rejected:
                record_fail(f"{rel}: invalid fixture should reject")
            else:
                ok(f"negative rejected: {rel}")

    colon_speaker = {"kind": "persona", "persona_id": "skip:main"}
    js_errors = try_jsonschema_validate(schema, "speaker", colon_speaker)
    std_errors = validate_speaker(colon_speaker)
    if (js_errors is not None and not js_errors) and not std_errors:
        record_fail("negative case should reject: persona_id containing ':'")
    else:
        ok("negative rejected: persona_id containing ':'")

    no_persona_thread = {
        "kind": "group",
        "thread_id": "room-humans",
        "participants": [
            {"kind": "human", "user_id": "usr_alice"},
            {"kind": "human", "user_id": "usr_bob"},
        ],
    }
    js_errors = try_jsonschema_validate(schema, "groupThread", no_persona_thread)
    std_errors = validate_thread(no_persona_thread)
    if (js_errors is not None and not js_errors) and not std_errors:
        record_fail("negative case should reject: group with zero persona participants")
    else:
        ok("negative rejected: group with zero persona participants")

    loop_with_targets = {"target_persona_ids": ["skip"], "reason": "loop_notice"}
    js_errors = try_jsonschema_validate(schema, "wakeDecision", loop_with_targets)
    std_errors = validate_wake(loop_with_targets)
    if (js_errors is not None and not js_errors) and not std_errors:
        record_fail("negative case should reject: loop_notice with targets")
    else:
        ok("negative rejected: loop_notice with targets")

    inbound_missing_targets = {
        "type": "inbound",
        "event": {
            "text": "hi",
            "message_type": "text",
            "source": {
                "platform": "lanyard_web",
                "chat_id": "room-1",
                "chat_type": "dm",
                "chat_name": "x",
                "user_id": "usr_alice",
                "user_name": "Alice",
                "thread_id": None,
                "chat_topic": None,
            },
            "metadata": {"wake_reason": "orchestrator"},
        },
    }
    js_errors = try_jsonschema_validate(schema, "inboundFrame", inbound_missing_targets)
    std_errors = validate_inbound_frame(inbound_missing_targets)
    if (js_errors is not None and not js_errors) and not std_errors:
        record_fail("negative case should reject: inbound missing target_persona_ids")
    else:
        ok("negative rejected: inbound missing target_persona_ids")

    inbound_missing_lead = {
        "type": "inbound",
        "event": {
            "text": "hi",
            "message_type": "text",
            "source": {
                "platform": "lanyard_web",
                "chat_id": "room-1",
                "chat_type": "dm",
                "chat_name": "x",
                "user_id": "usr_alice",
                "user_name": "Alice",
                "thread_id": None,
                "chat_topic": None,
            },
            "metadata": {
                "target_persona_ids": ["skip"],
                "wake_reason": "orchestrator",
            },
        },
    }
    js_errors = try_jsonschema_validate(schema, "inboundFrame", inbound_missing_lead)
    std_errors = validate_inbound_frame(inbound_missing_lead)
    if (js_errors is not None and not js_errors) and not std_errors:
        record_fail("negative case should reject: inbound missing lead_persona_id")
    else:
        ok("negative rejected: inbound missing lead_persona_id")

    lead_not_member = {
        "kind": "group",
        "thread_id": "room-1",
        "lead_persona_id": "ghost",
        "participants": [
            {"kind": "human", "user_id": "usr_alice"},
            {"kind": "persona", "persona_id": "skip"},
        ],
    }
    js_errors = try_jsonschema_validate(schema, "groupThread", lead_not_member)
    std_errors = validate_thread(lead_not_member)
    # JSON Schema cannot express "lead is a participant"; stdlib must reject.
    if not std_errors:
        record_fail("negative case should reject: lead_persona_id not a participant")
    else:
        ok("negative rejected: lead_persona_id not a participant")
    _ = js_errors

    if failures:
        print(f"\n{failures} failure(s)", file=sys.stderr)
        return 1
    print("\nAll group-rooms-v1 checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
