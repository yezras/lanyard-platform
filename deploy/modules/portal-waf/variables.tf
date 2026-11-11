# ---------------------------------------------------------------------------
# Naming / tags (placeholder-safe; no account IDs or secrets)
# ---------------------------------------------------------------------------

variable "name_prefix" {
  description = <<-EOT
    Short lowercase prefix for WebACL names and tags.
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
# Scope enable flags — create ACLs only when needed (default on when module used)
# ---------------------------------------------------------------------------

variable "enable_cloudfront_web_acl" {
  description = <<-EOT
    Create a CLOUDFRONT-scope WAFv2 WebACL in us-east-1 for Portal static edge.
    Callers attach via portal-static-edge.web_acl_id = cloudfront_web_acl_arn.
  EOT
  type        = bool
  default     = true
}

variable "enable_regional_web_acl" {
  description = <<-EOT
    Create a REGIONAL-scope WAFv2 WebACL for public BFF/relay ALBs.
    Associations are created only for non-empty associate_alb_arns entries.
  EOT
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------------
# AWS Managed Rules baseline + optional rate-based
# ---------------------------------------------------------------------------

variable "enable_common_rule_set" {
  description = "Attach AWSManagedRulesCommonRuleSet (core OWASP-style protections)."
  type        = bool
  default     = true
}

variable "enable_known_bad_inputs" {
  description = "Attach AWSManagedRulesKnownBadInputsRuleSet (log4j, bad paths, etc.)."
  type        = bool
  default     = true
}

variable "enable_rate_based_rule" {
  description = "Attach an optional rate-based rule that blocks abusive IP request rates."
  type        = bool
  default     = true
}

variable "rate_limit" {
  description = "Requests per 5-minute window per IP for the rate-based rule (when enabled)."
  type        = number
  default     = 2000

  validation {
    condition     = var.rate_limit >= 100 && var.rate_limit <= 2000000000
    error_message = "rate_limit must be between 100 and 2000000000 (WAF API bounds)."
  }
}

variable "managed_rule_override_action" {
  description = <<-EOT
    Override action for managed rule group containers: none (enforce) or count (observe only).
    Production baseline uses none; count is useful for initial enablement.
  EOT
  type        = string
  default     = "none"

  validation {
    condition     = contains(["none", "count"], var.managed_rule_override_action)
    error_message = "managed_rule_override_action must be none or count."
  }
}

variable "default_action" {
  description = "WebACL default action when no rule matches: allow (baseline with managed rules) or block."
  type        = string
  default     = "allow"

  validation {
    condition     = contains(["allow", "block"], var.default_action)
    error_message = "default_action must be allow or block."
  }
}

# ---------------------------------------------------------------------------
# ALB associations (regional only — CloudFront attaches via distribution web_acl_id)
# ---------------------------------------------------------------------------

variable "associate_alb_arns" {
  description = <<-EOT
    Regional ALB ARNs to associate with the regional WebACL (BFF and/or relay).
    Empty list → create ACL only (no associations). Invalid/placeholder ARNs rejected.
    Never associate the control-plane ALB (must stay internal / not public edge).
  EOT
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for a in var.associate_alb_arns :
      can(regex("^arn:aws:elasticloadbalancing:[a-z0-9-]+:[0-9]{12}:loadbalancer/app/.+", a))
    ])
    error_message = "each associate_alb_arns entry must be an application load balancer ARN."
  }

  validation {
    condition = alltrue([
      for a in var.associate_alb_arns :
      !can(regex("(unconfigured|changeme|TODO|FIXME|example)", lower(a)))
    ])
    error_message = "associate_alb_arns must not contain placeholder tokens."
  }
}

# ---------------------------------------------------------------------------
# Honesty gate
# ---------------------------------------------------------------------------

variable "acknowledge_not_auto_applied" {
  description = <<-EOT
    Must be true. Affirms the operator knows this module is deploy-owned infra that is not
    auto-applied from this repository's examples, and that production WAF still requires
    edge ARNs, staging enablement, and monitoring of blocked metrics.
  EOT
  type        = bool
  default     = false

  validation {
    condition     = var.acknowledge_not_auto_applied == true
    error_message = "acknowledge_not_auto_applied must be true. modules/portal-waf is real Terraform but not auto-applied; operators apply from private roots after edges exist."
  }
}
