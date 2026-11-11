# Tenant deploy template

**EC2 path only** (`runtime_kind=ec2`, default). This root always creates
`modules/company-brain-ec2`. For **`runtime_kind=daytona`**, do **not** copy or
apply this template — Terraform check `runtime_kind validation (ec2 only) + check daytona_forbids_company_brain_ec2_template`
fails closed (`lp-4nf`, plan §4.11).

| Branch | Operator path |
|--------|----------------|
| **`ec2`** | This template + [`references/provision-runbook.md`](../../references/provision-runbook.md) |
| **`daytona`** | CP register + S3 vault prefix only — [`docs/plans/0008-daytona-agent-sandboxes/provision-runbook-daytona.md`](../../../docs/plans/0008-daytona-agent-sandboxes/provision-runbook-daytona.md). No company-brain EC2 TF; compute is lazy via Instance Orchestrator `ensure_online`. |

1. Copy this directory to `deployments/<tenant_slug>/` (this private deploy repo).
2. Copy `terraform.tfvars.example` → `terraform.tfvars` (gitignored). Confirm **`runtime_kind = "ec2"`** (never `daytona` here).
3. **Track A / Track B access wiring** (see below): set isolation vars; optionally `deploy_role_arn` + ExternalId; copy `backend.tf.example` → `backend.tf` from account-factory or customer-owned state.
4. Set **network placement**: `network_mode = "production"` with real `vpc_id` + private `subnet_id` (`associate_public_ip = false`). Lab mode is non-prod only.
5. Optionally set **`dedicated_kms_key_arn`** / **`ebs_kms_key_id`** (customer-managed CMK — strongly recommended for production; Track A uses account-factory `kms_key_arn`). Keep snapshot block-public-access enabled.
6. Fill **artifact pins** (URL + version + SHA-256) for client-core and Hermes — see `artifacts/README.md`. Scope S3 IAM with `artifact_s3_bucket_arns` + object ARNs / prefixes under `hermes/` and `client-core/`. Set `artifact_cross_account_mode` for operator notes.
7. From control plane **register** (`POST .../instances/register`; provision is a compat alias): set `relay_wss_url` + `relay_instance_id`. Store the show-once **secret in SSM SecureString** (or Secrets Manager), not in tfvars — set `relay_secret_ssm_parameter_name`. Rotate/revoke: `references/runbooks/relay-secret-lifecycle.md`. Artifact pins: `references/runbooks/pin-update.md`.
8. Set **isolation** vars per `references/tenant-isolation-decision.md` (`hosting_track`, `isolation_mode`, and when production: `production_intent`, `aws_account_id`, `dedicated_kms_key_arn`, `log_group_prefix`).
9. `terraform init && plan && apply` (instance role gets GetParameter via `attach_relay_secret_iam`). Prefer SSM Session Manager over public SSH.
10. Prefer **SSM Session Manager** (`terraform output ssm_start_session_command`); SSH is optional break-glass only. Run `sudo /usr/local/sbin/company-brain-bootstrap` (installed by user_data from monorepo `scripts/bootstrap-host.sh`; loads `/etc/company-brain/artifact-pins.env`).
11. On host: fetch relay secret with instance role (`terraform output host_secret_fetch_command`) → merge into `/home/hermes/.hermes/.env` → `sudo systemctl enable --now hermes-gateway` (or restart).
12. Optional **Tailscale** secondary mesh: set `enable_tailscale` + SSM/SM auth-key **name/ARN** only (never the key value). See `references/runbooks/tailscale-operator-access.md`.

### Post-bootstrap checklist (every tenant)

| Step | Action | Notes |
|------|--------|-------|
| 1. Pins | Hermes + client-core URL/version/SHA-256 | **hermes-lanyard only** — never pin raw Nous for customer hosts (`references/runbooks/pin-update.md`) |
| 2. Bootstrap | `sudo /usr/local/sbin/company-brain-bootstrap` | Installs Hermes → **`/opt/hermes-lanyard`**; client-core → `/opt/company-brain` if empty |
| 3. Relay env | Non-secret `GATEWAY_RELAY_*` + secret from SSM/SM | Merge into `/home/hermes/.hermes/.env` (mode 600); `references/runbooks/relay-secret-lifecycle.md` |
| 4. Gateway | `sudo systemctl enable --now hermes-gateway` | **One** unit; ExecStart **`/opt/hermes-lanyard/bin/hermes gateway`** — no second gateway binary |
| 5. Demo seed (optional) | `seed-demo-vault.sh` + `seed-demo-hermes-projects.sh` | **Mock/lab only** — do **not** run on production customer vaults |

Module sources use **in-repo relative paths**. Do not float on `main` if switching to a git module source—pin a tag or commit.

Portal URL: `https://app.withlanyard.com/<tenant_slug>`

Default Hermes profiles: **admin**, **contributor**.

## Track A / Track B access wiring (cbd-mta.7.3)

| Track | Prerequisite modules | Tenant template inputs |
|-------|----------------------|------------------------|
| **A** `lanyard_hosted` + `isolation_mode=account` | `modules/account-factory` (request + optional baseline) | `aws_account_id`, `deploy_role_arn`, `dedicated_kms_key_arn` ← `kms_key_arn`, `log_group_prefix` ← `log_group_name`, backend from `state_backend_config_template` |
| **B** `customer_account` | `modules/customer-account-access` (customer applies) | `aws_account_id`, `deploy_role_arn` ← `role_arn`, **`deploy_role_external_id`** (secret), `deploy_role_external_id_parameter_name` (name only), customer-owned backend |
| Either | SSO into target account | Leave `deploy_role_arn` null — no assume_role block |

| File | Purpose |
|------|---------|
| `versions.tf` | Optional `assume_role` on default provider when `deploy_role_arn` set |
| `providers.tf.example` | Dual-alias pattern (`aws.tenant` / `aws.customer`) for composed roots |
| `backend.tf.example` | Per-tenant remote state (Track A factory bucket vs Track B customer bucket) |
| `terraform.tfvars.example` | Placeholder mapping comments (no live secrets) |
| Outputs | `access_wiring_summary`, `state_backend_hints`, `artifact_cross_account_notes` |

**Honesty:** account-factory and customer-account-access are **infra_ready** contracts — not auto-applied from this template. No static access keys. No employee-vault dependency.

Offline smoke: `bash scripts/smoke-tenant-template-wiring.sh`

## Variables surfaced for security posture

| Variable | Purpose |
|----------|---------|
| `runtime_kind` | `ec2` (default, this template) or `daytona` (**fail-closed** — do not apply; use Daytona provision runbook). Plan §4.11 / `lp-4nf` |
| `network_mode` | `production` (default) or `lab` |
| `vpc_id` / `subnet_id` | Required for production private placement |
| `associate_public_ip` | Must be false in production |
| `operator_ssh_cidrs` / `ssh_key_name` | Optional SSH; empty = SSM-only (production default) |
| `enable_ssm_access` / `create_ssm_vpc_endpoints` | Session Manager + optional PrivateLink |
| `egress_mode` / `egress_https_*` | Controlled production egress (not all-protocol open) |
| `ami_id` / `use_golden_ami` | Pinned golden AMI path; reduce user_data package installs |
| `ebs_kms_key_id` / `dedicated_kms_key_arn` | CMK for EBS (dedicated falls through to ebs when ebs unset) |
| `enable_ebs_snapshot_block_public_access` | Account/region snapshot BPA |
| `artifact_s3_bucket_arns` / `artifact_s3_object_arns` / `artifact_s3_list_prefixes` | Scoped instance role S3 read |
| `artifact_cross_account_mode` | Operator note: platform_bucket_grant \| customer_mirror \| https_pins \| same_account |
| `deploy_role_arn` / `deploy_role_external_id` | Provider assume_role (Track A/B); ExternalId required for Track B |
| `deploy_role_external_id_parameter_name` | Secret *name* documentation only |
| `state_backend_*` | Documented backend names (applied in backend.tf, not resources here) |
| `relay_secret_source` / `relay_secret_ssm_parameter_name` | Production relay secret via SSM/SM (not tfvars) |
| `enable_security_observability` | Optional `modules/security-observability` (Flow Logs, SNS, GD findings bridge) |
| `enable_host_log_shipping` / `enable_ssm_managed_instance_core` | Host CW agent + SSM core IAM (default off) |
| `require_observability_checklist` | With `production_intent`: fail closed unless observability flags are on |
| `approved_processor_ids` | Catalog IDs from `references/approved-data-processors.md` for this tenant |
| `data_handling_policy_ref` | Private ticket/path to filled client data-handling policy |
| `processor_egress_domains` | Documented FQDNs for Network Firewall/proxy (not SG-enforced here) |
| `require_data_handling_policy` | With `production_intent`: fail closed unless processor IDs + policy ref set |
| `email_provider` / `enable_packs` | Must stay within approved email/CRM/tool processors when policy enforced |
| `enable_omnibox` | Omnibox Mode A (default **false**); OMNIBOX_* gateway env + bootstrap `ensure-omnibox`; does **not** replace hermes-gateway ExecStart |
| `enable_tailscale` / `tailscale_auth_secret_*` | Optional Tailscale secondary mesh; auth key from SSM/SM refs only |
| `enable_snapshot_age_alarm` / `snapshot_max_age_hours` | DLM snapshot freshness alarm (needs check script metric publisher) |
| `enable_snapshot_age_check_schedule` | Daily EventBridge SNS reminder for `scripts/check-snapshot-age.sh` |
| `enable_cross_region_copy` / `destination_region` | Opt-in DLM cross-region snapshot copy (default off; cbd-mta.7.4) |
| `enable_dr_account_share` / `dr_account_id` | Opt-in share to dedicated DR account only (default off; private tfvars) |

**Secrets:** production path never requires `relay_instance_secret` in Terraform. Do not commit `terraform.tfvars`, state, or plans that embed live secrets. Never commit `deploy_role_external_id`.

**Data processors:** Catalog + per-client policy template + onboarding runbook under `references/`. Map domains into controlled-egress / firewall; see `references/runbooks/controlled-egress.md` § Policy → technical controls.

**Observability:** VPC Flow Logs + security SNS are tenant-scoped. CloudTrail and GuardDuty **detectors** are account-scoped — follow `references/security-observability.md`; do not recreate them in every tenant stack. Alert triage: `references/runbooks/security-alert-triage.md`. Backup resilience (snapshot age, restore scripts, quarterly drill RTO/RPO): `references/runbooks/dlm-restore-drill.md`.

## Isolation contract (enforceable)

| Variable | Purpose |
|----------|---------|
| `hosting_track` | `lanyard_hosted` \| `customer_account` |
| `isolation_mode` | `account` \| `vpc_interim` \| `customer_account` |
| `production_intent` | Fail-closed isolation checks when `true` |
| `project_name` | Unique-style AWS name/tag partition (required shape) |
| `aws_account_id` | Account boundary (required if production_intent) |
| `dedicated_kms_key_arn` | Per-tenant CMK (required if production_intent + lanyard_hosted) |
| `log_group_prefix` | Per-tenant log partition |
| `deploy_role_arn` | Optional assume-role into account boundary |

Production Portal/relay **security** (G1/G2) is separate and remains **blocked** until product clears those gates — see `references/readiness-matrix.md` and `bash scripts/validate-production-gates.sh`.
