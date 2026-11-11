output "role_name" {
  description = "Shared base sandbox vault mount role name."
  value       = try(aws_iam_role.mount[0].name, null)
}

output "role_arn" {
  description = "Shared base sandbox vault mount role ARN (SANDBOX_VAULT_MOUNT_ROLE_ARN for CP)."
  value       = try(aws_iam_role.mount[0].arn, null)
}

output "role_unique_id" {
  description = "IAM role unique id (for audit)."
  value       = try(aws_iam_role.mount[0].unique_id, null)
}

output "vault_bucket_name" {
  description = "Vault bucket the base identity is bound to."
  value       = var.vault_bucket_name
}

output "vault_bucket_arn" {
  description = "Vault bucket ARN."
  value       = local.vault_bucket_arn
}

output "orchestrator_principal_arns" {
  description = "Principals allowed to AssumeRole the base mount role."
  value       = var.orchestrator_principal_arns
}

output "external_id_configured" {
  description = "True when an ExternalId condition is present on trust (value never exported)."
  value       = local.external_id_set
}

output "max_session_duration" {
  description = "Role max session duration (seconds)."
  value       = var.max_session_duration
}

output "base_identity_policy_json" {
  description = "Upper-bound identity policy JSON attached to the base role."
  value       = data.aws_iam_policy_document.base_identity.json
}

output "orchestrator_assume_policy_json" {
  description = "Policy JSON granting sts:AssumeRole on the base mount role (for CP task role)."
  value       = try(data.aws_iam_policy_document.orchestrator_assume[0].json, null)
}

output "trust_policy_json" {
  description = "Trust policy JSON (orchestrator AssumeRole only)."
  value       = try(data.aws_iam_policy_document.trust[0].json, null)
}

output "session_policy_template" {
  description = "Per-tenant STS session policy template (placeholders LANYARD_VAULT_BUCKET and TENANT_ID)."
  value       = file("${path.module}/templates/session-policy.json")
}

output "session_policy_template_path" {
  description = "Module-relative path of the session policy template file."
  value       = "${path.module}/templates/session-policy.json"
}

output "cp_env_contract" {
  description = "Non-secret CP env names for wake mint (lp-zuh.9.2 / lp-kng.6.4)."
  value = {
    SANDBOX_VAULT_MOUNT_ROLE_ARN         = try(aws_iam_role.mount[0].arn, null)
    SANDBOX_VAULT_MOUNT_EXTERNAL_ID_set  = local.external_id_set
    SANDBOX_VAULT_MOUNT_DURATION_SECONDS = "900-3600 (product default 3600)"
    LANYARD_VAULT_BUCKET                 = var.vault_bucket_name
    guest_env_secret_keys                = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"]
    guest_env_non_secret_keys            = ["AWS_REGION", "AWS_DEFAULT_REGION", "LANYARD_VAULT_BUCKET", "S3_VAULT_PREFIX", "VAULT_ROOT"]
    no_long_lived_access_keys            = true
  }
}

output "orchestrator_roles_with_assume_policy" {
  description = "Orchestrator role names that received the inline AssumeRole grant."
  value       = local.attach_assume ? local.orchestrator_role_names : []
}

output "contract_summary" {
  description = "Machine-readable IAM contract for lp-zuh.9.1."
  value = {
    bead                         = "lp-zuh.9.1"
    plan                         = "0008-daytona-agent-sandboxes"
    role_name                    = try(aws_iam_role.mount[0].name, null)
    role_arn                     = try(aws_iam_role.mount[0].arn, null)
    vault_bucket                 = var.vault_bucket_name
    prefix_layout                = "tenants/{tenant_id}/vault/"
    base_identity_upper_bound    = "tenants/*/vault/*"
    session_policy_enforces      = "single tenant prefix ListBucket conditioned + object R/W"
    trust                        = "orchestrator_principal_arns only (CP task role)"
    orchestrator_has_assume_role = local.attach_assume
    no_long_lived_keys           = true
    no_secrets_in_git            = true
    delivery                     = "STS AssumeRole + session policy at wake (path A)"
    gated_not_provided = [
      "guest_mount_s3_entrypoint_lp-zuh.6",
      "live_cold_ensure_online_proof_lp-zuh.9.4",
    ]
    cp_sts_mint_and_inject = "lp-zuh.9.2 (portal/packages/control-plane/src/sandbox-vault-mount-sts.ts)"
  }
}
