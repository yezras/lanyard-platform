# Lanyard-hosted account-per-tenant factory contract.
# Status: infra_ready — operator-owned; not auto-applied; no live Organizations API mutation.
# Account request / OU placement: Control Tower / AFT / Organizations (documented interface only).
# In-account baseline (when create_account_baseline=true): KMS, state backend, logs, backup vault,
# budget, deploy + break-glass roles — applied *inside* an already-vended tenant account.

# ---------------------------------------------------------------------------
# Tenant identity + account request interface (CT/AFT / ops)
# ---------------------------------------------------------------------------

variable "tenant_slug" {
  description = "Portal / ops tenant slug (DNS-safe). Used in tags, role names, and request contract outputs."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$", var.tenant_slug))
    error_message = "tenant_slug must be 3–64 chars, lowercase alphanumeric and hyphens."
  }
}

variable "project_name" {
  description = "Unique project prefix for AWS names/tags (must match company-brain-ec2 project_name)."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$", var.project_name))
    error_message = "project_name must be 3–50 chars, lowercase alphanumeric and hyphens."
  }
}

variable "environment_class" {
  description = "Account class for OU targeting: sandbox (non-prod client lab) or production-client (production data-plane account)."
  type        = string

  validation {
    condition     = contains(["sandbox", "production-client"], var.environment_class)
    error_message = "environment_class must be sandbox or production-client."
  }
}

variable "account_name" {
  description = "Human-readable account name for CT/AFT request (e.g. lanyard-acme-prod). Placeholder-safe in examples."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9][A-Za-z0-9 _.-]{1,48}[A-Za-z0-9]$", var.account_name))
    error_message = "account_name must be 3–50 chars, alphanumeric with spaces/._-."
  }
}

variable "account_email" {
  description = <<-EOT
    Unique root email for the member account request (CT/AFT). Use a documented alias pattern in private ops
    (e.g. aws+tenant-slug@example.com). Never commit a real production mailbox as a live claim in shared examples.
  EOT
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$", var.account_email))
    error_message = "account_email must look like an email address."
  }

  validation {
    condition = (
      !can(regex("(?i)(live|prod)@lanyard", var.account_email))
      && !can(regex("@withlanyard\\.com$", lower(var.account_email)))
    )
    error_message = "account_email in examples must not use live Lanyard production mailboxes."
  }
}

variable "target_ou_path" {
  description = <<-EOT
    Documented OU path for account placement (e.g. Root/Lanyard/clients/production-clients).
    Not applied by this module — operators wire this into Control Tower Account Factory or AFT customizations.
  EOT
  type        = string
  default     = "Root/Lanyard/clients/production-clients"

  validation {
    condition     = length(var.target_ou_path) >= 3 && length(var.target_ou_path) <= 256
    error_message = "target_ou_path must be a non-empty OU path string."
  }
}

variable "sso_permission_set_names" {
  description = "IAM Identity Center permission set names expected on this account (documented; SSO assignment is org-level / live-gated)."
  type        = list(string)
  default = [
    "CompanyBrainDeploy",
    "CompanyBrainBreakGlass",
  ]
}

# ---------------------------------------------------------------------------
# Account ID (input or already known) — no Organizations CreateAccount here
# ---------------------------------------------------------------------------

variable "account_id" {
  description = <<-EOT
    12-digit AWS account ID of the *already vended* tenant account (from CT/AFT/Organizations output or ops notes).
    Required when create_account_baseline=true. Use 000000000000 only in offline documentation examples.
  EOT
  type        = string
  default     = null

  validation {
    condition     = var.account_id == null || can(regex("^[0-9]{12}$", var.account_id))
    error_message = "account_id must be a 12-digit string or null."
  }
}

variable "region" {
  description = "Primary AWS region for in-account baseline resources (state, KMS alias region, log groups, budget)."
  type        = string
  default     = "us-east-1"

  validation {
    condition     = can(regex("^[a-z]{2}(-[a-z]+)+-\\d+$", var.region))
    error_message = "region must look like an AWS region code (e.g. us-east-1)."
  }
}

# ---------------------------------------------------------------------------
# Honesty / org mutation gates
# ---------------------------------------------------------------------------

variable "acknowledge_not_auto_applied" {
  description = "Honesty gate: module is infra_ready/contract — not live multi-account org factory certified from git examples. Must be true."
  type        = bool

  validation {
    condition     = var.acknowledge_not_auto_applied == true
    error_message = "acknowledge_not_auto_applied must be true (account-factory is operator-owned, not auto from examples)."
  }
}

variable "enable_live_organizations_api" {
  description = <<-EOT
    Intentionally locked to false. This module does not call Organizations CreateAccount / MoveAccount / AttachPolicy.
    Account request and SCP attach remain Control Tower / AFT / org-admin operator steps (see runbook).
  EOT
  type        = bool
  default     = false

  validation {
    condition     = var.enable_live_organizations_api == false
    error_message = "enable_live_organizations_api must remain false — live Organizations mutation is out of scope for this contract module (use CT/AFT)."
  }
}

variable "create_account_baseline" {
  description = <<-EOT
    When true, create in-account baseline resources (KMS, state backend, log group, backup vault, budget, deploy + break-glass roles).
    Apply with credentials *in the vended tenant account* (or assume-role into it). Default false for pure contract/output mode.
  EOT
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# Deploy role (Lanyard operators → tenant account; no static keys)
# ---------------------------------------------------------------------------

variable "lanyard_deploy_principal_arns" {
  description = <<-EOT
    IAM principal ARN(s) in the Lanyard management / ops account allowed to assume the tenant deploy role.
    Placeholder ARNs only in git examples (arn:aws:iam::000000000000:role/…).
  EOT
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for a in var.lanyard_deploy_principal_arns :
      can(regex("^arn:aws:iam::[0-9]{12}:(role|user)/[A-Za-z0-9+=,.@/_-]+$", a))
    ])
    error_message = "lanyard_deploy_principal_arns entries must be IAM role/user ARNs with 12-digit accounts."
  }
}

variable "deploy_role_external_id" {
  description = <<-EOT
    STS ExternalId for the deploy role AssumeRole trust (confused-deputy protection).
    Always required in the trust policy when create_deploy_role creates a role.
    Pass a long random secret from private operator config — never commit live values.
  EOT
  type        = string
  default     = "offline-validation-external-id-not-for-prod"
  sensitive   = true

  validation {
    condition = (
      length(trimspace(var.deploy_role_external_id)) >= 16
      && !can(regex("(?i)(unconfigured|TODO|FIXME|changeme|replace-me)", var.deploy_role_external_id))
    )
    error_message = "deploy_role_external_id must be ≥16 chars without trivial placeholder tokens."
  }
}


variable "break_glass_principal_arns" {
  description = "Principals allowed to assume the break-glass role (empty = skip break-glass role create when baseline on)."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for a in var.break_glass_principal_arns :
      can(regex("^arn:aws:iam::[0-9]{12}:(role|user)/[A-Za-z0-9+=,.@/_-]+$", a))
    ])
    error_message = "break_glass_principal_arns entries must be IAM role/user ARNs."
  }
}

variable "require_mfa_break_glass" {
  description = "Require aws:MultiFactorAuthPresent on break-glass assume (recommended true for production-client)."
  type        = bool
  default     = true
}

variable "max_session_duration_seconds" {
  description = "Max STS session duration for deploy and break-glass roles."
  type        = number
  default     = 3600

  validation {
    condition     = var.max_session_duration_seconds >= 900 && var.max_session_duration_seconds <= 43200
    error_message = "max_session_duration_seconds must be between 900 and 43200."
  }
}

# ---------------------------------------------------------------------------
# Baseline feature toggles
# ---------------------------------------------------------------------------

variable "create_kms_key" {
  description = "Create a tenant CMK for EBS/state/backup encryption (recommended for production-client)."
  type        = bool
  default     = true
}

variable "create_state_backend" {
  description = "Create private S3 state bucket + DynamoDB lock table for this tenant account."
  type        = bool
  default     = true
}

variable "create_log_group" {
  description = "Create baseline CloudWatch log group prefix for the tenant."
  type        = bool
  default     = true
}

variable "create_backup_vault" {
  description = "Create an AWS Backup vault for optional account-level backup plans (DLM remains primary for company-brain-ec2 EBS)."
  type        = bool
  default     = true
}

variable "create_budget" {
  description = "Create a monthly AWS Budget with optional SNS notification (limit is soft guardrail)."
  type        = bool
  default     = true
}

variable "create_deploy_role" {
  description = "Create IAM deploy role (AssumeRole only; never access keys)."
  type        = bool
  default     = true
}

variable "create_break_glass_role" {
  description = "Create IAM break-glass role when break_glass_principal_arns is non-empty."
  type        = bool
  default     = true
}

variable "monthly_budget_limit_usd" {
  description = "Monthly cost budget limit in USD (soft alert threshold)."
  type        = number
  default     = 500

  validation {
    condition     = var.monthly_budget_limit_usd >= 10 && var.monthly_budget_limit_usd <= 1000000
    error_message = "monthly_budget_limit_usd must be between 10 and 1000000."
  }
}

variable "budget_notification_email" {
  description = "Optional email for budget notifications. Null skips subscriber (budget still created)."
  type        = string
  default     = null

  validation {
    condition = (
      var.budget_notification_email == null
      || can(regex("^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$", var.budget_notification_email))
    )
    error_message = "budget_notification_email must be a valid email or null."
  }
}

variable "log_retention_days" {
  description = "CloudWatch log retention for the baseline tenant log group."
  type        = number
  default     = 90

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1827, 3653], var.log_retention_days)
    error_message = "log_retention_days must be a valid CloudWatch Logs retention value."
  }
}

variable "state_bucket_name" {
  description = "Optional explicit S3 state bucket name. Default: company-brain-tfstate-<project_name>-<account_id last 6> (must be globally unique)."
  type        = string
  default     = null

  validation {
    condition = (
      var.state_bucket_name == null
      || can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.state_bucket_name))
    )
    error_message = "state_bucket_name must be a valid S3 bucket name or null."
  }
}

variable "kms_key_administrators" {
  description = "Additional KMS key administrator ARNs (root of account is always included when baseline creates the key)."
  type        = list(string)
  default     = []
}

variable "extra_tags" {
  description = "Additional tags merged onto created resources."
  type        = map(string)
  default     = {}
}
