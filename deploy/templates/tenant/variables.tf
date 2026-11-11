variable "region" {
  type        = string
  description = "AWS region for the tenant data plane."
}

variable "tenant_slug" {
  type        = string
  description = "Portal path slug: https://app.withlanyard.com/<tenant_slug>"

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$", var.tenant_slug))
    error_message = "tenant_slug must be a DNS-safe lowercase slug."
  }
}

variable "project_name" {
  type        = string
  description = <<-EOT
    AWS resource name prefix and DLM/IAM partition key (often <tenant_slug>-brain).
    Must be unique across production tenants. Shape: 3–50 chars, lowercase alphanumeric and hyphens.
    See references/tenant-isolation-decision.md.
  EOT
  default     = null

  validation {
    condition     = var.project_name == null || can(regex("^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$", var.project_name))
    error_message = "project_name must be 3–50 chars, lowercase alphanumeric and hyphens, start/end alphanumeric (unique per tenant)."
  }
}

variable "hosting_track" {
  type        = string
  description = "lanyard_hosted (MVP default) or customer_account. Isolation boundaries: references/tenant-isolation-decision.md."
  default     = "lanyard_hosted"

  validation {
    condition     = contains(["lanyard_hosted", "customer_account"], var.hosting_track)
    error_message = "hosting_track must be lanyard_hosted or customer_account."
  }
}

# ---------------------------------------------------------------------------
# Agent compute runtime (plan §4.11 / lp-4nf)
# This template always provisions company-brain-ec2. Daytona tenants must NOT
# apply it — use CP register + S3 vault prefix (provision-runbook-daytona.md).
# ---------------------------------------------------------------------------

variable "runtime_kind" {
  type        = string
  description = <<-EOT
    Agent compute path for this tenant deployment root:
      - ec2     — always-on company-brain host via modules/company-brain-ec2 (this template)
      - daytona — lazy Daytona sandbox; MUST NOT apply this template (fail-closed)

    Dual-run (Phase 7): keep a separate EC2 instance row/stack with runtime_kind=ec2;
    the daytona instance row uses the Daytona provision runbook only.
    Docs: references/provision-runbook.md (ec2) vs
    docs/plans/0008-daytona-agent-sandboxes/provision-runbook-daytona.md (daytona).
  EOT
  default     = "ec2"

  # lp-4nf: this template always creates company-brain EC2. Reject daytona at
  # variable validation (hard plan error) — do not use soft check{} alone.
  validation {
    condition     = var.runtime_kind == "ec2"
    error_message = "runtime_kind=daytona must not use deploy/templates/tenant (company-brain-ec2). Use CP register + s3_vault_prefix only (provision-runbook-daytona.md / overview §4.11). For dual-run, keep a separate EC2 stack with runtime_kind=ec2."
  }
}

# ---------------------------------------------------------------------------
# Tenant isolation (enforceable when production_intent = true)
# Decision: references/tenant-isolation-decision.md
# ---------------------------------------------------------------------------

variable "isolation_mode" {
  type        = string
  description = <<-EOT
    Isolation boundary mode:
      - account          — account-per-tenant (lanyard_hosted production target)
      - vpc_interim      — same account with mandatory VPC+KMS+logs+DLM partitions (lanyard_hosted interim only)
      - customer_account — full customer AWS account boundary (must pair with hosting_track=customer_account)
    Defaults align hosting_track when null: lanyard_hosted→vpc_interim, customer_account→customer_account.
  EOT
  default     = null

  validation {
    condition     = var.isolation_mode == null || contains(["account", "vpc_interim", "customer_account"], var.isolation_mode)
    error_message = "isolation_mode must be account, vpc_interim, or customer_account."
  }
}

variable "production_intent" {
  type        = bool
  description = <<-EOT
    When true, fail closed unless isolation requirements are set (aws_account_id, isolation_mode,
    dedicated_kms_key_arn for lanyard_hosted, log_group_prefix). Pilots may leave false.
    Does NOT claim Portal G1/G2 production security ready — see references/readiness-matrix.md.
  EOT
  default     = false
}

variable "aws_account_id" {
  type        = string
  description = "Twelve-digit AWS account ID that forms the account boundary for this tenant (private tfvars only)."
  default     = null

  validation {
    condition     = var.aws_account_id == null || can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be a 12-digit AWS account id when set."
  }
}

# ---------------------------------------------------------------------------
# Provider assume-role wiring (Track A account-factory / Track B customer-account-access)
# Sources: modules/account-factory deploy_role_arn; modules/customer-account-access role_arn
# Never commit live role ARNs, ExternalIds, or long-lived access keys.
# ---------------------------------------------------------------------------

variable "deploy_role_arn" {
  type        = string
  description = <<-EOT
    Optional IAM role ARN for the default AWS provider assume_role block.
    Track A: modules/account-factory output deploy_role_arn (baseline create_account_baseline).
    Track B: modules/customer-account-access output role_arn.
    Null/empty = no assume_role (operator SSO or profile already in the target account).
    Never use static access keys. See references/runbooks/account-factory.md and
    references/runbooks/track-b-customer-account-access.md.
  EOT
  default     = null

  validation {
    condition = (
      var.deploy_role_arn == null
      || var.deploy_role_arn == ""
      || can(regex("^arn:aws:iam::[0-9]{12}:role/[A-Za-z0-9_+=,.@/-]+$", var.deploy_role_arn))
    )
    error_message = "deploy_role_arn must be a full arn:aws:iam::ACCOUNT:role/PATH when set."
  }
}

variable "deploy_role_external_id" {
  type        = string
  sensitive   = true
  description = <<-EOT
    STS ExternalId for assume_role. Required when hosting_track=customer_account and
    deploy_role_arn is set (Track B confused-deputy protection). Optional for Track A when
    account-factory deploy_role_external_id was configured on the factory role.
    Load from Lanyard secret store at customer-account-access external_id_parameter_name
    (default shape /lanyard/track-b/<tenant_slug>/deploy-external-id). NEVER commit the value.
  EOT
  default     = null
}

variable "deploy_role_session_name" {
  type        = string
  description = <<-EOT
    STS session name for assume_role. Null defaults to:
      customer_account → lanyard-track-b-<tenant_slug>
      lanyard_hosted   → lanyard-account-factory-<tenant_slug>
  EOT
  default     = null
}

variable "deploy_role_session_duration_seconds" {
  type        = number
  description = "Max STS session duration passed to assume_role (900–43200). Must not exceed the role MaxSessionDuration."
  default     = 3600

  validation {
    condition     = var.deploy_role_session_duration_seconds >= 900 && var.deploy_role_session_duration_seconds <= 43200
    error_message = "deploy_role_session_duration_seconds must be between 900 and 43200."
  }
}

variable "enable_deploy_role_session_tags" {
  type        = bool
  description = <<-EOT
    When true and deploy_role_arn is set, pass Project + TenantSlug session tags (and transitive
    tag keys) on assume_role. Matches customer-account-access enable_session_tags default.
    Set false if the target role trust does not allow sts:TagSession.
  EOT
  default     = true
}

variable "deploy_role_external_id_parameter_name" {
  type        = string
  description = <<-EOT
    Documentation / operator output only: Lanyard-side secret or SSM *name* where the ExternalId
    value is stored (not the secret value). From customer-account-access output
    external_id_parameter_name. Example shape: /lanyard/track-b/acme/deploy-external-id
  EOT
  default     = null
}

variable "state_backend_bucket" {
  type        = string
  description = <<-EOT
    Operator documentation of the remote state bucket name (from account-factory state_bucket_name
    or customer-owned bucket). Not applied by this template — copy into backend.tf from
    backend.tf.example / account-factory state_backend_config_template. Empty in git examples.
  EOT
  default     = null
}

variable "state_backend_dynamodb_table" {
  type        = string
  description = "Operator documentation of the Terraform lock table name (account-factory state_lock_table_name or customer-owned). Not applied here — backend.tf only."
  default     = null
}

variable "state_backend_key" {
  type        = string
  description = <<-EOT
    Operator documentation of the state object key (must be unique per tenant). Suggested:
      company-brain/<tenant_slug>/terraform.tfstate
    Not applied by this template — set in backend.tf.
  EOT
  default     = null
}

variable "artifact_cross_account_mode" {
  type        = string
  description = <<-EOT
    How the instance role reaches product artifacts (documentation + isolation_summary):
      - platform_bucket_grant — Lanyard product-artifact bucket policy grants GetObject to the
        instance role (Track B: customer-account-access platform_artifact_bucket_policy_statement_json)
      - customer_mirror      — customer (or per-tenant) bucket holds mirrored hermes/ + client-core/
      - https_pins           — HTTPS release URLs only (no S3 list on instance role)
      - same_account         — Track A same-account bucket read (default Lanyard-hosted)
    Does not mutate AWS; wire artifact_s3_* and pins accordingly.
  EOT
  default     = null

  validation {
    condition = (
      var.artifact_cross_account_mode == null
      || contains(["platform_bucket_grant", "customer_mirror", "https_pins", "same_account"], var.artifact_cross_account_mode)
    )
    error_message = "artifact_cross_account_mode must be platform_bucket_grant, customer_mirror, https_pins, or same_account."
  }
}

variable "dedicated_kms_key_arn" {
  type        = string
  description = <<-EOT
    Per-tenant KMS CMK ARN for EBS/snapshots (required when production_intent and lanyard_hosted).
    customer_account track: set when customer policy requires a documented CMK.
    Example shape only: arn:aws:kms:us-east-1:123456789012:key/00000000-0000-0000-0000-000000000000
  EOT
  default     = null

  validation {
    condition = var.dedicated_kms_key_arn == null || can(regex(
      "^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key/[0-9a-fA-F-]+$",
      var.dedicated_kms_key_arn
    ))
    error_message = "dedicated_kms_key_arn must be a full arn:aws:kms:region:account:key/id when set."
  }
}

variable "log_group_prefix" {
  type        = string
  description = "Per-tenant CloudWatch log group prefix (e.g. /company-brain/<tenant_slug>). Required when production_intent=true."
  default     = null

  validation {
    condition     = var.log_group_prefix == null || can(regex("^/[A-Za-z0-9][A-Za-z0-9/_-]{1,512}$", var.log_group_prefix))
    error_message = "log_group_prefix must start with / and use safe path characters when set."
  }
}

variable "instance_type" {
  type    = string
  default = "t3.medium"
}

variable "ssh_key_name" {
  type        = string
  description = "Optional EC2 key pair name. Null for SSM-only hosts (recommended production)."
  default     = null
}

variable "operator_ssh_cidrs" {
  type        = list(string)
  description = "SSH allow list (empty = no port 22; prefer SSM). Never 0.0.0.0/0."
  default     = []

  validation {
    condition     = alltrue([for cidr in var.operator_ssh_cidrs : cidr != "0.0.0.0/0"])
    error_message = "operator_ssh_cidrs must not include 0.0.0.0/0."
  }
}

variable "enable_ssm_access" {
  type        = bool
  description = "Attach SSM Session Manager permissions to the instance role (recommended true)."
  default     = true
}

variable "create_ssm_vpc_endpoints" {
  type        = bool
  description = "Create SSM PrivateLink endpoints (ssm, ssmmessages, ec2messages) for private subnets."
  default     = false
}

variable "ssm_vpc_endpoint_subnet_ids" {
  type        = list(string)
  description = "Subnets for SSM interface endpoints; empty uses subnet_id when set."
  default     = []
}

variable "enable_ssm_session_log_group" {
  type        = bool
  description = "Create CloudWatch log group for SSM session logging preferences."
  default     = false
}

variable "egress_mode" {
  type        = string
  description = "controlled | open | null (derive: production→controlled, lab→open)."
  default     = null

  validation {
    condition     = var.egress_mode == null || contains(["controlled", "open"], var.egress_mode)
    error_message = "egress_mode must be null, controlled, or open."
  }
}

variable "egress_https_cidrs" {
  type        = list(string)
  description = "TCP/443 destinations when egress_mode=controlled."
  default     = ["0.0.0.0/0"]
}

variable "egress_https_prefix_list_ids" {
  type        = list(string)
  description = "Optional prefix lists for TCP/443 when egress_mode=controlled."
  default     = []
}

variable "create_s3_gateway_endpoint" {
  type        = bool
  description = "S3 gateway VPC endpoint for private artifact fetch."
  default     = false
}

variable "s3_gateway_endpoint_route_table_ids" {
  type        = list(string)
  description = "Route tables for S3 gateway endpoint."
  default     = []
}

variable "create_aws_interface_endpoints" {
  type        = bool
  description = "Interface endpoints for logs, kms, sts."
  default     = false
}

variable "ami_id" {
  type        = string
  description = "Pinned golden/hardened AMI. Required for production by default."
  default     = null
}

variable "use_golden_ami" {
  type        = bool
  description = "Skip user_data dnf package sprawl (packages prebaked on AMI)."
  default     = false
}

variable "require_pinned_ami" {
  type        = bool
  description = "Require ami_id. Null defaults to true when network_mode=production."
  default     = null
}

# ---------------------------------------------------------------------------
# Artifact contract — pin URL + version + SHA-256 (no git clone)
# ---------------------------------------------------------------------------

variable "client_core_artifact_url" {
  type        = string
  description = "HTTPS or s3:// URL for the client-core release tarball."
  default     = "UNCONFIGURED"
}

variable "client_core_artifact_version" {
  type        = string
  description = "Pinned client-core artifact version (e.g. v0.1.0). Not a git branch."
  default     = "UNCONFIGURED"
}

variable "client_core_artifact_sha256" {
  type        = string
  description = "Expected SHA-256 hex digest of the client-core artifact."
  default     = "UNCONFIGURED"
}

variable "hermes_artifact_url" {
  type        = string
  description = "HTTPS or s3:// URL for the Hermes Lanyard runtime artifact."
  default     = "UNCONFIGURED"
}

variable "hermes_artifact_version" {
  type        = string
  description = "Pinned Hermes artifact version."
  default     = "UNCONFIGURED"
}

variable "hermes_artifact_sha256" {
  type        = string
  description = "Expected SHA-256 hex digest of the Hermes artifact."
  default     = "UNCONFIGURED"
}

variable "relay_contract_major" {
  type        = string
  description = "Major version of the Hermes relay connector contract (e.g. 1)."
  default     = "1"
}

variable "artifact_s3_bucket_arns" {
  type        = list(string)
  description = "S3 bucket ARNs the instance role may ListBucket for artifacts."
  default     = []
}

variable "artifact_s3_object_arns" {
  type        = list(string)
  description = <<-EOT
    Object/prefix ARNs for s3:GetObject (e.g. arn:aws:s3:::bucket/hermes/*).
    Empty + production: module auto-scopes hermes/* and client-core/*.
  EOT
  default     = []
}

variable "artifact_s3_list_prefixes" {
  type        = list(string)
  description = "ListBucket s3:prefix StringLike values (e.g. hermes/, client-core/)."
  default     = []
}

# ---------------------------------------------------------------------------
# Network placement (private production vs lab)
# ---------------------------------------------------------------------------

variable "network_mode" {
  type        = string
  description = "production (require private VPC/subnet, no public IP) or lab (non-prod default-VPC allowed)."
  default     = "production"

  validation {
    condition     = contains(["production", "lab"], var.network_mode)
    error_message = "network_mode must be production or lab."
  }
}

variable "vpc_id" {
  type        = string
  description = "VPC ID for the Hermes host. Required when network_mode=production."
  default     = null
}

variable "subnet_id" {
  type        = string
  description = "Subnet ID (private for production). Required when network_mode=production."
  default     = null
}

variable "associate_public_ip" {
  type        = bool
  description = "Associate a public IP. Must be false for production (module forces false)."
  default     = false
}

# ---------------------------------------------------------------------------
# EBS CMK / snapshot public-share block
# ---------------------------------------------------------------------------

variable "ebs_kms_key_id" {
  type        = string
  description = "Optional customer-managed KMS key ARN/id for root and data EBS. Strongly recommended for production."
  default     = null
}

variable "enable_ebs_snapshot_block_public_access" {
  type        = bool
  description = "Manage account/region Block Public Access for EBS snapshots."
  default     = true
}

variable "ebs_snapshot_block_public_access_state" {
  type        = string
  description = "block-all-sharing | block-new-sharing | unblocked"
  default     = "block-all-sharing"
}

variable "relay_wss_url" {
  type        = string
  description = "From control plane provision (shared or dedicated). Secure schemes only: https:// or wss://."

  validation {
    condition     = can(regex("^https://", var.relay_wss_url)) || can(regex("^wss://", var.relay_wss_url))
    error_message = "relay_wss_url must start with https:// or wss:// (http:// and ws:// are rejected)."
  }
}

variable "relay_instance_id" {
  type = string
}

variable "deployment_mode" {
  type        = string
  description = "production (default) requires SSM/Secrets Manager for relay secret; lab allows inline."
  default     = "production"

  validation {
    condition     = contains(["production", "lab"], var.deployment_mode)
    error_message = "deployment_mode must be production or lab."
  }
}

variable "relay_secret_source" {
  type        = string
  description = "ssm (production default), secretsmanager, or inline (lab only)."
  default     = "ssm"

  validation {
    condition     = contains(["ssm", "secretsmanager", "inline"], var.relay_secret_source)
    error_message = "relay_secret_source must be ssm, secretsmanager, or inline."
  }
}

variable "relay_secret_ssm_parameter_name" {
  type        = string
  description = "SSM SecureString name for the relay secret (production). Create outside Terraform."
  default     = ""
}

variable "relay_secret_ssm_parameter_arn" {
  type        = string
  description = "Optional full SSM parameter ARN for tight IAM scoping."
  default     = ""
}

variable "relay_secret_secretsmanager_secret_arn" {
  type        = string
  description = "Secrets Manager ARN when relay_secret_source=secretsmanager."
  default     = ""
}

variable "relay_instance_secret" {
  type        = string
  description = "Lab-only inline secret. Leave empty in production (store in SSM/SM instead)."
  default     = ""
  sensitive   = true
}

variable "attach_relay_secret_iam" {
  type        = bool
  description = "Attach instance-role policy for SSM/Secrets Manager Get* on the relay secret reference."
  default     = true
}

variable "email_provider" {
  type        = string
  description = <<-EOT
    Primary email integration: google or m365.
    Must match an approved email processor in approved_processor_ids when require_data_handling_policy is enforced
    (email-google or email-m365). See references/approved-data-processors.md.
  EOT
  default     = "google"

  validation {
    condition     = contains(["google", "m365"], var.email_provider)
    error_message = "email_provider must be google or m365."
  }
}

variable "enable_packs" {
  type        = list(string)
  description = <<-EOT
    Optional client-core packs to enable at bootstrap (gws, wacli, self-improve, focr, crm, granola, excel-author).
    Production: enable only packs covered by approved_processor_ids / the client data-handling policy
    (references/templates/client-data-handling-policy.md). self-improve defaults to deny for production vault workloads.
  EOT
  default     = []
}

# ---------------------------------------------------------------------------
# Approved data processors / per-client data-handling policy (cbd-zzx.13)
# Catalog: references/approved-data-processors.md
# Template: references/templates/client-data-handling-policy.md
# ---------------------------------------------------------------------------

variable "approved_processor_ids" {
  type        = list(string)
  description = <<-EOT
    Catalog IDs from references/approved-data-processors.md selected for this tenant
    (e.g. lanyard-portal-relay, aws-s3-artifacts, model-anthropic, email-google).
    Documentation + checklist contract; L7 domain enforcement is via Network Firewall/proxy
    (see controlled-egress runbook). Empty is allowed for pilots; production_intent tenants
    that set require_data_handling_policy=true must supply a non-empty list.
  EOT
  default     = []

  validation {
    condition = alltrue([
      for id in var.approved_processor_ids :
      can(regex("^[a-z][a-z0-9-]{1,63}$", id))
    ])
    error_message = "approved_processor_ids entries must be lowercase kebab-case catalog IDs (e.g. model-anthropic)."
  }
}

variable "data_handling_policy_ref" {
  type        = string
  description = <<-EOT
    Private reference to the filled client data-handling policy for this tenant
    (ticket ID, internal doc path, or URL). Do not embed vault content or secrets.
    Required when require_data_handling_policy=true with production_intent.
  EOT
  default     = null
}

variable "processor_egress_domains" {
  type        = list(string)
  description = <<-EOT
    Operator documentation of approved HTTPS/WSS FQDNs for this tenant (Network Firewall /
    egress proxy allowlist input). Not applied as SG rules by this template — map into
    account-level firewall policy. See references/runbooks/controlled-egress.md.
    Examples only in git: relay and model hostnames from private policy.
  EOT
  default     = []

  validation {
    condition = alltrue([
      for d in var.processor_egress_domains :
      can(regex("^[A-Za-z0-9][A-Za-z0-9.-]{0,253}$", d))
    ])
    error_message = "processor_egress_domains entries must look like hostnames (no URLs or paths)."
  }
}

variable "require_data_handling_policy" {
  type        = bool
  description = <<-EOT
    When true with production_intent=true, fail closed unless approved_processor_ids is
    non-empty and data_handling_policy_ref is set. Use for tenants that send vault-derived
    content off-box (models, email/CRM). Does not clear Portal G1/G2 security gates.
  EOT
  default     = false
}

variable "install_path" {
  type    = string
  default = "/opt/company-brain"
}

variable "hermes_install_path" {
  type    = string
  default = "/opt/hermes-lanyard"
}

# ---------------------------------------------------------------------------
# Security observability (cbd-zzx.12) — optional companion module + host flags
# ---------------------------------------------------------------------------

variable "enable_security_observability" {
  type        = bool
  description = "When true, create modules/security-observability (VPC Flow Logs, security SNS, GuardDuty findings bridge)."
  default     = false
}

variable "enable_vpc_flow_logs" {
  type        = bool
  description = "Enable VPC Flow Logs via security-observability (requires enable_security_observability and vpc_id)."
  default     = true
}

variable "enable_host_log_shipping" {
  type        = bool
  description = "Ship host auth/sudo/messages/hermes logs via CloudWatch agent (company-brain-ec2)."
  default     = false
}

variable "enable_ssm_managed_instance_core" {
  type        = bool
  description = "Attach AmazonSSMManagedInstanceCore for Session Manager (company-brain-ec2)."
  default     = false
}

variable "enable_cloudwatch_agent_iam" {
  type        = bool
  description = "Attach CloudWatchAgentServerPolicy (implied by enable_host_log_shipping)."
  default     = false
}

variable "security_alert_email_endpoints" {
  type        = list(string)
  description = "Optional SNS email endpoints for security alerts (private tfvars only; empty in git)."
  default     = []
}

variable "require_observability_checklist" {
  type        = bool
  description = <<-EOT
    When true with production_intent=true, fail closed unless enable_security_observability,
    enable_vpc_flow_logs, enable_host_log_shipping, and enable_ssm_managed_instance_core are set.
    Does not enable account-level CloudTrail/GuardDuty detectors (documented checklist only).
  EOT
  default     = false
}

# ---------------------------------------------------------------------------
# Snapshot-age / backup resilience (cbd-zzx.20) — additive; default off
# ---------------------------------------------------------------------------

variable "enable_snapshot_age_alarm" {
  type        = bool
  description = "Create CloudWatch alarm on CompanyBrain/Backup NewestSnapshotAgeHours (requires scheduled scripts/check-snapshot-age.sh --publish-metric)."
  default     = false
}

variable "snapshot_max_age_hours" {
  type        = number
  description = "Snapshot-age alarm threshold in hours (default 36 ≈ daily DLM + buffer)."
  default     = 36
}

variable "enable_snapshot_age_check_schedule" {
  type        = bool
  description = "Daily EventBridge SNS reminder to run check-snapshot-age.sh (requires enable_snapshot_age_alarm and security SNS)."
  default     = false
}

# ---------------------------------------------------------------------------
# Opt-in DLM DR snapshot copy / share (cbd-mta.7.4) — fail-closed defaults OFF
# See references/runbooks/dlm-restore-drill.md and tenant-isolation-decision.md
# ---------------------------------------------------------------------------

variable "enable_cross_region_copy" {
  type        = bool
  description = "Opt-in DLM cross-region snapshot copy (company-brain-ec2). Default false."
  default     = false
}

variable "destination_region" {
  type        = string
  description = "Destination region when enable_cross_region_copy=true. Null when disabled."
  default     = null
}

variable "cross_region_copy_cmk_arn" {
  type        = string
  description = "Optional destination-region CMK ARN for cross-region snapshot copies."
  default     = null
}

variable "enable_dr_account_share" {
  type        = bool
  description = "Opt-in DLM share of snapshots to a dedicated DR account. Default false. Never another tenant."
  default     = false
}

variable "dr_account_id" {
  type        = string
  description = "12-digit dedicated DR AWS account id when enable_dr_account_share=true (private tfvars only)."
  default     = null

  validation {
    condition     = var.dr_account_id == null || can(regex("^[0-9]{12}$", var.dr_account_id))
    error_message = "dr_account_id must be null or a 12-digit AWS account id."
  }
}

# ---------------------------------------------------------------------------
# Optional Tailscale secondary access (cbd-zzx.4) — default off
# Auth key in SSM/SM only; see references/runbooks/tailscale-operator-access.md
# ---------------------------------------------------------------------------

variable "enable_omnibox" {
  type        = bool
  description = <<-EOT
    Omnibox Mode A on the Hermes host (bubblewrap tool cage). Default false until
    staging validation. Does not replace hermes-gateway ExecStart; sets OMNIBOX_*
    env and bootstrap ensure-omnibox when true. See scripts/ensure-omnibox.sh.
  EOT
  default     = false
}

# ---------------------------------------------------------------------------
# Backend runtime secrets via AWS Secrets Manager (lp-645.4) — passthrough to
# company-brain-ec2. ARN reference only; never put API keys in tfvars.
# ---------------------------------------------------------------------------

variable "backend_runtime_secrets_arn" {
  type        = string
  description = <<-EOT
    Secrets Manager ARN for BackendRuntimeSecretsEnvelope (per-tenant). Empty disables.
    Never put secret values here — only the ARN.
  EOT
  default     = ""
}

variable "backend_runtime_secrets_enabled" {
  type        = bool
  description = "Null defaults to true when backend_runtime_secrets_arn is set. Passed to company-brain-ec2."
  default     = null
}

variable "backend_runtime_secrets_region" {
  type        = string
  description = "Optional SM region override; empty uses module region."
  default     = ""
}

variable "backend_model_provider" {
  type        = string
  description = "Non-secret default model provider id (e.g. openai, xai). Not an API key."
  default     = ""
}

variable "backend_model_default" {
  type        = string
  description = "Non-secret default model id. Not an API key."
  default     = ""
}

variable "enable_tailscale" {
  type        = bool
  description = "Optional Tailscale secondary mesh. Default false; SSM remains primary operator access."
  default     = false
}

variable "tailscale_auth_secret_source" {
  type        = string
  description = "ssm (default) or secretsmanager for Tailscale auth key fetch."
  default     = "ssm"

  validation {
    condition     = contains(["ssm", "secretsmanager"], var.tailscale_auth_secret_source)
    error_message = "tailscale_auth_secret_source must be ssm or secretsmanager."
  }
}

variable "tailscale_auth_secret_ssm_parameter" {
  type        = string
  description = "SSM SecureString name for Tailscale auth key (not the key value)."
  default     = ""
}

variable "tailscale_auth_secret_ssm_parameter_arn" {
  type        = string
  description = "Optional full SSM parameter ARN for tight IAM scoping."
  default     = ""
}

variable "tailscale_auth_secret_secretsmanager_arn" {
  type        = string
  description = "Secrets Manager ARN when tailscale_auth_secret_source=secretsmanager."
  default     = ""
}

variable "tailscale_tags" {
  type        = list(string)
  description = "Tailscale ACL tags; empty uses tag:tenant=<project_name>, tag:role=company-brain."
  default     = []
}

variable "tailscale_hostname" {
  type        = string
  description = "Tailscale device hostname; null uses <project_name>-hermes."
  default     = null
}

variable "tailscale_auto_enroll" {
  type        = bool
  description = "Run enrollment from user_data when enable_tailscale=true."
  default     = true
}

variable "tailscale_ssh" {
  type        = bool
  description = "Enable Tailscale SSH flag on enroll (prefer SSM for shell)."
  default     = false
}

variable "tailscale_extra_up_args" {
  type        = string
  description = "Optional extra tailscale up args (advanced)."
  default     = ""
}

variable "tailscale_allow_direct_udp" {
  type        = bool
  description = "Add controlled egress UDP/41641 for direct WireGuard (default false; DERP uses 443)."
  default     = false
}
