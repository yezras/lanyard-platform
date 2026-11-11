# Tenant isolation decision

**Status:** Accepted decision for production onboarding  
**Date:** 2026-07-12  
**Scope:** Data-plane isolation for Company Brain hosts (`templates/tenant/`, `modules/company-brain-ec2/`)  
**Related:** `references/readiness-matrix.md` (production security gates), `references/runbooks/tenant-isolation.md`

This document is the **written isolation model** for Lanyard-hosted vs customer-account tracks. It is not optional narrative: production onboarding **must** follow the enforceable boundaries below. Shared-account multi-tenant without per-tenant VPC/KMS/log/backup partitions is **not** an accepted production posture.

---

## Decision summary

| Hosting track | Production isolation target | Interim (pre–account factory) | Forbidden in production |
|---------------|----------------------------|-------------------------------|-------------------------|
| **`customer_account`** | **Full AWS account boundary** owned by the customer | Same as target (customer provides account) | Shared Lanyard IAM roles or shared state backends with other tenants |
| **`lanyard_hosted`** | **Account-per-tenant** (or Org OU + dedicated account) | **VPC-per-tenant + per-tenant KMS + per-tenant log groups + per-tenant DLM/`project_name`** | Unpartitioned shared account (shared default VPC, shared CMK, shared log groups, shared instance roles across tenants) |

**Default production target for Lanyard-hosted:** account-per-tenant.  
**Interim production path:** VPC-per-tenant with mandatory unique `project_name`, dedicated KMS CMK, dedicated CloudWatch log group prefix, and DLM tags scoped to that project — **never** shared IAM instance roles across tenants.

---

## Track models

### Track B — `customer_account`

| Boundary | Requirement |
|----------|-------------|
| **AWS account** | Customer-owned account is the hard isolation boundary |
| **VPC / network** | Customer VPC (or customer-approved default); no peer/routes into other customer accounts |
| **KMS** | Customer-managed CMK preferred for EBS/snapshots; at minimum encryption on and keys not shared with other customers via Lanyard-held multi-tenant roles |
| **Logs** | Customer account CloudWatch / logging; Lanyard break-glass only via customer-approved assume-role |
| **Backups** | DLM (or customer backup policy) tags with unique `Project=<project_name>`; snapshots stay in customer account |
| **State / IAM** | Separate Terraform backend; no shared deploy role with other tenants |

Lanyard operators assume a **customer-granted** role (future Track B IAM module). This repo does not invent that module yet (Phase 6). Isolation still holds at the account boundary today.

### Track A — `lanyard_hosted`

#### Production target: account-per-tenant

| Boundary | Requirement |
|----------|-------------|
| **AWS account** | One dedicated account (or member account under a tenant OU) per production client |
| **Org / SCPs** | Recommended: OU `clients/<tenant>` (or `production-clients`); SCPs deny cross-account resource sharing defaults that would couple tenants; deny leaving org without break-glass |
| **VPC** | Dedicated VPC in that account (no shared transit to other client accounts without explicit peering change control) |
| **KMS** | CMK in the tenant account only; no multi-tenant key policy principals |
| **Logs** | Log groups / trails only in that account (`/company-brain/<tenant_slug>/…` or account-default partitions) |
| **Backups** | DLM (or AWS Backup) in that account; `Project=<project_name>` unique globally among Lanyard tenants |
| **IAM** | Instance role, DLM role, and operator roles **unique to the tenant account** — never a shared instance role ARN across tenants |

Account request / OU placement remains **ops infrastructure** (Control Tower / AFT / Organizations). This repo provides an **infra_ready contract** at `modules/account-factory/` (request outputs, SCP JSON templates, optional in-account baseline) plus `references/runbooks/account-factory.md` — **not** live Organizations mutation from git examples. Operators must not onboard production Lanyard-hosted clients into a single unpartitioned account.

#### Interim production path: VPC-per-tenant (same account only with hard partitions)

Use **only** when account-per-tenant is not yet available and production onboarding must proceed. All of the following are **mandatory**:

| Control | Enforceable expectation |
|---------|-------------------------|
| **Unique `project_name`** | DNS-safe, tenant-scoped (default `${tenant_slug}-brain`); never reuse across tenants; template validates shape |
| **Dedicated VPC** | One VPC (and SG set) per tenant; no shared app subnets across tenants |
| **Dedicated KMS CMK** | Per-tenant CMK for EBS (and snapshots when key policy allows); set `dedicated_kms_key_arn` when `production_intent=true` |
| **Log partition** | Per-tenant CloudWatch log group prefix (e.g. `/company-brain/<tenant_slug>/`); no shared multi-tenant application log group |
| **Backup partition** | DLM policy + volume tags `Project=<project_name>`; no shared DLM lifecycle that snapshots “all company-brain volumes” without project filter |
| **IAM** | Per-tenant instance role and DLM role names derived from `project_name`; **no** shared instance profile across tenants |
| **State** | Separate Terraform state key/prefix per tenant (never one state file for multiple production clients) |

**Not acceptable as interim production:** multiple production clients on one default VPC with one CMK, one log group, or one shared instance role.

---

## Tradeoffs

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Account-per-tenant | Strongest blast-radius limit; clear billing; SCP-friendly; matches enterprise reviews | Account sprawl; needs org factory / SSO | **Production target for `lanyard_hosted`** |
| VPC-per-tenant (shared account) | Faster onboarding; fewer accounts | Shared account root/IAM risk; needs discipline on KMS/logs/roles | **Interim only**, with mandatory partitions |
| Shared VPC multi-tenant | Lowest ops cost | Cross-tenant network/IAM blast radius | **Rejected for production** |
| Customer account | Customer owns boundary; Lanyard least privilege | Needs assume-role and customer VPC hygiene | **Required model for `customer_account`** |

---

## Default IAM / network non-access rule

**Lanyard-hosted clients must not access another tenant’s resources by default.**

Deploy-owned expectations:

1. **Network:** No security-group rules, VPC peers, or shared ENIs that allow tenant A instance → tenant B instance or tenant B data plane services.
2. **IAM:** Instance roles scoped to that tenant’s resources (artifact read buckets may be shared **read-only** platform prefixes; write paths and vault/EBS/KMS must not be).
3. **KMS:** Key policies must not list other tenants’ roles as users/admins.
4. **Logs / backups:** Queries and restore drills are scoped by `project_name` / account; operators use break-glass, not standing multi-tenant admin on all clients.

Shared **platform** resources (product artifact S3 read, public relay WSS endpoint for Tier 1/2) are intentional multi-tenant *platform* surfaces. They are **not** a license to co-mingle vault disks, KMS keys, or instance roles.

---

## Template contract (`templates/tenant`)

| Variable | Role |
|----------|------|
| `hosting_track` | `lanyard_hosted` \| `customer_account` |
| `isolation_mode` | `account` (target) \| `vpc_interim` (lanyard_hosted interim only) \| `customer_account` |
| `production_intent` | When `true`, isolation validations fail closed |
| `project_name` | Unique-style prefix for AWS names/tags (required uniqueness operationally) |
| `dedicated_kms_key_arn` | Required when `production_intent` and not pure customer-owned encryption path |
| `log_group_prefix` | Documented partition for tenant logs |
| `aws_account_id` | Recorded account boundary (12-digit); required when `production_intent` |

See `templates/tenant/variables.tf` validation blocks and `references/runbooks/tenant-isolation.md`.

---

## Org / SCP recommendations (account-per-tenant)

Operators owning the Lanyard AWS Organization should document (outside this repo’s live secrets):

1. OU structure separating platform vs production client accounts.
2. SCPs that deny: unrestricted `iam:CreateUser` with long-lived keys where SSO is mandatory; accidental public S3 ACLs if org policy requires it; leaving the organization without break-glass.
3. No second GitHub OIDC provider per account when one exists — pass existing provider ARN into product-artifact modules (platform account only).
4. Central logging (optional) via org trail with **per-account** retention; application logs remain per-tenant.

This repo ships SCP **JSON templates** and a request contract under `modules/account-factory/` but does **not** call Organizations CreateAccount / AttachPolicy from Terraform (`enable_live_organizations_api` locked false). Live CT/AFT/SCP attach remains operator/org responsibility (`references/runbooks/account-factory.md`).

---

## Snapshot copy (cross-region / cross-account)

**Default production posture:** DLM daily snapshots stay in the **same AWS account and region** as the Company Brain volumes (`modules/company-brain-ec2`). Same-region restore is the supported RTO path (`references/runbooks/dlm-restore-drill.md`). Public sharing remains blocked via `enable_ebs_snapshot_block_public_access`.

This section is the **isolation decision** for optional copies. The module does **not** enable cross-region or cross-account copy by default (no floating multi-tenant backup bus).

| Scenario | Allowed? | Requirements |
|----------|----------|--------------|
| Same account, same region (DLM primary) | **Yes — default** | Tags `Project=<project_name>`, `Backup=daily`; per-tenant DLM policy |
| Same account, **cross-region** copy | **Opt-in** | Documented regional DR need; CMK usable in destination (multi-Region key or re-encrypt with destination CMK); copy tags preserve `Project`; ops runbook for restore in DR region; still no other-tenant access |
| **Cross-account** copy (`lanyard_hosted` → central DR account) | **Opt-in, change-controlled** | Dedicated DR account (not another tenant); KMS grants least-privilege to DR roles only; SCPs/deny lists prevent tenant-to-tenant share; never use a shared “all clients” snapshot sink without per-`Project` IAM conditions |
| Cross-account to **another tenant** account | **Forbidden** | Violates account-per-tenant / backup partition |
| `customer_account` → Lanyard account | **Only with customer written approval** | Customer owns boundary; prefer customer-owned DR; Lanyard break-glass assume-role if contracted |
| Public snapshot share / unrestricted AMI | **Forbidden** | Block public access; no `createVolumePermission` to `all` |

### Policy rules (operators)

1. **Tenant partition:** Every snapshot (including copies) must retain `Project=<project_name>` (and preferably `Backup=daily` or `Backup=dr-copy`). Restore drills and IAM conditions key off this tag.
2. **No multi-tenant backup roles:** DR copy roles must not list multiple tenants’ KMS keys in one standing admin principal without break-glass.
3. **RPO/RTO:** Cross-region copy does not change the default **RPO 24h / RTO 4h** examples unless the customer contract and successful quarterly drill prove a different target.
4. **Implementation status (cbd-mta.7.4):** `modules/company-brain-ec2` exposes **opt-in, fail-closed** flags — `enable_cross_region_copy` + `destination_region` (DLM `cross_region_copy_rule`, always encrypted) and `enable_dr_account_share` + `dr_account_id` (DLM `share_rule` to a dedicated DR account). Defaults are **false/null** (same-account, same-region only). Operators may still use controlled CLI/console copy under this policy when flags stay off — not ad-hoc shares.
5. **Age monitoring:** Snapshot-age alarms (`enable_snapshot_age_alarm`, `scripts/check-snapshot-age.sh`) evaluate **primary-region** snapshots tagged for the project. DR copies need a separate check if DR is contractual.

### Decision summary

| Hosting track | Primary backups | Cross-region | Cross-account |
|---------------|-----------------|--------------|---------------|
| `lanyard_hosted` (account-per-tenant) | In tenant account | Opt-in per DR design | Only to non-tenant DR account with grants |
| `lanyard_hosted` (vpc_interim) | In shared account, tagged `Project` | Opt-in; still tag-partitioned | Avoid; prefer account-per-tenant first |
| `customer_account` | In customer account | Customer policy | Customer-controlled; Lanyard only if approved |

---

## Explicit non-claims

- No **live** multi-account Organizations apply or Control Tower certification from this repository’s examples. Contract module: `modules/account-factory/` (**infra_ready**; operator-owned CT/AFT + optional in-account baseline).
- No Portal control-plane multi-tenant auth implementation here (product/G1).
- No claim that shared relay Tier 1/2 is a data-plane isolation boundary for vault content (relay is transport; vault isolation is account/VPC/EBS/KMS).
- Tier 3 dedicated relay (`modules/tier3-dedicated-relay/`) is **infra_ready** deployable dedicated-relay compute (composes `portal-relay-service`; per-tenant hostname/WSS; optional DNS/WAF; fail-closed `claim_production_ready=false` / `acknowledge_not_auto_applied`). Not production-certified isolation proof from module presence alone (see readiness matrix — Tier 3 **infra_ready**).
- Cross-region/cross-account snapshot **copy flags** exist in `company-brain-ec2` but default **off**; enabling them is operator-owned change control, not automatic multi-tenant DR. No claim that a live dedicated DR account or multi-region drill is certified from examples alone.

---

## Operator gate

Before marking a **production** tenant onboarded:

```text
[ ] hosting_track set correctly
[ ] isolation_mode matches decision (account | vpc_interim | customer_account)
[ ] production_intent = true only when partitions are real
[ ] project_name unique among all production tenants
[ ] dedicated_kms_key_arn set (lanyard_hosted production) or customer CMK documented
[ ] log_group_prefix unique / account-scoped
[ ] aws_account_id recorded; state backend per tenant
[ ] No shared instance role with another tenant
[ ] bash scripts/validate-production-gates.sh passes
```

Full procedure: `references/runbooks/tenant-isolation.md` and `references/runbooks/production-security-gate.md`.


## Track B customer-account access

Contract module: `modules/customer-account-access/`. Runbook: `references/runbooks/track-b-customer-account-access.md`.  
Tenant consume: `templates/tenant` (`deploy_role_arn` + `deploy_role_external_id`, customer backend, `artifact_cross_account_mode`). Offline: `bash scripts/smoke-tenant-template-wiring.sh`.

## Track A account factory (lanyard_hosted)

Contract module: `modules/account-factory/`. Runbook: `references/runbooks/account-factory.md`. Offline smoke: `bash scripts/smoke-account-factory.sh`.  
Tenant consume: `templates/tenant` (`deploy_role_arn`, `dedicated_kms_key_arn` ← `kms_key_arn`, backend from `state_backend_config_template`). Offline: `bash scripts/smoke-tenant-template-wiring.sh`.
