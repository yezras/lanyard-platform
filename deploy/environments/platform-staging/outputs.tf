# Non-secret endpoints, IDs, and secret ARNs only — never passwords, tokens, or full secret values.

# ---------------------------------------------------------------------------
# Product artifacts
# ---------------------------------------------------------------------------

output "artifact_bucket_id" {
  description = "Product artifact S3 bucket name."
  value       = module.product_artifacts.artifact_bucket_id
}

output "artifact_bucket_arn" {
  description = "Product artifact S3 bucket ARN (for tenant artifact_s3_bucket_arns)."
  value       = module.product_artifacts.artifact_bucket_arn
}

output "artifact_bucket_object_lock_enabled" {
  description = "Object Lock enabled on the product artifact bucket (always true)."
  value       = module.product_artifacts.artifact_bucket_object_lock_enabled
}

output "artifact_bucket_object_lock_default_retention" {
  description = "Default Object Lock retention (mode + days) for new release objects."
  value       = module.product_artifacts.artifact_bucket_object_lock_default_retention
}

output "artifact_bucket_tls_only" {
  description = "Bucket policy denies non-TLS access (always true)."
  value       = module.product_artifacts.artifact_bucket_tls_only
}

output "artifact_bucket_vpc_endpoint_restriction" {
  description = "Optional VPCE restriction status from the product-artifact-infra module."
  value       = module.product_artifacts.artifact_bucket_vpc_endpoint_restriction
}

output "artifact_prefixes" {
  description = "Hermes and client-core object key prefixes."
  value       = module.product_artifacts.artifact_prefixes
}

output "hermes_artifact_url_template" {
  description = "s3:// URL template for Hermes pins."
  value       = module.product_artifacts.hermes_artifact_url_template
}

output "client_core_artifact_url_template" {
  description = "s3:// URL template for client-core pins."
  value       = module.product_artifacts.client_core_artifact_url_template
}

output "ecr_repository_urls" {
  description = "Portal service → ECR repository URL (pin by digest in compatibility/)."
  value       = module.product_artifacts.ecr_repository_urls
}

output "ecr_repository_arns" {
  description = "Portal service → ECR repository ARN."
  value       = module.product_artifacts.ecr_repository_arns
}

output "oidc_publisher_role_arns" {
  description = "GitHub Actions publisher role ARNs (empty when OIDC publishers disabled)."
  value       = module.product_artifacts.oidc_publisher_role_arns
}

output "oidc_publisher_trust_subjects" {
  description = "Effective OIDC trust subjects per publisher."
  value       = module.product_artifacts.oidc_publisher_trust_subjects
}

output "release_contract_summary" {
  description = "Deploy-facing release contract and explicit non-goals for product artifacts."
  value       = module.product_artifacts.release_contract_summary
}

# ---------------------------------------------------------------------------
# Platform VPC
# ---------------------------------------------------------------------------

output "vpc_id" {
  description = "Platform VPC ID (null when enable_platform_vpc=false)."
  value       = try(module.platform_vpc[0].vpc_id, null)
}

output "vpc_cidr_block" {
  description = "Platform VPC CIDR."
  value       = try(module.platform_vpc[0].vpc_cidr_block, null)
}

output "public_subnet_ids" {
  description = "Public subnet IDs (BFF/relay ALBs)."
  value       = try(module.platform_vpc[0].public_subnet_ids, [])
}

output "private_subnet_ids" {
  description = "Private subnet IDs (Fargate, internal CP ALB, RDS, Valkey)."
  value       = try(module.platform_vpc[0].private_subnet_ids, [])
}

output "nat_gateway_ids" {
  description = "NAT gateway IDs."
  value       = try(module.platform_vpc[0].nat_gateway_ids, [])
}

output "vpc_endpoint_ids" {
  description = "VPC endpoint IDs map from platform-vpc."
  value       = try(module.platform_vpc[0].vpc_endpoint_ids, {})
}

# ---------------------------------------------------------------------------
# Control-plane RDS
# ---------------------------------------------------------------------------

output "rds_db_instance_id" {
  description = "Control-plane RDS instance id."
  value       = try(module.control_plane_rds[0].db_instance_id, null)
}

output "rds_db_instance_endpoint" {
  description = "Control-plane RDS endpoint (host:port) — non-secret."
  value       = try(module.control_plane_rds[0].db_instance_endpoint, null)
}

output "rds_db_instance_address" {
  description = "Control-plane RDS hostname."
  value       = try(module.control_plane_rds[0].db_instance_address, null)
}

output "rds_security_group_id" {
  description = "RDS security group ID."
  value       = try(module.control_plane_rds[0].security_group_id, null)
}

output "rds_publicly_accessible" {
  description = "Always false when RDS is enabled."
  value       = try(module.control_plane_rds[0].publicly_accessible, null)
}

output "rds_storage_encrypted" {
  description = "Always true when RDS is enabled."
  value       = try(module.control_plane_rds[0].storage_encrypted, null)
}

output "control_plane_database_url_secret_arn" {
  description = "Secrets Manager ARN for CONTROL_PLANE_DATABASE_URL (ARN only — never the password)."
  value       = try(module.control_plane_rds[0].control_plane_database_url_secret_arn, null)
}

output "control_plane_database_url_secret_name" {
  description = "Secrets Manager secret name for CONTROL_PLANE_DATABASE_URL."
  value       = try(module.control_plane_rds[0].control_plane_database_url_secret_name, null)
}

output "control_plane_database_url_ssm_parameter_name" {
  description = "SSM parameter name pointing at the database URL secret ARN."
  value       = try(module.control_plane_rds[0].control_plane_database_url_ssm_parameter_name, null)
}

# ---------------------------------------------------------------------------
# Portal Valkey
# ---------------------------------------------------------------------------

output "valkey_primary_endpoint_address" {
  description = "Valkey primary endpoint hostname (non-secret)."
  value       = try(module.portal_valkey[0].primary_endpoint_address, null)
}

output "valkey_port" {
  description = "Valkey port."
  value       = try(module.portal_valkey[0].port, null)
}

output "valkey_security_group_id" {
  description = "Valkey security group ID."
  value       = try(module.portal_valkey[0].security_group_id, null)
}

output "redis_url_secret_arn" {
  description = "Secrets Manager ARN for REDIS_URL (ARN only — never the token)."
  value       = try(module.portal_valkey[0].redis_url_secret_arn, null)
}

output "redis_url_secret_name" {
  description = "Secrets Manager secret name for REDIS_URL."
  value       = try(module.portal_valkey[0].redis_url_secret_name, null)
}

output "redis_url_ssm_parameter_name" {
  description = "SSM parameter name pointing at the REDIS_URL secret ARN."
  value       = try(module.portal_valkey[0].redis_url_ssm_parameter_name, null)
}

# ---------------------------------------------------------------------------
# Portal BFF (public)
# ---------------------------------------------------------------------------

output "bff_alb_dns_name" {
  description = "Public BFF ALB DNS name."
  value       = try(module.portal_bff[0].alb_dns_name, null)
}

output "bff_alb_arn" {
  description = "Public BFF ALB ARN."
  value       = try(module.portal_bff[0].alb_arn, null)
}

output "bff_alb_security_group_id" {
  description = "BFF ALB security group ID."
  value       = try(module.portal_bff[0].alb_security_group_id, null)
}

output "bff_task_security_group_id" {
  description = "BFF task security group ID (wired to CP ALB and optionally Valkey)."
  value       = try(module.portal_bff[0].task_security_group_id, null)
}

output "bff_ecs_cluster_name" {
  description = "BFF ECS cluster name."
  value       = try(module.portal_bff[0].ecs_cluster_name, null)
}

output "bff_ecs_service_name" {
  description = "BFF ECS service name."
  value       = try(module.portal_bff[0].ecs_service_name, null)
}

output "bff_image_pin" {
  description = "BFF repository@digest pin (non-secret)."
  value       = try(module.portal_bff[0].image_pin, null)
}

# ---------------------------------------------------------------------------
# Portal relay (public)
# ---------------------------------------------------------------------------

output "relay_alb_dns_name" {
  description = "Public relay ALB DNS name."
  value       = try(module.portal_relay[0].alb_dns_name, null)
}

output "relay_alb_arn" {
  description = "Public relay ALB ARN."
  value       = try(module.portal_relay[0].alb_arn, null)
}

output "relay_alb_security_group_id" {
  description = "Relay ALB security group ID."
  value       = try(module.portal_relay[0].alb_security_group_id, null)
}

output "relay_task_security_group_id" {
  description = "Relay task security group ID."
  value       = try(module.portal_relay[0].task_security_group_id, null)
}

output "relay_ecs_cluster_name" {
  description = "Relay ECS cluster name."
  value       = try(module.portal_relay[0].ecs_cluster_name, null)
}

output "relay_ecs_service_name" {
  description = "Relay ECS service name."
  value       = try(module.portal_relay[0].ecs_service_name, null)
}

output "relay_image_pin" {
  description = "Relay repository@digest pin (non-secret)."
  value       = try(module.portal_relay[0].image_pin, null)
}

# ---------------------------------------------------------------------------
# Portal control plane (internal only)
# ---------------------------------------------------------------------------

output "control_plane_alb_dns_name" {
  description = "Internal control-plane ALB DNS name (VPC-only)."
  value       = try(module.portal_control_plane[0].alb_dns_name, null)
}

output "control_plane_url" {
  description = "Private CONTROL_PLANE_URL base (http://internal-alb) auto-wired into BFF/relay env — non-secret."
  value       = local.control_plane_url
}

output "control_plane_alb_arn" {
  description = "Internal control-plane ALB ARN."
  value       = try(module.portal_control_plane[0].alb_arn, null)
}

output "control_plane_alb_internal" {
  description = "Always true when control-plane is enabled (G1)."
  value       = try(module.portal_control_plane[0].alb_internal, null)
}

output "control_plane_alb_security_group_id" {
  description = "Internal control-plane ALB security group ID."
  value       = try(module.portal_control_plane[0].alb_security_group_id, null)
}

output "control_plane_task_security_group_id" {
  description = "Control-plane task security group ID (wired to RDS via external rule)."
  value       = try(module.portal_control_plane[0].task_security_group_id, null)
}

output "control_plane_ecs_cluster_name" {
  description = "Control-plane ECS cluster name."
  value       = try(module.portal_control_plane[0].ecs_cluster_name, null)
}

output "control_plane_ecs_service_name" {
  description = "Control-plane ECS service name."
  value       = try(module.portal_control_plane[0].ecs_service_name, null)
}

output "control_plane_image_pin" {
  description = "Control-plane repository@digest pin (non-secret)."
  value       = try(module.portal_control_plane[0].image_pin, null)
}

output "control_plane_task_role_name" {
  description = "Control-plane task role name (CLI attach for instance-secret-material SM)."
  value       = try(module.portal_control_plane[0].task_role_name, null)
}

output "control_plane_instance_secret_material_sm_configured" {
  description = "True when control_plane_instance_secret_material_sm_secret_arn is set."
  value       = try(module.portal_control_plane[0].instance_secret_material_sm_configured, false)
}

# ---------------------------------------------------------------------------
# Static edge
# ---------------------------------------------------------------------------

output "static_origin_bucket_id" {
  description = "Private static-web origin bucket name."
  value       = try(module.portal_static_edge[0].origin_bucket_id, null)
}

output "static_origin_bucket_arn" {
  description = "Private static-web origin bucket ARN."
  value       = try(module.portal_static_edge[0].origin_bucket_arn, null)
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID."
  value       = try(module.portal_static_edge[0].cloudfront_distribution_id, null)
}

output "cloudfront_domain_name" {
  description = "CloudFront domain name."
  value       = try(module.portal_static_edge[0].cloudfront_domain_name, null)
}

output "cloudfront_distribution_arn" {
  description = "CloudFront distribution ARN."
  value       = try(module.portal_static_edge[0].cloudfront_distribution_arn, null)
}

output "static_bff_api_routing" {
  description = "BFF API path routing status on the static edge."
  value       = try(module.portal_static_edge[0].bff_api_routing, null)
}

output "static_web_pin" {
  description = "Static web pin metadata (URL/version/SHA when set)."
  value       = try(module.portal_static_edge[0].static_web_pin, null)
}

# ---------------------------------------------------------------------------
# Compose readiness / honesty
# ---------------------------------------------------------------------------

output "compose_layers" {
  description = "Which platform layers are enabled in this root."
  value = {
    product_artifact_infra    = true
    platform_vpc              = var.enable_platform_vpc
    control_plane_rds         = var.enable_control_plane_rds
    portal_valkey             = var.enable_portal_valkey
    portal_bff                = var.enable_portal_bff
    portal_relay              = var.enable_portal_relay
    portal_control_plane      = var.enable_portal_control_plane
    portal_static_edge        = var.enable_portal_static_edge
    staging_document_server   = var.enable_staging_document_server
    auto_wire_security_groups = var.auto_wire_security_groups
  }
}

output "end_to_end_wiring" {
  description = "Staging evidence of auto-wired non-secret references (no secret values)."
  value = {
    ecr_repos_from_product_artifacts = {
      bff           = local.bff_image_repository
      relay         = local.relay_image_repository
      control_plane = local.control_plane_image_repository
    }
    digest_pins = {
      bff           = local.bff_image_digest
      relay         = local.relay_image_digest
      control_plane = local.control_plane_image_digest
    }
    control_plane_url_to_bff   = var.enable_portal_bff && var.enable_portal_control_plane && var.inject_control_plane_url_into_bff
    control_plane_url_to_relay = var.enable_portal_relay && var.enable_portal_control_plane && var.inject_control_plane_url_into_relay
    control_plane_url          = local.control_plane_url
    rds_secret_arn_to_cp       = var.enable_control_plane_rds && var.enable_portal_control_plane
    redis_url_to_bff           = var.enable_portal_valkey && var.enable_portal_bff && var.inject_redis_url_into_bff
    redis_url_to_relay         = var.enable_portal_valkey && var.enable_portal_relay && var.inject_redis_url_into_relay
    sg_cp_alb_from_bff_relay   = var.auto_wire_security_groups
    sg_rds_from_cp_tasks       = var.auto_wire_security_groups && var.enable_control_plane_rds && var.enable_portal_control_plane
    sg_valkey_from_bff_relay   = var.auto_wire_security_groups && var.enable_portal_valkey
    static_edge_bff_origin     = var.enable_portal_bff && var.enable_portal_static_edge
    staging_document_server    = var.enable_staging_document_server
    office_jwt_to_bff          = var.enable_staging_document_server && var.inject_office_jwt_into_bff
    office_env_to_bff          = var.enable_staging_document_server && var.inject_office_env_into_bff
    secret_values_exported     = false
  }
}

# ---------------------------------------------------------------------------
# Staging Document Server (lp-5q6.34) — ARNs and DNS only, never JWT values
# ---------------------------------------------------------------------------

output "staging_document_server_enabled" {
  description = "Whether staging-platform-shared-ds Document Server layer is enabled."
  value       = var.enable_staging_document_server
}

output "document_server_topology" {
  description = "Named topology when Document Server is enabled (null when off)."
  value       = var.enable_staging_document_server ? "staging-platform-shared-ds" : null
}

output "document_server_alb_dns_name" {
  description = "Public Document Server ALB DNS (browser → api.js). Null when layer off."
  value       = try(module.staging_document_server[0].alb_dns_name, null)
}

output "document_server_public_base_url" {
  description = "Browser-facing Document Server base URL (hostname override or ALB). Null when off."
  value       = local.document_server_public_base_url
}

output "document_server_host" {
  description = "Comma-separated host(s) for BFF_OFFICE_DOCUMENT_SERVER_HOSTS (no scheme). May include CloudFront domain, public Docs hostname, and ALB DNS for HTTPS cutover. Null when off."
  value       = local.document_server_host
}

output "document_server_cloudfront_domain_name" {
  description = "Docs CloudFront domain when document_server_enable_cloudfront_https (null otherwise)."
  value       = try(module.staging_document_server[0].cloudfront_domain_name, null)
}

output "document_server_cloudfront_distribution_id" {
  description = "Docs CloudFront distribution ID when enabled (null otherwise)."
  value       = try(module.staging_document_server[0].cloudfront_distribution_id, null)
}

output "document_server_jwt_secret_arn" {
  description = "Secrets Manager ARN for Office JWT (ARN only). Null when off."
  value       = try(module.staging_document_server[0].jwt_secret_arn, null)
}

output "document_server_license_secret_arn" {
  description = "Optional license material SM ARN (null on free track / when off)."
  value       = try(module.staging_document_server[0].license_secret_arn, null)
}

output "document_server_health_check" {
  description = "Document Server health check contract when enabled."
  value       = try(module.staging_document_server[0].health_check, null)
}

output "document_server_module_status" {
  description = "Honesty summary for staging Document Server module."
  value       = try(module.staging_document_server[0].module_status, null)
}

output "bff_office_public_base_url" {
  description = "BFF_OFFICE_PUBLIC_BASE_URL wired for DS→BFF reachability (null when not configured)."
  value       = local.bff_office_public_base_url
}

output "apply_readiness" {
  description = "Whether this root is intentionally gated from apply with example placeholders."
  value = {
    validate_without_credentials = true
    readiness                    = "infra_ready"
    production_applied           = false
    apply_ready = (
      !can(regex("REPLACE|UNCONFIGURED|changeme", var.artifact_bucket_name)) &&
      !can(regex("REPLACE|UNCONFIGURED|changeme", var.static_origin_bucket_name)) &&
      (!var.enable_oidc_publishers || (var.github_oidc_provider_arn != null && var.github_oidc_provider_arn != "")) &&
      (!var.enable_portal_bff || (var.bff_image_digest != null && !can(regex("^sha256:0{64}$", var.bff_image_digest)))) &&
      (!var.enable_portal_relay || (var.relay_image_digest != null && !can(regex("^sha256:0{64}$", var.relay_image_digest)))) &&
      (!var.enable_portal_control_plane || (var.control_plane_image_digest != null && !can(regex("^sha256:0{64}$", var.control_plane_image_digest))))
    )
    blockers_if_not_ready = [
      "Replace artifact_bucket_name placeholder (no REPLACE/UNCONFIGURED suffix)",
      "Replace static_origin_bucket_name placeholder",
      "Copy backend.tf.example → backend.tf with real state bucket (never commit)",
      "If enable_oidc_publishers: supply existing github_oidc_provider_arn",
      "Replace placeholder image digests with private compatibility pins (never commit live digests)",
      "Product publishing workflows remain in product repos",
      "This root is infra_ready compose only — not production-applied or G8 certified",
    ]
  }
}

output "portal_dns_tls_enabled" {
  description = "Whether optional portal-dns-tls layer is enabled."
  value       = var.enable_portal_dns_tls
}

output "portal_cloudfront_certificate_arn" {
  description = "CloudFront (us-east-1) ACM certificate ARN when DNS/TLS layer enabled."
  value       = var.enable_portal_dns_tls ? module.portal_dns_tls[0].cloudfront_certificate_arn : null
}

output "portal_regional_certificate_arn" {
  description = "Regional ACM certificate ARN for BFF/relay when DNS/TLS layer enabled."
  value       = var.enable_portal_dns_tls ? module.portal_dns_tls[0].regional_certificate_arn : null
}

output "portal_route53_zone_id" {
  description = "Route53 zone ID used for Portal/relay aliases when DNS/TLS layer enabled."
  value       = var.enable_portal_dns_tls ? module.portal_dns_tls[0].route53_zone_id : null
}

output "portal_waf_enabled" {
  description = "Whether optional portal-waf layer is enabled."
  value       = var.enable_portal_waf
}

output "portal_cloudfront_web_acl_arn" {
  description = "CloudFront (us-east-1) WAFv2 WebACL ARN when WAF layer enabled."
  value       = var.enable_portal_waf ? module.portal_waf[0].cloudfront_web_acl_arn : null
}

output "portal_regional_web_acl_arn" {
  description = "Regional WAFv2 WebACL ARN for BFF/relay when WAF layer enabled."
  value       = var.enable_portal_waf ? module.portal_waf[0].regional_web_acl_arn : null
}

output "portal_waf_associated_alb_arns" {
  description = "Public ALB ARNs associated with the regional WebACL when WAF layer enabled."
  value       = var.enable_portal_waf ? module.portal_waf[0].associated_alb_arns : []
}
