variable "project_name" {
  description = "Short name used for AWS resource names and tags (must match company-brain-ec2 project_name for log/backup partition)."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$", var.project_name))
    error_message = "project_name must be 3–50 chars, lowercase alphanumeric and hyphens, start/end alphanumeric."
  }
}

variable "vpc_id" {
  description = "VPC ID to attach Flow Logs. Required when enable_vpc_flow_logs is true."
  type        = string
  default     = null
}

# ---------------------------------------------------------------------------
# VPC Flow Logs (tenant/VPC-scoped — safe in per-tenant stacks)
# ---------------------------------------------------------------------------

variable "enable_vpc_flow_logs" {
  description = "Create VPC Flow Logs for vpc_id (CloudWatch Logs or S3 destination)."
  type        = bool
  default     = true
}

variable "flow_logs_destination_type" {
  description = "Flow Logs destination: cloud-watch-logs or s3."
  type        = string
  default     = "cloud-watch-logs"

  validation {
    condition     = contains(["cloud-watch-logs", "s3"], var.flow_logs_destination_type)
    error_message = "flow_logs_destination_type must be cloud-watch-logs or s3."
  }
}

variable "flow_logs_s3_bucket_arn" {
  description = "S3 bucket ARN for Flow Logs when flow_logs_destination_type=s3 (e.g. arn:aws:s3:::example-flow-logs). Do not invent live account buckets in git."
  type        = string
  default     = null

  validation {
    condition = (
      var.flow_logs_s3_bucket_arn == null
      || can(regex("^arn:aws:s3:::[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.flow_logs_s3_bucket_arn))
    )
    error_message = "flow_logs_s3_bucket_arn must be null or an arn:aws:s3:::bucket-name ARN."
  }
}

variable "flow_logs_traffic_type" {
  description = "VPC Flow Logs traffic type: ALL, ACCEPT, or REJECT."
  type        = string
  default     = "ALL"

  validation {
    condition     = contains(["ALL", "ACCEPT", "REJECT"], var.flow_logs_traffic_type)
    error_message = "flow_logs_traffic_type must be ALL, ACCEPT, or REJECT."
  }
}

variable "flow_logs_log_group_name" {
  description = "CloudWatch log group for Flow Logs. Default: /company-brain/<project_name>/vpc-flow-logs."
  type        = string
  default     = null
}

variable "flow_logs_retention_days" {
  description = "Retention in days for the Flow Logs CloudWatch log group (ignored for S3 destination)."
  type        = number
  default     = 30

  validation {
    condition = contains(
      [1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653],
      var.flow_logs_retention_days
    )
    error_message = "flow_logs_retention_days must be a valid CloudWatch Logs retention value."
  }
}

# ---------------------------------------------------------------------------
# Security alerts SNS + GuardDuty findings bridge (regional EventBridge)
# ---------------------------------------------------------------------------

variable "enable_security_sns_topic" {
  description = "Create an SNS topic for security/ops alarms (status check, GuardDuty bridge, future snapshot-age)."
  type        = bool
  default     = true
}

variable "security_alert_email_endpoints" {
  description = "Optional email subscriptions for the security SNS topic (confirm via email). Prefer empty in git; set in private tfvars."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for e in var.security_alert_email_endpoints : can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", e))
    ])
    error_message = "security_alert_email_endpoints must be valid email addresses when set."
  }
}

variable "enable_guardduty_finding_alerts" {
  description = <<-EOT
    Create an EventBridge rule that forwards GuardDuty findings to the security SNS topic.
    Does NOT enable GuardDuty itself — that is account/org-scoped (see references/security-observability.md).
    Requires enable_security_sns_topic=true (or alarm_sns_topic_arn).
  EOT
  type        = bool
  default     = true
}

variable "guardduty_finding_severities" {
  description = "GuardDuty severity labels to alert on (LOW, MEDIUM, HIGH, CRITICAL). Default HIGH+CRITICAL."
  type        = list(string)
  default     = ["HIGH", "CRITICAL"]

  validation {
    condition = alltrue([
      for s in var.guardduty_finding_severities : contains(["LOW", "MEDIUM", "HIGH", "CRITICAL"], s)
    ])
    error_message = "guardduty_finding_severities entries must be LOW, MEDIUM, HIGH, or CRITICAL."
  }
}

variable "alarm_sns_topic_arn" {
  description = "Optional existing SNS topic ARN for alerts. When null and enable_security_sns_topic=true, this module creates one."
  type        = string
  default     = null
}

# ---------------------------------------------------------------------------
# Snapshot-age monitor interface (cbd-zzx.20 overlap)
# ---------------------------------------------------------------------------

variable "snapshot_age_monitor_enabled" {
  description = <<-EOT
    Declare intent that snapshot-age monitoring is in scope for this tenant.
    This module publishes the tag/SNS contract (and SNS topic policy for
    EventBridge rule named <project_name>-snapshot-age-check). Metric alarm + schedule
    resources live in modules/company-brain-ec2 (enable_snapshot_age_alarm) with
    scripts/check-snapshot-age.sh — do not invent a second SNS topic.
  EOT
  type        = bool
  default     = true
}

variable "extra_tags" {
  description = "Additional tags applied to all taggable resources."
  type        = map(string)
  default     = {}
}
