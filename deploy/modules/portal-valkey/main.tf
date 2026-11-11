locals {
  common_tags = merge(
    {
      Project     = "company-brain-deploy"
      Component   = "portal-valkey"
      Environment = var.environment
      ManagedBy   = "terraform"
      Role        = "portal-shared-state"
    },
    var.tags,
  )

  # ElastiCache replication_group_id max 40 chars; lowercase + hyphens only.
  identifier = substr(replace(var.name_prefix, "_", "-"), 0, 40)

  redis_url_secret_name = coalesce(
    var.redis_url_secret_name,
    "${var.name_prefix}/portal/redis-url"
  )

  ssm_parameter_name = coalesce(
    var.ssm_parameter_name,
    "/company-brain/${var.name_prefix}/portal-redis-url-secret-arn"
  )

  final_snapshot_identifier = coalesce(
    var.final_snapshot_identifier,
    "${local.identifier}-final"
  )

  engine_major = split(".", var.engine_version)[0]

  parameter_group_family = "${var.engine}${local.engine_major}"

  # Product env contract (Portal G5/G6): REDIS_URL with TLS (rediss://).
  # Full URL lives only in Secrets Manager — never as a plain Terraform output value.
  redis_url = format(
    "rediss://:%s@%s:%s",
    urlencode(random_password.auth_token.result),
    aws_elasticache_replication_group.portal.primary_endpoint_address,
    tostring(aws_elasticache_replication_group.portal.port),
  )

  # Non-secret connection shape for docs/operators (auth token redacted).
  redis_url_shape = format(
    "rediss://:***@%s:%s",
    aws_elasticache_replication_group.portal.primary_endpoint_address,
    tostring(aws_elasticache_replication_group.portal.port),
  )
}

# ---------------------------------------------------------------------------
# Fail-closed checks (plan-time when credentials + data sources resolve)
# ---------------------------------------------------------------------------

check "acknowledge_not_auto_applied" {
  assert {
    condition     = var.acknowledge_not_auto_applied == true
    error_message = "acknowledge_not_auto_applied must be true before planning portal-valkey."
  }
}

check "require_tls" {
  assert {
    condition     = var.transit_encryption_enabled == true
    error_message = "transit_encryption_enabled must be true (TLS / rediss:// only)."
  }
}

check "require_at_rest_encryption" {
  assert {
    condition     = var.at_rest_encryption_enabled == true
    error_message = "at_rest_encryption_enabled must be true."
  }
}

check "require_private_ingress_sources" {
  assert {
    condition     = length(var.allowed_security_group_ids) > 0 || length(var.allowed_cidr_blocks) > 0
    error_message = "Provide at least one allowed_security_group_ids or allowed_cidr_blocks entry (private sources only; 0.0.0.0/0 rejected)."
  }
}

check "ha_requires_multiple_nodes" {
  assert {
    condition = (
      (!var.multi_az_enabled && !var.automatic_failover_enabled)
      || var.num_cache_clusters >= 2
    )
    error_message = "multi_az_enabled or automatic_failover_enabled requires num_cache_clusters >= 2 (staging single-node: set both HA flags false)."
  }
}

check "multi_az_requires_failover" {
  assert {
    condition     = !var.multi_az_enabled || var.automatic_failover_enabled
    error_message = "multi_az_enabled=true requires automatic_failover_enabled=true."
  }
}

data "aws_subnet" "selected" {
  for_each = toset(var.subnet_ids)
  id       = each.value
}

check "subnets_are_private" {
  assert {
    condition = alltrue([
      for s in data.aws_subnet.selected : s.map_public_ip_on_launch == false
    ])
    error_message = "All subnet_ids must be private (map_public_ip_on_launch=false). Public subnets are rejected for portal-valkey."
  }
}

check "subnets_in_vpc" {
  assert {
    condition = alltrue([
      for s in data.aws_subnet.selected : s.vpc_id == var.vpc_id
    ])
    error_message = "All subnet_ids must belong to vpc_id."
  }
}

# ---------------------------------------------------------------------------
# Credentials — generated; never accepted via tfvars
# ---------------------------------------------------------------------------

resource "random_password" "auth_token" {
  # ElastiCache AUTH token: 16–128 printable ASCII; no / " @ or space.
  length           = 32
  special          = true
  override_special = "!&#$^<>-"
  min_lower        = 4
  min_upper        = 4
  min_numeric      = 4
  min_special      = 2
}

# ---------------------------------------------------------------------------
# Networking
# ---------------------------------------------------------------------------

resource "aws_elasticache_subnet_group" "portal" {
  name       = "${local.identifier}-cache-subnets"
  subnet_ids = var.subnet_ids
  tags = merge(local.common_tags, {
    Name = "${local.identifier}-cache-subnets"
  })
}

resource "aws_security_group" "portal_valkey" {
  name        = "${local.identifier}-valkey"
  description = "Private Valkey/Redis for Portal shared state (${var.name_prefix})"
  vpc_id      = var.vpc_id

  tags = merge(local.common_tags, {
    Name = "${local.identifier}-valkey"
  })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "valkey_from_sg" {
  for_each = toset(var.allowed_security_group_ids)

  security_group_id            = aws_security_group.portal_valkey.id
  description                  = "Valkey/Redis from allowed BFF/relay (or other client) SG"
  ip_protocol                  = "tcp"
  from_port                    = var.port
  to_port                      = var.port
  referenced_security_group_id = each.value
}

resource "aws_vpc_security_group_ingress_rule" "valkey_from_cidr" {
  for_each = toset(var.allowed_cidr_blocks)

  security_group_id = aws_security_group.portal_valkey.id
  description       = "Valkey/Redis from private CIDR (not 0.0.0.0/0)"
  ip_protocol       = "tcp"
  from_port         = var.port
  to_port           = var.port
  cidr_ipv4         = each.value
}

resource "aws_vpc_security_group_egress_rule" "valkey_egress_all" {
  # Managed cache replies; keep consumers narrow inbound.
  security_group_id = aws_security_group.portal_valkey.id
  description       = "Allow egress for managed ElastiCache (inbound is the control plane)"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# ---------------------------------------------------------------------------
# Parameter group (TLS-friendly defaults when not caller-supplied)
# ---------------------------------------------------------------------------

resource "aws_elasticache_parameter_group" "portal" {
  count = var.parameter_group_name == null ? 1 : 0

  name        = "${local.identifier}-${var.engine}${local.engine_major}"
  family      = local.parameter_group_family
  description = "Portal Valkey/Redis parameters for ${var.name_prefix}"

  tags = merge(local.common_tags, {
    Name = "${local.identifier}-${var.engine}${local.engine_major}"
  })
}

# ---------------------------------------------------------------------------
# CloudWatch log groups (optional slow / engine logs)
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "slow" {
  count = var.enable_slow_log ? 1 : 0

  name              = "/aws/elasticache/${local.identifier}/slow-log"
  retention_in_days = var.log_retention_in_days
  kms_key_id        = var.kms_key_id

  tags = merge(local.common_tags, {
    Name = "${local.identifier}-slow-log"
  })
}

resource "aws_cloudwatch_log_group" "engine" {
  count = var.enable_engine_log ? 1 : 0

  name              = "/aws/elasticache/${local.identifier}/engine-log"
  retention_in_days = var.log_retention_in_days
  kms_key_id        = var.kms_key_id

  tags = merge(local.common_tags, {
    Name = "${local.identifier}-engine-log"
  })
}

# ---------------------------------------------------------------------------
# ElastiCache replication group — private, TLS, at-rest encrypted, AUTH
# ---------------------------------------------------------------------------

resource "aws_elasticache_replication_group" "portal" {
  replication_group_id = local.identifier
  description          = "Portal shared state Valkey/Redis (${var.name_prefix})"

  engine             = var.engine
  engine_version     = var.engine_version
  node_type          = var.node_type
  num_cache_clusters = var.num_cache_clusters
  port               = var.port
  parameter_group_name = (
    var.parameter_group_name != null
    ? var.parameter_group_name
    : aws_elasticache_parameter_group.portal[0].name
  )

  subnet_group_name  = aws_elasticache_subnet_group.portal.name
  security_group_ids = [aws_security_group.portal_valkey.id]

  # Fail-closed: always encrypt at rest and in transit; AUTH required with TLS.
  at_rest_encryption_enabled = true
  kms_key_id                 = var.kms_key_id
  transit_encryption_enabled = true
  transit_encryption_mode    = "required"
  auth_token                 = random_password.auth_token.result
  auth_token_update_strategy = "ROTATE"

  multi_az_enabled           = var.multi_az_enabled
  automatic_failover_enabled = var.automatic_failover_enabled

  snapshot_retention_limit = var.snapshot_retention_limit
  snapshot_window          = var.snapshot_retention_limit > 0 ? var.snapshot_window : null
  maintenance_window       = var.maintenance_window
  final_snapshot_identifier = (
    var.snapshot_retention_limit > 0
    ? local.final_snapshot_identifier
    : null
  )

  auto_minor_version_upgrade = var.auto_minor_version_upgrade
  apply_immediately          = var.apply_immediately

  dynamic "log_delivery_configuration" {
    for_each = var.enable_slow_log ? [1] : []
    content {
      destination      = aws_cloudwatch_log_group.slow[0].name
      destination_type = "cloudwatch-logs"
      log_format       = "json"
      log_type         = "slow-log"
    }
  }

  dynamic "log_delivery_configuration" {
    for_each = var.enable_engine_log ? [1] : []
    content {
      destination      = aws_cloudwatch_log_group.engine[0].name
      destination_type = "cloudwatch-logs"
      log_format       = "json"
      log_type         = "engine-log"
    }
  }

  tags = merge(local.common_tags, {
    Name = local.identifier
  })

  lifecycle {
    precondition {
      condition     = var.transit_encryption_enabled == true
      error_message = "transit_encryption_enabled must be true."
    }
    precondition {
      condition     = var.at_rest_encryption_enabled == true
      error_message = "at_rest_encryption_enabled must be true."
    }
    precondition {
      condition     = length(var.subnet_ids) >= 2
      error_message = "subnet_ids requires at least two private subnets."
    }
    precondition {
      condition = (
        (!var.multi_az_enabled && !var.automatic_failover_enabled)
        || var.num_cache_clusters >= 2
      )
      error_message = "HA flags require num_cache_clusters >= 2."
    }
  }
}

# ---------------------------------------------------------------------------
# Secrets Manager — REDIS_URL payload (no auth token in outputs)
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "redis_url" {
  name                    = local.redis_url_secret_name
  description             = "Portal REDIS_URL payload (rediss:// TLS) for ${var.name_prefix}"
  recovery_window_in_days = var.secret_recovery_window_in_days
  kms_key_id              = var.kms_key_id

  tags = merge(local.common_tags, {
    Name    = local.redis_url_secret_name
    Purpose = "REDIS_URL"
  })
}

resource "aws_secretsmanager_secret_version" "redis_url" {
  secret_id = aws_secretsmanager_secret.redis_url.id
  secret_string = jsonencode({
    engine     = var.engine
    host       = aws_elasticache_replication_group.portal.primary_endpoint_address
    port       = aws_elasticache_replication_group.portal.port
    auth_token = random_password.auth_token.result
    tls        = true
    url        = local.redis_url
    REDIS_URL  = local.redis_url
  })
}

resource "aws_ssm_parameter" "redis_url_secret_arn" {
  count = var.create_ssm_parameter_pointer ? 1 : 0

  name        = local.ssm_parameter_name
  description = "ARN of Secrets Manager secret holding REDIS_URL (not the auth token itself)"
  type        = "String"
  value       = aws_secretsmanager_secret.redis_url.arn
  tier        = "Standard"

  tags = merge(local.common_tags, {
    Name    = local.ssm_parameter_name
    Purpose = "REDIS_URL_SECRET_ARN"
  })
}

# ---------------------------------------------------------------------------
# CloudWatch alarms (optional)
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "cpu" {
  count = var.create_cloudwatch_alarms ? 1 : 0

  alarm_name          = "${local.identifier}-cpu"
  alarm_description   = "Portal Valkey CPUUtilization high (${var.name_prefix})"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = var.alarm_evaluation_periods
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ElastiCache"
  period              = var.alarm_period_seconds
  statistic           = "Average"
  threshold           = var.cpu_alarm_threshold
  treat_missing_data  = "notBreaching"

  dimensions = {
    ReplicationGroupId = aws_elasticache_replication_group.portal.id
  }

  alarm_actions = var.alarm_sns_topic_arns
  ok_actions    = var.alarm_sns_topic_arns

  tags = merge(local.common_tags, {
    Name = "${local.identifier}-cpu"
  })
}

resource "aws_cloudwatch_metric_alarm" "memory" {
  count = var.create_cloudwatch_alarms ? 1 : 0

  alarm_name          = "${local.identifier}-memory"
  alarm_description   = "Portal Valkey DatabaseMemoryUsagePercentage high (${var.name_prefix})"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = var.alarm_evaluation_periods
  metric_name         = "DatabaseMemoryUsagePercentage"
  namespace           = "AWS/ElastiCache"
  period              = var.alarm_period_seconds
  statistic           = "Average"
  threshold           = var.memory_alarm_threshold
  treat_missing_data  = "notBreaching"

  dimensions = {
    ReplicationGroupId = aws_elasticache_replication_group.portal.id
  }

  alarm_actions = var.alarm_sns_topic_arns
  ok_actions    = var.alarm_sns_topic_arns

  tags = merge(local.common_tags, {
    Name = "${local.identifier}-memory"
  })
}

resource "aws_cloudwatch_metric_alarm" "evictions" {
  count = var.create_cloudwatch_alarms ? 1 : 0

  alarm_name          = "${local.identifier}-evictions"
  alarm_description   = "Portal Valkey Evictions elevated (${var.name_prefix})"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = var.alarm_evaluation_periods
  metric_name         = "Evictions"
  namespace           = "AWS/ElastiCache"
  period              = var.alarm_period_seconds
  statistic           = "Sum"
  threshold           = var.evictions_alarm_threshold
  treat_missing_data  = "notBreaching"

  dimensions = {
    ReplicationGroupId = aws_elasticache_replication_group.portal.id
  }

  alarm_actions = var.alarm_sns_topic_arns
  ok_actions    = var.alarm_sns_topic_arns

  tags = merge(local.common_tags, {
    Name = "${local.identifier}-evictions"
  })
}
