# Pilot / lab S3 vault bucket (ensure + access)

**Bead:** `lp-d26`  
**Epic:** Phase 3 `lp-eto` (Vault on Lanyard S3 V1b)  
**Depends on:** [s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md) (`lp-0fq` / `lp-kng.2.4`)  
**Related:** [spike-3en-s3-vault-mount.md](./spike-3en-s3-vault-mount.md), [spike-kx4-vault-io-patterns.md](./spike-kx4-vault-io-patterns.md), [iam-scoped-s3-mount-policy.md](./iam-scoped-s3-mount-policy.md) (`lp-t86`), prefix helper `lp-jt5`  
**Date verified:** 2026-08-05  

## Status

| Item | State |
|------|--------|
| **Pilot lab bucket** | **Exists** — reuse; do **not** destroy or recreate |
| **New bucket create** | **Not required** for pilot (mocklab vault already provisioned) |
| **Full platform-staging vault** | **Out of scope** while [OPERATOR HOLD](../../../deploy/environments/platform-staging/OPERATOR-HOLD-LOCALHOST-ONLY.md) applies — no TF re-enable of staging fixed network/compute |
| **Product env buckets** (`lanyard-vault-{env}`) | Deferred until hold lifts / human gate for non-lab apply |

## Acceptance (`lp-d26`)

| Criterion | Evidence |
|-----------|----------|
| Bucket exists in allowed environment | `lanyard-mocklab-vault-123456789012` in account `123456789012`, region `us-east-1` (lab / mocklab account — not tenant accounts) |
| Access from CP/spike credentials works | Operator profile `AWS_PROFILE=lanyard-main` principal `lanyard-portal-terraform` can HeadBucket, List prefix, Put/Get/Delete under pilot prefix (see below). Mountpoint R/W already proven in Phase 0 spikes. |
| Documented in spike/plan env notes | This file + updated lab inventory in [s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md); re-check: `deploy/scripts/smoke-pilot-lab-s3-vault-bucket.sh` |

## Canonical lab coordinates (no secrets)

```text
s3://lanyard-mocklab-vault-123456789012/tenants/mocklab/vault/
```

| Field | Value |
|-------|--------|
| Bucket name | `lanyard-mocklab-vault-123456789012` |
| AWS account | `123456789012` |
| Region | `us-east-1` (`LocationConstraint` empty = classic us-east-1) |
| Pilot tenant prefix | `tenants/mocklab/vault/` (trailing slash) |
| Lab marker object | `tenants/mocklab/vault/.lanyard-lab-marker` (present since 2026-08-03) |
| Operator CLI profile | `AWS_PROFILE=lanyard-main` |
| Operator principal (name only) | IAM user `lanyard-portal-terraform` in account `123456789012` |
| Daytona API / SM | Secret name only: `lanyard/staging/portal/daytona` — never commit keys |
| Wrong-account trap | Default shell creds in other accounts (e.g. `litigationagent-terraform` / `210987654321`) get **AccessDenied** — always use `lanyard-main` for this bucket |

Full URI shape for any tenant (layout lock):

```text
s3://lanyard-mocklab-vault-123456789012/tenants/{tenant_id}/vault/
```

CP stores **`s3_vault_prefix`** = `tenants/{tenant_id}/vault/`; bucket name lives in platform config (`vault.bucket` / env).

## Verified bucket envelope (2026-08-05)

Observed with `AWS_PROFILE=lanyard-main` (names only — no secret material):

| Control | Observed | Required by `lp-0fq` sketch |
|---------|----------|------------------------------|
| Exists (`HeadBucket`) | Yes | Yes |
| Default encryption | **SSE-S3** `AES256`, `BucketKeyEnabled=true`, SSE-C blocked | SSE-S3 pilot OK; SSE-KMS later for prod |
| Block Public Access | **All four ON** (BlockPublicAcls, IgnorePublicAcls, BlockPublicPolicy, RestrictPublicBuckets) | All ON |
| Object Ownership | **BucketOwnerEnforced** (ACLs disabled for objects) | BucketOwnerEnforced |
| Bucket ACL | Owner FULL_CONTROL only (legacy ACL surface; ownership enforces bucket-owner) | No public grants |
| Bucket policy | **None attached** | Optional for pilot; design draft at [drafts/s3/vault-bucket-policy.json](./drafts/s3/vault-bucket-policy.json) — apply is optional follow-on, not destroy/recreate |
| Versioning | Not enabled | Optional for pilot |
| Tags | No tag set | Optional |

**Do not** “fix” envelope by deleting the bucket. Prefer additive changes only (optional bucket policy attach, tags) after human review.

## Access proof (operator / spike path)

### Read-only inventory

```bash
export AWS_PROFILE=lanyard-main
export AWS_REGION=us-east-1
BUCKET=lanyard-mocklab-vault-123456789012
PREFIX=tenants/mocklab/vault/

aws sts get-caller-identity
# expect Account 123456789012, user lanyard-portal-terraform

aws s3api head-bucket --bucket "$BUCKET"
aws s3api get-bucket-encryption --bucket "$BUCKET"
aws s3api get-public-access-block --bucket "$BUCKET"
aws s3api get-bucket-ownership-controls --bucket "$BUCKET"
aws s3 ls "s3://${BUCKET}/${PREFIX}"
```

### R/W under pilot prefix (ephemeral object — always delete)

```bash
# Put → Get → Delete a disposable probe (do not leave probe objects)
KEY="${PREFIX}.lp-d26-access-check-$(date -u +%Y%m%dT%H%M%SZ).txt"
echo "lp-d26 access check" | aws s3 cp - "s3://${BUCKET}/${KEY}"
aws s3 cp "s3://${BUCKET}/${KEY}" -
aws s3 rm "s3://${BUCKET}/${KEY}"
```

**Evidence (this bead, 2026-08-05T01:46:59Z UTC):** Put/Get/Delete succeeded for  
`tenants/mocklab/vault/.lp-d26-access-check-20260805T014659Z.txt` then deleted.  
Durable lab content left undisturbed: `.lanyard-lab-marker` only under the prefix.

### Mount / sandbox path (already proven — do not re-run thrifty spikes unless needed)

| Spike | Proof |
|-------|--------|
| `lp-3en` | Mountpoint `mount-s3` R/W at `VAULT_ROOT=/mnt/vault`; write visible after sandbox stop — [spike-3en-s3-vault-mount.md](./spike-3en-s3-vault-mount.md) |
| `lp-kx4` | List / many-small / sequential write benches on same URI — [spike-kx4-vault-io-patterns.md](./spike-kx4-vault-io-patterns.md) |

Guest mount IAM remains short-lived STS scoped to `tenants/{tenant_id}/vault/` per [iam-scoped-s3-mount-policy.md](./iam-scoped-s3-mount-policy.md). Spike roles were ephemeral; production durable role is `lp-t86` / Phase 3 apply — **not** long-lived keys in snapshots.

### Re-check script

```bash
# Offline: asserts docs + constants only
bash deploy/scripts/smoke-pilot-lab-s3-vault-bucket.sh

# Live (needs AWS_PROFILE=lanyard-main and network):
SMOKE_PILOT_VAULT_LIVE=1 bash deploy/scripts/smoke-pilot-lab-s3-vault-bucket.sh
```

Live mode performs HeadBucket + encryption/PAB/ownership checks and a disposable Put/Get/Delete under the mocklab prefix. It **never** deletes the bucket or the durable `.lanyard-lab-marker`.

## Operator constraints

| Constraint | Rule |
|------------|------|
| **Do not destroy** | Never `aws s3 rb`, Terraform destroy, or empty-and-recreate this bucket for “cleanup” |
| **OPERATOR HOLD** | Full **platform-staging** fixed network/compute stays torn down for cost — see [OPERATOR-HOLD-LOCALHOST-ONLY.md](../../../deploy/environments/platform-staging/OPERATOR-HOLD-LOCALHOST-ONLY.md). Lab vault bucket in account `123456789012` is the **allowed** pilot SoT; do not use this bead to re-apply staging VPC/NAT/ALB/ECS/RDS. |
| **No secrets in git** | No access keys, session tokens, or `.env*` contents. Profiles and SM **names** only. |
| **No public ACL** | Keep Block Public Access all-on; do not attach public bucket policies or website hosting |
| **Prefix isolation** | New pilot tenants get `tenants/{tenant_id}/vault/` via `ensureVaultPrefixForDaytonaProvision` (`lp-jt5`) — not a second bucket |
| **Optional seed** | Content seed is `lp-9o6` (`bootstrapTenantVaultSeed` / `bootstrapVaultForDaytonaProvision` in control-plane; FakeS3 unit tests) — optional pack; empty vault OK |

## What this bead does **not** do

- Create `lanyard-vault-staging` / product env buckets  
- Attach bucket policy draft (optional; leave none unless ops request)  
- Apply IAM mount roles (drafts + offline smoke under `lp-t86`)  
- Terraform modules for vault (future platform TF when hold lifts)  
- Destroy or migrate existing mocklab vault objects  
- Change EC2 host-disk vault paths for `runtime_kind=ec2`

## Platform config sketch (for CP / orchestrator consumers)

```text
vault.bucket          = lanyard-mocklab-vault-123456789012
vault.region          = us-east-1
vault.prefix_template = tenants/{tenant_id}/vault/
# example pilot:
s3_vault_prefix       = tenants/mocklab/vault/
```

Orchestrator mount params (`lp-hjo`) must bind Mountpoint to this bucket + prefix so guest `VAULT_ROOT` matches gateway env contract.

## Acceptance checklist

- [x] **Bucket exists in allowed environment** — lab account `123456789012`, bucket name above  
- [x] **Access from CP/spike credentials works** — `lanyard-main` / `lanyard-portal-terraform` R/W under pilot prefix; Mountpoint path documented via spikes  
- [x] **Documented in spike/plan env notes** — this file; inventory updated in layout doc; re-check script shipped  
- [x] **Respect hold / do not destroy** — no staging TF; no bucket delete  

## References

- [s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md) — layout + encryption sketch  
- [drafts/s3/](./drafts/s3/) — bucket policy template (not required for pilot ensure)  
- [provision-runbook-daytona.md](./provision-runbook-daytona.md) — provision steps  
- [overview.md](./overview.md) — V1b vault decision  
- `portal/packages/control-plane/src/vault-prefix.ts` — idempotent prefix ensure (`lp-jt5`)  
- [OPERATOR-HOLD-LOCALHOST-ONLY.md](../../../deploy/environments/platform-staging/OPERATOR-HOLD-LOCALHOST-ONLY.md)  
