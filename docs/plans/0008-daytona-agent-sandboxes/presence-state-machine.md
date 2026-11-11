# Presence state machine (`offline` | `waking` | `online` | `error`)

**Bead:** `lp-eya`  
**Parent:** `lp-e0j` (Phase 1) under offline piping `lp-kng.2`  
**Related:** [identity-model.md](./identity-model.md), [offline-piping.md](./offline-piping.md), [overview.md](./overview.md)  
**Code:** `portal/packages/control-plane/src/presence.ts` (exported from `@lanyard/control-plane` for CP + BFF)

## Purpose

Shared **types and validation** for gateway instance presence used by:

- Control Plane Instance Orchestrator (`ensure_online`, idle stop, webhooks)
- BFF / adapters that call ensure_online and read presence
- Presence store + signal-activity + reaper (`lp-omt`, `lp-kng.2.2`)

Field storage (`gateway_instances.presence`) is the catalog from `lp-nye`.  
This document locks **legal transitions** and the reason vocabulary.

Offline track: pure types/tests only — no live Daytona create, no AWS apply.

## States

| State | Meaning |
|-------|---------|
| `offline` | No live sandbox assumed. Default at provision (`runtime_kind=daytona`). `sandbox_id` typically null or stale. |
| `waking` | ensure_online in flight (singleflight). Create/start/mount/Relay dial not yet confirmed online. |
| `online` | Sandbox up and agent identity expected on Relay for this `instance_id`. This is `agent_ready` (lp-vqr0.4). Mountpoint writable is a separate `vault_writable` flag, not a presence state. |
| `error` | Last wake or runtime attempt failed; not online. Retry via ensure_online → `waking`. |

Catalog constant: `INSTANCE_PRESENCE_STATES` / type `InstancePresence`.

## Transition graph

```text
                    ensure_online
         ┌──────────────────────────────┐
         │                              ▼
      offline ─────────────────────► waking ──────► online
         ▲         ensure_online         │   wake_     │
         │                               │  succeeded  │
         │         wake_failed           ▼             │ runtime_error
         │         ┌────────────────── error ◄─────────┘
         │         │                     │
         │         │  ensure_online      │ clear /
         │         └──────► waking       │ explicit_stop /
         │                               │ idle_stop
         └───────────────────────────────┘
              idle_stop / explicit_stop / wake_abandoned / clear
              (also online|waking|error → offline)
```

### Legal edges (non-self)

| From | To | Typical reason |
|------|-----|----------------|
| `offline` | `waking` | `ensure_online` |
| `error` | `waking` | `ensure_online` (retry) |
| `waking` | `online` | `wake_succeeded` |
| `waking` | `error` | `wake_failed` |
| `waking` | `offline` | `wake_abandoned`, `explicit_stop`, `clear` |
| `online` | `offline` | `idle_stop` (10 min grace), `explicit_stop` |
| `online` | `error` | `runtime_error` |
| `error` | `offline` | `clear`, `explicit_stop`, `idle_stop` |

### Self-transitions (always legal)

| Edge | Why |
|------|-----|
| `online` → `online` | ensure_online when already up (no second create) |
| `waking` → `waking` | concurrent ensure_online joins singleflight |
| `offline` → `offline` | stop/clear when already offline |
| `error` → `error` | idempotent re-read / no-op |

### Illegal edges (must reject)

| From | To | Why illegal |
|------|-----|-------------|
| `offline` | `online` | Must pass through `waking` (create/start/mount) |
| `error` | `online` | Same — retry via `waking` |
| `online` | `waking` | Already online; ensure_online stays `online` |
| `offline` | `error` | Error is post-attempt; provision stays `offline` |

Code: `isLegalPresenceTransition` / `transitionPresence` throw  
`IllegalPresenceTransitionError` on illegal edges.

## Reason vocabulary

| Reason | Effect (when applicable) |
|--------|---------------------------|
| `ensure_online` | `offline`\|`error` → `waking`; `online`→`online`; `waking`→`waking` |
| `wake_succeeded` | `waking` → `online` only |
| `wake_failed` | `waking` → `error` only |
| `wake_abandoned` | `waking` → `offline` only |
| `idle_stop` | `online`\|`waking`\|`error` → `offline` (also no-op on `offline`) |
| `explicit_stop` | same as idle_stop (API stop) |
| `runtime_error` | `online` → `error` only |
| `clear` | `error`\|`waking` → `offline` (not a substitute for stop while `online`) |

Helpers: `nextPresenceForReason` (nullable), `applyPresenceReason` (throws  
`IllegalPresenceReasonError` when reason does not apply).

Every reason×from resolution that is non-null **must** also be a legal edge  
(unit-tested consistency).

## ensure_online / idle (conceptual)

Matches [identity-model.md](./identity-model.md) wake path:

1. BFF/adapter → CP `ensure_online(instance_id)`.
2. If `online` (+ relay session later) → return; presence stays `online`.
3. If `waking` → wait on singleflight; presence stays `waking`.
4. Else (`offline` or `error`) → set `waking`, create/start sandbox, bind `sandbox_id`, mount vault, inject gateway env; **wait Relay connected** (`lp-rr5`); on success → `online` (`agent_ready`). Do **not** wait for Mountpoint first-write (`vault_writable`, lp-vqr0.4 / T3). File tools may wait on that flag separately. On failure → `error`.
5. Idle: last activity + **10 min** grace → stop sandbox → `offline`; keep `instance_id` + `s3_vault_prefix`.
6. Mid-turn (`lp-053`): while `mid_turn` lock is active (agent turn/tools), idle reaper **skips** stop; lock clears on turn end or max-hold timeout (45 min default). See [mid-turn-protection.md](./mid-turn-protection.md).

Normative idle reaper job/loop (`lp-0y3`): [idle-reaper.md](./idle-reaper.md) — `createIdleReaperJob` + `reapIdle`; real harness unit tests with injectable clock; CP starts the loop only when managed Daytona is enabled+ready.

**Relay connected wait (`lp-rr5`):** when `relayPresence` is injected, presence stays `waking` until Relay reports WSS connected for `instance_id` after sandbox Started. Never-connect: kill + recreate once, then fail. Policy: [relay-connected-wait.md](./relay-connected-wait.md).

## Export surface (CP / BFF)

Package: `@lanyard/control-plane`

| Export | Role |
|--------|------|
| `INSTANCE_PRESENCE_STATES`, `InstancePresence` | Catalog |
| `PRESENCE_TRANSITION_EDGES` | Legal non-self edges |
| `PRESENCE_TRANSITION_REASONS`, `PresenceTransitionReason` | Reason enum |
| `isInstancePresence`, `parseInstancePresence` | Input validation |
| `isLegalPresenceTransition`, `assertLegalPresenceTransition`, `transitionPresence` | Edge validation |
| `allowedPresenceTargets` | Discoverability / UI / docs |
| `nextPresenceForReason`, `applyPresenceReason` | Orchestrator driver |
| `IllegalPresenceTransitionError`, `IllegalPresenceReasonError` | Typed failures |

Internal API stubs (`lp-biq`) and BFF flag hooks (`lp-kng.2.8`) should import these types rather than redefining string unions.

## Out of scope (later beads)

- ~~Persist transitions / `last_activity_at`~~ — offline in-memory (`lp-kng.2.2`); durable CP Postgres via `createSqlOrchestratorInstanceStore` / `ControlPlaneStore.asOrchestratorInstanceStore()` (`lp-omt`)
- HTTP ensure-online wired to orchestrator singleflight (`lp-nus`); stop still 501 until later Phase 4; GET presence reads durable fields including `last_activity_at` (`lp-omt`)
- Daytona client: Fake offline (`lp-kng.2.1`) + SDK wrapper live when CP Daytona ready (`lp-012` / `lp-nus`)
- Webhook → presence map (`lp-kng.2.3` offline parse/HMAC/map; `lp-04r` HTTP) — `portal/packages/control-plane/src/daytona-webhook.ts` + `POST /webhooks/daytona` (HMAC `x-daytona-signature` / `DAYTONA_WEBHOOK_SECRET`; apply `sandbox.state.updated` into `OrchestratorInstanceStore`; reject bad sigs; replay-safe 200 ACK)

## Acceptance (`lp-eya`)

- [x] Types exported for CP/BFF (`@lanyard/control-plane` presence module)
- [x] Illegal transitions rejected (`IllegalPresenceTransitionError`) and documented here
- [x] Tests for transitions (`portal/packages/control-plane/test/presence.test.ts`)
