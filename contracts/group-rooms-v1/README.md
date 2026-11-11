# group-rooms-v1

Shared inbound / outbound / speaker JSON for group agent rooms.

**Plan:** lanyard-agent `docs/plans/09-group-agent-rooms/phase-2-platform-contract.md`  
**Bead:** `lac-bx3.9` (epic `lac-bx3`)  
**Type sketch:** `docs/plans/09-group-agent-rooms/phase-0-docs-and-types.md`

Both repos compile against this directory. Platform owns the JSON. Agent and Portal parse at their boundaries.

## Files

| Path | Role |
|------|------|
| [`group-rooms.schema.json`](./group-rooms.schema.json) | Draft 2020-12 `$defs` for Speaker, WakeDecision, inbound/outbound, group thread, fake-gateway fixture |
| [`examples/`](./examples/) | Valid fragments (filename prefix selects the `$defs` entry) |
| [`fixtures/fake-gateway-group-room.json`](./fixtures/fake-gateway-group-room.json) | Loadable fake-gateway document (wake + inbound + outbound) |
| [`fixtures/invalid/`](./fixtures/invalid/) | Payloads the validator must reject |

## Wire names

Domain types in the type sketch are camelCase. The wire is snake_case.

| Domain | Wire |
|--------|------|
| `PersonaId` / `ThreadId` | string, no `:` |
| `Speaker` | `{kind:"human", user_id}` \| `{kind:"persona", persona_id}` |
| History / outbound speaker | `{kind, id, display_name}` |
| `WakeDecision` | `{target_persona_ids, reason}` |
| Group inbound metadata | `target_persona_ids`, `target_persona_id`, `lead_persona_id`, `wake_reason`, `mentioned_persona_ids`, `mentioned_user_ids` |
| Group thread | `lead_persona_id` (unmentioned-wake persona; equals `orchestrator_persona_id`) |
| Group outbound metadata | `persona_id`, `speaker` |

Relay `source.chat_type` stays `dm`. Product kind is `ChatThread.kind = "group"`. Session key: `agent:<personaId>:relay:dm:<threadId>` (1:1 keeps `main`).

## Illegal states

JSON Schema rejects:

- `PersonaId` / `ThreadId` / `user_id` containing `:`
- `kind=group` with no persona participant or no human participant
- `WakeDecision` `loop_notice` with a non-empty target list, or a non-loop reason with an empty list
- Group inbound missing `target_persona_ids` / `wake_reason` / `lead_persona_id`
- Group thread missing `lead_persona_id`

`scripts/validate-group-rooms.py` additionally rejects:

- A persona speaker (participant, inbound target, lead, or outbound) that is not a room participant
- Outbound `speaker.id` ≠ `persona_id` when `kind=persona`
- Unmentioned `wake_reason=orchestrator` inbound whose `target_persona_ids` is not `[lead_persona_id]`

## Validation

```bash
python3 scripts/validate-group-rooms.py
# also: bash scripts/validate.sh  (check 33)
```

The fake-gateway fixture is injected through `contracts/backend-runtime-v1/harness` (`FakeRelayHarness` + `FakeBackendClient`) over `MockSocket`. No network.

## Non-goals (this package)

- Wake policy implementation (P3)
- Chat-store persistence (P4)
- Adapter refuse/impersonation runtime (P5)
- Portal UI roster (P9)
