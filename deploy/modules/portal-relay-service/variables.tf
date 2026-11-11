# ---------------------------------------------------------------------------
# Naming / tags
# ---------------------------------------------------------------------------

variable "name_prefix" {
  description = "Short lowercase prefix for relay ALB/ECS resources. Example: lanyard-portal-staging."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,38}[a-z0-9]$", var.name_prefix))
    error_message = "name_prefix must be 3-40 chars, lowercase alphanumeric and hyphens."
  }

  validation {
    condition     = !can(regex("(unconfigured|changeme|TODO|FIXME)", lower(var.name_prefix)))
    error_message = "name_prefix must not contain placeholder tokens."
  }
}

variable "environment" {
  description = "Logical environment label (tags only)."
  type        = string
  default     = "staging"
}

variable "tags" {
  description = "Additional tags."
  type        = map(string)
  default     = {}
}

# ---------------------------------------------------------------------------
# Network - separate public edge for customer-host outbound WSS
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
  description = "Public subnet IDs for the internet-facing relay ALB (minimum 2)."
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
  description = "Private subnet IDs for Fargate tasks (minimum 2)."
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
  description = "Assign public IP to tasks. Prefer false with NAT."
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# Image digest pin
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
# Service / health
# ---------------------------------------------------------------------------

variable "container_port" {
  description = "Container listen port for the relay (WSS + /health)."
  type        = number
  default     = 8787

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
  description = "When true and acm_certificate_arn set, create HTTPS listener (443)."
  type        = bool
  default     = false
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for HTTPS listener (same region as ALB)."
  type        = string
  default     = null
}

variable "listener_port_http" {
  description = "HTTP listener port."
  type        = number
  default     = 80
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for relay task logs."
  type        = number
  default     = 30
}

variable "environment_variables" {
  description = <<-EOT
    Non-secret container environment variables only.
    Never put REDIS_URL, RELAY_INTERNAL_TOKEN, session/OIDC secrets here -
    use var.secrets (SM/SSM value_from). Production-like environments reject known
    secret names in this map (see main.tf check production_rejects_plaintext_secrets).
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
    value_from = full SM secret ARN (optionally with JSON key suffix arn:…:secret:name:KEY::)
                 or SSM parameter ARN (arn:aws:ssm:region:account:parameter/name).
    kms_key_arn = optional CMK ARN when the secret/parameter is encrypted with a customer key.
    Task execution role receives GetSecretValue / GetParameters / Decrypt only for declared
    ARNs and KMS keys. Never put secret values here - ARNs/refs only.

    Preferred G6 REDIS_URL wiring (owner leases, bus, jti/revocation) via modules/portal-valkey:
      secrets = {
        REDIS_URL = {
          value_from = "$${module.portal_valkey.redis_url_secret_arn}:REDIS_URL::"
        }
      }
    Do not place REDIS_URL in environment_variables (production-like environments reject it).
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
    error_message = "each secrets[*].value_from must be a secretsmanager or ssm ARN (arn:aws…:secretsmanager:… or arn:aws…:ssm:…)."
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
# Honesty gate
# ---------------------------------------------------------------------------

variable "acknowledge_not_auto_applied" {
  description = "Must be true. Module is real Terraform but not auto-applied from examples."
  type        = bool
  default     = false

  validation {
    condition     = var.acknowledge_not_auto_applied == true
    error_message = "acknowledge_not_auto_applied must be true. modules/portal-relay-service is not auto-applied; operators apply from private roots after digest pins exist."
  }
}


variable "cpu_architecture" {
  type        = string
  description = "Fargate task CPU architecture: X86_64 or ARM64. Match the image build platform."
  default     = "X86_64"

  validation {
    condition     = contains(["X86_64", "ARM64"], var.cpu_architecture)
    error_message = "cpu_architecture must be X86_64 or ARM64."
  }
}
