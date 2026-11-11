# customer-account-access

Reusable Terraform module for **Track B** (`customer_account`): a **customer-granted** IAM role that Lanyard operators assume to deploy Company Brain data-plane stacks **without long-lived access keys**.

| Resource | Purpose |
|----------|---------|
| IAM role | Trust Lanyard principal ARN(s) with **required ExternalId** |
| Permissions boundary (optional) | Cap deploy + child-role blast radius; deny long-lived key APIs |
| Deploy policy | Least-privilege EC2/EBS/DLM/IAM-scoped/SSM/Secrets/artifact read |
| Deny policy | Block CreateUser/AccessKey, AssumeRole chaining, off-prefix SSM/Secrets/IAM |

## Status

| Claim | Truth |
|-------|--------|
| Module is real Terraform | **Yes** — `terraform init -backend=false && terraform validate` |
| Creates static access keys | **No** — AssumeRole only |
| Applied for every Track B customer from git examples | **No** — operator-owned customer-account apply |
| Multi-account live certified | **No** — **infra_ready** contract |

Readiness: **infra_ready**. Isolation model: `references/tenant-isolation-decision.md`. Runbook: `references/runbooks/track-b-customer-account-access.md`.

## Who applies what

```text
Customer account                          Lanyard account / ops
─────────────────                         ────────────────────
1. Apply this module (customer creds)     2. Store ExternalId in private secret
   → role ARN + trust                     3. AssumeRole + provider alias
                                          4. terraform apply tenant stack
                                             with providers = { aws = aws.customer }
                                          5. Separate customer state backend
```

**State and credentials stay separated:** Lanyard platform state ≠ customer tenant state. Never put ExternalId or customer role session keys in this git repo.

## Usage (customer bootstrap)

```hcl
module "lanyard_access" {
  source = "../../modules/customer-account-access"

  project_name = "acme-brain"
  tenant_slug  = "acme"

  lanyard_principal_arns = [
    "arn:aws:iam::LANYARD_ACCOUNT_ID:role/lanyard-platform-deployer",
  ]

  # Private only — never commit production ExternalId
  external_id = var.track_b_external_id

  artifact_s3_bucket_arns = [
    "arn:aws:s3:::lanyard-product-artifacts-EXAMPLE",
  ]

  acknowledge_not_auto_applied = true
}
```

Prefer **relative** module sources inside this monorepo. External consumers pin a tag/commit — never `ref=main`.

Copy `terraform.tfvars.example` → private `terraform.tfvars` in a customer-owned working tree (not under committed `deployments/` with live secrets).

## Trust and session controls

| Control | Default | Notes |
|---------|---------|--------|
| `sts:ExternalId` | **Required** | Confused-deputy protection; min 16 chars; reject trivial placeholders |
| Session tags | `Project` + `TenantSlug` | Optional off via `enable_session_tags=false` |
| Max session | 3600s | Configurable 900–43200 |
| MFA on assume | off | Set `require_mfa=true` when Lanyard principals are MFA-bound |
| Region allow-list | empty | Set `allowed_regions` to pin |

## Least privilege and non-access

- Deploy IAM mutations limited to roles/instance profiles named `${project_name}-*` (and `/company-brain/` path).
- SSM / Secrets Manager writes/reads limited to `/company-brain/${project_name}` (configurable).
- Artifact S3: **GetObject/List** only under `hermes/` + `client-core/` (product-artifact contract).
- Explicit **Deny** CreateUser / CreateAccessKey / AssumeRole chaining / org leave.
- Role **cannot** manage another tenant’s `${other_project}-*` IAM or secret prefixes when each tenant uses a unique `project_name` (account boundary + prefix denies).

Account isolation remains the hard Track B boundary; these policies reduce blast radius *inside* the customer account.

## Cross-account artifact read

Two approved paths (pick one per onboarding):

1. **Platform bucket grant** — After `company-brain-ec2` creates the instance role, add the statement from output `platform_artifact_bucket_policy_statement_json` to the Lanyard product-artifact bucket policy (replace `INSTANCE_ROLE_ARN`). Instance downloads via instance role; no static keys.
2. **Customer mirror** — Customer copies release objects into a customer-owned bucket; set `artifact_s3_bucket_arns` to that bucket; no cross-account principal on Lanyard S3.

HTTPS pins (private GitHub releases) remain valid when S3 lists are empty (`artifacts/README.md`).

## Lanyard provider alias (tenant root)

See output `terraform_provider_assume_role_hcl` and the runbook. Sketch:

```hcl
provider "aws" {
  alias  = "customer"
  region = var.region

  assume_role {
    role_arn     = var.customer_deploy_role_arn
    external_id  = var.customer_deploy_external_id # from secret store
    session_name = "lanyard-track-b-${var.tenant_slug}"
  }
}

module "brain" {
  source = "../../modules/company-brain-ec2"
  # ...
  providers = { aws = aws.customer }
}
```

Default `provider "aws"` (no assume) is for Lanyard platform only when needed — **not** for customer data-plane state.

## Rotate / revoke / offboard

| Action | Steps |
|--------|--------|
| **Rotate ExternalId** | Generate new secret → re-apply this module in customer account → update Lanyard secret at `external_id_parameter_name` → drop old sessions |
| **Revoke Lanyard access** | Remove principal from `lanyard_principal_arns` or `terraform destroy` this module → verify `aws sts assume-role` fails |
| **Offboard tenant** | Revoke role → destroy tenant stack (customer account) → delete ExternalId secret → retain snapshots per customer contract |

Offline contract tests: `bash scripts/smoke-customer-account-access.sh`.

## Explicit non-claims

- No Lanyard-hosted account factory path here (see `modules/account-factory/` for Track A CT/AFT contract).
- No automatic apply from `templates/tenant` (Track A stays default provider).
- No employee-vault dependency.
- No claim of production multi-account certification from examples alone.
