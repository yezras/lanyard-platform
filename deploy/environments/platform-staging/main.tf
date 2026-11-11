# Platform staging root — central platform compose (infra_ready, not production-applied).
#
# Layers (relative in-repo module sources; never float on main):
#   1. product-artifact-infra  — S3 release bucket + Portal ECR + optional OIDC publishers
#   2. platform-vpc            — two-AZ public/private foundation
#   3. control-plane-rds       — private encrypted Postgres (optional via enable_*)
#   4. portal-valkey           — private shared state (optional; default off)
#   5. portal-control-plane-service — INTERNAL ALB only (G1; never public)
#   6. portal-bff-service      — public BFF ALB + Fargate (digest pin + CONTROL_PLANE_URL)
#   7. portal-relay-service    — public relay ALB + Fargate (digest pin + CONTROL_PLANE_URL)
#   8. portal-static-edge      — CloudFront OAC + private S3; optional BFF origin
#   9. portal-dns-tls          — optional ACM + Route53 (default off)
#  10. portal-waf              — optional WAFv2 baseline on CF + public BFF/relay ALBs (default off)
#  11. staging-document-server — optional staging-platform-shared-ds ONLYOFFICE (default off; lp-5q6.34)
#
# End-to-end wiring (cbd-mta.1.3) — operators do not copy/paste non-secret outputs:
#   - ECR repository URLs from product-artifact-infra → image_repository (digest still operator pin)
#   - BFF/relay task SGs → CP ALB via root aws_vpc_security_group_ingress_rule (label SG on module)
#   - CP task SG → RDS via external ingress rule (label SG on RDS module)
#   - BFF/relay task SGs → Valkey via external ingress rules (label SG on Valkey module)
#   - RDS secret ARN → CP CONTROL_PLANE_DATABASE_URL (database_url_secret_arn)
#   - Valkey secret ARN → BFF/relay REDIS_URL when valkey enabled
#   - Internal CP ALB DNS → BFF/relay CONTROL_PLANE_URL (private base URL, non-secret)
#   - Static edge bff_origin from BFF ALB DNS
#   - Explicit *_allowed_*_security_group_ids overrides always win when non-empty
#   - Never broad 0.0.0.0/0 data-plane CIDRs; never secret values in outputs
#
# Validates without credentials. NOT apply-ready until placeholders are replaced
# (artifact bucket name, image digests, backend, optional OIDC provider ARN).

# ---------------------------------------------------------------------------
# Locals — network handles, pin defaults, auto-wired env/secrets
# ---------------------------------------------------------------------------

locals {
  environment = "staging"
  common_tags = merge(var.tags, {
    Root = "environments/platform-staging"
  })

  # Fake digests are valid sha256 shape so terraform validate works; replace before apply.
  # Align with compatibility/pins.example.yaml portal.images.*.digest placeholders.
  example_digest_bff   = "sha256:0000000000000000000000000000000000000000000000000000000000000002"
  example_digest_relay = "sha256:0000000000000000000000000000000000000000000000000000000000000003"
  example_digest_cp    = "sha256:0000000000000000000000000000000000000000000000000000000000000004"

  vpc_id             = var.enable_platform_vpc ? module.platform_vpc[0].vpc_id : null
  public_subnet_ids  = var.enable_platform_vpc ? module.platform_vpc[0].public_subnet_ids : []
  private_subnet_ids = var.enable_platform_vpc ? module.platform_vpc[0].private_subnet_ids : []
  vpc_cidr           = var.enable_platform_vpc ? module.platform_vpc[0].vpc_cidr_block : var.vpc_cidr

  # CP ALB module inputs: explicit SGs, else root label SG (real BFF/relay rules external).
  # Avoids CP↔BFF cycle so BFF can consume CONTROL_PLANE_URL from the internal ALB DNS.
  cp_module_ingress_sgs = length(var.control_plane_allowed_ingress_security_group_ids) > 0 ? var.control_plane_allowed_ingress_security_group_ids : (
    var.enable_portal_control_plane && (
      var.auto_wire_security_groups ||
      length(var.control_plane_allowed_ingress_cidr_blocks) == 0
    ) ? [aws_security_group.cp_alb_clients_label[0].id] : []
  )

  # RDS module inputs: explicit SGs, else root label SG (real CP task rule is external).
  rds_module_allowed_sgs = length(var.rds_allowed_security_group_ids) > 0 ? var.rds_allowed_security_group_ids : (
    var.enable_control_plane_rds ? [aws_security_group.rds_clients_label[0].id] : []
  )

  # Valkey module inputs: explicit SGs, else root label SG (real BFF/relay rules external).
  valkey_module_allowed_sgs = length(var.valkey_allowed_security_group_ids) > 0 ? var.valkey_allowed_security_group_ids : (
    var.enable_portal_valkey ? [aws_security_group.valkey_clients_label[0].id] : []
  )

  # Image pins: repository URL from product-artifact ECR (no copy/paste); digest is operator pin.
  # Modules reject tag-only / :latest — deploy authority is repository@digest only.
  bff_image_repository = coalesce(
    var.bff_image_repository,
    module.product_artifacts.ecr_repository_urls["bff"],
  )
  bff_image_digest = coalesce(var.bff_image_digest, local.example_digest_bff)
  relay_image_repository = coalesce(
    var.relay_image_repository,
    module.product_artifacts.ecr_repository_urls["relay"],
  )
  relay_image_digest = coalesce(var.relay_image_digest, local.example_digest_relay)
  control_plane_image_repository = coalesce(
    var.control_plane_image_repository,
    module.product_artifacts.ecr_repository_urls["control-plane"],
  )
  control_plane_image_digest = coalesce(var.control_plane_image_digest, local.example_digest_cp)

  # Private CP base URL for BFF/relay (internal ALB DNS; HTTP listener default port 80).
  control_plane_url = (
    var.enable_portal_control_plane
    ? (
      var.control_plane_listener_port == 80
      ? "http://${module.portal_control_plane[0].alb_dns_name}"
      : "http://${module.portal_control_plane[0].alb_dns_name}:${var.control_plane_listener_port}"
    )
    : null
  )

  # Staging Docs edge URL (browser → Document Server).
  # Prefer: custom hostname (https when ALB HTTPS or CF) → module public URL (CF or ALB).
  document_server_public_base_url = (
    var.enable_staging_document_server
    ? (
      var.document_server_public_hostname != ""
      ? (
        (local.docs_enable_https || var.document_server_enable_cloudfront_https)
        ? "https://${var.document_server_public_hostname}"
        : "http://${var.document_server_public_hostname}"
      )
      : module.staging_document_server[0].document_server_public_base_url
    )
    : null
  )
  # BFF callback allowlist (comma-separated hosts, no scheme).
  # Include public hostname and/or CloudFront domain plus ALB DNS during HTTPS cutover
  # (lp-zuh.12.2 / lp-zuh.12.9). Module already dual-lists CF+ALB when CF is on.
  document_server_host = (
    var.enable_staging_document_server
    ? (
      var.document_server_public_hostname != ""
      ? join(",", distinct(compact(concat(
        [var.document_server_public_hostname],
        split(",", module.staging_document_server[0].document_server_host),
      ))))
      : module.staging_document_server[0].document_server_host
    )
    : null
  )

  # BFF public base for DS→BFF download/callback (Document Server must resolve this).
  # Do NOT derive from module.portal_bff.alb_dns_name here — that would cycle with BFF env wiring.
  # Operators set bff_office_public_base_url or bff_hostname (DNS/TLS) before enabling DS.
  bff_office_public_base_url = (
    var.enable_staging_document_server && var.enable_portal_bff
    ? (
      var.bff_office_public_base_url != ""
      ? var.bff_office_public_base_url
      : (
        var.bff_hostname != ""
        ? "https://${var.bff_hostname}"
        : null
      )
    )
    : null
  )

  # Non-secret env auto-wiring; operator map wins on key conflict.
  bff_environment_variables = merge(
    var.enable_portal_control_plane && var.inject_control_plane_url_into_bff ? {
      CONTROL_PLANE_URL = local.control_plane_url
    } : {},
    # Office bridge (lp-5q6.34): DS-reachable BFF base + DS host allowlist when staging DS on.
    var.enable_staging_document_server && var.inject_office_env_into_bff && local.bff_office_public_base_url != null ? {
      BFF_OFFICE_PUBLIC_BASE_URL = local.bff_office_public_base_url
    } : {},
    var.enable_staging_document_server && var.inject_office_env_into_bff && local.document_server_host != null ? {
      BFF_OFFICE_DOCUMENT_SERVER_HOSTS = local.document_server_host
    } : {},
    var.bff_environment_variables,
  )
  relay_environment_variables = merge(
    var.enable_portal_control_plane && var.inject_control_plane_url_into_relay ? {
      CONTROL_PLANE_URL = local.control_plane_url
    } : {},
    var.relay_environment_variables,
  )

  # Secret ARN injection (ARNs only); operator secrets map wins on key conflict.
  bff_secrets = merge(
    var.enable_portal_valkey && var.inject_redis_url_into_bff ? {
      REDIS_URL = {
        value_from  = "${module.portal_valkey[0].redis_url_secret_arn}:REDIS_URL::"
        kms_key_arn = null
      }
    } : {},
    # Shared staging Office JWT (SM only) — same secret as Document Server JWT_SECRET.
    var.enable_staging_document_server && var.inject_office_jwt_into_bff ? {
      BFF_OFFICE_JWT_SECRET = {
        value_from  = module.staging_document_server[0].jwt_secret_arn
        kms_key_arn = null
      }
    } : {},
    var.bff_secrets,
  )
  relay_secrets = merge(
    var.enable_portal_valkey && var.inject_redis_url_into_relay ? {
      REDIS_URL = {
        value_from  = "${module.portal_valkey[0].redis_url_secret_arn}:REDIS_URL::"
        kms_key_arn = null
      }
    } : {},
    var.relay_secrets,
  )

  # DNS/TLS (optional)
  dns_tls_enabled = var.enable_portal_dns_tls
  static_acm_certificate_arn = (
    local.dns_tls_enabled
    ? module.portal_dns_tls[0].cloudfront_certificate_arn
    : var.static_acm_certificate_arn
  )
  bff_acm_certificate_arn = (
    local.dns_tls_enabled && try(module.portal_dns_tls[0].regional_certificate_arn, null) != null
    ? module.portal_dns_tls[0].regional_certificate_arn
    : var.bff_acm_certificate_arn
  )
  relay_acm_certificate_arn = (
    local.dns_tls_enabled && try(module.portal_dns_tls[0].regional_certificate_arn, null) != null
    ? module.portal_dns_tls[0].regional_certificate_arn
    : var.relay_acm_certificate_arn
  )
  bff_enable_https = (
    (local.dns_tls_enabled && try(module.portal_dns_tls[0].regional_certificate_arn, null) != null)
    || var.bff_enable_https
  )
  relay_enable_https = (
    (local.dns_tls_enabled && try(module.portal_dns_tls[0].regional_certificate_arn, null) != null)
    || var.relay_enable_https
  )
  static_aliases = (
    local.dns_tls_enabled && var.portal_web_hostname != ""
    ? [var.portal_web_hostname]
    : var.static_aliases
  )

  # WAF (optional) — CloudFront attach via web_acl_id; regional associations on public ALBs only.
  waf_enabled = var.enable_portal_waf
  static_web_acl_id = (
    local.waf_enabled && var.enable_portal_static_edge
    ? coalesce(module.portal_waf[0].cloudfront_web_acl_arn, "")
    : var.static_web_acl_id
  )
  waf_associate_alb_arns = local.waf_enabled ? compact([
    var.enable_portal_bff ? module.portal_bff[0].alb_arn : null,
    var.enable_portal_relay ? module.portal_relay[0].alb_arn : null,
    # Staging Docs ALB is public browser edge; associate regional WAF when enabled.
    var.enable_staging_document_server ? module.staging_document_server[0].alb_arn : null,
  ]) : []

  # Docs HTTPS: DNS/TLS regional cert or explicit operator cert.
  docs_enable_https = (
    var.document_server_enable_https
    || (local.dns_tls_enabled && try(module.portal_dns_tls[0].regional_certificate_arn, null) != null && var.document_server_public_hostname != "")
  )
  docs_acm_certificate_arn = (
    var.document_server_acm_certificate_arn != null
    ? var.document_server_acm_certificate_arn
    : (
      local.dns_tls_enabled && try(module.portal_dns_tls[0].regional_certificate_arn, null) != null
      ? module.portal_dns_tls[0].regional_certificate_arn
      : null
    )
  )
}

# ---------------------------------------------------------------------------
# 1. Product artifact infrastructure (always on)
# ---------------------------------------------------------------------------

module "product_artifacts" {
  source = "../../modules/product-artifact-infra"

  name_prefix          = var.name_prefix
  environment          = local.environment
  artifact_bucket_name = var.artifact_bucket_name
  tags                 = local.common_tags

  s3_force_destroy                      = var.s3_force_destroy
  s3_object_lock_default_retention_mode = var.s3_object_lock_default_retention_mode
  s3_object_lock_default_retention_days = var.s3_object_lock_default_retention_days
  s3_noncurrent_version_expiration_days = var.s3_noncurrent_version_expiration_days
  ecr_image_count_limit                 = var.ecr_image_count_limit

  s3_sse_algorithm                      = var.s3_sse_algorithm
  s3_kms_key_id                         = var.s3_kms_key_id
  s3_vpc_endpoint_ids                   = var.s3_vpc_endpoint_ids
  s3_vpc_endpoint_exempt_principal_arns = var.s3_vpc_endpoint_exempt_principal_arns

  portal_services = ["web", "bff", "relay", "control-plane"]

  enable_oidc_publishers   = var.enable_oidc_publishers
  github_oidc_provider_arn = var.github_oidc_provider_arn
  github_org               = var.github_org
}

# ---------------------------------------------------------------------------
# 2. Platform VPC (default on)
# ---------------------------------------------------------------------------

module "platform_vpc" {
  count  = var.enable_platform_vpc ? 1 : 0
  source = "../../modules/platform-vpc"

  name_prefix = var.name_prefix
  environment = local.environment
  tags        = local.common_tags
  vpc_cidr    = var.vpc_cidr

  availability_zones   = var.availability_zones
  public_subnet_cidrs  = var.public_subnet_cidrs
  private_subnet_cidrs = var.private_subnet_cidrs

  private_map_public_ip_on_launch = false

  enable_nat_gateway             = var.enable_nat_gateway
  single_nat_gateway             = var.single_nat_gateway
  enable_s3_gateway_endpoint     = var.enable_s3_gateway_endpoint
  enable_ecr_endpoints           = var.enable_ecr_endpoints
  enable_logs_endpoint           = var.enable_logs_endpoint
  enable_secretsmanager_endpoint = var.enable_secretsmanager_endpoint
  enable_ssm_endpoints           = var.enable_ssm_endpoints

  acknowledge_not_auto_applied = true
}

# ---------------------------------------------------------------------------
# Label SGs — satisfy module require_private_ingress_sources without cycles
# Real task/client SGs are attached via root aws_vpc_security_group_ingress_rule.
# ---------------------------------------------------------------------------

resource "aws_security_group" "cp_alb_clients_label" {
  count = (
    var.enable_portal_control_plane &&
    length(var.control_plane_allowed_ingress_security_group_ids) == 0 &&
    (var.auto_wire_security_groups || length(var.control_plane_allowed_ingress_cidr_blocks) == 0)
  ) ? 1 : 0

  name_prefix = "${var.name_prefix}-cp-alb-clients-"
  description = "Label SG for internal control-plane ALB ingress (real BFF/relay task SGs wired via external rules)."
  vpc_id      = local.vpc_id

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-cp-alb-clients-label"
  })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group" "rds_clients_label" {
  count = var.enable_control_plane_rds && length(var.rds_allowed_security_group_ids) == 0 ? 1 : 0

  name_prefix = "${var.name_prefix}-rds-clients-"
  description = "Label SG for control-plane RDS client ingress (real task SGs wired via external rules)."
  vpc_id      = local.vpc_id

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-rds-clients-label"
  })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group" "valkey_clients_label" {
  count = var.enable_portal_valkey && length(var.valkey_allowed_security_group_ids) == 0 ? 1 : 0

  name_prefix = "${var.name_prefix}-valkey-clients-"
  description = "Label SG for portal Valkey client ingress (real task SGs wired via external rules)."
  vpc_id      = local.vpc_id

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-valkey-clients-label"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# ---------------------------------------------------------------------------
# 3. Control-plane RDS (private, encrypted)
# ---------------------------------------------------------------------------

module "control_plane_rds" {
  count  = var.enable_control_plane_rds ? 1 : 0
  source = "../../modules/control-plane-rds"

  name_prefix = "${var.name_prefix}-cp"
  environment = local.environment
  tags        = local.common_tags

  vpc_id     = local.vpc_id
  subnet_ids = local.private_subnet_ids

  publicly_accessible        = false
  allowed_security_group_ids = local.rds_module_allowed_sgs
  allowed_cidr_blocks        = var.rds_allowed_cidr_blocks

  engine_version    = var.rds_engine_version
  instance_class    = var.rds_instance_class
  allocated_storage = var.rds_allocated_storage
  multi_az          = var.rds_multi_az
  db_name           = var.rds_db_name
  master_username   = var.rds_master_username

  deletion_protection = var.rds_deletion_protection
  skip_final_snapshot = var.rds_skip_final_snapshot

  create_ssm_parameter_pointer = true
  acknowledge_not_auto_applied = true
}

# External SG rule: CP tasks → RDS (breaks module cycle with database secret wiring).
resource "aws_vpc_security_group_ingress_rule" "rds_from_control_plane_tasks" {
  count = (
    var.enable_control_plane_rds &&
    var.enable_portal_control_plane &&
    var.auto_wire_security_groups
  ) ? 1 : 0

  security_group_id            = module.control_plane_rds[0].security_group_id
  referenced_security_group_id = module.portal_control_plane[0].task_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = module.control_plane_rds[0].db_instance_port
  to_port                      = module.control_plane_rds[0].db_instance_port
  description                  = "Control-plane Fargate tasks to private RDS Postgres"

  tags = local.common_tags
}

# ---------------------------------------------------------------------------
# 4. Portal Valkey (optional shared state)
# ---------------------------------------------------------------------------

module "portal_valkey" {
  count  = var.enable_portal_valkey ? 1 : 0
  source = "../../modules/portal-valkey"

  name_prefix = var.name_prefix
  environment = local.environment
  tags        = local.common_tags

  vpc_id     = local.vpc_id
  subnet_ids = local.private_subnet_ids

  allowed_security_group_ids = local.valkey_module_allowed_sgs
  allowed_cidr_blocks        = var.valkey_allowed_cidr_blocks

  node_type                    = var.valkey_node_type
  num_cache_clusters           = var.valkey_num_cache_clusters
  multi_az_enabled             = var.valkey_multi_az_enabled
  automatic_failover_enabled   = var.valkey_automatic_failover_enabled
  create_ssm_parameter_pointer = true
  acknowledge_not_auto_applied = true
}

# External SG rules: BFF/relay tasks → Valkey
resource "aws_vpc_security_group_ingress_rule" "valkey_from_bff_tasks" {
  count = (
    var.enable_portal_valkey &&
    var.enable_portal_bff &&
    var.auto_wire_security_groups
  ) ? 1 : 0

  security_group_id            = module.portal_valkey[0].security_group_id
  referenced_security_group_id = module.portal_bff[0].task_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = module.portal_valkey[0].port
  to_port                      = module.portal_valkey[0].port
  description                  = "BFF Fargate tasks to private Valkey"

  tags = local.common_tags
}

resource "aws_vpc_security_group_ingress_rule" "valkey_from_relay_tasks" {
  count = (
    var.enable_portal_valkey &&
    var.enable_portal_relay &&
    var.auto_wire_security_groups
  ) ? 1 : 0

  security_group_id            = module.portal_valkey[0].security_group_id
  referenced_security_group_id = module.portal_relay[0].task_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = module.portal_valkey[0].port
  to_port                      = module.portal_valkey[0].port
  description                  = "Relay Fargate tasks to private Valkey"

  tags = local.common_tags
}

# ---------------------------------------------------------------------------
# 5. Private control-plane service (INTERNAL ALB only — G1)
#     Declared before BFF/relay so CONTROL_PLANE_URL can be wired without cycles.
# ---------------------------------------------------------------------------

module "portal_control_plane" {
  count  = var.enable_portal_control_plane ? 1 : 0
  source = "../../modules/portal-control-plane-service"

  name_prefix = var.name_prefix
  environment = local.environment
  tags        = local.common_tags

  vpc_id             = local.vpc_id
  private_subnet_ids = local.private_subnet_ids

  # G1: must remain true — module hard-rejects public ALB.
  internal = true

  allowed_ingress_security_group_ids = local.cp_module_ingress_sgs
  allowed_ingress_cidr_blocks        = var.control_plane_allowed_ingress_cidr_blocks

  image_repository = local.control_plane_image_repository
  image_digest     = local.control_plane_image_digest
  cpu_architecture = var.portal_cpu_architecture
  image_tag_hint   = var.control_plane_image_tag_hint

  container_port    = var.control_plane_container_port
  listener_port     = var.control_plane_listener_port
  health_check_path = "/health"
  desired_count     = 1

  create_ecs_cluster = true

  environment_variables = var.control_plane_environment_variables
  secrets               = var.control_plane_secrets

  # lp-oop.37.6: durable instance secret material (SM envelope). Null until
  # operators create the secret + pass the ARN. Not auto-applied.
  instance_secret_material_sm_secret_arn  = var.control_plane_instance_secret_material_sm_secret_arn
  instance_secret_material_sm_kms_key_arn = var.control_plane_instance_secret_material_sm_kms_key_arn

  # One-way dependency: CP → RDS secret ARN only (never plaintext password output).
  database_url_secret_arn = var.enable_control_plane_rds ? module.control_plane_rds[0].control_plane_database_url_secret_arn : var.control_plane_database_url_secret_arn

  acknowledge_not_auto_applied = true
}

# External SG rules: BFF/relay tasks → internal CP ALB (SG refs, not private CIDRs).
resource "aws_vpc_security_group_ingress_rule" "cp_alb_from_bff_tasks" {
  count = (
    var.enable_portal_control_plane &&
    var.enable_portal_bff &&
    var.auto_wire_security_groups &&
    length(var.control_plane_allowed_ingress_security_group_ids) == 0
  ) ? 1 : 0

  security_group_id            = module.portal_control_plane[0].alb_security_group_id
  referenced_security_group_id = module.portal_bff[0].task_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = var.control_plane_listener_port
  to_port                      = var.control_plane_listener_port
  description                  = "BFF Fargate tasks to internal control-plane ALB"

  tags = local.common_tags
}

resource "aws_vpc_security_group_ingress_rule" "cp_alb_from_relay_tasks" {
  count = (
    var.enable_portal_control_plane &&
    var.enable_portal_relay &&
    var.auto_wire_security_groups &&
    length(var.control_plane_allowed_ingress_security_group_ids) == 0
  ) ? 1 : 0

  security_group_id            = module.portal_control_plane[0].alb_security_group_id
  referenced_security_group_id = module.portal_relay[0].task_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = var.control_plane_listener_port
  to_port                      = var.control_plane_listener_port
  description                  = "Relay Fargate tasks to internal control-plane ALB"

  tags = local.common_tags
}

# ---------------------------------------------------------------------------
# 6. Public BFF service (separate public ALB, digest pin, private CP URL)
# ---------------------------------------------------------------------------

module "portal_bff" {
  count  = var.enable_portal_bff ? 1 : 0
  source = "../../modules/portal-bff-service"

  name_prefix = var.name_prefix
  environment = local.environment
  tags        = local.common_tags

  vpc_id             = local.vpc_id
  public_subnet_ids  = local.public_subnet_ids
  private_subnet_ids = local.private_subnet_ids
  assign_public_ip   = false

  image_repository = local.bff_image_repository
  image_digest     = local.bff_image_digest
  cpu_architecture = var.portal_cpu_architecture
  image_tag_hint   = var.bff_image_tag_hint

  container_port    = var.bff_container_port
  health_check_path = "/health"
  desired_count     = 1

  create_ecs_cluster  = true
  enable_https        = local.bff_enable_https
  acm_certificate_arn = local.bff_acm_certificate_arn

  environment_variables       = local.bff_environment_variables
  secrets                     = local.bff_secrets
  execution_extra_secret_arns = var.bff_execution_extra_secret_arns

  acknowledge_not_auto_applied = true
}

# ---------------------------------------------------------------------------
# 7. Public relay service (separate public ALB, digest pin, private CP URL)
# ---------------------------------------------------------------------------

module "portal_relay" {
  count  = var.enable_portal_relay ? 1 : 0
  source = "../../modules/portal-relay-service"

  name_prefix = var.name_prefix
  environment = local.environment
  tags        = local.common_tags

  vpc_id             = local.vpc_id
  public_subnet_ids  = local.public_subnet_ids
  private_subnet_ids = local.private_subnet_ids
  assign_public_ip   = false

  image_repository = local.relay_image_repository
  image_digest     = local.relay_image_digest
  cpu_architecture = var.portal_cpu_architecture
  image_tag_hint   = var.relay_image_tag_hint

  container_port    = var.relay_container_port
  health_check_path = "/health"
  desired_count     = 1

  create_ecs_cluster  = true
  enable_https        = local.relay_enable_https
  acm_certificate_arn = local.relay_acm_certificate_arn

  environment_variables = local.relay_environment_variables
  secrets               = local.relay_secrets

  acknowledge_not_auto_applied = true
}

# ---------------------------------------------------------------------------
# 8. Static edge (private S3 + CloudFront OAC; BFF origin when BFF enabled)
# ---------------------------------------------------------------------------

module "portal_static_edge" {
  count  = var.enable_portal_static_edge ? 1 : 0
  source = "../../modules/portal-static-edge"

  name_prefix = var.name_prefix
  environment = local.environment
  tags        = local.common_tags

  origin_bucket_name          = var.static_origin_bucket_name
  force_destroy_origin_bucket = var.static_force_destroy_origin_bucket

  default_root_object      = "index.html"
  enable_spa_error_routing = true
  price_class              = var.static_price_class

  aliases             = local.static_aliases
  acm_certificate_arn = local.static_acm_certificate_arn
  web_acl_id          = local.static_web_acl_id

  # Wire BFF ALB DNS when BFF layer is enabled (bare hostname; no scheme).
  bff_origin_domain_name     = var.enable_portal_bff ? module.portal_bff[0].alb_dns_name : var.static_bff_origin_domain_name
  bff_origin_protocol_policy = var.static_bff_origin_protocol_policy
  api_path_pattern           = "/*/api/*"

  static_web_artifact_url     = var.static_web_artifact_url
  static_web_artifact_version = var.static_web_artifact_version
  static_web_artifact_sha256  = var.static_web_artifact_sha256

  acknowledge_not_auto_applied = true
}

# ---------------------------------------------------------------------------
# Optional DNS/TLS — ACM certs only (aliases at root for cycle safety)
# ---------------------------------------------------------------------------

module "portal_dns_tls" {
  count  = var.enable_portal_dns_tls ? 1 : 0
  source = "../../modules/portal-dns-tls"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  name_prefix = var.name_prefix
  environment = local.environment
  tags        = var.tags

  portal_web_hostname = var.portal_web_hostname
  bff_hostname        = var.bff_hostname
  relay_hostname      = var.relay_hostname
  # Include Docs hostname on regional ACM SAN so Docs ALB HTTPS can reuse the cert (lp-zuh.12.2).
  document_server_hostname = var.document_server_public_hostname

  create_route53_zone = var.dns_create_route53_zone
  route53_zone_id     = var.dns_route53_zone_id
  route53_zone_name   = var.dns_route53_zone_name

  # Certs first; Route53 aliases created below after ALB/CF exist
  create_dns_records = false

  existing_cloudfront_certificate_arn = var.dns_existing_cloudfront_certificate_arn
  existing_regional_certificate_arn   = var.dns_existing_regional_certificate_arn

  acknowledge_not_auto_applied = true
}

resource "aws_route53_record" "portal_web" {
  count = (
    var.enable_portal_dns_tls && var.dns_create_alias_records && var.portal_web_hostname != "" && var.enable_portal_static_edge
  ) ? 1 : 0

  zone_id = module.portal_dns_tls[0].route53_zone_id
  name    = var.portal_web_hostname
  type    = "A"

  alias {
    name                   = module.portal_static_edge[0].cloudfront_domain_name
    zone_id                = module.portal_static_edge[0].cloudfront_hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "bff" {
  count = (
    var.enable_portal_dns_tls && var.dns_create_alias_records && var.bff_hostname != "" && var.enable_portal_bff
  ) ? 1 : 0

  zone_id = module.portal_dns_tls[0].route53_zone_id
  name    = var.bff_hostname
  type    = "A"

  alias {
    name                   = module.portal_bff[0].alb_dns_name
    zone_id                = module.portal_bff[0].alb_zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "relay" {
  count = (
    var.enable_portal_dns_tls && var.dns_create_alias_records && var.relay_hostname != "" && var.enable_portal_relay
  ) ? 1 : 0

  zone_id = module.portal_dns_tls[0].route53_zone_id
  name    = var.relay_hostname
  type    = "A"

  alias {
    name                   = module.portal_relay[0].alb_dns_name
    zone_id                = module.portal_relay[0].alb_zone_id
    evaluate_target_health = true
  }
}

# ---------------------------------------------------------------------------
# Optional WAF — CloudFront (us-east-1) + regional public BFF/relay ALBs
# ---------------------------------------------------------------------------

module "portal_waf" {
  count  = var.enable_portal_waf ? 1 : 0
  source = "../../modules/portal-waf"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  name_prefix = var.name_prefix
  environment = local.environment
  tags        = local.common_tags

  enable_cloudfront_web_acl = var.waf_enable_cloudfront_web_acl
  enable_regional_web_acl   = var.waf_enable_regional_web_acl

  enable_common_rule_set       = var.waf_enable_common_rule_set
  enable_known_bad_inputs      = var.waf_enable_known_bad_inputs
  enable_rate_based_rule       = var.waf_enable_rate_based_rule
  rate_limit                   = var.waf_rate_limit
  managed_rule_override_action = var.waf_managed_rule_override_action

  # Public BFF/relay (+ staging Docs when enabled) — never control-plane internal ALB.
  associate_alb_arns = local.waf_associate_alb_arns

  acknowledge_not_auto_applied = true
}

# ---------------------------------------------------------------------------
# 11. Staging Document Server — topology staging-platform-shared-ds (lp-5q6.34)
#     Optional; default off. Shared staging DS only — not production residency.
# ---------------------------------------------------------------------------

module "staging_document_server" {
  count  = var.enable_staging_document_server ? 1 : 0
  source = "../../modules/staging-document-server"

  name_prefix = var.name_prefix
  environment = local.environment
  tags = merge(local.common_tags, {
    Topology = "staging-platform-shared-ds"
    Bead     = "lp-5q6.34"
  })

  vpc_id             = local.vpc_id
  public_subnet_ids  = local.public_subnet_ids
  private_subnet_ids = local.private_subnet_ids
  assign_public_ip   = false

  image_repository = var.document_server_image_repository
  image_digest     = coalesce(var.document_server_image_digest, "sha256:00000000000000000000000000000000000000000000000000000000000000d5")
  image_tag_hint   = var.document_server_image_tag_hint

  container_port    = 80
  health_check_path = "/healthcheck"
  desired_count     = var.document_server_desired_count
  cpu               = var.document_server_cpu
  memory            = var.document_server_memory
  cpu_architecture  = var.portal_cpu_architecture

  create_ecs_cluster  = true
  enable_https        = local.docs_enable_https
  acm_certificate_arn = local.docs_acm_certificate_arn

  # lp-zuh.12.9 Option B: CloudFront HTTPS → HTTP Docs ALB (no custom Docs ACM required).
  enable_cloudfront_https        = var.document_server_enable_cloudfront_https
  cloudfront_price_class         = var.document_server_cloudfront_price_class
  cloudfront_aliases             = var.document_server_cloudfront_aliases
  cloudfront_acm_certificate_arn = var.document_server_cloudfront_acm_certificate_arn

  create_jwt_secret           = var.document_server_create_jwt_secret
  jwt_secret_name             = var.document_server_jwt_secret_name
  jwt_secret_arn              = var.document_server_jwt_secret_arn
  create_license_secret_shell = var.document_server_create_license_secret_shell
  existing_license_secret_arn = var.document_server_existing_license_secret_arn

  allow_private_ip_address = var.document_server_allow_private_ip
  allow_meta_ip_address    = false

  acknowledge_not_auto_applied        = true
  acknowledge_staging_shared_residual = var.acknowledge_staging_shared_residual
}

# Optional Route53 alias for staging Docs hostname (browser → Document Server edge).
resource "aws_route53_record" "document_server" {
  count = (
    var.enable_staging_document_server &&
    var.enable_portal_dns_tls &&
    var.dns_create_alias_records &&
    var.document_server_public_hostname != ""
  ) ? 1 : 0

  zone_id = module.portal_dns_tls[0].route53_zone_id
  name    = var.document_server_public_hostname
  type    = "A"

  alias {
    name                   = module.staging_document_server[0].alb_dns_name
    zone_id                = module.staging_document_server[0].alb_zone_id
    evaluate_target_health = true
  }
}

