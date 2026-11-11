locals {
  common_tags = merge(
    {
      Project     = "company-brain-deploy"
      Component   = "control-plane-rds"
      Environment = var.environment
      ManagedBy   = "terraform"
      Role        = "control-plane-postgres"
    },
    var.tags,
  )

  identifier = substr(replace(var.name_prefix, "_", "-"), 0, 60)

  database_url_secret_name = coalesce(
    var.database_url_secret_name,
    "${var.name_prefix}/control-plane/database-url"
  )

  ssm_parameter_name = coalesce(
    var.ssm_parameter_name,
    "/company-brain/${var.name_prefix}/control-plane-database-url-secret-arn"
  )

  final_snapshot_identifier = (
    var.skip_final_snapshot
    ? null
    : coalesce(var.final_snapshot_identifier, "${local.identifier}-final")
  )

  # Product env contract (Portal G4.1): CONTROL_PLANE_DATABASE_URL or DATABASE_URL.
  # Full URL lives only in Secrets Manager — never as a plain Terraform output value
  # that docs would encourage logging. Shape documented in outputs.
  # TLS for rds.force_ssl=1. uselibpqcompat=true keeps node-pg sslmode=require as
  # encrypt-only (not verify-full); verify-full fails on the RDS CA chain without a
  # bundled Amazon root (pg-connection-string v2 warning / v3 migration).
  database_url = format(
    "postgresql://%s:%s@%s:%s/%s?uselibpqcompat=true&sslmode=require",
    var.master_username,
    urlencode(random_password.master.result),
    aws_db_instance.control_plane.address,
    tostring(aws_db_instance.control_plane.port),
    var.db_name,
  )

  # Non-secret connection shape for docs/operators (password redacted).
  database_url_shape = format(
    "postgresql://%s:***@%s:%s/%s?uselibpqcompat=true&sslmode=require",
    var.master_username,
    aws_db_instance.control_plane.address,
    tostring(aws_db_instance.control_plane.port),
    var.db_name,
  )
}

# ---------------------------------------------------------------------------
# Fail-closed checks (plan-time when credentials + data sources resolve)
# ---------------------------------------------------------------------------

check "acknowledge_not_auto_applied" {
  assert {
    condition     = var.acknowledge_not_auto_applied == true
    error_message = "acknowledge_not_auto_applied must be true before planning control-plane RDS."
  }
}

check "reject_public_rds" {
  assert {
    condition     = var.publicly_accessible == false
    error_message = "publicly_accessible must be false (private-subnet control-plane RDS only)."
  }
}

check "require_private_ingress_sources" {
  assert {
    condition     = length(var.allowed_security_group_ids) > 0 || length(var.allowed_cidr_blocks) > 0
    error_message = "Provide at least one allowed_security_group_ids or allowed_cidr_blocks entry (private sources only; 0.0.0.0/0 rejected)."
  }
}

check "lab_destroy_pair" {
  assert {
    condition     = !var.skip_final_snapshot || var.deletion_protection == false
    error_message = "skip_final_snapshot=true requires deletion_protection=false (lab destroy pair only)."
  }
}

check "max_allocated_storage_ceiling" {
  assert {
    condition     = var.max_allocated_storage == 0 || var.max_allocated_storage >= var.allocated_storage
    error_message = "max_allocated_storage must be 0 or >= allocated_storage."
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
    error_message = "All subnet_ids must be private (map_public_ip_on_launch=false). Public subnets are rejected for control-plane RDS."
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

resource "random_password" "master" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
  # Avoid characters that break URL embedding awkwardly even with urlencode.
  min_lower   = 4
  min_upper   = 4
  min_numeric = 4
  min_special = 2
}

# ---------------------------------------------------------------------------
# Networking
# ---------------------------------------------------------------------------

resource "aws_db_subnet_group" "control_plane" {
  name       = "${local.identifier}-db-subnets"
  subnet_ids = var.subnet_ids
  tags = merge(local.common_tags, {
    Name = "${local.identifier}-db-subnets"
  })
}

resource "aws_security_group" "control_plane_db" {
  name        = "${local.identifier}-db"
  description = "Private Postgres for control-plane RDS (${var.name_prefix})"
  vpc_id      = var.vpc_id

  tags = merge(local.common_tags, {
    Name = "${local.identifier}-db"
  })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "postgres_from_sg" {
  for_each = toset(var.allowed_security_group_ids)

  security_group_id            = aws_security_group.control_plane_db.id
  description                  = "Postgres from allowed control-plane / private consumer SG"
  ip_protocol                  = "tcp"
  from_port                    = var.port
  to_port                      = var.port
  referenced_security_group_id = each.value
}

resource "aws_vpc_security_group_ingress_rule" "postgres_from_cidr" {
  for_each = toset(var.allowed_cidr_blocks)

  security_group_id = aws_security_group.control_plane_db.id
  description       = "Postgres from private CIDR (not 0.0.0.0/0)"
  ip_protocol       = "tcp"
  from_port         = var.port
  to_port           = var.port
  cidr_ipv4         = each.value
}

resource "aws_vpc_security_group_egress_rule" "db_egress_vpc_dns_only" {
  # RDS does not need broad egress; keep a minimal rule for VPC-local responses.
  security_group_id = aws_security_group.control_plane_db.id
  description       = "Allow all egress within typical VPC use (RDS managed; keep narrow consumers inbound)"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# ---------------------------------------------------------------------------
# RDS PostgreSQL — private, encrypted, backed up
# ---------------------------------------------------------------------------

resource "aws_db_instance" "control_plane" {
  identifier = local.identifier

  engine               = "postgres"
  engine_version       = var.engine_version
  instance_class       = var.instance_class
  port                 = var.port
  db_name              = var.db_name
  username             = var.master_username
  password             = random_password.master.result
  parameter_group_name = aws_db_parameter_group.control_plane.name

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage > 0 ? var.max_allocated_storage : null
  storage_type          = var.storage_type
  storage_encrypted     = true
  kms_key_id            = var.kms_key_id

  db_subnet_group_name   = aws_db_subnet_group.control_plane.name
  vpc_security_group_ids = [aws_security_group.control_plane_db.id]
  # Fail-closed: never public. Variable is validated false; resource hardcodes false.
  publicly_accessible = false
  multi_az            = var.multi_az
  availability_zone   = null

  backup_retention_period   = var.backup_retention_period
  backup_window             = var.backup_window
  maintenance_window        = var.maintenance_window
  copy_tags_to_snapshot     = true
  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = var.skip_final_snapshot
  final_snapshot_identifier = local.final_snapshot_identifier

  auto_minor_version_upgrade = var.auto_minor_version_upgrade
  apply_immediately          = var.apply_immediately

  performance_insights_enabled          = var.performance_insights_enabled
  performance_insights_retention_period = var.performance_insights_enabled ? var.performance_insights_retention_period : null
  performance_insights_kms_key_id       = var.performance_insights_enabled ? var.kms_key_id : null

  enabled_cloudwatch_logs_exports = var.enabled_cloudwatch_logs_exports

  # Prefer IAM auth later; product currently expects password URL (CONTROL_PLANE_DATABASE_URL).
  iam_database_authentication_enabled = false

  tags = merge(local.common_tags, {
    Name = local.identifier
  })

  lifecycle {
    precondition {
      condition     = var.publicly_accessible == false
      error_message = "publicly_accessible must be false."
    }
    precondition {
      condition     = length(var.subnet_ids) >= 2
      error_message = "subnet_ids requires at least two private subnets."
    }
  }
}

resource "aws_db_parameter_group" "control_plane" {
  name        = "${local.identifier}-pg"
  family      = "postgres${split(".", var.engine_version)[0]}"
  description = "Control-plane Postgres parameters for ${var.name_prefix}"

  # Force SSL for clients. local.database_url always includes ?sslmode=require.
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  tags = merge(local.common_tags, {
    Name = "${local.identifier}-pg"
  })
}

# ---------------------------------------------------------------------------
# Secrets Manager — CONTROL_PLANE_DATABASE_URL payload (no password in outputs)
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "database_url" {
  name                    = local.database_url_secret_name
  description             = "Control-plane CONTROL_PLANE_DATABASE_URL / DATABASE_URL payload for ${var.name_prefix}"
  recovery_window_in_days = var.secret_recovery_window_in_days
  kms_key_id              = var.kms_key_id

  tags = merge(local.common_tags, {
    Name    = local.database_url_secret_name
    Purpose = "CONTROL_PLANE_DATABASE_URL"
  })
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id = aws_secretsmanager_secret.database_url.id
  secret_string = jsonencode({
    engine                     = "postgres"
    host                       = aws_db_instance.control_plane.address
    port                       = aws_db_instance.control_plane.port
    dbname                     = var.db_name
    username                   = var.master_username
    password                   = random_password.master.result
    url                        = local.database_url
    CONTROL_PLANE_DATABASE_URL = local.database_url
    DATABASE_URL               = local.database_url
  })
}

resource "aws_ssm_parameter" "database_url_secret_arn" {
  count = var.create_ssm_parameter_pointer ? 1 : 0

  name        = local.ssm_parameter_name
  description = "ARN of Secrets Manager secret holding CONTROL_PLANE_DATABASE_URL (not the password itself)"
  type        = "String"
  value       = aws_secretsmanager_secret.database_url.arn
  tier        = "Standard"

  tags = merge(local.common_tags, {
    Name    = local.ssm_parameter_name
    Purpose = "CONTROL_PLANE_DATABASE_URL_SECRET_ARN"
  })
}
