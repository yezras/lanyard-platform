# Idle reaper (lp-0y3)

**Status:** Job/loop + unit tests (fake clock + real harness).  
**Bead:** `lp-0y3`  
**Parent:** `lp-pec` (Phase 4 Instance Orchestrator)  
**Code:**
- `portal/packages/control-plane/src/instance-orchestrator.ts` — `reapIdle`, `DEFAULT_IDLE_GRACE_MS`
- `portal/packages/control-plane/src/idle-reaper.ts` — background job/loop
- Tests: `portal/packages/control-plane/test/idle-reaper.test.ts`, `presence-activity-reaper.test.ts`

**Related:** [presence-state-machine.md](./presence-state-machine.md), [identity-model.md](./identity-model.md), [cp-internal-orchestrator-api.md](./cp-internal-orchestrator-api.md)

## Purpose

Stop **ephemeral** Daytona sandbox compute when an instance has had **no activity for 10 minutes** (`lp-kng.8`), so pilot cost stays thrifty. Permanent product identity is **never** deleted:

| Keep | Clear / stop |
|------|----------------|
| `instance_id` | bound `sandbox_id` (Daytona stop) |
| `s3_vault_prefix` | presence → `offline` |
| tenant row / vault data | mid_turn flag on stop |

Activity is refreshed by `POST …/signal-activity` (`lp-84f`) and on successful wake (`ensure_online` seeds `last_activity_at`). BFF call sites for real product activity (message, tool_progress, brain_rpc) are `lp-96v` — see [cp-internal-orchestrator-api.md](./cp-internal-orchestrator-api.md) § BFF activity signals; flag `SIGNAL_ACTIVITY_ENABLED` default off.

## Policy

| Knob | Default | Override |
|------|---------|----------|
| Idle grace | **10 minutes** (`DEFAULT_IDLE_GRACE_MS`) | `IDLE_REAPER_GRACE_MS` (ms) or job `idleGraceMs` |
| Scan interval | **60 seconds** (`DEFAULT_IDLE_REAPER_INTERVAL_MS`) | `IDLE_REAPER_INTERVAL_MS` (ms) or job `intervalMs` |

Selection rules (per scan):

1. Only `runtime_kind === "daytona"` (EC2 always-on is never reaped).
2. Only `presence === "online"`.
3. Skip when `mid_turn` is set (stub for `lp-053`; full turn-lock later).
4. Idle when `last_activity_at` is null **or** `now - last_activity_at >= grace`.
5. Stop reason = `idle_stop` → presence `offline`; **`sandbox_id` retained by default** (`lp-6bg` / spike-bnd) so re-wake is start-from-stopped; vault prefix retained. Set `DAYTONA_RETAIN_SANDBOX_ON_STOP=0` to clear binding (forces cold create). Idle stop does **not** archive: stopped volumes still count against the org 30 GiB disk cap. Archive only **unbound** leftovers via [daytona-sandbox-archive-hygiene.md](../../runbooks/daytona-sandbox-archive-hygiene.md) (`lp-oop.37.7`) — never the bound instance `sandbox_id`.

## API surface

```ts
createIdleReaperJob({ reaper, idleGraceMs?, intervalMs?, now?, timers?, logSafe? })
// → { start, stop, isRunning, runOnce, idleGraceMs, intervalMs }

orch.reapIdle({ now?, idleGraceMs? }) → IdleReaperResult
```

- **`runOnce`** — one pass (ops/tests); injectable `now` for fake clock.
- **`start` / `stop`** — background interval; timers injectable (no real waits in unit tests).
- **Logs** — safe counts only (`scanned`, `stopped`, …); never API keys or sandbox env.

## CP process wiring

When Daytona is **enabled and ready**, `server.ts` constructs:

1. `createDaytonaSdkClient` (live) or test injects `real Daytona client (via harness-local)`
2. `createInstanceOrchestrator({ daytona, instances: store.asOrchestratorInstanceStore(), … })`
3. `createIdleReaperJob({ reaper: orch, …resolveIdleReaperEnv() }).start()`

When Daytona is **off** (default), the reaper loop does **not** start — EC2-only boots stay unchanged.

## Acceptance (`lp-0y3`)

- [x] 10 min grace enforced (`DEFAULT_IDLE_GRACE_MS`; stop at ≥ grace; `lp-kng.8`)
- [x] Does not stop when activity recent (within grace / after signal-activity)
- [x] Tests with clock fake (`idle-reaper.test.ts` + real harness; no live network)

## Out of scope

- Full mid-turn lock lifecycle (`lp-053`) — reaper only honors existing `mid_turn` flag
- HTTP ensure-online route body (`lp-nus` — done when orchestrator wired); stop still later Phase 4
- Live staging proof at ~grace wall clock (`lp-8sn`; grace now 10m)

## Vendor autoStop safety net (`lp-4f2`)

Daytona create-time `autoStopInterval` defaults to **90 minutes** in CP — **above** this reaper’s 10m grace and mid-turn max hold (45m). It is a **backstop** if CP fails to stop; primary stop remains this reaper.

→ **[daytona-autostop-safety-net.md](./daytona-autostop-safety-net.md)**
