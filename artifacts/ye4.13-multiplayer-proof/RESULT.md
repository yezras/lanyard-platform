# lp-ye4.13 — Local mocklab multiplayer proof

**Bead:** `lp-ye4.13`  
**Date:** 2026-08-13  
**Backend:** `FakeBackendRuntimeService` + `DurableRuntimeLedger` (ed25519 host signing)  
**Suite:** `portal/packages/backend-runtime/test/multiplayer-mocklab-proof.test.ts`

## Setup

| Actor | Kind | Path ACL |
|-------|------|----------|
| Alice | human session `sess_alice` | `/Projects/Shared`, `/Projects/AliceOnly` |
| Bob | human session `sess_bob` | `/Projects/Shared` only |
| External agent | `delegated_agent` grant under Alice session | `/Projects/Shared` + checkpoints |

Tenant `ten_mocklab` / instance `inst_mocklab` (local durable dir under tmp).

## Scenarios

| # | Scenario | Result |
|---|----------|--------|
| 1 | Alice creates `/Projects/Shared/brief.md` | PASS — `file_create` + `operation_id` |
| 2 | Alice creates private `/Projects/AliceOnly/notes.md` | PASS |
| 3 | Bob replace_if_match with current revision | PASS — `file_replace`, content `shared v2 by bob` |
| 4 | Agent `write_checkpoint` of shared brief | PASS — checkpoint path created; **canonical source unchanged** |
| 5 | Alice stale `ifMatch` (rev1) after Bob | PASS — `BackendRuntimeError`; content still Bob's |
| 6 | Bob `history.list` on shared path | PASS — signed ed25519 events include create+replace ops |
| 7 | Bob `history.list` on AliceOnly | PASS — forbidden (ACL) |
| 8 | Alice history on AliceOnly | PASS — visible to owner ACL |
| 9 | Agent checkpoint idempotent retry | PASS — source still Bob's v2 |

## How to re-run

```bash
cd portal
pnpm --filter @lanyard/shared build
pnpm --filter @lanyard/backend-runtime exec vitest run test/multiplayer-mocklab-proof.test.ts
```

Expected: 1 file, 1 test, all pass.

## Notes

- This is the **local/offline multiplayer proof** required by phase 8 (not live AWS MockLab UI).
- Host durable ledger from `lp-ye4.12` is enabled (`durableLedgerEnabled=true`).
- Live portal browser multiplayer remains optional follow-on once agent hosts advertise history/heads.
