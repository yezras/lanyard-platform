# Security observability (tenant-scoped)

Optional Terraform for **per-tenant** security observability that pairs with `modules/company-brain-ec2`.

| In module (tenant/VPC stack) | Account / org scoped (document only) |
|------------------------------|--------------------------------------|
| VPC Flow Logs (CW Logs or S3) | CloudTrail (org/account trail) |
| Security SNS topic | GuardDuty detector enablement |
| EventBridge → SNS for GuardDuty *findings* | AWS Config rules (optional) |
| Snapshot-age **interface** (tags + SNS + EventBridge policy for check rule) | Snapshot-age **alarms** in `company-brain-ec2` + `scripts/check-snapshot-age.sh` |

## Layout

| Path | Purpose |
|------|---------|
| `main.tf` | Flow Logs, SNS, GuardDuty findings EventBridge bridge |
| `variables.tf` | Feature flags, destinations, severity/retention |
| `outputs.tf` | Flow log IDs, SNS ARN, `alarm_actions`, snapshot-age interface |
| `versions.tf` | Terraform ≥ 1.7, AWS provider ~> 5.0 |
| `terraform.tfvars.example` | Placeholder-only examples |

## Usage (tenant root)

```hcl
module "security_observability" {
  source = "../../modules/security-observability"
  count  = var.enable_security_observability ? 1 : 0

  project_name = local.project_name
  vpc_id       = var.vpc_id

  enable_vpc_flow_logs           = true
  enable_security_sns_topic      = true
  enable_guardduty_finding_alerts = true
  # security_alert_email_endpoints = ["ops@example.com"]  # private tfvars only
}

module "company_brain" {
  source = "../../modules/company-brain-ec2"
  # ...
  status_alarm_actions = try(module.security_observability[0].alarm_actions, [])
  enable_host_log_shipping       = var.enable_host_log_shipping
  enable_ssm_managed_instance_core = var.enable_ssm_managed_instance_core
  enable_cloudwatch_agent_iam    = var.enable_cloudwatch_agent_iam
  host_log_group_name            = "${var.log_group_prefix}/host"
}
```

## Doctrine

- No live account IDs, customer emails, or real bucket names in git examples.
- CloudTrail / GuardDuty **detectors** stay account-level — do not recreate per tenant stack.
- Snapshot-age: use `snapshot_age_monitor_interface` for SNS/tags; enable `enable_snapshot_age_alarm` on company-brain-ec2 and schedule `scripts/check-snapshot-age.sh --publish-metric` — not a second SNS topic.

## Validate

```bash
cd modules/security-observability
terraform init -backend=false
terraform validate
```

## Related

- `references/security-observability.md` — checklist + account-level patterns
- `references/runbooks/security-alert-triage.md` — operator response
- `modules/company-brain-ec2` — host log shipping, status alarm, SSM IAM
