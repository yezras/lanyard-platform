locals {
  tenant_slug = lower(trimspace(var.tenant_slug))

  relay_hostname = var.relay_hostname_override != "" ? trimspace(var.relay_hostname_override) : (
    var.environment == "prod"
    ? "relay-${local.tenant_slug}.${var.relay_host_suffix}"
    : "relay-${local.tenant_slug}.${var.environment}.${var.relay_host_suffix}"
  )

  relay_wss_url = "wss://${local.relay_hostname}"

  # name_prefix for composed portal-relay-service (3–40 chars, starts letter, ends alnum).
  auto_name_prefix_raw = replace("tier3-${local.tenant_slug}", "_", "-")
  auto_name_prefix_cut = trimsuffix(substr(local.auto_name_prefix_raw, 0, 40), "-")
  effective_name_prefix = (
    var.name_prefix != ""
    ? var.name_prefix
    : (length(local.auto_name_prefix_cut) >= 3 ? local.auto_name_prefix_cut : "tier3-x")
  )

  # Default plain env: advertise dedicated WSS URL for bus identity when operators enable bus later.
  default_environment_variables = {
    RELAY_CLUSTER_MODE  = "single"
    RELAY_ADVERTISE_URL = local.relay_wss_url
    RELAY_NODE_ID       = "tier3-${local.tenant_slug}"
  }

  effective_environment_variables = merge(local.default_environment_variables, var.environment_variables)

  common_tags = merge(
    {
      Project     = "company-brain-deploy"
      Component   = "tier3-dedicated-relay"
      Environment = var.environment
      ManagedBy   = "terraform"
      Role        = "tier3-dedicated-relay"
      TenantSlug  = local.tenant_slug
      RelayTier   = "dedicated"
      PublicEdge  = "true"
    },
    var.tags,
  )

  # Explicit status for operators, CI honesty scanners, and root indexes.
  module_status           = "infra_ready"
  production_ready        = false
  creates_aws_resources   = true
  readiness_matrix_status = "infra_ready"
  production_apply        = "operator_owned_not_auto_applied"

  create_dns = (
    var.create_dns_record &&
    var.route53_zone_id != null &&
    var.route53_zone_id != ""
  )

  associate_waf = (
    var.web_acl_arn != null &&
    var.web_acl_arn != ""
  )
}

# ---------------------------------------------------------------------------
# Fail-closed honesty (infra_ready, not production-certified)
# ---------------------------------------------------------------------------

check "acknowledge_not_auto_applied" {
  assert {
    condition     = var.acknowledge_not_auto_applied == true
    error_message = "acknowledge_not_auto_applied must be true before planning tier3-dedicated-relay. Module is real Terraform (ALB/ECS) but not auto-applied from examples."
  }
}

check "forbid_production_ready_claim" {
  assert {
    condition     = var.claim_production_ready == false
    error_message = "claim_production_ready must be false. Tier 3 dedicated relay is infra_ready until staging proof + G2 — do not claim production-complete compute."
  }
}

check "module_status_is_infra_ready" {
  assert {
    condition     = local.module_status == "infra_ready" && local.production_ready == false && local.creates_aws_resources == true
    error_message = "Internal honesty invariant broken: tier3-dedicated-relay must remain infra_ready / non-production-claim / creates AWS resources."
  }
}

check "dns_requires_zone" {
  assert {
    condition     = !var.create_dns_record || (var.route53_zone_id != null && var.route53_zone_id != "")
    error_message = "create_dns_record=true requires route53_zone_id."
  }
}

check "https_requires_cert" {
  assert {
    condition     = !var.enable_https || var.acm_certificate_arn != null
    error_message = "enable_https=true requires acm_certificate_arn (use modules/portal-dns-tls regional cert covering the dedicated hostname)."
  }
}

# ---------------------------------------------------------------------------
# Dedicated relay compute — compose portal-relay-service (public ALB + private Fargate)
# ---------------------------------------------------------------------------

module "relay" {
  source = "../portal-relay-service"

  name_prefix = local.effective_name_prefix
  environment = var.environment
  tags        = local.common_tags

  vpc_id             = var.vpc_id
  public_subnet_ids  = var.public_subnet_ids
  private_subnet_ids = var.private_subnet_ids
  assign_public_ip   = var.assign_public_ip

  image_repository = var.image_repository
  image_digest     = var.image_digest
  image_tag_hint   = var.image_tag_hint

  container_port                  = var.container_port
  health_check_path               = var.health_check_path
  desired_count                   = var.desired_count
  acknowledge_g6_scale_beyond_one = var.acknowledge_g6_scale_beyond_one
  cpu                             = var.cpu
  memory                          = var.memory
  create_ecs_cluster              = var.create_ecs_cluster
  existing_ecs_cluster_name       = var.existing_ecs_cluster_name
  enable_https                    = var.enable_https
  acm_certificate_arn             = var.acm_certificate_arn
  listener_port_http              = var.listener_port_http
  log_retention_days              = var.log_retention_days
  environment_variables           = local.effective_environment_variables
  secrets                         = var.secrets
  stickiness_enabled              = var.stickiness_enabled

  acknowledge_not_auto_applied = true
}

# ---------------------------------------------------------------------------
# Optional per-tenant DNS alias (hostname → dedicated ALB)
# ---------------------------------------------------------------------------

resource "aws_route53_record" "relay" {
  count = local.create_dns ? 1 : 0

  zone_id = var.route53_zone_id
  name    = local.relay_hostname
  type    = "A"

  alias {
    name                   = module.relay.alb_dns_name
    zone_id                = module.relay.alb_zone_id
    evaluate_target_health = true
  }
}

# ---------------------------------------------------------------------------
# Optional WAFv2 association (existing Web ACL only — no rule authoring here)
# ---------------------------------------------------------------------------

resource "aws_wafv2_web_acl_association" "relay" {
  count = local.associate_waf ? 1 : 0

  resource_arn = module.relay.alb_arn
  web_acl_arn  = var.web_acl_arn
}
