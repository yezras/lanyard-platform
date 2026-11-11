# ---------------------------------------------------------------------------
# Naming (placeholder-safe; no live account IDs or secret values)
# ---------------------------------------------------------------------------

variable "name_prefix" {
  description = <<-EOT
    Short lowercase prefix for the exec role name and tags.
    Product default yields lanyard-platform-staging-harness-exec.
  EOT
  type        = string
  default     = "lanyard-platform-staging"

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
  description = "Logical environment label (e.g. staging, lab). Tags only."
  type        = string
  default     = "staging"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$", var.environment)) || length(var.environment) == 1
    error_message = "environment must be a short lowercase label."
  }
}

variable "tags" {
  description = "Additional tags applied to the exec role."
  type        = map(string)
  default     = {}
}

variable "role_name" {
  description = <<-EOT
    IAM role name. Empty → {name_prefix}-harness-exec.
    Live MockLab currently reuses lanyard-platform-staging-bff-exec; this role is
    the dedicated replacement so BFF IAM reconcile does not own harness secrets.
  EOT
  type        = string
  default     = ""

  validation {
    condition     = var.role_name == "" || can(regex("^[A-Za-z0-9+=,.@_-]{1,64}$", var.role_name))
    error_message = "role_name must be empty or a valid IAM role name (1–64 chars)."
  }

  validation {
    condition     = !can(regex("(unconfigured|changeme|TODO|FIXME)", lower(var.role_name)))
    error_message = "role_name must not contain placeholder tokens."
  }
}

variable "aws_region" {
  description = "Region for derived SM ARN patterns (names + -* suffix). Default us-east-1."
  type        = string
  default     = "us-east-1"

  validation {
    condition     = can(regex("^[a-z]{2}-[a-z]+-[0-9]$", var.aws_region))
    error_message = "aws_region must look like us-east-1."
  }
}

variable "aws_account_id" {
  description = <<-EOT
    12-digit account id for derived SM ARN patterns. Examples use 000000000000.
    Never a live id in git examples that are meant as live pins; private tfvars only.
  EOT
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be a 12-digit AWS account id."
  }
}

variable "extra_secret_names" {
  description = "Additional SM secret names (no random suffix) merged into the catalog."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for n in var.extra_secret_names :
      can(regex("^[A-Za-z0-9/_+=.@-]+$", n))
    ])
    error_message = "extra_secret_names entries must be SM name characters only (no ARNs, no values)."
  }
}

variable "extra_secret_arns" {
  description = <<-EOT
    Additional SM ARNs (or IAM ARN patterns with -*) for GetSecretValue.
    JSON-key suffixes (:KEY::) are stripped to the 7-component secret ARN.
    Never Resource="*". Never secret values.
  EOT
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for arn in var.extra_secret_arns :
      can(regex("^arn:aws[a-z-]*:secretsmanager:", arn))
    ])
    error_message = "each extra_secret_arns entry must be a secretsmanager ARN."
  }
}

variable "create_role" {
  description = "When false, module still exports the catalog/ARN patterns but creates no IAM. Use for dry compose."
  type        = bool
  default     = true
}

variable "acknowledge_not_auto_applied" {
  description = "Must be true. Module is real Terraform but not auto-applied from this bead."
  type        = bool
  default     = false

  validation {
    condition     = var.acknowledge_not_auto_applied == true
    error_message = "acknowledge_not_auto_applied must be true. modules/harness-exec-iam is not auto-applied; do not terraform apply from lp-oop.38.20."
  }
}
