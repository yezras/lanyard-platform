# ---------------------------------------------------------------------------
# Core / product artifacts
# ---------------------------------------------------------------------------

variable "region" {
  type        = string
  description = "AWS region for platform staging."
  default     = "us-east-1"
}

variable "name_prefix" {
  type        = string
  description = "Short lowercase prefix for resource names (no account IDs)."
  default     = "lanyard-platform-staging"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,38}[a-z0-9]$", var.name_prefix))
    error_message = "name_prefix must be 3–40 chars, lowercase alphanumeric and hyphens."
  }
}

variable "artifact_bucket_name" {
  type        = string
  description = <<-EOT
    Globally unique S3 bucket name for product artifacts. Example values use a deliberate
    REPLACE suffix so this root is not apply-ready until operators pick a real unique name.
  EOT
  default     = "lanyard-product-artifacts-staging-REPLACE"
}

variable "enable_oidc_publishers" {
  type        = bool
  description = "Create GitHub Actions OIDC publisher roles (requires github_oidc_provider_arn)."
  default     = false
}

variable "github_oidc_provider_arn" {
  type        = string
  description = <<-EOT
    Existing IAM OIDC provider ARN for token.actions.githubusercontent.com.
    Required when enable_oidc_publishers is true. Never invent a live account ID in git.
  EOT
  default     = null
}

variable "github_org" {
  type        = string
  description = "GitHub org for default OIDC trust subjects."
  default     = "LanyardBrain"
}

variable "s3_force_destroy" {
  type        = bool
  description = "Allow non-empty artifact bucket destroy. Keep false for real staging/prod."
  default     = false
}

variable "s3_object_lock_default_retention_mode" {
  type        = string
  description = "Default Object Lock mode for new release objects (GOVERNANCE or COMPLIANCE)."
  default     = "GOVERNANCE"
}

variable "s3_object_lock_default_retention_days" {
  type        = number
  description = "Default Object Lock retention days for new release objects."
  default     = 90
}

variable "s3_noncurrent_version_expiration_days" {
  type        = number
  description = "Expire noncurrent artifact versions after N days (0 disables)."
  default     = 90
}

variable "s3_sse_algorithm" {
  type        = string
  description = "Artifact bucket SSE algorithm (AES256 or aws:kms)."
  default     = "AES256"
}

variable "s3_kms_key_id" {
  type        = string
  description = "Customer-managed KMS key ARN/id when s3_sse_algorithm is aws:kms."
  default     = null
}

variable "s3_vpc_endpoint_ids" {
  type        = list(string)
  description = "Optional S3 VPC endpoint IDs for advanced bucket policy restriction."
  default     = []
}

variable "s3_vpc_endpoint_exempt_principal_arns" {
  type        = list(string)
  description = "Principal ARNs exempt from optional VPCE restriction (never commit live account IDs)."
  default     = []
}

variable "ecr_image_count_limit" {
  type        = number
  description = "Max images retained per Portal ECR repository."
  default     = 50
}

variable "tags" {
  type        = map(string)
  description = "Extra tags merged into module resources."
  default     = {}
}

# ---------------------------------------------------------------------------
# Layer enable flags (compose all central layers; valkey optional)
# ---------------------------------------------------------------------------

variable "enable_platform_vpc" {
  type        = bool
  description = "Create modules/platform-vpc (two-AZ public/private foundation). Required for compute/data layers."
  default     = true
}

variable "enable_control_plane_rds" {
  type        = bool
  description = "Create modules/control-plane-rds (private encrypted Postgres)."
  default     = true
}

variable "enable_portal_valkey" {
  type        = bool
  description = "Create modules/portal-valkey (optional private shared state). Default off until G5/G6 consumers are ready."
  default     = false
}

variable "enable_portal_bff" {
  type        = bool
  description = "Create modules/portal-bff-service (public BFF ALB + Fargate)."
  default     = true
}

variable "enable_portal_relay" {
  type        = bool
  description = "Create modules/portal-relay-service (public relay ALB + Fargate)."
  default     = true
}

variable "enable_portal_control_plane" {
  type        = bool
  description = "Create modules/portal-control-plane-service (internal ALB only)."
  default     = true
}

variable "enable_portal_static_edge" {
  type        = bool
  description = "Create modules/portal-static-edge (CloudFront OAC + private S3)."
  default     = true
}

variable "auto_wire_security_groups" {
  type        = bool
  description = <<-EOT
    When true, wire sibling task SGs via external aws_vpc_security_group_ingress_rule
    (CP ALB from BFF/relay, RDS from CP tasks, Valkey from BFF/relay) without broad CIDRs.
    Module inputs use root label SGs to avoid cycles (so BFF can consume CONTROL_PLANE_URL).
    Set false and pass explicit *_allowed_*_security_group_ids for two-phase apply.
  EOT
  default     = true
}

# ---------------------------------------------------------------------------
# Platform VPC topology (lab RFC1918 examples only)
# ---------------------------------------------------------------------------

variable "vpc_cidr" {
  type        = string
  description = "VPC IPv4 CIDR (lab ranges only in committed examples)."
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  type        = list(string)
  description = "Availability zones (minimum 2)."
  default     = ["us-east-1a", "us-east-1b"]
}

variable "public_subnet_cidrs" {
  type        = list(string)
  description = "Public subnet CIDRs for BFF/relay ALBs (minimum 2)."
  default     = ["10.0.0.0/24", "10.0.1.0/24"]
}

variable "private_subnet_cidrs" {
  type        = list(string)
  description = "Private subnet CIDRs for Fargate/CP/RDS/Valkey (minimum 2)."
  default     = ["10.0.10.0/24", "10.0.11.0/24"]
}

variable "enable_nat_gateway" {
  type        = bool
  description = "NAT for private subnet egress."
  default     = true
}

variable "single_nat_gateway" {
  type        = bool
  description = "Single NAT (staging cost) vs one per AZ."
  default     = true
}

variable "enable_s3_gateway_endpoint" {
  type        = bool
  default     = true
  description = "S3 gateway endpoint on private route tables."
}

variable "enable_ecr_endpoints" {
  type        = bool
  default     = true
  description = "ECR API + DKR interface endpoints."
}

variable "enable_logs_endpoint" {
  type        = bool
  default     = true
  description = "CloudWatch Logs interface endpoint."
}

variable "enable_secretsmanager_endpoint" {
  type        = bool
  default     = true
  description = "Secrets Manager interface endpoint."
}

variable "enable_ssm_endpoints" {
  type        = bool
  default     = true
  description = "SSM interface endpoints."
}

# ---------------------------------------------------------------------------
# Control-plane RDS
# ---------------------------------------------------------------------------

variable "rds_allowed_security_group_ids" {
  type        = list(string)
  description = <<-EOT
    Explicit SGs allowed to Postgres. When empty and auto_wire_security_groups=true,
    a root label SG satisfies the module check and CP task SG is wired via external rule.
  EOT
  default     = []

  validation {
    condition = alltrue([
      for id in var.rds_allowed_security_group_ids : can(regex("^sg-[0-9a-f]{8,}$", id))
    ])
    error_message = "each rds_allowed_security_group_ids entry must look like sg-… ."
  }
}

variable "rds_allowed_cidr_blocks" {
  type        = list(string)
  description = "Optional private CIDRs for RDS (never 0.0.0.0/0). Prefer SG wiring."
  default     = []
}

variable "rds_engine_version" {
  type        = string
  default     = "16.6"
  description = "PostgreSQL engine version."
}

variable "rds_instance_class" {
  type        = string
  default     = "db.t4g.small"
  description = "RDS instance class. Pilot default is Single-AZ small (metadata only; chat/vault live on client EBS)."
}

variable "rds_allocated_storage" {
  type        = number
  default     = 20
  description = "Allocated storage (GiB). Pilot floor is 20 (module minimum)."
}

variable "rds_multi_az" {
  type        = bool
  default     = false
  description = "Multi-AZ RDS. Pilot default false; set true for HA staging/prod-like."
}

variable "rds_db_name" {
  type        = string
  default     = "control_plane"
  description = "Initial database name."
}

variable "rds_master_username" {
  type        = string
  default     = "cp_admin"
  description = "Master username (password generated into Secrets Manager)."
}

variable "rds_deletion_protection" {
  type        = bool
  default     = true
  description = "RDS deletion protection."
}

variable "rds_skip_final_snapshot" {
  type        = bool
  default     = false
  description = "Skip final snapshot (lab only; pair with deletion_protection=false)."
}

# ---------------------------------------------------------------------------
# Portal Valkey
# ---------------------------------------------------------------------------

variable "valkey_allowed_security_group_ids" {
  type        = list(string)
  description = "Explicit SGs allowed to Valkey. Empty → label SG + external BFF/relay rules when auto_wire."
  default     = []

  validation {
    condition = alltrue([
      for id in var.valkey_allowed_security_group_ids : can(regex("^sg-[0-9a-f]{8,}$", id))
    ])
    error_message = "each valkey_allowed_security_group_ids entry must look like sg-… ."
  }
}

variable "valkey_allowed_cidr_blocks" {
  type        = list(string)
  description = "Optional private CIDRs for Valkey (never 0.0.0.0/0)."
  default     = []
}

variable "valkey_node_type" {
  type        = string
  default     = "cache.t4g.micro"
  description = "ElastiCache node type."
}

variable "valkey_num_cache_clusters" {
  type        = number
  default     = 1
  description = "Number of cache clusters. Staging cost path default is 1 (single-node); use >=2 with HA flags for multi-AZ."
}

variable "valkey_multi_az_enabled" {
  type        = bool
  default     = false
  description = "Valkey multi-AZ. Staging cost path default false; set true only with num_cache_clusters >= 2 and automatic_failover_enabled."
}

variable "valkey_automatic_failover_enabled" {
  type        = bool
  default     = false
  description = "Valkey automatic failover. Staging cost path default false (required when num_cache_clusters=1). Module requires true when multi_az_enabled."
}

variable "inject_redis_url_into_bff" {
  type        = bool
  default     = true
  description = "When Valkey enabled, inject REDIS_URL into BFF secrets map from secret ARN."
}

variable "inject_redis_url_into_relay" {
  type        = bool
  default     = true
  description = "When Valkey enabled, inject REDIS_URL into relay secrets map from secret ARN."
}

variable "inject_control_plane_url_into_bff" {
  type        = bool
  default     = true
  description = "When control-plane enabled, inject private CONTROL_PLANE_URL into BFF env from internal ALB DNS."
}

variable "inject_control_plane_url_into_relay" {
  type        = bool
  default     = true
  description = "When control-plane enabled, inject private CONTROL_PLANE_URL into relay env from internal ALB DNS."
}

# ---------------------------------------------------------------------------
# Portal image pins (digest authority; placeholders validate, not apply-ready)
# ---------------------------------------------------------------------------

variable "bff_image_repository" {
  type        = string
  default     = null
  description = <<-EOT
    BFF ECR repository URL without tag/digest (compatibility portal.images.bff.repository).
    Null → product-artifact-infra ecr_repository_urls["bff"] (no manual copy/paste).
  EOT
}

variable "bff_image_digest" {
  type        = string
  default     = null
  description = <<-EOT
    BFF image digest pin (sha256: + 64 hex; compatibility portal.images.bff.digest).
    Required for apply — never tag-only or :latest. Null → placeholder digest for validate only.
  EOT
}

variable "bff_image_tag_hint" {
  type        = string
  default     = "v0.0.0-example"
  description = "Optional tag hint (not deploy authority)."
}

variable "bff_container_port" {
  type        = number
  default     = 4000
  description = "BFF container port."
}

variable "bff_enable_https" {
  type        = bool
  default     = false
  description = "Enable HTTPS listener on BFF ALB (requires acm_certificate_arn)."
}

variable "bff_acm_certificate_arn" {
  type        = string
  default     = null
  description = "ACM cert for BFF ALB HTTPS (same region)."
}

variable "bff_environment_variables" {
  type        = map(string)
  default     = {}
  description = <<-EOT
    Non-secret BFF env vars only (e.g. GOOGLE_CLIENT_ID, NODE_ENV, BFF_SESSION_BACKEND).
    Never put GOOGLE_CLIENT_SECRET, SESSION_SECRET, CONTROL_PLANE_SERVICE_TOKEN, REDIS_URL here.
    Modules reject OIDC client secrets in plain env for every environment label.
  EOT
}

variable "bff_secrets" {
  type = map(object({
    value_from  = string
    kms_key_arn = optional(string)
  }))
  default     = {}
  description = <<-EOT
    Additional BFF SM/SSM secret ARNs (merged with optional REDIS_URL).
    Typical OIDC keys: GOOGLE_CLIENT_SECRET, SESSION_SECRET, CONTROL_PLANE_SERVICE_TOKEN.
    ARNs only — never secret values. See staging-secrets-checklist § OIDC.
  EOT
}

variable "bff_execution_extra_secret_arns" {
  type        = list(string)
  default     = []
  description = <<-EOT
    SM ARNs for BFF exec-role GetSecretValue without injecting into the BFF
    container (portal-bff-service.execution_extra_secret_arns).
    Live residual (lp-oop.38.20): while lanyard-platform-staging-harness reuses
    lanyard-platform-staging-bff-exec, private tfvars MUST list harness-litellm
    and daytona so IAM reconcile does not drain the harness service.
    After the harness task uses modules/harness-exec-iam, leave this empty.
    ARNs only — never secret values. Do not terraform apply from lp-oop.38.20.
  EOT

  validation {
    condition = alltrue([
      for arn in var.bff_execution_extra_secret_arns :
      can(regex("^arn:aws[a-z-]*:secretsmanager:", arn))
    ])
    error_message = "each bff_execution_extra_secret_arns entry must be a secretsmanager ARN."
  }
}

variable "relay_image_repository" {
  type        = string
  default     = null
  description = <<-EOT
    Relay ECR repository URL (compatibility portal.images.relay.repository).
    Null → product-artifact-infra ecr_repository_urls["relay"].
  EOT
}

variable "relay_image_digest" {
  type        = string
  default     = null
  description = <<-EOT
    Relay image digest pin (sha256: + 64 hex; compatibility portal.images.relay.digest).
    Never tag-only or :latest. Null → placeholder for validate only.
  EOT
}

variable "relay_image_tag_hint" {
  type        = string
  default     = "v0.0.0-example"
  description = "Optional relay tag hint."
}

variable "relay_container_port" {
  type        = number
  default     = 8787
  description = "Relay container port."
}

variable "relay_enable_https" {
  type        = bool
  default     = false
  description = "Enable HTTPS on relay ALB."
}

variable "relay_acm_certificate_arn" {
  type        = string
  default     = null
  description = "ACM cert for relay ALB."
}

variable "relay_environment_variables" {
  type        = map(string)
  default     = {}
  description = "Non-secret relay env vars only."
}

variable "relay_secrets" {
  type = map(object({
    value_from  = string
    kms_key_arn = optional(string)
  }))
  default     = {}
  description = "Additional relay SM/SSM secret ARNs."
}

variable "control_plane_image_repository" {
  type        = string
  default     = null
  description = <<-EOT
    Control-plane ECR repository URL (compatibility portal.images.control-plane.repository).
    Null → product-artifact-infra ecr_repository_urls["control-plane"].
  EOT
}

variable "control_plane_image_digest" {
  type        = string
  default     = null
  description = <<-EOT
    Control-plane image digest pin (sha256: + 64 hex; compatibility portal.images.control-plane.digest).
    Never tag-only or :latest. Null → placeholder for validate only.
  EOT
}

variable "control_plane_image_tag_hint" {
  type        = string
  default     = "v0.0.0-example"
  description = "Optional control-plane tag hint."
}

variable "control_plane_container_port" {
  type        = number
  default     = 3100
  description = "Control-plane container port."
}

variable "control_plane_listener_port" {
  type        = number
  default     = 80
  description = "Internal control-plane ALB listener port (HTTP inside VPC; used for CONTROL_PLANE_URL and SG rules)."
}

variable "control_plane_allowed_ingress_security_group_ids" {
  type        = list(string)
  description = <<-EOT
    Explicit SGs allowed to internal control-plane ALB.
    Empty + auto_wire_security_groups → label SG on module + external BFF/relay task rules.
  EOT
  default     = []

  validation {
    condition = alltrue([
      for id in var.control_plane_allowed_ingress_security_group_ids : can(regex("^sg-[0-9a-f]{8,}$", id))
    ])
    error_message = "each control_plane_allowed_ingress_security_group_ids entry must look like sg-… ."
  }
}

variable "control_plane_allowed_ingress_cidr_blocks" {
  type        = list(string)
  description = "Optional private CIDRs to internal control-plane ALB (never 0.0.0.0/0)."
  default     = []
}

variable "control_plane_environment_variables" {
  type        = map(string)
  default     = {}
  description = <<-EOT
    Non-secret control-plane env vars only (e.g. CONTROL_PLANE_AUTH_MODE=production, GOOGLE_CLIENT_ID).
    Never put GOOGLE_CLIENT_SECRET, CONTROL_PLANE_SERVICE_TOKEN, INTERNAL_OPS_TOKEN, or DB URLs here.
  EOT
}

variable "control_plane_secrets" {
  type = map(object({
    value_from  = string
    kms_key_arn = optional(string)
  }))
  default     = {}
  description = <<-EOT
    Additional control-plane SM/SSM secret ARNs (merged with RDS database_url_secret_arn when enabled).
    Typical OIDC keys: GOOGLE_CLIENT_SECRET, CONTROL_PLANE_SERVICE_TOKEN, INTERNAL_OPS_TOKEN.
    ARNs only — never secret values. Memberships live in Postgres, not in these maps.
  EOT
}

variable "control_plane_instance_secret_material_sm_secret_arn" {
  type        = string
  default     = null
  description = <<-EOT
    Optional SM ARN for the encrypted CP instance-secret-material envelope
    (lp-oop.37.6). Durable across Fargate recycle. KEY stays in
    control_plane_secrets["INSTANCE_SECRET_MATERIAL_KEY"]. Unset
    INSTANCE_SECRET_MATERIAL_PATH. Operators create the secret; this module
    does not apply automatically.
  EOT
}

variable "control_plane_instance_secret_material_sm_kms_key_arn" {
  type        = string
  default     = null
  description = "Optional CMK ARN for the instance-secret-material SM secret."
}

variable "control_plane_database_url_secret_arn" {
  type        = string
  default     = null
  description = "Override CONTROL_PLANE_DATABASE_URL secret ARN when RDS module is disabled."
}

# ---------------------------------------------------------------------------
# Static edge
# ---------------------------------------------------------------------------

variable "static_origin_bucket_name" {
  type        = string
  description = "Globally unique private S3 origin bucket. REPLACE suffix keeps apply gated."
  default     = "lanyard-portal-staging-web-origin-REPLACE"
}

variable "static_force_destroy_origin_bucket" {
  type        = bool
  default     = false
  description = "Allow destroy of non-empty origin bucket."
}

variable "static_price_class" {
  type        = string
  default     = "PriceClass_100"
  description = "CloudFront price class."
}

variable "static_aliases" {
  type        = list(string)
  default     = []
  description = "Optional CloudFront aliases (needs us-east-1 ACM)."
}

variable "static_acm_certificate_arn" {
  type        = string
  default     = null
  description = "us-east-1 ACM ARN for static aliases."
}

variable "static_bff_origin_domain_name" {
  type        = string
  default     = ""
  description = "BFF origin hostname when enable_portal_bff=false but API routing still desired."
}

variable "static_bff_origin_protocol_policy" {
  type        = string
  default     = "https-only"
  description = "CloudFront → BFF origin protocol (https-only, http-only, or match-viewer)."
}

variable "static_web_artifact_url" {
  type        = string
  default     = ""
  description = "Optional static web pin URL (operators sync; module does not download)."
}

variable "static_web_artifact_version" {
  type        = string
  default     = ""
  description = "Optional static web version label."
}

variable "static_web_artifact_sha256" {
  type        = string
  default     = ""
  description = "Optional static web SHA-256."
}

# ---------------------------------------------------------------------------
# Portal DNS/TLS (optional; enable_portal_dns_tls — default off for offline validate)
# ---------------------------------------------------------------------------

variable "enable_portal_dns_tls" {
  type        = bool
  default     = false
  description = "Create portal-dns-tls (ACM + optional zone) and root Route53 aliases. Default false keeps offline validate placeholder-safe."
}

variable "portal_web_hostname" {
  type        = string
  default     = ""
  description = "CloudFront alias hostname (bare FQDN)."

  validation {
    condition     = var.portal_web_hostname == "" || can(regex("^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$", var.portal_web_hostname))
    error_message = "portal_web_hostname must be empty or a lowercase DNS hostname (no scheme)."
  }
}

variable "bff_hostname" {
  type        = string
  default     = ""
  description = "BFF ALB HTTPS hostname (bare FQDN)."

  validation {
    condition     = var.bff_hostname == "" || can(regex("^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$", var.bff_hostname))
    error_message = "bff_hostname must be empty or a lowercase DNS hostname (no scheme)."
  }
}

variable "relay_hostname" {
  type        = string
  default     = ""
  description = "Relay ALB HTTPS/WSS hostname (bare FQDN)."

  validation {
    condition     = var.relay_hostname == "" || can(regex("^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$", var.relay_hostname))
    error_message = "relay_hostname must be empty or a lowercase DNS hostname (no scheme)."
  }
}

variable "dns_create_route53_zone" {
  type        = bool
  default     = false
  description = "Create a public hosted zone (prefer false + dns_route53_zone_id)."
}

variable "dns_route53_zone_id" {
  type        = string
  default     = null
  description = "Existing Route53 hosted zone ID (Z…)."
}

variable "dns_route53_zone_name" {
  type        = string
  default     = ""
  description = "Zone name when creating a zone."
}

variable "dns_create_alias_records" {
  type        = bool
  default     = true
  description = "Create root Route53 aliases when targets exist."
}

variable "dns_existing_cloudfront_certificate_arn" {
  type        = string
  default     = null
  description = "Reuse existing us-east-1 ACM cert for CloudFront (skip create)."
}

variable "dns_existing_regional_certificate_arn" {
  type        = string
  default     = null
  description = "Reuse existing regional ACM cert for BFF/relay ALBs."
}

# ---------------------------------------------------------------------------
# Portal WAF (optional; enable_portal_waf — default off for offline validate)
# ---------------------------------------------------------------------------

variable "enable_portal_waf" {
  type        = bool
  default     = false
  description = "Create portal-waf (CloudFront + regional WebACLs) and attach to public edges when enabled. Default false keeps offline validate placeholder-safe."
}

variable "static_web_acl_id" {
  type        = string
  default     = ""
  description = "Optional CloudFront WAFv2 WebACL ARN when enable_portal_waf=false (pass-through to portal-static-edge)."
}

variable "waf_enable_cloudfront_web_acl" {
  type        = bool
  default     = true
  description = "When enable_portal_waf, create CLOUDFRONT-scope WebACL in us-east-1."
}

variable "waf_enable_regional_web_acl" {
  type        = bool
  default     = true
  description = "When enable_portal_waf, create REGIONAL-scope WebACL for BFF/relay ALBs."
}

variable "waf_enable_common_rule_set" {
  type        = bool
  default     = true
  description = "Attach AWSManagedRulesCommonRuleSet."
}

variable "waf_enable_known_bad_inputs" {
  type        = bool
  default     = true
  description = "Attach AWSManagedRulesKnownBadInputsRuleSet."
}

variable "waf_enable_rate_based_rule" {
  type        = bool
  default     = true
  description = "Attach optional rate-based block rule."
}

variable "waf_rate_limit" {
  type        = number
  default     = 2000
  description = "Rate-based limit (requests per 5 minutes per IP)."
}

variable "waf_managed_rule_override_action" {
  type        = string
  default     = "none"
  description = "Managed rule container override: none (enforce) or count (observe)."

  validation {
    condition     = contains(["none", "count"], var.waf_managed_rule_override_action)
    error_message = "waf_managed_rule_override_action must be none or count."
  }
}

variable "portal_cpu_architecture" {
  type        = string
  description = "Fargate CPU architecture for BFF/relay/control-plane/Document Server (X86_64 or ARM64)."
  default     = "X86_64"

  validation {
    condition     = contains(["X86_64", "ARM64"], var.portal_cpu_architecture)
    error_message = "portal_cpu_architecture must be X86_64 or ARM64."
  }
}

# ---------------------------------------------------------------------------
# Staging Document Server — topology staging-platform-shared-ds (lp-5q6.34)
# ---------------------------------------------------------------------------

variable "enable_staging_document_server" {
  type        = bool
  description = <<-EOT
    Create modules/staging-document-server (staging-platform-shared-ds). Default false keeps
    offline validate cheap and avoids shared-DS residual until operators opt in.
    Staging data only — never production customer vault. Production DS remains blocked.
  EOT
  default     = false
}

variable "acknowledge_staging_shared_residual" {
  type        = bool
  description = "Required true when enable_staging_document_server: accept shared staging DS residual (ADR 0006)."
  default     = false
}

variable "document_server_image_repository" {
  type        = string
  description = "ONLYOFFICE Community image repository (no tag/digest). Free track only."
  default     = "onlyoffice/documentserver"
}

variable "document_server_image_digest" {
  type        = string
  description = "Immutable Document Server image digest (sha256:…). Placeholder for validate; replace before apply."
  default     = null
}

variable "document_server_image_tag_hint" {
  type        = string
  description = "Optional tag label for operator notes (not deploy authority)."
  default     = ""
}

variable "document_server_desired_count" {
  type        = number
  description = "ECS desired count for Document Server. Set 0 to pause Office editing without destroying the stack."
  default     = 1

  validation {
    condition     = var.document_server_desired_count >= 0 && var.document_server_desired_count <= 4
    error_message = "document_server_desired_count must be between 0 and 4."
  }
}

variable "document_server_cpu" {
  type        = number
  description = "Fargate CPU units for Document Server (default 2048)."
  default     = 2048
}

variable "document_server_memory" {
  type        = number
  description = "Fargate memory MiB for Document Server (minimum 4096)."
  default     = 4096

  validation {
    condition     = var.document_server_memory >= 4096
    error_message = "document_server_memory must be at least 4096."
  }
}

variable "document_server_enable_https" {
  type        = bool
  description = "Enable HTTPS on the Docs ALB (requires ACM cert)."
  default     = false
}

variable "document_server_acm_certificate_arn" {
  type        = string
  description = "ACM cert ARN for Docs ALB HTTPS (optional; can use portal-dns-tls regional cert)."
  default     = null
}

variable "document_server_enable_cloudfront_https" {
  type        = bool
  description = <<-EOT
    Create CloudFront HTTPS→HTTP Docs ALB edge (lp-zuh.12.9 Option B). Preferred when
    custom Docs hostname + Route53/ACM is unavailable (e.g. Squarespace DNS).
  EOT
  default     = false
}

variable "document_server_cloudfront_price_class" {
  type        = string
  description = "CloudFront price class for Docs HTTPS edge."
  default     = "PriceClass_100"
}

variable "document_server_cloudfront_aliases" {
  type        = list(string)
  description = "Optional Docs CloudFront aliases (requires document_server_cloudfront_acm_certificate_arn)."
  default     = []
}

variable "document_server_cloudfront_acm_certificate_arn" {
  type        = string
  description = "us-east-1 ACM ARN when Docs CloudFront aliases are set."
  default     = null
}

variable "document_server_public_hostname" {
  type        = string
  description = "Browser-facing Docs hostname (e.g. docs.staging.example.com). Optional Route53 alias when DNS/TLS on."
  default     = ""
}

variable "document_server_create_jwt_secret" {
  type        = bool
  description = "Create SM JWT secret in the Document Server module (default true)."
  default     = true
}

variable "document_server_jwt_secret_name" {
  type        = string
  description = "Optional SM secret name override for Office JWT."
  default     = null
}

variable "document_server_jwt_secret_arn" {
  type        = string
  description = "Existing SM JWT ARN when document_server_create_jwt_secret=false."
  default     = null
}

variable "document_server_create_license_secret_shell" {
  type        = bool
  description = "Create empty SM shell for optional future license material (free track leaves false)."
  default     = false
}

variable "document_server_existing_license_secret_arn" {
  type        = string
  description = "Existing license SM ARN if any (free track: null)."
  default     = null
}

variable "document_server_allow_private_ip" {
  type        = bool
  description = "ONLYOFFICE ALLOW_PRIVATE_IP_ADDRESS when DS must fetch private BFF URLs."
  default     = false
}

variable "inject_office_jwt_into_bff" {
  type        = bool
  description = "When staging DS is on, inject BFF_OFFICE_JWT_SECRET from DS JWT SM ARN into BFF secrets map."
  default     = true
}

variable "inject_office_env_into_bff" {
  type        = bool
  description = "When staging DS is on, inject BFF_OFFICE_PUBLIC_BASE_URL and BFF_OFFICE_DOCUMENT_SERVER_HOSTS into BFF env."
  default     = true
}

variable "bff_office_public_base_url" {
  type        = string
  description = <<-EOT
    Absolute http(s) base URL that Document Server uses to reach BFF Office download/callback
    (BFF_OFFICE_PUBLIC_BASE_URL). Required when enable_staging_document_server and
    inject_office_env_into_bff unless bff_hostname is set (then https://bff_hostname is used).
    Never put secrets here.
  EOT
  default     = ""
}
