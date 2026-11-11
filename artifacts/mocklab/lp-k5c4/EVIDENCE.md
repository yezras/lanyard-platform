# lp-k5c4.10 — Phase 9 MockLab inbound-spine evidence pack

**Bead:** `lp-k5c4.10`  
**Parent:** `lp-k5c4`  
**HOLD:** lifted 2026-08-27 **for this bead only** (Taste send, toolbox turn, cron fire). Still forbidden: `terraform apply` that restages torn-down staging.

Machine record: [live-proof-evidence-latest.json](./live-proof-evidence-latest.json). Human verdict: [RESULT.md](./RESULT.md).

## Acceptance

| Criterion | Evidence |
|-----------|----------|
| Taste send 200 + SSE complete or stall, not hang | HTTP 200; history `pong lp-k5c4.10-taste` (`outcome=completed`) |
| Toolbox path `start_from_stopped` or `already_online` when `sandbox_id` bound | Bound `77e90eda-…`; path `already_online`; `cold_create=false` |
| Cron fire via enqueue | Live ops create HTTP 201 (evaluator off). Enqueue is the offline caller suite (`inbound-spine-callers.test.ts`) |
| `deliverInbound` not on the hop | persist `harness` + env `relay`; CloudWatch `deliver-inbound` hits 0; send 200 on harness |
| HOLD respected or human-lifted in the pack | `hold.status=lifted_for_proof_only`, `terraform_apply=false`, `restage=false` |

## Persist / spineEnabled

Process `CHAT_DELIVERY` stays `relay`. Tenant persist flipped `relay` → `harness` via CP `PATCH /internal/tenants/:id/chat-delivery` (ops token, existing CP task). `HARNESS_URL` already wired on BFF `:52`. Predicate `spineEnabled` is true.

## Residuals (named, not silent)

- Live BFF pin `portal-v2026.08.26-v62i8` (`lanyard-platform-staging-bff:52`) does not include Postgres inbound queue. Enqueue on live needs `CONTROL_PLANE_DATABASE_URL` on BFF plus an image roll. That roll is **not** this bead (no restage).
- `SCHEDULE_EVALUATOR_ENABLED` is not on live CP env. Cron live proof is vault create (201) plus offline `enqueueCronHarnessTurn`.
- GET `/api/context` can hang on Brain RPC; persist was confirmed on CP and later on a 200 context read.

## Re-run

```bash
bash deploy/scripts/smoke-mocklab-inbound-spine.sh
bash deploy/scripts/prove-mocklab-inbound-spine.sh
```
