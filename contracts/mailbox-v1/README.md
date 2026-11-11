# mailbox-v1

Canonical `mailbox.send` / `mailbox_halt` JSON for agent mailbox v1.

**Source of truth:** wayfinder map `agent-mailbox-v1.md` (locked 2026-08-25). Do not invent fields that map does not name.

**Bead:** `lp-v62i.1.1` (parent `lp-v62i.1`, epic `lp-v62i`)  
**Paired agent spec:** `lac-r9w.1.1`  
**TypeScript:** `portal/packages/shared/src/mailbox/` (`@lanyard/shared`)

Platform owns this directory. Agent dual-write copies these types field-for-field into `packages/gateway-core/src/mailbox.ts` and `lanyard-agent/contracts/mailbox-v1/`. If a field is not here, it is not in v1.

Mailbox is transport, not a screen. No mailbox UI, inbox, receipts, or tappable hop cards in this contract.

## Files

| Path | Role |
|------|------|
| [`mailbox.schema.json`](./mailbox.schema.json) | Draft 2020-12 `$defs` for send input, halt input, stamps, append request/result, error codes, connector marks |
| [`examples/`](./examples/) | Valid fragments (filename prefix selects the `$defs` entry) |

## Wire names

Domain types in `@lanyard/shared` match these keys. `nonce` **is** `externalMessageId` on the wire.

| Domain | Wire |
|--------|------|
| `MailboxSendInput` | `{to, room, text, nonce}` — model-visible tool. **`from` is absent.** |
| `MailboxSendStamps` | `{from, tenant_id}` — gateway only, never model-settable |
| `MailboxAppendRequest` | send input + stamps |
| `MailboxHaltInput` | `{room}` — lead tool + Jack's button |
| `MailboxAppendResult` | `{ok: true, message_id}` \| `{ok: false, error}` |
| `MailboxErrorCode` | `not_found` \| `forbidden` \| `frozen` \| `fuse_tripped` \| `bad_to` \| `dead_room` |
| `PersonaId` / `ThreadId` | string, no `:`, no whitespace |
| `ConnectorMark` | `google` \| `hubspot` \| `whatsapp` \| `github` — not a persona, not a `to` |

`to` is one persona id. Not a list. Not a user id. Not `"Jack"`.  
`room` is a BFF `thread_id`. Not a channel name.  
`text` is a string. No attachments in v1.

## Nonce / externalMessageId

Dedupe key is **nonce only**. Same nonce → idempotent no-op (no second bubble, no second wake). Do **not** dedupe on `(from, to, room, text)`.

- Tool path: model/gateway generates a UUID per send.
- Prose `@` path (later leaf): `prose:{turnId}:{to}:{room}`.

## Error codes (fail closed)

| Code | When |
|------|------|
| `not_found` | unknown room or unknown `to` |
| `forbidden` | `from` not on channel roster; guest write to someone else's 1:1; non-lead halt |
| `frozen` | halt or fuse freeze in effect |
| `fuse_tripped` | send that would exceed 40/hour or 8 consecutive a2a |
| `bad_to` | Jack, self, empty, connector id mistaken as persona |
| `dead_room` | scheduled fire into a deleted thread |

## Event mapping (no new SSE type)

Documented here so dual-write does not invent a mailbox SSE event. Runtime is later leaves.

- Channel / same-room send → `RelayChatEvent` `message_send`, speaker=`from`, in `room`, plus `Wake(to)`.
- 1:1 hop → no `message_send` in target; `system_notice` in origin 1:1; hidden wake body to `to`.
- Halt freeze and fuse trip → `system_notice` already in `ChatHistoryEvent`. Reuse it.

## Illegal states

JSON Schema rejects:

- `PersonaId` / `ThreadId` containing `:` or whitespace
- `to` as a list
- `from` / `tenant_id` on the model-visible send tool
- `to` equal to `Jack` / `jack` or a `ConnectorMark`
- extra keys on send, halt, append, or result
- unknown error codes

`@lanyard/shared` parsers additionally reject empty nonce and branded parse failures (empty / overlong ids).

## Non-goals (this package)

- Send runtime, gateway wake, BFF routes
- Mailbox UI / Halt chrome wiring
- Fuse counters
- Parser / `@` mention hop
- Importing BFF chat-store or sqlite types
