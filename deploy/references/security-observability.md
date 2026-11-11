# Security observability (company-brain-deploy)

**Status:** Deploy-surface contract for production data-plane hosts  
**Bead:** cbd-zzx.12 · updated `lp-k7g.10.5` (backend-neutral log paths)  
**Related:** `modules/security-observability/`, `modules/company-brain-ec2/`, `references/runbooks/security-alert-triage.md`, `references/tenant-isolation-decision.md`, `contracts/backend-runtime-v1/filesystem-layout.md`

This document separates **tenant-stack resources** (safe to create per client) from **account/org services** (create once; do not embed in every tenant root).

Host observability applies to any **backend artifact** installed on the company-brain EC2 host (`hermes_lanyard`, `hermes_upstream`, `lanyard_agent`, …) under the platform install path — not only Hermes.

---

## What lives where

| Control | Scope | In repo? |
|---------|--------|----------|
| VPC Flow Logs | Per tenant VPC | `modules/security-observability` (`enable_vpc_flow_logs`) |
| Host log shipping (journald/auth/sudo/backend) | Per data-plane host | `modules/company-brain-ec2` (`enable_host_log_shipping`) |
| SSM Session Manager IAM | Per instance role | `enable_ssm_managed_instance_core` |
| EC2 status-check alarm | Per host | `enable_status_alarm` + `status_alarm_actions` |
| Security SNS topic | Per tenant (or shared ops topic) | `modules/security-observability` |
| GuardDuty **findings** → SNS | Regional EventBridge rule | `enable_guardduty_finding_alerts` |
| GuardDuty **detector** | Account / org | **Not** in tenant stack — checklist below |
| CloudTrail | Account / org trail | **Not** in tenant stack — checklist below |
| Snapshot-age alarm | Per tenant DLM tags | SNS/tag interface here; alarm + scripts in `company-brain-ec2` / `scripts/check-snapshot-age.sh` (cbd-zzx.20) |
| AWS Config rules (SG / unauthorized change) | Account | Documented patterns only |

---

## Tenant enablement (recommended production)

```hcl
# templates/tenant terraform.tfvars (private; do not commit live values)

production_intent               = true
enable_security_observability   = true
enable_vpc_flow_logs            = true
enable_host_log_shipping        = true
enable_ssm_managed_instance_core = true
require_observability_checklist = true  # fail-closed when production_intent

# Optional (private):
# security_alert_email_endpoints = ["ops@example.com"]
```

`require_observability_checklist` only asserts the **tenant** flags above. It does **not** prove CloudTrail or GuardDuty detectors exist (those are account-scoped).

Log partitions align with isolation:

| Stream | Default log group |
|--------|-------------------|
| Host (CW agent) | `/company-brain/<tenant_slug>/host` |
| VPC Flow Logs | `/company-brain/<tenant_slug>/vpc-flow-logs` |

(`log_group_prefix` defaults to `/company-brain/<tenant_slug>`.)

---

## Account-level checklist (operators)

Complete **once per AWS account** (or via AWS Organizations delegated admin). Do not recreate these resources inside each `deployments/<tenant>/` stack.

### 1. CloudTrail

- [ ] Multi-region trail (or organization trail) covering management events
- [ ] Log file validation enabled
- [ ] Destination: dedicated encrypted S3 bucket (block public access, optional Object Lock)
- [ ] Optional: CloudWatch Logs delivery for metric filters (unauthorized API calls, console login without MFA)
- [ ] Separate from product-artifact buckets

Example shape (account bootstrap — not a tenant module):

```hcl
# Sketch only — apply from an account/org foundation stack, not templates/tenant.
resource "aws_cloudtrail" "account" {
  name                          = "company-brain-account-trail"
  s3_bucket_name                = aws_s3_bucket.cloudtrail.id
  include_global_service_events = true
  is_multi_region_trail         = true
  enable_log_file_validation    = true
  # is_organization_trail       = true  # when using Organizations
}
```

### 2. GuardDuty

- [ ] Detector enabled in every region used for data-plane hosts (or org auto-enable)
- [ ] Optional: S3 / EKS / malware protection features per org policy
- [ ] Findings can be forwarded by tenant EventBridge rules (`modules/security-observability`) **after** the detector exists

```hcl
# Sketch only — account foundation, not per-tenant.
resource "aws_guardduty_detector" "this" {
  enable = true
}
```

### 3. (Optional) AWS Config

Useful for unauthorized security-group / network changes when full SIEM is not yet available:

| Rule (managed) | Intent |
|----------------|--------|
| `restricted-ssh` / `incoming-ssh-disabled` | Detect open SSH (module already forbids `0.0.0.0/0` in tf vars; Config catches console drift) |
| `vpc-sg-open-only-to-authorized-ports` | Broad open ingress |
| `cloudtrail-enabled` | Trail must stay on |
| `guardduty-enabled-centralized` | Detector posture |

Config recorders and delivery channels are **account-scoped**; document enablement in the account runbook rather than tenant roots.

### 4. Metric filters (CloudTrail → CloudWatch) — sketch

When CloudTrail writes to a log group, common filters:

| Filter | Pattern (illustrative) | Alarm |
|--------|------------------------|-------|
| Unauthorized API | `{ ($.errorCode = "*UnauthorizedOperation") \\|\| ($.errorCode = "AccessDenied*") }` | ≥ 1 in 5m |
| SG / NACL change | `{ ($.eventName = AuthorizeSecurityGroupIngress) \\|\| ($.eventName = RevokeSecurityGroup*) \\|\| ($.eventName = CreateSecurityGroup) \\|\| ($.eventName = DeleteSecurityGroup) }` | ≥ 1 |
| Console login without MFA | `{ ($.eventName = ConsoleLogin) && ($.additionalEventData.MFAUsed != "Yes") }` | ≥ 1 |

Wire alarms to the **ops** SNS topic (account) or per-tenant security SNS from `modules/security-observability`.

---

## Host log shipping (SSM + CloudWatch agent)

### Collected paths (backend-neutral)

When `enable_host_log_shipping=true`, `user_data.sh.tftpl` installs the CloudWatch agent and ships these file globs into the tenant host log group (`host_log_group_name`, default `/company-brain/<project_name>/host`):

| Source path | Stream name | Purpose |
|-------------|-------------|---------|
| `/var/log/secure` | `{instance_id}/secure` | auth / sudo (AL2023 rsyslog) |
| `/var/log/messages` | `{instance_id}/messages` | host syslog |
| `${backend_install_path}/logs/*.log` | `{instance_id}/backend` | backend install-tree file logs |
| `/var/log/company-brain/*.log` | `{instance_id}/company-brain` | deploy / host helper logs |

- **`backend_install_path`** is the effective install root from module locals (`backend_install_path` → legacy `hermes_install_path` → default `/opt/company-brain-backend`). Greenfield: `/opt/company-brain-backend`. Migration hosts may still resolve to `/opt/hermes-lanyard` when only Hermes pins are set.
- **Runtime layout logs** live under `$BACKEND_HOME/logs/` per `contracts/backend-runtime-v1/filesystem-layout.md` (typical greenfield: `/var/lib/company-brain-backend/logs/`). The CW agent config above ships the **install-path** glob that user_data writes; extend `collect_list` (or an SSM-managed agent config) if operators need `$BACKEND_HOME/logs/*.log` as well.
- **Hermes-compatible kinds** set `HERMES_INSTALL_PATH=$BACKEND_INSTALL_PATH` (and `HERMES_HOME=$BACKEND_HOME`) as aliases only. Do not treat `/opt/hermes-lanyard/logs` as the platform primary path in new docs or playbooks.
- **Journal** remains primary for systemd units (`company-brain-backend`, migration `hermes-gateway`); file globs cover backends that also write under the install tree or `/var/log/company-brain/`.

Do **not** ship vault content (`$VAULT_ROOT` / `/opt/company-brain`) by default.

### Path A — Terraform user_data (default when `enable_host_log_shipping=true`)

1. Instance role gets `CloudWatchAgentServerPolicy` (auto when log shipping on).
2. user_data installs `amazon-cloudwatch-agent` and writes the collect list in the table above (see `modules/company-brain-ec2/user_data.sh.tftpl`).
3. Agent starts via `amazon-cloudwatch-agent-ctl`.
4. user_data also `mkdir -p /var/log/company-brain` (mode `755`) so the company-brain stream has a stable directory.

### Path B — SSM (operator)

When SSM core is enabled and the instance is managed:

```bash
# From operator workstation (replace instance id)
aws ssm start-session --target i-REPLACE_ME

# Or push agent config via SSM Association / State Manager (account playbook)
```

`setup.sh` on the host re-applies the agent if the JSON config already exists (`ENSURE_CW_AGENT=1`).

### Network requirements

- Production private subnet: NAT or interface VPC endpoints for `logs`, `ssm`, `ssmmessages`, `ec2messages` as required.
- Concurrent egress/SSM module work: keep flags **default off** until endpoints/egress are ready; then enable per tenant.

---

## Alerts matrix

| Alert | Owner | Implementation |
|-------|--------|----------------|
| EC2 StatusCheckFailed | `company-brain-ec2` | Exists; set `status_alarm_actions` → security SNS |
| GuardDuty finding | EventBridge → SNS | `security-observability` (detector must exist account-wide) |
| Snapshot age / missed DLM | **cbd-zzx.20** | `enable_snapshot_age_alarm` on company-brain-ec2 + `scripts/check-snapshot-age.sh --publish-metric`; SNS via `snapshot_age_monitor_interface` |
| Unauthorized SG change | Account Config / CloudTrail filter | Docs only in this bead |
| Host auth anomalies | CW Logs Insights on host log group | Operator queries; optional metric filters later |

### Snapshot-age interface (cbd-zzx.20)

```text
terraform output -json snapshot_age_monitor_interface
```

Contract fields:

- `project_name_tag` / `dlm_target_tags` — select volumes/snapshots
- `alarm_actions` / `security_sns_topic_arn` — publish to the same tenant security topic
- `metric_namespace` / `metric_name` — `CompanyBrain/Backup` / `NewestSnapshotAgeHours`
- `check_script` / `restore_script` — `scripts/check-snapshot-age.sh`, `scripts/restore-from-snapshot.sh`
- `implement_module` = `modules/company-brain-ec2` (`enable_snapshot_age_alarm`)
- `owner_bead` = `cbd-zzx.20` — do not duplicate SNS topics for backup age

Wire on the host module:

```hcl
enable_snapshot_age_alarm          = true
snapshot_age_alarm_actions         = try(module.security_observability[0].alarm_actions, [])
enable_snapshot_age_check_schedule = true
```

Schedule `scripts/check-snapshot-age.sh --publish-metric` daily (or rely on the EventBridge SNS reminder until a Lambda/SSM runner exists).

---

## Production checklist (tenant + account)

**Tenant stack**

- [ ] `enable_security_observability=true`
- [ ] VPC Flow Logs to CW Logs or S3
- [ ] `enable_host_log_shipping=true` + log group under tenant prefix
- [ ] `enable_ssm_managed_instance_core=true` (or documented break-glass alternative)
- [ ] Status alarm actions → security SNS
- [ ] Optional: `require_observability_checklist=true` with `production_intent=true`

**Account**

- [ ] CloudTrail multi-region + validation
- [ ] GuardDuty detector enabled
- [ ] Optional Config rules for SG drift
- [ ] Ops knows `references/runbooks/security-alert-triage.md`

---

## Validate

```bash
cd modules/security-observability && terraform init -backend=false && terraform validate
cd modules/company-brain-ec2 && terraform init -backend=false && terraform validate
cd templates/tenant && terraform init -backend=false && terraform validate
```

## Non-goals

- Inventing live account IDs or trail/bucket names in git
- Claiming Portal G1/G2 production security from host observability alone
- Implementing full SIEM in this observability doc (snapshot-age metric publisher is `scripts/check-snapshot-age.sh`)
