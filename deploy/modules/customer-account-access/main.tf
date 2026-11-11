# Track B customer-account access: customer-granted IAM role for Lanyard operators.
# No long-lived access keys. ExternalId required. Least-privilege deploy + explicit denies.
# Status: infra_ready / contract — operator-applied in customer account; not auto-applied from git.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

locals {
  role_name = coalesce(var.role_name, "company-brain-lanyard-deploy-${var.project_name}")

  permissions_boundary_name = coalesce(
    var.permissions_boundary_name,
    "company-brain-lanyard-boundary-${var.project_name}"
  )

  secret_path_prefix = coalesce(
    var.secret_path_prefix,
    "/company-brain/${var.project_name}"
  )

  # Lanyard-side reference only (not a secret value).
  external_id_parameter_name = coalesce(
    var.external_id_parameter_name,
    "/lanyard/track-b/${var.tenant_slug}/deploy-external-id"
  )

  common_tags = merge(
    {
      Name          = local.role_name
      Project       = var.project_name
      TenantSlug    = var.tenant_slug
      HostingTrack  = "customer_account"
      IsolationMode = "customer_account"
      Role          = "company-brain-lanyard-deploy"
      ManagedBy     = "company-brain-deploy"
      LanyardModule = "customer-account-access"
    },
    var.extra_tags,
  )

  default_artifact_object_arns = flatten([
    for arn in var.artifact_s3_bucket_arns : [
      "${arn}/hermes/*",
      "${arn}/client-core/*",
    ]
  ])

  artifact_get_object_arns = (
    length(var.artifact_s3_object_arns) > 0
    ? var.artifact_s3_object_arns
    : local.default_artifact_object_arns
  )

  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition
  region     = data.aws_region.current.name

  # IAM resource name prefix for instance/DLM roles created by company-brain-ec2.
  iam_name_prefix = var.project_name

  ssm_parameter_arn_prefix  = "arn:${local.partition}:ssm:${local.region}:${local.account_id}:parameter${local.secret_path_prefix}"
  secretsmanager_arn_prefix = "arn:${local.partition}:secretsmanager:${local.region}:${local.account_id}:secret:${trimprefix(local.secret_path_prefix, "/")}"
}

# ---------------------------------------------------------------------------
# Trust policy — Lanyard principals only; ExternalId required; optional MFA/region/tags
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "trust" {
  statement {
    sid    = "AllowLanyardAssumeWithExternalId"
    effect = "Allow"
    actions = concat(
      ["sts:AssumeRole"],
      var.enable_session_tags ? ["sts:TagSession"] : [],
    )

    principals {
      type        = "AWS"
      identifiers = var.lanyard_principal_arns
    }

    condition {
      test     = "StringEquals"
      variable = "sts:ExternalId"
      values   = [var.external_id]
    }

    dynamic "condition" {
      for_each = var.require_mfa ? [1] : []
      content {
        test     = "Bool"
        variable = "aws:MultiFactorAuthPresent"
        values   = ["true"]
      }
    }

    dynamic "condition" {
      for_each = length(var.allowed_regions) > 0 ? [1] : []
      content {
        test     = "StringEquals"
        variable = "aws:RequestedRegion"
        values   = var.allowed_regions
      }
    }

    dynamic "condition" {
      for_each = var.enable_session_tags ? [1] : []
      content {
        test     = "StringEquals"
        variable = "aws:RequestTag/Project"
        values   = [var.project_name]
      }
    }

    dynamic "condition" {
      for_each = var.enable_session_tags ? [1] : []
      content {
        test     = "StringEquals"
        variable = "aws:RequestTag/TenantSlug"
        values   = [var.tenant_slug]
      }
    }

    dynamic "condition" {
      for_each = var.enable_session_tags ? [1] : []
      content {
        test     = "ForAllValues:StringEquals"
        variable = "sts:TransitiveTagKeys"
        values   = ["Project", "TenantSlug"]
      }
    }
  }
}

# ---------------------------------------------------------------------------
# Permissions boundary — caps blast radius for this role and optional child roles
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "permissions_boundary" {
  count = var.create_permissions_boundary ? 1 : 0

  statement {
    sid    = "BoundaryAllowTenantDeploySurface"
    effect = "Allow"
    actions = [
      "ec2:*",
      "elasticloadbalancing:Describe*",
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
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
      "secretsmanager:ListSecrets",
      "secretsmanager:CreateSecret",
      "secretsmanager:PutSecretValue",
      "secretsmanager:UpdateSecret",
      "secretsmanager:TagResource",
      "secretsmanager:DeleteSecret",
      "logs:*",
      "cloudwatch:*",
      "sns:Publish",
      "sns:CreateTopic",
      "sns:Subscribe",
      "sns:SetTopicAttributes",
      "sns:TagResource",
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
      "s3:ListBucketVersions",
      "s3:GetBucketLocation",
      "sts:GetCallerIdentity",
      "sts:DecodeAuthorizationMessage",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "BoundaryDenyLongLivedKeys"
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
    sid       = "BoundaryDenyOrgAndBilling"
    effect    = "Deny"
    actions   = ["organizations:*", "account:*", "aws-portal:*", "billing:*"]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "permissions_boundary" {
  count = var.create_permissions_boundary ? 1 : 0

  name   = local.permissions_boundary_name
  path   = var.iam_path_prefix
  policy = data.aws_iam_policy_document.permissions_boundary[0].json
  tags   = merge(local.common_tags, { Name = local.permissions_boundary_name })
}

# ---------------------------------------------------------------------------
# Deploy role
# ---------------------------------------------------------------------------

resource "aws_iam_role" "lanyard_deploy" {
  name                 = local.role_name
  path                 = var.iam_path_prefix
  description          = "Track B Lanyard deploy role for project ${var.project_name} (external-id required; no long-lived keys)."
  assume_role_policy   = data.aws_iam_policy_document.trust.json
  max_session_duration = var.max_session_duration_seconds
  permissions_boundary = var.create_permissions_boundary ? aws_iam_policy.permissions_boundary[0].arn : null

  tags = local.common_tags
}

# ---------------------------------------------------------------------------
# Least-privilege deploy policy (company-brain-ec2 surface)
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "deploy" {
  count = var.enable_deploy_permissions ? 1 : 0

  # --- EC2 / EBS / networking (tag-conditioned where IAM supports it) ---
  statement {
    sid    = "Ec2Read"
    effect = "Allow"
    actions = [
      "ec2:Describe*",
      "ec2:Get*",
      "ec2:List*",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "Ec2MutateTaggedOrCreate"
    effect = "Allow"
    actions = [
      "ec2:RunInstances",
      "ec2:TerminateInstances",
      "ec2:StartInstances",
      "ec2:StopInstances",
      "ec2:RebootInstances",
      "ec2:ModifyInstanceAttribute",
      "ec2:CreateTags",
      "ec2:DeleteTags",
      "ec2:CreateVolume",
      "ec2:DeleteVolume",
      "ec2:AttachVolume",
      "ec2:DetachVolume",
      "ec2:ModifyVolume",
      "ec2:CreateSnapshot",
      "ec2:DeleteSnapshot",
      "ec2:CreateSecurityGroup",
      "ec2:DeleteSecurityGroup",
      "ec2:AuthorizeSecurityGroupIngress",
      "ec2:AuthorizeSecurityGroupEgress",
      "ec2:RevokeSecurityGroupIngress",
      "ec2:RevokeSecurityGroupEgress",
      "ec2:UpdateSecurityGroupRuleDescriptionsIngress",
      "ec2:UpdateSecurityGroupRuleDescriptionsEgress",
      "ec2:CreateVpcEndpoint",
      "ec2:DeleteVpcEndpoints",
      "ec2:ModifyVpcEndpoint",
      "ec2:CreateNetworkInterface",
      "ec2:DeleteNetworkInterface",
      "ec2:AllocateAddress",
      "ec2:ReleaseAddress",
      "ec2:AssociateAddress",
      "ec2:DisassociateAddress",
    ]
    resources = ["*"]
    condition {
      test     = "StringEqualsIfExists"
      variable = "aws:RequestTag/Project"
      values   = [var.project_name]
    }
  }

  statement {
    sid    = "Ec2MutateExistingProject"
    effect = "Allow"
    actions = [
      "ec2:TerminateInstances",
      "ec2:StartInstances",
      "ec2:StopInstances",
      "ec2:RebootInstances",
      "ec2:ModifyInstanceAttribute",
      "ec2:CreateTags",
      "ec2:DeleteTags",
      "ec2:DeleteVolume",
      "ec2:AttachVolume",
      "ec2:DetachVolume",
      "ec2:ModifyVolume",
      "ec2:DeleteSnapshot",
      "ec2:DeleteSecurityGroup",
      "ec2:AuthorizeSecurityGroupIngress",
      "ec2:AuthorizeSecurityGroupEgress",
      "ec2:RevokeSecurityGroupIngress",
      "ec2:RevokeSecurityGroupEgress",
    ]
    resources = ["*"]
    condition {
      test     = "StringEqualsIfExists"
      variable = "ec2:ResourceTag/Project"
      values   = [var.project_name]
    }
  }

  # --- DLM ---
  statement {
    sid    = "DlmLifecycle"
    effect = "Allow"
    actions = [
      "dlm:CreateLifecyclePolicy",
      "dlm:DeleteLifecyclePolicy",
      "dlm:GetLifecyclePolicy",
      "dlm:GetLifecyclePolicies",
      "dlm:ListTagsForResource",
      "dlm:TagResource",
      "dlm:UntagResource",
      "dlm:UpdateLifecyclePolicy",
    ]
    resources = ["*"]
  }

  # --- IAM for instance / DLM roles (name + path scoped) ---
  statement {
    sid    = "IamManageTenantRoles"
    effect = "Allow"
    actions = [
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:GetRole",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:PutRolePolicy",
      "iam:GetRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:AttachRolePolicy",
      "iam:DetachRolePolicy",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:PassRole",
    ]
    resources = [
      "arn:${local.partition}:iam::${local.account_id}:role${var.iam_path_prefix}${local.iam_name_prefix}-*",
      "arn:${local.partition}:iam::${local.account_id}:role/${local.iam_name_prefix}-*",
    ]
  }

  statement {
    sid    = "IamManageInstanceProfiles"
    effect = "Allow"
    actions = [
      "iam:CreateInstanceProfile",
      "iam:DeleteInstanceProfile",
      "iam:GetInstanceProfile",
      "iam:AddRoleToInstanceProfile",
      "iam:RemoveRoleFromInstanceProfile",
      "iam:TagInstanceProfile",
      "iam:UntagInstanceProfile",
      "iam:ListInstanceProfiles",
      "iam:ListInstanceProfileTags",
    ]
    resources = [
      "arn:${local.partition}:iam::${local.account_id}:instance-profile${var.iam_path_prefix}${local.iam_name_prefix}-*",
      "arn:${local.partition}:iam::${local.account_id}:instance-profile/${local.iam_name_prefix}-*",
    ]
  }

  statement {
    sid       = "IamPassServiceLinkedDlm"
    effect    = "Allow"
    actions   = ["iam:CreateServiceLinkedRole"]
    resources = ["arn:${local.partition}:iam::${local.account_id}:role/aws-service-role/dlm.amazonaws.com/*"]
    condition {
      test     = "StringEquals"
      variable = "iam:AWSServiceName"
      values   = ["dlm.amazonaws.com"]
    }
  }

  statement {
    sid    = "IamAttachAwsManagedForInstance"
    effect = "Allow"
    actions = [
      "iam:AttachRolePolicy",
      "iam:DetachRolePolicy",
    ]
    resources = [
      "arn:${local.partition}:iam::${local.account_id}:role${var.iam_path_prefix}${local.iam_name_prefix}-*",
      "arn:${local.partition}:iam::${local.account_id}:role/${local.iam_name_prefix}-*",
    ]
  }

  # Read-only for AWS managed policies we attach (SSM core, CloudWatch agent, DLM)
  statement {
    sid    = "IamReadAwsManaged"
    effect = "Allow"
    actions = [
      "iam:GetPolicy",
      "iam:GetPolicyVersion",
      "iam:ListPolicyVersions",
    ]
    resources = [
      "arn:${local.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore",
      "arn:${local.partition}:iam::aws:policy/CloudWatchAgentServerPolicy",
      "arn:${local.partition}:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole",
    ]
  }

  # --- SSM / Secrets scoped to tenant prefix ---
  statement {
    sid    = "SsmTenantParameters"
    effect = "Allow"
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:GetParametersByPath",
      "ssm:PutParameter",
      "ssm:DeleteParameter",
      "ssm:DeleteParameters",
      "ssm:AddTagsToResource",
      "ssm:RemoveTagsFromResource",
      "ssm:ListTagsForResource",
      "ssm:DescribeParameters",
    ]
    resources = [
      "${local.ssm_parameter_arn_prefix}",
      "${local.ssm_parameter_arn_prefix}/*",
    ]
  }

  statement {
    sid       = "SsmDescribeAll"
    effect    = "Allow"
    actions   = ["ssm:DescribeParameters", "ssm:DescribeSessions", "ssm:DescribeInstanceInformation"]
    resources = ["*"]
  }

  statement {
    sid    = "SsmSessionTenant"
    effect = "Allow"
    actions = [
      "ssm:StartSession",
      "ssm:TerminateSession",
      "ssm:ResumeSession",
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
      "ec2messages:AcknowledgeMessage",
      "ec2messages:DeleteMessage",
      "ec2messages:FailMessage",
      "ec2messages:GetEndpoint",
      "ec2messages:GetMessages",
      "ec2messages:SendReply",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "SecretsManagerTenant"
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
      "secretsmanager:CreateSecret",
      "secretsmanager:PutSecretValue",
      "secretsmanager:UpdateSecret",
      "secretsmanager:DeleteSecret",
      "secretsmanager:TagResource",
      "secretsmanager:UntagResource",
      "secretsmanager:ListSecretVersionIds",
    ]
    resources = [
      "${local.secretsmanager_arn_prefix}-*",
      "${local.secretsmanager_arn_prefix}/*",
    ]
  }

  statement {
    sid       = "SecretsManagerList"
    effect    = "Allow"
    actions   = ["secretsmanager:ListSecrets"]
    resources = ["*"]
  }

  # --- Logs / CloudWatch / SNS (tenant-tagged when possible) ---
  statement {
    sid    = "LogsAndMetrics"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogGroups",
      "logs:DescribeLogStreams",
      "logs:PutRetentionPolicy",
      "logs:DeleteLogGroup",
      "logs:ListTagsLogGroup",
      "logs:TagLogGroup",
      "logs:UntagLogGroup",
      "logs:TagResource",
      "logs:UntagResource",
      "cloudwatch:PutMetricAlarm",
      "cloudwatch:DeleteAlarms",
      "cloudwatch:DescribeAlarms",
      "cloudwatch:PutMetricData",
      "cloudwatch:ListMetrics",
      "cloudwatch:TagResource",
      "cloudwatch:UntagResource",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "SnsTenant"
    effect = "Allow"
    actions = [
      "sns:CreateTopic",
      "sns:DeleteTopic",
      "sns:SetTopicAttributes",
      "sns:GetTopicAttributes",
      "sns:Subscribe",
      "sns:Unsubscribe",
      "sns:Publish",
      "sns:ListTagsForResource",
      "sns:TagResource",
      "sns:UntagResource",
      "sns:ListTopics",
    ]
    resources = [
      "arn:${local.partition}:sns:${local.region}:${local.account_id}:${var.project_name}-*",
      "arn:${local.partition}:sns:${local.region}:${local.account_id}:company-brain-${var.project_name}-*",
    ]
  }

  # --- KMS use (via EC2 / secrets services); not key admin of other tenants ---
  statement {
    sid    = "KmsUseViaServices"
    effect = "Allow"
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:DescribeKey",
      "kms:CreateGrant",
      "kms:ListGrants",
      "kms:ListAliases",
      "kms:ListKeys",
    ]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values = [
        "ec2.${local.region}.amazonaws.com",
        "ssm.${local.region}.amazonaws.com",
        "secretsmanager.${local.region}.amazonaws.com",
        "s3.${local.region}.amazonaws.com",
        "dlm.${local.region}.amazonaws.com",
      ]
    }
  }

  # --- Artifact S3 (approved cross-account / mirror path) ---
  # GetBucketLocation is bucket-scoped and does not evaluate s3:prefix; keep it separate.
  dynamic "statement" {
    for_each = length(var.artifact_s3_bucket_arns) > 0 ? [1] : []
    content {
      sid       = "ArtifactGetBucketLocation"
      effect    = "Allow"
      actions   = ["s3:GetBucketLocation"]
      resources = var.artifact_s3_bucket_arns
    }
  }

  dynamic "statement" {
    for_each = length(var.artifact_s3_bucket_arns) > 0 ? [1] : []
    content {
      sid       = "ArtifactListBucket"
      effect    = "Allow"
      actions   = ["s3:ListBucket", "s3:ListBucketVersions"]
      resources = var.artifact_s3_bucket_arns

      condition {
        test     = "StringLike"
        variable = "s3:prefix"
        values   = var.artifact_s3_list_prefixes
      }
    }
  }

  dynamic "statement" {
    for_each = length(local.artifact_get_object_arns) > 0 ? [1] : []
    content {
      sid       = "ArtifactGetObject"
      effect    = "Allow"
      actions   = ["s3:GetObject", "s3:GetObjectVersion"]
      resources = local.artifact_get_object_arns
    }
  }
}

resource "aws_iam_role_policy" "deploy" {
  count = var.enable_deploy_permissions ? 1 : 0

  name   = "company-brain-deploy"
  role   = aws_iam_role.lanyard_deploy.id
  policy = data.aws_iam_policy_document.deploy[0].json
}

# ---------------------------------------------------------------------------
# Explicit denies — long-lived keys, cross-tenant IAM, org escape, extra ARNs
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "denies" {
  count = var.enable_cross_tenant_denies ? 1 : 0

  statement {
    sid    = "DenyCreateLongLivedCredentials"
    effect = "Deny"
    actions = [
      "iam:CreateUser",
      "iam:CreateAccessKey",
      "iam:UpdateAccessKey",
      "iam:CreateLoginProfile",
      "iam:CreateServiceSpecificCredential",
      "iam:CreateOpenIDConnectProvider",
      "iam:CreateSAMLProvider",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "DenyAssumeOtherRoles"
    effect = "Deny"
    actions = [
      "sts:AssumeRole",
      "sts:AssumeRoleWithSAML",
      "sts:AssumeRoleWithWebIdentity",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "DenyIamOutsideTenantPrefix"
    effect = "Deny"
    actions = [
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:PutRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:AttachRolePolicy",
      "iam:DetachRolePolicy",
      "iam:PassRole",
      "iam:UpdateAssumeRolePolicy",
    ]
    not_resources = [
      "arn:${local.partition}:iam::${local.account_id}:role${var.iam_path_prefix}${local.iam_name_prefix}-*",
      "arn:${local.partition}:iam::${local.account_id}:role/${local.iam_name_prefix}-*",
      "arn:${local.partition}:iam::${local.account_id}:role/aws-service-role/dlm.amazonaws.com/*",
    ]
  }

  statement {
    sid    = "DenySsmOutsideTenantPrefix"
    effect = "Deny"
    actions = [
      "ssm:PutParameter",
      "ssm:DeleteParameter",
      "ssm:DeleteParameters",
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:GetParametersByPath",
    ]
    not_resources = [
      "${local.ssm_parameter_arn_prefix}",
      "${local.ssm_parameter_arn_prefix}/*",
    ]
  }

  statement {
    sid    = "DenySecretsOutsideTenantPrefix"
    effect = "Deny"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:PutSecretValue",
      "secretsmanager:CreateSecret",
      "secretsmanager:UpdateSecret",
      "secretsmanager:DeleteSecret",
    ]
    not_resources = [
      "${local.secretsmanager_arn_prefix}-*",
      "${local.secretsmanager_arn_prefix}/*",
    ]
  }

  dynamic "statement" {
    for_each = length(var.additional_deny_resource_arns) > 0 ? [1] : []
    content {
      sid       = "DenyAdditionalCrossTenantResources"
      effect    = "Deny"
      actions   = ["*"]
      resources = var.additional_deny_resource_arns
    }
  }

  statement {
    sid    = "DenyLeaveAccountAndOrg"
    effect = "Deny"
    actions = [
      "organizations:LeaveOrganization",
      "iam:UpdateAccountPasswordPolicy",
      "iam:CreateAccountAlias",
      "iam:DeleteAccountAlias",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "denies" {
  count = var.enable_cross_tenant_denies ? 1 : 0

  name   = "company-brain-cross-tenant-denies"
  role   = aws_iam_role.lanyard_deploy.id
  policy = data.aws_iam_policy_document.denies[0].json
}

# Honesty: this module is not auto-applied from examples.
check "acknowledge_not_auto_applied" {
  assert {
    condition     = var.acknowledge_not_auto_applied == true
    error_message = "customer-account-access requires acknowledge_not_auto_applied=true (operator-owned Track B apply)."
  }
}
