# ---------------------------------------------------------------------------
# Naming / tags (placeholder-safe; no account IDs or secrets)
# ---------------------------------------------------------------------------

variable "name_prefix" {
  description = <<-EOT
    Short lowercase prefix for ACM certificate tags and optional zone name tags.
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
# Hostnames (bare FQDNs only — no schemes, no paths, no ports)
# ---------------------------------------------------------------------------

variable "portal_web_hostname" {
  description = <<-EOT
    Public hostname for Portal static edge (CloudFront alias), e.g. app.example.com.
    Empty string → skip CloudFront certificate and web alias record.
    Must be a bare hostname (https:// / wss:// / http:// / ws:// rejected).
  EOT
  type        = string
  default     = ""

  validation {
    condition = (
      var.portal_web_hostname == "" ||
      can(regex("^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$", var.portal_web_hostname))
    )
    error_message = "portal_web_hostname must be empty or a lowercase DNS hostname."
  }

  validation {
    condition = (
      var.portal_web_hostname == "" ||
      !can(regex("(?i)^(https?://|wss?://)", var.portal_web_hostname))
    )
    error_message = "portal_web_hostname must be a bare hostname (no https://, http://, wss://, or ws://)."
  }

  validation {
    condition = (
      var.portal_web_hostname == "" ||
      !can(regex("(unconfigured|changeme|TODO|FIXME)", lower(var.portal_web_hostname)))
    )
    error_message = "portal_web_hostname must not contain placeholder tokens."
  }
}

variable "bff_hostname" {
  description = <<-EOT
    Public hostname for BFF ALB HTTPS, e.g. api.example.com.
    Empty string → omit from regional certificate SAN list and skip BFF alias.
    Bare hostname only (insecure schemes rejected).
  EOT
  type        = string
  default     = ""

  validation {
    condition = (
      var.bff_hostname == "" ||
      can(regex("^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$", var.bff_hostname))
    )
    error_message = "bff_hostname must be empty or a lowercase DNS hostname."
  }

  validation {
    condition = (
      var.bff_hostname == "" ||
      !can(regex("(?i)^(https?://|wss?://)", var.bff_hostname))
    )
    error_message = "bff_hostname must be a bare hostname (no scheme)."
  }

  validation {
    condition = (
      var.bff_hostname == "" ||
      !can(regex("(unconfigured|changeme|TODO|FIXME)", lower(var.bff_hostname)))
    )
    error_message = "bff_hostname must not contain placeholder tokens."
  }
}

variable "relay_hostname" {
  description = <<-EOT
    Public hostname for relay ALB HTTPS / WSS edge, e.g. relay.example.com.
    Empty string → omit from regional certificate SAN list and skip relay alias.
    Bare hostname only. Clients must use wss:// (not ws://) — see tls_posture output.
  EOT
  type        = string
  default     = ""

  validation {
    condition = (
      var.relay_hostname == "" ||
      can(regex("^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$", var.relay_hostname))
    )
    error_message = "relay_hostname must be empty or a lowercase DNS hostname."
  }

  validation {
    condition = (
      var.relay_hostname == "" ||
      !can(regex("(?i)^(https?://|wss?://)", var.relay_hostname))
    )
    error_message = "relay_hostname must be a bare hostname (no scheme)."
  }

  validation {
    condition = (
      var.relay_hostname == "" ||
      !can(regex("(unconfigured|changeme|TODO|FIXME)", lower(var.relay_hostname)))
    )
    error_message = "relay_hostname must not contain placeholder tokens."
  }
}

variable "document_server_hostname" {
  description = <<-EOT
    Public hostname for staging Document Server ALB HTTPS, e.g. docs.staging.example.com.
    Empty string → omit from regional certificate SAN list.
    When set, the regional ACM cert covers this name so Docs ALB enable_https can use the
    shared regional cert (lp-zuh.12.2 MockLab HTTPS path). Bare hostname only.
    Route53 alias for Docs is owned by platform-staging (not this module) to avoid cycles.
  EOT
  type        = string
  default     = ""

  validation {
    condition = (
      var.document_server_hostname == "" ||
      can(regex("^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$", var.document_server_hostname))
    )
    error_message = "document_server_hostname must be empty or a lowercase DNS hostname."
  }

  validation {
    condition = (
      var.document_server_hostname == "" ||
      !can(regex("(?i)^(https?://|wss?://)", var.document_server_hostname))
    )
    error_message = "document_server_hostname must be a bare hostname (no scheme)."
  }

  validation {
    condition = (
      var.document_server_hostname == "" ||
      !can(regex("(unconfigured|changeme|TODO|FIXME)", lower(var.document_server_hostname)))
    )
    error_message = "document_server_hostname must not contain placeholder tokens."
  }
}

# ---------------------------------------------------------------------------
# Route53 hosted zone — consume existing (preferred) or optionally create
# ---------------------------------------------------------------------------

variable "create_route53_zone" {
  description = <<-EOT
    When true, create a public Route53 hosted zone for route53_zone_name.
    Prefer false and pass an existing route53_zone_id to avoid duplicate zones.
  EOT
  type        = bool
  default     = false
}

variable "route53_zone_id" {
  description = <<-EOT
    Existing public hosted zone ID (Z…). Required when create_route53_zone=false and
    any certificate validation or DNS alias records are created.
    Null is allowed only when create_route53_zone=true or no DNS work is requested.
  EOT
  type        = string
  default     = null

  validation {
    condition = (
      var.route53_zone_id == null ||
      can(regex("^Z[A-Z0-9]+$", var.route53_zone_id))
    )
    error_message = "route53_zone_id must be null or a Route53 hosted zone ID (Z…)."
  }

  validation {
    condition = (
      var.route53_zone_id == null ||
      !can(regex("(unconfigured|changeme|TODO|FIXME|example)", lower(var.route53_zone_id)))
    )
    error_message = "route53_zone_id must not contain placeholder tokens."
  }
}

variable "route53_zone_name" {
  description = <<-EOT
    DNS zone apex name (e.g. example.com). Required when create_route53_zone=true.
    Optional documentation when using an existing zone.
  EOT
  type        = string
  default     = ""

  validation {
    condition = (
      var.route53_zone_name == "" ||
      can(regex("^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$", var.route53_zone_name))
    )
    error_message = "route53_zone_name must be empty or a lowercase DNS zone name."
  }

  validation {
    condition = (
      var.route53_zone_name == "" ||
      !can(regex("(?i)^(https?://|wss?://)", var.route53_zone_name))
    )
    error_message = "route53_zone_name must not include a URL scheme."
  }
}

variable "create_dns_records" {
  description = <<-EOT
    When true, create Route53 alias A/AAAA records for hostnames that have targets.
    Certificate DNS validation records are always created when this module issues certs
    (requires a zone). Set false to issue certs only and manage aliases out-of-band.
  EOT
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------------
# Certificates — create OR pass existing ARNs (no duplicates)
# ---------------------------------------------------------------------------

variable "existing_cloudfront_certificate_arn" {
  description = <<-EOT
    Existing ACM certificate ARN in us-east-1 for CloudFront.
    When set, this module does not create a CloudFront certificate (avoids duplicates).
    When null and portal_web_hostname is set, module creates + validates a us-east-1 cert
    via the aws.us_east_1 provider alias.
  EOT
  type        = string
  default     = null

  validation {
    condition = (
      var.existing_cloudfront_certificate_arn == null ||
      can(regex("^arn:aws:acm:us-east-1:[0-9]{12}:certificate/.+", var.existing_cloudfront_certificate_arn))
    )
    error_message = "existing_cloudfront_certificate_arn must be null or an ACM ARN in us-east-1."
  }
}

variable "existing_regional_certificate_arn" {
  description = <<-EOT
    Existing ACM certificate ARN in the regional provider region for BFF/relay ALB HTTPS.
    When set, this module does not create a regional certificate.
    When null and bff_hostname or relay_hostname is set, module creates + validates a
    regional cert covering those hostnames as SANs.
  EOT
  type        = string
  default     = null

  validation {
    condition = (
      var.existing_regional_certificate_arn == null ||
      can(regex("^arn:aws:acm:[a-z0-9-]+:[0-9]{12}:certificate/.+", var.existing_regional_certificate_arn))
    )
    error_message = "existing_regional_certificate_arn must be null or an ACM certificate ARN."
  }
}

variable "certificate_validation_method" {
  description = "ACM domain validation method. DNS is required for automated Route53 validation."
  type        = string
  default     = "DNS"

  validation {
    condition     = var.certificate_validation_method == "DNS"
    error_message = "certificate_validation_method must be DNS (EMAIL is not supported by this module)."
  }
}

# ---------------------------------------------------------------------------
# Alias targets (optional — empty skips that alias record)
# ---------------------------------------------------------------------------

variable "cloudfront_domain_name" {
  description = <<-EOT
    CloudFront distribution domain name (dxxx.cloudfront.net) for the web alias.
    Empty → skip portal_web_hostname alias (cert may still be created for later wiring).
  EOT
  type        = string
  default     = ""

  validation {
    condition = (
      var.cloudfront_domain_name == "" ||
      can(regex("^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$", var.cloudfront_domain_name))
    )
    error_message = "cloudfront_domain_name must be empty or a DNS hostname."
  }
}

variable "cloudfront_hosted_zone_id" {
  description = "CloudFront Route53 hosted zone ID for alias records (from distribution output)."
  type        = string
  default     = ""

  validation {
    condition = (
      var.cloudfront_hosted_zone_id == "" ||
      can(regex("^Z[A-Z0-9]+$", var.cloudfront_hosted_zone_id))
    )
    error_message = "cloudfront_hosted_zone_id must be empty or a Route53 zone ID (Z…)."
  }
}

variable "bff_alb_dns_name" {
  description = "BFF ALB DNS name for the bff_hostname alias. Empty → skip BFF alias."
  type        = string
  default     = ""

  validation {
    condition = (
      var.bff_alb_dns_name == "" ||
      can(regex("^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$", var.bff_alb_dns_name))
    )
    error_message = "bff_alb_dns_name must be empty or a DNS hostname."
  }
}

variable "bff_alb_zone_id" {
  description = "BFF ALB canonical hosted zone ID for alias records."
  type        = string
  default     = ""

  validation {
    condition = (
      var.bff_alb_zone_id == "" ||
      can(regex("^Z[A-Z0-9]+$", var.bff_alb_zone_id))
    )
    error_message = "bff_alb_zone_id must be empty or a Route53 zone ID (Z…)."
  }
}

variable "relay_alb_dns_name" {
  description = "Relay ALB DNS name for the relay_hostname alias. Empty → skip relay alias."
  type        = string
  default     = ""

  validation {
    condition = (
      var.relay_alb_dns_name == "" ||
      can(regex("^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$", var.relay_alb_dns_name))
    )
    error_message = "relay_alb_dns_name must be empty or a DNS hostname."
  }
}

variable "relay_alb_zone_id" {
  description = "Relay ALB canonical hosted zone ID for alias records."
  type        = string
  default     = ""

  validation {
    condition = (
      var.relay_alb_zone_id == "" ||
      can(regex("^Z[A-Z0-9]+$", var.relay_alb_zone_id))
    )
    error_message = "relay_alb_zone_id must be empty or a Route53 zone ID (Z…)."
  }
}

# ---------------------------------------------------------------------------
# Honesty gate
# ---------------------------------------------------------------------------

variable "acknowledge_not_auto_applied" {
  description = <<-EOT
    Must be true. Affirms the operator knows this module is deploy-owned infra that is not
    auto-applied from this repository's examples, and that production DNS/TLS still requires
    real hostnames, an owned hosted zone, and staging apply evidence.
  EOT
  type        = bool
  default     = false

  validation {
    condition     = var.acknowledge_not_auto_applied == true
    error_message = "acknowledge_not_auto_applied must be true. modules/portal-dns-tls is real Terraform but not auto-applied; operators apply from private roots after hostnames/zones exist."
  }
}
