# Spike notes: `lp-kx4` — Vault FUSE/S3 I/O patterns

**Bead:** `lp-kx4`  
**Epic:** Phase 0 `lp-6tq` (parent under `lp-kng`)  
**Date:** 2026-08-04  
**Status:** **Complete** — thrifty container sandbox mounted lab vault via Mountpoint (`mount-s3`); directory list, 100 small reads, sequential write benches recorded; go/no-go with cache caveats; cleanup empty.

Related: mount spike [`spike-3en-s3-vault-mount.md`](./spike-3en-s3-vault-mount.md) (`lp-3en`), layout [`s3-vault-prefix-layout.md`](./s3-vault-prefix-layout.md), IAM draft [`iam-scoped-s3-mount-policy.md`](./iam-scoped-s3-mount-policy.md), go/no-go parent epic residual `lp-ctu`.

---

## 1. Goal

Benchmark **vault-like I/O** against a **mounted Lanyard S3 prefix** (`VAULT_ROOT` via Mountpoint) so Phase 0 can catch agent pain early:

1. Directory **list**
2. **100 small reads**
3. **Sequential write** patterns

Produce a **go/no-go note** if the agent cannot tolerate latency **without a local cache**.

**Lab vault URI (public):**

```text
s3://lanyard-mocklab-vault-123456789012/tenants/mocklab/vault/
```

Spike objects under:

```text
tenants/mocklab/vault/spike-kx4/
```

---

## 2. Method (thrifty, reuse `lp-3en`)

| Item | Value |
|------|--------|
| Isolation | **container** (Phase 0 waiver `lp-z1u` §6.1) |
| Snapshot | default `daytonaio/sandbox:0.8.0` |
| sandbox_id | `91b6a242-43e9-4232-9c95-6af6d2d5cc0a` |
| Labels | `lanyard_spike=lp-kx4`, `lanyard_bead=lp-kx4` |
| Mount | `mount-s3` **1.23.0** → `/mnt/vault` = `VAULT_ROOT` |
| Prefix | `tenants/mocklab/vault/` on bucket `lanyard-mocklab-vault-123456789012` |
| Region | `us-east-1` |
| Lifecycle | `autoDeleteInterval=0`, `autoStopInterval=30` |
| Operator | `AWS_PROFILE=lanyard-main`, account `123456789012` |
| Daytona SM | name only: `lanyard/staging/portal/daytona` |
| Lab IAM | ephemeral role `lanyard-lab-lp-kx4-vault-io` (scoped mocklab prefix); STS session injected as sandbox `env`; **role deleted after** |
| domainAllowList | comma-separated string: Relay + S3 hosts + Debian mirrors (Tier 1) |

Mount (no secrets):

```bash
sudo -E mount-s3 \
  --prefix tenants/mocklab/vault/ \
  --region us-east-1 \
  --allow-delete \
  --allow-overwrite \
  --allow-other \
  lanyard-mocklab-vault-123456789012 \
  /mnt/vault
```

Harness: `python3` `time.perf_counter` inside the guest on the Mountpoint path (writes via `sudo` — same uid note as `lp-3en` §7). One sandbox only; stop destroyed it; spike objects + lab role deleted.

---

## 3. Results (numbers)

All times are **milliseconds** measured **inside** the sandbox on FUSE Mountpoint. Payload for “small” files = **64 bytes**. Region `us-east-1`.

### 3.1 Directory list

| Op | n | mean | p50 | p95 | min | max | total |
|----|---|------|-----|-----|-----|-----|-------|
| **list vault root** (`os.listdir` `/mnt/vault`) | 20 | **26.8** | 25.7 | 35.9 | 19.5 | 41.8 | 537 |
| **list bench dir** (100 entries) | 10 | **40.7** | 36.1 | 62.5 | 31.0 | 63.6 | 407 |

Aligned with `lp-3en` list ~24 ms on a near-empty tree. Listing a 100-file directory stays tens of ms.

### 3.2 Many small writes (create + fsync)

| Op | n | mean | p50 | p95 | min | max | **wall batch** |
|----|---|------|-----|-----|-----|-----|----------------|
| **write 100 × 64 B + fsync** | 100 | **267.9** | 260.8 | 333.3 | 211.7 | 379.3 | **~26.8 s** |
| **write 50 × 64 B no fsync** | 50 | **259.4** | 255.7 | 318.0 | 209.0 | 336.8 | **~13.0 s** |

**Interpretation:** skipping explicit `fsync` does **not** buy meaningful latency — each create still drives an S3 PUT via Mountpoint (~0.25–0.27 s/file). **100 tiny files ≈ 27 s wall.**

### 3.3 100 small reads

| Op | n | mean | p50 | p95 | min | max | **wall batch** |
|----|---|------|-----|-----|-----|-----|----------------|
| **read 100 × 64 B** (first pass) | 100 | **84.8** | 75.2 | 134.9 | 50.0 | 191.7 | **~8.5 s** |
| **read 100 × 64 B** (second pass) | 100 | **82.6** | 74.5 | 113.6 | 63.0 | 197.8 | **~8.3 s** |

**Interpretation:** ~80–85 ms/read matches `lp-3en` small-read ~80 ms. **Second pass did not show a useful guest-side cache win** for this pattern (still ~8 s for 100 files). Agent code that re-reads many vault files on each turn will feel multi-second stalls.

### 3.4 Sequential write

| Op | n | mean | p50 | p95 | min | max | notes |
|----|---|------|-----|-----|-----|-----|-------|
| **1 MiB create + fsync** | 5 | **348.2** | 339.4 | 383.0 | 313.3 | 388.1 | ~**2.9 MiB/s** mean |
| **256 KiB create + fsync** | 10 | **286.4** | 291.0 | 348.3 | 212.4 | 355.4 | cost dominated by open/commit, not bytes |

**Interpretation:** Larger sequential objects are far more efficient **per byte** than many tiny files. One 1 MiB write (~0.35 s) moves ~16× the data of a 64 B write (~0.27 s) for similar order-of-magnitude latency.

### 3.5 Mountpoint semantics (pain for naive FS assumptions)

| Behavior | Result |
|----------|--------|
| Create new file / full overwrite (delete + rewrite) | Works |
| **Append / open existing file for write** (`"ab"`) | **`PermissionError: Operation not permitted`** |
| Guest user `daytona` write without root/uid flags | Permission denied (same as `lp-3en`; spike used `sudo`) |

Agents that **append logs** or **mutate files in place** on `VAULT_ROOT` will fail unless rewritten to write-temp + replace, or Mountpoint flags/product layout change.

---

## 4. Go / no-go (latency without cache)

### Summary recommendation

| Verdict | Scope |
|---------|--------|
| **Conditional GO** for Phase 0 / managed Daytona pilot vault path | Sparse vault I/O: inventory list, occasional small reads, infrequent durable writes of modest objects |
| **NO-GO without cache or I/O redesign** if agent assumes local-disk semantics | Tight loops over **many small files**, per-turn full vault walks with open/read, **append**/in-place update logs, sub‑10–20 ms random I/O |

### Agent impact (concrete)

| Pattern | Approx cost observed | Tolerate without cache? |
|---------|----------------------|-------------------------|
| List vault root / small dirs | ~20–65 ms | **Yes** |
| Single small read | ~50–200 ms (p50 ~75) | **Yes** if sparse |
| 100 small reads in series | **~8.5 s** | **No** for interactive turns |
| Single small write (create) | ~0.21–0.38 s | **Yes** if sparse |
| 100 small writes | **~27 s** | **No** |
| 1 MiB sequential write | ~0.3–0.4 s | **Yes** |
| Append existing file | fails | **Must redesign** |

### Product implications (for `lp-ctu` / pilot)

1. **Prefer fewer, larger vault objects** (batch state, packed indexes) over chatty tiny-file trees.  
2. **Add a guest cache or agent-side working set** (local disk / tmpfs / Daytona volume for hot files; durable flush to Mountpoint) before any workload that re-reads hundreds of vault files per turn.  
3. **No POSIX append** on Mountpoint path — document for gateway/agent writers (atomic rewrite).  
4. **Pre-bake `mount-s3`** in agent snapshot (Phase 2 `lp-4xa`) so install egress is not on the wake path; install URL for this spike: `https://s3.amazonaws.com/mountpoint-s3-release/latest/x86_64/mount-s3.deb` (path segment is `x86_64`, not `amd64`).  
5. Orchestrator **must** continue to set S3 (+ install hosts if not pre-baked) on Tier 1 `domainAllowList` (comma-separated **string** API field).

**Bottom line for go/no-go epic:** Mountpoint vault is **viable for durable sparse I/O**, **not** a drop-in local SSD. Without cache, many-small-file agent patterns are a **hard latency footgun**.

---

## 5. Smoke timeline (UTC)

| Step | UTC | Result |
|------|-----|--------|
| Assume lab role + create sandbox | 2026-08-04T17:24:23Z | sandbox `91b6a242-…` **started**; class container |
| Install mount-s3 1.23.0 | ~17:25 | exit 0 |
| Mount prefix → `/mnt/vault` | ~17:25 | listed `.lanyard-lab-marker` |
| Bench harness | ~17:26–17:28 | list / 100 write / 100 read / sequential write; append probe fail |
| External S3 | ~17:28 | 164 objects under `spike-kx4/`; `MARKER.txt` content matched |
| Stop sandbox | 17:28:23Z | **destroying** → not found (auto-delete) |
| Delete spike objects + IAM role | ~17:28:32Z | vault left with lab marker only; role gone |

**Remaining sandboxes labeled `lp-kx4`:** none.

---

## 6. Acceptance mapping

| Criterion | Met? | Evidence |
|-----------|------|----------|
| 1. Against mounted S3 vault (`lp-3en` pattern): directory list, 100 small reads, sequential write benches | **Yes** | §3 tables |
| 2. Go/no-go note if agent cannot tolerate latency without cache | **Yes** | §4 |
| 3. Numbers in this notes path | **Yes** | this file |
| 4. Thrifty: one sandbox, mount, bench, cleanup; lab IAM like `lp-3en` (no keys in git) | **Yes** | §2, §5; SM name only |
| 5. Write under `tenants/mocklab/vault/spike-kx4/`; clean test objects | **Yes** | objects deleted; only `.lanyard-lab-marker` remains |

---

## 7. Residual risks / next

| Risk | Owner / next |
|------|----------------|
| Many-small-file agent patterns | Product decision **documented** in [vault-io-pilot-decision.md](./vault-io-pilot-decision.md) (`lp-eto.1`): sparse/packed **GO**; many-small without cache **NO-GO**; guest cache deferred |
| Append/in-place writes unsupported | Gateway/agent writers; **write-temp + replace** — [vault-io-pilot-decision.md](./vault-io-pilot-decision.md) §3.3 |
| Second-pass read still ~80 ms | Do not assume Mountpoint page cache fixes agent loops |
| Guest write uid/gid | Entrypoint Mountpoint `--uid/--gid` (`lp-3en` residual) |
| Runtime install egress | Phase 2 snapshot bake `lp-4xa` |
| Aggregate go/no-go | `lp-ctu` cites this spike |

---

## 8. Repro (operators — no secrets)

```bash
export AWS_PROFILE=lanyard-main AWS_DEFAULT_REGION=us-east-1
# Load DAYTONA_* from SM lanyard/staging/portal/daytona (do not echo key)
# Mint short-lived STS for tenants/mocklab/vault/ only
# POST /sandbox: env AWS_* + VAULT_ROOT=/mnt/vault
#   domainAllowList as comma-separated string (S3 + deb mirrors + relay)
#   autoDeleteInterval=0, labels lanyard_spike=lp-kx4
# toolbox: install mount-s3 from …/latest/x86_64/mount-s3.deb; mount-s3 --prefix …
# run list / 100-read / sequential write harness under /mnt/vault/spike-kx4
# stop sandbox; aws s3 rm s3://…/spike-kx4/ --recursive; delete temp IAM role
```
