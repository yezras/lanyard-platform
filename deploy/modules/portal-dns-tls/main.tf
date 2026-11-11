locals {
  common_tags = merge(
    {
      Project     = "company-brain-deploy"
      Component   = "portal-dns-tls"
      Environment = var.environment
      ManagedBy   = "terraform"
      Role        = "portal-dns-tls"
    },
    var.tags,
  )

  # --- Hostnames that request work ---
  want_cloudfront_cert = var.portal_web_hostname != ""
  # Regional ACM covers public ALB listeners: BFF, relay, and staging Document Server
  # (lp-zuh.12.2 — Docs hostname must be a SAN before Docs ALB HTTPS can use this cert).
  regional_hostnames = compact([
    var.bff_hostname != "" ? var.bff_hostname : null,
    var.relay_hostname != "" ? var.relay_hostname : null,
    var.document_server_hostname != "" ? var.document_server_hostname : null,
  ])
  want_regional_cert = length(local.regional_hostnames) > 0

  # Create vs consume existing (never duplicate when ARN provided)
  create_cloudfront_cert = (
    local.want_cloudfront_cert &&
    var.existing_cloudfront_certificate_arn == null
  )
  create_regional_cert = (
    local.want_regional_cert &&
    var.existing_regional_certificate_arn == null
  )

  # Zone resolution
  create_zone = var.create_route53_zone
  zone_id = (
    local.create_zone
    ? aws_route53_zone.this[0].zone_id
    : var.route53_zone_id
  )

  # DNS validation / alias records need a zone when we create certs or aliases
  needs_zone = (
    local.create_cloudfront_cert ||
    local.create_regional_cert ||
    (var.create_dns_records && (
      (var.portal_web_hostname != "" && var.cloudfront_domain_name != "") ||
      (var.bff_hostname != "" && var.bff_alb_dns_name != "") ||
      (var.relay_hostname != "" && var.relay_alb_dns_name != "")
    ))
  )

  # Alias eligibility
  create_web_alias = (
    var.create_dns_records &&
    var.portal_web_hostname != "" &&
    var.cloudfront_domain_name != "" &&
    var.cloudfront_hosted_zone_id != ""
  )
  create_bff_alias = (
    var.create_dns_records &&
    var.bff_hostname != "" &&
    var.bff_alb_dns_name != "" &&
    var.bff_alb_zone_id != ""
  )
  create_relay_alias = (
    var.create_dns_records &&
    var.relay_hostname != "" &&
    var.relay_alb_dns_name != "" &&
    var.relay_alb_zone_id != ""
  )

  # Effective certificate ARNs (created or existing)
  cloudfront_certificate_arn = (
    local.create_cloudfront_cert
    ? aws_acm_certificate_validation.cloudfront[0].certificate_arn
    : var.existing_cloudfront_certificate_arn
  )
  regional_certificate_arn = (
    local.create_regional_cert
    ? aws_acm_certificate_validation.regional[0].certificate_arn
    : var.existing_regional_certificate_arn
  )

  # Recommended consumer wiring (documented; enforced by service modules when HTTPS enabled)
  tls_posture = {
    cloudfront_viewer_protocol_policy = "redirect-to-https"
    bff_http_listener_when_https      = "HTTP_301 redirect to HTTPS:443"
    relay_http_listener_when_https    = "HTTP_301 redirect to HTTPS:443"
    relay_client_scheme               = "wss://"
    rejected_client_schemes           = ["http://", "ws://"]
    notes = [
      "CloudFront behaviors use viewer_protocol_policy = redirect-to-https (portal-static-edge).",
      "BFF/relay modules redirect HTTP→HTTPS when enable_https=true and acm_certificate_arn is set.",
      "Relay clients and customer-gateway-relay must use wss:// only (ws:// rejected by URL validations).",
      "This module issues/attaches certs and DNS; HTTP/WS rejection is enforced by edge modules + pin validators.",
    ]
  }
}

# ---------------------------------------------------------------------------
# Fail-closed checks
# ---------------------------------------------------------------------------

check "acknowledge_not_auto_applied" {
  assert {
    condition     = var.acknowledge_not_auto_applied == true
    error_message = "acknowledge_not_auto_applied must be true before planning portal-dns-tls."
  }
}

check "zone_required_when_needed" {
  assert {
    condition = (
      !local.needs_zone ||
      local.create_zone ||
      (var.route53_zone_id != null && var.route53_zone_id != "")
    )
    error_message = "route53_zone_id is required when create_route53_zone=false and certificates or DNS aliases need a hosted zone."
  }
}

check "zone_name_when_creating" {
  assert {
    condition     = !local.create_zone || var.route53_zone_name != ""
    error_message = "route53_zone_name is required when create_route53_zone=true."
  }
}

check "cloudfront_cert_us_east_1_only" {
  assert {
    condition = (
      var.existing_cloudfront_certificate_arn == null ||
      can(regex("^arn:aws:acm:us-east-1:", var.existing_cloudfront_certificate_arn))
    )
    error_message = "CloudFront certificates must be in us-east-1 (existing_cloudfront_certificate_arn)."
  }
}

check "at_least_one_hostname_or_existing_cert" {
  assert {
    condition = (
      local.want_cloudfront_cert ||
      local.want_regional_cert ||
      var.existing_cloudfront_certificate_arn != null ||
      var.existing_regional_certificate_arn != null ||
      local.create_zone
    )
    error_message = "portal-dns-tls requires at least one hostname, existing certificate ARN, or create_route53_zone=true."
  }
}

# ---------------------------------------------------------------------------
# Optional public hosted zone (prefer existing to avoid duplicates)
# ---------------------------------------------------------------------------

resource "aws_route53_zone" "this" {
  count = local.create_zone ? 1 : 0

  name = var.route53_zone_name

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-portal-dns"
  })
}

# ---------------------------------------------------------------------------
# CloudFront certificate (us-east-1 only — provider alias aws.us_east_1)
# ---------------------------------------------------------------------------

resource "aws_acm_certificate" "cloudfront" {
  count    = local.create_cloudfront_cert ? 1 : 0
  provider = aws.us_east_1

  domain_name       = var.portal_web_hostname
  validation_method = var.certificate_validation_method

  lifecycle {
    create_before_destroy = true
  }

  tags = merge(local.common_tags, {
    Name    = "${var.name_prefix}-portal-web-cf"
    Purpose = "cloudfront-viewer-certificate"
    Region  = "us-east-1"
  })
}

resource "aws_route53_record" "cloudfront_validation" {
  for_each = local.create_cloudfront_cert ? {
    for dvo in aws_acm_certificate.cloudfront[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = local.zone_id
}

resource "aws_acm_certificate_validation" "cloudfront" {
  count    = local.create_cloudfront_cert ? 1 : 0
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.cloudfront[0].arn
  validation_record_fqdns = [for r in aws_route53_record.cloudfront_validation : r.fqdn]
}

# ---------------------------------------------------------------------------
# Regional certificate (default provider region — BFF + relay SANs)
# ---------------------------------------------------------------------------

resource "aws_acm_certificate" "regional" {
  count = local.create_regional_cert ? 1 : 0

  domain_name               = local.regional_hostnames[0]
  subject_alternative_names = length(local.regional_hostnames) > 1 ? slice(local.regional_hostnames, 1, length(local.regional_hostnames)) : []
  validation_method         = var.certificate_validation_method

  lifecycle {
    create_before_destroy = true
  }

  tags = merge(local.common_tags, {
    Name    = "${var.name_prefix}-portal-alb-regional"
    Purpose = "alb-https-listeners-bff-relay"
  })
}

resource "aws_route53_record" "regional_validation" {
  for_each = local.create_regional_cert ? {
    for dvo in aws_acm_certificate.regional[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = local.zone_id
}

resource "aws_acm_certificate_validation" "regional" {
  count = local.create_regional_cert ? 1 : 0

  certificate_arn         = aws_acm_certificate.regional[0].arn
  validation_record_fqdns = [for r in aws_route53_record.regional_validation : r.fqdn]
}

# ---------------------------------------------------------------------------
# Route53 aliases → CloudFront / BFF ALB / relay ALB
# ---------------------------------------------------------------------------

resource "aws_route53_record" "portal_web" {
  count = local.create_web_alias ? 1 : 0

  zone_id = local.zone_id
  name    = var.portal_web_hostname
  type    = "A"

  alias {
    name                   = var.cloudfront_domain_name
    zone_id                = var.cloudfront_hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "portal_web_aaaa" {
  count = local.create_web_alias ? 1 : 0

  zone_id = local.zone_id
  name    = var.portal_web_hostname
  type    = "AAAA"

  alias {
    name                   = var.cloudfront_domain_name
    zone_id                = var.cloudfront_hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "bff" {
  count = local.create_bff_alias ? 1 : 0

  zone_id = local.zone_id
  name    = var.bff_hostname
  type    = "A"

  alias {
    name                   = var.bff_alb_dns_name
    zone_id                = var.bff_alb_zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "bff_aaaa" {
  count = local.create_bff_alias ? 1 : 0

  zone_id = local.zone_id
  name    = var.bff_hostname
  type    = "AAAA"

  alias {
    name                   = var.bff_alb_dns_name
    zone_id                = var.bff_alb_zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "relay" {
  count = local.create_relay_alias ? 1 : 0

  zone_id = local.zone_id
  name    = var.relay_hostname
  type    = "A"

  alias {
    name                   = var.relay_alb_dns_name
    zone_id                = var.relay_alb_zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "relay_aaaa" {
  count = local.create_relay_alias ? 1 : 0

  zone_id = local.zone_id
  name    = var.relay_hostname
  type    = "AAAA"

  alias {
    name                   = var.relay_alb_dns_name
    zone_id                = var.relay_alb_zone_id
    evaluate_target_health = true
  }
}
