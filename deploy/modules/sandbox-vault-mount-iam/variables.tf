# ---------------------------------------------------------------------------
# Naming (placeholder-safe; no account IDs or secrets)
# ---------------------------------------------------------------------------

variable "name_prefix" {
  description = <<-EOT
    Short lowercase prefix for optional resource name decoration and tags.
    Role default name is independent (see role_name). Example: lanyard-platform-lab.
  EOT
  type        = string
  default     = "lanyard"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$", var.name_prefix))
    error_message = "name_prefix must be 3–40 chars, lowercase alphanumeric and hyphens, start/end alphanumeric."
  }

  validation {
    condition     = !can(regex("(unconfigured|replace|changeme|TODO|FIXME)", lower(var.name_prefix)))
    error_message = "name_prefix must not contain placeholder tokens (UNCONFIGURED, REPLACE, changeme, TODO, FIXME)."
  }
}

variable "environment" {
  description = "Logical environment label (e.g. lab, staging, prod). Used in tags only."
  type        = string
  default     = "lab"

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
# Role identity
# ---------------------------------------------------------------------------

variable "role_name" {
  description = <<-EOT
    IAM role name for the shared base sandbox vault mount role.
    Product default: lanyard-sandbox-vault-mount. Env-named variants allowed
    (e.g. lanyard-sandbox-vault-mount-lab).
  EOT
  type        = string
  default     = "lanyard-sandbox-vault-mount"

  validation {
    condition     = can(regex("^[A-Za-z0-9+=,.@_-]{1,64}$", var.role_name))
    error_message = "role_name must be a valid IAM role name (1–64 chars)."
  }

  validation {
    condition     = !can(regex("(unconfigured|changeme|TODO|FIXME)", lower(var.role_name)))
    error_message = "role_name must not contain placeholder tokens."
  }
}

variable "max_session_duration" {
  description = <<-EOT
    Max STS session duration seconds for AssumeRole on the base mount role.
    Must cover product guest sessions (900–3600 per lp-t86). Default 3600.
  EOT
  type        = number
  default     = 3600

  validation {
    condition     = var.max_session_duration >= 3600 && var.max_session_duration <= 43200
    error_message = "max_session_duration must be 3600–43200 (IAM role max); product guest sessions stay ≤3600 via DurationSeconds."
  }
}

# ---------------------------------------------------------------------------
# Vault bucket (existing; module does not create S3)
# ---------------------------------------------------------------------------

variable "vault_bucket_name" {
  description = <<-EOT
    Existing platform vault bucket name (no s3://). Lab pilot:
    lanyard-mocklab-vault-123456789012. Product: lanyard-vault-{env}.
  EOT
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.vault_bucket_name))
    error_message = "vault_bucket_name must be a valid S3 bucket name."
  }

  validation {
    condition = (
      can(regex("^lanyard-mocklab-vault-", var.vault_bucket_name)) ||
      can(regex("^lanyard-vault-", var.vault_bucket_name))
    )
    error_message = "vault_bucket_name must match lanyard-mocklab-vault-* or lanyard-vault-*."
  }
}

# ---------------------------------------------------------------------------
# Trust / orchestrator (CP task role)
# ---------------------------------------------------------------------------

variable "orchestrator_principal_arns" {
  description = <<-EOT
    IAM principal ARNs allowed to sts:AssumeRole the base mount role.
    Product: Control Plane ECS task role ARN only (e.g. …/role/…-cp-task).
    Fail-closed: empty list refuses role creation.
    Never use Principal "*" / account-root wildcards for guest minting.
  EOT
  type        = list(string)

  validation {
    condition     = length(var.orchestrator_principal_arns) > 0
    error_message = "orchestrator_principal_arns must be non-empty (fail-closed trust)."
  }

  validation {
    condition = alltrue([
      for a in var.orchestrator_principal_arns :
      can(regex("^arn:aws:iam::[0-9]{12}:(role|user)/[A-Za-z0-9+=,.@_-]+(/[A-Za-z0-9+=,.@_/-]+)?$", a))
    ])
    error_message = "Each orchestrator_principal_arns entry must be an IAM role or user ARN."
  }

  validation {
    condition = alltrue([
      for a in var.orchestrator_principal_arns :
      !can(regex("(unconfigured|changeme|TODO|FIXME|REPLACE)", a))
    ])
    error_message = "orchestrator_principal_arns must not contain placeholder tokens."
  }
}

variable "external_id" {
  description = <<-EOT
    Optional STS ExternalId required on AssumeRole (confused-deputy protection).
    Empty/null = no ExternalId condition on trust. Sensitive — set only in
    private tfvars / SM, never commit real values.
  EOT
  type        = string
  default     = null
  sensitive   = true
}

# ---------------------------------------------------------------------------
# CP task role AssumeRole grant
# ---------------------------------------------------------------------------

variable "attach_orchestrator_assume_policy" {
  description = <<-EOT
    When true, attach an inline policy to each orchestrator *role* principal
    granting sts:AssumeRole (and TagSession) on the base mount role only.
    User principals are skipped (attach managed policy out-of-band).
  EOT
  type        = bool
  default     = true
}

variable "create_base_role" {
  description = "Create the shared base mount role + identity policy. Set false to export policy JSON only."
  type        = bool
  default     = true
}
