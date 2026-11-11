# Daytona vendor autoStop safety net (lp-4f2)

**Status:** Policy + CP config defaults (offline; no live Daytona required).  
**Bead:** `lp-4f2`  
**Parent:** `lp-mci` (Phase 5 Platform wake integration)  
**Code:**
- `portal/packages/control-plane/src/daytona-config.ts` — `DEFAULT_DAYTONA_AUTO_STOP_INTERVAL_MINUTES`, `DAYTONA_AUTO_STOP_INTERVAL_MINUTES`, `loadDaytonaConfig` field
- `portal/packages/control-plane/src/server.ts` — passes interval into `createDaytonaSdkClient`
- `portal/packages/control-plane/src/daytona-sdk-client.ts` — create body `autoStopInterval`
- Tests: `daytona-config.test.ts`, `daytona-sdk-client.test.ts` (create body); mid-turn still covered by `presence-activity-reaper.test.ts`

**Related:** [idle-reaper.md](./idle-reaper.md) (`lp-0y3`), [mid-turn-protection.md](./mid-turn-protection.md) (`lp-053`), [cp-daytona-config.md](./cp-daytona-config.md) (`lp-k8n`)

## Purpose

Configure managed Daytona **`autoStopInterval`** as a **vendor safety net** **above** the Control Plane idle reaper, so a sandbox is still stopped if the orchestrator is down, the reaper loop is stuck, or CP cannot call stop — without killing an open agent turn that mid-turn protection is holding.

Primary cost control remains the **CP idle reaper** (10 min no activity, `lp-kng.8`). Vendor autoStop is **not** the primary stop path and does **not** honor Lanyard `mid_turn`.

## Layered stop policy

| Layer | Owner | Default | Role |
|-------|--------|---------|------|
| Idle reaper | CP orchestrator | **10 min** (`DEFAULT_IDLE_GRACE_MS`) | Primary: stop after no `signal-activity` / wake activity |
| Mid-turn hold | CP orchestrator | **45 min** max (`DEFAULT_MID_TURN_MAX_HOLD_MS`) | Block reaper while turn/tools active; timeout safety clears stuck locks |
| Vendor autoStop | Daytona create field | **90 min** (`DEFAULT_DAYTONA_AUTO_STOP_INTERVAL_MINUTES`) | Safety net if CP fails to stop |

**Invariant (must hold):**

```text
idle grace (10m)  <  mid-turn max hold (45m)  <  vendor autoStop (90m)
```

Rationale for **90 minutes**:

1. **Above mid-turn max hold (45m)** — vendor must not auto-stop while a held mid-turn is still valid. Mid-turn is only known to CP; Daytona will not skip autoStop for `mid_turn`.
2. **Above idle grace (10m)** — under healthy CP, reaper stops first; vendor only runs later as a backstop.
3. **Margin for scan lag / clock skew** — reaper interval is 60s; leave room above 45m without waiting hours (cost thrift).

## Interaction with open WSS / mid-turn

| Concern | Policy |
|---------|--------|
| Open Relay WSS during a normal turn | Mid-turn lock blocks **CP reaper**. Vendor autoStop is 90m, so a turn held within the 45m max hold is **not** killed by vendor autoStop. |
| Long turn with refreshed mid_turn | BFF re-signals activity / mid_turn (`lp-96v` / `lp-053`). That refreshes CP idle grace. Vendor idle may also reset on guest network activity (WSS); even if not, keep autoStop **≥** max mid-turn hold. |
| Mid-turn stuck past max hold | Reaper clears lock (timeout safety) then applies idle rules. Vendor still sits above that window. |
| CP down / reaper not running | Vendor autoStop eventually stops compute so pilot cost is bounded without relying on CP. |
| autoStop **≤** mid-turn max hold | **Forbidden for pilot defaults.** Would risk mid-turn WSS kill. Override only with ops awareness. |

Spike evidence that create accepts `autoStopInterval` (minutes) on managed API:

- [spike-v2p](./spike-v2p-org-access.md) — `autoStopInterval=1` throwaway
- [spike-z1u](./spike-z1u-linux-vm-sandbox.md) — create with short interval
- [spike-4dk](./spike-4dk-wss-relay.md) — `autoStopInterval=15` with WSS hold guidance: set interval ≥ hold duration + margin
- [spike-4l5](./spike-4l5-gateway-secret-inject.md) — `autoStopInterval: 10` in create body

## CP config

| Knob | Default | Env override |
|------|---------|--------------|
| Vendor autoStop (minutes) | **90** | `DAYTONA_AUTO_STOP_INTERVAL_MINUTES` |
| Idle reaper grace | 10 min | `IDLE_REAPER_GRACE_MS` (ms) |
| Mid-turn max hold | 45 min | (orchestrator option / code default) |

- Loaded on `DaytonaConfig.autoStopIntervalMinutes` via `loadDaytonaConfig`.
- CP `server.ts` passes the value into `createDaytonaSdkClient({ autoStopIntervalMinutes })` whenever Daytona is enabled and ready.
- Create body field: `autoStopInterval` (integer minutes). `0` disables vendor auto-stop when the API accepts it — **not recommended** for pilot (removes CP-down safety net).
- Safe log field: `daytona_auto_stop_interval_minutes` in `daytonaConfigLogSummary` (never secrets).

## What this is not

- Not a substitute for the idle reaper or mid-turn lock.
- Not activity-aware of Lanyard `signal-activity` (vendor clock is independent).
- Not `autoDeleteInterval` (ephemeral delete-on-stop remains a separate thrift choice for spikes/tests).
- Not live wall-clock proof of vendor stop at 90m (follow-up / staging ops).

## Acceptance (`lp-4f2`)

- [x] Policy implemented or documented with spike evidence (this file + create body wiring)
- [x] Mid-turn protection still works (reaper skip unchanged; autoStop default above 45m hold)
- [x] Config values in CP (`DAYTONA_AUTO_STOP_INTERVAL_MINUTES` / default 90 on `DaytonaConfig`)
