# lp-zuh.9.4 — Live proof: cold ensure_online R/W `/mnt/vault` + S3 durability

**Date:** 2026-08-14 (UTC)  
**Operator profile:** `AWS_PROFILE=lanyard-main` (account `123456789012`)  
**Bead:** `lp-zuh.9.4` (closes remaining live ACs for `lp-zuh.6` / epic `lp-zuh.9`)

## Acceptance

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Stop orphan sandboxes; force cold create MockLab | **GO** — orphans deleted; `cold_create` path on new snapshot |
| 2 | Guest `findmnt /mnt/vault`; `ls` shows S3 seed; touch+mkdir as `brain` | **GO** — `mountpoint-s3` + seed (`README.md`, `skills/`, `workflows/`, …) |
| 3 | Write `/mnt/vault/workflows/.lp-zuh9-proof`; external `aws s3` sees object | **GO** — content match |
| 4 | Kitchen-sink vault-only durable paths (no BACKEND_HOME hybrid for product data) | **GO** — `config.yaml`: `vault_root` / `cron.state_dir` / `workflow.state_dir` / `mempalace.path` / `definition_roots` under `/mnt/vault` |
| 5 | Evidence under `artifacts/daytona-pilot/lp-zuh.9-proof/` (no secrets) | **GO** — this file + companion logs |
| 6 | Fail if empty root stub or EACCES remains | **GO** — empty root-owned stub eliminated on auto mount |

Also satisfies residual **lp-zuh.6** live ACs 1–2, 4–5 (entrypoint + STS + snapshot were 6/9.2/9.3).

## Cold create (product path)

| Field | Value |
|-------|--------|
| Tenant | `319d3808-e533-44db-bfdf-7b6ef8caaae1` |
| Instance | `452b1348-772a-49d0-8038-a410eda8accf` |
| `s3_vault_prefix` | `tenants/319d3808-e533-44db-bfdf-7b6ef8caaae1/vault/` |
| Vault bucket | `lanyard-mocklab-vault-123456789012` |
| Snapshot id | `41e87f4d-d639-4445-9402-88d39d44ac2d` |
| Snapshot name | `lanyard-la-main-508b0b736ad5-mounts3-zuh94-20260814` |
| Sandbox id (auto-mount proof) | `2d6268ff-4df7-45e4-b6c9-d94bb8900014` |
| Orchestrator path | `cold_create` (metric `sandbox_wake` outcome=success) |
| Guest uid | `brain` (990:990) |

### Create-time inject (names only — no secret values)

`VAULT_ROOT`, `S3_VAULT_PREFIX`, `LANYARD_VAULT_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_REGION` / `AWS_DEFAULT_REGION`, plus Relay + model keys.

**CP STS:** `SANDBOX_VAULT_MOUNT_ROLE_ARN=arn:aws:iam::123456789012:role/lanyard-sandbox-vault-mount` on task def `:23` with image digest `sha256:eb472e6a7c7439be70031b4e8fc94de75f527e7cb040976495b6a7e849755113` (includes `lp-zuh.9.2` mint code).

## Guest proof (auto mount after cold create)

```text
findmnt /mnt/vault
TARGET     SOURCE        FSTYPE OPTIONS
/mnt/vault mountpoint-s3 fuse   rw,...,user_id=990,group_id=990,...,allow_other

ls /mnt/vault → README.md, Projects/, skills/, workflows/, cron/, mempalace/, …
uid=990(brain) writes /mnt/vault/workflows/.lp-zuh9-proof (106 bytes)
mkdir /mnt/vault/workflows/lp-zuh94-dir + nested write OK
```

### External S3 (operator profile)

```text
s3://lanyard-mocklab-vault-123456789012/tenants/319d3808-…/vault/workflows/.lp-zuh9-proof
  106 bytes — content matches guest write

s3://…/workflows/lp-zuh94-dir/nested.txt
  7 bytes
```

## Bugs fixed during live proof

### 1. Daytona `volumes[]` with S3 bucket name → create 404

CP previously mapped `S3_VAULT_BUCKET` → Daytona `volumes[].volumeId`. Daytona expects **Daytona volume UUIDs**, not AWS bucket names → `POST /sandbox` **404**.  

**Fix:** `buildDaytonaCreateVolumes` / `mountsToDaytonaCreateVolumes` always return `[]` for the Mountpoint product path (`portal/packages/control-plane/src/sandbox-vault-mount.ts`). Vault durability is **env + STS + guest `mount-s3`**.

### 2. Entrypoint `--allow-other` as non-root without `user_allow_other`

Container runs as `brain`. `mount-s3 --allow-other` failed with fusermount EPERM when fuse.conf lacked `user_allow_other`; optional mount mode left empty local stub.  

**Fix:** entrypoint only passes `--allow-other` when root or `user_allow_other` is set; fail closed when full vault inject present; patch image enables `user_allow_other` in fuse.conf.

### 3. CP process env missing `SANDBOX_VAULT_MOUNT_ROLE_ARN`

Staging CP task lacked the role ARN → no `AWS_*` inject. Wired on task def + redeployed CP image with STS module.

### 4. Ephemeral secret material path wiped on CP redeploy

`INSTANCE_SECRET_MATERIAL_PATH` is task-local file store → rotate required after force-new-deployment. Residual: durable material store (out of this bead).

## Image / snapshot pins (zuh.9.4)

| Surface | Value |
|---------|--------|
| Agent-gateway ECR tag | `la-main-508b0b736ad5-mounts3-zuh94-20260814` |
| Agent-gateway digest | `sha256:c3da5a0027ad40137a3713944bbce215f0d0d8800581c5c276a07a089c8b234a` |
| Snapshot | `41e87f4d-d639-4445-9402-88d39d44ac2d` (active) |
| SM `DAYTONA_DEFAULT_SNAPSHOT` | `41e87f4d-…` |
| SM previous | `a3008149-…` (9.3 mounts3) |
| MockLab `agent_snapshot_id` | `41e87f4d-…` |
| CP image (STS + no volumes) | `…/portal/control-plane@sha256:eb472e6a7c7439be70031b4e8fc94de75f527e7cb040976495b6a7e849755113` |

## Offline checks

- `bash deploy/daytona/agent-gateway/smoke-entrypoint.sh` — PASS  
- `vitest` `sandbox-vault-mount` + `daytona-sdk-client` + `sandbox-vault-mount-sts` — 36 pass  

## Non-goals / residual

- Durable CP secret-material store across task recycle (ops rotate after redeploy)
- Terraform/module wire for `SANDBOX_VAULT_MOUNT_ROLE_ARN` on CP service (applied live on task def; make durable in TF)
- Full `lp-zuh.9.5` vault seed skills/projects content polish
- UI re-QA durable surfaces → `lp-zuh.9.6`

## Operator re-verify

```bash
# Guest (toolbox)
findmnt /mnt/vault
ls /mnt/vault
# should show mountpoint-s3 + README.md / skills / workflows

# External
aws s3 ls s3://lanyard-mocklab-vault-123456789012/tenants/319d3808-e533-44db-bfdf-7b6ef8caaae1/vault/workflows/
```
