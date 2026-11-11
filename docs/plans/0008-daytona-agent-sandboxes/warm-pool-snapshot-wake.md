# Warm pool / snapshot wake optimizations (`lp-6bg`)

**Status:** Implemented (strategy order + metrics + retain-on-stop; in-process claim + replenish on real harness)  
**Bead:** `lp-6bg` (stub) + `lp-vqr0.10` (T2 claim + replenish)  
**Epic:** `lp-3a1` (Phase 8: Hardening and cost)  
**Depends on:** `lp-bnd` (latency spike), `lp-nus` (ensure_online singleflight)  
**Code:**
- `portal/packages/control-plane/src/warm-pool.ts` — in-process pool + replenish helper
- `portal/packages/control-plane/src/instance-orchestrator.ts` — strategy order, retain-on-stop, claim
- `portal/packages/control-plane/src/orchestrator-metrics.ts` — path labels + warm pool counters
- `portal/packages/control-plane/src/daytona-config.ts` — env flags + MockLab cap
- `portal/packages/control-plane/src/fake-daytona-client.ts` — archive restore via `start`
- Tests: `portal/packages/control-plane/test/warm-pool-snapshot-wake.test.ts`

**Related:** [spike-bnd-wake-latencies.md](./spike-bnd-wake-latencies.md), [sandbox-orchestrator-metrics.md](./sandbox-orchestrator-metrics.md), [idle-reaper.md](./idle-reaper.md)

---

## 1. Goal

Make the default `ensure_online` path as fast as measured (spike `lp-bnd`):

| Situation | Strategy | Metric `path` |
|-----------|----------|---------------|
| Bound `sandbox_id`, state **stopped** (or already started) | `POST …/start` | `start_from_stopped` |
| No usable sandbox; optional premium warm pool | Claim pre-created stopped capacity | `warm_pool` |
| No usable sandbox | Create from snapshot pin | `cold_create` |
| Bound sandbox **archived** and flag on | `POST …/start` (restore) | `archive_restore` |

Spike directional numbers (container class, general snapshot): create p50 ~0.7s but heavy cold tail; start-from-stopped p95 ~5s and **stable binding**; archive restore slower / rare.

---

## 2. Default policy (normative)

1. **Warm default:** on idle/explicit stop, **retain** `sandbox_id` while Daytona sandbox is **stopped** (not archived). Next `ensure_online` → **start_from_stopped**.
2. **Cold default:** no `sandbox_id`, or start fails (not found / gone) → **cold_create** from instance pin or `DAYTONA_DEFAULT_SNAPSHOT`.
3. **Archive restore:** opt-in only (`DAYTONA_ARCHIVE_RESTORE_ON_WAKE`). Product 30m idle grace must **not** auto-archive (preserves start-from-stopped).
4. **Warm pool:** opt-in (`DAYTONA_WARM_POOL_ENABLED` / tenant allowlist). In-process pool of stopped sandbox ids for the pin snapshot (single CP task). Claim on unbound cold need binds `sandbox_id`, starts, path `warm_pool`. Miss still `cold_create`. Replenish is off the `ensure_online` stack. **Cap 1–2 MockLab.** Tests never hit the paid API. Live org enable is residual.

### Config / env

| Knob | Env | Default |
|------|-----|---------|
| Retain binding after stop | `DAYTONA_RETAIN_SANDBOX_ON_STOP` | **on** (unset/`1`/`true`; `0`/`false`/`off` clears) |
| Warm pool attempts | `DAYTONA_WARM_POOL_ENABLED` | **off** (do not enable against the paid org from CI) |
| Warm pool premium tenants | `DAYTONA_WARM_POOL_TENANT_ALLOWLIST` | empty = all when enabled |
| Warm pool size | `DAYTONA_WARM_POOL_SIZE` | **2** (clamped 0–2; MockLab cap) |
| Archive restore on wake | `DAYTONA_ARCHIVE_RESTORE_ON_WAKE` | **off** |

Orchestrator deps mirror these: `retainSandboxOnStop`, `warmPoolEnabled`, `warmPoolTenantAllowlist`, `warmPool`, `archiveRestoreOnWake`.

---

## 3. Metrics (latency comparison)

Wake path labels distinguish strategies so ops can compare p50/p95 of **cold_create** vs **start_from_stopped**:

| `path` | Meaning |
|--------|---------|
| `cold_create` | Create-from-snapshot |
| `start_from_stopped` | Start of bound stopped/started sandbox |
| `archive_restore` | Start while archived (flag on) |
| `warm_pool` | Claimed from warm pool, then start |
| `already_online` / `joined` / `ec2_short_circuit` | Non-leader / short-circuit |

Also: `warm_pool_attempts` / `warm_pool_hits` / `warm_pool_misses` on `OrchestratorMetrics.snapshot()`.

Latency samples continue via existing `wake_latency_*` histogram-equivalent (lp-77d). Catalog: [sandbox-orchestrator-metrics.md](./sandbox-orchestrator-metrics.md).

---

## 4. Warm pool (lp-vqr0.10)

When `warmPoolEnabled` and tenant is allowed:

1. Claim a stopped sandbox id for the instance pin snapshot from the in-process pool.
2. **Hit:** bind `sandbox_id` on the instance, `start`, path = `warm_pool`, increment `warm_pool_hits`.
3. **Miss:** increment `warm_pool_misses`, fall through to **cold_create**.
4. Replenish helper (`replenishWarmPool`) refills to cap **after** the ensure_online stack (`setImmediate` / test collector). Not on the Send path.
5. Cap is 1–2 for MockLab (`DAYTONA_WARM_POOL_SIZE`, default 2, clamp 0–2). One CP writer. BFF never mutates the pool. Pool store is not `gateway_instances`.
6. Prefer start-from-stopped for instances that already have a bound sandbox (pool is for **first** cold or after destroy).
7. Tests use real harness only. Do not enable `DAYTONA_WARM_POOL_ENABLED` against the paid org from CI. Live org enable is residual.

---

## 5. Acceptance (`lp-6bg`)

| Criterion | Evidence |
|-----------|----------|
| Default wake path uses fastest measured strategy | `ensureSandboxStarted` prefers start_from_stopped; retain-on-stop default; tests |
| Optional warm pool for premium flagged | Env + tenant allowlist + miss metrics + comments |
| Latency metrics improve vs cold create | Path labels `cold_create` vs `start_from_stopped`; idle re-wake no longer forced cold |

---

## 6. Revision history

| Date | Change |
|------|--------|
| 2026-08-05 | Initial implementation for `lp-6bg` |
| 2026-08-25 | `lp-vqr0.10`: in-process claim + replenish on real harness (T2) |
