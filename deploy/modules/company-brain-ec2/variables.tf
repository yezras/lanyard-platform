variable "region" {
  description = "AWS region for the Company Brain Hermes EC2 host."
  type        = string
}

variable "project_name" {
  description = "Short name used for AWS resource names and tags (e.g. acme-brain)."
  type        = string
  default     = "company-brain"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$", var.project_name))
    error_message = "project_name must be 3–50 chars, lowercase alphanumeric and hyphens, start/end alphanumeric."
  }
}

variable "instance_type" {
  description = "EC2 instance type for the always-on Hermes runtime. t3.medium is MVP; size up for multi-user or local OCR."
  type        = string
  default     = "t3.medium"
}

variable "operator_ssh_cidrs" {
  description = <<-EOT
    CIDRs allowed to SSH (port 22). Empty list (default) means no SSH ingress rule — prefer SSM Session Manager.
    Production should leave empty; temporary break-glass SSH is MFA-controlled (see references/runbooks/ssm-break-glass.md).
    Never include 0.0.0.0/0. Use exact operator IPs (e.g. 203.0.113.10/32) only when break-glass is authorized.
  EOT
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for cidr in var.operator_ssh_cidrs : cidr != "0.0.0.0/0"])
    error_message = "operator_ssh_cidrs must not include 0.0.0.0/0."
  }
}

variable "ssh_key_name" {
  description = <<-EOT
    Optional EC2 key pair name. Null/empty launches without a key pair (SSM-only access).
    Required only when operator_ssh_cidrs is non-empty and operators will use SSH break-glass.
  EOT
  type        = string
  default     = null
}

variable "ami_id" {
  description = <<-EOT
    Pinned AMI for the Hermes host. Production requires a pinned (preferably golden/hardened) AMI by default.
    Lab may leave null to use latest Amazon Linux 2023. Set to a restored snapshot AMI to recover disk state.
  EOT
  type        = string
  default     = null
}

variable "use_golden_ami" {
  description = <<-EOT
    When true, user_data skips broad dnf package installs (assumes packages are prebaked on a golden AMI).
    Still writes artifact pins, injects bootstrap, and configures timezone/MOTD. Prefer true in production
    with a pinned ami_id (see references/runbooks/golden-ami-supply-chain.md).
  EOT
  type        = bool
  default     = false
}

variable "require_pinned_ami" {
  description = <<-EOT
    When true, fail plan/apply unless ami_id is set. Null defaults to true when network_mode=production,
    false when lab. Set false only for documented exceptions (not recommended for production tenants).
  EOT
  type        = bool
  default     = null
}

variable "root_volume_size_gb" {
  description = "Encrypted root EBS volume size in GiB (OS, Hermes install, optional seed)."
  type        = number
  default     = 40

  validation {
    condition     = var.root_volume_size_gb >= 30
    error_message = "root_volume_size_gb must be at least 30 GiB."
  }
}

variable "data_volume_size_gb" {
  description = "Optional second encrypted EBS volume for vault + beads + local DBs (GiB). Set 0 to skip (vault lives on root)."
  type        = number
  default     = 0

  validation {
    condition     = var.data_volume_size_gb == 0 || var.data_volume_size_gb >= 20
    error_message = "data_volume_size_gb must be 0 (disabled) or at least 20 GiB."
  }
}

variable "data_volume_device_name" {
  description = "Device name for the optional data volume (Amazon Linux 2023 NVMe may remap; mount via blkid in setup)."
  type        = string
  default     = "/dev/xvdf"
}

variable "install_path" {
  description = "Directory on the instance for the client-core seed (company brain vault root)."
  type        = string
  default     = "/opt/company-brain"
}

variable "vault_path" {
  description = "Directory for the live Obsidian / Company Brain vault (may equal install_path or a mount under /data)."
  type        = string
  default     = "/opt/company-brain"
}

variable "hermes_install_path" {
  description = "Directory for the Hermes runtime install (artifact extract target)."
  type        = string
  default     = "/opt/hermes-lanyard"
}

# ---------------------------------------------------------------------------
# Artifact contract (required for real deploys; placeholders fail in bootstrap)
# ---------------------------------------------------------------------------

variable "client_core_artifact_url" {
  description = "HTTPS or s3:// URL for the client-core release tarball. Placeholder values fail clearly in bootstrap. http:// is rejected."
  type        = string
  default     = "UNCONFIGURED"

  validation {
    condition = (
      var.client_core_artifact_url == "UNCONFIGURED"
      || var.client_core_artifact_url == "REPLACE_ME"
      || can(regex("^https://", var.client_core_artifact_url))
      || can(regex("^s3://", var.client_core_artifact_url))
    )
    error_message = "client_core_artifact_url must be UNCONFIGURED, https://…, or s3://… (http:// and other schemes are rejected)."
  }
}

variable "client_core_artifact_version" {
  description = "Pinned client-core artifact version string (e.g. v0.1.0). Not a git branch."
  type        = string
  default     = "UNCONFIGURED"
}

variable "client_core_artifact_sha256" {
  description = "Expected SHA-256 hex digest of the client-core artifact."
  type        = string
  default     = "UNCONFIGURED"
}

variable "hermes_artifact_url" {
  description = "HTTPS or s3:// URL for the Hermes Lanyard runtime artifact. http:// is rejected."
  type        = string
  default     = "UNCONFIGURED"

  validation {
    condition = (
      var.hermes_artifact_url == "UNCONFIGURED"
      || var.hermes_artifact_url == "REPLACE_ME"
      || can(regex("^https://", var.hermes_artifact_url))
      || can(regex("^s3://", var.hermes_artifact_url))
    )
    error_message = "hermes_artifact_url must be UNCONFIGURED, https://…, or s3://… (http:// and other schemes are rejected)."
  }
}

variable "hermes_artifact_version" {
  description = "Pinned Hermes artifact version string."
  type        = string
  default     = "UNCONFIGURED"
}

variable "hermes_artifact_sha256" {
  description = "Expected SHA-256 hex digest of the Hermes artifact."
  type        = string
  default     = "UNCONFIGURED"
}

variable "relay_contract_major" {
  description = "Major version of the Hermes relay connector contract this deployment targets (e.g. 1)."
  type        = string
  default     = "1"
}

variable "artifact_s3_bucket_arns" {
  description = <<-EOT
    Optional list of S3 bucket ARNs the instance role may ListBucket for artifacts (s3:// URLs).
    Empty skips S3 policy attachment. Prefer pairing with artifact_s3_object_arns / list prefixes.
    Product-artifact layout: hermes/ and client-core/ under the deploy-owned bucket.
  EOT
  type        = list(string)
  default     = []
}

variable "artifact_s3_object_arns" {
  description = <<-EOT
    Object or prefix ARNs for s3:GetObject (not unrestricted bucket/* when set).
    Examples (product-artifact layout):
      arn:aws:s3:::example-artifacts/hermes/*
      arn:aws:s3:::example-artifacts/client-core/*
      arn:aws:s3:::example-artifacts/hermes/v0.1.0/hermes-lanyard.tar.gz
    When empty and buckets are set: production auto-scopes to hermes/* + client-core/*;
    lab falls back to bucket/* (non-prod only — do not use in production).
  EOT
  type        = list(string)
  default     = []
}

variable "artifact_s3_list_prefixes" {
  description = <<-EOT
    Prefix values for ListBucket StringLike s3:prefix conditions.
    Examples: ["hermes/", "hermes/*", "client-core/", "client-core/*"].
    When empty and buckets are set: production defaults to hermes/ + client-core/;
    lab omits the prefix condition (broader list — non-prod only).
  EOT
  type        = list(string)
  default     = []
}

variable "bootstrap_script_b64" {
  description = <<-EOT
    Canonical bootstrap script body, base64gzip-encoded (Terraform base64gzip(file(...))).
    Tenant roots should pass monorepo deploy/scripts/bootstrap-host.sh, e.g.
      base64gzip(file("$${path.module}/../../scripts/bootstrap-host.sh"))
    from deploy/templates/tenant (resolves to deploy/scripts/bootstrap-host.sh).
    Empty allows standalone module validate; user_data installs a fail-closed stub instead.
    Prefer base64gzip over plain base64 so user_data stays under the EC2 16 KiB limit.
  EOT
  type        = string
  default     = ""

  validation {
    condition     = var.bootstrap_script_b64 == "" || can(regex("^[A-Za-z0-9+/]+=*$", var.bootstrap_script_b64))
    error_message = "bootstrap_script_b64 must be empty or standard base64 (A-Za-z0-9+/=)."
  }
}

variable "bootstrap_install_path" {
  description = "Stable on-host path for the injected bootstrap executable (root-owned)."
  type        = string
  default     = "/usr/local/sbin/company-brain-bootstrap"

  validation {
    condition     = can(regex("^/[A-Za-z0-9._/-]+$", var.bootstrap_install_path))
    error_message = "bootstrap_install_path must be an absolute Unix path."
  }
}

variable "create_instance_role" {
  description = "Create an IAM instance profile for artifact download (SSM optional ops). Set false if attaching an external role."
  type        = bool
  default     = true
}

variable "timezone" {
  description = "Timezone for the host (timedatectl)."
  type        = string
  default     = "UTC"
}

variable "snapshot_retention_count" {
  description = "Number of daily DLM snapshots to retain for volumes tagged Backup=daily."
  type        = number
  default     = 14

  validation {
    condition     = var.snapshot_retention_count >= 1 && var.snapshot_retention_count <= 100
    error_message = "snapshot_retention_count must be between 1 and 100."
  }
}

variable "enable_dlm" {
  description = "Create Data Lifecycle Manager daily EBS snapshot policy for Backup=daily volumes."
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------------
# Opt-in DR snapshot copy / share (cbd-mta.7.4) — fail-closed defaults OFF
# Policy: references/tenant-isolation-decision.md § Snapshot copy
# Ops:    references/runbooks/dlm-restore-drill.md
# ---------------------------------------------------------------------------

variable "enable_cross_region_copy" {
  description = <<-EOT
    When true (and enable_dlm=true), add a DLM schedule cross_region_copy_rule that copies
    daily snapshots to destination_region. Default false — primary backups stay same-region.
    Requires destination_region. Prefer a multi-Region CMK or set cross_region_copy_cmk_arn
    for the destination-region key. Does not change default RPO 24h / RTO 4h unless drilled.
  EOT
  type        = bool
  default     = false
}

variable "destination_region" {
  description = <<-EOT
    Destination AWS region for DLM cross-region snapshot copies when enable_cross_region_copy=true.
    Must differ from the primary module region. Null when copy is disabled (default).
    Example shape: us-west-2 (never invent live account-specific placement in git examples).
  EOT
  type        = string
  default     = null

  validation {
    condition = (
      var.destination_region == null
      || can(regex("^[a-z]{2}(-gov)?-[a-z]+-[0-9]+$", var.destination_region))
    )
    error_message = "destination_region must be null or an AWS region code (e.g. us-west-2)."
  }
}

variable "cross_region_copy_cmk_arn" {
  description = <<-EOT
    Optional KMS CMK ARN in the destination region for encrypting cross-region snapshot copies.
    Null uses the destination account/region default EBS key (still encrypted=true on the rule).
    When set, the DLM execution role also receives kms use on this ARN; key policy must trust DLM.
  EOT
  type        = string
  default     = null

  validation {
    condition = (
      var.cross_region_copy_cmk_arn == null
      || can(regex("^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key/[0-9a-fA-F-]+$", var.cross_region_copy_cmk_arn))
    )
    error_message = "cross_region_copy_cmk_arn must be null or a full arn:aws:kms:region:account:key/id."
  }
}

variable "cross_region_copy_retain_interval" {
  description = "Retention interval for cross-region snapshot copies (paired with cross_region_copy_retain_interval_unit)."
  type        = number
  default     = 14

  validation {
    condition     = var.cross_region_copy_retain_interval >= 1 && var.cross_region_copy_retain_interval <= 365
    error_message = "cross_region_copy_retain_interval must be between 1 and 365."
  }
}

variable "cross_region_copy_retain_interval_unit" {
  description = "Unit for cross-region copy retention. Valid: DAYS, WEEKS, MONTHS, YEARS."
  type        = string
  default     = "DAYS"

  validation {
    condition     = contains(["DAYS", "WEEKS", "MONTHS", "YEARS"], var.cross_region_copy_retain_interval_unit)
    error_message = "cross_region_copy_retain_interval_unit must be DAYS, WEEKS, MONTHS, or YEARS."
  }
}

variable "enable_dr_account_share" {
  description = <<-EOT
    When true (and enable_dlm=true), add a DLM schedule share_rule that shares daily snapshots
    with dr_account_id (dedicated DR account — not another tenant). Default false.
    Public sharing remains blocked via enable_ebs_snapshot_block_public_access.
    Cross-account encrypted share requires CMK grants for the DR account (ops-owned).
  EOT
  type        = bool
  default     = false
}

variable "dr_account_id" {
  description = <<-EOT
    Twelve-digit AWS account ID for dedicated DR snapshot share when enable_dr_account_share=true.
    Null when share is disabled (default). Never commit a live production DR account id in examples —
    use private tfvars only. Must not be another tenant's production account.
  EOT
  type        = string
  default     = null

  validation {
    condition     = var.dr_account_id == null || can(regex("^[0-9]{12}$", var.dr_account_id))
    error_message = "dr_account_id must be null or a 12-digit AWS account id."
  }
}

variable "dr_account_unshare_interval" {
  description = <<-EOT
    Optional automatic unshare interval after sharing with dr_account_id (DLM share_rule).
    Null (default) leaves shares until the snapshot is deleted by primary retention.
    When set, dr_account_unshare_interval_unit is required by AWS (module defaults unit to DAYS).
  EOT
  type        = number
  default     = null

  validation {
    condition = (
      var.dr_account_unshare_interval == null
      || try(var.dr_account_unshare_interval >= 1 && var.dr_account_unshare_interval <= 365, false)
    )
    error_message = "dr_account_unshare_interval must be null or between 1 and 365."
  }
}

variable "dr_account_unshare_interval_unit" {
  description = "Unit for automatic unshare when dr_account_unshare_interval is set. Valid: DAYS, WEEKS, MONTHS, YEARS."
  type        = string
  default     = "DAYS"

  validation {
    condition     = contains(["DAYS", "WEEKS", "MONTHS", "YEARS"], var.dr_account_unshare_interval_unit)
    error_message = "dr_account_unshare_interval_unit must be DAYS, WEEKS, MONTHS, or YEARS."
  }
}

variable "enable_status_alarm" {
  description = "Create CloudWatch alarm on EC2 StatusCheckFailed."
  type        = bool
  default     = true
}

variable "status_alarm_actions" {
  description = "SNS (or other) ARNs notified when the status-check alarm enters ALARM. Wire from modules/security-observability alarm_actions."
  type        = list(string)
  default     = []
}

variable "status_ok_actions" {
  description = "SNS (or other) ARNs notified when the status-check alarm returns to OK."
  type        = list(string)
  default     = []
}

# ---------------------------------------------------------------------------
# Snapshot-age / missing backup alarms (cbd-zzx.20)
# Custom metric CompanyBrain/Backup NewestSnapshotAgeHours is published by
# scripts/check-snapshot-age.sh (cron, EventBridge→Lambda, or SSM State Manager).
# ---------------------------------------------------------------------------

variable "enable_snapshot_age_alarm" {
  description = <<-EOT
    Create a CloudWatch alarm on custom metric CompanyBrain/Backup NewestSnapshotAgeHours
    (dimension Project=<project_name>). Operators must schedule scripts/check-snapshot-age.sh
    (or equivalent) with --publish-metric so the metric is populated.
    Wire alarm_actions from modules/security-observability (same SNS as status check).
  EOT
  type        = bool
  default     = false
}

variable "snapshot_max_age_hours" {
  description = "Alarm when newest completed DLM snapshot age exceeds this many hours (default 36 ≈ daily DLM + buffer)."
  type        = number
  default     = 36

  validation {
    condition     = var.snapshot_max_age_hours >= 12 && var.snapshot_max_age_hours <= 720
    error_message = "snapshot_max_age_hours must be between 12 and 720."
  }
}

variable "snapshot_age_alarm_actions" {
  description = "SNS (or other) ARNs when snapshot-age alarm enters ALARM. Prefer modules/security-observability alarm_actions."
  type        = list(string)
  default     = []
}

variable "snapshot_age_ok_actions" {
  description = "SNS (or other) ARNs when snapshot-age alarm returns to OK."
  type        = list(string)
  default     = []
}

variable "enable_snapshot_age_check_schedule" {
  description = <<-EOT
    When true (and enable_snapshot_age_alarm with at least one snapshot_age_alarm_actions ARN),
    create a daily EventBridge rule that publishes an operator reminder to SNS to run
    scripts/check-snapshot-age.sh --publish-metric. Does not invent a Lambda runtime —
    prefer ops Lambda/SSM association later; this rule is the installable reminder contract.
  EOT
  type        = bool
  default     = false
}

variable "snapshot_age_check_schedule_expression" {
  description = "EventBridge schedule expression for the snapshot-age check reminder (default rate(1 day))."
  type        = string
  default     = "rate(1 day)"
}

# ---------------------------------------------------------------------------
# Host observability / SSM (cbd-zzx.12) — additive; default off to avoid
# conflicting with concurrent SSM/egress work. Enable for production tenants.
# ---------------------------------------------------------------------------

variable "enable_ssm_managed_instance_core" {
  description = <<-EOT
    Attach AmazonSSMManagedInstanceCore to the instance role (Session Manager, inventory).
    Default false (additive). Production tenants should enable for break-glass without SSH.
    Requires SSM agent (preinstalled on AL2023) and outbound SSM endpoints / VPC endpoints.
  EOT
  type        = bool
  default     = false
}

variable "enable_cloudwatch_agent_iam" {
  description = <<-EOT
    Attach CloudWatchAgentServerPolicy to the instance role so the agent can create log streams
    and put metrics. Implied when enable_host_log_shipping=true if create_instance_role=true.
  EOT
  type        = bool
  default     = false
}

variable "enable_host_log_shipping" {
  description = <<-EOT
    Install/configure Amazon CloudWatch Agent via user_data to ship journald (auth/sudo),
    secure log, and Hermes/company-brain paths to a per-tenant log group.
    Default false. Production recommended with enable_cloudwatch_agent_iam or auto-attach.
  EOT
  type        = bool
  default     = false
}

variable "host_log_group_name" {
  description = "CloudWatch log group for host logs. Default: /company-brain/<project_name>/host."
  type        = string
  default     = null
}

variable "host_log_retention_days" {
  description = "Retention for the host log group when create_host_log_group=true."
  type        = number
  default     = 30

  validation {
    condition = contains(
      [1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653],
      var.host_log_retention_days
    )
    error_message = "host_log_retention_days must be a valid CloudWatch Logs retention value."
  }
}

variable "create_host_log_group" {
  description = "Create the host CloudWatch log group when enable_host_log_shipping=true. Set false if the group is managed outside this module."
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------------
# Network placement (cbd-zzx.1)
# ---------------------------------------------------------------------------

variable "network_mode" {
  description = <<-EOT
    Network posture for the Hermes host:
      - production: require explicit vpc_id + private subnet_id; force associate_public_ip=false;
        never use default-VPC lookup.
      - lab: non-production only — optional default-VPC fallback and public IP for quick lab bring-up.
    Public defaults are lab-only; production tenants must place the host in a private subnet
    (NAT or other egress as needed for artifact fetch and portal relay WSS).
  EOT
  type        = string
  default     = "lab"

  validation {
    condition     = contains(["production", "lab"], var.network_mode)
    error_message = "network_mode must be \"production\" or \"lab\"."
  }
}

variable "subnet_id" {
  description = "Subnet ID for the Hermes instance. Required when network_mode=production (private subnet). Lab may leave null to use default-VPC subnet selection."
  type        = string
  default     = null
}

variable "vpc_id" {
  description = "VPC ID for the security group. Required when network_mode=production. Lab may leave null to use the account default VPC (non-prod only)."
  type        = string
  default     = null
}

variable "associate_public_ip" {
  description = "Associate a public IP. Forced false when network_mode=production. Lab may set true for bootstrap without NAT (non-prod only)."
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------------
# SSM Session Manager access (cbd-zzx.2)
# ---------------------------------------------------------------------------

variable "enable_ssm_access" {
  description = <<-EOT
    Attach AmazonSSMManagedInstanceCore to the instance role so operators can use SSM Session Manager
    without public SSH. Recommended true for production private subnets.
  EOT
  type        = bool
  default     = true
}

variable "create_ssm_vpc_endpoints" {
  description = <<-EOT
    Create interface VPC endpoints for ssm, ssmmessages, and ec2messages (PrivateLink) so Session Manager
    works without public internet or NAT. Requires vpc_id (or lab default VPC) and at least one subnet
    (subnet_id or ssm_vpc_endpoint_subnet_ids).
  EOT
  type        = bool
  default     = false
}

variable "ssm_vpc_endpoint_subnet_ids" {
  description = "Subnets for SSM interface endpoints. When empty and create_ssm_vpc_endpoints=true, uses [subnet_id] if set."
  type        = list(string)
  default     = []
}

variable "enable_ssm_session_log_group" {
  description = <<-EOT
    Create a CloudWatch Logs group for Session Manager session logs. Operators must also configure
    Session Manager preferences (SSM-SessionManagerRunShell) to write to this group — see
    references/runbooks/ssm-break-glass.md.
  EOT
  type        = bool
  default     = false
}

variable "ssm_session_logs_cloudwatch_log_group" {
  description = "CloudWatch log group name for SSM sessions when enable_ssm_session_log_group=true. Null uses /company-brain/<project_name>/ssm-sessions."
  type        = string
  default     = null
}

variable "ssm_session_logs_retention_days" {
  description = "Retention days for the optional SSM session log group."
  type        = number
  default     = 90

  validation {
    condition     = var.ssm_session_logs_retention_days >= 1 && var.ssm_session_logs_retention_days <= 3653
    error_message = "ssm_session_logs_retention_days must be between 1 and 3653."
  }
}

variable "ssm_session_logs_s3_bucket_name" {
  description = <<-EOT
    Optional S3 bucket name for Session Manager session logging preference (documented for operators;
    bucket must exist and trust the SSM logging role). Null skips S3 preference documentation output only.
  EOT
  type        = string
  default     = null
}

# ---------------------------------------------------------------------------
# Controlled egress (cbd-zzx.3)
# ---------------------------------------------------------------------------

variable "egress_mode" {
  description = <<-EOT
    Security group egress posture:
      - controlled: port-restricted egress (HTTPS/DNS/NTP + extra rules); production default.
        Never opens protocol=-1 to 0.0.0.0/0.
      - open: all protocols to 0.0.0.0/0 — lab/non-prod only; rejected when network_mode=production.
    Null derives from network_mode (production→controlled, lab→open).
  EOT
  type        = string
  default     = null

  validation {
    condition     = var.egress_mode == null || contains(["controlled", "open"], var.egress_mode)
    error_message = "egress_mode must be null, \"controlled\", or \"open\"."
  }
}

variable "egress_https_cidrs" {
  description = <<-EOT
    Destination CIDRs for TCP/443 (HTTPS and WSS) when egress_mode=controlled.
    Default 0.0.0.0/0 allows SaaS models/relay while still denying non-443 protocols.
    Tighten to known prefixes or use egress_https_prefix_list_ids + Network Firewall for host-level allowlists
    (see references/runbooks/controlled-egress.md). Empty with empty prefix lists omits the 443 rule.
  EOT
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "egress_https_prefix_list_ids" {
  description = "Optional managed/customer prefix list IDs for TCP/443 destinations (egress_mode=controlled)."
  type        = list(string)
  default     = []
}

variable "egress_dns_cidrs" {
  description = "Destination CIDRs for DNS (TCP/UDP 53) when egress_mode=controlled. Empty omits DNS rules."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "egress_ntp_cidrs" {
  description = "Destination CIDRs for NTP (UDP 123) when egress_mode=controlled. Empty omits NTP rule."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "extra_egress_rules" {
  description = <<-EOT
    Additional egress rules when egress_mode=controlled (e.g. corporate proxy port, specific tool ports).
    Each rule needs cidr_blocks and/or prefix_list_ids.
  EOT
  type = list(object({
    description     = string
    from_port       = number
    to_port         = number
    protocol        = string
    cidr_blocks     = optional(list(string), [])
    prefix_list_ids = optional(list(string), [])
  }))
  default = []
}

variable "create_s3_gateway_endpoint" {
  description = <<-EOT
    Create an S3 gateway VPC endpoint so s3:// artifact fetch stays on the AWS network.
    Requires vpc_id and s3_gateway_endpoint_route_table_ids (private subnet route tables).
  EOT
  type        = bool
  default     = false
}

variable "s3_gateway_endpoint_route_table_ids" {
  description = "Route table IDs associated with the S3 gateway endpoint (typically private subnet RTs)."
  type        = list(string)
  default     = []
}

variable "create_aws_interface_endpoints" {
  description = <<-EOT
    Create interface VPC endpoints for logs, kms, and sts (in addition to optional SSM endpoints).
    Reduces need for NAT for common AWS API calls. Requires vpc_id and endpoint subnets.
  EOT
  type        = bool
  default     = false
}

variable "aws_interface_endpoint_subnet_ids" {
  description = "Subnets for logs/kms/sts interface endpoints. Falls back to ssm_vpc_endpoint_subnet_ids or [subnet_id]."
  type        = list(string)
  default     = []
}

# ---------------------------------------------------------------------------
# EBS encryption / KMS / snapshot public-share block (cbd-zzx.5)
# ---------------------------------------------------------------------------

variable "ebs_kms_key_id" {
  description = <<-EOT
    Optional customer-managed KMS key ID or ARN for root and data EBS volumes.
    Null uses the AWS-managed EBS encryption key for the region.
    Strongly recommended for production (tenant/customer CMK, least-privilege key policy for
    EC2, DLM role, and operators — never Principal "*" in examples).
    DLM volume snapshots inherit the source volume's CMK encryption automatically.
  EOT
  type        = string
  default     = null
}

variable "enable_ebs_snapshot_block_public_access" {
  description = <<-EOT
    When true, manage account/region Block Public Access for EBS snapshots
    (aws_ebs_snapshot_block_public_access). Recommended for production.
    Removing this resource later can re-open public sharing — review before destroy.
  EOT
  type        = bool
  default     = true
}

variable "ebs_snapshot_block_public_access_state" {
  description = "State for EBS snapshot block public access: block-all-sharing, block-new-sharing, or unblocked."
  type        = string
  default     = "block-all-sharing"

  validation {
    condition = contains(
      ["block-all-sharing", "block-new-sharing", "unblocked"],
      var.ebs_snapshot_block_public_access_state
    )
    error_message = "ebs_snapshot_block_public_access_state must be block-all-sharing, block-new-sharing, or unblocked."
  }
}

# ---------------------------------------------------------------------------
# Optional Tailscale secondary access (cbd-zzx.4) — default off
# Auth key never in tfvars/user_data plaintext; fetch at runtime from SSM/SM.
# Primary operator path remains SSM Session Manager; public SSH stays closed.
# ---------------------------------------------------------------------------

variable "enable_tailscale" {
  description = <<-EOT
    When true, user_data installs company-brain-tailscale-enroll, writes non-secret
    Tailscale config under /etc/company-brain/tailscale.env, attaches IAM to read the
    one-time auth key from SSM/Secrets Manager, and optionally auto-enrolls on first boot.
    Default false — production private path works without Tailscale.
    See references/runbooks/tailscale-operator-access.md.
  EOT
  type        = bool
  default     = false
}

variable "tailscale_auth_secret_source" {
  description = <<-EOT
    Where the instance fetches the Tailscale auth key at runtime:
      - ssm            — SSM Parameter Store SecureString (production default)
      - secretsmanager — AWS Secrets Manager
    Never put the auth key value in Terraform variables or user_data.
  EOT
  type        = string
  default     = "ssm"

  validation {
    condition     = contains(["ssm", "secretsmanager"], var.tailscale_auth_secret_source)
    error_message = "tailscale_auth_secret_source must be ssm or secretsmanager."
  }
}

variable "tailscale_auth_secret_ssm_parameter" {
  description = <<-EOT
    SSM SecureString parameter name holding a Tailscale auth key (one-time / short-lived
    preferred). Example: /company-brain/<project>/tailscale-auth-key
    Required when enable_tailscale=true and tailscale_auth_secret_source=ssm.
  EOT
  type        = string
  default     = ""
}

variable "tailscale_auth_secret_ssm_parameter_arn" {
  description = "Optional full SSM parameter ARN for tight IAM scoping. When empty, name-based ARN pattern is used."
  type        = string
  default     = ""
}

variable "tailscale_auth_secret_secretsmanager_arn" {
  description = <<-EOT
    Secrets Manager secret ARN for the Tailscale auth key (raw string or JSON with authkey).
    Required when enable_tailscale=true and tailscale_auth_secret_source=secretsmanager.
  EOT
  type        = string
  default     = ""
}

variable "tailscale_tags" {
  description = <<-EOT
    Tailscale ACL tags advertised at enrollment (without forcing operator policy).
    Empty (default) uses tag:tenant=<project_name> and tag:role=company-brain.
    Production tailnets must grant only these tags and default-deny cross-tenant paths
    (see references/runbooks/tailscale-operator-access.md).
  EOT
  type        = list(string)
  default     = []
}

variable "tailscale_hostname" {
  description = "Tailscale device hostname. Null uses <project_name>-hermes."
  type        = string
  default     = null
}

variable "tailscale_auto_enroll" {
  description = <<-EOT
    When enable_tailscale=true, run enrollment at end of user_data (fetch key via instance role).
    Set false to only install the enroll helper; operators run it manually over SSM.
  EOT
  type        = bool
  default     = true
}

variable "tailscale_ssh" {
  description = "Pass --ssh to tailscale up (Tailscale SSH). Default false; prefer SSM for shell access."
  type        = bool
  default     = false
}

variable "tailscale_extra_up_args" {
  description = "Optional extra arguments appended to tailscale up (advanced; space-separated string)."
  type        = string
  default     = ""
}

variable "tailscale_allow_direct_udp" {
  description = <<-EOT
    When true and egress_mode=controlled, add security-group egress UDP/41641 (Tailscale direct
    WireGuard). Default false — DERP relay over TCP/443 works with existing HTTPS egress.
    See controlled-egress runbook Tailscale section for tradeoffs.
  EOT
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# Omnibox Mode A (cbd-o9s.10) — default off until staging validation (phase 9)
# Wraps agent tool children via bubblewrap; does NOT replace hermes-gateway ExecStart.
# ---------------------------------------------------------------------------

variable "enable_omnibox" {
  description = <<-EOT
    When true, user_data seeds OMNIBOX_* env for hermes-gateway and bootstrap calls
    ensure-omnibox after Hermes profiles (Mode A / bwrap_inrepo).
    Default false — keep off until phase-9 staging pass; gateway ExecStart stays Hermes.
    See references/plans/omnibox-hermes-mode-a/ and scripts/ensure-omnibox.sh.
  EOT
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# Backend runtime secrets via AWS Secrets Manager (lp-645.4 / plan 0002 phase 3)
# ARN reference only — never put secret values (API keys) in Terraform variables.
# ---------------------------------------------------------------------------

variable "backend_runtime_secrets_arn" {
  description = <<-EOT
    AWS Secrets Manager secret ARN holding a BackendRuntimeSecretsEnvelope JSON
    SecretString (see contracts/backend-runtime-v1/secrets-envelope.schema.json).
    Empty (default) disables IAM + materialize wiring (lab-friendly).
    Production intent: set a per-tenant secret ARN. Never put secret values here.
  EOT
  type        = string
  default     = ""

  validation {
    condition = (
      trimspace(var.backend_runtime_secrets_arn) == ""
      || can(regex("^arn:aws:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:.+$", trimspace(var.backend_runtime_secrets_arn)))
    )
    error_message = "backend_runtime_secrets_arn must be empty or a full arn:aws:secretsmanager:region:account:secret:name-suffix ARN (not a secret value)."
  }
}

variable "backend_runtime_secrets_enabled" {
  description = <<-EOT
    When true, wire instance-role GetSecretValue + host materialize for the ARN.
    Null (default) enables automatically when backend_runtime_secrets_arn is non-empty.
    Set false to leave an ARN documented in tfvars without attaching IAM/hooks.
  EOT
  type        = bool
  default     = null
}

variable "backend_model_provider" {
  description = <<-EOT
    Non-secret default model provider id (e.g. openai, xai, anthropic).
    Seeded into host public config when missing — not a secret; never put API keys here.
  EOT
  type        = string
  default     = ""
}

variable "backend_model_default" {
  description = <<-EOT
    Non-secret default model id (e.g. gpt-4o, grok-3).
    Seeded into host public config when missing — not a secret.
  EOT
  type        = string
  default     = ""
}

variable "backend_runtime_secrets_region" {
  description = <<-EOT
    Optional AWS region for secretsmanager:GetSecretValue / materialize.
    Empty (default) uses the module region variable.
  EOT
  type        = string
  default     = ""

  validation {
    condition = (
      trimspace(var.backend_runtime_secrets_region) == ""
      || can(regex("^[a-z]{2}(-gov)?-[a-z]+-[0-9]+$", trimspace(var.backend_runtime_secrets_region)))
    )
    error_message = "backend_runtime_secrets_region must be empty or an AWS region code (e.g. us-east-1)."
  }
}

variable "extra_tags" {
  description = "Additional tags applied to all taggable resources."
  type        = map(string)
  default     = {}
}
