variable "relay_wss_url" {
  description = <<-EOT
    Lanyard relay base URL from control-plane register/provision (global pool or Tier 3 dedicated).
    Require secure schemes only: https:// or wss:// (http:// and ws:// are rejected).
    Hermes normalizes https:// → wss://…/relay for the dial when needed.
    Maps to GATEWAY_RELAY_URL (env) and gateway.relay_url (config.yaml).
  EOT
  type        = string

  validation {
    condition     = can(regex("^https://", var.relay_wss_url)) || can(regex("^wss://", var.relay_wss_url))
    error_message = "relay_wss_url must start with https:// or wss:// (http:// and ws:// are rejected)."
  }
}

variable "relay_instance_id" {
  description = <<-EOT
    Gateway instance id from control plane POST /tenants/:id/instances/register (provision is a compat alias).
    Maps to GATEWAY_RELAY_ID, GATEWAY_RELAY_INSTANCE_ID, and gateway.relay_id / gateway.relay_instance_id.
  EOT
  type        = string

  validation {
    condition     = length(trimspace(var.relay_instance_id)) > 0
    error_message = "relay_instance_id must be non-empty."
  }
}

variable "deployment_mode" {
  description = <<-EOT
    production (default): requires relay_secret_source of ssm or secretsmanager; rejects inline
    secrets and secret-bearing local_file writes so values never enter tfvars/state/working tree.
    lab: allows relay_secret_source=inline and optional local_file with the secret (never for real tenants).
  EOT
  type        = string
  default     = "production"

  validation {
    condition     = contains(["production", "lab"], var.deployment_mode)
    error_message = "deployment_mode must be production or lab."
  }
}

variable "relay_secret_source" {
  description = <<-EOT
    Where the per-instance relay secret lives:
      ssm             — SSM Parameter Store SecureString (production default)
      secretsmanager  — AWS Secrets Manager
      inline          — plain Terraform variable (lab only; lands in state/tfvars)
    Production path never requires relay_instance_secret as a Terraform input.
  EOT
  type        = string
  default     = "ssm"

  validation {
    condition     = contains(["ssm", "secretsmanager", "inline"], var.relay_secret_source)
    error_message = "relay_secret_source must be ssm, secretsmanager, or inline."
  }
}

variable "relay_instance_secret" {
  description = <<-EOT
    Per-instance secret from control plane register/rotate (field: secret, show-once). Lab only when
    relay_secret_source=inline (lab). For production, store the secret outside Terraform
    (SSM SecureString or Secrets Manager) and pass the parameter name / secret ARN only.
    Never commit live values to git.
  EOT
  type        = string
  default     = ""
  sensitive   = true
}

variable "relay_secret_ssm_parameter_name" {
  description = <<-EOT
    SSM parameter name for the relay instance secret (SecureString), e.g.
    /company-brain/<tenant_slug>/gateway-relay-secret. Required when relay_secret_source=ssm.
    Create and rotate with AWS CLI / Console — do not pass the secret value through Terraform.
  EOT
  type        = string
  default     = ""
}

variable "relay_secret_ssm_parameter_arn" {
  description = <<-EOT
    Optional full SSM parameter ARN for tight IAM scoping. When empty, the IAM policy
    document uses a name-based ARN pattern (account wildcard). Prefer setting the full ARN
    when known.
  EOT
  type        = string
  default     = ""
}

variable "relay_secret_secretsmanager_secret_arn" {
  description = <<-EOT
    Secrets Manager secret ARN for the relay instance secret.
    Required when relay_secret_source=secretsmanager.
  EOT
  type        = string
  default     = ""
}

variable "tenant_slug" {
  description = "Portal tenant slug (path entry: https://app.withlanyard.com/<tenant_slug>). Documentation only in this module."
  type        = string
  default     = ""
}

variable "relay_platform" {
  description = "Hermes relay platform id for Lanyard Web Portal. Aligns with WebPlatformAdapter capability descriptor."
  type        = string
  default     = "lanyard_web"
}

variable "hermes_home" {
  description = "Hermes state directory on the customer EC2 (profiles, gateway, .env)."
  type        = string
  default     = "/home/ec2-user/.hermes"
}

variable "hermes_profile_hints" {
  description = <<-EOT
    Optional profile matrix hints for multi-user EC2 documentation / SOW alignment.
    Default roles for portal MVP: admin and contributor.

    NOT ENFORCEMENT: this map is documentation only. Host bootstrap enforces
    admin + contributor profile seeds via scripts/bootstrap-host.sh
    (ensure_hermes_profiles) and scripts/ensure-hermes-profiles.sh.
    See references/hermes-profile-rbac.md for the enforce path.
  EOT
  type = map(object({
    description = optional(string, "")
    workdir     = optional(string, "")
  }))
  default = {
    admin = {
      description = "Full vault and ops capabilities for tenant administrators"
      workdir     = ""
    }
    contributor = {
      description = "Day-to-day authoring within allowed path prefixes"
      workdir     = ""
    }
  }
}

variable "write_hermes_env_file" {
  description = <<-EOT
    When true, render a relay env fragment under hermes_env_output_path / hermes_home.
    Default false. In production mode the fragment never contains secret material — only
    non-secret GATEWAY_RELAY_* fields plus an SSM/Secrets Manager reference.
    Secret-bearing local_file is allowed only in lab mode with relay_secret_source=inline.
  EOT
  type        = bool
  default     = false
}

variable "hermes_env_output_path" {
  description = "Destination for rendered relay env fragment when write_hermes_env_file is true."
  type        = string
  default     = ""
}
