# Non-secret DNS/TLS coordinates only — never private keys or secret values.

output "route53_zone_id" {
  description = "Hosted zone ID used for validation and aliases (created or existing)."
  value       = local.zone_id
}

output "route53_zone_name" {
  description = "Hosted zone name when created by this module; otherwise the configured route53_zone_name (may be empty)."
  value       = local.create_zone ? aws_route53_zone.this[0].name : var.route53_zone_name
}

output "route53_zone_name_servers" {
  description = "Name servers when this module created the zone; empty list when consuming an existing zone."
  value       = local.create_zone ? aws_route53_zone.this[0].name_servers : []
}

output "cloudfront_certificate_arn" {
  description = "Validated us-east-1 ACM certificate ARN for CloudFront (created or existing). Null when unused."
  value       = local.cloudfront_certificate_arn
}

output "cloudfront_certificate_status" {
  description = "Whether the CloudFront cert was created here or passed in."
  value = (
    !local.want_cloudfront_cert && var.existing_cloudfront_certificate_arn == null
    ? "unused"
    : (local.create_cloudfront_cert ? "created_and_validated" : "existing")
  )
}

output "regional_certificate_arn" {
  description = "Validated regional ACM certificate ARN for BFF/relay ALB HTTPS listeners. Null when unused."
  value       = local.regional_certificate_arn
}

output "regional_certificate_status" {
  description = "Whether the regional cert was created here or passed in."
  value = (
    !local.want_regional_cert && var.existing_regional_certificate_arn == null
    ? "unused"
    : (local.create_regional_cert ? "created_and_validated" : "existing")
  )
}

output "regional_certificate_sans" {
  description = "Hostnames covered by the regional certificate (BFF, relay, and/or Document Server)."
  value       = local.regional_hostnames
}

output "portal_web_hostname" {
  description = "Configured Portal web hostname (CloudFront alias)."
  value       = var.portal_web_hostname != "" ? var.portal_web_hostname : null
}

output "bff_hostname" {
  description = "Configured BFF hostname."
  value       = var.bff_hostname != "" ? var.bff_hostname : null
}

output "relay_hostname" {
  description = "Configured relay hostname."
  value       = var.relay_hostname != "" ? var.relay_hostname : null
}

output "document_server_hostname" {
  description = "Configured Document Server hostname (regional ACM SAN; alias owned by platform-staging)."
  value       = var.document_server_hostname != "" ? var.document_server_hostname : null
}

output "portal_web_fqdn" {
  description = "FQDN of the web alias record when created."
  value       = try(aws_route53_record.portal_web[0].fqdn, null)
}

output "bff_fqdn" {
  description = "FQDN of the BFF alias record when created."
  value       = try(aws_route53_record.bff[0].fqdn, null)
}

output "relay_fqdn" {
  description = "FQDN of the relay alias record when created."
  value       = try(aws_route53_record.relay[0].fqdn, null)
}

output "dns_aliases" {
  description = "Which alias records were created and their intended targets."
  value = {
    portal_web = local.create_web_alias ? {
      hostname = var.portal_web_hostname
      target   = var.cloudfront_domain_name
      type     = "CloudFront"
    } : null
    bff = local.create_bff_alias ? {
      hostname = var.bff_hostname
      target   = var.bff_alb_dns_name
      type     = "ALB"
    } : null
    relay = local.create_relay_alias ? {
      hostname = var.relay_hostname
      target   = var.relay_alb_dns_name
      type     = "ALB"
    } : null
  }
}

output "consumer_wiring" {
  description = "Suggested module inputs for static edge / BFF / relay (ARNs and hostnames only)."
  value = {
    portal_static_edge = {
      aliases             = var.portal_web_hostname != "" ? [var.portal_web_hostname] : []
      acm_certificate_arn = local.cloudfront_certificate_arn
      note                = "acm_certificate_arn must be us-east-1 for CloudFront"
    }
    portal_bff_service = {
      enable_https        = var.bff_hostname != "" || local.regional_certificate_arn != null
      acm_certificate_arn = local.regional_certificate_arn
      note                = "enable_https redirects HTTP→HTTPS on the ALB listener"
    }
    portal_relay_service = {
      enable_https        = var.relay_hostname != "" || local.regional_certificate_arn != null
      acm_certificate_arn = local.regional_certificate_arn
      note                = "Clients must use wss://hostname (ws:// rejected by pin/URL validators)"
    }
    staging_document_server = {
      enable_https        = var.document_server_hostname != "" || local.regional_certificate_arn != null
      acm_certificate_arn = local.regional_certificate_arn
      note                = "lp-zuh.12.2: Docs ALB HTTPS needs document_server_hostname on this regional cert SAN (or a dedicated ACM ARN)"
    }
  }
}

output "tls_posture" {
  description = "HTTP→HTTPS redirects and insecure websocket rejection contract (enforced by edge modules + documented here)."
  value       = local.tls_posture
}

output "module_status" {
  description = "Honesty summary: real Terraform; apply operator-owned; not production-certified from examples."
  value = {
    component                = "portal-dns-tls"
    cloudfront_cert_region   = "us-east-1"
    regional_cert_for        = ["bff-alb", "relay-alb", "docs-alb"]
    prefers_existing_zone    = true
    prefers_existing_certs   = "pass existing_*_certificate_arn to skip create"
    production_apply         = "operator_owned_not_auto_applied"
    readiness                = "infra_ready_until_applied"
    not_production_certified = true
  }
}
