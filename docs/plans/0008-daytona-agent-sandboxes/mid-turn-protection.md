# Mid-turn protection (lp-053)

**Status:** Lock lifecycle + timeout safety + signal-activity integration.  
**Bead:** `lp-053`  
**Parent:** `lp-pec` (Phase 4 Instance Orchestrator)  
**Code:**
- `portal/packages/control-plane/src/instance-orchestrator.ts` — `setMidTurn`, `resolveMidTurnPatch`, `isMidTurnLockActive`, `reapIdle` expiry clear
- `portal/packages/control-plane/src/orchestrator-api.ts` / `app.ts` — `signal-activity` optional `mid_turn`
- `portal/packages/control-plane/src/presence-store.ts` — durable `mid_turn` / `mid_turn_until`
- Tests: `presence-activity-reaper.test.ts`, `orchestrator-api.test.ts`

**Related:** [cp-internal-orchestrator-api.md](./cp-internal-orchestrator-api.md), [presence-state-machine.md](./presence-state-machine.md), [identity-model.md](./identity-model.md) (idle reaper job: `lp-0y3`)

## Purpose

Do **not** idle-stop a Daytona sandbox while the agent is mid-turn (tools / generation in progress). BFF or gateway push activity signals that arm and clear a lock; a timeout safety net clears stuck locks so cost control still works.

| Event | Effect |
|-------|--------|
| Turn / tool start | `signal-activity` with `mid_turn: true` (also bumps `last_activity_at`) |
| Turn end | `signal-activity` with `mid_turn: false` **or** `setMidTurn(id, false)` |
| Explicit / idle stop | Clears mid-turn fields |
| Lock older than max hold | Reaper clears lock (timeout safety), then applies normal idle rules |

## Policy

| Knob | Default | Notes |
|------|---------|--------|
| Max mid-turn hold | **45 minutes** (`DEFAULT_MID_TURN_MAX_HOLD_MS`) | Above 10 min idle grace; refresh via re-signal during long turns |
| Idle grace | **10 minutes** (`DEFAULT_IDLE_GRACE_MS`, `lp-kng.8`) | Mid-turn skip is independent |

Selection order in `reapIdle` (per instance):

1. Only `runtime_kind === "daytona"` and `presence === "online"`.
2. If `mid_turn` set but `mid_turn_until` expired → **clear lock** (timeout safety), continue.
3. If mid-turn lock **active** → skip stop (`skipped_mid_turn`).
4. Else apply idle grace on `last_activity_at`.

## API

### Orchestrator

```ts
orch.setMidTurn(instanceId, active, { maxHoldMs?, at? })
  → { instance_id, mid_turn, mid_turn_until }

orch.signalActivity(instanceId, { at?, mid_turn? })
  → { …, last_activity_at, mid_turn, mid_turn_until }

// Pure helpers (shared with HTTP route)
resolveMidTurnPatch(active, now, maxHoldMs?)
isMidTurnLockActive(rec, nowMs)
```

### HTTP (`POST …/signal-activity`)

| Body field | Meaning |
|------------|---------|
| `at` | Optional ISO activity timestamp |
| `mid_turn: true` | Arm lock + set `mid_turn_until = at + maxHold` |
| `mid_turn: false` | Clear lock |
| (omit `mid_turn`) | Activity only; lock unchanged |

Auth unchanged (service token / ops token). No Daytona call.

### Durable store

`gateway_instances.mid_turn` (boolean, default false) and `mid_turn_until` (ISO text, nullable). Migrated in `migrate.ts` (`lp-053`).

## Acceptance (`lp-053`)

- [x] Active turn blocks reaper stop
- [x] Lock clears on turn end or timeout safety
- [x] Tests (real harness + clock; no live network)

## BFF callers (`lp-96v` / `lp-v62i.8` / `lp-k5c4.7`)

BFF arms mid_turn on:

- **message** (user chat POST / spine `sandbox_need=none`) — `{ mid_turn: true }`.
  NOT gated by `SIGNAL_ACTIVITY_ENABLED` (lp-v62i.8 / lp-k5c4.7): live MockLab
  2026-08-26 reaped a bound box mid-turn with `skipped_mid_turn=0` because the
  flag defaulted false, so user sends now always signal.
- **toolbox** (spine `sandbox_need=toolbox`) — `{ mid_turn: true }` before
  `startTurn`, also not flag-gated. Spine worker is the source of truth so
  later adapters inherit the arm.
- **tool_progress** SSE (debounced) — `{ mid_turn: true }`, only when
  `SIGNAL_ACTIVITY_ENABLED` is on.

Clear `{ mid_turn: false }` when the harness SSE proxy settles a turn
(complete, empty close, stall, or stream open failure) so the hot window can
stop the box. Client abort does not clear (45m max hold remains the safety net).

`brain_rpc` activity bumps `last_activity_at` only (no mid_turn change), also
flag-gated. See [cp-internal-orchestrator-api.md](./cp-internal-orchestrator-api.md) § BFF activity signals.

## Out of scope

- Auto-detect turn state from Relay stream beyond listed BFF events (`lp-96v` pushes mid_turn on message/tool_progress)
- Live staging 30–45 min wall-clock proof

## Vendor autoStop safety net (`lp-4f2`)

Daytona does **not** honor `mid_turn`. CP sets create-time `autoStopInterval` to **90 minutes** (default) so vendor auto-stop stays **above** this 45m max hold and does not kill an open WSS mid-turn under normal policy. Primary mid-turn protection remains the reaper skip above.

→ **[daytona-autostop-safety-net.md](./daytona-autostop-safety-net.md)**
