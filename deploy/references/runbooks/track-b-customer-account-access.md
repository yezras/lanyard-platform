# Runbook: Track B customer-account access (assume-role)

**Status:** Operator procedure for **infra_ready** module `modules/customer-account-access/`  
**Audience:** Customer security (role create) + Lanyard deploy operators (assume + tenant apply)  
**Related:** `references/tenant-isolation-decision.md`, `references/runbooks/track-a-b-e2e.md`, `references/runbooks/tenant-isolation.md`

---

## Goals

1. Customer creates a **trust role** Lanyard can assume — **no long-lived IAM user keys**.
2. Lanyard assumes with **ExternalId**, optional session tags / MFA / region, **least privilege**.
3. Role is **scoped to one tenant** `project_name` (prefix + denies); account boundary still hard isolation.
4. Artifact reads use **approved** platform bucket grant or **customer mirror** (or HTTPS pins).
5. **State and provider credentials stay separated** (customer backend ≠ Lanyard platform).
6. **Rotate / revoke / offboard** are documented and offline-tested (smoke script).

---

## Prerequisites

```text
[ ] Customer AWS account ID known (private ops notes — not committed as live production claims)
[ ] Lanyard deployer principal ARN(s) known (role preferred over user)
[ ] High-entropy ExternalId generated (openssl rand -base64 32) and shared out-of-band
[ ] Unique project_name / tenant_slug agreed
[ ] Artifact path chosen: platform S3 grant | customer mirror | HTTPS pins
[ ] Customer can run Terraform in their account (SSO/role — not Lanyard static keys)
```

---

## Phase 1 — Customer creates the role

In a **customer-owned** working tree (not committed live secrets):

```bash
# From company-brain-deploy checkout (tag/commit pin if external)
cd /path/to/customer-bootstrap   # customer private root
# Minimal root wrapping the module, or:
#   module "lanyard_access" { source = ".../modules/customer-account-access" ... }

cp modules/customer-account-access/terraform.tfvars.example terraform.tfvars
# Edit: real lanyard_principal_arns, external_id, project_name, tenant_slug
# Optional: artifact_s3_bucket_arns

terraform init
terraform plan
terraform apply
terraform output role_arn
terraform output external_id_parameter_name   # name only — value stays in Lanyard secret store
```

Hand Lanyard: **role ARN** + confirmation ExternalId was set (not the value over insecure channels if already shared).

### Customer checklist

```text
[ ] acknowledge_not_auto_applied = true
[ ] No iam:CreateAccessKey path used
[ ] Role path under /company-brain/ (default)
[ ] Permissions boundary enabled (default)
[ ] Cross-tenant deny policy enabled (default)
```

---

## Phase 2 — Lanyard stores ExternalId and assumes

```text
[ ] Put ExternalId in private secret store at external_id_parameter_name
    (default shape: /lanyard/track-b/<tenant_slug>/deploy-external-id)
[ ] Confirm Lanyard principal matches trust policy
[ ] Dry-run assume (CLI template from module output assume_role_cli_template)
[ ] aws sts get-caller-identity shows customer account + role
```

### Terraform provider assume-role (tenant root)

**Preferred for stock `templates/tenant`:** set variables on the default provider
(optional `assume_role` in `versions.tf` when `deploy_role_arn` is set):

```hcl
# private terraform.tfvars (never commit live values)
hosting_track     = "customer_account"
isolation_mode    = "customer_account"
aws_account_id    = "<customer 12-digit>"
deploy_role_arn   = "<role_arn output>"
deploy_role_external_id = "<from Lanyard secret store>"  # sensitive
deploy_role_external_id_parameter_name = "/lanyard/track-b/<slug>/deploy-external-id"
enable_deploy_role_session_tags = true
artifact_cross_account_mode = "platform_bucket_grant"  # or customer_mirror | https_pins
```

Template fail-closed: Track B + `deploy_role_arn` **requires** `deploy_role_external_id`.

**Dual-alias pattern** (composed roots / platform + customer): copy
`templates/tenant/providers.tf.example` or use module output
`terraform_provider_assume_role_hcl`:

```hcl
provider "aws" {
  alias  = "customer"
  region = var.region

  assume_role {
    role_arn     = var.customer_deploy_role_arn
    external_id  = var.customer_deploy_external_id # sensitive — from secret store
    session_name = "lanyard-track-b-${var.tenant_slug}"
  }
}

# All company-brain data-plane modules:
#   providers = { aws = aws.customer }
```

Customer remote state stays customer-owned (`templates/tenant/backend.tf.example`
Track B section). Keep platform credentials on the default provider only if needed.

Wire isolation per `references/runbooks/tenant-isolation.md`. Offline contract:

```bash
bash scripts/smoke-tenant-template-wiring.sh
```

**Do not** commit `deploy_role_external_id` / `customer_deploy_external_id` or live role ARNs into this repository’s examples as production values.

---

## Phase 3 — Artifacts

| Path | Customer deploy role | Instance role bootstrap | `artifact_cross_account_mode` |
|------|----------------------|-------------------------|--------------------------------|
| Platform S3 | Optional List/Get on hermes/ + client-core/ | Bucket policy statement: module output `platform_artifact_bucket_policy_statement_json` with `INSTANCE_ROLE_ARN` | `platform_bucket_grant` |
| Customer mirror | Point `artifact_s3_bucket_arns` at customer bucket | Instance role in customer account reads same bucket | `customer_mirror` |
| HTTPS pins | Empty S3 lists | Host needs network + token if private GH (`artifacts/README.md`) | `https_pins` |

Never grant the deploy role unrestricted `s3:*` on multi-tenant platform buckets.
After tenant apply, `terraform output artifact_cross_account_notes` summarizes the chosen path.

---

## Phase 4 — Tenant stack apply

Continue Track B E2E: `references/runbooks/track-a-b-e2e.md`.

```text
[ ] deployments/<slug> from templates/tenant (or customer copy)
[ ] deploy_role_arn + deploy_role_external_id set (or dual-alias providers = { aws = aws.customer })
[ ] backend.tf → customer state key (not shared with other tenants / platform)
[ ] state_backend_* documented in private tfvars; encrypt + lock enabled
[ ] terraform output access_wiring_summary shows use_provider_assume_role + external_id_configured
[ ] terraform apply → bootstrap → portal path check
[ ] If platform_bucket_grant: attach bucket policy with instance role ARN
```

---

## Rotate ExternalId

```text
1. openssl rand -base64 32  → NEW_ID
2. Customer: set external_id = NEW_ID; terraform apply (trust update)
3. Lanyard: update secret store value at external_id_parameter_name
4. Verify old ExternalId assume fails; new succeeds
5. Invalidate any cached session env vars
```

## Revoke Lanyard access

```text
1. Customer: empty lanyard_principal_arns (invalid) OR terraform destroy this module
   OR attach customer-managed deny-all on the role
2. Lanyard: delete ExternalId secret; remove role ARN from private ops config
3. Confirm: aws sts assume-role → AccessDenied
```

## Offboard tenant

```text
[ ] Revoke assume-role (above)
[ ] Destroy company-brain tenant stack in customer account (customer approval)
[ ] Confirm no Lanyard long-lived keys were ever created (module contract)
[ ] Snapshots/DLM retention per customer contract (customer owns account)
[ ] Remove tenant from control plane per product runbooks (Portal — out of scope here)
```

---

## Offline validation (no AWS)

```bash
bash scripts/smoke-customer-account-access.sh
bash scripts/smoke-tenant-template-wiring.sh
cd modules/customer-account-access && terraform init -backend=false && terraform validate
cd templates/tenant && terraform init -backend=false && terraform validate
bash scripts/policy-as-code-security.sh
```

---

## Failure matrix

| Symptom | First look |
|---------|------------|
| AccessDenied on AssumeRole | ExternalId mismatch; wrong principal ARN; MFA condition; region condition |
| AccessDenied on EC2 create | Missing Project tag on create; permissions boundary; wrong account |
| AccessDenied on SSM secret | Path outside `/company-brain/<project_name>` |
| Bootstrap S3 403 | Bucket policy missing instance role; wrong prefix; mirror not synced |
| State lock / wrong account | Provider alias not used; backend still pointing at platform |

---

## Explicit non-claims

- Module presence ≠ production multi-account certification.
- No employee-vault dependency.
- Tier 3 / Portal control-plane security gates remain separate (`references/readiness-matrix.md`).
