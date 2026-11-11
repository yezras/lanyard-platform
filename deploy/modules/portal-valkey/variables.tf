# ---------------------------------------------------------------------------
# Naming / tags (placeholder-safe; no account IDs or secrets)
# ---------------------------------------------------------------------------

variable "name_prefix" {
  description = <<-EOT
    Short lowercase prefix for ElastiCache replication group, subnet group, SG, and secret names.
    Must not contain account IDs or secrets. Example: lanyard-portal-staging.
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
    VPC ID for the Valkey security group.
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
    Private subnet IDs for the ElastiCache subnet group (minimum 2, multi-AZ capable).
    Fail-closed: plan-time check requires map_public_ip_on_launch=false on every subnet.
    Do not pass public subnets.
  EOT
  type        = list(string)

  validation {
    condition     = length(var.subnet_ids) >= 2
    error_message = "subnet_ids must include at least two private subnets for the cache subnet group."
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

variable "allowed_security_group_ids" {
  description = <<-EOT
    Security groups allowed to connect to Valkey (default 6379). Prefer BFF and relay task SGs.
    At least one of allowed_security_group_ids or allowed_cidr_blocks is required (see check block).
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
    Optional private CIDR blocks allowed to Valkey. 0.0.0.0/0 and ::/0 are rejected.
    Prefer security group references (BFF/relay) when possible.
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
# Engine / cluster topology
# ---------------------------------------------------------------------------

variable "engine" {
  description = "ElastiCache engine. Prefer valkey; redis is accepted for compatibility only."
  type        = string
  default     = "valkey"

  validation {
    condition     = contains(["valkey", "redis"], var.engine)
    error_message = "engine must be valkey or redis."
  }
}

variable "engine_version" {
  description = "Engine version (e.g. 8.0 for Valkey). Must match a supported ElastiCache version."
  type        = string
  default     = "8.0"

  validation {
    condition     = can(regex("^[0-9]+(\\.[0-9]+)?$", var.engine_version))
    error_message = "engine_version must look like 8.0 or 7.2."
  }
}

variable "node_type" {
  description = <<-EOT
    Cache node type. Default cache.t4g.micro is the smallest production-credible topology.
    Staging may keep micro; raise for production load in private tfvars.
  EOT
  type        = string
  default     = "cache.t4g.micro"

  validation {
    condition     = can(regex("^cache\\.[a-z0-9]+\\.[a-z0-9]+$", var.node_type))
    error_message = "node_type must look like cache.t4g.micro."
  }
}

variable "num_cache_clusters" {
  description = <<-EOT
    Number of cache clusters (nodes) in the replication group.
    Default 2 enables Multi-AZ + automatic failover (production-credible HA).
    Staging cost path: set 1 with multi_az_enabled=false and automatic_failover_enabled=false.
  EOT
  type        = number
  default     = 2

  validation {
    condition     = var.num_cache_clusters >= 1 && var.num_cache_clusters <= 6
    error_message = "num_cache_clusters must be 1–6."
  }
}

variable "port" {
  description = "Valkey/Redis port."
  type        = number
  default     = 6379

  validation {
    condition     = var.port >= 1024 && var.port <= 65535
    error_message = "port must be in 1024–65535."
  }
}

variable "parameter_group_name" {
  description = <<-EOT
    ElastiCache parameter group name. Null → create a module-managed group for the engine major
    (e.g. valkey8) with TLS-friendly defaults.
  EOT
  type        = string
  default     = null
}

variable "multi_az_enabled" {
  description = "Enable Multi-AZ. Requires num_cache_clusters >= 2 and automatic_failover_enabled."
  type        = bool
  default     = true
}

variable "automatic_failover_enabled" {
  description = "Enable automatic failover. Requires num_cache_clusters >= 2."
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------------
# Encryption (always on) / auth
# ---------------------------------------------------------------------------

variable "kms_key_id" {
  description = <<-EOT
    Optional customer-managed KMS key ARN/id for at-rest encryption and Secrets Manager.
    When null, AWS-managed keys are used. At-rest encryption is always enabled.
  EOT
  type        = string
  default     = null
}

variable "transit_encryption_enabled" {
  description = <<-EOT
    MUST remain true. In-transit TLS is mandatory for Portal shared state (rediss://).
    There is no supported plaintext Redis posture for this module.
  EOT
  type        = bool
  default     = true

  validation {
    condition     = var.transit_encryption_enabled == true
    error_message = "transit_encryption_enabled must be true. modules/portal-valkey rejects non-TLS clients."
  }
}

variable "at_rest_encryption_enabled" {
  description = <<-EOT
    MUST remain true. At-rest encryption is mandatory.
  EOT
  type        = bool
  default     = true

  validation {
    condition     = var.at_rest_encryption_enabled == true
    error_message = "at_rest_encryption_enabled must be true. modules/portal-valkey rejects unencrypted storage."
  }
}

# ---------------------------------------------------------------------------
# Backup / maintenance
# ---------------------------------------------------------------------------

variable "snapshot_retention_limit" {
  description = "Automated snapshot retention in days (0 disables automated snapshots). Prefer >= 1 for real envs."
  type        = number
  default     = 7

  validation {
    condition     = var.snapshot_retention_limit >= 0 && var.snapshot_retention_limit <= 35
    error_message = "snapshot_retention_limit must be 0–35 days."
  }
}

variable "snapshot_window" {
  description = "Daily snapshot window (UTC), e.g. 07:00-08:00."
  type        = string
  default     = "07:00-08:00"
}

variable "maintenance_window" {
  description = "Preferred maintenance window (UTC), e.g. sun:08:00-sun:09:00."
  type        = string
  default     = "sun:08:00-sun:09:00"
}

variable "apply_immediately" {
  description = "Apply modifications immediately (may cause brief disruption). Prefer false in production."
  type        = bool
  default     = false
}

variable "auto_minor_version_upgrade" {
  description = "Allow automatic minor engine upgrades during the maintenance window."
  type        = bool
  default     = true
}

variable "final_snapshot_identifier" {
  description = "Final snapshot id on destroy when snapshot_retention_limit > 0 path applies. Null → generated from name_prefix."
  type        = string
  default     = null
}

# ---------------------------------------------------------------------------
# Logs / metrics / alarms (optional, parameterized)
# ---------------------------------------------------------------------------

variable "enable_slow_log" {
  description = "Deliver ElastiCache slow-log to CloudWatch Logs."
  type        = bool
  default     = true
}

variable "enable_engine_log" {
  description = "Deliver ElastiCache engine-log to CloudWatch Logs."
  type        = bool
  default     = false
}

variable "log_retention_in_days" {
  description = "CloudWatch log group retention for slow/engine logs."
  type        = number
  default     = 30

  validation {
    condition = contains([
      1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653
    ], var.log_retention_in_days)
    error_message = "log_retention_in_days must be a CloudWatch Logs allowed retention value."
  }
}

variable "create_cloudwatch_alarms" {
  description = "Create CloudWatch metric alarms for CPU, memory, and evictions."
  type        = bool
  default     = true
}

variable "alarm_sns_topic_arns" {
  description = "SNS topic ARNs for alarm actions. Empty → alarms created without actions (still visible in console)."
  type        = list(string)
  default     = []
}

variable "cpu_alarm_threshold" {
  description = "CPUUtilization alarm threshold (percent)."
  type        = number
  default     = 80

  validation {
    condition     = var.cpu_alarm_threshold > 0 && var.cpu_alarm_threshold <= 100
    error_message = "cpu_alarm_threshold must be 0–100 exclusive of 0."
  }
}

variable "memory_alarm_threshold" {
  description = "DatabaseMemoryUsagePercentage alarm threshold (percent)."
  type        = number
  default     = 80

  validation {
    condition     = var.memory_alarm_threshold > 0 && var.memory_alarm_threshold <= 100
    error_message = "memory_alarm_threshold must be 0–100 exclusive of 0."
  }
}

variable "evictions_alarm_threshold" {
  description = "Evictions alarm threshold (count over period)."
  type        = number
  default     = 100

  validation {
    condition     = var.evictions_alarm_threshold >= 1
    error_message = "evictions_alarm_threshold must be >= 1."
  }
}

variable "alarm_evaluation_periods" {
  description = "CloudWatch alarm evaluation periods."
  type        = number
  default     = 3

  validation {
    condition     = var.alarm_evaluation_periods >= 1 && var.alarm_evaluation_periods <= 24
    error_message = "alarm_evaluation_periods must be 1–24."
  }
}

variable "alarm_period_seconds" {
  description = "CloudWatch alarm period in seconds."
  type        = number
  default     = 300

  validation {
    condition     = contains([60, 300, 900, 3600], var.alarm_period_seconds)
    error_message = "alarm_period_seconds must be 60, 300, 900, or 3600."
  }
}

# ---------------------------------------------------------------------------
# Secrets Manager — REDIS_URL shape (no auth tokens in tfvars / outputs)
# ---------------------------------------------------------------------------

variable "redis_url_secret_name" {
  description = <<-EOT
    Secrets Manager secret name for the Portal Redis/Valkey connection payload.
    Payload includes key "url" / "REDIS_URL" shaped for rediss:// (TLS).
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
    (not the auth token). Operators wire REDIS_URL from the secret at runtime / ECS secrets.
  EOT
  type        = bool
  default     = true
}

variable "ssm_parameter_name" {
  description = "SSM parameter name for the secret ARN pointer. Null → /company-brain/<name_prefix>/portal-redis-url-secret-arn."
  type        = string
  default     = null
}

# ---------------------------------------------------------------------------
# Honesty gate — module is real Terraform; production apply is still operator-owned
# ---------------------------------------------------------------------------

variable "acknowledge_not_auto_applied" {
  description = <<-EOT
    Must be true. Affirms the operator knows this module is deploy-owned infra that is not
    auto-applied from this repository's examples, and that production Portal shared state (G5/G6)
    still requires product consumers, private network wiring, and staging evidence.
  EOT
  type        = bool
  default     = false

  validation {
    condition     = var.acknowledge_not_auto_applied == true
    error_message = "acknowledge_not_auto_applied must be true. modules/portal-valkey is real Terraform but not auto-applied; operators apply from private roots after BFF/relay SGs and product REDIS_URL consumers exist. Status: infra_ready, not production certified."
  }
}
