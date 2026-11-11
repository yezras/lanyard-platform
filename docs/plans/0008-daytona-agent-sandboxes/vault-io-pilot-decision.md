# Pilot decision: Vault I/O on Mountpoint S3 (`lp-eto.1`)

**Bead:** `lp-eto.1`  
**Epic:** Phase 3 `lp-eto` (Vault on Lanyard S3 V1b) — residual from Phase 0 `lp-ctu` / `lp-kx4`  
**Date:** 2026-08-04  
**Status:** **Decision documented** — pilot path locked; optional guest cache **deferred** (not a pilot gate)  
**No secrets** in this file (lab bucket names and public URIs only).

Related:

| Source | Role |
|--------|------|
| [spike-kx4-vault-io-patterns.md](./spike-kx4-vault-io-patterns.md) | Measured list / many-small / sequential I/O on Mountpoint |
| [spike-ctu-go-no-go.md](./spike-ctu-go-no-go.md) | Aggregate **CONDITIONAL GO** (vault I/O condition §4 / §8) |
| [spike-3en-s3-vault-mount.md](./spike-3en-s3-vault-mount.md) | Mountpoint as `VAULT_ROOT` proof |
| [s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md) | Normative prefix + logical vault tree |
| [gateway-env-contract.md](./gateway-env-contract.md) | Agent sees filesystem under `VAULT_ROOT` only |
| [overview.md](./overview.md) | Plan anchor (locked decision: Vault = Lanyard S3 Mountpoint V1b) |

---

## 1. Executive decision (normative for pilot)

| Topic | Decision | Pilot gate? |
|-------|----------|-------------|
| **Sparse / packed vault I/O** | **GO** for managed Daytona pilot | Yes — pilot **must** follow sparse/packed patterns |
| **Many-small-file loops without guest cache** | **NO-GO** | Yes — pilot agents **must not** assume local-SSD chatty I/O |
| **POSIX append / in-place open-for-write on `VAULT_ROOT`** | **Unsupported** on Mountpoint — use **write-temp + replace** | Yes — writers **must** redesign |
| **Guest working-set cache** (tmpfs / local volume + durable flush) | **Deferred** optional follow-up | **No** — not required to exit Phase 3 / start pilot dual-run |

**One-line:** Mountpoint vault is the durable pilot path for **sparse or packed** objects; it is **not** a drop-in local SSD. Chatty many-small-file agent patterns are forbidden for pilot without a later cache redesign.

This document **closes** the product I/O residual filed as `lp-eto.1` from [spike-ctu-go-no-go.md](./spike-ctu-go-no-go.md) §9. It does **not** re-open go/no-go on managed Daytona itself (that remains **CONDITIONAL GO**).

---

## 2. Evidence summary (from `lp-kx4`)

All numbers: container sandbox, Mountpoint `mount-s3` → `/mnt/vault`, lab prefix  
`s3://lanyard-mocklab-vault-123456789012/tenants/mocklab/vault/`, region `us-east-1`, 64 B “small” payloads. Full tables: [spike-kx4-vault-io-patterns.md](./spike-kx4-vault-io-patterns.md) §3.

| Pattern | Approx cost | Pilot tolerance |
|---------|-------------|-----------------|
| List vault root / small dirs | ~20–65 ms | **OK** |
| Single small read | ~50–200 ms (p50 ~75) | **OK** if sparse |
| 100 small reads in series | **~8.5 s** | **NO** for interactive turns without cache |
| Single small write (create) | ~0.21–0.38 s | **OK** if sparse |
| 100 small writes | **~27 s** | **NO** without redesign |
| 1 MiB sequential write | ~0.3–0.4 s | **OK** (prefer fewer/larger objects) |
| Append / open existing for write (`"ab"`) | **`PermissionError`** | **Must redesign** |

Second-pass re-read of 100 small files still ~8 s — **do not** assume Mountpoint page cache fixes agent loops ([spike-kx4](./spike-kx4-vault-io-patterns.md) §3.3).

---

## 3. Product rules (pilot)

### 3.1 GO — sparse and packed I/O

Pilot agent / gateway paths **may** rely on Mountpoint `VAULT_ROOT` when they:

1. **List** small directories for inventory (tens of ms).  
2. Perform **occasional** single-object reads (order ~100 ms).  
3. Perform **infrequent** durable creates / full overwrites of modest objects (order ~0.3 s).  
4. Prefer **fewer, larger objects** (batch state, packed indexes, bundled manifests) over trees of tiny files.  
5. Treat sequential multi-hundred-KiB / MiB writes as the efficient durable path when more bytes must land in S3.

**Packed objects** means: when product needs many logical records per turn, store them in one (or few) vault files and parse in memory — do not open N independent S3-backed files per turn.

### 3.2 NO-GO — many-small-file without guest cache

Pilot **must not** ship agent patterns that, on each interactive turn (or tight loop):

- open/read **hundreds** of tiny vault files, or  
- create **hundreds** of tiny vault files, or  
- re-walk the full vault with per-file open/read as if latency were local SSD.

Those patterns are **NO-GO without** a guest working-set cache or an I/O redesign that reduces S3 object ops. Evidence: 100×64 B reads ~8.5 s; 100 writes ~27 s ([spike-kx4](./spike-kx4-vault-io-patterns.md) §4).

### 3.3 No POSIX append on `VAULT_ROOT` (write-temp + replace)

Mountpoint does **not** support append or open-existing-for-write on the vault mount ([spike-kx4](./spike-kx4-vault-io-patterns.md) §3.5).

| Forbidden on Mountpoint `VAULT_ROOT` | Required pattern |
|--------------------------------------|------------------|
| `open(path, "a")` / `"ab"` append | Write a **temp object** (same dir or staging path under vault), then **replace** the durable key (delete + put, or overwrite replace per Mountpoint flags) |
| In-place mutation of an existing file | Full rewrite of the object (read → merge in memory → write-temp → replace) |
| Assuming `O_APPEND` / random write | Same as full rewrite |
| Assuming POSIX **`rename` is atomic/available** | Mountpoint-S3 returns **`ENOSYS`** for `rename` (live `lp-zuh.10.4`). Prefer overwrite of the canonical key (or delete+put). Cron `jobs.json` writers must fall back when rename fails. |

**Audience:** gateway writers, agent tools, Brain RPC vault write paths, any log or state mutator that targets `VAULT_ROOT` under `runtime_kind=daytona`.

EC2 host-disk vault may still allow POSIX append today; **Daytona pilot writers must use the write-temp + replace pattern** so dual-run and Daytona-only tenants do not diverge on failure modes. Prefer the portable pattern on **both** paths when touching shared vault code.

### 3.4 Pilot agents do not assume local-SSD many-small semantics

| Assumption (wrong) | Correct pilot model |
|--------------------|---------------------|
| Vault is local SSD / tmpfs | Vault is **S3 via FUSE Mountpoint**; durability is S3 |
| Hundreds of small I/Os per turn are free | Each file op is often an S3 API call (~tens–hundreds of ms) |
| Re-read is free after first pass | Guest page cache did **not** collapse 100-file re-read cost in spike |
| Append logs on vault path | Use write-temp + replace or keep high-churn logs **off** vault (e.g. `BACKEND_HOME` ephemeral) |

Normative env still exposes a filesystem path (`VAULT_ROOT`); semantics are **Mountpoint**, not block storage. See [gateway-env-contract.md](./gateway-env-contract.md).

---

## 4. Guest cache — deferred (not pilot gate)

### 4.1 Decision

| Item | Value |
|------|--------|
| **Pilot requirement** | **No** guest cache required |
| **When to build** | Only if product later needs chatty many-small-file agent loops that cannot be packed |
| **Follow-up** | Implementation bead(s) under vault/agent entrypoint (filed from this residual; **not** blocking Phase 3 exit) |

### 4.2 Design sketch (non-normative until follow-up bead)

If product later chooses a cache path:

| Element | Intent |
|---------|--------|
| **Hot set location** | Guest **tmpfs**, sandbox-local disk, or Daytona volume — **not** the Mountpoint root for hot loops |
| **Cold / durable** | Flush completed working set to Mountpoint `VAULT_ROOT` (S3) with sparse writes or packed objects |
| **Consistency** | Define flush barriers (end of turn, explicit sync, idle stop) so stop/start does not lose committed vault state |
| **Who owns it** | Entrypoint and/or agent I/O helper — agent product API should still prefer `VAULT_ROOT` contract names where possible |
| **Out of scope for pilot** | Implementing this layer, benchmarking it, or changing Mountpoint itself |

**Daytona Volumes** remain **not** a substitute for Lanyard vault durability ([spike-ctu](./spike-ctu-go-no-go.md) §4); any cache is a **performance** layer that still flushes to S3-backed `VAULT_ROOT`.

### 4.3 Why deferred is correct for pilot

1. Spike **CONDITIONAL GO** already allows pilot under **sparse** I/O ([spike-ctu](./spike-ctu-go-no-go.md) §8 condition 4).  
2. Preferring packed objects avoids building a second storage layer before dual-run.  
3. Cache adds consistency, flush, and security surface (hot set may hold tenant data) — worth a dedicated design when a real chatty workload appears.

---

## 5. Implications by surface

| Surface | Pilot action |
|---------|----------------|
| **Phase 3 vault apply (`lp-eto`)** | Ship Mountpoint + scoped IAM + prefix layout; **heed** sparse I/O + no-append rules |
| **Agent / gateway writers** | No append; no hundreds-of-tiny-files per turn; pack when possible |
| **Orchestrator (`lp-hjo` et al.)** | Mount at `VAULT_ROOT`; no change required for cache (none in pilot) |
| **Phase 2 snapshot** | Pre-bake `mount-s3` (existing condition); cache layer not in image for pilot |
| **Dual-run / proof** | Fail tests or review that assume local many-small latency on Daytona path |
| **EC2 tenants** | Unchanged host disk; shared code should still prefer write-temp + replace for portability |

---

## 6. Non-goals

- Changing Mountpoint product behavior or S3 consistency model  
- Implementing guest cache in this bead  
- Re-opening isolation (container vs linux-vm) or Relay DNS residuals  
- Live AWS spend or new lab sandboxes for this documentation bead  
- Migrating Hermes / Lanyard Agent product code (external unless a later bead asks)

---

## 7. Acceptance mapping (`lp-eto.1`)

| Criterion | Met? | Evidence |
|-----------|------|----------|
| Product decision documented: sparse/packed vs guest working-set cache | **Yes** | §1, §3, §4 |
| If cache path chosen: design note + implementation bead(s) | **N/A for pilot** — cache **deferred**; design sketch §4.2; follow-up bead noted in §8 | |
| Document no POSIX append on `VAULT_ROOT` (write-temp + replace) | **Yes** | §3.3 |
| Pilot agent paths do not assume local-SSD many-small semantics | **Yes** | §3.2, §3.4 |
| Linked from plan overview | **Yes** | [overview.md](./overview.md) |
| No secrets committed | **Yes** | public lab URI / SM names only in sources |

---

## 8. Follow-up

| Work | Gate? | Notes |
|------|-------|-------|
| Optional guest working-set cache design + impl | **Not pilot** | Deferred bead **`lp-eto.2`** (P3, parent `lp-eto`) — implement only when a chatty workload is product-required |
| Enforce packed/sparse discipline in agent tools | Product / later beads | Code changes only when a bead explicitly migrates agent I/O |
| Guest write uid/gid on Mountpoint | Existing residual | Entrypoint `--uid/--gid` (`lp-3en` / Phase 2 entrypoint) — orthogonal to this I/O decision |

---

## 9. Bottom line

| Verdict | Scope |
|---------|--------|
| **GO** | Sparse and packed vault I/O on Mountpoint for managed Daytona pilot |
| **NO-GO** | Many-small-file agent loops **without** guest cache |
| **Must redesign** | Append / in-place writes → **write-temp + replace** |
| **Deferred** | Guest cache implementation — **not** a Phase 3 / pilot exit gate |

Closes Phase 0 residual **`lp-eto.1`**. Phase 3 epic `lp-eto` may close when this bead closes if no other children remain open.
