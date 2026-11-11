# Account factory contract + optional in-account baseline for lanyard_hosted account-per-tenant.
# Does NOT call Organizations / Control Tower APIs. SCP JSON lives under scp/ for operator attach.
# Status: infra_ready / not auto-applied.

data "aws_caller_identity" "current" {
  count = var.create_account_baseline ? 1 : 0
}

data "aws_partition" "current" {
  count = var.create_account_baseline ? 1 : 0
}

data "aws_region" "current" {
  count = var.create_account_baseline ? 1 : 0
}

locals {
  common_tags = merge(
    {
      Project          = var.project_name
      TenantSlug       = var.tenant_slug
      HostingTrack     = "lanyard_hosted"
      IsolationMode    = "account"
      EnvironmentClass = var.environment_class
      ManagedBy        = "company-brain-deploy"
      LanyardModule    = "account-factory"
      AccountFactory   = "contract"
    },
    var.extra_tags,
  )

  # Prefer explicit account_id; fall back to caller identity when baseline is applied in-account.
  resolved_account_id = (
    var.account_id != null
    ? var.account_id
    : try(data.aws_caller_identity.current[0].account_id, null)
  )

  partition = try(data.aws_partition.current[0].partition, "aws")
  region    = try(data.aws_region.current[0].name, var.region)

  deploy_role_name      = "company-brain-deploy-${var.project_name}"
  break_glass_role_name = "company-brain-break-glass-${var.project_name}"

  state_bucket_name = coalesce(
    var.state_bucket_name,
    (
      local.resolved_account_id != null
      ? "company-brain-tfstate-${var.project_name}-${substr(local.resolved_account_id, 6, 6)}"
      : "company-brain-tfstate-${var.project_name}-PLACEHOLDER"
    )
  )

  lock_table_name = "company-brain-tfstate-lock-${var.project_name}"

  log_group_name = "/company-brain/${var.tenant_slug}"

  kms_alias_name = "alias/company-brain-${var.project_name}"

  create_kms         = var.create_account_baseline && var.create_kms_key
  create_state       = var.create_account_baseline && var.create_state_backend
  create_logs        = var.create_account_baseline && var.create_log_group
  create_backup      = var.create_account_baseline && var.create_backup_vault
  create_budget      = var.create_account_baseline && var.create_budget
  create_deploy      = var.create_account_baseline && var.create_deploy_role && length(var.lanyard_deploy_principal_arns) > 0
  create_break_glass = var.create_account_baseline && var.create_break_glass_role && length(var.break_glass_principal_arns) > 0

  # Account request contract for CT/AFT / org operators (never applied by this module).
  account_request_contract = {
    tenant_slug              = var.tenant_slug
    project_name             = var.project_name
    environment_class        = var.environment_class
    account_name             = var.account_name
    account_email            = var.account_email
    target_ou_path           = var.target_ou_path
    sso_permission_set_names = var.sso_permission_set_names
    hosting_track            = "lanyard_hosted"
    isolation_mode           = "account"
    live_organizations_api   = false
    scp_templates_dir        = "modules/account-factory/scp"
    next_step_after_vend     = "Apply this module with create_account_baseline=true and account_id=<vended> using tenant-account credentials or org pipeline."
  }

  scp_template_files = [
    "deny-leave-organization.json",
    "deny-root-create-access-keys.json",
    "deny-public-s3-acls.json",
    "protect-security-services.json",
  ]
}

# ---------------------------------------------------------------------------
# Honesty checks
# ---------------------------------------------------------------------------

check "acknowledge_not_auto_applied" {
  assert {
    condition     = var.acknowledge_not_auto_applied == true
    error_message = "account-factory requires acknowledge_not_auto_applied=true (operator-owned; not auto from examples)."
  }
}

check "no_live_organizations_api" {
  assert {
    condition     = var.enable_live_organizations_api == false
    error_message = "Live Organizations API is locked off. Use Control Tower/AFT per references/runbooks/account-factory.md."
  }
}

check "baseline_needs_account_identity" {
  assert {
    condition = (
      !var.create_account_baseline
      || var.account_id != null
      || true # caller identity available at plan in real account
    )
    error_message = "create_account_baseline requires account_id or applying with credentials in the target account."
  }
}

check "deploy_role_needs_principals" {
  assert {
    condition = (
      !var.create_account_baseline
      || !var.create_deploy_role
      || length(var.lanyard_deploy_principal_arns) > 0
    )
    error_message = "create_deploy_role=true requires non-empty lanyard_deploy_principal_arns."
  }
}

# ---------------------------------------------------------------------------
# KMS CMK (tenant account)
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "kms" {
  count = local.create_kms ? 1 : 0

  statement {
    sid       = "EnableRootAccountAdmin"
    effect    = "Allow"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:${local.partition}:iam::${local.resolved_account_id}:root"]
    }
  }

  dynamic "statement" {
    for_each = length(var.kms_key_administrators) > 0 ? [1] : []
    content {
      sid       = "KeyAdministrators"
      effect    = "Allow"
      actions   = ["kms:*"]
      resources = ["*"]
      principals {
        type        = "AWS"
        identifiers = var.kms_key_administrators
      }
    }
  }

  statement {
    sid    = "AllowUseViaServices"
    effect = "Allow"
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:DescribeKey",
      "kms:CreateGrant",
    ]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:${local.partition}:iam::${local.resolved_account_id}:root"]
    }
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values = [
        "ec2.${local.region}.amazonaws.com",
        "s3.${local.region}.amazonaws.com",
        "secretsmanager.${local.region}.amazonaws.com",
        "ssm.${local.region}.amazonaws.com",
        "backup.${local.region}.amazonaws.com",
        "logs.${local.region}.amazonaws.com",
      ]
    }
  }
}

resource "aws_kms_key" "tenant" {
  count = local.create_kms ? 1 : 0

  description             = "Company Brain tenant CMK for ${var.project_name} (${var.tenant_slug})"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  policy                  = data.aws_iam_policy_document.kms[0].json
  tags                    = merge(local.common_tags, { Name = "${var.project_name}-tenant-cmk", Role = "tenant-kms" })
}

resource "aws_kms_alias" "tenant" {
  count = local.create_kms ? 1 : 0

  name          = local.kms_alias_name
  target_key_id = aws_kms_key.tenant[0].key_id
}

# ---------------------------------------------------------------------------
# Terraform state backend (S3 + DynamoDB lock)
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "tfstate" {
  count = local.create_state ? 1 : 0

  bucket = local.state_bucket_name
  tags   = merge(local.common_tags, { Name = local.state_bucket_name, Role = "terraform-state" })
}

resource "aws_s3_bucket_versioning" "tfstate" {
  count = local.create_state ? 1 : 0

  bucket = aws_s3_bucket.tfstate[0].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  count = local.create_state ? 1 : 0

  bucket = aws_s3_bucket.tfstate[0].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = local.create_kms ? "aws:kms" : "AES256"
      kms_master_key_id = local.create_kms ? aws_kms_key.tenant[0].arn : null
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  count = local.create_state ? 1 : 0

  bucket                  = aws_s3_bucket.tfstate[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "tfstate_tls" {
  count = local.create_state ? 1 : 0

  bucket = aws_s3_bucket.tfstate[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.tfstate[0].arn,
          "${aws_s3_bucket.tfstate[0].arn}/*",
        ]
        Condition = {
          Bool = { "aws:SecureTransport" = "false" }
        }
      }
    ]
  })
}

resource "aws_dynamodb_table" "tfstate_lock" {
  count = local.create_state ? 1 : 0

  name         = local.lock_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  tags = merge(local.common_tags, { Name = local.lock_table_name, Role = "terraform-state-lock" })
}

# ---------------------------------------------------------------------------
# Logging baseline
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "tenant" {
  count = local.create_logs ? 1 : 0

  name              = local.log_group_name
  retention_in_days = var.log_retention_days
  kms_key_id        = local.create_kms ? aws_kms_key.tenant[0].arn : null
  tags              = merge(local.common_tags, { Name = local.log_group_name, Role = "tenant-logs" })
}

# ---------------------------------------------------------------------------
# Backup vault (optional; DLM remains primary for company-brain-ec2 volumes)
# ---------------------------------------------------------------------------

resource "aws_backup_vault" "tenant" {
  count = local.create_backup ? 1 : 0

  name        = "company-brain-${var.project_name}"
  kms_key_arn = local.create_kms ? aws_kms_key.tenant[0].arn : null
  tags        = merge(local.common_tags, { Name = "company-brain-${var.project_name}", Role = "backup-vault" })
}

# ---------------------------------------------------------------------------
# Monthly budget
# ---------------------------------------------------------------------------

resource "aws_budgets_budget" "monthly" {
  count = local.create_budget ? 1 : 0

  name         = "company-brain-${var.project_name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_limit_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_types {
    include_credit             = false
    include_discount           = true
    include_other_subscription = true
    include_recurring          = true
    include_refund             = false
    include_subscription       = true
    include_support            = true
    include_tax                = true
    include_upfront            = true
    use_amortized              = false
    use_blended                = false
  }

  dynamic "notification" {
    for_each = var.budget_notification_email != null ? [1] : []
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = 80
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.budget_notification_email]
    }
  }
}

# ---------------------------------------------------------------------------
# Deploy role — AssumeRole only (no IAM users / access keys)
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "deploy_trust" {
  count = local.create_deploy ? 1 : 0

  statement {
    sid     = "AllowLanyardDeployAssume"
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "AWS"
      identifiers = var.lanyard_deploy_principal_arns
    }

    condition {
      test     = "StringEquals"
      variable = "sts:ExternalId"
      values   = [var.deploy_role_external_id]
    }
  }
}

resource "aws_iam_role" "deploy" {
  count = local.create_deploy ? 1 : 0

  name                 = local.deploy_role_name
  path                 = "/company-brain/"
  description          = "Lanyard-hosted deploy role for ${var.project_name} (AssumeRole only; no long-lived keys)."
  assume_role_policy   = data.aws_iam_policy_document.deploy_trust[0].json
  max_session_duration = var.max_session_duration_seconds
  tags                 = merge(local.common_tags, { Name = local.deploy_role_name, Role = "company-brain-deploy" })
}

data "aws_iam_policy_document" "deploy_permissions" {
  count = local.create_deploy ? 1 : 0

  statement {
    sid    = "CompanyBrainDeploySurface"
    effect = "Allow"
    actions = [
      "ec2:*",
      "dlm:*",
      "iam:Get*",
      "iam:List*",
      "iam:PassRole",
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:PutRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:AttachRolePolicy",
      "iam:DetachRolePolicy",
      "iam:CreateInstanceProfile",
      "iam:DeleteInstanceProfile",
      "iam:AddRoleToInstanceProfile",
      "iam:RemoveRoleFromInstanceProfile",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:TagInstanceProfile",
      "iam:UntagInstanceProfile",
      "iam:CreateServiceLinkedRole",
      "ssm:*",
      "ssmmessages:*",
      "ec2messages:*",
      "secretsmanager:*",
      "logs:*",
      "cloudwatch:*",
      "sns:*",
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:DescribeKey",
      "kms:CreateGrant",
      "kms:List*",
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:ListBucket",
      "s3:GetBucketLocation",
      "s3:PutObject",
      "s3:DeleteObject",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
      "dynamodb:DescribeTable",
      "sts:GetCallerIdentity",
      "sts:DecodeAuthorizationMessage",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "DenyLongLivedCredentials"
    effect = "Deny"
    actions = [
      "iam:CreateUser",
      "iam:CreateAccessKey",
      "iam:UpdateAccessKey",
      "iam:CreateLoginProfile",
      "iam:CreateServiceSpecificCredential",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "DenyLeaveOrg"
    effect = "Deny"
    actions = [
      "organizations:LeaveOrganization",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  count = local.create_deploy ? 1 : 0

  name   = "company-brain-deploy"
  role   = aws_iam_role.deploy[0].id
  policy = data.aws_iam_policy_document.deploy_permissions[0].json
}

# ---------------------------------------------------------------------------
# Break-glass role (MFA recommended)
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "break_glass_trust" {
  count = local.create_break_glass ? 1 : 0

  statement {
    sid     = "AllowBreakGlassAssume"
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "AWS"
      identifiers = var.break_glass_principal_arns
    }

    dynamic "condition" {
      for_each = var.require_mfa_break_glass ? [1] : []
      content {
        test     = "Bool"
        variable = "aws:MultiFactorAuthPresent"
        values   = ["true"]
      }
    }
  }
}

resource "aws_iam_role" "break_glass" {
  count = local.create_break_glass ? 1 : 0

  name                 = local.break_glass_role_name
  path                 = "/company-brain/"
  description          = "Break-glass role for ${var.project_name} (MFA recommended; time-bound use only)."
  assume_role_policy   = data.aws_iam_policy_document.break_glass_trust[0].json
  max_session_duration = min(var.max_session_duration_seconds, 3600)
  tags                 = merge(local.common_tags, { Name = local.break_glass_role_name, Role = "company-brain-break-glass" })
}

data "aws_iam_policy_document" "break_glass_permissions" {
  count = local.create_break_glass ? 1 : 0

  # Read-heavy + recovery; still deny long-lived key creation.
  statement {
    sid       = "BreakGlassOperator"
    effect    = "Allow"
    actions   = ["*"]
    resources = ["*"]
  }

  statement {
    sid    = "DenyLongLivedCredentials"
    effect = "Deny"
    actions = [
      "iam:CreateUser",
      "iam:CreateAccessKey",
      "iam:UpdateAccessKey",
      "iam:CreateLoginProfile",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "DenyLeaveOrg"
    effect    = "Deny"
    actions   = ["organizations:LeaveOrganization"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "break_glass" {
  count = local.create_break_glass ? 1 : 0

  name   = "company-brain-break-glass"
  role   = aws_iam_role.break_glass[0].id
  policy = data.aws_iam_policy_document.break_glass_permissions[0].json
}
