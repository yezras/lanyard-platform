# Runbook: Tenant isolation onboarding

**Status:** Operator procedure aligned to `references/tenant-isolation-decision.md`  
**Applies to:** Every new production (or production-intent) tenant under `templates/tenant/`

---

## Choose track and mode

| `hosting_track` | `isolation_mode` | When |
|-----------------|-------------------|------|
| `customer_account` | `customer_account` | Customer provides AWS account |
| `lanyard_hosted` | `account` | Dedicated Lanyard (or OU) account per tenant — **production target** |
| `lanyard_hosted` | `vpc_interim` | Same Lanyard account only with VPC + KMS + logs + DLM partitions — **interim only** |

Do **not** set `production_intent = true` with an unpartitioned shared default VPC or shared instance role.

---

## Checklist — `customer_account`

```text
[ ] Customer account ID recorded in aws_account_id (tfvars, not git)
[ ] isolation_mode = customer_account
[ ] modules/customer-account-access applied in customer account (role_arn + ExternalId)
[ ] deploy_role_arn set from role_arn; deploy_role_external_id from Lanyard secret store (never git)
[ ] deploy_role_external_id_parameter_name documented (name only)
[ ] Separate Terraform backend / state key in customer account (templates/tenant/backend.tf.example Track B)
[ ] Customer VPC / subnets known (no cross-customer peers)
[ ] Encryption: customer CMK ARN in dedicated_kms_key_arn when required by customer policy
[ ] log_group_prefix scoped to this tenant (or customer standard)
[ ] project_name unique (typically <slug>-brain)
[ ] Artifact reachability: artifact_cross_account_mode = platform_bucket_grant | customer_mirror | https_pins
[ ] No Lanyard multi-tenant shared instance role used in this account
[ ] bash scripts/smoke-tenant-template-wiring.sh (offline) and track-b-customer-account-access runbook
```

## Checklist — `lanyard_hosted` + `account`

```text
[ ] Dedicated AWS account provisioned (modules/account-factory request contract + CT/AFT — live ops-owned)
[ ] aws_account_id set; backend state in that account (state_backend_config_template → backend.tf)
[ ] isolation_mode = account
[ ] production_intent = true for production clients
[ ] dedicated_kms_key_arn = CMK in that account (account-factory kms_key_arn; ebs falls through)
[ ] deploy_role_arn from account-factory deploy_role_arn (or SSO into account; no static keys)
[ ] log_group_prefix = /company-brain/<tenant_slug> (or equivalent unique)
[ ] project_name unique across all Lanyard production tenants
[ ] SCPs/OU placement documented by org owners
[ ] Instance/DLM roles created only in this account (module default names from project_name)
[ ] bash scripts/smoke-tenant-template-wiring.sh + account-factory runbook
```

## Checklist — `lanyard_hosted` + `vpc_interim`

```text
[ ] Explicit approval that account-per-tenant is deferred (ticket link)
[ ] Dedicated VPC + SGs for this tenant only
[ ] dedicated_kms_key_arn set (per-tenant CMK)
[ ] log_group_prefix unique; no shared multi-tenant app log group
[ ] DLM / volume tags Project=<project_name> only for this tenant
[ ] IAM instance role unique (project_name prefix); not reused
[ ] Terraform state key unique per tenant
[ ] Plan exists to migrate to isolation_mode = account
```

---

## Template variables (private tfvars)

See `templates/tenant/terraform.tfvars.example`. Minimum production-intent set:

```hcl
hosting_track          = "lanyard_hosted" # or customer_account
isolation_mode         = "account"        # or vpc_interim | customer_account
production_intent      = true
aws_account_id         = "123456789012"   # example shape only — use real privately
project_name           = "acme-brain"
dedicated_kms_key_arn  = "arn:aws:kms:us-east-1:123456789012:key/REPLACE"
log_group_prefix       = "/company-brain/acme"
```

Never commit real account IDs, key ARNs, or secrets.

---

## Verify

```bash
# Offline honesty gates (repo root)
bash scripts/validate-production-gates.sh

# Tenant root syntax (after copy)
cd deployments/<tenant_slug>
terraform init -backend=false
terraform validate   # isolation validation blocks fire when production_intent=true
```

---

## Failure modes

| Symptom | Action |
|---------|--------|
| Terraform validation: production_intent requires dedicated_kms_key_arn | Create/assign per-tenant CMK; set ARN |
| Validation: isolation_mode incompatible with hosting_track | Align modes per decision table |
| Validation: project_name shape invalid | Use 3–50 char lowercase `^[a-z0-9][a-z0-9-]*[a-z0-9]$` |
| validate-production-gates.sh fails | Fix readiness claims / missing decision docs before go-live |
| Two tenants same project_name | **Stop** — rename; risk of DLM/IAM collision |

---

## Related

- Decision: `references/tenant-isolation-decision.md`
- Production security: `references/runbooks/production-security-gate.md`
- Track A/B E2E skeleton: `references/runbooks/track-a-b-e2e.md`
- Track A account factory: `references/runbooks/account-factory.md` + `modules/account-factory/`
- Track B customer access: `references/runbooks/track-b-customer-account-access.md` + `modules/customer-account-access/`
- Tenant template wiring smoke: `bash scripts/smoke-tenant-template-wiring.sh`
