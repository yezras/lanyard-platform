# ---------------------------------------------------------------------------
# Tenant naming / WSS contract
# ---------------------------------------------------------------------------

variable "tenant_slug" {
  description = "Portal tenant slug (path entry: https://app.withlanyard.com/<tenant_slug>)."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$", var.tenant_slug))
    error_message = "tenant_slug must be a lowercase DNS label."
  }

  validation {
    condition     = !can(regex("(unconfigured|changeme|TODO|FIXME)", lower(var.tenant_slug)))
    error_message = "tenant_slug must not contain placeholder tokens."
  }
}

variable "environment" {
  description = "Deployment environment segment for relay hostname and tags (e.g. staging, prod)."
  type        = string
  default     = "staging"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$", var.environment)) || length(var.environment) == 1
    error_message = "environment must be a short lowercase label."
  }
}

variable "relay_host_suffix" {
  description = "DNS suffix for dedicated relay hosts (default production-style suffix)."
  type        = string
  default     = "withlanyard.com"

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$", var.relay_host_suffix))
    error_message = "relay_host_suffix must be a lowercase DNS hostname suffix."
  }
}

variable "relay_hostname_override" {
  description = "Optional explicit relay hostname when SOW requires non-standard naming. Bare FQDN only (no scheme)."
  type        = string
  default     = ""

  validation {
    condition = (
      var.relay_hostname_override == "" ||
      can(regex("^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$", var.relay_hostname_override))
    )
    error_message = "relay_hostname_override must be empty or a lowercase DNS hostname."
  }

  validation {
    condition = (
      var.relay_hostname_override == "" ||
      !can(regex("(?i)^(https?://|wss?://)", var.relay_hostname_override))
    )
    error_message = "relay_hostname_override must be a bare hostname (no https://, http://, wss://, or ws://)."
  }
}

variable "name_prefix" {
  description = <<-EOT
    Short lowercase prefix for ALB/ECS resource names.
    Defaults to tier3-<tenant_slug> truncated to fit portal-relay-service constraints when empty.
  EOT
  type        = string
  default     = ""

  validation {
    condition = (
      var.name_prefix == "" ||
      can(regex("^[a-z][a-z0-9-]{1,38}[a-z0-9]$", var.name_prefix))
    )
    error_message = "name_prefix must be empty or 3–40 chars, lowercase alphanumeric and hyphens."
  }

  validation {
    condition = (
      var.name_prefix == "" ||
      !can(regex("(unconfigured|changeme|TODO|FIXME)", lower(var.name_prefix)))
    )
    error_message = "name_prefix must not contain placeholder tokens."
  }
}

variable "tags" {
  description = "Additional tags applied to dedicated relay resources."
  type        = map(string)
  default     = {}
}

# ---------------------------------------------------------------------------
# Network — public ALB edge, private Fargate tasks
# ---------------------------------------------------------------------------

variable "vpc_id" {
  description = "VPC ID. Use real IDs only in private operator tfvars."
  type        = string

  validation {
    condition     = can(regex("^vpc-[0-9a-f]{8,}$", var.vpc_id))
    error_message = "vpc_id must look like vpc-… (lowercase hex)."
  }

  validation {
    condition     = !can(regex("(unconfigured|changeme|TODO|FIXME|example)", lower(var.vpc_id)))
    error_message = "vpc_id must not contain placeholder tokens."
  }
}

variable "public_subnet_ids" {
  description = "Public subnet IDs for the internet-facing dedicated relay ALB (minimum 2)."
  type        = list(string)

  validation {
    condition     = length(var.public_subnet_ids) >= 2
    error_message = "public_subnet_ids must include at least two subnets."
  }

  validation {
    condition = alltrue([
      for id in var.public_subnet_ids : can(regex("^subnet-[0-9a-f]{8,}$", id))
    ])
    error_message = "each public_subnet_ids entry must look like subnet-… ."
  }
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for Fargate tasks (minimum 2). Prefer assign_public_ip=false with NAT."
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_ids) >= 2
    error_message = "private_subnet_ids must include at least two subnets."
  }

  validation {
    condition = alltrue([
      for id in var.private_subnet_ids : can(regex("^subnet-[0-9a-f]{8,}$", id))
    ])
    error_message = "each private_subnet_ids entry must look like subnet-… ."
  }
}

variable "assign_public_ip" {
  description = "Assign public IP to tasks. Prefer false with NAT (private tasks)."
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# Image digest pin (portal.images.relay)
# ---------------------------------------------------------------------------

variable "image_repository" {
  description = "ECR repository URL without tag/digest (portal.images.relay.repository)."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-zA-Z._/-]+$", var.image_repository)) || can(regex("\\.dkr\\.ecr\\.", var.image_repository))
    error_message = "image_repository must look like an ECR repository URL/name."
  }

  validation {
    condition     = !can(regex("(?i)(@sha256:|:latest$)", var.image_repository))
    error_message = "image_repository must not include @digest or :latest; pass digest separately."
  }
}

variable "image_digest" {
  description = "Immutable image digest pin (sha256: + 64 hex)."
  type        = string

  validation {
    condition     = can(regex("^sha256:[a-f0-9]{64}$", var.image_digest))
    error_message = "image_digest must be sha256: followed by 64 lowercase hex characters."
  }
}

variable "image_tag_hint" {
  description = "Optional immutable tag label for operator notes only."
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# Service / health / scale
# ---------------------------------------------------------------------------

variable "container_port" {
  description = "Container listen port for the dedicated relay (WSS + /health)."
  type        = number
  default     = 8080

  validation {
    condition     = var.container_port >= 1 && var.container_port <= 65535
    error_message = "container_port must be a valid TCP port."
  }
}

variable "health_check_path" {
  description = "ALB target group health check path (product exposes /health)."
  type        = string
  default     = "/health"

  validation {
    condition     = can(regex("^/", var.health_check_path))
    error_message = "health_check_path must start with /."
  }
}

variable "desired_count" {
  description = "ECS desired count. Must remain 1 until G6 relay bus (unless acknowledge_g6_scale_beyond_one)."
  type        = number
  default     = 1

  validation {
    condition     = var.desired_count >= 0 && var.desired_count <= 10
    error_message = "desired_count must be between 0 and 10."
  }
}

variable "acknowledge_g6_scale_beyond_one" {
  description = "Must be true to set desired_count > 1. G6 shared routing/revocation is still a product gate."
  type        = bool
  default     = false
}

variable "cpu" {
  description = "Fargate task CPU units."
  type        = number
  default     = 256
}

variable "memory" {
  description = "Fargate task memory (MiB)."
  type        = number
  default     = 512
}

variable "create_ecs_cluster" {
  description = "When true, create a dedicated ECS cluster. When false, use existing_ecs_cluster_name."
  type        = bool
  default     = true
}

variable "existing_ecs_cluster_name" {
  description = "Existing ECS cluster name when create_ecs_cluster=false."
  type        = string
  default     = null
}

variable "enable_https" {
  description = "When true and acm_certificate_arn set, create HTTPS listener (443) for WSS."
  type        = bool
  default     = false
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for HTTPS listener (same region as ALB). Prefer modules/portal-dns-tls regional cert covering relay hostname."
  type        = string
  default     = null
}

variable "listener_port_http" {
  description = "HTTP listener port."
  type        = number
  default     = 80
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for dedicated relay task logs."
  type        = number
  default     = 30
}

variable "environment_variables" {
  description = <<-EOT
    Non-secret container environment variables only.
    Never put REDIS_URL, RELAY_INTERNAL_TOKEN, session/OIDC secrets here —
    use var.secrets (SM/SSM value_from). Production-like environments reject known
    secret names in this map (enforced by composed portal-relay-service).
    G6 bus flags (plain only): RELAY_CLUSTER_MODE (single|bus), RELAY_ADVERTISE_URL,
    RELAY_NODE_ID. Default single-node mode until product G6 + shared store are proven.
  EOT
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = <<-EOT
    Generic ECS secret injection map (Secrets Manager and/or SSM Parameter Store).
    Keys = container environment variable names (e.g. RELAY_INTERNAL_TOKEN, REDIS_URL).
    value_from = full SM secret ARN (optionally with JSON key suffix) or SSM parameter ARN.
    kms_key_arn = optional CMK ARN when the secret/parameter is encrypted with a customer key.
    Never put secret values here — ARNs/refs only.
  EOT
  type = map(object({
    value_from  = string
    kms_key_arn = optional(string)
  }))
  default = {}

  validation {
    condition = alltrue([
      for k, v in var.secrets :
      can(regex("^arn:aws[a-z-]*:(secretsmanager|ssm):", v.value_from))
    ])
    error_message = "each secrets[*].value_from must be a secretsmanager or ssm ARN."
  }

  validation {
    condition = alltrue([
      for k, v in var.secrets :
      v.kms_key_arn == null || v.kms_key_arn == "" || can(regex("^arn:aws[a-z-]*:kms:", v.kms_key_arn))
    ])
    error_message = "each secrets[*].kms_key_arn must be null/empty or a kms ARN."
  }
}

variable "stickiness_enabled" {
  description = "Enable ALB target stickiness (often useful for WSS until G6 bus)."
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------------
# Optional DNS (per-tenant dedicated hostname → ALB)
# ---------------------------------------------------------------------------

variable "create_dns_record" {
  description = "When true, create a Route53 alias A record for the dedicated relay hostname → ALB."
  type        = bool
  default     = false
}

variable "route53_zone_id" {
  description = "Route53 hosted zone ID for create_dns_record. Required when create_dns_record=true."
  type        = string
  default     = null

  validation {
    condition = (
      var.route53_zone_id == null ||
      var.route53_zone_id == "" ||
      can(regex("^[A-Z0-9]{10,}$", var.route53_zone_id))
    )
    error_message = "route53_zone_id must be null/empty or a Route53 zone id (uppercase alphanumeric)."
  }
}

# ---------------------------------------------------------------------------
# Optional WAF (associate existing WebACL to dedicated relay ALB)
# ---------------------------------------------------------------------------

variable "web_acl_arn" {
  description = <<-EOT
    Optional WAFv2 Web ACL ARN to associate with the dedicated relay ALB.
    Null/empty → no association (operator may attach WAF out-of-band).
    Module does not create WAF rules — only associates a pre-existing Web ACL.
  EOT
  type        = string
  default     = null

  validation {
    condition = (
      var.web_acl_arn == null ||
      var.web_acl_arn == "" ||
      can(regex("^arn:aws[a-z-]*:wafv2:", var.web_acl_arn))
    )
    error_message = "web_acl_arn must be null/empty or a wafv2 ARN."
  }
}

# ---------------------------------------------------------------------------
# Fail-closed honesty gates
# ---------------------------------------------------------------------------

variable "acknowledge_not_auto_applied" {
  description = <<-EOT
    Must be true. Affirms the caller knows this module is real deployable Terraform
    (ALB/ECS/digest pin) but is not auto-applied from git examples, and remains
    infra_ready until operator staging apply + G2/G6 evidence — not production-certified.
  EOT
  type        = bool
  default     = false

  validation {
    condition     = var.acknowledge_not_auto_applied == true
    error_message = "acknowledge_not_auto_applied must be true. modules/tier3-dedicated-relay is infra_ready (real ALB/ECS) but not auto-applied; operators apply from private roots after digest pins exist."
  }
}

variable "claim_production_ready" {
  description = <<-EOT
    MUST remain false. Setting true is always rejected: Tier 3 dedicated relay
    is infra_ready (deployable topology) but not production-certified until
    staging proof + G2 credential lifecycle. See references/readiness-matrix.md.
  EOT
  type        = bool
  default     = false

  validation {
    condition     = var.claim_production_ready == false
    error_message = "claim_production_ready must be false. modules/tier3-dedicated-relay is infra_ready until staging proof — not production-complete. See references/readiness-matrix.md."
  }
}
