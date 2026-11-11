# ---------------------------------------------------------------------------
# Naming / tags (placeholder-safe; no account IDs or secrets)
# ---------------------------------------------------------------------------

variable "name_prefix" {
  description = <<-EOT
    Short lowercase prefix for S3 origin, OAC, and CloudFront resource names.
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
# Origin bucket
# ---------------------------------------------------------------------------

variable "origin_bucket_name" {
  description = <<-EOT
    Globally unique S3 bucket name for the private static-web origin.
    Null → generated from name_prefix + random-looking placeholder-safe suffix pattern
    is NOT used; callers should pass an explicit unique name in private tfvars.
    When null, module derives "<name_prefix>-portal-web-origin" (must still be globally unique).
  EOT
  type        = string
  default     = null

  validation {
    condition = (
      var.origin_bucket_name == null ||
      can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.origin_bucket_name))
    )
    error_message = "origin_bucket_name must be a valid S3 bucket name (or null)."
  }

  validation {
    condition = (
      var.origin_bucket_name == null ||
      !can(regex("(unconfigured|changeme|TODO|FIXME)", lower(var.origin_bucket_name)))
    )
    error_message = "origin_bucket_name must not contain placeholder tokens."
  }
}

variable "force_destroy_origin_bucket" {
  description = "Allow destroy of non-empty origin bucket. Keep false for real environments."
  type        = bool
  default     = false
}

variable "origin_path" {
  description = <<-EOT
    Optional CloudFront origin path (no trailing slash), e.g. /v0.1.0 when static
    objects are uploaded under a version prefix. Empty string serves bucket root.
  EOT
  type        = string
  default     = ""

  validation {
    condition     = var.origin_path == "" || can(regex("^/[A-Za-z0-9._/-]+$", var.origin_path))
    error_message = "origin_path must be empty or start with / and contain safe path characters (no trailing slash required at end)."
  }
}

# ---------------------------------------------------------------------------
# Path-first topology (G0) — CloudFront behaviors ready for /<tenant_slug>
# ---------------------------------------------------------------------------

variable "default_root_object" {
  description = "Default root object for the distribution (SPA entry)."
  type        = string
  default     = "index.html"
}

variable "enable_spa_error_routing" {
  description = <<-EOT
    When true, map 403/404 from origin to 200 + index.html so path-first routes
    like /<tenant_slug> work for client-side navigation. API paths must not use
    this origin (BFF is a separate public edge).
  EOT
  type        = bool
  default     = true
}

variable "price_class" {
  description = "CloudFront price class."
  type        = string
  default     = "PriceClass_100"

  validation {
    condition     = contains(["PriceClass_100", "PriceClass_200", "PriceClass_All"], var.price_class)
    error_message = "price_class must be PriceClass_100, PriceClass_200, or PriceClass_All."
  }
}

variable "aliases" {
  description = "Optional alternate domain names (e.g. app.withlanyard.com). Requires acm_certificate_arn in us-east-1."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for a in var.aliases : can(regex("^[a-z0-9][a-z0-9.-]+[a-z0-9]$", a))
    ])
    error_message = "each aliases entry must look like a DNS hostname."
  }
}

variable "acm_certificate_arn" {
  description = <<-EOT
    ACM certificate ARN in us-east-1 for aliases. Required when aliases is non-empty.
    Null uses the default CloudFront certificate (*.cloudfront.net only).
  EOT
  type        = string
  default     = null

  validation {
    condition = (
      var.acm_certificate_arn == null ||
      can(regex("^arn:aws:acm:us-east-1:[0-9]{12}:certificate/.+", var.acm_certificate_arn))
    )
    error_message = "acm_certificate_arn must be null or an ACM ARN in us-east-1."
  }
}

variable "web_acl_id" {
  description = <<-EOT
    Optional WAFv2 WebACL ARN for this CloudFront distribution (CLOUDFRONT scope, us-east-1).
    Empty string → no WAF. Pass modules/portal-waf cloudfront_web_acl_arn when enabled.
    WAFv2 uses the full ARN in web_acl_id (not classic WAF ID).
  EOT
  type        = string
  default     = ""

  validation {
    condition = (
      var.web_acl_id == "" ||
      var.web_acl_id == null ||
      can(regex("^arn:aws:wafv2:us-east-1:[0-9]{12}:global/webacl/.+", var.web_acl_id))
    )
    error_message = "web_acl_id must be empty or a WAFv2 CloudFront (global) WebACL ARN in us-east-1."
  }
}

variable "minimum_protocol_version" {
  description = "CloudFront minimum TLS protocol when using a custom certificate."
  type        = string
  default     = "TLSv1.2_2021"
}

# ---------------------------------------------------------------------------
# Optional BFF origin — dual API path patterns → same BFF origin
# ---------------------------------------------------------------------------
# When bff_origin_domain_name is empty, the distribution has no BFF origin and
# no API ordered_cache_behavior (module still validates with examples).
# When set, CloudFront routes both:
#   - api_path_pattern (default /*/api/*) — path-first /<tenant_slug>/api/*
#   - bare_api_path_pattern (default /api/*) — apex public discovery APIs
# to the BFF custom origin with caching disabled and session cookies / auth
# headers forwarded. Do not remove path-first; bare alone would break tenant APIs.
# ---------------------------------------------------------------------------

variable "bff_origin_domain_name" {
  description = <<-EOT
    Optional BFF ALB (or custom) DNS name used as a CloudFront custom origin.
    Empty string → omit BFF origin and API cache behavior (static-only edge).
    Example: dualstack.internal-or-public-alb-xxxxxxxx.us-east-1.elb.amazonaws.com
    Do not put account IDs or secrets here; use private tfvars for real values.
  EOT
  type        = string
  default     = ""

  validation {
    condition = (
      var.bff_origin_domain_name == "" ||
      can(regex("^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$", var.bff_origin_domain_name))
    )
    error_message = "bff_origin_domain_name must be empty or a DNS hostname (no scheme, path, or port)."
  }

  validation {
    condition = (
      var.bff_origin_domain_name == "" ||
      !can(regex("(unconfigured|changeme|TODO|FIXME)", lower(var.bff_origin_domain_name)))
    )
    error_message = "bff_origin_domain_name must not contain placeholder tokens."
  }

  validation {
    condition = (
      var.bff_origin_domain_name == "" ||
      !can(regex("(?i)^(https?://|wss?://)", var.bff_origin_domain_name))
    )
    error_message = "bff_origin_domain_name must be a bare hostname (no https:// prefix)."
  }
}

variable "bff_origin_https_port" {
  description = "HTTPS port for the BFF custom origin (typically 443)."
  type        = number
  default     = 443

  validation {
    condition     = var.bff_origin_https_port > 0 && var.bff_origin_https_port < 65536
    error_message = "bff_origin_https_port must be a valid TCP port."
  }
}

variable "bff_origin_http_port" {
  description = "HTTP port for the BFF custom origin (used only if protocol policy allows http)."
  type        = number
  default     = 80

  validation {
    condition     = var.bff_origin_http_port > 0 && var.bff_origin_http_port < 65536
    error_message = "bff_origin_http_port must be a valid TCP port."
  }
}

variable "bff_origin_protocol_policy" {
  description = <<-EOT
    CloudFront → BFF origin protocol policy. Default https-only (BFF ALB terminates TLS).
    Use http-only only when the BFF ALB has no TLS listener (common on pilot staging);
    viewers still use HTTPS via CloudFront. Prefer https-only once the ALB has ACM.
  EOT
  type        = string
  default     = "https-only"

  validation {
    condition     = contains(["https-only", "http-only", "match-viewer"], var.bff_origin_protocol_policy)
    error_message = "bff_origin_protocol_policy must be https-only, http-only, or match-viewer."
  }
}

variable "api_path_pattern" {
  description = <<-EOT
    CloudFront ordered_cache_behavior path pattern for path-first API traffic.
    Default /*/api/* matches /<tenant_slug>/api/* without stripping the tenant slug.
    Path is forwarded to the BFF origin unchanged.
    Kept alongside bare_api_path_pattern; do not replace path-first with bare only.
  EOT
  type        = string
  default     = "/*/api/*"

  validation {
    condition     = can(regex("^[/A-Za-z0-9._*\\-]+$", var.api_path_pattern)) && length(var.api_path_pattern) >= 3
    error_message = "api_path_pattern must be a non-empty CloudFront path pattern (e.g. /*/api/*)."
  }
}

variable "bare_api_path_pattern" {
  description = <<-EOT
    Second CloudFront ordered_cache_behavior path pattern for bare (non path-first) API
    traffic. Default /api/* matches apex public discovery (e.g. POST /api/public/tenants/resolve)
    that never includes a tenant slug segment. Same BFF origin, cache policy, origin request
    policy, and allowed methods as api_path_pattern. Both behaviors sit above /assets/*.
  EOT
  type        = string
  default     = "/api/*"

  validation {
    condition     = can(regex("^[/A-Za-z0-9._*\\-]+$", var.bare_api_path_pattern)) && length(var.bare_api_path_pattern) >= 3
    error_message = "bare_api_path_pattern must be a non-empty CloudFront path pattern (e.g. /api/*)."
  }
}

variable "api_cache_policy_id" {
  description = <<-EOT
    Cache policy for API behavior. Default is AWS managed CachingDisabled
    (4135ea2d-6df8-44a3-9df3-4b5a84be39ad) so API responses are never cached
    across users/tenants at the edge.
  EOT
  type        = string
  default     = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"

  validation {
    condition     = can(regex("^[a-f0-9-]{36}$", var.api_cache_policy_id))
    error_message = "api_cache_policy_id must be a UUID (CloudFront cache policy id)."
  }
}

variable "api_origin_request_policy_id" {
  description = <<-EOT
    Origin request policy for API behavior. Default is AWS managed
    AllViewerExceptHostHeader (33f36d7e-f396-46d9-90e0-52428a34d9dc):
    forwards all viewer cookies, query strings, and headers (Authorization,
    CSRF tokens, etc.) except Host, so CloudFront sets Host to the BFF origin
    domain (correct for ALB default routing).
  EOT
  type        = string
  default     = "33f36d7e-f396-46d9-90e0-52428a34d9dc"

  validation {
    condition     = can(regex("^[a-f0-9-]{36}$", var.api_origin_request_policy_id))
    error_message = "api_origin_request_policy_id must be a UUID (CloudFront origin request policy id)."
  }
}

# ---------------------------------------------------------------------------
# Static web pin metadata (URL / version / SHA-256) — operator sync contract
# ---------------------------------------------------------------------------

variable "static_web_artifact_url" {
  description = <<-EOT
    Optional pin: published static web artifact URL (https:// or s3://).
    Module does not download at apply time; operators sync into the origin bucket
    per the staging apply runbook. Empty string when pins not yet available.
  EOT
  type        = string
  default     = ""

  validation {
    condition = (
      var.static_web_artifact_url == "" ||
      can(regex("^(https://|s3://)", var.static_web_artifact_url))
    )
    error_message = "static_web_artifact_url must be empty or start with https:// or s3:// (http:// rejected)."
  }

  validation {
    condition = (
      var.static_web_artifact_url == "" ||
      !can(regex("(?i)(http://|ws://)", var.static_web_artifact_url))
    )
    error_message = "static_web_artifact_url must not use http:// or ws://."
  }
}

variable "static_web_artifact_version" {
  description = "Optional immutable version label for the static web artifact (never main/master/HEAD/latest)."
  type        = string
  default     = ""

  validation {
    condition = (
      var.static_web_artifact_version == "" ||
      !contains(["main", "master", "HEAD", "develop", "latest"], var.static_web_artifact_version)
    )
    error_message = "static_web_artifact_version must not be a floating git ref (main/master/HEAD/develop/latest)."
  }
}

variable "static_web_artifact_sha256" {
  description = "Optional SHA-256 (64 hex or sha256: prefix) of the static web artifact."
  type        = string
  default     = ""

  validation {
    condition = (
      var.static_web_artifact_sha256 == "" ||
      can(regex("^(sha256:)?[a-fA-F0-9]{64}$", var.static_web_artifact_sha256))
    )
    error_message = "static_web_artifact_sha256 must be empty or 64 hex chars (optional sha256: prefix)."
  }
}

# ---------------------------------------------------------------------------
# Security response headers (CSP for ONLYOFFICE DocsAPI — lp-p37.3)
# ---------------------------------------------------------------------------

variable "content_security_policy" {
  description = <<-EOT
    Optional Content-Security-Policy value attached via CloudFront response headers
    policy on static web behaviors. Empty string → no CSP policy attached.

    When enabling ONLYOFFICE, include approved Document Server origins in script-src
    (must match VITE_ONLYOFFICE_DS_URL / VITE_ONLYOFFICE_DS_ALLOWED_ORIGINS used to
    build the web artifact). Example:

      default-src 'self'; script-src 'self' https://docs.example.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://docs.example.com; frame-src https://docs.example.com; connect-src 'self' https://docs.example.com; worker-src 'self' blob:; object-src 'none'; base-uri 'self'

    Never list untrusted or query-controlled origins. See operate-onlyoffice-document-server.md.
  EOT
  type        = string
  default     = ""

  validation {
    condition = (
      var.content_security_policy == "" ||
      length(var.content_security_policy) >= 12
    )
    error_message = "content_security_policy must be empty or a non-trivial CSP string."
  }
}

variable "onlyoffice_document_server_origins" {
  description = <<-EOT
    Optional list of ONLYOFFICE Document Server origins (https://host[:port]) used to
    document and optionally build script-src coverage. When content_security_policy is
    empty and this list is non-empty, the module synthesizes a baseline CSP that allows
    script-src/frame-src/connect-src from 'self' plus these origins (HTTPS only).
  EOT
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for o in var.onlyoffice_document_server_origins :
      can(regex("^https://[a-zA-Z0-9._-]+(:[0-9]+)?$", o))
    ])
    error_message = "onlyoffice_document_server_origins entries must be https://host or https://host:port (no trailing slash, no path)."
  }
}

# ---------------------------------------------------------------------------
# Honesty gate — real Terraform; production apply remains operator-owned
# ---------------------------------------------------------------------------

variable "acknowledge_not_auto_applied" {
  description = <<-EOT
    Must be true. Affirms the operator knows this module is deploy-owned infra that is not
    auto-applied from this repository's examples, and that production Portal edge still
    requires real static web pins (G7), private origin only, and staging apply evidence.
  EOT
  type        = bool
  default     = false

  validation {
    condition     = var.acknowledge_not_auto_applied == true
    error_message = "acknowledge_not_auto_applied must be true. modules/portal-static-edge is real Terraform but not auto-applied; operators apply from private roots after pins exist."
  }
}
