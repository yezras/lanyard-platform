# lp-oop.35 — Relay retire from Daytona harness hop

**Verdict:** GO (offline). Live AWS not flipped.

| Check | Result |
|---|---|
| Daytona harness POST/cancel has no `deliverInbound` / `interruptInbound` | PASS — discriminated `DeliverChatTurnInput` / `InterruptChatTurnInput`; `chat-relay-retire.test.ts` |
| Harness cancel does not resolve Relay primary | PASS |
| EC2/guest dual-run still uses Relay | PASS — `chatDelivery: "relay"` still calls `deliverInbound` |
| Default `CHAT_DELIVERY` | `relay` (unchanged) |
| Live MockLab `chat_delivery` flipped | **No** (OPERATOR HOLD; kitchen-sink waiver) |
| Relay service deleted | **No** — EC2 / unflipped guests still need it |

Docs: [phase-9-relay-retire.md](../../../../docs/plans/0015-short-stack/phase-9-relay-retire.md), [ADR 0013](../../../../docs/adr/0013-daytona-chat-relay-retire.md).

Offline re-check:

```bash
bash deploy/scripts/smoke-mocklab-short-stack-relay-retire.sh
```
