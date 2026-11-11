output "vpc_flow_log_id" {
  description = "VPC Flow Log ID (null when disabled)."
  value = coalesce(
    try(aws_flow_log.vpc_cloudwatch[0].id, null),
    try(aws_flow_log.vpc_s3[0].id, null),
  )
}

output "vpc_flow_logs_log_group_name" {
  description = "CloudWatch log group for Flow Logs (null when S3 destination or disabled)."
  value       = try(aws_cloudwatch_log_group.vpc_flow_logs[0].name, null)
}

output "vpc_flow_logs_log_group_arn" {
  description = "CloudWatch log group ARN for Flow Logs (null when S3 destination or disabled)."
  value       = try(aws_cloudwatch_log_group.vpc_flow_logs[0].arn, null)
}

output "security_sns_topic_arn" {
  description = "SNS topic ARN for security alerts (created or passed-in). Wire to company-brain-ec2 status_alarm_actions."
  value       = local.security_sns_topic_arn
}

output "security_sns_topic_name" {
  description = "SNS topic name when created by this module (null if external topic used)."
  value       = try(aws_sns_topic.security[0].name, null)
}

output "guardduty_event_rule_name" {
  description = "EventBridge rule name for GuardDuty findings (null when bridge disabled)."
  value       = try(aws_cloudwatch_event_rule.guardduty_findings_all[0].name, null)
}

output "alarm_actions" {
  description = "List of ARNs suitable for CloudWatch alarm_actions (empty if no SNS)."
  value       = local.security_sns_topic_arn != null ? [local.security_sns_topic_arn] : []
}

output "snapshot_age_monitor_interface" {
  description = <<-EOT
    Contract for snapshot-age monitoring (cbd-zzx.20 / backup monitoring).
    SNS/tag interface lives here; metric alarm + EventBridge reminder live in
    modules/company-brain-ec2 (enable_snapshot_age_alarm) with scripts/check-snapshot-age.sh.
    Consumers should:
      - Select DLM snapshots / volumes with tags Project=<project_name> and Backup=daily
      - Wire company-brain-ec2 snapshot_age_alarm_actions → alarm_actions (this output)
      - Keep a single SNS topic per tenant for status + snapshot-age + security events
  EOT
  value = {
    enabled                = var.snapshot_age_monitor_enabled
    project_name_tag       = var.project_name
    volume_backup_tag      = "daily"
    dlm_target_tags        = { Backup = "daily", Project = var.project_name }
    alarm_actions          = local.security_sns_topic_arn != null ? [local.security_sns_topic_arn] : []
    security_sns_topic_arn = local.security_sns_topic_arn
    owner_bead             = "cbd-zzx.20"
    metric_namespace       = "CompanyBrain/Backup"
    metric_name            = "NewestSnapshotAgeHours"
    check_script           = "scripts/check-snapshot-age.sh"
    restore_script         = "scripts/restore-from-snapshot.sh"
    implement_module       = "modules/company-brain-ec2"
    note                   = "Enable enable_snapshot_age_alarm on company-brain-ec2 and schedule check-snapshot-age.sh --publish-metric; do not create a second SNS topic."
  }
}

output "observability_summary" {
  description = "Non-secret summary of enabled observability controls."
  value = {
    vpc_flow_logs_enabled          = var.enable_vpc_flow_logs
    flow_logs_destination_type     = var.enable_vpc_flow_logs ? var.flow_logs_destination_type : null
    security_sns_configured        = local.security_sns_topic_arn != null
    guardduty_finding_alerts       = local.create_guardduty_bridge
    snapshot_age_interface_enabled = var.snapshot_age_monitor_enabled
    # Account-level services are documented, not created here:
    cloudtrail_in_module         = false
    guardduty_detector_in_module = false
  }
}
