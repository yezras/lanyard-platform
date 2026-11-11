# ---------------------------------------------------------------------------
# Naming (placeholder-safe; no account IDs or secrets)
# ---------------------------------------------------------------------------

variable "name_prefix" {
  description = <<-EOT
    Short lowercase prefix for IAM role/policy names and tags.
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
# S3 chat corpus bucket (separate from vault — blast radius)
# ---------------------------------------------------------------------------

variable "corpus_bucket_name" {
  description = <<-EOT
    Globally unique S3 bucket name for the L10 chat corpus.
    Prefer a dedicated bucket (not the vault bucket) to limit blast radius.
    Example shape: lanyard-chat-corpus-lab-REPLACE.
  EOT
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.corpus_bucket_name))
    error_message = "corpus_bucket_name must be a valid S3 bucket name (3–63 chars, lowercase)."
  }

  validation {
    condition     = !can(regex("(unconfigured|changeme|TODO|FIXME)", lower(var.corpus_bucket_name)))
    error_message = "corpus_bucket_name must not contain placeholder tokens (UNCONFIGURED, changeme, TODO, FIXME). REPLACE is allowed only as a deliberate suffix marker operators must change before apply."
  }
}

variable "corpus_prefix_template" {
  description = <<-EOT
    Object key prefix template under the corpus bucket. Product path is
    tenants/{tenant_id}/chat-corpus/v1/ (see docs/plans/0011-tenant-chat-corpus/).
    Template uses {tenant_id}; module IAM scopes allow tenants/*/chat-corpus/v1/*
    for platform writer/reader roles (per-tenant STS sessions may tighten further).
  EOT
  type        = string
  default     = "tenants/{tenant_id}/chat-corpus/v1/"

  validation {
    condition = (
      can(regex("^tenants/\\{tenant_id\\}/chat-corpus/v1/$", var.corpus_prefix_template))
    )
    error_message = "corpus_prefix_template must be exactly tenants/{tenant_id}/chat-corpus/v1/ for v1."
  }
}

variable "s3_force_destroy" {
  description = "Allow bucket destroy when non-empty. Keep false for real environments."
  type        = bool
  default     = false
}

variable "s3_versioning_enabled" {
  description = "Enable S3 versioning on the corpus bucket (recommended for accidental overwrite recovery)."
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------------
# Encryption
# ---------------------------------------------------------------------------

variable "s3_sse_algorithm" {
  description = <<-EOT
    Server-side encryption algorithm (AES256 or aws:kms).
    AES256 (SSE-S3) is the lab-safe default. Prefer customer-managed CMK for prod.
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
    Leave null for AES256. For CMK, align key policy with writer + reader principals.
  EOT
  type        = string
  default     = null
}

variable "create_kms_key" {
  description = <<-EOT
    When true and s3_sse_algorithm is aws:kms and s3_kms_key_id is null, create a
    dedicated CMK for this corpus bucket (recommended for prod isolation from vault KMS).
  EOT
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# Lifecycle / retention (L10 defaults from lp-gkh.1)
# ---------------------------------------------------------------------------

variable "retention_days" {
  description = <<-EOT
    Expire current corpus objects after N days (L10 default 90 when enabled).
    Per-tenant overrides (chat_corpus_retention_days) may require additional
    prefix-scoped lifecycle rules applied by ops; this module sets the bucket
    default on the chat-corpus/ prefix. Minimum 30 days per L10 policy floor.
  EOT
  type        = number
  default     = 90

  validation {
    condition     = var.retention_days >= 30 && var.retention_days <= 36500
    error_message = "retention_days must be between 30 (L10 floor) and 36500."
  }
}

variable "s3_noncurrent_version_expiration_days" {
  description = "Expire noncurrent object versions after N days. Set 0 to disable. Prefer >= retention_days when versioning is on."
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

# ---------------------------------------------------------------------------
# IAM roles (writer = CorpusWriter PutObject; reader = training export)
# ---------------------------------------------------------------------------

variable "create_iam_roles" {
  description = "Create dedicated writer and reader IAM roles + policies. Set false to export policy documents only."
  type        = bool
  default     = true
}

variable "writer_principal_arns" {
  description = <<-EOT
    IAM principal ARNs allowed to assume the corpus writer role (e.g. BFF task role,
    Portal service role). Empty list makes the writer role unassumable until set —
    fail-closed. Never commit live account IDs in examples; use REPLACE placeholders.
  EOT
  type        = list(string)
  default     = []
}

variable "reader_principal_arns" {
  description = <<-EOT
    IAM principal ARNs allowed to assume the corpus reader (training export) role.
    Empty list makes the reader role unassumable until set — fail-closed.
  EOT
  type        = list(string)
  default     = []
}

variable "vault_object_arn_patterns" {
  description = <<-EOT
    Object ARN patterns that corpus roles must never access (blast-radius wall).
    Defaults deny vault trees under the *vault* bucket name patterns operators
    may share, and also any tenants/*/vault/* keys if someone mistakenly colocates.
    Corpus roles also deny tenants/*/vault/* on the corpus bucket itself.
  EOT
  type        = list(string)
  default = [
    "arn:aws:s3:::*/tenants/*/vault",
    "arn:aws:s3:::*/tenants/*/vault/*",
  ]
}
