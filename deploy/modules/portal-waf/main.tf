locals {
  common_tags = merge(
    {
      Project     = "company-brain-deploy"
      Component   = "portal-waf"
      Environment = var.environment
      ManagedBy   = "terraform"
      Role        = "portal-waf"
    },
    var.tags,
  )

  # Rule priorities: managed groups first, then rate-based.
  priority_common     = 10
  priority_known_bad  = 20
  priority_rate_based = 30

  alb_arns = toset(var.associate_alb_arns)

  managed_rules = concat(
    var.enable_common_rule_set ? [{
      name            = "AWSManagedRulesCommonRuleSet"
      priority        = local.priority_common
      vendor_name     = "AWS"
      metric_suffix   = "CommonRuleSet"
      statement_label = "common"
    }] : [],
    var.enable_known_bad_inputs ? [{
      name            = "AWSManagedRulesKnownBadInputsRuleSet"
      priority        = local.priority_known_bad
      vendor_name     = "AWS"
      metric_suffix   = "KnownBadInputs"
      statement_label = "known_bad"
    }] : [],
  )

  waf_posture = {
    managed_rules = compact([
      var.enable_common_rule_set ? "AWSManagedRulesCommonRuleSet" : null,
      var.enable_known_bad_inputs ? "AWSManagedRulesKnownBadInputsRuleSet" : null,
    ])
    rate_based = var.enable_rate_based_rule ? {
      enabled    = true
      limit      = var.rate_limit
      action     = "block"
      aggregate  = "IP"
      evaluation = "5 minutes"
    } : { enabled = false }
    default_action               = var.default_action
    managed_rule_override_action = var.managed_rule_override_action
    cloudfront_scope_region      = "us-east-1"
    regional_targets             = ["public-bff-alb", "public-relay-alb"]
    not_targets                  = ["control-plane-internal-alb"]
    notes = [
      "CloudFront WebACL scope=CLOUDFRONT must be created in us-east-1 (provider aws.us_east_1).",
      "Attach CloudFront via portal-static-edge.web_acl_id = cloudfront_web_acl_arn (WAFv2 ARN).",
      "Regional WebACL associates to public BFF/relay ALBs only — never the internal control plane.",
      "Baseline managed rules: CommonRuleSet + KnownBadInputs; rate-based optional (default on).",
    ]
  }
}

# ---------------------------------------------------------------------------
# Fail-closed checks
# ---------------------------------------------------------------------------

check "acknowledge_not_auto_applied" {
  assert {
    condition     = var.acknowledge_not_auto_applied == true
    error_message = "acknowledge_not_auto_applied must be true before planning portal-waf."
  }
}

check "at_least_one_scope" {
  assert {
    condition     = var.enable_cloudfront_web_acl || var.enable_regional_web_acl
    error_message = "portal-waf requires enable_cloudfront_web_acl and/or enable_regional_web_acl."
  }
}

check "associations_need_regional" {
  assert {
    condition     = length(var.associate_alb_arns) == 0 || var.enable_regional_web_acl
    error_message = "associate_alb_arns requires enable_regional_web_acl=true."
  }
}

check "baseline_rules_or_rate" {
  assert {
    condition = (
      !var.enable_cloudfront_web_acl && !var.enable_regional_web_acl
      ) || (
      var.enable_common_rule_set ||
      var.enable_known_bad_inputs ||
      var.enable_rate_based_rule
    )
    error_message = "When a WebACL is enabled, enable at least one of CommonRuleSet, KnownBadInputs, or rate-based."
  }
}

# ---------------------------------------------------------------------------
# Shared rule block template (duplicated per scope — TF dynamic blocks differ by resource)
# ---------------------------------------------------------------------------

# CloudFront-scope WebACL (us-east-1 only)
resource "aws_wafv2_web_acl" "cloudfront" {
  count    = var.enable_cloudfront_web_acl ? 1 : 0
  provider = aws.us_east_1

  name        = "${var.name_prefix}-portal-cf"
  description = "Portal static edge (CloudFront) baseline WAF — managed rules + optional rate limit"
  scope       = "CLOUDFRONT"

  default_action {
    dynamic "allow" {
      for_each = var.default_action == "allow" ? [1] : []
      content {}
    }
    dynamic "block" {
      for_each = var.default_action == "block" ? [1] : []
      content {}
    }
  }

  dynamic "rule" {
    for_each = local.managed_rules
    content {
      name     = rule.value.name
      priority = rule.value.priority

      override_action {
        dynamic "none" {
          for_each = var.managed_rule_override_action == "none" ? [1] : []
          content {}
        }
        dynamic "count" {
          for_each = var.managed_rule_override_action == "count" ? [1] : []
          content {}
        }
      }

      statement {
        managed_rule_group_statement {
          name        = rule.value.name
          vendor_name = rule.value.vendor_name
        }
      }

      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "${var.name_prefix}-cf-${rule.value.metric_suffix}"
        sampled_requests_enabled   = true
      }
    }
  }

  dynamic "rule" {
    for_each = var.enable_rate_based_rule ? [1] : []
    content {
      name     = "RateLimitPerIP"
      priority = local.priority_rate_based

      action {
        block {}
      }

      statement {
        rate_based_statement {
          limit              = var.rate_limit
          aggregate_key_type = "IP"
        }
      }

      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "${var.name_prefix}-cf-RateLimit"
        sampled_requests_enabled   = true
      }
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name_prefix}-portal-cf"
    sampled_requests_enabled   = true
  }

  tags = merge(local.common_tags, {
    Name   = "${var.name_prefix}-portal-cf"
    Scope  = "CLOUDFRONT"
    Region = "us-east-1"
  })
}

# Regional-scope WebACL (default provider region — BFF/relay ALBs)
resource "aws_wafv2_web_acl" "regional" {
  count = var.enable_regional_web_acl ? 1 : 0

  name        = "${var.name_prefix}-portal-alb"
  description = "Portal public BFF/relay ALB baseline WAF — managed rules + optional rate limit"
  scope       = "REGIONAL"

  default_action {
    dynamic "allow" {
      for_each = var.default_action == "allow" ? [1] : []
      content {}
    }
    dynamic "block" {
      for_each = var.default_action == "block" ? [1] : []
      content {}
    }
  }

  dynamic "rule" {
    for_each = local.managed_rules
    content {
      name     = rule.value.name
      priority = rule.value.priority

      override_action {
        dynamic "none" {
          for_each = var.managed_rule_override_action == "none" ? [1] : []
          content {}
        }
        dynamic "count" {
          for_each = var.managed_rule_override_action == "count" ? [1] : []
          content {}
        }
      }

      statement {
        managed_rule_group_statement {
          name        = rule.value.name
          vendor_name = rule.value.vendor_name
        }
      }

      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "${var.name_prefix}-alb-${rule.value.metric_suffix}"
        sampled_requests_enabled   = true
      }
    }
  }

  dynamic "rule" {
    for_each = var.enable_rate_based_rule ? [1] : []
    content {
      name     = "RateLimitPerIP"
      priority = local.priority_rate_based

      action {
        block {}
      }

      statement {
        rate_based_statement {
          limit              = var.rate_limit
          aggregate_key_type = "IP"
        }
      }

      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "${var.name_prefix}-alb-RateLimit"
        sampled_requests_enabled   = true
      }
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name_prefix}-portal-alb"
    sampled_requests_enabled   = true
  }

  tags = merge(local.common_tags, {
    Name  = "${var.name_prefix}-portal-alb"
    Scope = "REGIONAL"
  })
}

# Associate regional WebACL to public ALBs only (never control plane).
resource "aws_wafv2_web_acl_association" "alb" {
  for_each = var.enable_regional_web_acl ? local.alb_arns : toset([])

  resource_arn = each.value
  web_acl_arn  = aws_wafv2_web_acl.regional[0].arn
}
