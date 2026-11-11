output "instance_id" {
  description = "Company Brain Hermes EC2 instance ID."
  value       = aws_instance.hermes.id
}

output "public_ip" {
  description = "Public IP (null if associate_public_ip is false or no public address)."
  value       = aws_instance.hermes.public_ip
}

output "private_ip" {
  description = "Private IP of the Hermes host."
  value       = aws_instance.hermes.private_ip
}

output "security_group_id" {
  description = "Security group ID for the Hermes host."
  value       = aws_security_group.hermes.id
}

output "availability_zone" {
  description = "AZ of the Hermes instance (for attaching additional volumes)."
  value       = aws_instance.hermes.availability_zone
}

output "data_volume_id" {
  description = "Optional data EBS volume ID (empty if data_volume_size_gb is 0)."
  value       = try(aws_ebs_volume.data[0].id, null)
}

output "instance_role_arn" {
  description = "IAM role ARN for the Hermes instance (null if create_instance_role is false)."
  value       = try(aws_iam_role.instance[0].arn, null)
}

output "instance_profile_name" {
  description = "IAM instance profile name (null if create_instance_role is false)."
  value       = try(aws_iam_instance_profile.instance[0].name, null)
}

output "ssh_command" {
  description = "SSH break-glass command when key + CIDRs configured; null when SSM-only (no key or empty operator_ssh_cidrs)."
  value = (
    local.ssh_key_name_effective == null || !local.create_ssh_ingress
    ? null
    : (
      aws_instance.hermes.public_ip != null && aws_instance.hermes.public_ip != ""
      ? "ssh -i ~/.ssh/${local.ssh_key_name_effective}.pem ec2-user@${aws_instance.hermes.public_ip}"
      : "ssh -i ~/.ssh/${local.ssh_key_name_effective}.pem ec2-user@${aws_instance.hermes.private_ip}"
    )
  )
}

output "ssm_start_session_command" {
  description = "Preferred operator access: AWS SSM Session Manager (no public SSH)."
  value       = "aws ssm start-session --target ${aws_instance.hermes.id} --region ${var.region}"
}

output "access_command" {
  description = "Preferred host access command (SSM when enable_ssm_access; else SSH if configured)."
  value = (
    var.enable_ssm_access
    ? "aws ssm start-session --target ${aws_instance.hermes.id} --region ${var.region}"
    : (
      local.ssh_key_name_effective != null && local.create_ssh_ingress
      ? (
        aws_instance.hermes.public_ip != null && aws_instance.hermes.public_ip != ""
        ? "ssh -i ~/.ssh/${local.ssh_key_name_effective}.pem ec2-user@${aws_instance.hermes.public_ip}"
        : "ssh -i ~/.ssh/${local.ssh_key_name_effective}.pem ec2-user@${aws_instance.hermes.private_ip}"
      )
      : "No access method configured: enable_ssm_access or set operator_ssh_cidrs + ssh_key_name"
    )
  )
}

output "ssh_ingress_enabled" {
  description = "True when operator_ssh_cidrs is non-empty (port 22 ingress present)."
  value       = local.create_ssh_ingress
}

output "egress_mode" {
  description = "Effective security group egress posture (controlled | open)."
  value       = local.egress_mode
}

output "use_golden_ami" {
  description = "Whether user_data skipped broad package installs (golden AMI path)."
  value       = var.use_golden_ami
}

output "ami_id_requested" {
  description = "Pinned AMI ID requested by tfvars (null when using latest AL2023 lookup in lab)."
  value       = var.ami_id
}

output "ssm_session_log_group_name" {
  description = "CloudWatch log group for SSM sessions when enable_ssm_session_log_group=true."
  value       = try(aws_cloudwatch_log_group.ssm_sessions[0].name, null)
}

output "vpc_endpoint_ids" {
  description = "Optional VPC endpoint IDs created by this module."
  value = {
    ssm         = try(aws_vpc_endpoint.ssm[0].id, null)
    ssmmessages = try(aws_vpc_endpoint.ssmmessages[0].id, null)
    ec2messages = try(aws_vpc_endpoint.ec2messages[0].id, null)
    logs        = try(aws_vpc_endpoint.logs[0].id, null)
    kms         = try(aws_vpc_endpoint.kms[0].id, null)
    sts         = try(aws_vpc_endpoint.sts[0].id, null)
    s3          = try(aws_vpc_endpoint.s3[0].id, null)
  }
}

output "ssm_session_logging_hint" {
  description = "How to wire Session Manager preferences for CloudWatch/S3 session logging."
  value = (
    var.enable_ssm_session_log_group || var.ssm_session_logs_s3_bucket_name != null
    ? "Configure SSM document SSM-SessionManagerRunShell: cloudWatchLogGroupName=${try(aws_cloudwatch_log_group.ssm_sessions[0].name, coalesce(var.ssm_session_logs_cloudwatch_log_group, "(set enable_ssm_session_log_group)"))}; s3BucketName=${coalesce(var.ssm_session_logs_s3_bucket_name, "(optional)")}. See references/runbooks/ssm-break-glass.md."
    : "Optional: set enable_ssm_session_log_group=true and/or ssm_session_logs_s3_bucket_name; configure SSM-SessionManagerRunShell preferences."
  )
}

output "artifact_pins" {
  description = <<-EOT
    Pinned artifact coordinates passed into bootstrap / user_data (placeholders until configured).
    Prefer backend_* keys; hermes_* / relay_contract_major are TEMPORARY dual-write aliases
    with the same effective values (lp-k7g.10.3). See also backend_artifact_pins.
  EOT
  value = {
    client_core_url     = var.client_core_artifact_url
    client_core_version = var.client_core_artifact_version
    client_core_sha256  = var.client_core_artifact_sha256
    # Primary (effective — resolves backend_* or temporary hermes_* module inputs)
    backend_url                     = local.effective_backend_artifact_url
    backend_version                 = local.effective_backend_artifact_version
    backend_sha256                  = local.effective_backend_artifact_sha256
    backend_kind                    = local.effective_backend_artifact_kind
    backend_arch                    = local.effective_backend_artifact_arch
    backend_contract_relay          = local.effective_backend_contract_relay
    backend_contract_runtime_layout = local.effective_backend_contract_runtime_layout
    backend_contract_brain_rpc      = local.effective_backend_contract_brain_rpc
    backend_install_path            = local.effective_backend_install_path
    # TEMPORARY legacy aliases (same effective values)
    hermes_url           = local.effective_backend_artifact_url
    hermes_version       = local.effective_backend_artifact_version
    hermes_sha256        = local.effective_backend_artifact_sha256
    hermes_arch          = local.effective_backend_artifact_arch
    relay_contract_major = tostring(local.effective_backend_contract_relay)
  }
}

output "bootstrap_path" {
  description = "On-host path of the root-owned bootstrap executable installed by user_data."
  value       = var.bootstrap_install_path
}

output "bootstrap_command" {
  description = "Run on the instance after SSM (or SSH break-glass) to download/verify artifacts and install Hermes + client-core seed. Loads pins from /etc/company-brain/artifact-pins.env."
  value       = "sudo ${var.bootstrap_install_path}"
}

output "bootstrap_script_injected" {
  description = "True when bootstrap_script_b64 was non-empty at plan time (real script vs fail-closed stub)."
  value       = var.bootstrap_script_b64 != ""
}

output "relay_module_hint" {
  description = "Next step for Lanyard Web Portal connectivity."
  value       = "Wire portal relay with modules/customer-gateway-relay after control-plane provision."
}

output "network_mode" {
  description = "Active network posture (production = private VPC/subnet, no public IP; lab = non-prod defaults allowed)."
  value       = var.network_mode
}

output "associate_public_ip" {
  description = "Whether a public IP was requested (always false in production network_mode)."
  value       = local.associate_public_ip
}

output "ebs_kms_key_id" {
  description = "Customer-managed KMS key used for EBS volumes (null = AWS-managed default)."
  value       = var.ebs_kms_key_id
}

output "artifact_s3_get_object_arns" {
  description = "Effective s3:GetObject resource ARNs on the instance role (empty if no artifact S3 policy)."
  value       = local.create_artifact_read_policy ? local.artifact_get_object_arns : []
}

output "status_alarm_name" {
  description = "CloudWatch status-check alarm name (null when enable_status_alarm=false)."
  value       = try(aws_cloudwatch_metric_alarm.instance_status_check[0].alarm_name, null)
}

output "snapshot_age_alarm_name" {
  description = "CloudWatch snapshot-age alarm name (null when enable_snapshot_age_alarm=false)."
  value       = try(aws_cloudwatch_metric_alarm.snapshot_age[0].alarm_name, null)
}

output "snapshot_age_check_rule_name" {
  description = "EventBridge rule name for daily snapshot-age check reminder (null when schedule disabled)."
  value       = try(aws_cloudwatch_event_rule.snapshot_age_check[0].name, null)
}

output "snapshot_age_alarm_summary" {
  description = "Non-secret snapshot-age monitoring contract for operators."
  value = {
    enabled             = var.enable_snapshot_age_alarm
    alarm_name          = try(aws_cloudwatch_metric_alarm.snapshot_age[0].alarm_name, null)
    max_age_hours       = var.snapshot_max_age_hours
    metric_namespace    = "CompanyBrain/Backup"
    metric_name         = "NewestSnapshotAgeHours"
    project_dimension   = var.project_name
    dlm_target_tags     = { Backup = "daily", Project = var.project_name }
    check_script        = "scripts/check-snapshot-age.sh"
    restore_script      = "scripts/restore-from-snapshot.sh"
    schedule_enabled    = local.create_snapshot_age_check_schedule
    schedule_rule_name  = try(aws_cloudwatch_event_rule.snapshot_age_check[0].name, null)
    alarm_actions_count = length(var.snapshot_age_alarm_actions)
    runbook             = "references/runbooks/dlm-restore-drill.md"
  }
}

output "snapshot_dr_copy_summary" {
  description = "Non-secret opt-in DLM cross-region copy / DR-account share contract (cbd-mta.7.4). Defaults are fail-closed off."
  value = {
    enable_dlm                       = var.enable_dlm
    enable_cross_region_copy         = var.enable_cross_region_copy
    destination_region               = var.enable_cross_region_copy ? var.destination_region : null
    cross_region_copy_cmk_configured = var.cross_region_copy_cmk_arn != null
    cross_region_copy_retain = var.enable_cross_region_copy ? {
      interval = var.cross_region_copy_retain_interval
      unit     = var.cross_region_copy_retain_interval_unit
    } : null
    enable_dr_account_share = var.enable_dr_account_share
    # Account id intentionally omitted from outputs to avoid echoing live DR ids in plans/logs by default.
    dr_account_share_configured = var.enable_dr_account_share && var.dr_account_id != null
    primary_encrypted           = true
    ebs_snapshot_bpa_enabled    = var.enable_ebs_snapshot_block_public_access
    ebs_snapshot_bpa_state      = var.ebs_snapshot_block_public_access_state
    isolation_policy            = "references/tenant-isolation-decision.md"
    runbook                     = "references/runbooks/dlm-restore-drill.md"
  }
}

output "host_log_group_name" {
  description = "Effective host log group name (set when log shipping is enabled; always shows resolved default name)."
  value       = local.host_log_group_name
}

output "host_log_group_arn" {
  description = "Host CloudWatch log group ARN when created by this module."
  value       = try(aws_cloudwatch_log_group.host[0].arn, null)
}

output "host_log_shipping_enabled" {
  description = "Whether user_data configures CloudWatch agent log shipping."
  value       = var.enable_host_log_shipping
}

output "ssm_managed_instance_core_enabled" {
  description = "Whether AmazonSSMManagedInstanceCore is attached to the instance role."
  value       = local.attach_ssm_core
}

output "observability_flags" {
  description = "Non-secret host observability flags for operators / tenant checklist."
  value = {
    enable_status_alarm                = var.enable_status_alarm
    status_alarm_actions_count         = length(var.status_alarm_actions)
    enable_host_log_shipping           = var.enable_host_log_shipping
    enable_ssm_managed_instance_core   = var.enable_ssm_managed_instance_core
    enable_cloudwatch_agent_iam        = local.attach_cloudwatch_agent_iam
    host_log_group_name                = local.host_log_group_name
    enable_snapshot_age_alarm          = var.enable_snapshot_age_alarm
    snapshot_max_age_hours             = var.snapshot_max_age_hours
    snapshot_age_alarm_actions_count   = length(var.snapshot_age_alarm_actions)
    enable_snapshot_age_check_schedule = var.enable_snapshot_age_check_schedule
  }
}

output "omnibox_enabled" {
  description = "Whether Omnibox Mode A is enabled (enable_omnibox). Default false; does not replace hermes-gateway ExecStart."
  value       = var.enable_omnibox
}

output "omnibox_config" {
  description = "Non-secret Omnibox Mode A env contract for operators (gateway Environment)."
  value = {
    enable_omnibox     = var.enable_omnibox
    OMNIBOX_ENABLED    = var.enable_omnibox ? "1" : "0"
    OMNIBOX_CONFIG_DIR = "/etc/company-brain/omnibox"
    OMNIBOX_WRAPPER    = "/usr/local/sbin/run-under-omnibox"
    env_file           = "/etc/company-brain/omnibox.env"
    ensure_script      = "scripts/ensure-omnibox.sh"
    note               = "Mode A only — hermes-gateway ExecStart remains Hermes binary family"
  }
}

output "tailscale_enabled" {
  description = "Whether optional Tailscale secondary access is configured (auth key still lives outside Terraform)."
  value       = var.enable_tailscale
}

output "tailscale_config" {
  description = "Non-secret Tailscale configuration summary for operators."
  value = var.enable_tailscale ? {
    auth_secret_source             = var.tailscale_auth_secret_source
    auth_secret_ssm_parameter      = local.tailscale_ssm_parameter_name
    auth_secret_secretsmanager_arn = local.tailscale_sm_secret_arn
    tags                           = local.tailscale_tags
    hostname                       = local.tailscale_hostname
    auto_enroll                    = var.tailscale_auto_enroll
    allow_direct_udp_41641         = var.tailscale_allow_direct_udp
    enroll_command                 = "sudo /usr/local/sbin/company-brain-tailscale-enroll"
    runbook                        = "references/runbooks/tailscale-operator-access.md"
    } : {
    auth_secret_source             = null
    auth_secret_ssm_parameter      = null
    auth_secret_secretsmanager_arn = null
    tags                           = []
    hostname                       = null
    auto_enroll                    = false
    allow_direct_udp_41641         = false
    enroll_command                 = null
    runbook                        = "references/runbooks/tailscale-operator-access.md"
  }
}

output "tailscale_enroll_command" {
  description = "On-host command to (re)enroll Tailscale using the instance role secret fetch path."
  value       = var.enable_tailscale ? "sudo /usr/local/sbin/company-brain-tailscale-enroll" : null
}
