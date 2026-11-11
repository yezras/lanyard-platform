# ---------------------------------------------------------------------------
# Naming (placeholder-safe; no account IDs or secrets)
# ---------------------------------------------------------------------------

variable "name_prefix" {
  description = <<-EOT
    Short lowercase prefix for resource names (ECR repo path segment, IAM role names, tags).
    Must not contain account IDs or secrets. Example: lanyard-platform-staging.
  EOT
  type        = string

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
# S3 product artifact bucket (Hermes + client-core + portal-web tarballs)
# ---------------------------------------------------------------------------

variable "artifact_bucket_name" {
  description = <<-EOT
    Globally unique S3 bucket name for versioned product release tarballs.
    Use a deliberate DNS-safe name; do not invent real production names in docs.
    Example shape: lanyard-product-artifacts-staging-REPLACE.
  EOT
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.artifact_bucket_name))
    error_message = "artifact_bucket_name must be a valid S3 bucket name (3–63 chars, lowercase)."
  }

  validation {
    condition     = !can(regex("(unconfigured|changeme|TODO|FIXME)", lower(var.artifact_bucket_name)))
    error_message = "artifact_bucket_name must not contain placeholder tokens (UNCONFIGURED, changeme, TODO, FIXME). REPLACE is allowed only as a deliberate suffix marker operators must change before apply."
  }
}

variable "artifact_prefixes" {
  description = <<-EOT
    Object key prefixes for product tarballs inside the artifact bucket.
    Publishers write only under these prefixes; consumers (brain hosts / edge modules) read them.
    Defaults match the deploy pin URL shape: hermes/<version>/…, client-core/<version>/…,
    and portal-web/<version>/portal-web.tar.gz.
  EOT
  type = object({
    hermes      = optional(string, "hermes/")
    client_core = optional(string, "client-core/")
    portal_web  = optional(string, "portal-web/")
  })
  default = {}

  validation {
    condition = (
      endswith(coalesce(var.artifact_prefixes.hermes, "hermes/"), "/") &&
      endswith(coalesce(var.artifact_prefixes.client_core, "client-core/"), "/") &&
      endswith(coalesce(var.artifact_prefixes.portal_web, "portal-web/"), "/") &&
      !startswith(coalesce(var.artifact_prefixes.hermes, "hermes/"), "/") &&
      !startswith(coalesce(var.artifact_prefixes.client_core, "client-core/"), "/") &&
      !startswith(coalesce(var.artifact_prefixes.portal_web, "portal-web/"), "/")
    )
    error_message = "artifact_prefixes must be relative keys ending with / and not starting with /."
  }
}

variable "s3_force_destroy" {
  description = <<-EOT
    Allow bucket destroy when non-empty. Keep false for real environments.
    Object Lock retention still blocks deletion of locked object versions even when true;
    force_destroy alone cannot bypass compliance/governance retention.
  EOT
  type        = bool
  default     = false
}

variable "s3_object_lock_default_retention_mode" {
  description = <<-EOT
    Default S3 Object Lock retention mode applied to new objects in the artifact bucket.
    GOVERNANCE (default) blocks overwrite/delete of locked versions for most principals but
    allows break-glass with s3:BypassGovernanceRetention. COMPLIANCE cannot be shortened or
    bypassed by any principal including the root account until retention expires.
  EOT
  type        = string
  default     = "GOVERNANCE"

  validation {
    condition     = contains(["GOVERNANCE", "COMPLIANCE"], var.s3_object_lock_default_retention_mode)
    error_message = "s3_object_lock_default_retention_mode must be GOVERNANCE or COMPLIANCE."
  }
}

variable "s3_object_lock_default_retention_days" {
  description = <<-EOT
    Default Object Lock retention period in days for new artifact objects.
    Safe default is 90 days. Lifecycle noncurrent-version expiration cannot remove a locked
    version until this retention window ends (Object Lock takes precedence over lifecycle).
  EOT
  type        = number
  default     = 90

  validation {
    condition     = var.s3_object_lock_default_retention_days >= 1 && var.s3_object_lock_default_retention_days <= 36500
    error_message = "s3_object_lock_default_retention_days must be between 1 and 36500."
  }
}

variable "s3_noncurrent_version_expiration_days" {
  description = <<-EOT
    Expire noncurrent object versions after N days (versioning remains on). Set 0 to disable this rule.
    Interaction with Object Lock: lifecycle cannot delete a noncurrent version still under
    retention. Prefer expiration_days >= s3_object_lock_default_retention_days so lifecycle
    eventually cleans up after lock expiry; shorter values simply wait until retention ends.
  EOT
  type        = number
  default     = 90

  validation {
    condition     = var.s3_noncurrent_version_expiration_days == 0 || var.s3_noncurrent_version_expiration_days >= 7
    error_message = "s3_noncurrent_version_expiration_days must be 0 (disabled) or >= 7."
  }
}

variable "s3_abort_incomplete_multipart_days" {
  description = "Abort incomplete multipart uploads after N days."
  type        = number
  default     = 7

  validation {
    condition     = var.s3_abort_incomplete_multipart_days >= 1 && var.s3_abort_incomplete_multipart_days <= 30
    error_message = "s3_abort_incomplete_multipart_days must be between 1 and 30."
  }
}

variable "s3_sse_algorithm" {
  description = <<-EOT
    Server-side encryption algorithm for the artifact bucket (AES256 or aws:kms).
    AES256 (SSE-S3) is the safe default. For aws:kms, prefer a customer-managed CMK
    via s3_kms_key_id and grant least-privilege key policy to publisher roles and
    brain-host instance readers (see README "KMS key policy").
  EOT
  type        = string
  default     = "AES256"

  validation {
    condition     = contains(["AES256", "aws:kms"], var.s3_sse_algorithm)
    error_message = "s3_sse_algorithm must be AES256 or aws:kms."
  }
}

variable "s3_kms_key_id" {
  description = <<-EOT
    KMS key ARN or key id when s3_sse_algorithm is aws:kms.
    Leave null only for AES256, or when deliberately using the AWS-managed aws/s3 key
    (weaker control plane; not recommended for prod). For customer-managed keys, set
    the full key ARN and align the key policy with publisher + reader principals
    (see README "KMS key policy").
  EOT
  type        = string
  default     = null
}

variable "s3_vpc_endpoint_ids" {
  description = <<-EOT
    Optional list of S3 VPC endpoint IDs (vpce-…). When non-empty, the bucket policy
    denies s3:* unless aws:SourceVpce is one of these IDs — except principals listed
    in s3_vpc_endpoint_exempt_principal_arns and (when OIDC publishers are enabled)
    the module-created publisher roles.

    Advanced mode. Default [] leaves the bucket reachable over the public S3 API
    (still private: public access block + IAM). Enable only when brain-host consumers
    reach S3 via Gateway/Interface VPC endpoints and you have exempted every
    operator/admin principal that must manage objects outside those endpoints.
    Do not invent live vpce- IDs in committed examples.
  EOT
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for id in var.s3_vpc_endpoint_ids :
      can(regex("^vpce-[a-z0-9]+$", id))
    ])
    error_message = "s3_vpc_endpoint_ids entries must look like vpce-<hex/alphanumeric> (no account IDs or ARNs)."
  }
}

variable "s3_vpc_endpoint_exempt_principal_arns" {
  description = <<-EOT
    IAM principal ARNs exempt from the optional VPC-endpoint restriction
    (s3_vpc_endpoint_ids). Use for operator admin roles, break-glass roles, and any
    reader/writer that must use the public S3 API. OIDC publisher roles created by
    this module are auto-appended when enable_oidc_publishers is true — do not omit
    admin roles or you can lock console/CLI management of the bucket.
    Leave empty when s3_vpc_endpoint_ids is empty. Never commit live account IDs.
  EOT
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for arn in var.s3_vpc_endpoint_exempt_principal_arns :
      can(regex("^arn:aws:iam::[0-9]{12}:(root|user/.+|role/.+|assumed-role/.+)$", arn)) ||
      can(regex("^arn:aws:sts::[0-9]{12}:assumed-role/.+$", arn))
    ])
    error_message = "s3_vpc_endpoint_exempt_principal_arns must be IAM/STS principal ARNs (use real values only at apply time; never invent account IDs in git examples)."
  }
}

# ---------------------------------------------------------------------------
# ECR — Portal service images (digest-pinned at deploy time)
# ---------------------------------------------------------------------------

variable "portal_services" {
  description = <<-EOT
    Portal monorepo services that get private ECR repositories with IMMUTABLE image tags.
    Deploy pins still require digests (compatibility/); tags are human labels only.
  EOT
  type        = list(string)
  default     = ["web", "bff", "relay", "control-plane"]

  validation {
    condition = (
      length(var.portal_services) >= 1 &&
      alltrue([for s in var.portal_services : can(regex("^[a-z][a-z0-9-]{0,62}$", s))])
    )
    error_message = "portal_services must be non-empty; each name lowercase alphanumeric/hyphen."
  }
}

variable "ecr_scan_on_push" {
  description = "Enable ECR image scanning on push."
  type        = bool
  default     = true
}

variable "ecr_image_count_limit" {
  description = "Lifecycle: keep at most this many images per repository (expire oldest)."
  type        = number
  default     = 50

  validation {
    condition     = var.ecr_image_count_limit >= 5 && var.ecr_image_count_limit <= 500
    error_message = "ecr_image_count_limit must be between 5 and 500."
  }
}

# ---------------------------------------------------------------------------
# Optional GitHub Actions OIDC publishers (require existing OIDC provider ARN)
# ---------------------------------------------------------------------------

variable "enable_oidc_publishers" {
  description = <<-EOT
    When true, create least-privilege IAM roles for product-repo GitHub Actions publishers.
    Requires github_oidc_provider_arn to point at an *existing* IAM OIDC provider
    (do not create a duplicate provider in this module).
  EOT
  type        = bool
  default     = false
}

variable "github_oidc_provider_arn" {
  description = <<-EOT
    ARN of an existing IAM OIDC provider for token.actions.githubusercontent.com.
    Required when enable_oidc_publishers is true. This module never creates the provider.
  EOT
  type        = string
  default     = null

  validation {
    condition = (
      var.github_oidc_provider_arn == null ||
      can(regex("^arn:aws:iam::[0-9]{12}:oidc-provider/token\\.actions\\.githubusercontent\\.com$", var.github_oidc_provider_arn))
    )
    error_message = "github_oidc_provider_arn must be null or arn:aws:iam::<12-digit-account>:oidc-provider/token.actions.githubusercontent.com (use a real existing provider ARN at apply time; never commit live account IDs)."
  }
}

variable "github_org" {
  description = "GitHub organization for default trust subjects."
  type        = string
  default     = "LanyardBrain"

  validation {
    condition     = can(regex("^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$", var.github_org))
    error_message = "github_org must be a valid GitHub org/user name."
  }
}

variable "publisher_repos" {
  description = <<-EOT
    Map of product publishers. Keys are stable role suffixes (portal, hermes, client_core).
    Each entry scopes S3 write prefixes and/or ECR push repositories.
    Default trust subjects are release tags only (ref:refs/tags/*) for the three product repos.
    Override subjects for emergency branches only; never default to main/master push.
  EOT
  type = map(object({
    # GitHub repository name within github_org (e.g. Portal, hermes-lanyard, client-core)
    repository = string
    # OIDC sub claim patterns; default: repo:ORG/REPO:ref:refs/tags/*
    subjects = optional(list(string), [])
    # Which S3 product prefixes this role may write (keys of artifact_prefixes: hermes, client_core, portal_web)
    s3_write_prefix_keys = optional(list(string), [])
    # Which portal_services ECR repos this role may push (empty = none)
    ecr_push_services = optional(list(string), [])
  }))
  default = {
    portal = {
      repository           = "Portal"
      subjects             = []
      s3_write_prefix_keys = ["portal_web"]
      ecr_push_services    = ["web", "bff", "relay", "control-plane"]
    }
    hermes = {
      repository           = "hermes-lanyard"
      subjects             = []
      s3_write_prefix_keys = ["hermes"]
      ecr_push_services    = []
    }
    client_core = {
      repository           = "client-core"
      subjects             = []
      s3_write_prefix_keys = ["client_core"]
      ecr_push_services    = []
    }
  }

  validation {
    condition = alltrue([
      for k, v in var.publisher_repos :
      can(regex("^[A-Za-z0-9._-]+$", v.repository))
    ])
    error_message = "Each publisher_repos.*.repository must be a valid GitHub repo name."
  }

  validation {
    condition = alltrue(flatten([
      for k, v in var.publisher_repos : [
        for p in coalesce(v.s3_write_prefix_keys, []) : contains(["hermes", "client_core", "portal_web"], p)
      ]
    ]))
    error_message = "s3_write_prefix_keys entries must be hermes, client_core, or portal_web."
  }
}

variable "oidc_max_session_seconds" {
  description = "Max session duration for OIDC publisher roles."
  type        = number
  default     = 3600

  validation {
    condition     = var.oidc_max_session_seconds >= 900 && var.oidc_max_session_seconds <= 14400
    error_message = "oidc_max_session_seconds must be between 900 and 14400."
  }
}
