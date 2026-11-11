output "origin_bucket_id" {
  description = "Private S3 origin bucket name (not public)."
  value       = aws_s3_bucket.origin.id
}

output "origin_bucket_arn" {
  description = "Private S3 origin bucket ARN."
  value       = aws_s3_bucket.origin.arn
}

output "origin_bucket_regional_domain_name" {
  description = "Regional domain name used as CloudFront origin."
  value       = aws_s3_bucket.origin.bucket_regional_domain_name
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID."
  value       = aws_cloudfront_distribution.web.id
}

output "cloudfront_distribution_arn" {
  description = "CloudFront distribution ARN (used in OAC bucket policy condition)."
  value       = aws_cloudfront_distribution.web.arn
}

output "cloudfront_domain_name" {
  description = "CloudFront domain name (*.cloudfront.net or custom aliases)."
  value       = aws_cloudfront_distribution.web.domain_name
}

output "cloudfront_hosted_zone_id" {
  description = "CloudFront Route53 zone ID for alias records."
  value       = aws_cloudfront_distribution.web.hosted_zone_id
}

output "web_acl_id" {
  description = "WAFv2 WebACL ARN attached to this distribution (null/empty when none)."
  value       = var.web_acl_id != null && var.web_acl_id != "" ? var.web_acl_id : null
}

output "origin_access_control_id" {
  description = "CloudFront OAC ID (SigV4 to private S3)."
  value       = aws_cloudfront_origin_access_control.origin.id
}

output "static_web_pin" {
  description = "Operator pin metadata for the static web artifact (not auto-downloaded)."
  value = {
    url     = var.static_web_artifact_url
    version = var.static_web_artifact_version
    sha256  = var.static_web_artifact_sha256
    note    = "Sync published artifact into origin bucket; verify SHA-256 before promote. See references/runbooks/portal-compute-staging-apply.md"
  }
}

output "path_first_topology" {
  description = "G0 path-first routing notes for operators."
  value = {
    canonical_web_entry   = "https://app.withlanyard.com/<tenant_slug>"
    ops_console_entry     = "https://app.withlanyard.com/admin"
    ops_spa_path_pattern  = "/admin*"
    static_origin         = "private S3 via CloudFront OAC only"
    spa_error_routing     = var.enable_spa_error_routing
    api_path_pattern      = var.api_path_pattern
    bare_api_path_pattern = var.bare_api_path_pattern
    api_origin            = local.bff_origin_enabled ? "bff_custom_origin" : "not_configured"
    api_routing = (
      local.bff_origin_enabled
      ? "CloudFront ordered_cache_behavior ${var.api_path_pattern} and ${var.bare_api_path_pattern} → BFF origin (not S3); caching disabled"
      : "set bff_origin_domain_name to enable /*/api/* and /api/* → BFF; until then API must not use this static origin alone"
    )
  }
}

output "bff_api_routing" {
  description = "BFF API origin wiring status (optional; empty domain omits API behaviors)."
  value = {
    enabled            = local.bff_origin_enabled
    origin_id          = local.bff_origin_enabled ? local.bff_origin_id : null
    origin_domain_name = local.bff_origin_enabled ? var.bff_origin_domain_name : null
    path_pattern       = var.api_path_pattern
    bare_path_pattern  = var.bare_api_path_pattern
    path_patterns = [
      var.api_path_pattern,
      var.bare_api_path_pattern,
    ]
    cache_policy_id          = var.api_cache_policy_id
    origin_request_policy_id = var.api_origin_request_policy_id
    path_preserved           = true
    notes = [
      "Dual API ordered_cache_behavior blocks target portal-bff, never portal-static-s3",
      "path-first ${var.api_path_pattern} preserves /<tenant_slug>/api/* tenant APIs",
      "bare ${var.bare_api_path_pattern} routes apex public discovery (e.g. /api/public/*) to BFF",
      "/admin* ordered_cache_behavior targets portal-static-s3 (ops SPA tarball), never BFF",
      "/api/admin/* matches bare /api/* → BFF; /_platform is not a CloudFront path",
      "Both API behaviors ordered above /admin* and /assets/*",
      "Managed CachingDisabled prevents cross-user/tenant API cache bleed",
      "AllViewerExceptHostHeader forwards cookies, query strings, Authorization/CSRF headers",
      "Allowed methods include GET/HEAD/OPTIONS/PUT/POST/PATCH/DELETE",
    ]
  }
}

output "module_status" {
  description = "Honesty summary: real Terraform; apply operator-owned; G8 infra_ready until staging evidence."
  value = {
    component             = "portal-static-edge"
    private_origin        = true
    public_bucket         = false
    oac                   = true
    bff_api_origin        = local.bff_origin_enabled
    production_apply      = "operator_owned_not_auto_applied"
    readiness             = "infra_ready_until_applied_and_pinned"
    gated_portal_security = "G1/G2/G7 still required for production Portal claim"
  }
}

output "content_security_policy" {
  description = "Effective CSP attached to static web behaviors (empty when unset). lp-p37.3."
  value       = local.effective_content_security_policy
}

output "security_headers_policy_id" {
  description = "CloudFront response headers policy id when CSP/security headers are enabled; null otherwise."
  value = (
    local.security_headers_policy_enabled
    ? aws_cloudfront_response_headers_policy.security[0].id
    : null
  )
}
