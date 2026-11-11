locals {
  project_name = coalesce(var.project_name, "${var.tenant_slug}-brain")

  # Default isolation_mode from hosting_track when unset (see tenant-isolation-decision.md).
  isolation_mode = coalesce(
    var.isolation_mode,
    var.hosting_track == "customer_account" ? "customer_account" : "vpc_interim"
  )

  log_group_prefix = coalesce(var.log_group_prefix, "/company-brain/${var.tenant_slug}")

  # Prefer explicit ebs_kms_key_id; fall back to isolation dedicated_kms_key_arn
  # (Track A account-factory kms_key_arn → dedicated_kms_key_arn → EBS).
  # Pilot may omit CMK (production_intent=false). coalesce() rejects all-null.
  ebs_kms_key_id_effective = try(coalesce(var.ebs_kms_key_id, var.dedicated_kms_key_arn), null)

  # ---------------------------------------------------------------------------
  # Deploy-role / provider assume-role wiring (Track A account-factory + Track B
  # customer-account-access). Null deploy_role_arn = operator already has target
  # account credentials (SSO); no assume_role block on the default provider.
  # ---------------------------------------------------------------------------
  use_deploy_role = (
    var.deploy_role_arn != null &&
    var.deploy_role_arn != ""
  )

  deploy_role_session_name = coalesce(
    var.deploy_role_session_name,
    var.hosting_track == "customer_account"
    ? "lanyard-track-b-${var.tenant_slug}"
    : "lanyard-account-factory-${var.tenant_slug}"
  )

  # Empty string → null so Track A without ExternalId does not send sts:ExternalId.
  deploy_role_external_id_effective = (
    var.deploy_role_external_id != null && var.deploy_role_external_id != ""
    ? var.deploy_role_external_id
    : null
  )

  # Non-secret boolean for outputs/checks (never export the ExternalId value).
  deploy_role_external_id_configured = nonsensitive(
    var.deploy_role_external_id != null && var.deploy_role_external_id != ""
  )

  deploy_role_session_tags_effective = (
    local.use_deploy_role && var.enable_deploy_role_session_tags
    ? {
      Project    = local.project_name
      TenantSlug = var.tenant_slug
    }
    : {}
  )

  # Data-handling alignment (cbd-zzx.13): email_provider vs approved email-* processors.
  approved_has_email_google = contains(var.approved_processor_ids, "email-google")
  approved_has_email_m365   = contains(var.approved_processor_ids, "email-m365")
  approved_has_any_email    = local.approved_has_email_google || local.approved_has_email_m365
  email_provider_matches_processors = (
    !local.approved_has_any_email
    || (var.email_provider == "google" && local.approved_has_email_google)
    || (var.email_provider == "m365" && local.approved_has_email_m365)
  )
}

# ---------------------------------------------------------------------------
# Isolation fail-closed checks (Terraform >= 1.5 check blocks)
# production_intent=true requires real partitions; does not clear Portal G1/G2.
# ---------------------------------------------------------------------------

check "isolation_mode_matches_hosting_track" {
  assert {
    condition = (
      (var.hosting_track == "customer_account" && local.isolation_mode == "customer_account") ||
      (var.hosting_track == "lanyard_hosted" && contains(["account", "vpc_interim"], local.isolation_mode))
    )
    error_message = "isolation_mode must be customer_account when hosting_track=customer_account; account or vpc_interim when lanyard_hosted. See references/tenant-isolation-decision.md."
  }
}

check "production_intent_requires_account_id" {
  assert {
    condition     = !var.production_intent || (var.aws_account_id != null && var.aws_account_id != "")
    error_message = "production_intent=true requires aws_account_id (12-digit account boundary)."
  }
}

check "production_intent_requires_log_partition" {
  assert {
    condition     = !var.production_intent || (local.log_group_prefix != null && local.log_group_prefix != "")
    error_message = "production_intent=true requires log_group_prefix (per-tenant log partition)."
  }
}

check "production_intent_lanyard_requires_dedicated_kms" {
  assert {
    condition = (
      !var.production_intent ||
      var.hosting_track != "lanyard_hosted" ||
      (var.dedicated_kms_key_arn != null && var.dedicated_kms_key_arn != "")
    )
    error_message = "production_intent=true with lanyard_hosted requires dedicated_kms_key_arn (per-tenant CMK). Shared unpartitioned keys are forbidden."
  }
}

check "production_intent_forbids_unscoped_project" {
  assert {
    condition     = !var.production_intent || can(regex("^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$", local.project_name))
    error_message = "production_intent=true requires a unique-style project_name (3–50 lowercase alnum/hyphen)."
  }
}

# Observability honesty gate (optional). Account CloudTrail/GuardDuty detectors stay
# outside the tenant stack — see references/security-observability.md checklist.
check "production_observability_checklist" {
  assert {
    condition = (
      !var.production_intent
      || !var.require_observability_checklist
      || (
        var.enable_security_observability
        && var.enable_vpc_flow_logs
        && var.enable_host_log_shipping
        && var.enable_ssm_managed_instance_core
      )
    )
    error_message = "require_observability_checklist with production_intent requires enable_security_observability, enable_vpc_flow_logs, enable_host_log_shipping, and enable_ssm_managed_instance_core. Account CloudTrail/GuardDuty: references/security-observability.md."
  }
}

# Data-handling / approved processors (cbd-zzx.13). Catalog + private policy required when
# production tenants opt into require_data_handling_policy (vault-derived off-box flows).
check "production_data_handling_policy" {
  assert {
    condition = (
      !var.production_intent
      || !var.require_data_handling_policy
      || (
        length(var.approved_processor_ids) > 0
        && var.data_handling_policy_ref != null
        && var.data_handling_policy_ref != ""
      )
    )
    error_message = "require_data_handling_policy with production_intent requires non-empty approved_processor_ids and data_handling_policy_ref. See references/approved-data-processors.md and references/templates/client-data-handling-policy.md."
  }
}

# email_provider should align with approved email processors when policy enforcement is on.
check "email_provider_matches_approved_processors" {
  assert {
    condition = (
      !var.production_intent
      || !var.require_data_handling_policy
      || local.email_provider_matches_processors
    )
    error_message = "When email-* processors are approved under require_data_handling_policy, email_provider must match (google→email-google, m365→email-m365). See references/approved-data-processors.md."
  }
}

# Track B assume-role requires ExternalId (confused-deputy protection). Track A
# ExternalId is optional (only when account-factory deploy role trust set it).
check "track_b_deploy_role_requires_external_id" {
  assert {
    condition = (
      !local.use_deploy_role
      || var.hosting_track != "customer_account"
      || local.deploy_role_external_id_configured
    )
    error_message = "hosting_track=customer_account with deploy_role_arn requires deploy_role_external_id (from Lanyard secret store at customer-account-access external_id_parameter_name — never commit the value). See references/runbooks/track-b-customer-account-access.md."
  }
}

# When production_intent and assume-role is used, require a real-looking role ARN
# and matching aws_account_id partition (role account == aws_account_id).
check "production_deploy_role_account_matches" {
  assert {
    condition = (
      !var.production_intent
      || !local.use_deploy_role
      || var.aws_account_id == null
      || can(regex("^arn:aws:iam::${var.aws_account_id}:role/", var.deploy_role_arn))
    )
    error_message = "production_intent with deploy_role_arn requires the role ARN account to match aws_account_id (tenant account boundary)."
  }
}

# In-repo relative sources — preferred (paths relative to deploy/deployments/mocklab/).
# Do not float on main. If consuming this monorepo from outside, pin a tag or commit:
#   source = "git::https://github.com/LanyardBrain/lanyard-platform.git//deploy/modules/company-brain-ec2?ref=v0.1.0"

# Tenant-scoped security observability (Flow Logs, SNS, GuardDuty findings bridge).
# Account-level CloudTrail / GuardDuty detectors are NOT created here.
module "security_observability" {
  source = "../../modules/security-observability"
  count  = var.enable_security_observability ? 1 : 0

  project_name = local.project_name
  vpc_id       = var.vpc_id

  enable_vpc_flow_logs            = var.enable_vpc_flow_logs
  enable_security_sns_topic       = true
  enable_guardduty_finding_alerts = true
  security_alert_email_endpoints  = var.security_alert_email_endpoints

  flow_logs_log_group_name     = "${local.log_group_prefix}/vpc-flow-logs"
  snapshot_age_monitor_enabled = true

  extra_tags = {
    TenantSlug = var.tenant_slug
  }
}

module "company_brain" {
  source = "../../modules/company-brain-ec2"

  region              = var.region
  project_name        = local.project_name
  instance_type       = var.instance_type
  ssh_key_name        = var.ssh_key_name
  operator_ssh_cidrs  = var.operator_ssh_cidrs
  install_path        = var.install_path
  hermes_install_path = var.hermes_install_path

  # Private-by-default for tenant deploys (override network_mode=lab only for non-prod).
  network_mode        = var.network_mode
  vpc_id              = var.vpc_id
  subnet_id           = var.subnet_id
  associate_public_ip = var.associate_public_ip

  # SSM-first access; SSH optional break-glass only.
  enable_ssm_access            = var.enable_ssm_access
  create_ssm_vpc_endpoints     = var.create_ssm_vpc_endpoints
  ssm_vpc_endpoint_subnet_ids  = var.ssm_vpc_endpoint_subnet_ids
  enable_ssm_session_log_group = var.enable_ssm_session_log_group

  # Controlled egress (production defaults to controlled; lab may open).
  egress_mode                         = var.egress_mode
  egress_https_cidrs                  = var.egress_https_cidrs
  egress_https_prefix_list_ids        = var.egress_https_prefix_list_ids
  create_s3_gateway_endpoint          = var.create_s3_gateway_endpoint
  s3_gateway_endpoint_route_table_ids = var.s3_gateway_endpoint_route_table_ids
  create_aws_interface_endpoints      = var.create_aws_interface_endpoints

  # Golden AMI / supply chain
  ami_id             = var.ami_id
  use_golden_ami     = var.use_golden_ami
  require_pinned_ami = var.require_pinned_ami

  ebs_kms_key_id                          = local.ebs_kms_key_id_effective
  enable_ebs_snapshot_block_public_access = var.enable_ebs_snapshot_block_public_access
  ebs_snapshot_block_public_access_state  = var.ebs_snapshot_block_public_access_state

  client_core_artifact_url     = var.client_core_artifact_url
  client_core_artifact_version = var.client_core_artifact_version
  client_core_artifact_sha256  = var.client_core_artifact_sha256
  hermes_artifact_url          = var.hermes_artifact_url
  hermes_artifact_version      = var.hermes_artifact_version
  hermes_artifact_sha256       = var.hermes_artifact_sha256
  relay_contract_major         = var.relay_contract_major
  artifact_s3_bucket_arns      = var.artifact_s3_bucket_arns
  artifact_s3_object_arns      = var.artifact_s3_object_arns
  artifact_s3_list_prefixes    = var.artifact_s3_list_prefixes

  # Host observability (default off; set true for production — see security-observability.md)
  enable_ssm_managed_instance_core = var.enable_ssm_managed_instance_core
  enable_cloudwatch_agent_iam      = var.enable_cloudwatch_agent_iam
  enable_host_log_shipping         = var.enable_host_log_shipping
  host_log_group_name              = "${local.log_group_prefix}/host"
  status_alarm_actions             = try(module.security_observability[0].alarm_actions, [])
  status_ok_actions                = try(module.security_observability[0].alarm_actions, [])

  # Snapshot-age / missing backup (cbd-zzx.20) — same SNS as status/security
  enable_snapshot_age_alarm          = var.enable_snapshot_age_alarm
  snapshot_max_age_hours             = var.snapshot_max_age_hours
  snapshot_age_alarm_actions         = try(module.security_observability[0].alarm_actions, [])
  snapshot_age_ok_actions            = try(module.security_observability[0].alarm_actions, [])
  enable_snapshot_age_check_schedule = var.enable_snapshot_age_check_schedule

  # Opt-in DLM DR copy/share (cbd-mta.7.4) — defaults off; see dlm-restore-drill.md
  enable_cross_region_copy  = var.enable_cross_region_copy
  destination_region        = var.destination_region
  cross_region_copy_cmk_arn = var.cross_region_copy_cmk_arn
  enable_dr_account_share   = var.enable_dr_account_share
  dr_account_id             = var.dr_account_id

  # Omnibox Mode A (cbd-o9s.10) — default false; does not replace hermes-gateway ExecStart
  enable_omnibox = var.enable_omnibox

  # Optional Tailscale secondary mesh (default off). Auth key from SSM/SM only — never tfvars value.
  # See references/runbooks/tailscale-operator-access.md
  enable_tailscale                         = var.enable_tailscale
  tailscale_auth_secret_source             = var.tailscale_auth_secret_source
  tailscale_auth_secret_ssm_parameter      = var.tailscale_auth_secret_ssm_parameter
  tailscale_auth_secret_ssm_parameter_arn  = var.tailscale_auth_secret_ssm_parameter_arn
  tailscale_auth_secret_secretsmanager_arn = var.tailscale_auth_secret_secretsmanager_arn
  tailscale_tags                           = var.tailscale_tags
  tailscale_hostname                       = var.tailscale_hostname
  tailscale_auto_enroll                    = var.tailscale_auto_enroll
  tailscale_ssh                            = var.tailscale_ssh
  tailscale_extra_up_args                  = var.tailscale_extra_up_args
  tailscale_allow_direct_udp               = var.tailscale_allow_direct_udp

  # Inject deploy/scripts/bootstrap-host.sh (path.module = deployments/mocklab → ../../scripts).
  # base64gzip keeps EC2 user_data size small. Installed as /usr/local/sbin/company-brain-bootstrap.
  bootstrap_script_b64 = base64gzip(file("${path.module}/../../scripts/bootstrap-host.sh"))

  # Backend runtime secrets via AWS SM (lp-645.4 / lp-645.6) — ARN + non-secret model
  # defaults only. Never put raw API keys in Terraform. Live cutover:
  # CUTOVER-backend-runtime-secrets.md
  backend_runtime_secrets_arn     = var.backend_runtime_secrets_arn
  backend_runtime_secrets_enabled = var.backend_runtime_secrets_enabled
  backend_runtime_secrets_region  = var.backend_runtime_secrets_region
  backend_model_provider          = var.backend_model_provider
  backend_model_default           = var.backend_model_default
}

module "portal_relay" {
  source = "../../modules/customer-gateway-relay"

  relay_wss_url                          = var.relay_wss_url
  relay_instance_id                      = var.relay_instance_id
  deployment_mode                        = var.deployment_mode
  relay_secret_source                    = var.relay_secret_source
  relay_secret_ssm_parameter_name        = var.relay_secret_ssm_parameter_name
  relay_secret_ssm_parameter_arn         = var.relay_secret_ssm_parameter_arn
  relay_secret_secretsmanager_secret_arn = var.relay_secret_secretsmanager_secret_arn
  # Production: leave empty — secret lives in SSM/SM (see references/runbooks/relay-secret-lifecycle.md).
  relay_instance_secret = var.relay_instance_secret
  tenant_slug           = var.tenant_slug
  hermes_home           = "/home/ec2-user/.hermes"
  write_hermes_env_file = false

  hermes_profile_hints = {
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

# Instance role may GetParameter / GetSecretValue for the relay secret reference only.
# Policy JSON is reference-scoped; no secret value in Terraform.
resource "aws_iam_role_policy" "portal_relay_secret_read" {
  # Do not key count on instance_role_arn (unknown until apply). Role is always
  # created when create_instance_role=true (tenant default).
  count = var.attach_relay_secret_iam && var.relay_secret_source != "inline" ? 1 : 0

  name   = "portal-relay-secret-read"
  role   = element(split("/", module.company_brain.instance_role_arn), 1)
  policy = module.portal_relay.relay_secret_iam_policy_json
}
