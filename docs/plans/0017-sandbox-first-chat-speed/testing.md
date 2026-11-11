# 0017 testing

Back: [overview.md](overview.md)

Hillclimb ruler (freeze before behavior PRs):

| Metric | Direction | Offline stop | Live residual |
|--------|-----------|--------------|---------------|
| `time_to_agent_ready_ms` | down | Fake `start_from_stopped` Send < 5000ms (fake clock) | MockLab Send on bound stopped sandbox < 5s wall when Daytona/Relay healthy |
| `cold_create` count on first Send | zero when `sandbox_id` bound | unit | live log path label |
| Chat POST wall while wake in flight | must not exceed 15s | BFF test | no CloudFront 504 on Send |
| Fargate / DS sleep | forbidden | **no Fargate/DS sleep** this epic | same. Platform and ONLYOFFICE stay up |

## Non-goals

- **No Fargate/DS sleep.** Tests must not require stopping BFF, Relay, CP, or ONLYOFFICE / document server. A green SLO is a Daytona/harness path, not a platform cold start.
- No live Daytona create from CI.
- T10 wall-clock MockLab is a residual (`lp-vqr0.14`), not a merge gate for T1–T9.

## IDs (prove in units)

| Id | Prove |
|----|--------|
| T1 | real harness: bound stopped sandbox, `ensure_online` path is `start_from_stopped`, not `cold_create`. |
| T2 | Fake: no `sandbox_id`, warm pool hit, path `warm_pool`, then start. Miss still `cold_create`. |
| T3 | Presence `online` when Relay connected even if vault probe not writable. Separate `vault_writable` flag/field. |
| T4 | Chat POST while waking returns without waiting full `wait_timeout_ms`. SSE/body includes `agent_starting`. |
| T5 | `ENSURE_ONLINE_ON_CHAT` + bound stopped: Send does not call Daytona create. |
| leak | `lp-vqr0.15`: 504/start-fail retries and never-connect restart reuse one real harness box. `pnpm --filter @lanyard/control-plane test test/live-leak-one-send.test.ts` |
| T6 | Harness `CHAT_DELIVERY` no-tool turn: no `ensure_online` when tools not needed. Tool turn still wakes. |
| T7 | Speculative: chat-route hook calls ensure_online once; second Send is `already_online` or start_from_stopped. |
| T8 | Entrypoint logic (script test or documented function): gateway exec is not blocked on post-mount writable timeout. Optional mount may warn. Prove: `bash deploy/daytona/agent-gateway/smoke-entrypoint.sh` (T8 cases). Does not claim `lp-puzc` fixed. |
| T9 | SLO harness command or test prints path histogram. Changing the ruler requires updating this file. |
| T10 | Live MockLab (residual): Send after 10 min idle, `wake_ms` < 5000, path `start_from_stopped`. Blocked on OPERATOR HOLD + `lp-puzc` if mount still minutes. T10 is **not** a T1–T9 CI gate. |

## Histogram buckets (`time_to_agent_ready_ms`)

T9 frozen ruler. Same edges as `ORCHESTRATOR_LATENCY_BUCKETS`. **Changing buckets requires updating this file.**

| Bucket | Range |
|--------|-------|
| `lt_500ms` | &lt; 500 ms |
| `500ms_2s` | &lt; 2 s |
| `2s_5s` | &lt; 5 s (start_from_stopped offline stop lives here) |
| `5s_15s` | &lt; 15 s (chat POST budget) |
| `15s_30s` | &lt; 30 s |
| `30s_60s` | &lt; 60 s |
| `gte_60s` | ≥ 60 s |

Paths the harness records: `already_online`, `start_from_stopped`, `cold_create`, `warm_pool`.

Reviewer command (prints the histogram):

```bash
pnpm --filter @lanyard/control-plane test test/slo-harness.test.ts
```

Code: `portal/packages/control-plane/src/slo-harness.ts`. Fake clock. No live Daytona.

## CI encoding (T1–T9)

Hillclimb freeze: tests are the ruler. CI path is the package scripts already used in PRs. No live Daytona. T10 stays a residual (`lp-vqr0.14`).

```bash
pnpm --filter @lanyard/control-plane test
pnpm --filter @lanyard/bff test
```

Catalog: `portal/packages/control-plane/src/slo-ci.ts`. Changing a named test or ID requires updating this table.

| Id | Package | File | Named test |
|----|---------|------|------------|
| T1 | @lanyard/control-plane | portal/packages/control-plane/test/send-bound-stopped.test.ts | T1 bound stopped ensure_online never cold_create (lp-vqr0.6) |
| T2 | @lanyard/control-plane | portal/packages/control-plane/test/warm-pool-snapshot-wake.test.ts | lp-vqr0.10 T2 warm pool claim + replenish (real harness) |
| T3 | @lanyard/control-plane | portal/packages/control-plane/test/ensure-online-relay.test.ts | agent_ready vs vault_writable (lp-vqr0.4 / T3) |
| T4 | @lanyard/bff | portal/packages/bff/test/ensure-online-chat.test.ts | chat POST detaches from delayed ensure_online (lp-vqr0.8 T4) |
| T5 | @lanyard/bff | portal/packages/bff/test/ensure-online-chat.test.ts | T5 ENSURE_ONLINE_ON_CHAT bound stopped never creates (lp-vqr0.6) |
| T6 | @lanyard/bff | portal/packages/bff/test/chat-delivery.test.ts | harness no-tool turn skips sandbox wake (lp-vqr0.11 T6) |
| T7 | @lanyard/bff | portal/packages/bff/test/ensure-online-speculative.test.ts | POST /api/chat/ensure-online (T7) |
| T8 | n/a | deploy/daytona/agent-gateway/smoke-entrypoint.sh | n/a: Guest entrypoint smoke is bash deploy/daytona/agent-gateway/smoke-entrypoint.sh, not a control-plane or BFF vitest. CI path stays the package test scripts. Freeze still requires the smoke file and T8 case names. |
| T9 | @lanyard/control-plane | portal/packages/control-plane/test/slo-harness.test.ts | 0017 real harness SLO harness (T9) |

T8 is n/a in CP/BFF vitest because the guest entrypoint is a bash smoke, not a Node package test. `pnpm --filter @lanyard/control-plane test` still freezes the smoke file and T8 case names via `test/slo-ci.test.ts`.

## Commands

```bash
pnpm --filter @lanyard/control-plane test
pnpm --filter @lanyard/bff test
pnpm --filter @lanyard/control-plane test test/slo-ci.test.ts test/slo-harness.test.ts
pnpm --filter @lanyard/control-plane test test/sandbox-wake-path.test.ts
pnpm --filter @lanyard/control-plane test test/send-bound-stopped.test.ts
pnpm --filter @lanyard/control-plane test test/live-leak-one-send.test.ts
pnpm --filter @lanyard/control-plane test test/warm-pool-snapshot-wake.test.ts
pnpm --filter @lanyard/control-plane test test/ensure-online-relay.test.ts
pnpm --filter @lanyard/control-plane test test/readiness.test.ts
pnpm --filter @lanyard/bff test test/slo-ci.test.ts test/ensure-online-chat.test.ts
pnpm --filter @lanyard/bff test test/chat-delivery.test.ts test/ensure-online-speculative.test.ts
bash deploy/daytona/agent-gateway/smoke-entrypoint.sh
bash scripts/validate.sh
```

New tests land next to those files. Do not assert live Daytona from CI.
