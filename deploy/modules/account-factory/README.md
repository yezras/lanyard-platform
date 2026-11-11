# account-factory

**Lanyard-hosted** (`lanyard_hosted`) **account-per-tenant** factory **contract** plus optional **in-account baseline** Terraform.

| Layer | What it is | Who applies |
|-------|------------|-------------|
| Account request / OU | Interface outputs (`account_request_contract`) for Control Tower Account Factory / AFT / Organizations | Org / CT / AFT operators |
| Baseline SCPs | JSON under `scp/` | Org management account (attach to OU) — **not** this module |
| SSO / break-glass | Permission set names documented; IAM roles when baseline on | Identity Center + in-account baseline |
| Backend / KMS / logs / backup / budget | Real Terraform when `create_account_baseline=true` | Inside the **already vended** tenant account |
| Deploy role | AssumeRole only — **no static keys** | Same baseline apply |

## Status

| Claim | Truth |
|-------|--------|
| Module is real Terraform | **Yes** — `terraform init -backend=false && terraform validate` |
| Creates AWS accounts via Organizations API | **No** — `enable_live_organizations_api` locked **false** |
| Applies SCPs to the org | **No** — templates only; live attach is org-admin |
| Control Tower / AFT live certified | **No** — integration **documented** + request contract JSON |
| In-account baseline (KMS/state/roles/…) | **Yes** when `create_account_baseline=true` (operator-owned) |
| Auto-applied from git examples | **No** — **infra_ready** contract |
| Employee-vault dependency | **None** |

Readiness: **infra_ready**. Isolation model: `references/tenant-isolation-decision.md`. Runbook: `references/runbooks/account-factory.md`.

## Why two layers

Full Control Tower/AFT **live vending** is org infrastructure and is **not** safe to auto-apply from this monorepo. This module:

1. **Models the request** (email, name, OU path, environment class, SSO permission sets) as outputs operators paste into CT/AFT.
2. **Initializes the vended account** with the prerequisites tenant deploy needs: state backend, KMS, log group, backup vault, budget, deploy + break-glass roles.
3. **Ships SCP JSON** for offline review and live OU attach.

## Usage — contract only (default)

```hcl
module "account_factory" {
  source = "../../modules/account-factory"

  tenant_slug       = "acme"
  project_name      = "acme-brain"
  environment_class = "production-client"
  account_name      = "lanyard-acme-prod"
  account_email     = var.account_email # private

  target_ou_path = "Root/Lanyard/clients/production-clients"

  create_account_baseline      = false
  acknowledge_not_auto_applied = true
  enable_live_organizations_api = false
}

# Hand to CT/AFT:
#   terraform output -json account_request_contract
```

## Usage — post-vend baseline (inside tenant account)

```hcl
module "account_factory" {
  source = "../../modules/account-factory"

  tenant_slug       = "acme"
  project_name      = "acme-brain"
  environment_class = "production-client"
  account_name      = "lanyard-acme-prod"
  account_email     = var.account_email
  account_id        = var.vended_account_id # 12-digit from CT/AFT

  create_account_baseline = true

  lanyard_deploy_principal_arns = [
    "arn:aws:iam::LANYARD_MGMT_ACCOUNT:role/lanyard-platform-deployer",
  ]
  break_glass_principal_arns = [
    "arn:aws:iam::LANYARD_MGMT_ACCOUNT:role/lanyard-break-glass",
  ]
  # deploy_role_external_id = var.external_id # optional; sensitive private only

  acknowledge_not_auto_applied  = true
  enable_live_organizations_api = false
}
```

Prefer **relative** module sources in this monorepo. External consumers pin a tag/commit — never `ref=main`.

## Outputs consumed by tenant deploy

| Output | Use |
|--------|-----|
| `account_id` | `templates/tenant` `aws_account_id` |
| `deploy_role_arn` | Provider `assume_role` (no static keys) |
| `kms_key_arn` | `dedicated_kms_key_arn` on company-brain-ec2 |
| `state_backend_config_template` | Per-tenant remote state |
| `log_group_name` | `log_group_prefix` |
| `tenant_template_wiring` | Suggested isolation vars |

## SCP templates (`scp/`)

| File | Intent |
|------|--------|
| `deny-leave-organization.json` | Block `organizations:LeaveOrganization` |
| `deny-root-create-access-keys.json` | Discourage long-lived root/user keys |
| `deny-public-s3-acls.json` | Block common public ACL patterns |
| `protect-security-services.json` | Protect CloudTrail / GuardDuty / Security Hub stop/disable |

Attach at **OU** (`production-clients` / `sandbox`) from the management account. Offline smoke asserts JSON parse + required actions.

## Explicit non-claims

- No live Control Tower Account Factory Terraform provider apply.
- No AFT pipeline code in this repo (request example JSON only).
- No employee-vault dependency.
- No claim that multi-account production is certified from examples alone.
- Track B customer-owned accounts use `modules/customer-account-access/` instead.

## Validation

```bash
bash scripts/smoke-account-factory.sh
cd modules/account-factory && terraform init -backend=false && terraform validate
```
