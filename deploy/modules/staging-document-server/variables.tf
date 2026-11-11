# ---------------------------------------------------------------------------
# Naming / tags
# ---------------------------------------------------------------------------

variable "name_prefix" {
  description = "Short lowercase prefix for Document Server ALB/ECS resources. Example: lanyard-platform-staging."
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
  description = "Logical environment label (tags only). Staging topology is staging-platform-shared-ds."
  type        = string
  default     = "staging"
}

variable "tags" {
  description = "Additional tags."
  type        = map(string)
  default     = {}
}

# ---------------------------------------------------------------------------
# Network — public Docs edge (browser → DS); tasks in private subnets
# ---------------------------------------------------------------------------

variable "vpc_id" {
  description = "VPC ID (staging platform VPC)."
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
  description = "Public subnet IDs for the internet-facing Document Server ALB (minimum 2)."
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
  description = "Private subnet IDs for Fargate tasks (minimum 2). Tasks need NAT/endpoints for image pull + DS→BFF HTTPS."
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
# Image digest pin (Community free-track Document Server)
# ---------------------------------------------------------------------------

variable "image_repository" {
  description = <<-EOT
    Image repository without tag/digest. Default is Docker Hub Community free-track
    onlyoffice/documentserver (lp-5q6.7). Pin by digest separately — never :latest alone.
  EOT
  type        = string
  default     = "onlyoffice/documentserver"

  validation {
    condition     = length(var.image_repository) > 0 && !can(regex("(?i)(@sha256:|:latest$)", var.image_repository))
    error_message = "image_repository must not include @digest or :latest; pass digest separately."
  }
}

variable "image_digest" {
  description = "Immutable image digest pin (sha256: + 64 hex). Required — never deploy by mutable tag alone."
  type        = string

  validation {
    condition     = can(regex("^sha256:[a-f0-9]{64}$", var.image_digest))
    error_message = "image_digest must be sha256: followed by 64 lowercase hex characters."
  }
}

variable "image_tag_hint" {
  description = "Optional immutable tag label for operator notes only (not deploy authority)."
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# Service / health
# ---------------------------------------------------------------------------

variable "container_port" {
  description = "Document Server container listen port (official image serves HTTP on 80)."
  type        = number
  default     = 80

  validation {
    condition     = var.container_port >= 1 && var.container_port <= 65535
    error_message = "container_port must be a valid TCP port."
  }
}

variable "health_check_path" {
  description = "ALB and container health path (ONLYOFFICE exposes /healthcheck)."
  type        = string
  default     = "/healthcheck"

  validation {
    condition     = can(regex("^/", var.health_check_path))
    error_message = "health_check_path must start with /."
  }
}

variable "desired_count" {
  description = "ECS desired count. Set 0 to pause Office editing without destroying the stack (rollback)."
  type        = number
  default     = 1

  validation {
    condition     = var.desired_count >= 0 && var.desired_count <= 4
    error_message = "desired_count must be between 0 and 4."
  }
}

variable "cpu" {
  description = "Fargate task CPU units. Document Server needs substantial CPU (default 2048)."
  type        = number
  default     = 2048
}

variable "memory" {
  description = "Fargate task memory MiB. Document Server needs ≥4096 MiB (default 4096)."
  type        = number
  default     = 4096

  validation {
    condition     = var.memory >= 4096
    error_message = "memory must be at least 4096 MiB for ONLYOFFICE Document Server."
  }
}

variable "cpu_architecture" {
  description = "Fargate CPU architecture (X86_64 recommended for Community image)."
  type        = string
  default     = "X86_64"

  validation {
    condition     = contains(["X86_64", "ARM64"], var.cpu_architecture)
    error_message = "cpu_architecture must be X86_64 or ARM64."
  }
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

variable "enable_cloudfront_https" {
  description = <<-EOT
    When true, create a CloudFront distribution with HTTPS viewer → HTTP Docs ALB origin
    (lp-zuh.12.9 Option B). Use when Route53/ACM for a custom Docs hostname is unavailable
    (e.g. Squarespace DNS). Default CloudFront certificate covers *.cloudfront.net.
  EOT
  type        = bool
  default     = false
}

variable "cloudfront_price_class" {
  description = "CloudFront price class for Docs HTTPS edge (when enable_cloudfront_https)."
  type        = string
  default     = "PriceClass_100"

  validation {
    condition = contains([
      "PriceClass_All",
      "PriceClass_200",
      "PriceClass_100",
    ], var.cloudfront_price_class)
    error_message = "cloudfront_price_class must be PriceClass_All, PriceClass_200, or PriceClass_100."
  }
}

variable "cloudfront_aliases" {
  description = "Optional alternate domain names for Docs CloudFront (requires cloudfront_acm_certificate_arn in us-east-1)."
  type        = list(string)
  default     = []
}

variable "cloudfront_acm_certificate_arn" {
  description = "us-east-1 ACM certificate ARN when cloudfront_aliases is non-empty."
  type        = string
  default     = null
}

variable "listener_port_http" {
  description = "HTTP listener port (redirect to HTTPS when enable_https)."
  type        = number
  default     = 80
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for Document Server task logs."
  type        = number
  default     = 14
}

variable "health_check_grace_period_seconds" {
  description = "ECS health check grace for slow Document Server first boot."
  type        = number
  default     = 300
}

# ---------------------------------------------------------------------------
# JWT + optional license material (Secrets Manager only — never git)
# ---------------------------------------------------------------------------

variable "create_jwt_secret" {
  description = "When true, create an SM secret and random JWT value for DS + BFF. When false, use jwt_secret_arn."
  type        = bool
  default     = true
}

variable "jwt_secret_name" {
  description = "Secrets Manager secret name for staging Document Server JWT (when create_jwt_secret)."
  type        = string
  default     = null
}

variable "jwt_secret_arn" {
  description = "Existing SM secret ARN for JWT when create_jwt_secret=false. SecretString must be the raw JWT secret string."
  type        = string
  default     = null
}

variable "jwt_header" {
  description = "ONLYOFFICE JWT header name (JWT_HEADER env)."
  type        = string
  default     = "Authorization"
}

variable "jwt_in_body" {
  description = "ONLYOFFICE JWT_IN_BODY (true recommended)."
  type        = bool
  default     = true
}

variable "create_license_secret_shell" {
  description = <<-EOT
    When true, create an empty Secrets Manager secret shell for optional paid-license
    material (name only). Free-track Community (lp-5q6.7) does not require a license
    file — leave false unless operators will store license JSON in SM for a future path.
    Never commit license file contents.
  EOT
  type        = bool
  default     = false
}

variable "license_secret_name" {
  description = "SM secret name for optional license material shell."
  type        = string
  default     = null
}

variable "existing_license_secret_arn" {
  description = "Existing SM secret ARN for license material (optional; free track leaves null)."
  type        = string
  default     = null
}

# ---------------------------------------------------------------------------
# Document Server env (non-secret)
# ---------------------------------------------------------------------------

variable "allow_private_ip_address" {
  description = "ONLYOFFICE ALLOW_PRIVATE_IP_ADDRESS — set true if DS must fetch BFF URLs on private RFC1918 addresses."
  type        = bool
  default     = false
}

variable "allow_meta_ip_address" {
  description = "ONLYOFFICE ALLOW_META_IP_ADDRESS — keep false in staging unless required for a documented path."
  type        = bool
  default     = false
}

variable "environment_variables" {
  description = "Additional non-secret container environment variables. Never put JWT or license material here."
  type        = map(string)
  default     = {}
}

# ---------------------------------------------------------------------------
# Honesty gate
# ---------------------------------------------------------------------------

variable "acknowledge_not_auto_applied" {
  description = "Must be true before planning. This module is never auto-applied from git examples."
  type        = bool
  default     = false
}

variable "acknowledge_staging_shared_residual" {
  description = <<-EOT
    Must be true. Confirms operators accept staging-platform-shared-ds residual risk
    (shared multi-tenant DS disk for staging data only; not production residency model).
    See ADR 0006 / docs/architecture/portal-document-server-topology.md.
  EOT
  type        = bool
  default     = false
}
