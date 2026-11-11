# Shared base role for Daytona sandbox vault Mountpoint (lp-zuh.9.1).
#
# Delivery model (path A — iam-scoped-s3-mount-policy.md):
#   CP task role → sts:AssumeRole(this role) + **session policy** locking one
#   tenants/{tenant_id}/vault/ prefix → inject short-lived AWS_* into sandbox.
#
# Identity policy here is an **upper bound** for all tenant vault trees so a
# session policy can narrow (session policies only restrict). Isolation SoT
# is the per-wake session policy template (templates/session-policy.json +
# docs drafts/iam/sandbox-vault-mount-session-policy.json). CP must always
# attach a session policy (lp-zuh.9.2). Missing session still cannot touch
# _platform or non-vault keys, but could reach other tenants' vault trees —
# treat always-on session policy as required.
#
# No long-lived access keys. No secrets in git.

data "aws_iam_policy_document" "trust" {
  count = local.create_role ? 1 : 0

  statement {
    sid     = "OrchestratorAssumeOnly"
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "AWS"
      identifiers = var.orchestrator_principal_arns
    }

    dynamic "condition" {
      for_each = local.external_id_effective != null ? [1] : []
      content {
        test     = "StringEquals"
        variable = "sts:ExternalId"
        values   = [local.external_id_effective]
      }
    }
  }
}

# Upper-bound identity: any tenants/*/vault/* on the configured vault bucket.
data "aws_iam_policy_document" "base_identity" {
  statement {
    sid    = "ListVaultPrefixesUpperBound"
    effect = "Allow"
    actions = [
      "s3:ListBucket",
      "s3:GetBucketLocation",
    ]
    resources = [local.vault_bucket_arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = local.list_prefix_values_upper
    }
  }

  statement {
    sid    = "ObjectRWVaultPrefixesUpperBound"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts",
    ]
    resources = [local.vault_object_arn_upper]
  }

  statement {
    sid       = "DenyListBucketWithoutPrefix"
    effect    = "Deny"
    actions   = ["s3:ListBucket"]
    resources = [local.vault_bucket_arn]
    condition {
      test     = "Null"
      variable = "s3:prefix"
      values   = ["true"]
    }
  }

  statement {
    sid       = "DenyListBucketOutsideVaultTrees"
    effect    = "Deny"
    actions   = ["s3:ListBucket"]
    resources = [local.vault_bucket_arn]
    condition {
      test     = "StringNotLike"
      variable = "s3:prefix"
      values = [
        "tenants/*/vault/",
        "tenants/*/vault/*",
      ]
    }
  }

  statement {
    sid       = "DenyPlatformSiblingUnderTenant"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = local.platform_deny_resources
  }
}

# Inline policy document for CP task role: AssumeRole on the base mount role only.
data "aws_iam_policy_document" "orchestrator_assume" {
  count = local.create_role ? 1 : 0

  statement {
    sid    = "AssumeSandboxVaultMountRole"
    effect = "Allow"
    actions = [
      "sts:AssumeRole",
      "sts:TagSession",
    ]
    resources = [aws_iam_role.mount[0].arn]
  }
}

resource "aws_iam_role" "mount" {
  count = local.create_role ? 1 : 0

  name                 = var.role_name
  assume_role_policy   = data.aws_iam_policy_document.trust[0].json
  description          = "Shared base role for Daytona sandbox vault Mountpoint; scope via STS session policy per tenant (lp-zuh.9.1). No long-lived keys."
  max_session_duration = var.max_session_duration
  tags                 = local.common_tags
}

resource "aws_iam_role_policy" "mount_identity" {
  count = local.create_role ? 1 : 0

  name   = "${var.role_name}-identity"
  role   = aws_iam_role.mount[0].id
  policy = data.aws_iam_policy_document.base_identity.json
}

# Attach AssumeRole grant to each orchestrator role principal (CP task role).
resource "aws_iam_role_policy" "orchestrator_assume" {
  for_each = local.attach_assume ? toset(local.orchestrator_role_names) : toset([])

  name   = "${var.role_name}-assume"
  role   = each.value
  policy = data.aws_iam_policy_document.orchestrator_assume[0].json
}
