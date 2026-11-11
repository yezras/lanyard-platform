# Track B — customer-account access (Lanyard assume-role into customer account).
# Applied in the *customer* AWS account. No long-lived access keys. Placeholder-safe.

variable "project_name" {
  description = "Tenant project prefix used for IAM names, tags, and resource scoping (must match company-brain-ec2 project_name)."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$", var.project_name))
    error_message = "project_name must be 3–50 chars, lowercase alphanumeric and hyphens, start/end alphanumeric."
  }
}

variable "tenant_slug" {
  description = "Portal tenant slug (used in session tags and documentation outputs). DNS-safe lowercase."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$", var.tenant_slug))
    error_message = "tenant_slug must be 3–64 chars, lowercase alphanumeric and hyphens."
  }
}

variable "role_name" {
  description = "IAM role name in the customer account. Defaults to company-brain-lanyard-deploy-<project_name>."
  type        = string
  default     = null

  validation {
    condition     = var.role_name == null || can(regex("^[A-Za-z0-9+=,.@_-]{1,64}$", var.role_name))
    error_message = "role_name must be a valid IAM role name (1–64 chars) or null."
  }
}

variable "lanyard_principal_arns" {
  description = <<-EOT
    IAM principal ARN(s) in the *Lanyard* account that may assume this role (roles or users).
    Use documentation/placeholder ARNs in git (e.g. arn:aws:iam::000000000000:role/lanyard-platform-deployer).
    Never commit live Lanyard account IDs as claimed production values in shared examples.
  EOT
  type        = list(string)

  validation {
    condition = (
      length(var.lanyard_principal_arns) > 0
      && alltrue([
        for a in var.lanyard_principal_arns :
        can(regex("^arn:aws:iam::[0-9]{12}:(role|user)/[A-Za-z0-9+=,.@/_-]+$", a))
      ])
    )
    error_message = "lanyard_principal_arns must be a non-empty list of IAM role/user ARNs (12-digit account)."
  }
}

variable "external_id" {
  description = <<-EOT
    Required STS ExternalId for AssumeRole (confused-deputy protection). Sensitive — set only in private tfvars
    or via CI secret injection. Never commit the live value. Minimum 16 characters; not a trivial placeholder.
  EOT
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.external_id) >= 16
    error_message = "external_id must be at least 16 characters (use a high-entropy secret; not the empty string)."
  }

  validation {
    condition = (
      !contains([
        "changeme",
        "external-id",
        "REPLACE_ME",
        "0000000000000000",
        "externalidplaceholder",
      ], lower(var.external_id))
      && !can(regex("(?i)^replace", var.external_id))
      && !can(regex("(?i)^example", var.external_id))
      && !can(regex("(?i)^placeholder", var.external_id))
    )
    error_message = "external_id must not be a trivial placeholder (changeme/example/REPLACE…)."
  }
}

variable "external_id_parameter_name" {
  description = <<-EOT
    Name/path of the *Lanyard-side* secret or SSM parameter that stores the ExternalId value for operators.
    This is a reference label only — the module never writes the ExternalId into AWS as a public value.
    Example shape: /lanyard/track-b/<tenant_slug>/deploy-external-id
  EOT
  type        = string
  default     = null

  validation {
    condition = (
      var.external_id_parameter_name == null
      || can(regex("^[/A-Za-z0-9_.+=@-]{1,256}$", var.external_id_parameter_name))
    )
    error_message = "external_id_parameter_name must be a path-like name or null."
  }
}

variable "max_session_duration_seconds" {
  description = "Maximum STS session duration for the role (seconds). Default 1 hour; max 12 hours."
  type        = number
  default     = 3600

  validation {
    condition     = var.max_session_duration_seconds >= 900 && var.max_session_duration_seconds <= 43200
    error_message = "max_session_duration_seconds must be between 900 and 43200."
  }
}

variable "enable_session_tags" {
  description = "Allow sts:TagSession and require transitive session tags tenant_slug + project_name on assume."
  type        = bool
  default     = true
}

variable "require_mfa" {
  description = "When true, trust policy requires aws:MultiFactorAuthPresent=true on the Lanyard principal."
  type        = bool
  default     = false
}

variable "allowed_regions" {
  description = "Optional list of AWS regions where this role may be used (aws:RequestedRegion). Empty = no region condition."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for r in var.allowed_regions : can(regex("^[a-z]{2}(-[a-z]+)+-\\d+$", r))
    ])
    error_message = "allowed_regions entries must look like AWS region codes (e.g. us-east-1)."
  }
}

variable "create_permissions_boundary" {
  description = "Create and attach an IAM permissions boundary that caps the role (and can be attached to child instance roles)."
  type        = bool
  default     = true
}

variable "permissions_boundary_name" {
  description = "Name for the permissions boundary policy. Default: company-brain-lanyard-boundary-<project_name>."
  type        = string
  default     = null
}

variable "artifact_s3_bucket_arns" {
  description = <<-EOT
    Platform (or customer-mirror) S3 bucket ARNs the *deploy role* may read for plan-time validation
    and that instance roles should use for bootstrap (hermes/ + client-core/ prefixes).
    Empty skips S3 read statements on the deploy role (HTTPS artifact pins only).
    Shape: arn:aws:s3:::bucket-name
  EOT
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for a in var.artifact_s3_bucket_arns :
      can(regex("^arn:aws:s3:::[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", a))
    ])
    error_message = "artifact_s3_bucket_arns must be arn:aws:s3:::bucket-name entries."
  }
}

variable "artifact_s3_list_prefixes" {
  description = "s3:prefix values for ListBucket on artifact buckets. Defaults to hermes/ and client-core/ product prefixes."
  type        = list(string)
  default = [
    "hermes/",
    "hermes/*",
    "client-core/",
    "client-core/*",
  ]
}

variable "artifact_s3_object_arns" {
  description = "Optional explicit GetObject ARNs. Empty → bucket/hermes/* and bucket/client-core/* for each artifact_s3_bucket_arns entry."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for a in var.artifact_s3_object_arns :
      can(regex("^arn:aws:s3:::[a-z0-9].+", a))
    ])
    error_message = "artifact_s3_object_arns must be S3 object/prefix ARNs."
  }
}

variable "secret_path_prefix" {
  description = "SSM/Secrets Manager path prefix scoped to this tenant (leading slash required for SSM ARN construction)."
  type        = string
  default     = null

  validation {
    condition = (
      var.secret_path_prefix == null
      || can(regex("^/[A-Za-z0-9/_.+=@-]{1,200}$", var.secret_path_prefix))
    )
    error_message = "secret_path_prefix must start with / and use SSM-safe characters, or be null."
  }
}

variable "iam_path_prefix" {
  description = "IAM path prefix for roles/policies this deploy role may manage (instance/DLM roles)."
  type        = string
  default     = "/company-brain/"

  validation {
    condition     = can(regex("^/[A-Za-z0-9/_-]*/$", var.iam_path_prefix))
    error_message = "iam_path_prefix must start and end with / (e.g. /company-brain/)."
  }
}

variable "enable_deploy_permissions" {
  description = "Attach the least-privilege company-brain deploy policy (EC2/EBS/DLM/IAM-scoped/SSM/Secrets/artifacts)."
  type        = bool
  default     = true
}

variable "enable_cross_tenant_denies" {
  description = "Attach explicit Deny statements that block common cross-tenant and long-lived-key patterns."
  type        = bool
  default     = true
}

variable "additional_deny_resource_arns" {
  description = "Optional extra resource ARNs to deny (e.g. other tenants' KMS keys or state buckets known in this account)."
  type        = list(string)
  default     = []
}

variable "acknowledge_not_auto_applied" {
  description = "Honesty gate: module is infra_ready/contract — not live multi-account apply from git examples. Must be true."
  type        = bool

  validation {
    condition     = var.acknowledge_not_auto_applied == true
    error_message = "acknowledge_not_auto_applied must be true (Track B access is operator-applied, not auto from examples)."
  }
}

variable "extra_tags" {
  description = "Additional tags merged onto created IAM resources."
  type        = map(string)
  default     = {}
}
