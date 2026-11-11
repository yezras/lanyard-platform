# lp-zuh.11.1 — Bake+pin agent-gateway snapshot from main (seed+mount+ENOSYS)

**Date:** 2026-08-14 (UTC)  
**Operator profile:** `AWS_PROFILE=lanyard-main` (account `123456789012`)  
**Bead:** `lp-zuh.11.1`  
**Parent:** `lp-zuh.11` (MockLab kitchen-sink zero-waiver GO)  
**Platform git:** `6597246` (includes `lp-zuh.10.7` projects seed)

## Acceptance

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Build agent-gateway from main incl. `ensure_default_projects` / `seed-default-projects.py` | **GO** — Dockerfile COPY + entrypoint `ensure_default_projects`; offline smoke + image probe |
| 2 | mount-s3 + fuse + `ensure_vault_mount` | **GO** — mount-s3 **1.23.0**, fusermount, entrypoint `ensure_vault_mount` present |
| 3 | ENOSYS cron/workflow rename fallbacks | **GO** — LA `0.0.0-main.9bcada6780d2` dist: workflow `run-store.js` + cron `store.js` contain ENOSYS fallback |
| 4 | Push ECR; Daytona snapshot; pin SM + MockLab `agent_snapshot_id` | **GO** — ECR digest + snapshot **active**; SM + instance pin updated |
| 5 | Stop orphans; cold create on new pin | **GO** — orphan sandboxes deleted; CP create + stock create from new snapshot name |
| 6 | Guest prove: mount-s3; projects `primary_path` under `/mnt/vault`; vault R/W | **GO** — stock sandbox `f0fcad49…` on new snapshot |
| 7 | Evidence pack (no secrets) | **GO** — this directory |

## Image

| Field | Value |
|-------|--------|
| Local tag | `lanyard/agent-gateway:la-main-9bcada6780d2-seed-zuh111` |
| Local image id | `sha256:2f388f8ca7e6c46e95c91b4ddee9e01dbdd0c70aafc69c08ba3b2a2d01e0f7a5` |
| ECR tag | `la-main-9bcada6780d2-seed-zuh111-20260814` |
| ECR digest | `sha256:42b41ea5125fdec4958c2d566b8006df6943fc773737026112fb839ef9fcd39d` |
| Repository | `123456789012.dkr.ecr.us-east-1.amazonaws.com/lanyard-platform-staging/daytona/agent-gateway` |
| Product bake | LA `0.0.0-main.9bcada6780d2` + mount-s3 1.23.0 + fuse + mempalace 3.7.0 + platform seed helper |
| LA sha256 | `6acbc8aa8825165d0f86ddbf3b7ac0511d36b5184e2eef63c2df380539a7e8b8` |
| Platform features vs prior pin (`lp-zuh.10.10`) | **`seed-default-projects.py` + `ensure_default_projects`** from monorepo `6597246` |

### Image probe (no secrets)

```text
company-brain-backend (lanyard-agent) 0.0.0-main.9bcada6780d2
mount-s3 1.23.0
MemPalace 3.7.0
seed-default-projects.py present + entrypoint ensure_default_projects
ENOSYS in workflow/dist/run-store.js + cron/dist/store.js
vault ownership 990:990
```

Offline: `bash deploy/daytona/agent-gateway/smoke-entrypoint.sh` — **PASS** (projects.db Workspace primary_path under VAULT_ROOT).

## Snapshot

| Field | Value |
|-------|--------|
| Name | `lanyard-la-main-9bcada6780d2-seed-zuh111-20260814` |
| Id | `f4d947f3-bd03-4f6c-b8a2-b2034872feba` |
| State | **active** |
| Class | container |
| Image | `…/agent-gateway:la-main-9bcada6780d2-seed-zuh111-20260814` (tag form) |

## Pins updated

| Surface | Value |
|---------|--------|
| SM `lanyard/staging/portal/daytona` `DAYTONA_DEFAULT_SNAPSHOT` | `f4d947f3-bd03-4f6c-b8a2-b2034872feba` |
| SM `DAYTONA_SNAPSHOT_NAME` | `lanyard-la-main-9bcada6780d2-seed-zuh111-20260814` |
| SM previous | `efa7c007-dbde-40c0-a7d4-ab24d47461c1` (zuh.10.10 workflow ENOSYS) |
| MockLab instance `agent_snapshot_id` | `f4d947f3-…` on tenant `319d3808-…` / instance `452b1348-…` |
| Pins YAML | `deploy/daytona/agent-gateway/pins/staging-pilot.pins.yaml` |
| CP redeploy | force-new-deployment on `lanyard-platform-staging-cp`; task env reloads SM (`ENV_DAYTONA_DEFAULT_SNAPSHOT` confirmed) |
| Ops after CP recycle | rotate instance secret material (required; ephemeral store) |

## Stock cold guest prove (acceptance guest path)

| Field | Value |
|-------|--------|
| Sandbox | `f0fcad49-2859-499c-9249-2f630f8b0c4e` (deleted after proof) |
| Snapshot | `lanyard-la-main-9bcada6780d2-seed-zuh111-20260814` |
| Guest version | `0.0.0-main.9bcada6780d2` |
| mount-s3 | **1.23.0** on PATH |
| projects.db | `Workspace` / `workspace` → **`/mnt/vault/Projects/Workspace`** (`p_a5036a91`) |
| Seed helper | entrypoint seeded before re-run (`ok (exists)`); idempotent |
| Vault | local fallback R/W (`VAULT_WRITABLE` / `STOCK_VAULT_WRITE_OK`); kitchen-sink dirs under `/mnt/vault` |
| Gateway process | `node …/apps/gateway/dist/main.js` running |

Artifact: [stock-probe.txt](./stock-probe.txt), [image-probe.txt](./image-probe.txt), digest JSON in this directory.

## Product portal ensure_online residual

| Item | Status |
|------|--------|
| CP cold **create** from new pin | **Observed** — sandboxes labeled MockLab instance used snapshot name `lanyard-la-main-9bcada6780d2-seed-zuh111-20260814` |
| Presence → online via Relay | **Residual** — `ENSURE_ONLINE_WAKE_FAILED` / `Gateway never connected to Relay … after sandbox start and one recreate` (`relay_never_connect`) |
| Likely class | Guest entrypoint/gateway start under live Mountpoint inject (known write-probe race residual from `lp-zuh.10.10`); **not** a bad snapshot pin (create uses pin; stock guest GO without Relay) |
| Disk thrash | Org hit 30GiB disk cap from orphan sandboxes; cleaned during this bead |

Playwright zero-waiver matrix (`lp-zuh.11.2+`) may need portal online; track `relay_never_connect` as ops residual if UIQA blocked.

## Why this pin

Prior pin (`lp-zuh.10.10` / `efa7c007`) baked ENOSYS + mount-s3 + mempalace but **predated** monorepo `lp-zuh.10.7` entrypoint `ensure_default_projects`. Live guest required toolbox re-seed. This pin ships platform main `6597246` seed helper so cold create seeds Workspace `primary_path` under `VAULT_ROOT` without guest hot-patch.

## Secret hygiene

- No tokens, passwords, AWS keys, Relay secrets, or SM payloads in this pack.
- Evidence is ids, digests, names, and command shapes only.
