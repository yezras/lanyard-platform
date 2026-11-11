# Runbook: Lanyard-hosted account factory (account-per-tenant)

**Status:** Operator procedure for **infra_ready** module `modules/account-factory/`  
**Audience:** Lanyard org / Control Tower / AFT operators + deploy operators  
**Related:** `references/tenant-isolation-decision.md`, `references/migration-phases.md`, `references/runbooks/tenant-isolation.md`, `modules/customer-account-access/` (Track B)

---

## Honesty (read first)

| Layer | This repo | Live-gated (ops) |
|-------|-----------|------------------|
| Account request → OU | Request **contract** outputs + AFT example JSON | Control Tower Account Factory / AFT / Organizations |
| SCP attach | JSON under `modules/account-factory/scp/` | Org management account attach to OU |
| SSO permission sets | Names documented | IAM Identity Center assignments |
| In-account baseline | Real Terraform (`create_account_baseline=true`) | Apply with credentials in the **vended** account |
| Deploy without static keys | `deploy_role_arn` + assume-role templates | Operator SSO / pipeline roles |

**Do not** claim live multi-account org factory is production-certified from module presence alone.  
**Do not** enable Organizations API mutation in this module (`enable_live_organizations_api` is locked false).  
**Do not** depend on employee-vault for any step.

---

## Goals (acceptance mapping)

1. **Request creates dedicated sandbox / production-client account in OU** — produce `account_request_contract`; operators submit via CT/AFT into `target_ou_path`.
2. **Baseline SCPs and SSO / break-glass roles tested** — SCP JSON offline smoke; live attach + SSO steps below; break-glass IAM when baseline on.
3. **Backend / KMS / logging / backup / budget initialized** — baseline module resources.
4. **Outputs provide account / deploy role without static keys** — `account_id`, `deploy_role_arn`, backend template, KMS ARNs.
5. **Decommission / quarantine tested** — checklist below + offline assertions in smoke.
6. **Deploy consumes contract without employee-vault** — relative module sources + tenant template wiring.

---

## Prerequisites

```text
[ ] Lanyard AWS Organization + Control Tower (or AFT) available to org admins
[ ] OUs exist (example paths):
      Root/Lanyard/platform
      Root/Lanyard/clients/sandbox
      Root/Lanyard/clients/production-clients
      Root/Lanyard/quarantine   (optional hold)
[ ] IAM Identity Center permission sets: CompanyBrainDeploy, CompanyBrainBreakGlass (names flexible)
[ ] Unique tenant_slug + project_name agreed
[ ] Unique account email alias for root (private ops — not committed as live production claim)
[ ] company-brain-deploy checkout at a tag/commit pin
```

---

## Phase 0 — Offline contract validation

```bash
bash scripts/smoke-account-factory.sh
cd modules/account-factory
terraform init -backend=false -input=false
terraform validate
```

Expected: smoke pass; validate pass; **no** AWS credentials required for this phase.

---

## Phase 1 — Account request (Control Tower / AFT)

### 1a. Emit request contract

```bash
# Private root wrapping the module with create_account_baseline=false
terraform apply   # or terraform output after a plan-only workspace
terraform output -json account_request_contract
terraform output account_request_contract_json
```

Example fields (see `modules/account-factory/templates/aft-account-request.example.json`):

| Field | Example |
|-------|---------|
| `environment_class` | `sandbox` or `production-client` |
| `target_ou_path` | `Root/Lanyard/clients/production-clients` |
| `account_name` | `lanyard-acme-prod` |
| `account_email` | private unique root email |
| `sso_permission_set_names` | `CompanyBrainDeploy`, `CompanyBrainBreakGlass` |

### 1b. Submit via Control Tower Account Factory

1. Management account → Control Tower → Account factory → Create account.
2. Account email / name from contract.
3. Organizational unit: match `target_ou_path` (production-clients vs sandbox).
4. Wait until account is **enrolled** / available (CT lifecycle).
5. Record **12-digit account ID** in private ops inventory (not as a production claim in this git repo’s examples).

### 1c. Submit via AFT (if used)

1. Open AFT account request PR/pipeline using org’s AFT repo (outside company-brain-deploy).
2. Map custom fields from `account_request_contract` / `templates/aft-account-request.example.json`.
3. On success, capture vended `account_id` for Phase 3.

### Live test steps (org admin)

```text
[ ] Account appears under correct OU in Organizations console
[ ] Account is not the management/platform account
[ ] SSO users can see the account (after Phase 2 assignments)
[ ] No long-lived IAM user keys created during vend
```

---

## Phase 2 — Baseline SCPs + SSO (org management)

### 2a. SCP attach (live-gated)

From **management account**, create SCPs from templates (or paste JSON):

| Template | Suggested OU |
|----------|--------------|
| `scp/deny-leave-organization.json` | `clients/*` |
| `scp/deny-root-create-access-keys.json` | `clients/*` |
| `scp/deny-public-s3-acls.json` | `clients/*` |
| `scp/protect-security-services.json` | `clients/*` (after org trail / GD / SH enabled) |

**CLI sketch** (live credentials required; adjust policy names):

```bash
# Example only — run in management account with org admin rights
aws organizations create-policy \
  --name "lanyard-deny-leave-org" \
  --type SERVICE_CONTROL_POLICY \
  --content file://modules/account-factory/scp/deny-leave-organization.json
# Then attach-policy to the target OU ID
```

### Live SCP tests

```text
[ ] From a client account principal: organizations:LeaveOrganization is denied
[ ] Root cannot create access keys (or org policy equivalent)
[ ] Public S3 ACL attempts denied per template
[ ] CloudTrail StopLogging denied when protect-security-services attached
```

Offline: `bash scripts/smoke-account-factory.sh` asserts JSON + action strings.

### 2b. SSO / permission sets (live-gated)

```text
[ ] Permission set CompanyBrainDeploy → maps to or trusts deploy role pattern
[ ] Permission set CompanyBrainBreakGlass → MFA-required admin/recovery
[ ] Assign sets to the vended account for the operator groups only
[ ] Standard operators do not get standing break-glass
```

Break-glass **IAM role** in-account is created in Phase 3 when `break_glass_principal_arns` is set (`require_mfa_break_glass=true` recommended for `production-client`).

### Live SSO / break-glass tests

```text
[ ] SSO login → CompanyBrainDeploy can sts:AssumeRole to deploy_role_arn (or use SSO role for apply)
[ ] Deploy role session: aws sts get-caller-identity shows tenant account
[ ] Deploy role: iam:CreateAccessKey denied
[ ] Break-glass assume without MFA fails when require_mfa_break_glass=true
[ ] Break-glass with MFA succeeds; session ≤ 1h
```

---

## Phase 3 — In-account baseline (backend / KMS / logs / backup / budget / roles)

Apply **in the vended account** (AFT customization stage, StackSet, or operator assume `OrganizationAccountAccessRole` once):

```bash
cp modules/account-factory/terraform.tfvars.example terraform.tfvars
# Set:
#   account_id = "<vended 12-digit>"
#   create_account_baseline = true
#   lanyard_deploy_principal_arns = [ "arn:aws:iam::<mgmt>:role/lanyard-platform-deployer" ]
#   break_glass_principal_arns = [ "arn:aws:iam::<mgmt>:role/lanyard-break-glass" ]
#   acknowledge_not_auto_applied = true
#   enable_live_organizations_api = false

terraform init
terraform plan
terraform apply

terraform output deploy_role_arn
terraform output kms_key_arn
terraform output state_backend_config_template
terraform output account_id
```

### Baseline checklist

```text
[ ] KMS CMK created; key rotation on; alias company-brain-<project>
[ ] State S3 bucket: versioning on, public access blocked, TLS-only policy
[ ] DynamoDB lock table present
[ ] CloudWatch log group /company-brain/<tenant_slug>
[ ] AWS Backup vault present (DLM still primary for company-brain-ec2 EBS)
[ ] Monthly budget present
[ ] Deploy role path /company-brain/; no access keys
[ ] Break-glass role present if principals configured
```

---

## Phase 4 — Consume contract in tenant deploy (templates/tenant wiring)

The stock tenant root already wires Track A outputs via optional provider
`assume_role` and documented backend vars (`templates/tenant/versions.tf`,
`backend.tf.example`, `terraform.tfvars.example`). Offline contract:

```bash
bash scripts/smoke-tenant-template-wiring.sh
```

1. Copy `templates/tenant` → private `deployments/<tenant_slug>/` (not live secrets in git).
2. Configure remote state from `state_backend_config_template` → `backend.tf`
   (also document `state_backend_bucket` / `state_backend_dynamodb_table` /
   `state_backend_key` in private tfvars for operator notes).
3. Provider assume-role — **pick one**:
   - **Default provider (preferred for pure data-plane tree):** set
     `deploy_role_arn = "<deploy_role_arn output>"` in private tfvars.
     Optional `deploy_role_external_id` only if the factory role trust requires it.
   - **Dual alias:** copy `templates/tenant/providers.tf.example` (`aws.tenant`)
     and pass `providers = { aws = aws.tenant }` on data-plane modules
     (or use output `terraform_provider_assume_role_hcl`).
   - **SSO into tenant account:** leave `deploy_role_arn` null.
4. Set isolation vars from `tenant_template_wiring` (and tfvars.example Track A block):

```hcl
hosting_track         = "lanyard_hosted"
isolation_mode        = "account"
production_intent     = true   # for production-client
project_name          = "acme-brain"
aws_account_id        = "<account_id>"
dedicated_kms_key_arn = "<kms_key_arn>"   # also used as ebs_kms when ebs_kms_key_id unset
log_group_prefix      = "/company-brain/<tenant_slug>"
deploy_role_arn       = "<deploy_role_arn>"
artifact_cross_account_mode = "same_account"  # or https_pins
```

5. Apply tenant stack with artifact pins (no employee-vault; artifact contract only).
6. Bootstrap: `sudo /usr/local/sbin/company-brain-bootstrap`.
7. Confirm non-secret wiring: `terraform output access_wiring_summary`.

### Consume checklist

```text
[ ] No static AWS access keys in CI or operator laptops for this path
[ ] State key is per-tenant; not shared with other clients (backend.tf from factory template)
[ ] KMS key is not a multi-tenant shared CMK from another account
[ ] deploy_role_arn account matches aws_account_id when production_intent=true
[ ] bash scripts/smoke-tenant-template-wiring.sh passes offline
[ ] bash scripts/validate-production-gates.sh still honest (G1/G2 may remain blocked)
```

---

## Phase 5 — Quarantine

Use when a tenant is compromised, non-paying, or under investigation **before** full decommission.

```text
[ ] Move account to Quarantine OU (or attach deny-all SCP)
[ ] Detach non-break-glass SSO assignments
[ ] Remove principals from deploy role trust (or delete deploy role)
[ ] Stop company-brain instance(s); do not delete snapshots yet
[ ] Confirm org CloudTrail still receives events
[ ] Document incident ticket + retention hold
```

Module output `decommission_quarantine_checklist.quarantine` mirrors this list.

---

## Phase 6 — Decommission

```text
[ ] Destroy tenant stack (company-brain-ec2) via deploy role or break-glass
[ ] Confirm DLM snapshots retained per customer/contract (or copy to DR per isolation decision)
[ ] Destroy account-factory baseline (roles, budget first; retain KMS/state if audit requires)
[ ] Close account via Control Tower / org process (or leave suspended in Quarantine OU)
[ ] Delete Lanyard-side secrets (ExternalId, inventory entries)
[ ] Remove private deployment working tree secrets; never push state
```

### Live decommission tests (staging sandbox account)

```text
[ ] After deploy role trust removal: assume-role fails
[ ] After quarantine SCP: non-break-glass API calls denied
[ ] After close/suspend: account no longer accepts new SSO for standard groups
```

---

## Failure modes

| Symptom | Check |
|---------|--------|
| Module validate fails on `enable_live_organizations_api` | Must remain `false` |
| Baseline apply in wrong account | Confirm `aws sts get-caller-identity` == vended `account_id` |
| State bucket name collision | Override `state_bucket_name` (globally unique) |
| KMS log group fails | Ensure CMK policy allows logs service in region |
| CT account email reuse | Email must be unique forever for root |

---

## Explicit non-claims

- This runbook does **not** auto-vend accounts from CI.
- SCP JSON is **not** attached by Terraform in this repository.
- Track B (`customer_account`) uses `modules/customer-account-access/` and customer-owned accounts — not this factory.
- No employee-vault clone, path, or module source.

---

## Validation commands

```bash
bash scripts/smoke-account-factory.sh
bash scripts/smoke-tenant-template-wiring.sh
bash scripts/policy-as-code-security.sh   # includes account-factory gates when module present
terraform -chdir=modules/account-factory init -backend=false && terraform -chdir=modules/account-factory validate
terraform -chdir=templates/tenant init -backend=false && terraform -chdir=templates/tenant validate
```
