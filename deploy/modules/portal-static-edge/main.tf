locals {
  common_tags = merge(
    {
      Project     = "company-brain-deploy"
      Component   = "portal-static-edge"
      Environment = var.environment
      ManagedBy   = "terraform"
      Role        = "portal-static-web"
      Topology    = "path-first-g0"
    },
    var.tags,
  )

  bucket_name = coalesce(var.origin_bucket_name, "${var.name_prefix}-portal-web-origin")

  # Normalize origin path for CloudFront (empty or /prefix without trailing slash issues)
  origin_path_normalized = (
    var.origin_path == "" ? "" :
    trimsuffix(var.origin_path, "/")
  )

  # Optional BFF custom origin for API traffic (path-first /*/api/* + bare /api/*)
  bff_origin_enabled = var.bff_origin_domain_name != ""
  bff_origin_id      = "portal-bff"
  s3_origin_id       = "portal-static-s3"

  pin_tags = {
    StaticWebArtifactVersion = var.static_web_artifact_version != "" ? var.static_web_artifact_version : "unset"
    StaticWebArtifactSha256  = var.static_web_artifact_sha256 != "" ? substr(var.static_web_artifact_sha256, 0, 72) : "unset"
  }

  viewer_certificate = (
    var.acm_certificate_arn != null && length(var.aliases) > 0
    ? {
      acm_certificate_arn            = var.acm_certificate_arn
      ssl_support_method             = "sni-only"
      minimum_protocol_version       = var.minimum_protocol_version
      cloudfront_default_certificate = false
    }
    : {
      acm_certificate_arn            = null
      ssl_support_method             = null
      minimum_protocol_version       = null
      cloudfront_default_certificate = true
    }
  )

  # lp-p37.3: CSP for approved ONLYOFFICE Document Server origins (script-src).
  # Prefer explicit content_security_policy; otherwise synthesize from
  # onlyoffice_document_server_origins when that list is non-empty.
  onlyoffice_csp_hosts = join(" ", var.onlyoffice_document_server_origins)
  synthesized_onlyoffice_csp = (
    length(var.onlyoffice_document_server_origins) > 0
    ? "default-src 'self'; script-src 'self' ${local.onlyoffice_csp_hosts}; style-src 'self' 'unsafe-inline' ${local.onlyoffice_csp_hosts}; img-src 'self' data: blob: ${local.onlyoffice_csp_hosts}; font-src 'self' data: ${local.onlyoffice_csp_hosts}; frame-src ${local.onlyoffice_csp_hosts}; connect-src 'self' ${local.onlyoffice_csp_hosts}; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'"
    : ""
  )
  effective_content_security_policy = (
    var.content_security_policy != ""
    ? var.content_security_policy
    : local.synthesized_onlyoffice_csp
  )
  security_headers_policy_enabled = local.effective_content_security_policy != ""
}

# ---------------------------------------------------------------------------
# Fail-closed checks
# ---------------------------------------------------------------------------

check "acknowledge_not_auto_applied" {
  assert {
    condition     = var.acknowledge_not_auto_applied == true
    error_message = "acknowledge_not_auto_applied must be true before planning portal-static-edge."
  }
}

check "aliases_require_acm" {
  assert {
    condition     = length(var.aliases) == 0 || var.acm_certificate_arn != null
    error_message = "aliases require acm_certificate_arn (us-east-1 ACM certificate)."
  }
}

# ---------------------------------------------------------------------------
# Private S3 origin — never public
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "origin" {
  bucket        = local.bucket_name
  force_destroy = var.force_destroy_origin_bucket

  tags = merge(local.common_tags, local.pin_tags, {
    Name = local.bucket_name
  })
}

resource "aws_s3_bucket_public_access_block" "origin" {
  bucket = aws_s3_bucket.origin.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "origin" {
  bucket = aws_s3_bucket.origin.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "origin" {
  bucket = aws_s3_bucket.origin.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_ownership_controls" "origin" {
  bucket = aws_s3_bucket.origin.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# ---------------------------------------------------------------------------
# CloudFront Origin Access Control (OAC) — private origin only
# ---------------------------------------------------------------------------

resource "aws_cloudfront_origin_access_control" "origin" {
  name                              = "${var.name_prefix}-portal-web-oac"
  description                       = "OAC for private portal static web origin (${var.name_prefix})"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_s3_bucket_policy" "origin" {
  bucket = aws_s3_bucket.origin.id

  # Ensure public access block is applied before policy that grants CloudFront.
  depends_on = [aws_s3_bucket_public_access_block.origin]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontServicePrincipalReadOnly"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = ["s3:GetObject"]
        Resource = ["${aws_s3_bucket.origin.arn}/*"]
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.web.arn
          }
        }
      },
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.origin.arn,
          "${aws_s3_bucket.origin.arn}/*",
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      }
    ]
  })
}

# ---------------------------------------------------------------------------
# Optional security response headers (CSP) — ONLYOFFICE script origin lock (lp-p37.3)
# ---------------------------------------------------------------------------

resource "aws_cloudfront_response_headers_policy" "security" {
  count = local.security_headers_policy_enabled ? 1 : 0

  name    = "${var.name_prefix}-portal-web-security-headers"
  comment = "Portal static edge CSP / security headers (${var.name_prefix}); ONLYOFFICE script-src allowlist"

  security_headers_config {
    content_security_policy {
      content_security_policy = local.effective_content_security_policy
      override                = true
    }

    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "SAMEORIGIN"
      override     = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = false
      override                   = true
    }

    xss_protection {
      mode_block = true
      protection = true
      override   = true
    }
  }
}

# ---------------------------------------------------------------------------
# CloudFront distribution — path-first SPA ready (/<tenant_slug>)
# ---------------------------------------------------------------------------

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "Portal static edge (${var.name_prefix}) — private S3 OAC + optional BFF API origin; path-first G0"
  default_root_object = var.default_root_object
  price_class         = var.price_class
  aliases             = var.aliases
  # WAFv2 CloudFront WebACL ARN when portal-waf (or equivalent) is enabled; empty = no WAF.
  web_acl_id          = var.web_acl_id != null && var.web_acl_id != "" ? var.web_acl_id : null
  wait_for_deployment = false

  # Private static web origin (OAC only — never public)
  origin {
    domain_name              = aws_s3_bucket.origin.bucket_regional_domain_name
    origin_id                = local.s3_origin_id
    origin_access_control_id = aws_cloudfront_origin_access_control.origin.id
    origin_path              = local.origin_path_normalized
  }

  # Optional BFF custom origin for API routing (path-first + bare /api/*).
  # When bff_origin_domain_name is empty, this origin is omitted (static-only; module still validates).
  dynamic "origin" {
    for_each = local.bff_origin_enabled ? [1] : []
    content {
      domain_name = var.bff_origin_domain_name
      origin_id   = local.bff_origin_id

      custom_origin_config {
        http_port                = var.bff_origin_http_port
        https_port               = var.bff_origin_https_port
        origin_protocol_policy   = var.bff_origin_protocol_policy
        origin_ssl_protocols     = ["TLSv1.2"]
        origin_read_timeout      = 60
        origin_keepalive_timeout = 5
      }
    }
  }

  # Default behavior: static web (SPA). API paths use ordered_cache_behavior → BFF when configured.
  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = local.s3_origin_id
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    # Optional CSP / security headers (lp-p37.3) when onlyoffice origins or CSP configured.
    response_headers_policy_id = (
      local.security_headers_policy_enabled
      ? aws_cloudfront_response_headers_policy.security[0].id
      : null
    )

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 86400
  }

  # API behaviors first (higher precedence than /assets/*). Both target the same BFF origin:
  #   1) path-first /<tenant_slug>/api/* (var.api_path_pattern, default /*/api/*)
  #   2) bare /api/* (var.bare_api_path_pattern) — apex public discovery (e.g. org resolve)
  # CachingDisabled + AllViewerExceptHostHeader: no shared edge cache; cookies/query/auth
  # headers reach BFF; path is preserved (tenant slug not stripped). Cannot fall through to S3.
  dynamic "ordered_cache_behavior" {
    for_each = local.bff_origin_enabled ? [1] : []
    content {
      path_pattern             = var.api_path_pattern
      allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
      cached_methods           = ["GET", "HEAD"]
      target_origin_id         = local.bff_origin_id
      viewer_protocol_policy   = "redirect-to-https"
      compress                 = true
      cache_policy_id          = var.api_cache_policy_id
      origin_request_policy_id = var.api_origin_request_policy_id
    }
  }

  dynamic "ordered_cache_behavior" {
    for_each = local.bff_origin_enabled ? [1] : []
    content {
      path_pattern             = var.bare_api_path_pattern
      allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
      cached_methods           = ["GET", "HEAD"]
      target_origin_id         = local.bff_origin_id
      viewer_protocol_policy   = "redirect-to-https"
      compress                 = true
      cache_policy_id          = var.api_cache_policy_id
      origin_request_policy_id = var.api_origin_request_policy_id
    }
  }

  # Ops SPA under /admin* (lp-2qs.3). Same private S3 origin as the default SPA.
  # Must not target BFF. /api/admin/* already matches bare /api/* → BFF.
  # /_platform is an S3 vault prefix, not a CloudFront path.
  ordered_cache_behavior {
    path_pattern           = "/admin*"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = local.s3_origin_id
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    response_headers_policy_id = (
      local.security_headers_policy_enabled
      ? aws_cloudfront_response_headers_policy.security[0].id
      : null
    )

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 86400
  }

  # Long-lived static assets under /assets/* (same private S3 origin).
  ordered_cache_behavior {
    path_pattern           = "/assets/*"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = local.s3_origin_id
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    response_headers_policy_id = (
      local.security_headers_policy_enabled
      ? aws_cloudfront_response_headers_policy.security[0].id
      : null
    )

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 86400
    max_ttl     = 604800
  }

  # SPA deep links: map origin 403/404 → index.html for client-side /<tenant_slug> routes.
  # Note: custom error responses are distribution-wide; API clients that receive 403/404 from
  # BFF may get SPA HTML unless the BFF returns non-403/404 error codes (e.g. 401/422) or
  # operators disable enable_spa_error_routing after wiring edge functions.
  dynamic "custom_error_response" {
    for_each = var.enable_spa_error_routing ? [403, 404] : []
    content {
      error_code            = custom_error_response.value
      response_code         = 200
      response_page_path    = "/${var.default_root_object}"
      error_caching_min_ttl = 0
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  dynamic "viewer_certificate" {
    for_each = [local.viewer_certificate]
    content {
      cloudfront_default_certificate = viewer_certificate.value.cloudfront_default_certificate
      acm_certificate_arn            = viewer_certificate.value.acm_certificate_arn
      ssl_support_method             = viewer_certificate.value.ssl_support_method
      minimum_protocol_version       = viewer_certificate.value.minimum_protocol_version
    }
  }

  tags = merge(local.common_tags, local.pin_tags, {
    Name = "${var.name_prefix}-portal-static-edge"
  })
}
