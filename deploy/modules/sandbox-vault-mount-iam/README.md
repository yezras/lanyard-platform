# sandbox-vault-mount-iam

Terraform module: **shared base IAM role** for Daytona sandbox vault Mountpoint + CP AssumeRole grant (`lp-zuh.9.1`).

| Resource | Purpose |
|----------|---------|
| **Base role** `lanyard-sandbox-vault-mount` (or `role_name`) | Assumed by CP task role only; short-lived STS sessions |
| **Identity policy (upper bound)** | `tenants/*/vault/*` List/R/W on configured vault bucket; Deny unbound list + `_platform` |
| **Session policy template** | Per-tenant `tenants/{tenant_id}/vault/` (rendered at wake by CP) |
| **CP task inline policy** | `sts:AssumeRole` + `sts:TagSession` on the base role only |

**Design:** [iam-scoped-s3-mount-policy.md](../../../docs/plans/0008-daytona-agent-sandboxes/iam-scoped-s3-mount-policy.md)  
**Draft templates:** [drafts/iam/](../../../docs/plans/0008-daytona-agent-sandboxes/drafts/iam/)  
**Offline smoke:** `bash deploy/scripts/smoke-sandbox-vault-mount-iam.sh`  
**Lab root:** `deploy/deployments/lab-sandbox-vault-mount-iam/`

## What this enables

- Control Plane (`SANDBOX_VAULT_MOUNT_ROLE_ARN`) can mint scoped STS sessions for Mountpoint at `ensure_online` (`lp-zuh.9.2`).
- Guest receives temporary `AWS_*` only — **no long-lived access keys**, nothing baked into snapshots.
- Session policy enforces **one tenant prefix** (ListBucket conditioned + object R/W).

## What this does **not** do

| Gated item | Why |
|------------|-----|
| CP STS mint + env inject | `lp-zuh.9.2` |
| Guest `mount-s3` entrypoint | `lp-zuh.6` / image snapshot |
| Live cold `ensure_online` R/W proof | `lp-zuh.9.4` |
| Create the vault S3 bucket | Reuse pilot `lanyard-mocklab-vault-*` (`lp-d26`) |

## Usage

```hcl
module "sandbox_vault_mount_iam" {
  source = "../../modules/sandbox-vault-mount-iam"

  name_prefix        = "lanyard-platform-lab"
  environment        = "lab"
  role_name          = "lanyard-sandbox-vault-mount"
  vault_bucket_name  = "lanyard-mocklab-vault-123456789012"

  # Product: CP ECS task role only
  orchestrator_principal_arns = [
    "arn:aws:iam::ACCOUNT_ID:role/lanyard-platform-staging-cp-task",
  ]

  attach_orchestrator_assume_policy = true
  # external_id = var.mount_external_id  # optional; private tfvars only
}
```

Prefer **relative** module sources. External consumers pin a tag/commit — never `ref=main`.

## IAM contract

### Trust

| Rule | Value |
|------|--------|
| Principal | `orchestrator_principal_arns` only (CP task role) |
| Action | `sts:AssumeRole` |
| Optional | `sts:ExternalId` when `external_id` set |
| Forbidden | `Principal: *`, account root, long-lived guest keys |

### Base identity (upper bound)

Session policies can only **restrict**. Base allows vault trees for all tenants so a wake session can narrow to one:

| Action | Resource / condition |
|--------|----------------------|
| `s3:ListBucket`, `s3:GetBucketLocation` | Bucket; `s3:prefix` like `tenants/*/vault/` or `tenants/*/vault/*` |
| Get/Put/Delete + multipart | `…/tenants/*/vault/*` |
| **Deny** List without prefix | whole-bucket list |
| **Deny** List outside vault trees | non-vault prefixes |
| **Deny** `s3:*` on `…/tenants/*/_platform/*` | platform sibling |

**CP must always attach a per-tenant session policy** at AssumeRole time. Without it, the upper bound could reach other tenants' vault prefixes (still not `_platform`).

### Session policy (per wake)

Canonical template: `templates/session-policy.json` (mirrors plan drafts). Placeholders: `${LANYARD_VAULT_BUCKET}`, `${TENANT_ID}`.

| SID | Effect |
|-----|--------|
| `ListOnlyBoundVaultPrefix` | Allow list only under `tenants/${TENANT_ID}/vault/` |
| `ObjectRWBoundVaultPrefix` | Allow object R/W only under that tree |
| `DenyListBucketWithoutPrefix` | Deny unbound list |
| `DenyListBucketOutsideBoundVaultPrefix` | Deny foreign prefixes |
| `DenyPlatformSiblingUnderTenant` | Deny `_platform` |

### CP task role

When `attach_orchestrator_assume_policy = true`, each orchestrator **role** principal receives inline policy:

- `sts:AssumeRole`, `sts:TagSession` on the base mount role ARN only.

## Credential lifetime (no secrets)

| Parameter | Value |
|-----------|--------|
| Guest STS `DurationSeconds` | 900–3600 (product default 3600) |
| Re-issue | Every wake; discard on stop |
| Role max session | `max_session_duration` (default 3600) |
| Long-lived keys | **Never** created by this module |

## Offline + live validation

```bash
# Offline (CI-safe): drafts + module HCL contracts
bash deploy/scripts/smoke-sandbox-vault-mount-iam.sh

# Live (operator, lab account): role/trust/assume-policy + optional STS
export AWS_PROFILE=lanyard-main AWS_REGION=us-east-1
SMOKE_SANDBOX_VAULT_MOUNT_IAM_LIVE=1 bash deploy/scripts/smoke-sandbox-vault-mount-iam.sh
# Optional positive AssumeRole + session policy (requires caller in trust):
# SMOKE_SANDBOX_VAULT_MOUNT_IAM_LIVE_ASSUME=1 …
```

## Lab apply

```bash
cd deploy/deployments/lab-sandbox-vault-mount-iam
# private terraform.tfvars (gitignored patterns) — never commit secrets
terraform init
terraform plan
terraform apply
```

Outputs include `role_arn` for CP env `SANDBOX_VAULT_MOUNT_ROLE_ARN`.

## Related

- [iam-scoped-s3-mount-policy.md](../../../docs/plans/0008-daytona-agent-sandboxes/iam-scoped-s3-mount-policy.md)
- [pilot-lab-s3-vault-bucket.md](../../../docs/plans/0008-daytona-agent-sandboxes/pilot-lab-s3-vault-bucket.md)
- `lp-zuh.9.2` — CP STS mint + inject
