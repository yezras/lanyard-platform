output "role_arn" {
  description = "SANDBOX_VAULT_MOUNT_ROLE_ARN for Control Plane."
  value       = module.sandbox_vault_mount_iam.role_arn
}

output "role_name" {
  description = "Base mount role name."
  value       = module.sandbox_vault_mount_iam.role_name
}

output "vault_bucket_name" {
  description = "Vault bucket bound in base identity."
  value       = module.sandbox_vault_mount_iam.vault_bucket_name
}

output "orchestrator_principal_arns" {
  description = "Trust principals (CP task role)."
  value       = module.sandbox_vault_mount_iam.orchestrator_principal_arns
}

output "orchestrator_roles_with_assume_policy" {
  description = "Roles that received sts:AssumeRole grant."
  value       = module.sandbox_vault_mount_iam.orchestrator_roles_with_assume_policy
}

output "external_id_configured" {
  description = "Whether ExternalId is set on trust (value never exported)."
  value       = module.sandbox_vault_mount_iam.external_id_configured
}

output "cp_env_contract" {
  description = "Non-secret CP env contract for wake mint."
  value       = module.sandbox_vault_mount_iam.cp_env_contract
}

output "contract_summary" {
  description = "Machine-readable lp-zuh.9.1 contract."
  value       = module.sandbox_vault_mount_iam.contract_summary
}
