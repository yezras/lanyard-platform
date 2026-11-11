locals {
  common_tags = merge(
    {
      Name    = "${var.project_name}-security-observability"
      Project = var.project_name
      Role    = "company-brain-security-observability"
    },
    var.extra_tags,
  )

  flow_logs_log_group_name = coalesce(
    var.flow_logs_log_group_name,
    "/company-brain/${var.project_name}/vpc-flow-logs"
  )

  use_cloudwatch_destination = (
    var.enable_vpc_flow_logs
    && var.flow_logs_destination_type == "cloud-watch-logs"
  )

  use_s3_destination = (
    var.enable_vpc_flow_logs
    && var.flow_logs_destination_type == "s3"
  )

  create_sns = var.enable_security_sns_topic && var.alarm_sns_topic_arn == null

  security_sns_topic_arn = (
    var.alarm_sns_topic_arn != null
    ? var.alarm_sns_topic_arn
    : try(aws_sns_topic.security[0].arn, null)
  )

  create_guardduty_bridge = (
    var.enable_guardduty_finding_alerts
    && local.security_sns_topic_arn != null
  )
}

# ---------------------------------------------------------------------------
# VPC Flow Logs → CloudWatch Logs
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "vpc_flow_logs" {
  count = local.use_cloudwatch_destination ? 1 : 0

  name              = local.flow_logs_log_group_name
  retention_in_days = var.flow_logs_retention_days
  tags              = merge(local.common_tags, { Name = "${var.project_name}-vpc-flow-logs" })
}

data "aws_iam_policy_document" "vpc_flow_logs_assume" {
  count = local.use_cloudwatch_destination ? 1 : 0

  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["vpc-flow-logs.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "vpc_flow_logs" {
  count = local.use_cloudwatch_destination ? 1 : 0

  name               = "${var.project_name}-vpc-flow-logs"
  assume_role_policy = data.aws_iam_policy_document.vpc_flow_logs_assume[0].json
  tags               = merge(local.common_tags, { Name = "${var.project_name}-vpc-flow-logs" })
}

data "aws_iam_policy_document" "vpc_flow_logs_write" {
  count = local.use_cloudwatch_destination ? 1 : 0

  statement {
    sid = "AllowCreateLogStreamAndPut"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogGroups",
      "logs:DescribeLogStreams",
    ]
    resources = [
      aws_cloudwatch_log_group.vpc_flow_logs[0].arn,
      "${aws_cloudwatch_log_group.vpc_flow_logs[0].arn}:*",
    ]
  }
}

resource "aws_iam_role_policy" "vpc_flow_logs_write" {
  count = local.use_cloudwatch_destination ? 1 : 0

  name   = "vpc-flow-logs-write"
  role   = aws_iam_role.vpc_flow_logs[0].id
  policy = data.aws_iam_policy_document.vpc_flow_logs_write[0].json
}

resource "aws_flow_log" "vpc_cloudwatch" {
  count = local.use_cloudwatch_destination ? 1 : 0

  vpc_id                   = var.vpc_id
  traffic_type             = var.flow_logs_traffic_type
  log_destination_type     = "cloud-watch-logs"
  log_destination          = aws_cloudwatch_log_group.vpc_flow_logs[0].arn
  iam_role_arn             = aws_iam_role.vpc_flow_logs[0].arn
  max_aggregation_interval = 60

  tags = merge(local.common_tags, { Name = "${var.project_name}-vpc-flow-logs" })

  lifecycle {
    precondition {
      condition     = var.vpc_id != null && var.vpc_id != ""
      error_message = "enable_vpc_flow_logs with cloud-watch-logs requires vpc_id."
    }
  }
}

# ---------------------------------------------------------------------------
# VPC Flow Logs → S3
# ---------------------------------------------------------------------------

resource "aws_flow_log" "vpc_s3" {
  count = local.use_s3_destination ? 1 : 0

  vpc_id                   = var.vpc_id
  traffic_type             = var.flow_logs_traffic_type
  log_destination_type     = "s3"
  log_destination          = var.flow_logs_s3_bucket_arn
  max_aggregation_interval = 60

  tags = merge(local.common_tags, { Name = "${var.project_name}-vpc-flow-logs-s3" })

  lifecycle {
    precondition {
      condition     = var.vpc_id != null && var.vpc_id != ""
      error_message = "enable_vpc_flow_logs with s3 destination requires vpc_id."
    }
    precondition {
      condition     = var.flow_logs_s3_bucket_arn != null && var.flow_logs_s3_bucket_arn != ""
      error_message = "flow_logs_destination_type=s3 requires flow_logs_s3_bucket_arn."
    }
  }
}

# ---------------------------------------------------------------------------
# Security SNS topic
# ---------------------------------------------------------------------------

resource "aws_sns_topic" "security" {
  count = local.create_sns ? 1 : 0

  name = "${var.project_name}-security-alerts"
  tags = merge(local.common_tags, { Name = "${var.project_name}-security-alerts" })
}

resource "aws_sns_topic_subscription" "security_email" {
  for_each = local.create_sns ? toset(var.security_alert_email_endpoints) : toset([])

  topic_arn = aws_sns_topic.security[0].arn
  protocol  = "email"
  endpoint  = each.value
}

# ---------------------------------------------------------------------------
# GuardDuty findings → SNS (EventBridge). GuardDuty enablement is account-level.
# Severity filtering for multi-band OR is operator triage (SNS noise is acceptable
# for HIGH/CRITICAL-focused accounts; see guardduty_finding_severities docs + runbook).
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_event_rule" "guardduty_findings_all" {
  count = local.create_guardduty_bridge ? 1 : 0

  name        = "${var.project_name}-gd-findings"
  description = "Forward GuardDuty findings to security SNS (${var.project_name}). Target severities (ops filter): ${join(",", var.guardduty_finding_severities)}. See security-alert-triage runbook."

  event_pattern = jsonencode({
    source      = ["aws.guardduty"]
    detail-type = ["GuardDuty Finding"]
  })

  tags = merge(local.common_tags, { Name = "${var.project_name}-gd-findings" })
}

resource "aws_cloudwatch_event_target" "guardduty_to_sns" {
  count = local.create_guardduty_bridge ? 1 : 0

  rule      = aws_cloudwatch_event_rule.guardduty_findings_all[0].name
  target_id = "security-sns"
  arn       = local.security_sns_topic_arn
}

data "aws_caller_identity" "current" {
  count = local.create_sns ? 1 : 0
}

data "aws_iam_policy_document" "sns_security" {
  count = local.create_sns ? 1 : 0

  # Account owner (CloudWatch alarms, operators) may publish.
  statement {
    sid    = "AllowAccountPublish"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current[0].account_id}:root"]
    }
    actions   = ["sns:Publish", "sns:Subscribe", "sns:Receive", "sns:GetTopicAttributes"]
    resources = [aws_sns_topic.security[0].arn]
  }

  dynamic "statement" {
    for_each = local.create_guardduty_bridge ? [1] : []
    content {
      sid    = "AllowEventBridgePublish"
      effect = "Allow"
      principals {
        type        = "Service"
        identifiers = ["events.amazonaws.com"]
      }
      actions   = ["sns:Publish"]
      resources = [aws_sns_topic.security[0].arn]

      condition {
        test     = "ArnEquals"
        variable = "aws:SourceArn"
        values   = [aws_cloudwatch_event_rule.guardduty_findings_all[0].arn]
      }
    }
  }

  # company-brain-ec2 optional rule: ${project_name}-snapshot-age-check (cbd-zzx.20)
  dynamic "statement" {
    for_each = var.snapshot_age_monitor_enabled ? [1] : []
    content {
      sid    = "AllowEventBridgeSnapshotAgeCheck"
      effect = "Allow"
      principals {
        type        = "Service"
        identifiers = ["events.amazonaws.com"]
      }
      actions   = ["sns:Publish"]
      resources = [aws_sns_topic.security[0].arn]

      condition {
        test     = "ArnLike"
        variable = "aws:SourceArn"
        values = [
          "arn:aws:events:*:${data.aws_caller_identity.current[0].account_id}:rule/${var.project_name}-snapshot-age-check",
        ]
      }
    }
  }
}

resource "aws_sns_topic_policy" "security" {
  count = local.create_sns ? 1 : 0

  arn    = aws_sns_topic.security[0].arn
  policy = data.aws_iam_policy_document.sns_security[0].json
}
