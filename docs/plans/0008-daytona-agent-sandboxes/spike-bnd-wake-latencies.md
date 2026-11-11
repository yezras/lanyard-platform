# Spike notes: `lp-bnd` — create / start-stopped / archive restore latencies

**Bead:** `lp-bnd`  
**Epic:** Phase 0 `lp-6tq` (parent under `lp-kng`)  
**Date:** 2026-08-04  
**Status:** Complete — n≥5 samples each path; recommendation for default `ensure_online`; thrifty cleanup.

Related: org/API [`spike-v2p-org-access.md`](./spike-v2p-org-access.md), container stand-in [`spike-z1u-linux-vm-sandbox.md`](./spike-z1u-linux-vm-sandbox.md) (§6.1 AC1 waiver), overview [overview.md](./overview.md) § wake latency.

---

## 1. Goal

Benchmark p50/p95 wake paths on managed Daytona (container class OK under Phase 0 waiver) for:

1. **create-from-snapshot**
2. **start-from-stopped**
3. **restore-from-archive** (start after archive)

Recommend which path should be the default `ensure_online` warm/cold strategy. Optimize later for as-fast-as-possible (warm pool / snapshot reuse — `lp-6bg`).

**Assumptions (plan §4.3):** measurements use a **prebaked** general snapshot only. Do **not** count install-on-boot as a product wake path.

---

## 2. Method (thrifty)

| Item | Value |
|------|--------|
| API base | `https://app.daytona.io/api` |
| Auth | SM `lanyard/staging/portal/daytona` (name only; key never committed) |
| Org | `5b45bf51-5792-4f75-a54a-ffa6c4752d6e` · target `us` · Tier 1 |
| Snapshot reused | **`daytonaio/sandbox:0.8.0`** (general container; no org snapshot create) |
| Isolation class | **container** (Linux VM unavailable — see `lp-z1u`) |
| Labels | `lanyard_spike=lp-bnd` |
| Create samples | n=5 ephemeral (`autoDeleteInterval=0` → destroy on stop) |
| Start / archive | n=5 on **one** holder sandbox `autoDeleteInterval=30` (minutes after stop) |
| Latency definition | wall clock from API call start until `GET /sandbox/{id}` reports `state=started` |
| Window (UTC) | 2026-08-04T16:35:49Z → 2026-08-04T16:39:07Z |

### APIs used

| Path | Method | Role |
|------|--------|------|
| `/sandbox` | `POST` | create-from-snapshot |
| `/sandbox/{id}/stop` | `POST` | stop between samples |
| `/sandbox/{id}/start` | `POST` | start-from-stopped **and** restore-from-archive |
| `/sandbox/{id}/archive` | `POST` | move stopped → `archived` (must be stopped first) |
| `/sandbox/{id}` | `GET` | poll state |
| `/sandbox/{id}` | `DELETE` | cleanup |

**No separate restore endpoint:** `POST …/restore` returns “Cannot POST”. Restore = `POST …/start` while state is `archived`.

---

## 3. Latency table (seconds to `started`)

All samples **ok** (n_ok = 5/5 each). Class = container · region = us · snapshot = `daytonaio/sandbox:0.8.0`.

### Summary

| Path | n | min | mean | **p50** | **p95** | max |
|------|---|-----|------|---------|---------|-----|
| **create-from-snapshot** | 5 | 0.697 | 5.212 | **0.741** | **18.625** | 23.069 |
| **start-from-stopped** | 5 | 0.716 | 2.564 | **2.765** | **4.975** | 5.471 |
| **restore-from-archive** | 5 | 2.436 | 3.699 | **3.577** | **5.555** | 5.910 |

p50/p95 are linear-interpolated order statistics on the five ok samples (small-n; treat as directional, not production SLOs).

### Per-sample: create-from-snapshot

| i | sandbox_id (prefix) | latency_s | notes |
|---|---------------------|-----------|--------|
| 1 | `042ed4ec-…` | 0.849 | create HTTP ~0.78s; already `started` |
| 2 | `66c70dd2-…` | 0.706 | |
| 3 | `a1b1b7b0-…` | 0.741 | |
| 4 | `3c3a33d0-…` | 0.697 | |
| 5 | `ae8d47ca-…` | **23.069** | cold-tail / capacity; create HTTP ~23s |

### Per-sample: start-from-stopped

Holder: `607a5a1e-1805-4daa-af46-113f408280a7` (stopped between samples).

| i | latency_s |
|---|-----------|
| 1 | 2.765 |
| 2 | 2.993 |
| 3 | 5.471 |
| 4 | 0.876 |
| 5 | 0.716 |

### Per-sample: restore-from-archive

Same holder. Cycle: stop → `POST …/archive` → wait `archived` → measure `POST …/start` → `started`.

| i | latency_s | start HTTP_s (async ack) |
|---|-----------|--------------------------|
| 1 | 4.134 | ~0.08 |
| 2 | 2.436 | ~0.09 |
| 3 | 5.910 | ~0.09 |
| 4 | 2.440 | ~0.09 |
| 5 | 3.577 | ~0.09 |

Archive transition itself took on the order of **~10–40s** to reach `archived` (not included in restore latency above; product idle cost path, not hot wake).

---

## 4. Recommendation: default `ensure_online`

| Situation | Preferred Daytona path | Rationale |
|-----------|------------------------|-----------|
| Mapped `sandbox_id` exists and state is **stopped** (idle grace) | **`POST …/start` (start-from-stopped)** | p95 ~5s, stable sandbox_id binding, no re-create; tighter tail than cold create |
| No usable sandbox (null / destroyed / not found) | **create-from-snapshot** | Often **fastest** p50 (~0.7s) on default container snapshot; matches lazy provision model |
| State **archived** (long-idle cost tier) | **`POST …/start` (restore)** | Works; p50 ~3.6s / p95 ~5.6s — acceptable for rare long-idle, **not** for 30‑min product idle grace |
| Idle within product grace (30 min) | Keep **stopped**, do **not** auto-archive | Preserves start-from-stopped warm path; archive add ~10–40s to leave archived before the next start |

### Default policy (normative intent for orchestrator)

1. **Warm default:** retain sandbox through idle grace as **stopped**; `ensure_online` → **start-from-stopped**.  
2. **Cold default:** if no `sandbox_id` (or start fails not-found) → **create-from-snapshot** from pin / `DAYTONA_DEFAULT_SNAPSHOT`.  
3. **Archive:** only after **extended** idle beyond grace (billing), not as the 30‑min idle action.  
4. **Do not** optimize for archive-restore as the primary wake path.  
5. Watch **create cold-tail** (one 23s sample under parallel org load); warm pool / pre-created stopped capacity is the follow-on for `lp-6bg` if p95 of create remains unacceptable.

**Why not always create (even though p50 is best)?**  
Create rebinds `sandbox_id`, pays the heavy tail, and loses any runner/local warm state. Product durability is S3 vault (not local disk), so create is still fine for cold path — but idle grace should prefer **stop/start** for predictability and identity stability in the CP map.

---

## 5. Acceptance mapping

| Criterion | Met? | Evidence |
|-----------|------|----------|
| 1. Table create / start-stopped / archive restore n≥5 each | **Yes** | §3 — all three paths 5/5 ok; container class |
| 2. Recommendation for default `ensure_online` | **Yes** | §4 — warm=start-stopped; cold=create; archive=extended idle only |
| 3. Numbers in spike report | **Yes** | this file |
| Cleanup; no secrets | **Yes** | holder deleted; final list had **0** `lp-bnd` sandboxes (left peer `lp-4dk` hold alone); SM name only |

---

## 6. Residual / next

| Item | Owner |
|------|--------|
| Create p95 / cold-tail under load | `lp-6bg` warm pool / snapshot optimizations → [warm-pool-snapshot-wake.md](./warm-pool-snapshot-wake.md) |
| Re-measure on **product agent snapshot** (Phase 2) | `lp-4xa` then optional re-bench |
| Linux VM class latencies | Blocked until runners (`lp-z1u` residual → `lp-ctu`) |
| $10 shared cap | This spike ~3–4 min wall; ephemeral create samples + one holder; cleaned |

**Unblocks:** `lp-6bg` (warm pool design inputs), `lp-ctu` (go/no-go latency inputs).

---

## 7. Repro (operators — no secrets in history)

```bash
export AWS_PROFILE=lanyard-main AWS_DEFAULT_REGION=us-east-1
# Load DAYTONA_* from SM lanyard/staging/portal/daytona (do not echo key)
# POST /sandbox { snapshot: "daytonaio/sandbox:0.8.0", target: "us", autoDeleteInterval: 0 }  # create timing
# POST /sandbox/{id}/stop ; POST /sandbox/{id}/start   # start-stopped timing (autoDeleteInterval>0)
# POST /sandbox/{id}/archive (from stopped) ; POST /sandbox/{id}/start  # restore timing
# DELETE all sandboxes labeled lanyard_spike=lp-bnd
```
