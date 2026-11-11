# Cost report: Daytona vCPU-hours vs prior EC2 estimate (`lp-zuh.14.1`)

**Status:** Quantified pilot comparison (illustrative public-list rates; not a contracted quote)  
**Bead:** `lp-zuh.14.1` (supersedes tracking for `lp-iy2`)  
**Parent epic:** `lp-zuh.14` / `lp-zuh` (Phase 10: Proof and cost report)  
**Evidence pack:** [`artifacts/daytona-pilot/cost-report/`](../../../artifacts/daytona-pilot/cost-report/)  
**Date:** 2026-08-19

## 1. Purpose

Answer, with numbers, whether the MockLab / pilot **Daytona on-demand** path is cheaper than the prior **always-on company-brain EC2** estimate for a realistic interactive usage pattern — and confirm that the savings depend on the **stop/idle** path (not leaving sandboxes always-on).

## 2. Sources

| Source | Role | Pointer |
|--------|------|---------|
| Idle stop + re-wake proof | Confirms cost path is stop → retain → start-from-stopped | Bead `lp-8sn` (closed 2026-08-06); offline twin [`fake-daytona-wake-stop-rewake.md`](./fake-daytona-wake-stop-rewake.md) (`lp-cbv`) |
| Idle reaper (primary stop) | **10 min** grace (`DEFAULT_IDLE_GRACE_MS`, `lp-kng.8`) | [`idle-reaper.md`](./idle-reaper.md) |
| Vendor autoStop (backstop) | **90 min** if CP fails to stop | [`daytona-autostop-safety-net.md`](./daytona-autostop-safety-net.md) |
| Cost dashboards / formulas | Concurrent → started-hours → vCPU-hours; always-on alerts | Bead `lp-kva` (PR [#329](https://github.com/LanyardBrain/lanyard-platform/pull/329) draft cookbook); metrics catalog [`sandbox-orchestrator-metrics.md`](./sandbox-orchestrator-metrics.md) (`lp-77d`) |
| Prior EC2 sizing | MockLab / tenant MVP host | `deploy/deployments/mocklab` + `deploy/templates/tenant`: `instance_type = "t3.medium"`, root volume **40 GiB** |
| Daytona public list rates | Illustrative $/vCPU-h and $/GiB-h | [daytona.io/pricing](https://www.daytona.io/pricing) (retrieved 2026-08; per-second bill) |
| EC2 public On-Demand | Illustrative always-on host $ | AWS EC2 T3 Linux us-east-1 On-Demand for `t3.medium` |

> **Honesty:** Dollar lines below use **public list** rates. Contracted Daytona / AWS rates, prepaid credits, Spot/RI, and regional multipliers will differ. Do not hardcode these rates into alerts (`lp-kva` rule); keep rates in ops notebooks.

## 3. Stop / idle path (not always-on)

Daytona savings **only** materialize if compute stops when idle:

```text
idle grace (10m CP reaper)  <  mid-turn max hold (45m)  <  vendor autoStop (90m)
```

| Layer | Owner | Default | Cost role |
|-------|--------|---------|-----------|
| Idle reaper | CP orchestrator | **10 min** no `signal-activity` | **Primary** stop |
| Mid-turn hold | CP | **45 min** max | Prevents stop during long tool turns |
| Vendor `autoStopInterval` | Daytona create field | **90 min** | Safety net if CP/reaper down |

**Live proof (`lp-8sn`, MockLab 2026-08-06):** sandbox `71ef3a01` observed **stopped**; `ensure_online` → `presence=online`, same `sandbox_id`, `wake_ms≈1082` (`start_from_stopped`); chat POST 200 after re-wake. Close reason cites `artifacts/daytona-pilot/lp-8sn-rewake-evidence.md` (file not retained on `main`; bead close reason + offline `lp-cbv` tests remain durable).

**Offline proof (`lp-cbv`):** real harness wake → deliver → idle stop (retain `sandbox_id`) → start-from-stopped re-wake in CI.

**Misconfig warning:** a Daytona sandbox left always-on (reaper off / `autoStopInterval=0` / stuck `mid_turn`) burns started-hours ≈ 24×30 = **720 h/mo** and can **exceed** the always-on EC2 line — detect via `lp-kva` concurrent / started-hours alerts.

## 4. Pilot usage pattern (acceptance scenario)

| Parameter | Value | Notes |
|-----------|-------|-------|
| Pattern | **2 h/day active** interactive chat | Acceptance example for `lp-zuh.14.1` / `lp-iy2` |
| Sessions / day | **1** contiguous session | Conservative; multi-session adds one idle-grace tail each |
| Idle grace after last activity | **10 min** (0.167 h) | Current `DEFAULT_IDLE_GRACE_MS` |
| Days / month | **30** | Pilot sketch |
| Started-hours / day | 2.0 + 0.167 = **2.167 h** | Active + one grace tail |
| Started-hours / month | 2.167 × 30 = **65.0 h** | Sandbox online wall time |
| Always-on EC2 hours / month | **730 h** | 24×30.417 ≈ 730 conventional |

### Sensitivity (same 2 h active / day)

| Sessions / day | Grace tails | Started-h / day | Started-h / mo |
|----------------|-------------|-----------------|----------------|
| 1 | 1 × 10m | 2.17 | **65** |
| 2 | 2 × 10m | 2.33 | **70** |
| 4 | 4 × 10m | 2.67 | **80** |
| Always-on misconfig | n/a | 24 | **720** |

## 5. Prior EC2 estimate (always-on)

Pilot / MockLab documented MVP host:

| Item | Value |
|------|-------|
| Instance | **`t3.medium`** (2 vCPU, 4 GiB) |
| Region sketch | us-east-1 Linux On-Demand |
| Hourly (list) | **~$0.0416 / h** |
| Hours / mo | **730** |
| Compute $ / mo | 730 × 0.0416 ≈ **$30.37** |
| Root EBS | **40 GiB** gp3 (module default) ≈ **~$3.20 / mo** at ~$0.08/GiB-mo |
| **Host line (sketch)** | **~$33.6 / mo** always-on |
| vCPU-hours / mo | 2 × 730 = **1,460** |

EC2 does **not** stop for chat idle (`runtime_kind=ec2` is never reaped).

## 6. Daytona estimate (thrifty 2 h/day)

Formulas (from `lp-kva` / `lp-77d`):

```text
started_hours ≈ ∫ concurrent(t) dt / 3600
vcpu_hours    = started_hours × VCPU_PER_SANDBOX
```

Pilot create path often uses container-class without an explicit CPU override in CP — `lp-kva` treats **`VCPU_PER_SANDBOX = 1`** as the default proxy until product pins a class. We also show a **2 vCPU / 4 GiB** parity row matching `t3.medium`.

**Public Daytona list rates** (per-second → hourly; retrieved 2026-08):

| Resource | Rate |
|----------|------|
| vCPU | **$0.0504 / vCPU-h** ($0.000014 / s) |
| Memory | **$0.0162 / GiB-h** |
| Storage | **$0.000108 / GiB-h** after first 5 GiB free |

### 6.1 Sketch A — 1 vCPU + 2 GiB (pilot proxy)

| Metric | Value |
|--------|-------|
| Started-hours / mo | **65** |
| vCPU-hours / mo | **65** |
| Compute $ | 65 × 0.0504 ≈ **$3.28** |
| Memory $ | 65 × 2 × 0.0162 ≈ **$2.11** |
| Storage sketch (10 GiB reserved, always) | 10 × 0.000108 × 730 ≈ **$0.79** |
| **Tenant compute line** | **~$6.2 / mo** |

### 6.2 Sketch B — 2 vCPU + 4 GiB (EC2-class parity)

| Metric | Value |
|--------|-------|
| Started-hours / mo | **65** |
| vCPU-hours / mo | **130** |
| Compute $ | 130 × 0.0504 ≈ **$6.55** |
| Memory $ | 65 × 4 × 0.0162 ≈ **$4.21** |
| Storage sketch (10 GiB) | **~$0.79** |
| **Tenant compute line** | **~$11.6 / mo** |

### 6.3 Always-on Daytona misconfig (do not do this)

| Class | Started-h / mo | Approx $ / mo (compute+mem) |
|-------|----------------|-----------------------------|
| 1 vCPU + 2 GiB | 720 | 720×0.0504 + 720×2×0.0162 ≈ **$59.6** |
| 2 vCPU + 4 GiB | 720 | 720×0.1008 + 720×4×0.0162 ≈ **$119.2** |

Always-on Daytona **loses** to always-on EC2 on public list rates — reinforcing that the idle stop path is the cost feature.

## 7. Head-to-head (one pilot tenant instance / month)

| Line | Always-on EC2 `t3.medium` | Daytona thrifty (2 h/day + 10m grace) | Ratio |
|------|---------------------------|----------------------------------------|-------|
| Started / online hours | 730 | **65** | **11.2×** fewer hours |
| vCPU-hours (1 vCPU proxy) | 1,460 (2×730) | **65** | **22.5×** fewer |
| vCPU-hours (2 vCPU parity) | 1,460 | **130** | **11.2×** fewer |
| Approx $ (host / sandbox) | **~$34** | **~$6–12** | **~3–5×** cheaper |
| Idle stop? | No | **Yes** (reaper + autoStop) | Required for thrift |

**Platform always-on costs** (Portal / BFF / CP / Relay / RDS / S3) are **out of scope** for this tenant-compute comparison; they exist under both paths.

## 8. How to measure live (ops)

Use `lp-kva` cookbook (PR #329) + `lp-77d` metrics:

1. Concurrent gauge `lanyard_sandbox_concurrent` / log field `concurrent_sandboxes`
2. Started-hours ≈ average concurrent × window hours
3. vCPU-hours ≈ started-hours × `VCPU_PER_SANDBOX`
4. Alert ideas: concurrent ≥ 1 for ≥ 2 h with zero stops; started-hours > 12 / 24 h for a ≤2-tenant lab

Healthy pilot shape: concurrent spikes on chat, returns to **0** within ~10–15 min idle (grace + scan lag).

## 9. Acceptance checklist (`lp-zuh.14.1`)

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | Report with numbers for pilot usage (e.g. 2 h/day vs always-on EC2) | §§4–7 |
| 2 | Linked from plan `docs/plans/0008-daytona-agent-sandboxes/` | This file + [`overview.md`](./overview.md) + [`issue-map.md`](./issue-map.md) |
| 3 | Confirms stop/idle path (not always-on); cite `lp-8sn` / dashboards `lp-kva` | §3, §6.3, §8 |
| 4 | Evidence under `artifacts/daytona-pilot/cost-report/` or docs/ | This file + [`artifacts/daytona-pilot/cost-report/REPORT.md`](../../../artifacts/daytona-pilot/cost-report/REPORT.md) |

## 10. Revision history

| Date | Change |
|------|--------|
| 2026-08-19 | Initial pilot cost report for `lp-zuh.14.1` (supersedes `lp-iy2` tracking) |
