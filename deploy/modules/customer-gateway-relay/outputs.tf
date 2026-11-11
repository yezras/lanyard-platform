output "hermes_env_vars" {
  description = <<-EOT
    Relay environment variables for Hermes gateway systemd/Docker.
    Production (ssm/secretsmanager): non-secret GATEWAY_RELAY_* plus a reference key
    (GATEWAY_RELAY_SECRET_SSM_PARAMETER or GATEWAY_RELAY_SECRET_SECRETS_MANAGER_ARN).
    Hermes requires GATEWAY_RELAY_SECRET at runtime — fetch on the host via instance role
    (see host_secret_fetch_command / relay_secret_iam_policy_json).
    Lab+inline only: includes GATEWAY_RELAY_SECRET (sensitive).
  EOT
  value       = local.hermes_env
  sensitive   = true # true when inline; always mark sensitive to avoid accidental plan leaks of lab secrets
}

output "hermes_env_vars_public" {
  description = "Non-secret GATEWAY_RELAY_* fields safe for logs, CI, and operator notes."
  value       = local.hermes_env_public
  sensitive   = false
}

output "hermes_gateway_yaml_snippet" {
  description = "Equivalent gateway.* keys for config.yaml. Production omits relay_secret (load via env from host fetch)."
  value       = local.hermes_gateway_yaml
  sensitive   = true
}

output "relay_dial_target" {
  description = "Normalized WebSocket dial target (Hermes appends /relay if missing)."
  value       = "${local.relay_base_url}/relay"
}

output "hermes_profile_hints" {
  description = "Documentation-only Hermes profile names for SOW/portal alignment (default admin/contributor). Not enforcement — host bootstrap writes profile seeds."
  value       = var.hermes_profile_hints
}

output "provision_field_mapping" {
  description = "Control plane register/provision response → Hermes configuration mapping (lifecycle: register/rotate/revoke)."
  value = {
    control_plane_instance_id = "relay_instance_id → GATEWAY_RELAY_ID + GATEWAY_RELAY_INSTANCE_ID"
    control_plane_secret      = "secret (show-once at register/rotate) → SSM SecureString / Secrets Manager (production) or relay_instance_secret (lab inline only) → GATEWAY_RELAY_SECRET on host"
    control_plane_relay_host  = "relay_wss_url → GATEWAY_RELAY_URL / gateway.relay_url"
    register_path             = "POST /tenants/:id/instances/register (provision is compat alias)"
    rotate_path               = "POST /tenants/:id/instances/:instanceId/rotate → overwrite same SSM/SM name; host re-fetch"
    revoke_behavior           = "POST .../instances/:id/revoke or deprovision → relay WS close 4401"
    production_secret_path    = "relay_secret_source=ssm|secretsmanager; never put secret in tfvars/state"
  }
}

output "relay_secret_source" {
  description = "Active secret source mode (ssm | secretsmanager | inline)."
  value       = local.secret_source
}

output "deployment_mode" {
  description = "production or lab."
  value       = var.deployment_mode
}

output "relay_secret_ref" {
  description = "Non-secret reference for where the host should load GATEWAY_RELAY_SECRET."
  value = local.is_ssm ? {
    type           = "ssm"
    parameter_name = local.ssm_parameter_name
    parameter_arn  = local.ssm_parameter_arn
    } : local.is_sm ? {
    type       = "secretsmanager"
    secret_arn = local.sm_secret_arn
    } : {
    type = "inline"
    note = "lab only — secret is a Terraform input and will appear in state"
  }
}

output "relay_secret_iam_policy_json" {
  description = <<-EOT
    IAM policy JSON to attach to the Hermes EC2 instance role so the host can retrieve
    the relay secret (ssm:GetParameter or secretsmanager:GetSecretValue). Empty statement
    list when source is inline. Prefer attaching only the single parameter/secret ARN.
  EOT
  value       = jsonencode(local.relay_secret_iam_policy)
}

output "host_secret_fetch_command" {
  description = "Operator/host one-liner to fetch the secret with instance credentials (write into ~/.hermes/.env only on the host)."
  value       = local.host_secret_fetch_command
}

output "host_env_merge_hint" {
  description = "How to merge non-secret env + host-fetched secret into Hermes .env without putting secrets in Terraform."
  value       = <<-EOT
    # On the Hermes host (instance role must allow GetParameter / GetSecretValue):
    # 1) Non-secret fields (safe to copy from terraform output hermes_env_vars_public):
    #    GATEWAY_RELAY_URL, GATEWAY_RELAY_ID, GATEWAY_RELAY_INSTANCE_ID, GATEWAY_RELAY_PLATFORMS
    # 2) Secret (host-only; never log):
    #    GATEWAY_RELAY_SECRET=$(${local.host_secret_fetch_command})
    # 3) Append to ~/.hermes/.env (mode 600) and restart hermes-gateway.
    # See references/runbooks/relay-secret-lifecycle.md
  EOT
}

output "hermes_relay_env_file_path" {
  description = "Path of local_file fragment when write_hermes_env_file is true; null otherwise."
  value       = try(local_file.hermes_relay_env[0].filename, null)
}
