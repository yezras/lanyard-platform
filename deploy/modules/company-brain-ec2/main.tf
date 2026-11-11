locals {
  common_tags = merge(
    {
      Name    = "${var.project_name}-hermes"
      Project = var.project_name
      Role    = "company-brain"
    },
    var.extra_tags,
  )

  volume_backup_tags = merge(
    {
      Name    = "${var.project_name}-hermes-root"
      Project = var.project_name
      Backup  = "daily"
      Role    = "company-brain"
    },
    var.extra_tags,
  )

  # Production never associates a public IP; lab honors the operator toggle.
  associate_public_ip = var.network_mode == "production" ? false : var.associate_public_ip

  # Product-artifact layout defaults (modules/product-artifact-infra): hermes/, client-core/
  default_production_object_arns = flatten([
    for arn in var.artifact_s3_bucket_arns : [
      "${arn}/hermes/*",
      "${arn}/client-core/*",
    ]
  ])

  default_production_list_prefixes = [
    "hermes/",
    "hermes/*",
    "client-core/",
    "client-core/*",
  ]

  # GetObject resources: explicit pins win; production auto-scopes; lab may use bucket/* (non-prod).
  artifact_get_object_arns = (
    length(var.artifact_s3_object_arns) > 0
    ? var.artifact_s3_object_arns
    : (
      var.network_mode == "production"
      ? local.default_production_object_arns
      : [for arn in var.artifact_s3_bucket_arns : "${arn}/*"]
    )
  )

  # ListBucket prefix conditions: explicit win; production defaults to hermes/ + client-core/;
  # lab with empty list_prefixes omits the condition (broader — non-prod only).
  artifact_list_prefixes = (
    length(var.artifact_s3_list_prefixes) > 0
    ? var.artifact_s3_list_prefixes
    : (
      var.network_mode == "production" && length(var.artifact_s3_bucket_arns) > 0
      ? local.default_production_list_prefixes
      : []
    )
  )

  create_artifact_read_policy = (
    var.create_instance_role
    && length(var.artifact_s3_bucket_arns) > 0
    && length(local.artifact_get_object_arns) > 0
  )

  # Egress: production never defaults to unrestricted all-protocol open egress.
  egress_mode = coalesce(
    var.egress_mode,
    var.network_mode == "production" ? "controlled" : "open"
  )

  require_pinned_ami = coalesce(var.require_pinned_ami, var.network_mode == "production")

  ssh_key_name_effective = (
    var.ssh_key_name != null && var.ssh_key_name != ""
    ? var.ssh_key_name
    : null
  )

  create_ssh_ingress = length(var.operator_ssh_cidrs) > 0

  ssm_endpoint_subnet_ids = (
    length(var.ssm_vpc_endpoint_subnet_ids) > 0
    ? var.ssm_vpc_endpoint_subnet_ids
    : (
      var.subnet_id != null && var.subnet_id != ""
      ? [var.subnet_id]
      : []
    )
  )

  aws_interface_endpoint_subnet_ids = (
    length(var.aws_interface_endpoint_subnet_ids) > 0
    ? var.aws_interface_endpoint_subnet_ids
    : local.ssm_endpoint_subnet_ids
  )

  create_ssm_vpc_endpoints = (
    var.create_ssm_vpc_endpoints
    && length(local.ssm_endpoint_subnet_ids) > 0
  )

  create_aws_interface_endpoints = (
    var.create_aws_interface_endpoints
    && length(local.aws_interface_endpoint_subnet_ids) > 0
  )

  create_s3_gateway_endpoint = (
    var.create_s3_gateway_endpoint
    && length(var.s3_gateway_endpoint_route_table_ids) > 0
  )

  controlled_https_enabled = (
    local.egress_mode == "controlled"
    && (length(var.egress_https_cidrs) > 0 || length(var.egress_https_prefix_list_ids) > 0)
  )

  controlled_dns_enabled = (
    local.egress_mode == "controlled"
    && length(var.egress_dns_cidrs) > 0
  )

  controlled_ntp_enabled = (
    local.egress_mode == "controlled"
    && length(var.egress_ntp_cidrs) > 0
  )

  host_log_group_name = coalesce(var.host_log_group_name, "/company-brain/${var.project_name}/host")

  attach_cloudwatch_agent_iam = (
    var.create_instance_role
    && (var.enable_cloudwatch_agent_iam || var.enable_host_log_shipping)
  )

  # Prefer enable_ssm_access (cbd-zzx.2); also honor enable_ssm_managed_instance_core.
  attach_ssm_core = (
    var.create_instance_role
    && (var.enable_ssm_access || var.enable_ssm_managed_instance_core)
  )

  create_host_log_group = (
    var.enable_host_log_shipping
    && var.create_host_log_group
  )

  # Optional Tailscale (cbd-zzx.4) — secondary mesh; secret refs only (never key material).
  tailscale_tags = length(var.tailscale_tags) > 0 ? var.tailscale_tags : [
    "tag:tenant=${var.project_name}",
    "tag:role=company-brain",
  ]
  tailscale_hostname = coalesce(var.tailscale_hostname, "${var.project_name}-hermes")
  tailscale_tags_csv = join(",", local.tailscale_tags)

  tailscale_ssm_parameter_name = trimspace(var.tailscale_auth_secret_ssm_parameter)
  tailscale_sm_secret_arn      = trimspace(var.tailscale_auth_secret_secretsmanager_arn)
  tailscale_ssm_parameter_arn = trimspace(var.tailscale_auth_secret_ssm_parameter_arn) != "" ? trimspace(var.tailscale_auth_secret_ssm_parameter_arn) : (
    local.tailscale_ssm_parameter_name != "" ? "arn:aws:ssm:*:*:parameter${startswith(local.tailscale_ssm_parameter_name, "/") ? "" : "/"}${local.tailscale_ssm_parameter_name}" : ""
  )

  tailscale_auth_is_ssm = var.tailscale_auth_secret_source == "ssm"
  tailscale_auth_is_sm  = var.tailscale_auth_secret_source == "secretsmanager"

  attach_tailscale_secret_iam = (
    var.enable_tailscale
    && var.create_instance_role
  )

  # Direct WireGuard peer path (optional); DERP uses TCP 443 already allowed in controlled mode.
  controlled_tailscale_udp_enabled = (
    local.egress_mode == "controlled"
    && var.enable_tailscale
    && var.tailscale_allow_direct_udp
  )

  # Backend runtime secrets (lp-645.4) — ARN reference only; values stay in SM.
  backend_runtime_secrets_arn = trimspace(var.backend_runtime_secrets_arn)
  backend_runtime_secrets_enabled = coalesce(
    var.backend_runtime_secrets_enabled,
    local.backend_runtime_secrets_arn != "",
  )
  backend_runtime_secrets_active = (
    local.backend_runtime_secrets_enabled
    && local.backend_runtime_secrets_arn != ""
  )
  backend_runtime_secrets_region = (
    trimspace(var.backend_runtime_secrets_region) != ""
    ? trimspace(var.backend_runtime_secrets_region)
    : var.region
  )
  attach_backend_runtime_secrets_iam = (
    local.backend_runtime_secrets_active
    && var.create_instance_role
  )
  backend_model_provider = trimspace(var.backend_model_provider)
  backend_model_default  = trimspace(var.backend_model_default)
}

data "aws_ami" "amazon_linux_2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-kernel-*-x86_64"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# Default-VPC lookup is lab-only. Production requires explicit vpc_id (no silent public default).
data "aws_vpc" "selected" {
  count   = var.network_mode == "lab" && var.vpc_id == null ? 1 : 0
  default = true
}

locals {
  vpc_id = var.vpc_id != null ? var.vpc_id : try(data.aws_vpc.selected[0].id, null)
}

resource "aws_security_group" "hermes" {
  name        = "${var.project_name}-hermes"
  description = "Company Brain Hermes host: SSM-first access; optional SSH break-glass; controlled egress in production; portal chat is egress-only WSS"
  vpc_id      = local.vpc_id

  # SSH is optional. Empty operator_ssh_cidrs → no port 22 ingress (SSM Session Manager preferred).
  dynamic "ingress" {
    for_each = local.create_ssh_ingress ? [1] : []
    content {
      description = "SSH break-glass from authorized operator CIDRs (prefer SSM; MFA-controlled process)"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = var.operator_ssh_cidrs
    }
  }

  # Lab / explicit open: unrestricted egress (non-production only — rejected when network_mode=production).
  dynamic "egress" {
    for_each = local.egress_mode == "open" ? [1] : []
    content {
      description = "Lab/open egress all protocols (non-production only)"
      from_port   = 0
      to_port     = 0
      protocol    = "-1"
      cidr_blocks = ["0.0.0.0/0"]
    }
  }

  # Production default: port-restricted controlled egress (never protocol=-1 to 0.0.0.0/0).
  dynamic "egress" {
    for_each = local.controlled_https_enabled ? [1] : []
    content {
      description     = "HTTPS/WSS for artifacts, models, portal relay, approved package mirrors"
      from_port       = 443
      to_port         = 443
      protocol        = "tcp"
      cidr_blocks     = length(var.egress_https_cidrs) > 0 ? var.egress_https_cidrs : null
      prefix_list_ids = length(var.egress_https_prefix_list_ids) > 0 ? var.egress_https_prefix_list_ids : null
    }
  }

  dynamic "egress" {
    for_each = local.controlled_dns_enabled ? [1] : []
    content {
      description = "DNS (UDP)"
      from_port   = 53
      to_port     = 53
      protocol    = "udp"
      cidr_blocks = var.egress_dns_cidrs
    }
  }

  dynamic "egress" {
    for_each = local.controlled_dns_enabled ? [1] : []
    content {
      description = "DNS (TCP)"
      from_port   = 53
      to_port     = 53
      protocol    = "tcp"
      cidr_blocks = var.egress_dns_cidrs
    }
  }

  dynamic "egress" {
    for_each = local.controlled_ntp_enabled ? [1] : []
    content {
      description = "NTP"
      from_port   = 123
      to_port     = 123
      protocol    = "udp"
      cidr_blocks = var.egress_ntp_cidrs
    }
  }

  dynamic "egress" {
    for_each = local.egress_mode == "controlled" ? var.extra_egress_rules : []
    content {
      description     = egress.value.description
      from_port       = egress.value.from_port
      to_port         = egress.value.to_port
      protocol        = egress.value.protocol
      cidr_blocks     = length(egress.value.cidr_blocks) > 0 ? egress.value.cidr_blocks : null
      prefix_list_ids = length(egress.value.prefix_list_ids) > 0 ? egress.value.prefix_list_ids : null
    }
  }

  # Optional Tailscale direct WireGuard (UDP 41641). Default off — DERP over TCP/443 works
  # with controlled HTTPS egress. See references/runbooks/tailscale-operator-access.md.
  dynamic "egress" {
    for_each = local.controlled_tailscale_udp_enabled ? [1] : []
    content {
      description = "Tailscale direct WireGuard (optional; prefer DERP over 443 when locked down)"
      from_port   = 41641
      to_port     = 41641
      protocol    = "udp"
      cidr_blocks = ["0.0.0.0/0"]
    }
  }

  tags = local.common_tags

  lifecycle {
    precondition {
      condition     = var.network_mode != "production" || (var.vpc_id != null && var.vpc_id != "")
      error_message = "network_mode=production requires explicit vpc_id (default VPC is lab-only)."
    }
    precondition {
      condition     = local.vpc_id != null && local.vpc_id != ""
      error_message = "vpc_id could not be resolved. Set vpc_id, or use network_mode=lab for default-VPC fallback."
    }
    precondition {
      condition     = var.network_mode != "production" || local.egress_mode != "open"
      error_message = "network_mode=production forbids egress_mode=open (unrestricted all-protocol egress). Use controlled egress or leave egress_mode null."
    }
    precondition {
      condition = (
        local.egress_mode != "controlled"
        || local.controlled_https_enabled
        || local.controlled_dns_enabled
        || local.controlled_ntp_enabled
        || length(var.extra_egress_rules) > 0
        || local.create_s3_gateway_endpoint
        || local.create_ssm_vpc_endpoints
        || local.create_aws_interface_endpoints
      )
      error_message = "egress_mode=controlled requires at least one egress path (HTTPS/DNS/NTP/extra rules or VPC endpoints)."
    }
  }
}

# ---------------------------------------------------------------------------
# Instance role — artifact download via instance credentials (no long-lived keys)
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "ec2_assume" {
  count = var.create_instance_role ? 1 : 0

  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "instance" {
  count = var.create_instance_role ? 1 : 0

  name               = "${var.project_name}-hermes-instance"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume[0].json
  tags               = merge(local.common_tags, { Name = "${var.project_name}-hermes-instance" })
}

data "aws_iam_policy_document" "artifact_read" {
  count = local.create_artifact_read_policy ? 1 : 0

  statement {
    sid     = "ListArtifactBuckets"
    actions = ["s3:ListBucket"]
    resources = [
      for arn in var.artifact_s3_bucket_arns : arn
    ]

    dynamic "condition" {
      for_each = length(local.artifact_list_prefixes) > 0 ? [1] : []
      content {
        test     = "StringLike"
        variable = "s3:prefix"
        values   = local.artifact_list_prefixes
      }
    }
  }

  statement {
    sid       = "GetArtifacts"
    actions   = ["s3:GetObject"]
    resources = local.artifact_get_object_arns
  }
}

resource "aws_iam_role_policy" "artifact_read" {
  count = local.create_artifact_read_policy ? 1 : 0

  name   = "artifact-read"
  role   = aws_iam_role.instance[0].id
  policy = data.aws_iam_policy_document.artifact_read[0].json
}

# When volumes use a customer-managed KMS key, the instance needs encrypt/decrypt for attach/boot.
data "aws_iam_policy_document" "ebs_kms" {
  count = var.create_instance_role && var.ebs_kms_key_id != null && var.ebs_kms_key_id != "" ? 1 : 0

  statement {
    sid = "EbsCmkUse"
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:DescribeKey",
      "kms:CreateGrant",
    ]
    resources = [var.ebs_kms_key_id]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ec2.${var.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "ebs_kms" {
  count = var.create_instance_role && var.ebs_kms_key_id != null && var.ebs_kms_key_id != "" ? 1 : 0

  name   = "ebs-cmk"
  role   = aws_iam_role.instance[0].id
  policy = data.aws_iam_policy_document.ebs_kms[0].json
}

# SSM Session Manager: primary operator access path (no public SSH required).
resource "aws_iam_role_policy_attachment" "ssm_core" {
  count = local.attach_ssm_core ? 1 : 0

  role       = aws_iam_role.instance[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Optional Tailscale auth-key read (SSM SecureString or Secrets Manager) — reference only.
data "aws_iam_policy_document" "tailscale_auth_secret_read" {
  count = local.attach_tailscale_secret_iam ? 1 : 0

  dynamic "statement" {
    for_each = local.tailscale_auth_is_ssm ? [1] : []
    content {
      sid = "GetTailscaleAuthParameter"
      actions = [
        "ssm:GetParameter",
        "ssm:GetParameters",
      ]
      resources = [local.tailscale_ssm_parameter_arn]
    }
  }

  dynamic "statement" {
    for_each = local.tailscale_auth_is_ssm ? [1] : []
    content {
      sid       = "DecryptTailscaleSecureString"
      actions   = ["kms:Decrypt"]
      resources = ["*"]
      condition {
        test     = "StringEquals"
        variable = "kms:ViaService"
        values   = ["ssm.*.amazonaws.com"]
      }
    }
  }

  dynamic "statement" {
    for_each = local.tailscale_auth_is_sm ? [1] : []
    content {
      sid       = "GetTailscaleAuthSecret"
      actions   = ["secretsmanager:GetSecretValue"]
      resources = [local.tailscale_sm_secret_arn]
    }
  }

  dynamic "statement" {
    for_each = local.tailscale_auth_is_sm ? [1] : []
    content {
      sid       = "DecryptTailscaleSecret"
      actions   = ["kms:Decrypt"]
      resources = ["*"]
      condition {
        test     = "StringEquals"
        variable = "kms:ViaService"
        values   = ["secretsmanager.*.amazonaws.com"]
      }
    }
  }
}

resource "aws_iam_role_policy" "tailscale_auth_secret_read" {
  count = local.attach_tailscale_secret_iam ? 1 : 0

  name   = "tailscale-auth-secret-read"
  role   = aws_iam_role.instance[0].id
  policy = data.aws_iam_policy_document.tailscale_auth_secret_read[0].json
}

# Backend runtime secrets (SM envelope) — GetSecretValue only for the declared ARN.
data "aws_iam_policy_document" "backend_runtime_secrets_read" {
  count = local.attach_backend_runtime_secrets_iam ? 1 : 0

  statement {
    sid       = "GetBackendRuntimeSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [local.backend_runtime_secrets_arn]
  }

  # CMK-encrypted secrets: decrypt only via Secrets Manager (same pattern as Tailscale SM).
  statement {
    sid       = "DecryptBackendRuntimeSecrets"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.*.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "backend_runtime_secrets_read" {
  count = local.attach_backend_runtime_secrets_iam ? 1 : 0

  name   = "backend-runtime-secrets-read"
  role   = aws_iam_role.instance[0].id
  policy = data.aws_iam_policy_document.backend_runtime_secrets_read[0].json
}

resource "aws_iam_instance_profile" "instance" {
  count = var.create_instance_role ? 1 : 0

  name = "${var.project_name}-hermes-instance"
  role = aws_iam_role.instance[0].name
  tags = merge(local.common_tags, { Name = "${var.project_name}-hermes-instance" })
}

# ---------------------------------------------------------------------------
# Optional VPC endpoints (SSM PrivateLink, S3 gateway, common AWS APIs)
# ---------------------------------------------------------------------------

resource "aws_security_group" "vpc_endpoints" {
  count = (local.create_ssm_vpc_endpoints || local.create_aws_interface_endpoints) ? 1 : 0

  name        = "${var.project_name}-vpc-endpoints"
  description = "Interface VPC endpoints for Company Brain Hermes (SSM / AWS APIs)"
  vpc_id      = local.vpc_id

  ingress {
    description     = "HTTPS from Hermes host security group"
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.hermes.id]
  }

  egress {
    description = "Endpoint ENI egress within AWS network"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = "${var.project_name}-vpc-endpoints" })
}

resource "aws_vpc_endpoint" "ssm" {
  count = local.create_ssm_vpc_endpoints ? 1 : 0

  vpc_id              = local.vpc_id
  service_name        = "com.amazonaws.${var.region}.ssm"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = local.ssm_endpoint_subnet_ids
  security_group_ids  = [aws_security_group.vpc_endpoints[0].id]
  private_dns_enabled = true

  tags = merge(local.common_tags, { Name = "${var.project_name}-vpce-ssm" })
}

resource "aws_vpc_endpoint" "ssmmessages" {
  count = local.create_ssm_vpc_endpoints ? 1 : 0

  vpc_id              = local.vpc_id
  service_name        = "com.amazonaws.${var.region}.ssmmessages"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = local.ssm_endpoint_subnet_ids
  security_group_ids  = [aws_security_group.vpc_endpoints[0].id]
  private_dns_enabled = true

  tags = merge(local.common_tags, { Name = "${var.project_name}-vpce-ssmmessages" })
}

resource "aws_vpc_endpoint" "ec2messages" {
  count = local.create_ssm_vpc_endpoints ? 1 : 0

  vpc_id              = local.vpc_id
  service_name        = "com.amazonaws.${var.region}.ec2messages"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = local.ssm_endpoint_subnet_ids
  security_group_ids  = [aws_security_group.vpc_endpoints[0].id]
  private_dns_enabled = true

  tags = merge(local.common_tags, { Name = "${var.project_name}-vpce-ec2messages" })
}

resource "aws_vpc_endpoint" "logs" {
  count = local.create_aws_interface_endpoints ? 1 : 0

  vpc_id              = local.vpc_id
  service_name        = "com.amazonaws.${var.region}.logs"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = local.aws_interface_endpoint_subnet_ids
  security_group_ids  = [aws_security_group.vpc_endpoints[0].id]
  private_dns_enabled = true

  tags = merge(local.common_tags, { Name = "${var.project_name}-vpce-logs" })
}

resource "aws_vpc_endpoint" "kms" {
  count = local.create_aws_interface_endpoints ? 1 : 0

  vpc_id              = local.vpc_id
  service_name        = "com.amazonaws.${var.region}.kms"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = local.aws_interface_endpoint_subnet_ids
  security_group_ids  = [aws_security_group.vpc_endpoints[0].id]
  private_dns_enabled = true

  tags = merge(local.common_tags, { Name = "${var.project_name}-vpce-kms" })
}

resource "aws_vpc_endpoint" "sts" {
  count = local.create_aws_interface_endpoints ? 1 : 0

  vpc_id              = local.vpc_id
  service_name        = "com.amazonaws.${var.region}.sts"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = local.aws_interface_endpoint_subnet_ids
  security_group_ids  = [aws_security_group.vpc_endpoints[0].id]
  private_dns_enabled = true

  tags = merge(local.common_tags, { Name = "${var.project_name}-vpce-sts" })
}

resource "aws_vpc_endpoint" "s3" {
  count = local.create_s3_gateway_endpoint ? 1 : 0

  vpc_id            = local.vpc_id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = var.s3_gateway_endpoint_route_table_ids

  tags = merge(local.common_tags, { Name = "${var.project_name}-vpce-s3" })
}

resource "aws_cloudwatch_log_group" "ssm_sessions" {
  count = var.enable_ssm_session_log_group ? 1 : 0

  name              = coalesce(var.ssm_session_logs_cloudwatch_log_group, "/company-brain/${var.project_name}/ssm-sessions")
  retention_in_days = var.ssm_session_logs_retention_days
  tags              = merge(local.common_tags, { Name = "${var.project_name}-ssm-sessions" })
}

# CloudWatch agent IAM (host log shipping / metrics).
resource "aws_iam_role_policy_attachment" "cloudwatch_agent" {
  count = local.attach_cloudwatch_agent_iam ? 1 : 0

  role       = aws_iam_role.instance[0].name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}

# Per-tenant host log group (journald/auth/sudo/hermes). Partition by project_name.
resource "aws_cloudwatch_log_group" "host" {
  count = local.create_host_log_group ? 1 : 0

  name              = local.host_log_group_name
  retention_in_days = var.host_log_retention_days
  tags              = merge(local.common_tags, { Name = "${var.project_name}-host-logs" })
}

resource "aws_instance" "hermes" {
  ami                         = coalesce(var.ami_id, data.aws_ami.amazon_linux_2023.id)
  instance_type               = var.instance_type
  key_name                    = local.ssh_key_name_effective
  vpc_security_group_ids      = [aws_security_group.hermes.id]
  subnet_id                   = var.subnet_id
  associate_public_ip_address = local.associate_public_ip
  iam_instance_profile        = var.create_instance_role ? aws_iam_instance_profile.instance[0].name : null
  user_data_replace_on_change = false

  # Primary user_data template is unchanged for smoke-bootstrap-inject compatibility.
  # Backend runtime secrets fragment is appended separately (ARN/refs only — no secret values).
  # Do NOT embed materialize-backend-secrets.py in user_data (outer base64gzip must stay
  # ≤16 KiB with bootstrap inject). Tool install: setup.sh / ensure-runtime-hardening.
  user_data_base64 = base64gzip(join("\n", compact([
    templatefile("${path.module}/user_data.sh.tftpl", {
      project_name                 = var.project_name
      install_path                 = var.install_path
      vault_path                   = var.vault_path
      timezone                     = var.timezone
      client_core_artifact_url     = var.client_core_artifact_url
      client_core_artifact_version = var.client_core_artifact_version
      client_core_artifact_sha256  = var.client_core_artifact_sha256
      # Effective backend pins (backend_artifact_locals.tf) — dual-write BACKEND_* +
      # temporary HERMES_* into artifact-pins.env (lp-k7g.10.3).
      backend_artifact_url            = local.effective_backend_artifact_url
      backend_artifact_version        = local.effective_backend_artifact_version
      backend_artifact_sha256         = local.effective_backend_artifact_sha256
      backend_artifact_kind           = local.effective_backend_artifact_kind
      backend_artifact_arch           = local.effective_backend_artifact_arch
      backend_artifact_signature_b64  = local.effective_backend_artifact_signature_b64
      backend_contract_runtime_layout = local.effective_backend_contract_runtime_layout
      backend_contract_relay          = local.effective_backend_contract_relay
      backend_contract_brain_rpc      = local.effective_backend_contract_brain_rpc
      backend_install_path            = local.effective_backend_install_path
      bootstrap_script_b64            = var.bootstrap_script_b64
      bootstrap_install_path          = var.bootstrap_install_path
      use_golden_ami                  = var.use_golden_ami
      enable_host_log_shipping        = var.enable_host_log_shipping
      host_log_group_name             = local.host_log_group_name
      # Tailscale (optional secondary) — non-secret refs only
      enable_tailscale                         = var.enable_tailscale
      tailscale_auto_enroll                    = var.tailscale_auto_enroll
      tailscale_enroll_script_b64              = var.enable_tailscale ? base64gzip(file("${path.module}/scripts/tailscale-enroll.sh")) : ""
      tailscale_auth_secret_source             = var.tailscale_auth_secret_source
      tailscale_auth_secret_ssm_parameter      = local.tailscale_ssm_parameter_name
      tailscale_auth_secret_secretsmanager_arn = local.tailscale_sm_secret_arn
      tailscale_tags_csv                       = local.tailscale_tags_csv
      tailscale_hostname                       = local.tailscale_hostname
      tailscale_ssh                            = var.tailscale_ssh
      tailscale_extra_up_args                  = var.tailscale_extra_up_args
      region                                   = var.region
      # Omnibox Mode A (cbd-o9s.10) — default false; does not change gateway ExecStart
      enable_omnibox = var.enable_omnibox
    }),
    local.backend_runtime_secrets_active ? templatefile("${path.module}/user_data_backend_runtime_secrets.fragment.tftpl", {
      backend_runtime_secrets_arn    = local.backend_runtime_secrets_arn
      backend_runtime_secrets_region = local.backend_runtime_secrets_region
      backend_model_provider         = local.backend_model_provider
      backend_model_default          = local.backend_model_default
      # Platform layout default for first-boot seed; units may use HERMES_HOME instead.
      backend_home = "/var/lib/company-brain-backend"
    }) : "",
  ])))

  lifecycle {
    # Attribute in use is user_data_base64; keep user_data for transition / older state.
    ignore_changes = [ami, user_data, user_data_base64]

    precondition {
      condition = (
        !local.backend_runtime_secrets_enabled
        || local.backend_runtime_secrets_arn != ""
      )
      error_message = "backend_runtime_secrets_enabled=true requires backend_runtime_secrets_arn (SM ARN only — never a secret value)."
    }
    precondition {
      condition = (
        !local.backend_runtime_secrets_active
        || var.create_instance_role
      )
      error_message = "backend_runtime_secrets_arn requires create_instance_role=true so the instance can GetSecretValue (or attach equivalent IAM externally and extend this module)."
    }
    precondition {
      condition     = var.network_mode != "production" || (var.subnet_id != null && var.subnet_id != "")
      error_message = "network_mode=production requires explicit subnet_id (private subnet)."
    }
    # associate_public_ip is forced false via local.associate_public_ip when production.
    precondition {
      condition = (
        var.network_mode != "production"
        || length(var.artifact_s3_bucket_arns) == 0
        || length(local.artifact_get_object_arns) > 0
      )
      error_message = "production with artifact_s3_bucket_arns requires scoped GetObject ARNs (set artifact_s3_object_arns or rely on hermes/* + client-core/* defaults)."
    }
    precondition {
      condition     = !local.require_pinned_ami || (var.ami_id != null && var.ami_id != "")
      error_message = "Pinned ami_id is required (production default). Set ami_id to a golden/hardened AMI, or set require_pinned_ami=false only for documented exceptions."
    }
    precondition {
      condition = (
        !var.create_ssm_vpc_endpoints
        || length(local.ssm_endpoint_subnet_ids) > 0
      )
      error_message = "create_ssm_vpc_endpoints=true requires subnet_id or ssm_vpc_endpoint_subnet_ids."
    }
    precondition {
      condition = (
        !var.create_s3_gateway_endpoint
        || length(var.s3_gateway_endpoint_route_table_ids) > 0
      )
      error_message = "create_s3_gateway_endpoint=true requires s3_gateway_endpoint_route_table_ids."
    }
    precondition {
      condition = (
        !local.create_ssh_ingress
        || local.ssh_key_name_effective != null
      )
      error_message = "operator_ssh_cidrs is non-empty but ssh_key_name is unset — set a key pair for SSH break-glass, or clear operator_ssh_cidrs for SSM-only."
    }
    precondition {
      condition = (
        !var.enable_tailscale
        || !local.tailscale_auth_is_ssm
        || length(local.tailscale_ssm_parameter_name) > 0
      )
      error_message = "enable_tailscale with source=ssm requires tailscale_auth_secret_ssm_parameter (parameter name only — never the auth key value)."
    }
    precondition {
      condition = (
        !var.enable_tailscale
        || !local.tailscale_auth_is_sm
        || length(local.tailscale_sm_secret_arn) > 0
      )
      error_message = "enable_tailscale with source=secretsmanager requires tailscale_auth_secret_secretsmanager_arn."
    }
    precondition {
      condition = (
        !var.enable_tailscale
        || var.create_instance_role
      )
      error_message = "enable_tailscale requires create_instance_role=true so the instance can fetch the auth key (or attach equivalent IAM externally and extend this module)."
    }
  }

  # IMDSv2 required; hop limit 1 blocks container/nested IMDS credential theft paths.
  # Hermes host does not require nested hops (no container needing host IMDS).
  # Instance role is scoped to artifact read (+ optional CMK); limit exposure via IMDS.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_size = var.root_volume_size_gb
    encrypted   = true
    kms_key_id  = var.ebs_kms_key_id

    tags = local.volume_backup_tags
  }

  tags = local.common_tags
}

resource "aws_ebs_volume" "data" {
  count = var.data_volume_size_gb > 0 ? 1 : 0

  availability_zone = aws_instance.hermes.availability_zone
  size              = var.data_volume_size_gb
  encrypted         = true
  kms_key_id        = var.ebs_kms_key_id
  type              = "gp3"

  tags = merge(
    local.volume_backup_tags,
    {
      Name = "${var.project_name}-hermes-data"
    },
  )
}

resource "aws_volume_attachment" "data" {
  count = var.data_volume_size_gb > 0 ? 1 : 0

  device_name = var.data_volume_device_name
  volume_id   = aws_ebs_volume.data[0].id
  instance_id = aws_instance.hermes.id
}

resource "aws_iam_role" "dlm" {
  count = var.enable_dlm ? 1 : 0

  name = "${var.project_name}-dlm"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "dlm.amazonaws.com"
        }
      }
    ]
  })

  tags = merge(local.common_tags, { Name = "${var.project_name}-dlm" })
}

resource "aws_iam_role_policy_attachment" "dlm" {
  count = var.enable_dlm ? 1 : 0

  role       = aws_iam_role.dlm[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}

# DLM needs CMK grants when source volumes use a customer-managed key and/or when
# cross-region copies re-encrypt with a destination CMK (cbd-mta.7.4).
# Snapshots of encrypted volumes inherit the volume's CMK (no schedule cmk_arn for primary
# EBS_SNAPSHOT_MANAGEMENT — AWS encrypts snapshots with the source volume key).
locals {
  dlm_kms_key_arns = distinct(compact([
    var.ebs_kms_key_id != null && var.ebs_kms_key_id != "" ? var.ebs_kms_key_id : null,
    var.cross_region_copy_cmk_arn,
  ]))
}

data "aws_iam_policy_document" "dlm_kms" {
  count = var.enable_dlm && length(local.dlm_kms_key_arns) > 0 ? 1 : 0

  statement {
    sid = "DlmCmkUse"
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:DescribeKey",
      "kms:CreateGrant",
    ]
    resources = local.dlm_kms_key_arns
  }
}

resource "aws_iam_role_policy" "dlm_kms" {
  count = var.enable_dlm && length(local.dlm_kms_key_arns) > 0 ? 1 : 0

  name   = "dlm-ebs-cmk"
  role   = aws_iam_role.dlm[0].id
  policy = data.aws_iam_policy_document.dlm_kms[0].json
}

# Fail-closed opt-in gates for DR copy/share (cbd-mta.7.4). Defaults keep same-account/region only.
check "dlm_cross_region_copy_requires_destination" {
  assert {
    condition = (
      !var.enable_cross_region_copy
      || (
        var.destination_region != null
        && var.destination_region != ""
        && var.destination_region != var.region
      )
    )
    error_message = "enable_cross_region_copy=true requires destination_region set to a region different from the primary module region."
  }
}

check "dlm_dr_account_share_requires_account_id" {
  assert {
    condition = (
      !var.enable_dr_account_share
      || (var.dr_account_id != null && can(regex("^[0-9]{12}$", var.dr_account_id)))
    )
    error_message = "enable_dr_account_share=true requires dr_account_id (12-digit dedicated DR account, not another tenant)."
  }
}

check "dlm_dr_features_require_enable_dlm" {
  assert {
    condition = (
      (!var.enable_cross_region_copy && !var.enable_dr_account_share)
      || var.enable_dlm
    )
    error_message = "enable_cross_region_copy / enable_dr_account_share require enable_dlm=true."
  }
}

resource "aws_dlm_lifecycle_policy" "daily_volume_snapshots" {
  count = var.enable_dlm ? 1 : 0

  description        = "Daily EBS snapshots for ${var.project_name} Company Brain volumes"
  execution_role_arn = aws_iam_role.dlm[0].arn
  state              = "ENABLED"

  policy_details {
    resource_types = ["VOLUME"]
    target_tags = {
      Backup  = "daily"
      Project = var.project_name
    }

    schedule {
      name = "daily-retain-${var.snapshot_retention_count}"

      create_rule {
        interval      = 24
        interval_unit = "HOURS"
        times         = ["07:00"]
      }

      retain_rule {
        count = var.snapshot_retention_count
      }

      tags_to_add = {
        Project = var.project_name
      }

      copy_tags = true

      # Opt-in same-account cross-region DR copy (default off).
      dynamic "cross_region_copy_rule" {
        for_each = var.enable_cross_region_copy ? [1] : []
        content {
          target    = var.destination_region
          encrypted = true
          cmk_arn   = var.cross_region_copy_cmk_arn
          copy_tags = true

          retain_rule {
            interval      = var.cross_region_copy_retain_interval
            interval_unit = var.cross_region_copy_retain_interval_unit
          }
        }
      }

      # Opt-in share with a dedicated DR account (default off; not multi-tenant).
      dynamic "share_rule" {
        for_each = var.enable_dr_account_share ? [1] : []
        content {
          target_accounts       = [var.dr_account_id]
          unshare_interval      = var.dr_account_unshare_interval
          unshare_interval_unit = var.dr_account_unshare_interval != null ? var.dr_account_unshare_interval_unit : null
        }
      }
    }
  }

  tags = merge(local.common_tags, { Name = "${var.project_name}-dlm-daily" })
}

# Account/region control: block public sharing of EBS snapshots (production recommended).
resource "aws_ebs_snapshot_block_public_access" "this" {
  count = var.enable_ebs_snapshot_block_public_access ? 1 : 0

  state = var.ebs_snapshot_block_public_access_state
}

resource "aws_cloudwatch_metric_alarm" "instance_status_check" {
  count = var.enable_status_alarm ? 1 : 0

  alarm_name          = "${var.project_name}-hermes-status-check"
  alarm_description   = "EC2 status check failure for the Company Brain Hermes host"
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed"
  statistic           = "Maximum"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  period              = 60
  evaluation_periods  = 2
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.status_alarm_actions
  ok_actions          = var.status_ok_actions

  dimensions = {
    InstanceId = aws_instance.hermes.id
  }

  tags = local.common_tags
}

# ---------------------------------------------------------------------------
# Snapshot age / missing backup (cbd-zzx.20)
# Metric published by scripts/check-snapshot-age.sh --publish-metric
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "snapshot_age" {
  count = var.enable_snapshot_age_alarm ? 1 : 0

  alarm_name          = "${var.project_name}-snapshot-age"
  alarm_description   = "Newest DLM snapshot for Project=${var.project_name} exceeds ${var.snapshot_max_age_hours}h (or metric missing — schedule scripts/check-snapshot-age.sh --publish-metric). See references/runbooks/dlm-restore-drill.md."
  namespace           = "CompanyBrain/Backup"
  metric_name         = "NewestSnapshotAgeHours"
  statistic           = "Maximum"
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.snapshot_max_age_hours
  # Daily metric; two missing days or two over-threshold samples → ALARM.
  period             = 86400
  evaluation_periods = 2
  treat_missing_data = "breaching"
  alarm_actions      = var.snapshot_age_alarm_actions
  ok_actions         = var.snapshot_age_ok_actions

  dimensions = {
    Project = var.project_name
  }

  tags = merge(local.common_tags, { Name = "${var.project_name}-snapshot-age" })
}

locals {
  create_snapshot_age_check_schedule = (
    var.enable_snapshot_age_alarm
    && var.enable_snapshot_age_check_schedule
    && length(var.snapshot_age_alarm_actions) > 0
  )
  snapshot_age_check_sns_arn = try(var.snapshot_age_alarm_actions[0], null)
}

# Daily SNS reminder to run the operator check script (no Lambda payload invented here).
# Prefer replacing this with EventBridge → Lambda/SSM that executes check-snapshot-age.sh.
resource "aws_cloudwatch_event_rule" "snapshot_age_check" {
  count = local.create_snapshot_age_check_schedule ? 1 : 0

  name                = "${var.project_name}-snapshot-age-check"
  description         = "Daily reminder: run scripts/check-snapshot-age.sh --project ${var.project_name} --publish-metric (cbd-zzx.20). Replace with automation Lambda when available."
  schedule_expression = var.snapshot_age_check_schedule_expression

  tags = merge(local.common_tags, { Name = "${var.project_name}-snapshot-age-check" })
}

resource "aws_cloudwatch_event_target" "snapshot_age_check_sns" {
  count = local.create_snapshot_age_check_schedule ? 1 : 0

  rule      = aws_cloudwatch_event_rule.snapshot_age_check[0].name
  target_id = "snapshot-age-check-sns"
  arn       = local.snapshot_age_check_sns_arn

  input = jsonencode({
    source        = "company-brain.snapshot-age-check"
    project_name  = var.project_name
    region        = var.region
    message       = "Run scripts/check-snapshot-age.sh --project ${var.project_name} --region ${var.region} --max-age-hours ${var.snapshot_max_age_hours} --publish-metric. Alarm: ${var.project_name}-snapshot-age. Runbook: references/runbooks/dlm-restore-drill.md"
    alarm_name    = "${var.project_name}-snapshot-age"
    max_age_hours = var.snapshot_max_age_hours
  })
}
