# Non-secret WAF coordinates only — no rule payloads that embed secrets.

output "cloudfront_web_acl_arn" {
  description = "CLOUDFRONT-scope WebACL ARN (us-east-1). Pass to portal-static-edge.web_acl_id. Null when disabled."
  value       = var.enable_cloudfront_web_acl ? aws_wafv2_web_acl.cloudfront[0].arn : null
}

output "cloudfront_web_acl_id" {
  description = "CLOUDFRONT-scope WebACL ID. Null when disabled."
  value       = var.enable_cloudfront_web_acl ? aws_wafv2_web_acl.cloudfront[0].id : null
}

output "cloudfront_web_acl_name" {
  description = "CLOUDFRONT-scope WebACL name. Null when disabled."
  value       = var.enable_cloudfront_web_acl ? aws_wafv2_web_acl.cloudfront[0].name : null
}

output "regional_web_acl_arn" {
  description = "REGIONAL-scope WebACL ARN for BFF/relay ALB associations. Null when disabled."
  value       = var.enable_regional_web_acl ? aws_wafv2_web_acl.regional[0].arn : null
}

output "regional_web_acl_id" {
  description = "REGIONAL-scope WebACL ID. Null when disabled."
  value       = var.enable_regional_web_acl ? aws_wafv2_web_acl.regional[0].id : null
}

output "regional_web_acl_name" {
  description = "REGIONAL-scope WebACL name. Null when disabled."
  value       = var.enable_regional_web_acl ? aws_wafv2_web_acl.regional[0].name : null
}

output "associated_alb_arns" {
  description = "ALB ARNs associated with the regional WebACL."
  value       = sort(tolist(local.alb_arns))
}

output "consumer_wiring" {
  description = "Suggested module inputs for static edge / BFF / relay (ARNs only)."
  value = {
    portal_static_edge = {
      web_acl_id = var.enable_cloudfront_web_acl ? aws_wafv2_web_acl.cloudfront[0].arn : null
      note       = "CloudFront WAFv2 uses the WebACL ARN in web_acl_id (not classic WAF ID)."
    }
    portal_bff_service = {
      association = "aws_wafv2_web_acl_association on alb_arn (module-owned when associate_alb_arns set)"
      note        = "Public BFF ALB only"
    }
    portal_relay_service = {
      association = "aws_wafv2_web_acl_association on alb_arn (module-owned when associate_alb_arns set)"
      note        = "Public relay ALB only — not control-plane"
    }
  }
}

output "waf_posture" {
  description = "Baseline managed rules + rate-based contract documented for operators."
  value       = local.waf_posture
}

output "module_status" {
  description = "Honesty summary: real Terraform; apply operator-owned; not production-certified from examples."
  value = {
    component                = "portal-waf"
    cloudfront_scope_region  = "us-east-1"
    regional_for             = ["bff-alb", "relay-alb"]
    never_for                = ["control-plane-internal-alb"]
    managed_rules_baseline   = ["AWSManagedRulesCommonRuleSet", "AWSManagedRulesKnownBadInputsRuleSet"]
    rate_based_optional      = true
    production_apply         = "operator_owned_not_auto_applied"
    readiness                = "infra_ready_until_applied"
    not_production_certified = true
  }
}
