output "tenant_slug" {
  value = var.tenant_slug
}

output "portal_url" {
  value = "https://app.withlanyard.com/${var.tenant_slug}"
}

output "hosting_track" {
  value = var.hosting_track
}

output "isolation_mode" {
  description = "Resolved isolation boundary mode (account | vpc_interim | customer_account)."
  value       = local.isolation_mode
}

output "production_intent" {
  description = "Whether isolation fail-closed checks for production onboarding are enabled."
  value       = var.production_intent
}

output "log_group_prefix" {
  description = "Per-tenant log partition prefix (operator/contract; module consumers may wire later)."
  value       = local.log_group_prefix
}

output "isolation_summary" {
  description = "Non-secret isolation contract for operators (see references/tenant-isolation-decision.md)."
  value = {
    hosting_track               = var.hosting_track
    isolation_mode              = local.isolation_mode
    production_intent           = var.production_intent
    project_name                = local.project_name
    log_group_prefix            = local.log_group_prefix
    aws_account_id_set          = var.aws_account_id != null
    dedicated_kms_key_set       = var.dedicated_kms_key_arn != null
    deploy_role_set             = local.use_deploy_role
    external_id_set             = local.deploy_role_external_id_configured
    artifact_cross_account_mode = var.artifact_cross_account_mode
  }
}

output "deploy_role_arn" {
  description = "Configured provider assume-role ARN (null when operator uses SSO/profile without assume)."
  value       = local.use_deploy_role ? var.deploy_role_arn : null
}

output "deploy_role_external_id_parameter_name" {
  description = "Lanyard secret/SSM *name* for Track B ExternalId (value never output)."
  value       = var.deploy_role_external_id_parameter_name
}

output "access_wiring_summary" {
  description = <<-EOT
    Non-secret Track A/B onboarding wiring for operators. Maps account-factory and
    customer-account-access outputs into this tenant root. Secrets (ExternalId values,
    session keys) are never included.
  EOT
  value = {
    hosting_track                       = var.hosting_track
    isolation_mode                      = local.isolation_mode
    use_provider_assume_role            = local.use_deploy_role
    deploy_role_arn_set                 = local.use_deploy_role
    deploy_role_session_name            = local.use_deploy_role ? local.deploy_role_session_name : null
    deploy_role_session_duration_s      = local.use_deploy_role ? var.deploy_role_session_duration_seconds : null
    deploy_role_session_tags_enabled    = local.use_deploy_role && var.enable_deploy_role_session_tags
    external_id_configured              = local.deploy_role_external_id_configured
    external_id_parameter_name          = var.deploy_role_external_id_parameter_name
    state_backend_bucket_documented     = var.state_backend_bucket
    state_backend_lock_table_documented = var.state_backend_dynamodb_table
    state_backend_key_documented        = var.state_backend_key
    ebs_kms_from_dedicated              = var.ebs_kms_key_id == null && var.dedicated_kms_key_arn != null
    artifact_cross_account_mode         = var.artifact_cross_account_mode
    track_a_sources = {
      module  = "modules/account-factory"
      runbook = "references/runbooks/account-factory.md"
      outputs = ["deploy_role_arn", "kms_key_arn", "state_backend_config_template", "account_id", "log_group_name", "tenant_template_wiring"]
    }
    track_b_sources = {
      module  = "modules/customer-account-access"
      runbook = "references/runbooks/track-b-customer-account-access.md"
      outputs = ["role_arn", "external_id_parameter_name", "terraform_provider_assume_role_hcl", "platform_artifact_bucket_policy_statement_json"]
    }
    no_static_keys = "Provider uses SSO or sts:AssumeRole only — never iam access keys in this template."
  }
}

output "state_backend_hints" {
  description = "Non-secret hints for backend.tf (values are operator-documented; not applied by Terraform)."
  value = {
    bucket         = var.state_backend_bucket
    dynamodb_table = var.state_backend_dynamodb_table
    key            = var.state_backend_key
    encrypt        = true
    notes = [
      "Copy backend.tf.example → backend.tf in the private deploy working tree.",
      "Track A: prefer account-factory output state_backend_config_template after baseline apply.",
      "Track B: use a customer-owned state bucket/key — never share Lanyard platform state.",
      "One state key per tenant; never multi-tenant shared state files.",
    ]
  }
}

output "artifact_cross_account_notes" {
  description = "How to wire product-artifact S3 across accounts (placeholder guidance only)."
  value = {
    mode = var.artifact_cross_account_mode
    guidance = {
      platform_bucket_grant = "After apply, take company-brain instance_role_arn; add customer-account-access platform_artifact_bucket_policy_statement_json to the Lanyard product-artifact bucket (replace INSTANCE_ROLE_ARN). Scope GetObject to hermes/* and client-core/* only."
      customer_mirror       = "Mirror release objects into a customer-owned bucket; set artifact_s3_bucket_arns / object ARNs / list prefixes on this tenant stack. No cross-account principal on Lanyard S3."
      https_pins            = "Leave artifact_s3_* empty; pin HTTPS URLs + SHA-256 (private GH may need GITHUB_TOKEN on host — never commit tokens)."
      same_account          = "Track A default: instance role List/Get on the platform (or tenant) artifact bucket in the same account; set artifact_s3_* to hermes/ + client-core/ prefixes."
    }
    pin_contract    = "artifacts/README.md"
    track_b_runbook = "references/runbooks/track-b-customer-account-access.md"
  }
}

output "client_core_artifact_version" {
  value = var.client_core_artifact_version
}

output "hermes_artifact_version" {
  value = var.hermes_artifact_version
}

output "relay_contract_major" {
  value = var.relay_contract_major
}

output "instance_id" {
  value = try(module.company_brain.instance_id, null)
}

output "public_ip" {
  value = try(module.company_brain.public_ip, null)
}

output "ssh_command" {
  description = "SSH break-glass only when key + CIDRs set; null for SSM-only."
  value       = try(module.company_brain.ssh_command, null)
}

output "ssm_start_session_command" {
  description = "Preferred operator access via SSM Session Manager."
  value       = try(module.company_brain.ssm_start_session_command, null)
}

output "access_command" {
  description = "Preferred host access (SSM when enabled)."
  value       = try(module.company_brain.access_command, null)
}

output "egress_mode" {
  description = "Effective SG egress posture from company-brain-ec2."
  value       = try(module.company_brain.egress_mode, null)
}

output "tailscale_enabled" {
  description = "Whether optional Tailscale secondary access is configured."
  value       = try(module.company_brain.tailscale_enabled, false)
}

output "tailscale_enroll_command" {
  description = "On-host Tailscale enroll command when enable_tailscale=true."
  value       = try(module.company_brain.tailscale_enroll_command, null)
}

output "tailscale_config" {
  description = "Non-secret Tailscale summary (parameter names / tags only)."
  value       = try(module.company_brain.tailscale_config, null)
}

output "artifact_pins" {
  value = try(module.company_brain.artifact_pins, null)
}

output "hermes_relay_env" {
  description = "GATEWAY_RELAY_* map. Production: non-secret fields + SSM/SM reference only — never the secret value. Fetch secret on host (host_secret_fetch_command)."
  value       = try(module.portal_relay.hermes_env_vars, null)
  sensitive   = true
}

output "hermes_relay_env_public" {
  description = "Non-secret GATEWAY_RELAY_* fields safe for operator notes and CI."
  value       = try(module.portal_relay.hermes_env_vars_public, null)
}

output "relay_secret_ref" {
  description = "Where the host loads GATEWAY_RELAY_SECRET (parameter name / secret ARN)."
  value       = try(module.portal_relay.relay_secret_ref, null)
}

output "host_secret_fetch_command" {
  description = "On-host one-liner to fetch the relay secret with instance credentials."
  value       = try(module.portal_relay.host_secret_fetch_command, null)
}

output "host_env_merge_hint" {
  description = "How to merge public env + host-fetched secret into ~/.hermes/.env."
  value       = try(module.portal_relay.host_env_merge_hint, null)
}

output "bootstrap_path" {
  description = "On-host path of the injected bootstrap executable."
  value       = try(module.company_brain.bootstrap_path, "/usr/local/sbin/company-brain-bootstrap")
}

output "bootstrap_command" {
  description = "Run on the instance after SSH (loads /etc/company-brain/artifact-pins.env)."
  value       = try(module.company_brain.bootstrap_command, "sudo /usr/local/sbin/company-brain-bootstrap")
}

output "bootstrap_hint" {
  value = <<-EOT
    Prefer SSM (not public SSH):
      ${try(module.company_brain.ssm_start_session_command, "aws ssm start-session --target <instance-id>")}

    On host:
      # Pins written by user_data to /etc/company-brain/artifact-pins.env
      # Bootstrap script installed at bootstrap_path (from monorepo scripts/bootstrap-host.sh)
      ${try(module.company_brain.bootstrap_command, "sudo /usr/local/sbin/company-brain-bootstrap")}

    Optional packs:
      sudo /usr/local/sbin/company-brain-bootstrap --packs gws,wacli
  EOT
}

output "security_observability_enabled" {
  description = "Whether modules/security-observability is instantiated for this tenant."
  value       = var.enable_security_observability
}

output "security_sns_topic_arn" {
  description = "Security alert SNS topic ARN when observability module is enabled."
  value       = try(module.security_observability[0].security_sns_topic_arn, null)
}

output "vpc_flow_log_id" {
  description = "VPC Flow Log ID when observability module enables flow logs."
  value       = try(module.security_observability[0].vpc_flow_log_id, null)
}

output "host_log_group_name" {
  description = "Resolved host log group name (used when enable_host_log_shipping=true)."
  value       = try(module.company_brain.host_log_group_name, "${local.log_group_prefix}/host")
}

output "snapshot_age_monitor_interface" {
  description = "SNS/tag contract for snapshot-age monitoring (security-observability)."
  value       = try(module.security_observability[0].snapshot_age_monitor_interface, null)
}

output "snapshot_age_alarm_summary" {
  description = "Snapshot-age alarm + schedule contract from company-brain-ec2 (cbd-zzx.20)."
  value       = try(module.company_brain.snapshot_age_alarm_summary, null)
}

output "snapshot_dr_copy_summary" {
  description = "Opt-in DLM cross-region / DR-account share contract from company-brain-ec2 (cbd-mta.7.4; defaults off)."
  value       = try(module.company_brain.snapshot_dr_copy_summary, null)
}

output "observability_summary" {
  description = "Non-secret observability flags for operators and checklists."
  value = {
    enable_security_observability      = var.enable_security_observability
    enable_vpc_flow_logs               = var.enable_vpc_flow_logs
    enable_host_log_shipping           = var.enable_host_log_shipping
    enable_ssm_managed_instance_core   = var.enable_ssm_managed_instance_core
    require_observability_checklist    = var.require_observability_checklist
    enable_snapshot_age_alarm          = var.enable_snapshot_age_alarm
    enable_snapshot_age_check_schedule = var.enable_snapshot_age_check_schedule
    snapshot_max_age_hours             = var.snapshot_max_age_hours
    host                               = try(module.company_brain.observability_flags, null)
    security_module                    = try(module.security_observability[0].observability_summary, null)
    snapshot_age                       = try(module.company_brain.snapshot_age_alarm_summary, null)
  }
}

output "approved_processor_ids" {
  description = "Catalog processor IDs selected for this tenant (references/approved-data-processors.md)."
  value       = var.approved_processor_ids
}

output "data_handling_policy_ref" {
  description = "Private reference to the filled client data-handling policy (ticket/path); not vault content."
  value       = var.data_handling_policy_ref
}

output "processor_egress_domains" {
  description = "Documented HTTPS/WSS FQDNs for firewall/proxy allowlist (not SG-enforced here)."
  value       = var.processor_egress_domains
}

output "data_handling_summary" {
  description = "Non-secret data-handling / processor policy contract for operators (cbd-zzx.13)."
  value = {
    approved_processor_ids        = var.approved_processor_ids
    data_handling_policy_ref_set  = var.data_handling_policy_ref != null && var.data_handling_policy_ref != ""
    processor_egress_domain_count = length(var.processor_egress_domains)
    require_data_handling_policy  = var.require_data_handling_policy
    email_provider                = var.email_provider
    enable_packs                  = var.enable_packs
    egress_mode                   = try(module.company_brain.egress_mode, null)
    catalog                       = "references/approved-data-processors.md"
    policy_template               = "references/templates/client-data-handling-policy.md"
    onboarding_runbook            = "references/runbooks/data-processor-onboarding.md"
    controlled_egress_runbook     = "references/runbooks/controlled-egress.md"
  }
}
