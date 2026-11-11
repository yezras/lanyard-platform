# Spike notes: `lp-3en` — Mount Lanyard S3 prefix as `VAULT_ROOT`

**Bead:** `lp-3en`  
**Epic:** Phase 0 `lp-6tq` (parent under `lp-kng`)  
**Date:** 2026-08-04  
**Status:** **Complete** — lab vault prefix mounted R/W via Mountpoint for Amazon S3 (`mount-s3`) inside a thrifty container sandbox; write visible in S3 after stop; latencies recorded; cleanup empty.

Related: prior org smoke [`spike-v2p-org-access.md`](./spike-v2p-org-access.md) (`lp-v2p`), VM/image spike [`spike-z1u-linux-vm-sandbox.md`](./spike-z1u-linux-vm-sandbox.md) (`lp-z1u`, Phase 0 AC1 container waiver), layout [`s3-vault-prefix-layout.md`](./s3-vault-prefix-layout.md), IAM draft [`iam-scoped-s3-mount-policy.md`](./iam-scoped-s3-mount-policy.md), env contract [`gateway-env-contract.md`](./gateway-env-contract.md).

---

## 1. Goal

Prove a managed Daytona sandbox can mount the **Lanyard lab S3 vault prefix** at a local path suitable for **`VAULT_ROOT`**, with read/write visible from outside S3, under the **$10** hard cap.

**Lab vault URI (public):**

```text
s3://lanyard-mocklab-vault-123456789012/tenants/mocklab/vault/
```

---

## 2. API / mechanism used (document)

### What Daytona provides

| Surface | Path / field | Notes |
|---------|--------------|--------|
| API base | `https://app.daytona.io/api` | Same as prior Phase 0 spikes |
| Auth | Bearer `DAYTONA_API_KEY` + `X-Daytona-Organization-ID` | SM name only: `lanyard/staging/portal/daytona` |
| Create sandbox | `POST /sandbox` | `env` map for AWS + `VAULT_ROOT`; `domainAllowList`; `volumes[]` optional |
| Toolbox exec | `POST https://proxy.app.daytona.io/toolbox/{id}/process/execute` | Shell for install + mount + I/O |
| Volumes API | `GET/POST /volumes` | **Daytona-hosted** FUSE volumes — **not** Lanyard S3 |
| Network update | `POST /sandbox/{id}/network-settings` | Can change allowlists after start (not required when set on create) |

### What mounts **Lanyard** S3 (product path)

Daytona does **not** expose a first-class “attach my AWS S3 bucket” API for customer buckets. Product V1b path matches Daytona docs **[Mount External Storage](https://www.daytona.io/docs/en/mount-external-storage/)**:

1. Install **Mountpoint for Amazon S3** (`mount-s3`) in the guest (runtime install for this spike; pre-baked snapshot recommended for pilot).
2. Inject short-lived AWS credentials via sandbox `env` (create-time).
3. Run `mount-s3 --prefix … bucket /mnt/vault` so guest FS path = `VAULT_ROOT`.

**Daytona Volumes** (`POST /volumes` + create `volumes: [{ volumeId, mountPath, subpath }]`) store data on **Daytona’s** object store. Useful for scratch/shared agent data; **not** a substitute for Lanyard-owned vault durability.

### Mount command used (no secrets)

```bash
sudo -E mount-s3 \
  --prefix tenants/mocklab/vault/ \
  --region us-east-1 \
  --allow-delete \
  --allow-overwrite \
  --allow-other \
  lanyard-mocklab-vault-123456789012 \
  /mnt/vault
# → VAULT_ROOT=/mnt/vault
```

`mount-s3` version proven: **1.23.0** (deb from `s3.amazonaws.com/mountpoint-s3-release`).

---

## 3. IAM / credentials (names only — no keys)

| Item | Value |
|------|--------|
| Operator profile | `AWS_PROFILE=lanyard-main`, account `123456789012`, region `us-east-1` |
| Operator principal | IAM user `lanyard-portal-terraform` (used only to mint/assume) |
| Lab-scoped role (spike) | `lanyard-lab-lp-3en-vault-mount` — **created for spike, deleted after** |
| Trust | `sts:AssumeRole` from `lanyard-portal-terraform` only |
| Inline policy name | `lp-3en-mocklab-vault-rw` |
| Scope | `s3:ListBucket` with `s3:prefix` under `tenants/mocklab/vault/`; object R/W on `…/tenants/mocklab/vault/*` |
| Session | `sts:AssumeRole` session name `lp-3en-spike`, ~30m TTL; keys injected as sandbox `env` only (never committed) |
| Negative check | Same session **AccessDenied** on `s3://bucket/` root list without bound prefix |

Matches design intent in [iam-scoped-s3-mount-policy.md](./iam-scoped-s3-mount-policy.md) (session-policy pattern). **Production** should use durable base role + per-wake session policy (Phase 3 `lp-eto`); do not leave long-lived keys in snapshots.

Daytona API key: SM **`lanyard/staging/portal/daytona`** only — never in git.

---

## 4. Egress / `domainAllowList` (Tier 1 critical)

Org is **Tier 1** (restricted egress). Create-time `domainAllowList` must include **more than Relay** for Mountpoint:

| Purpose | Domains needed |
|---------|----------------|
| Vault I/O (Mountpoint → S3 API) | `s3.amazonaws.com`, `*.s3.amazonaws.com`, `s3.us-east-1.amazonaws.com`, `*.s3.us-east-1.amazonaws.com` (and/or broader `*.amazonaws.com` for regional endpoints) |
| Runtime `mount-s3` install | `s3.amazonaws.com` (deb release) + `deb.debian.org` / security mirrors |
| Relay (pilot) | `relay.withlanyard.com` |

**Evidence:** first sandbox with only `domainAllowList=relay.withlanyard.com` could not resolve `deb.debian.org` / install packages (HTTP 403 via proxy). Second sandbox with expanded allowlist resolved DNS and installed `mount-s3` successfully.

Implication for product: orchestrator must set vault-related domains (and any package/CDN hosts if install-on-boot remains) on create, not only Relay. Prefer **pre-baked snapshot with `mount-s3`** so install-time package egress is unnecessary.

---

## 5. Smoke evidence (timestamps UTC)

Isolation class: **container** (Phase 0 waiver from `lp-z1u` §6.1). Snapshot: default `daytonaio/sandbox:0.8.0`. Labels: `lanyard_spike=lp-3en`.

| Step | UTC | HTTP / result |
|------|-----|----------------|
| Assume lab role | ~2026-08-04T16:34:57Z | STS OK; root list denied; prefix list OK |
| Create #1 (narrow allowlist) | 2026-08-04T16:35:17Z | **200** — sandbox `4d1eab47-084d-461b-a995-edcbc16ecab1`; env injected |
| Runtime install #1 | 16:35:35Z | **Failed** DNS/apt (Tier 1 egress) |
| Stop/delete #1 | 16:37:0xZ | Stop 200; ephemeral delete |
| Create #2 (broad allowlist) | 2026-08-04T16:37:09Z | **200** — sandbox **`1e9c4ff3-598f-4f31-a6fc-28762d958734`** |
| State started | ~16:37:11Z | `started` |
| Install mount-s3 1.23.0 | 16:37:19–16:37:23Z | exit 0; `/dev/fuse` present |
| Mount prefix → `/mnt/vault` | 16:37:33Z | `mountpoint-s3` FS; listed `.lanyard-lab-marker` |
| Write + latency (n=5) | 16:38:02Z | exit 0; see §6 |
| External `aws s3 ls/cp` (running) | 16:38:18Z | Object content matches sandbox write |
| Stop sandbox | 16:38:19Z | **200**; auto-delete (`autoDeleteInterval=0`) |
| External S3 after stop | 16:38:24Z | **Same objects still present** |
| Delete spike objects + IAM role | 16:38:2xZ | Vault left with lab marker only; role gone |

**sandbox_id (success path):** `1e9c4ff3-598f-4f31-a6fc-28762d958734`  
**Evidence object key (then deleted):** `tenants/mocklab/vault/.spike-lp-3en-20260804T163733Z.txt`  
**Content:** `hello-from-lp-3en sandbox write lp-3en-20260804T163733Z`

---

## 6. Latency notes (small files, n=5)

Measured **inside** sandbox on the Mountpoint path with `python3` `perf_counter` (list / write with fsync / read). Region `us-east-1`; container class; single digit-byte payloads.

| Op | mean ms | p50 ms | min ms | max ms | samples (ms) |
|----|---------|--------|--------|--------|--------------|
| **list** (`os.listdir` vault root) | **23.7** | 22.4 | 21.3 | 29.3 | 29.28, 22.42, 21.33, 21.96, 23.49 |
| **write_small** (create + fsync) | **262.5** | 266.1 | 230.8 | 312.8 | 271.51, 266.05, 312.82, 231.39, 230.8 |
| **read_small** | **80.0** | 78.1 | 76.2 | 90.7 | 78.37, 90.74, 76.24, 76.65, 78.12 |

**Interpretation (Phase 0 only):**

- List is low tens of ms — fine for interactive inventory of tiny trees.
- Small writes ~0.2–0.3s with fsync — acceptable for sparse vault writes; many tiny files will dominate (see follow-on `lp-kx4`).
- Reads ~80ms — warm S3 GET via Mountpoint; not local disk.

Not a load test; no parallel writers; no large objects.

---

## 7. Guest permissions note

- Default mount as **root** + `--allow-other`: user `daytona` (uid 1001) could **read** but **not write** (`Permission denied`).
- Spike writes used `sudo` for the latency harness.
- Product entrypoint should either:
  - `mount-s3 --uid <gateway_uid> --gid <gateway_gid> …`, or
  - run Mountpoint helper as the gateway user after fixing FUSE allow_other / group membership.

Agent binary must see a writable `VAULT_ROOT` without holding raw AWS keys if avoidable (gateway uses local FS only).

---

## 8. Acceptance mapping

| Criterion | Met? | Evidence |
|-----------|------|----------|
| 1. Sandbox mounts test S3 prefix R/W; document API | **Yes** | `mount-s3` + `POST /sandbox` `env` + toolbox exec; §2–§5 |
| 2. Write from sandbox visible in S3 after stop / outside | **Yes** | `aws s3 cp` before and after stop; content match |
| 3. Latency notes list/read/write small files | **Yes** | §6 table |
| 4. Notes path; cleanup; no secrets | **Yes** | this file; sandbox deleted; IAM role deleted; spike objects deleted; no keys in git |

---

## 9. Residual risks / next

| Risk | Owner / next |
|------|----------------|
| Tier 1 `domainAllowList` must include S3 endpoints | Orchestrator create path; document in provision/wake |
| Runtime install of `mount-s3` needs package + release egress | Prefer snapshot bake (Phase 2 `lp-4xa` / agent image) |
| Guest write perms (uid/gid) | Entrypoint Mountpoint flags |
| Lab role was ephemeral | Phase 3 apply durable mount role + session policy (`lp-eto`) |
| Many-small-file patterns | `lp-kx4` |
| Linux VM still unavailable | `lp-ctu` residual (container OK Phase 0) |
| $10 hard cap | Keep mounts thrifty; stop/delete immediately |

**Unblocks:** vault I/O pattern spike `lp-kx4`; go/no-go may cite Mountpoint path proven on managed Daytona container.

---

## 10. Repro (operators — no secrets in history)

```bash
export AWS_PROFILE=lanyard-main AWS_DEFAULT_REGION=us-east-1
# Load DAYTONA_* from SM lanyard/staging/portal/daytona (do not echo key)
# Mint short-lived STS for vault prefix only (AssumeRole + scoped policy)
# POST /sandbox with:
#   env: AWS_* + VAULT_ROOT=/mnt/vault
#   domainAllowList: relay + s3 + deb mirrors (Tier 1)
#   autoDeleteInterval: 0, autoStopInterval: small
# toolbox: apt install libfuse2t64; install mount-s3.deb; mount-s3 --prefix tenants/mocklab/vault/ …
# write under /mnt/vault; aws s3 ls/cp from operator; stop sandbox; re-check S3
# delete throwaway objects + any temp IAM role
```
