# ---------------------------------------------------------------------------
# Naming / tags
# ---------------------------------------------------------------------------

variable "name_prefix" {
  description = "Short lowercase prefix for private control-plane ALB/ECS resources."
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
# Network - PRIVATE ONLY (G1 doctrine: never public ALB)
# ---------------------------------------------------------------------------

variable "vpc_id" {
  description = "VPC ID for the private control-plane ALB and tasks."
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

variable "private_subnet_ids" {
  description = <<-EOT
    Private subnet IDs for BOTH the internal ALB and Fargate tasks (minimum 2).
    Public subnets are rejected at plan time (map_public_ip_on_launch must be false).
  EOT
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_ids) >= 2
    error_message = "private_subnet_ids must include at least two private subnets."
  }

  validation {
    condition = alltrue([
      for id in var.private_subnet_ids : can(regex("^subnet-[0-9a-f]{8,}$", id))
    ])
    error_message = "each private_subnet_ids entry must look like subnet-… ."
  }
}

variable "internal" {
  description = <<-EOT
    MUST remain true. Public/internet-facing ALB for the control plane is rejected (G1).
    There is no supported public posture for this module.
  EOT
  type        = bool
  default     = true

  validation {
    condition     = var.internal == true
    error_message = "internal must be true. modules/portal-control-plane-service rejects public ALBs for the control plane (G1)."
  }
}

variable "allowed_ingress_security_group_ids" {
  description = <<-EOT
    Security groups allowed to reach the private control-plane ALB (typically BFF + relay task SGs).
    At least one SG or CIDR is required.
  EOT
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for id in var.allowed_ingress_security_group_ids :
      can(regex("^sg-[0-9a-f]{8,}$", id))
    ])
    error_message = "each allowed_ingress_security_group_ids entry must look like sg-… ."
  }
}

variable "allowed_ingress_cidr_blocks" {
  description = "Optional private CIDRs allowed to the internal ALB. 0.0.0.0/0 and ::/0 are rejected."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for c in var.allowed_ingress_cidr_blocks :
      c != "0.0.0.0/0" && c != "::/0"
    ])
    error_message = "allowed_ingress_cidr_blocks must not include 0.0.0.0/0 or ::/0 (private access only)."
  }

  validation {
    condition = alltrue([
      for c in var.allowed_ingress_cidr_blocks : can(cidrhost(c, 0))
    ])
    error_message = "each allowed_ingress_cidr_blocks entry must be a valid CIDR."
  }
}

# ---------------------------------------------------------------------------
# Image digest pin
# ---------------------------------------------------------------------------

variable "image_repository" {
  description = "ECR repository URL without tag/digest (portal.images.control-plane.repository)."
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
  description = "Container listen port for the control plane."
  type        = number
  default     = 3100

  validation {
    condition     = var.container_port >= 1 && var.container_port <= 65535
    error_message = "container_port must be a valid TCP port."
  }
}

variable "health_check_path" {
  description = "Internal ALB target group health check path."
  type        = string
  default     = "/health"

  validation {
    condition     = can(regex("^/", var.health_check_path))
    error_message = "health_check_path must start with /."
  }
}

variable "desired_count" {
  description = "ECS desired count. Thin pilot default is 1."
  type        = number
  default     = 1

  validation {
    condition     = var.desired_count >= 0 && var.desired_count <= 10
    error_message = "desired_count must be between 0 and 10."
  }
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

variable "listener_port" {
  description = "Internal ALB listener port (HTTP inside VPC)."
  type        = number
  default     = 80
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention."
  type        = number
  default     = 30
}

variable "environment_variables" {
  description = <<-EOT
    Non-secret container environment variables only (e.g. CONTROL_PLANE_AUTH_MODE,
    GOOGLE_CLIENT_ID). Wire CONTROL_PLANE_DATABASE_URL via database_url_secret_arn
    or secrets map (Secrets Manager / SSM) - never as plain env in production-like
    or staging environments. GOOGLE_CLIENT_SECRET is rejected in plain env for every
    environment label (oidc_client_secret_never_plain_env).
  EOT
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = <<-EOT
    Generic ECS secret injection map (Secrets Manager and/or SSM Parameter Store).
    Keys = container environment variable names (e.g. CONTROL_PLANE_DATABASE_URL,
    GOOGLE_CLIENT_SECRET, CONTROL_PLANE_SERVICE_TOKEN).
    value_from = full SM secret ARN (optionally with JSON key suffix arn:…:secret:name:KEY::)
                 or SSM parameter ARN (arn:aws:ssm:region:account:parameter/name).
    kms_key_arn = optional CMK ARN when the secret/parameter is encrypted with a customer key.
    Task execution role receives GetSecretValue / GetParameters / Decrypt only for declared
    ARNs and KMS keys. Never put secret values here - ARNs/refs only.
    Merges with database_url_secret_arn (legacy); secrets map wins on key conflict.
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

variable "database_url_secret_arn" {
  description = <<-EOT
    Optional legacy Secrets Manager ARN for the control-plane Postgres URL
    (from modules/control-plane-rds output control_plane_database_url_secret_arn).
    Injected as ECS secrets CONTROL_PLANE_DATABASE_URL *and* DATABASE_URL so either
    product env name works (Portal G4.1).
    How the ARN is turned into valueFrom depends on database_url_secret_format:
      - json_keys (default): SM JSON payload (control-plane-rds) → append :KEY:: for each env name
      - plain: SM secret string is the bare postgresql:// URL → use ARN as-is for both env names
    Prefer the generic secrets map for additional secrets; this remains for G4.3 compatibility.
    Merged into effective secrets; secrets["CONTROL_PLANE_DATABASE_URL"] / secrets["DATABASE_URL"]
    win on key conflict if both are set.
  EOT
  type        = string
  default     = null
}

variable "database_url_secret_format" {
  description = <<-EOT
    Shape of the Secrets Manager secret referenced by database_url_secret_arn:
      - "json_keys" (default): secret is JSON with keys CONTROL_PLANE_DATABASE_URL and
        DATABASE_URL (and usually "url") as produced by modules/control-plane-rds.
        ECS valueFrom uses the JSON-key form:
          arn:aws:secretsmanager:region:account:secret:name:CONTROL_PLANE_DATABASE_URL::
          arn:aws:secretsmanager:region:account:secret:name:DATABASE_URL::
        Bare ARN of a JSON secret is wrong — it injects the whole JSON blob and breaks
        Postgres URL parsing (SQLite residual on older images).
      - "plain": secret string is the full postgresql:// URL only (no JSON). valueFrom is
        the bare secret ARN for both CONTROL_PLANE_DATABASE_URL and DATABASE_URL.
  EOT
  type        = string
  default     = "json_keys"

  validation {
    condition     = contains(["json_keys", "plain"], var.database_url_secret_format)
    error_message = "database_url_secret_format must be \"json_keys\" (control-plane-rds) or \"plain\" (string URL secret)."
  }
}

# ---------------------------------------------------------------------------
# Honesty gate
# ---------------------------------------------------------------------------

variable "instance_secret_material_sm_secret_arn" {
  description = <<-EOT
    Optional Secrets Manager ARN for the encrypted instance-secret-material
    envelope (lp-oop.37.6). Same AES-256-GCM blob as INSTANCE_SECRET_MATERIAL_PATH,
    but durable across Fargate task recycle (no EFS).
    When set, the module:
      - injects INSTANCE_SECRET_MATERIAL_SM_SECRET_ID (non-secret ARN)
      - grants the *task* role GetSecretValue + PutSecretValue on this ARN
    INSTANCE_SECRET_MATERIAL_KEY must still come from var.secrets (never plain env).
    Unset INSTANCE_SECRET_MATERIAL_PATH in environment_variables (resolver fails
    if PATH and SM id are both set). Do not put plaintext relay secrets here —
    only the ciphertext envelope. Operators create the secret once (empty `{}`);
    CP PutSecretValue updates versions. Not auto-applied.
  EOT
  type        = string
  default     = null

  validation {
    condition = (
      var.instance_secret_material_sm_secret_arn == null ||
      trimspace(var.instance_secret_material_sm_secret_arn) == "" ||
      can(regex("^arn:aws[a-z-]*:secretsmanager:", var.instance_secret_material_sm_secret_arn))
    )
    error_message = "instance_secret_material_sm_secret_arn must be null/empty or a secretsmanager ARN."
  }
}

variable "instance_secret_material_sm_kms_key_arn" {
  description = <<-EOT
    Optional CMK ARN when the instance-secret-material SM secret uses a customer
    key. Grants task-role kms:Decrypt + kms:GenerateDataKey. Default AWS-managed
    SM key needs no extra grant.
  EOT
  type        = string
  default     = null

  validation {
    condition = (
      var.instance_secret_material_sm_kms_key_arn == null ||
      trimspace(var.instance_secret_material_sm_kms_key_arn) == "" ||
      can(regex("^arn:aws[a-z-]*:kms:", var.instance_secret_material_sm_kms_key_arn))
    )
    error_message = "instance_secret_material_sm_kms_key_arn must be null/empty or a kms ARN."
  }
}

variable "acknowledge_not_auto_applied" {
  description = "Must be true. Module is real Terraform but not auto-applied; G1 staging proof still required for production."
  type        = bool
  default     = false

  validation {
    condition     = var.acknowledge_not_auto_applied == true
    error_message = "acknowledge_not_auto_applied must be true. modules/portal-control-plane-service is not auto-applied; private-only ALB; G1 staging proof still required for production claims."
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
