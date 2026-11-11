# ---------------------------------------------------------------------------
# Naming / tags (placeholder-safe; no account IDs or secrets)
# ---------------------------------------------------------------------------

variable "name_prefix" {
  description = <<-EOT
    Short lowercase prefix for RDS identifier, subnet group, SG, and secret names.
    Must not contain account IDs or secrets. Example: lanyard-cp-staging.
  EOT
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,38}[a-z0-9]$", var.name_prefix))
    error_message = "name_prefix must be 3–40 chars, lowercase alphanumeric and hyphens, start with a letter, end alphanumeric."
  }

  validation {
    condition     = !can(regex("(unconfigured|changeme|TODO|FIXME)", lower(var.name_prefix)))
    error_message = "name_prefix must not contain placeholder tokens (UNCONFIGURED, changeme, TODO, FIXME)."
  }
}

variable "environment" {
  description = "Logical environment label (e.g. staging, prod). Used in tags only."
  type        = string
  default     = "staging"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$", var.environment)) || length(var.environment) == 1
    error_message = "environment must be a short lowercase label."
  }
}

variable "tags" {
  description = "Additional tags applied to all supported resources."
  type        = map(string)
  default     = {}
}

# ---------------------------------------------------------------------------
# Network — private only (fail-closed)
# ---------------------------------------------------------------------------

variable "vpc_id" {
  description = <<-EOT
    VPC ID for the control-plane RDS security group.
    Required. Use a real VPC in private operator tfvars — never invent account/VPC IDs in git.
  EOT
  type        = string

  validation {
    condition     = can(regex("^vpc-[0-9a-f]{8,}$", var.vpc_id))
    error_message = "vpc_id must look like vpc-… (lowercase hex). Use a real VPC from your account; do not invent IDs in committed examples."
  }

  validation {
    condition     = !can(regex("(unconfigured|changeme|TODO|FIXME|example)", lower(var.vpc_id)))
    error_message = "vpc_id must not contain placeholder tokens."
  }
}

variable "subnet_ids" {
  description = <<-EOT
    Private subnet IDs for the DB subnet group (minimum 2, multi-AZ capable).
    Fail-closed: plan-time check requires map_public_ip_on_launch=false on every subnet.
    Do not pass public subnets.
  EOT
  type        = list(string)

  validation {
    condition     = length(var.subnet_ids) >= 2
    error_message = "subnet_ids must include at least two private subnets for the DB subnet group."
  }

  validation {
    condition = alltrue([
      for id in var.subnet_ids : can(regex("^subnet-[0-9a-f]{8,}$", id))
    ])
    error_message = "each subnet_ids entry must look like subnet-… (lowercase hex)."
  }

  validation {
    condition = alltrue([
      for id in var.subnet_ids :
      !can(regex("(unconfigured|changeme|TODO|FIXME|example)", lower(id)))
    ])
    error_message = "subnet_ids must not contain placeholder tokens."
  }
}

variable "publicly_accessible" {
  description = <<-EOT
    MUST remain false. Public RDS is rejected — control-plane DB is private-subnet only.
    There is no supported public posture for this module.
  EOT
  type        = bool
  default     = false

  validation {
    condition     = var.publicly_accessible == false
    error_message = "publicly_accessible must be false. modules/control-plane-rds rejects public RDS (private subnets only)."
  }
}

variable "allowed_security_group_ids" {
  description = <<-EOT
    Security groups allowed to connect to Postgres (5432). Prefer these over CIDRs for
    control-plane tasks / private BFF. At least one of allowed_security_group_ids or
    allowed_cidr_blocks is required (see check block).
  EOT
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for id in var.allowed_security_group_ids :
      can(regex("^sg-[0-9a-f]{8,}$", id))
    ])
    error_message = "each allowed_security_group_ids entry must look like sg-… ."
  }
}

variable "allowed_cidr_blocks" {
  description = <<-EOT
    Optional private CIDR blocks allowed to Postgres (5432). 0.0.0.0/0 and ::/0 are rejected.
    Prefer security group references when possible.
  EOT
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for c in var.allowed_cidr_blocks :
      c != "0.0.0.0/0" && c != "::/0"
    ])
    error_message = "allowed_cidr_blocks must not include 0.0.0.0/0 or ::/0 (private access only)."
  }

  validation {
    condition = alltrue([
      for c in var.allowed_cidr_blocks : can(cidrhost(c, 0))
    ])
    error_message = "each allowed_cidr_blocks entry must be a valid CIDR."
  }
}

# ---------------------------------------------------------------------------
# Engine / instance
# ---------------------------------------------------------------------------

variable "engine_version" {
  description = "PostgreSQL engine version (major.minor or major as supported by RDS)."
  type        = string
  default     = "16.6"

  validation {
    condition     = can(regex("^[0-9]+(\\.[0-9]+)?$", var.engine_version))
    error_message = "engine_version must look like 16 or 16.6."
  }
}

variable "instance_class" {
  description = "RDS instance class. Start small for staging; size for production load separately."
  type        = string
  default     = "db.t4g.medium"

  validation {
    condition     = can(regex("^db\\.[a-z0-9]+\\.[a-z0-9]+$", var.instance_class))
    error_message = "instance_class must look like db.t4g.medium."
  }
}

variable "allocated_storage" {
  description = "Allocated storage in GiB."
  type        = number
  default     = 50

  validation {
    condition     = var.allocated_storage >= 20 && var.allocated_storage <= 65536
    error_message = "allocated_storage must be between 20 and 65536 GiB."
  }
}

variable "max_allocated_storage" {
  description = "Autoscaling ceiling in GiB (0 disables storage autoscaling). Must be 0 or >= allocated_storage (enforced in check block)."
  type        = number
  default     = 200

  validation {
    condition     = var.max_allocated_storage == 0 || var.max_allocated_storage >= 20
    error_message = "max_allocated_storage must be 0 or >= 20."
  }
}

variable "storage_type" {
  description = "EBS storage type for the instance."
  type        = string
  default     = "gp3"

  validation {
    condition     = contains(["gp3", "gp2", "io1", "io2"], var.storage_type)
    error_message = "storage_type must be gp3, gp2, io1, or io2."
  }
}

variable "multi_az" {
  description = "Deploy Multi-AZ standby. Recommended true for production."
  type        = bool
  default     = true
}

variable "db_name" {
  description = "Initial database name created on the instance (control-plane application DB)."
  type        = string
  default     = "control_plane"

  validation {
    condition     = can(regex("^[a-zA-Z][a-zA-Z0-9_]{0,62}$", var.db_name))
    error_message = "db_name must be a valid PostgreSQL identifier (letter start, alnum/underscore)."
  }
}

variable "master_username" {
  description = "Master username. Password is generated and stored in Secrets Manager — never pass passwords via tfvars."
  type        = string
  default     = "cp_admin"

  validation {
    condition     = can(regex("^[a-zA-Z][a-zA-Z0-9_]{0,15}$", var.master_username))
    error_message = "master_username must be 1–16 chars, letter start, alnum/underscore (RDS postgres limits)."
  }

  validation {
    condition     = !contains(["postgres", "rdsadmin", "admin", "root"], lower(var.master_username))
    error_message = "master_username must not be a reserved RDS/postgres name (postgres, rdsadmin, admin, root)."
  }
}

variable "port" {
  description = "Postgres port."
  type        = number
  default     = 5432

  validation {
    condition     = var.port >= 1150 && var.port <= 65535
    error_message = "port must be in the RDS-allowed range."
  }
}

# ---------------------------------------------------------------------------
# Encryption / backups / retention (always encrypted)
# ---------------------------------------------------------------------------

variable "kms_key_id" {
  description = <<-EOT
    Optional customer-managed KMS key ARN/id for storage encryption.
    When null, RDS uses the AWS-managed aws/rds key. Storage encryption is always enabled.
  EOT
  type        = string
  default     = null
}

variable "backup_retention_period" {
  description = "Automated backup retention in days (1–35). Minimum 7 recommended for production."
  type        = number
  default     = 7

  validation {
    condition     = var.backup_retention_period >= 1 && var.backup_retention_period <= 35
    error_message = "backup_retention_period must be 1–35 days."
  }
}

variable "backup_window" {
  description = "Preferred backup window (UTC), e.g. 07:00-08:00."
  type        = string
  default     = "07:00-08:00"
}

variable "maintenance_window" {
  description = "Preferred maintenance window (UTC), e.g. sun:08:00-sun:09:00."
  type        = string
  default     = "sun:08:00-sun:09:00"
}

variable "deletion_protection" {
  description = "Protect the instance from destroy. Keep true for real environments."
  type        = bool
  default     = true
}

variable "skip_final_snapshot" {
  description = <<-EOT
    Skip final snapshot on destroy. Keep false for real environments.
    Lab-only true is allowed when deletion_protection is also false.
  EOT
  type        = bool
  default     = false
}

variable "final_snapshot_identifier" {
  description = "Final snapshot id when skip_final_snapshot=false. Null → generated from name_prefix."
  type        = string
  default     = null
}

variable "apply_immediately" {
  description = "Apply modifications immediately (may cause brief downtime). Prefer false in production."
  type        = bool
  default     = false
}

variable "auto_minor_version_upgrade" {
  description = "Allow automatic minor engine upgrades during the maintenance window."
  type        = bool
  default     = true
}

variable "performance_insights_enabled" {
  description = "Enable Performance Insights (recommended for production diagnostics)."
  type        = bool
  default     = true
}

variable "performance_insights_retention_period" {
  description = "Performance Insights retention in days (7 free tier, or 731)."
  type        = number
  default     = 7

  validation {
    condition     = contains([7, 731], var.performance_insights_retention_period)
    error_message = "performance_insights_retention_period must be 7 or 731."
  }
}

variable "enabled_cloudwatch_logs_exports" {
  description = "Log types to export to CloudWatch Logs."
  type        = list(string)
  default     = ["postgresql", "upgrade"]

  validation {
    condition = alltrue([
      for t in var.enabled_cloudwatch_logs_exports :
      contains(["postgresql", "upgrade"], t)
    ])
    error_message = "enabled_cloudwatch_logs_exports entries must be postgresql and/or upgrade."
  }
}

# ---------------------------------------------------------------------------
# Secrets Manager — CONTROL_PLANE_DATABASE_URL shape (no passwords in tfvars)
# ---------------------------------------------------------------------------

variable "database_url_secret_name" {
  description = <<-EOT
    Secrets Manager secret name for the control-plane database connection payload.
    Payload includes key "url" shaped for CONTROL_PLANE_DATABASE_URL / DATABASE_URL.
    Never commit secret values; only the name/ARN appear in plan/docs.
  EOT
  type        = string
  default     = null
}

variable "secret_recovery_window_in_days" {
  description = "Secrets Manager recovery window (0 = force delete without recovery; prefer 7–30)."
  type        = number
  default     = 30

  validation {
    condition     = var.secret_recovery_window_in_days == 0 || (var.secret_recovery_window_in_days >= 7 && var.secret_recovery_window_in_days <= 30)
    error_message = "secret_recovery_window_in_days must be 0 or 7–30."
  }
}

variable "create_ssm_parameter_pointer" {
  description = <<-EOT
    When true, create an SSM String parameter whose value is the Secrets Manager secret ARN
    (not the password). Operators wire CONTROL_PLANE_DATABASE_URL from the secret at runtime.
  EOT
  type        = bool
  default     = true
}

variable "ssm_parameter_name" {
  description = "SSM parameter name for the secret ARN pointer. Null → /company-brain/<name_prefix>/control-plane-database-url-secret-arn."
  type        = string
  default     = null
}

# ---------------------------------------------------------------------------
# Honesty gate — module is real Terraform; production apply is still operator-owned
# ---------------------------------------------------------------------------

variable "acknowledge_not_auto_applied" {
  description = <<-EOT
    Must be true. Affirms the operator knows this module is deploy-owned infra that is not
    auto-applied from this repository's examples, and that production control-plane use
    still requires private network wiring, G1 private boundary, and product
    CONTROL_PLANE_DATABASE_URL consumption.
  EOT
  type        = bool
  default     = false

  validation {
    condition     = var.acknowledge_not_auto_applied == true
    error_message = "acknowledge_not_auto_applied must be true. modules/control-plane-rds is real Terraform but not auto-applied; operators apply from private roots after product Postgres (G4.1/G4.2) and private VPC wiring exist."
  }
}
