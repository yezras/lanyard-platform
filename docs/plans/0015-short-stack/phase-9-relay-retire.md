# Phase 9 — Retire Relay from the Daytona chat hop

Back: [overview](./overview.md). Bead: `lp-oop.35` (P3 after `.34`).  
ADR: [0013](../../adr/0013-daytona-chat-relay-retire.md). Kitchen-sink: [phase 8](./phase-8-dual-run-proof.md).

## Goal

Lock the Daytona **target** chat hop as Browser → BFF → Harness → Daytona toolbox. That hop has no Relay `deliverInbound` / `interruptInbound`. Keep Relay for EC2 and guest-gateway tenants until those tenants move.

This leaf does **not** flip live AWS. Default `CHAT_DELIVERY` stays `relay` (OPERATOR HOLD; kitchen-sink waiver).

## What is retired

| Surface | After `.35` |
|---|---|
| Daytona + `ChatDelivery=harness` POST `/api/chat/threads/:id/messages` | Harness `startTurn` only. No `deliverInbound`. |
| Daytona + harness POST cancel | Remembered turn id only. No primary-gateway lookup. No `interruptInbound`. |
| Daytona + harness GET events / history | Existing harness SSE + BFF history. Relay stream stays closed. |

Type: `DeliverChatTurnInput` / `InterruptChatTurnInput` are discriminated. The harness variant has no `relayClient`.

## What stays (EC2 / guest dual-run)

| Surface | Why |
|---|---|
| Default `CHAT_DELIVERY=relay` | Live MockLab and EC2 guests still inherit today's hop. |
| Persist `chat_delivery` | A tenant can stay on Relay or flip to harness alone (`lp-oop.29`). |
| EC2 `runtime_kind=ec2` chat | Relay `deliverInbound` until that tenant moves. |
| Slack / email / scheduled-task inbound | Out of plan 0015 chat hop. Still Relay. |
| Relay process / ECS service | Not deleted. EC2 and unflipped guests still need it. |

## Not this bead

- Global BFF `CHAT_DELIVERY=harness`
- MockLab live persist flip
- Rewriting or deleting the guest-gateway snapshot
- Deleting Relay from deploy
- Channel-adapter or cron cutover

## Verification

- BFF unit tests: `portal/packages/bff/test/chat-relay-retire.test.ts`
- Existing harness integration tests still assert `deliverInbound` call count `0`
- Offline: `bash deploy/scripts/smoke-mocklab-short-stack-relay-retire.sh`
- Evidence: `artifacts/mocklab/short-stack/relay-retire/RESULT.md`
