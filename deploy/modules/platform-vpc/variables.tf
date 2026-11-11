# ---------------------------------------------------------------------------
# Naming / tags (placeholder-safe; no account IDs or secrets)
# ---------------------------------------------------------------------------

variable "name_prefix" {
  description = <<-EOT
    Short lowercase prefix for VPC, subnet, NAT, and endpoint names.
    Must not contain account IDs or secrets. Example: lanyard-platform-staging.
  EOT
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,38}[a-z0-9]$", var.name_prefix))
    error_message = "name_prefix must be 3–40 chars, lowercase alphanumeric and hyphens, start with a letter, end alphanumeric."
  }

  validation {
    condition     = !can(regex("(unconfigured|changeme|TODO|FIXME)", lower(var.name_prefix)))
    error_message = "name_prefix must not contain placeholder tokens (UNCONFIGURED, changeme, TODO, FIXME)."
  }
}

variable "environment" {
  description = "Logical environment label (e.g. staging, prod). Used in tags only."
  type        = string
  default     = "staging"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$", var.environment)) || length(var.environment) == 1
    error_message = "environment must be a short lowercase label."
  }
}

variable "tags" {
  description = "Additional tags applied to all supported resources."
  type        = map(string)
  default     = {}
}

# ---------------------------------------------------------------------------
# Topology — two-AZ (minimum) public + private
# ---------------------------------------------------------------------------

variable "vpc_cidr" {
  description = <<-EOT
    VPC IPv4 CIDR. Use lab/private ranges only in committed examples (e.g. 10.0.0.0/16).
    Do not invent production account-specific live CIDRs as claimed-real values in git.
  EOT
  type        = string

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "vpc_cidr must be a valid IPv4 CIDR block."
  }
}

variable "availability_zones" {
  description = <<-EOT
    Availability zone names for subnet placement (minimum 2).
    Length must equal public_subnet_cidrs and private_subnet_cidrs.
    Example shapes only in committed files: ["us-east-1a", "us-east-1b"].
  EOT
  type        = list(string)

  validation {
    condition     = length(var.availability_zones) >= 2
    error_message = "availability_zones must include at least two AZs for multi-AZ Portal compute."
  }
}

variable "public_subnet_cidrs" {
  description = <<-EOT
    Public subnet CIDRs (minimum 2) for internet-facing BFF/relay ALBs.
    map_public_ip_on_launch is true on these subnets only.
  EOT
  type        = list(string)

  validation {
    condition     = length(var.public_subnet_cidrs) >= 2
    error_message = "public_subnet_cidrs must include at least two CIDRs (two-AZ public edge)."
  }

  validation {
    condition = alltrue([
      for c in var.public_subnet_cidrs : can(cidrhost(c, 0))
    ])
    error_message = "each public_subnet_cidrs entry must be a valid IPv4 CIDR."
  }
}

variable "private_subnet_cidrs" {
  description = <<-EOT
    Private subnet CIDRs (minimum 2) for Fargate tasks, internal control-plane ALB, and RDS.
    map_public_ip_on_launch is forced false — do not attach CP/RDS to public subnets.
  EOT
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_cidrs) >= 2
    error_message = "private_subnet_cidrs must include at least two CIDRs (two-AZ private compute/data)."
  }

  validation {
    condition = alltrue([
      for c in var.private_subnet_cidrs : can(cidrhost(c, 0))
    ])
    error_message = "each private_subnet_cidrs entry must be a valid IPv4 CIDR."
  }
}

variable "private_map_public_ip_on_launch" {
  description = <<-EOT
    MUST remain false. Private subnets for Fargate/CP/RDS reject public IP assignment on launch.
    There is no supported public posture for private-tier subnets in this module.
  EOT
  type        = bool
  default     = false

  validation {
    condition     = var.private_map_public_ip_on_launch == false
    error_message = "private_map_public_ip_on_launch must be false. Private subnets reject map_public_ip_on_launch=true (CP/RDS/Fargate private tier)."
  }
}

# ---------------------------------------------------------------------------
# Private egress — NAT and/or VPC endpoints
# ---------------------------------------------------------------------------

variable "enable_nat_gateway" {
  description = <<-EOT
    Create NAT gateway(s) so private subnets can reach the internet (package mirrors, non-AWS APIs).
    When false, interface + gateway VPC endpoints must cover ECR, CloudWatch Logs, Secrets Manager,
    SSM, and S3 (see enable_*_endpoint variables). Plan-time check requires NAT and/or full endpoint set.
  EOT
  type        = bool
  default     = true
}

variable "single_nat_gateway" {
  description = "When enable_nat_gateway=true, use one NAT in the first public subnet (cost-friendly staging) instead of one per AZ."
  type        = bool
  default     = true
}

variable "enable_s3_gateway_endpoint" {
  description = "Create S3 gateway endpoint attached to private route tables (ECR image layers + artifact S3 without NAT)."
  type        = bool
  default     = true
}

variable "enable_ecr_endpoints" {
  description = "Create ECR API + ECR DKR interface endpoints in private subnets (Fargate image pull without NAT)."
  type        = bool
  default     = true
}

variable "enable_logs_endpoint" {
  description = "Create CloudWatch Logs interface endpoint (com.amazonaws.<region>.logs)."
  type        = bool
  default     = true
}

variable "enable_secretsmanager_endpoint" {
  description = "Create Secrets Manager interface endpoint (CONTROL_PLANE_DATABASE_URL / runtime secrets)."
  type        = bool
  default     = true
}

variable "enable_ssm_endpoints" {
  description = "Create SSM + ssmmessages + ec2messages interface endpoints (Session Manager / parameter access)."
  type        = bool
  default     = true
}

variable "vpc_endpoint_allowed_cidr_blocks" {
  description = <<-EOT
    CIDRs allowed to reach interface VPC endpoints on TCP 443.
    Defaults to the VPC CIDR when empty. Must not include 0.0.0.0/0 or ::/0.
  EOT
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for c in var.vpc_endpoint_allowed_cidr_blocks :
      c != "0.0.0.0/0" && c != "::/0"
    ])
    error_message = "vpc_endpoint_allowed_cidr_blocks must not include 0.0.0.0/0 or ::/0."
  }
}

# ---------------------------------------------------------------------------
# Honesty gate — module is infra_ready, not auto-applied
# ---------------------------------------------------------------------------

variable "acknowledge_not_auto_applied" {
  description = <<-EOT
    Required honesty gate. Must be true before plan/apply.
    This module is infra_ready only — operators own private roots; examples are not live apply.
  EOT
  type        = bool
  default     = false

  validation {
    condition     = var.acknowledge_not_auto_applied == true
    error_message = "acknowledge_not_auto_applied must be true. modules/platform-vpc is infra_ready, not auto-applied from git examples."
  }
}
