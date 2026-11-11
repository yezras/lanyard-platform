# Sandbox orchestrator metrics (`lp-77d`)

**Status:** Implemented (in-process counters + latency histogram-equivalent)  
**Bead:** `lp-77d` — Metrics: wake latency, start failures, concurrent sandboxes  
**Epic:** `lp-pec` (Phase 4 Instance Orchestrator) / cost follow-up `lp-kva`  
**Code:** `portal/packages/control-plane/src/orchestrator-metrics.ts`  
**Wiring:** `InstanceOrchestrator.ensureOnline` / `stop`  
**Related:** [relay-connected-wait.md](./relay-connected-wait.md), [presence-state-machine.md](./presence-state-machine.md), [spike-bnd-wake-latencies.md](./spike-bnd-wake-latencies.md)

> **Rule:** Metrics and logs help operators see wake health and cost pressure **without** leaking secrets. Prefer IDs and enum codes. Never emit API keys, `GATEWAY_RELAY_SECRET`, raw Daytona env, vault content, or Relay internal tokens.

---

## 1. Metric catalog

Stable names (in-process today; Prometheus names if/when scraped):

| Metric / event | Kind | When | Labels / dimensions (enum only) |
| --- | --- | --- | --- |
| `sandbox_wake` | counter + latency sample | Every `ensure_online` completion | `outcome`, `path`, `latency_bucket` |
| `sandbox_start_failure` | counter (failure subset) | Wake timeout / create / start / relay fail | `reason`, `path` |
| `sandbox_wake_rejected` | counter (rate-limit subset) | New wake start rejected by lp-rq1 limits | `reason`, `rate_limit_scope` |
| `sandbox_concurrent` | gauge | After successful wake or stop | — (value = concurrent online sandboxes) |
| `sandbox_stop` | counter | Explicit or idle stop | — |

### Snapshot fields (`OrchestratorMetrics.snapshot()`)

| Field | Meaning |
| --- | --- |
| `wake_total` | ensure_online completions |
| `wake_by_outcome` | counts by `OrchestratorWakeOutcome` |
| `wake_by_path` | counts by `OrchestratorWakePath` |
| `wake_latency_count` | number of latency samples |
| `wake_latency_sum_ms` | sum of samples (avg = sum / count) |
| `wake_latency_by_bucket` | histogram-equivalent buckets |
| `start_failures_total` | failure counter |
| `start_failures_by_reason` | failure reasons |
| `wake_rejected_total` | rate-limited new wakes (lp-rq1) |
| `wake_rejected_by_reason` | reject scope (`global` / `tenant`) or reason |
| `concurrent_sandboxes` | gauge: online Daytona sandboxes in this process |
| `concurrent_waking` | gauge: in-flight singleflight wakes |
| `stop_total` | stop operations recorded |

### Outcomes (`outcome`)

| Value | Meaning |
| --- | --- |
| `success` | Leader wake reached `online` |
| `already_online` | Short-circuit; no create/start |
| `joined_success` | Singleflight waiter observed success |
| `timeout` | `wait_timeout_ms` elapsed while still waking |
| `error` | Create/start/relay/other wake failure |
| `path_gated` | Daytona path denied (allowlist / disabled) |
| `not_found` | Unknown `instance_id` |
| `revoked` | Instance revoked |
| `rate_limited` | New wake start rejected by lp-rq1 (not singleflight joiner) |

### Paths (`path`)

| Value | Meaning |
| --- | --- |
| `cold_create` | Create-from-snapshot (no bound sandbox or warm start failed) — lp-6bg |
| `cold_create_env_expired` | Cold create forced by stale baked env: bound stopped/archived sandbox older than the vault STS TTL (`DEFAULT_VAULT_ENV_MAX_AGE_MS`, 1h); `start()` would reuse expired create-time creds (lp-180p) |
| `start_from_stopped` | Start of existing bound `sandbox_id` (stopped/started) — lp-6bg |
| `archive_restore` | Start while sandbox was archived (flag on) — lp-6bg |
| `warm_pool` | Claimed pre-created pool sandbox then start — lp-vqr0.10 |
| `cold` | **Deprecated alias** of `cold_create` (still accepted on record) |
| `warm` | **Deprecated alias** of `start_from_stopped` (still accepted on record) |
| `already_online` | Presence already online |
| `joined` | Joined in-flight singleflight (path of leader unknown to waiter) |
| `ec2_short_circuit` | `runtime_kind=ec2` always-on path |
| `unknown` | Unclassified |

Warm pool counters (lp-6bg / lp-vqr0.10): `warm_pool_attempts`, `warm_pool_hits`, `warm_pool_misses` on snapshot. Hits are real claims; misses still `cold_create`.

### Failure reasons (`reason`)

| Value | Typical cause |
| --- | --- |
| `timeout` | `EnsureOnlineTimeoutError` |
| `create_failed` | Daytona create error |
| `start_failed` | Daytona start / not-started state |
| `relay_never_connect` | Gateway never connected after start + recreate |
| `relay_unreachable` | Relay presence HTTP failure |
| `snapshot_missing` | No instance pin and no platform default |
| `wake_aborted` | CAS race → presence already error |
| `path_gated` | Tenant / platform Daytona gate |
| `not_found` / `revoked` | Store lookup |
| `rate_limited` | `EnsureOnlineRateLimitedError` (lp-rq1) |
| `unexpected_presence` | Illegal post-wake presence |
| `other` | Unclassified |

### Latency buckets (`latency_bucket`)

Histogram-equivalent for wake wall time (create/start + optional Relay wait):

| Bucket | Range |
| --- | --- |
| `lt_500ms` | &lt; 500 ms |
| `500ms_2s` | &lt; 2 s |
| `2s_5s` | &lt; 5 s |
| `5s_15s` | &lt; 15 s |
| `15s_30s` | &lt; 30 s |
| `30s_60s` | &lt; 60 s |
| `gte_60s` | ≥ 60 s |

Implementation: `orchestratorLatencyBucket()` in `orchestrator-metrics.ts`.

**Forbidden labels:** API keys, secrets, raw env maps, vault object bodies, free-form `error.message` as a Prometheus label (use `reason` enum; full message only in redacted L1 logs if needed).

**Allowed dimensions:** `outcome`, `path`, `reason`, `latency_bucket`, optional `tenant_id` / `instance_id` / `sandbox_id` in **logs** (not high-cardinality series unless ops explicitly accepts it).

---

## 2. Safe log fields

Every wake / failure / stop log line should prefer this envelope (`buildOrchestratorSafeLogFields`):

| Field | Required | Notes |
| --- | --- | --- |
| `event` | yes | `sandbox_wake` \| `sandbox_start_failure` \| `sandbox_stop` |
| `instance_id` | when known | Product identity (not sandbox_id as Relay id) |
| `tenant_id` | when known | Tenant isolation |
| `sandbox_id` | when known | Ephemeral Daytona id; null when unbound |
| `outcome` | wake | See §1 |
| `path` | wake | cold / warm / … |
| `reason` | failure | See §1 |
| `latency_ms` | wake | Integer ms |
| `latency_bucket` | wake | See §1 |
| `wake_joined` | optional | Singleflight waiter |
| `already_online` | optional | Short-circuit flag |
| `concurrent_sandboxes` | recommended | Gauge after event |
| `concurrent_waking` | recommended | In-flight wakes |

**Never log:** `apiKey`, `GATEWAY_RELAY_SECRET`, Daytona `env` values, Relay internal tokens, vault file bodies.

---

## 3. Concurrent sandboxes gauge

| Gauge | Update rule |
| --- | --- |
| `concurrent_sandboxes` | +1 on leader wake success that newly came online; −1 on stop of previously online compute |
| `concurrent_waking` | Set from `inflightWakeCount()` around ensure_online |

**Notes:**

- Process-local; multi-replica CP sums gauges at scrape time or reconciling from presence store (`presence=online` + `sandbox_id` not null).
- Feeds cost visibility (`lp-kva` concurrent sandboxes / always-on misconfig). Pilot quantified comparison: [cost-report-daytona-vs-ec2.md](./cost-report-daytona-vs-ec2.md) (`lp-zuh.14.1`).
- Idle reaper stops decrement via the same `stop` path.

---

## 4. Code map

| Surface | Path |
| --- | --- |
| Counters, histogram buckets, classifiers, log builders | `portal/packages/control-plane/src/orchestrator-metrics.ts` |
| ensure_online / stop emission | `portal/packages/control-plane/src/instance-orchestrator.ts` |
| Optional structured log sink | `InstanceOrchestratorDeps.logSafe` |
| Unit tests | `portal/packages/control-plane/test/orchestrator-metrics.test.ts` |
| Package export | `@lanyard/control-plane` (`OrchestratorMetrics`, helpers) |

### Future Prometheus export (out of scope for `lp-77d`)

Suggested scrape series (when an exporter is added):

```text
lanyard_sandbox_wake_total{outcome,path}
lanyard_sandbox_wake_latency_ms_bucket{le,path}
lanyard_sandbox_wake_latency_ms_sum / _count
lanyard_sandbox_start_failures_total{reason}
lanyard_sandbox_concurrent
lanyard_sandbox_concurrent_waking
```

---

## 5. Acceptance checklist (`lp-77d`)

| Criterion | Evidence |
| --- | --- |
| Wake latency histogram or equivalent | `wake_latency_by_bucket` + sum/count; buckets §1 |
| Failure counter | `start_failures_total` + `start_failures_by_reason` |
| Documented metric names | This catalog §1 |
| Labels for ops | Safe log fields: `instance_id`, `sandbox_id`, `tenant_id`, enums |

---

## 6. Revision history

| Date | Change |
| --- | --- |
| 2026-08-05 | Initial catalog + in-process implementation for `lp-77d` |
| 2026-08-05 | Path labels `cold_create` / `start_from_stopped` (+ archive/warm_pool) for `lp-6bg` |
| 2026-08-24 | Path label `cold_create_env_expired` — stale baked-env cold create guard (lp-180p) |
