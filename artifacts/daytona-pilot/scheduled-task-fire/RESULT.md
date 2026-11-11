# lp-jzl.8 — Offline scheduled-task fire smoke

| Field | Value |
| --- | --- |
| **When (UTC)** | 2026-08-10T17:04:04Z |
| **Git SHA** | `8b7103a` |
| **Package** | `@lanyard/control-plane` |
| **Mode** | Offline (real-harness + injectable clock) |
| **Live MockLab** | Not run (see EVIDENCE.md residual) |
| **Verdict** | **PASS** |
| **Exit code** | 0 |

## Suites

```
test/durable-job-registry.test.ts
test/scheduled-task-fire.integration.test.ts
test/schedule-evaluator.test.ts
```

## Vitest summary

```
Test Files  3 passed (3)
Tests  24 passed (24)
Duration  303ms (transform 147ms, setup 0ms, collect 383ms, tests 45ms, environment 0ms, prepare 108ms)
```

## Full vitest log

```

 RUN  v3.2.7 /tmp/portal-main-qa/portal/packages/control-plane

 ✓ test/durable-job-registry.test.ts (8 tests) 16ms
 ✓ test/scheduled-task-fire.integration.test.ts (4 tests) 13ms
 ✓ test/schedule-evaluator.test.ts (12 tests) 16ms

 Test Files  3 passed (3)
      Tests  24 passed (24)
   Start at  13:04:04
   Duration  303ms (transform 147ms, setup 0ms, collect 383ms, tests 45ms, environment 0ms, prepare 108ms)

```

## Expected mapping (acceptance)

| Suite | Covers |
| --- | --- |
| `durable-job-registry.test.ts` | lp-jzl.10.1 — platform SoT + rematerialize after stop/re-wake |
| `scheduled-task-fire.integration.test.ts` | lp-jzl.7 — ensure_online → mid_turn run → idle stop; job survives |
| `schedule-evaluator.test.ts` | lp-jzl.10.2 — due scan from platform SoT; fire without guest ticker |

Offline operational fire path is proven in-process. Live one-fire remains residual until OPERATOR HOLD / stack allows (EVIDENCE.md).
