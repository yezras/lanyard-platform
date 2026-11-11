# Writer: CorpusWriter (BFF) — PutObject on corpus prefix only.
# Reader: training export (lp-gkh.8) — List/Get on corpus prefix only.
# Both: explicit Deny on vault paths (blast-radius wall vs vault bucket/prefix).
#
# Roles are created only when create_iam_roles=true AND principal ARNs are set
# (fail-closed: empty trust is never applied). Policy JSON is always available
# via outputs for attach-to-existing-role / lab review.

locals {
  create_writer_role = var.create_iam_roles && length(var.writer_principal_arns) > 0
  create_reader_role = var.create_iam_roles && length(var.reader_principal_arns) > 0
}

data "aws_iam_policy_document" "writer_assume" {
  count = local.create_writer_role ? 1 : 0

  statement {
    sid     = "AllowWriterPrincipals"
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "AWS"
      identifiers = var.writer_principal_arns
    }
  }
}

data "aws_iam_policy_document" "reader_assume" {
  count = local.create_reader_role ? 1 : 0

  statement {
    sid     = "AllowReaderPrincipals"
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "AWS"
      identifiers = var.reader_principal_arns
    }
  }
}

# Shared deny wall: vault paths must never be reachable via corpus roles.
data "aws_iam_policy_document" "deny_vault_paths" {
  statement {
    sid    = "DenyVaultPathsBlastRadius"
    effect = "Deny"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:DeleteObjectVersion",
      "s3:ListBucket",
      "s3:ListBucketVersions",
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts",
    ]
    resources = local.deny_vault_resources
  }

  statement {
    sid    = "DenyListVaultPrefixOnCorpusBucket"
    effect = "Deny"
    actions = [
      "s3:ListBucket",
      "s3:ListBucketVersions",
    ]
    resources = [aws_s3_bucket.corpus.arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values = [
        "tenants/*/vault",
        "tenants/*/vault/",
        "tenants/*/vault/*",
      ]
    }
  }
}

data "aws_iam_policy_document" "writer" {
  source_policy_documents = [data.aws_iam_policy_document.deny_vault_paths.json]

  statement {
    sid    = "ListCorpusPrefixesOnly"
    effect = "Allow"
    actions = [
      "s3:ListBucket",
      "s3:GetBucketLocation",
    ]
    resources = [aws_s3_bucket.corpus.arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = local.list_prefix_values
    }
  }

  statement {
    sid    = "PutCorpusObjectsOnly"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts",
    ]
    resources = local.object_resource_arns
  }

  # Writer must not Get/Delete corpus objects (append-oriented; ops/reader for reads).
  # Idempotent overwrite of same turn key is allowed via PutObject only.
}

data "aws_iam_policy_document" "reader" {
  source_policy_documents = [data.aws_iam_policy_document.deny_vault_paths.json]

  statement {
    sid    = "ListCorpusPrefixesOnly"
    effect = "Allow"
    actions = [
      "s3:ListBucket",
      "s3:GetBucketLocation",
    ]
    resources = [aws_s3_bucket.corpus.arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = local.list_prefix_values
    }
  }

  statement {
    sid    = "GetCorpusObjectsOnly"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
    ]
    resources = local.object_resource_arns
  }
}

resource "aws_iam_role" "writer" {
  count = local.create_writer_role ? 1 : 0

  name               = "${var.name_prefix}-chat-corpus-writer"
  assume_role_policy = data.aws_iam_policy_document.writer_assume[0].json
  description        = "L10 chat corpus writer (CorpusWriter PutObject on tenants/*/chat-corpus/v1/* only)"
  tags               = merge(local.common_tags, { Name = "${var.name_prefix}-chat-corpus-writer", Role = "corpus-writer" })
}

resource "aws_iam_role" "reader" {
  count = local.create_reader_role ? 1 : 0

  name               = "${var.name_prefix}-chat-corpus-reader"
  assume_role_policy = data.aws_iam_policy_document.reader_assume[0].json
  description        = "L10 chat corpus reader (training export List/Get on tenants/*/chat-corpus/v1/* only)"
  tags               = merge(local.common_tags, { Name = "${var.name_prefix}-chat-corpus-reader", Role = "corpus-reader" })
}

resource "aws_iam_role_policy" "writer" {
  count = local.create_writer_role ? 1 : 0

  name   = "${var.name_prefix}-chat-corpus-writer"
  role   = aws_iam_role.writer[0].id
  policy = data.aws_iam_policy_document.writer.json
}

resource "aws_iam_role_policy" "reader" {
  count = local.create_reader_role ? 1 : 0

  name   = "${var.name_prefix}-chat-corpus-reader"
  role   = aws_iam_role.reader[0].id
  policy = data.aws_iam_policy_document.reader.json
}

# Optional KMS grants for writer/reader when using SSE-KMS.
data "aws_iam_policy_document" "kms_use" {
  count = (local.create_writer_role || local.create_reader_role) && var.s3_sse_algorithm == "aws:kms" && local.effective_kms_key_id != null ? 1 : 0

  statement {
    sid    = "UseCorpusKmsKey"
    effect = "Allow"
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:GenerateDataKey",
      "kms:DescribeKey",
    ]
    resources = [local.effective_kms_key_id]
  }
}

resource "aws_iam_role_policy" "writer_kms" {
  count = local.create_writer_role && var.s3_sse_algorithm == "aws:kms" && local.effective_kms_key_id != null ? 1 : 0

  name   = "${var.name_prefix}-chat-corpus-writer-kms"
  role   = aws_iam_role.writer[0].id
  policy = data.aws_iam_policy_document.kms_use[0].json
}

resource "aws_iam_role_policy" "reader_kms" {
  count = local.create_reader_role && var.s3_sse_algorithm == "aws:kms" && local.effective_kms_key_id != null ? 1 : 0

  name   = "${var.name_prefix}-chat-corpus-reader-kms"
  role   = aws_iam_role.reader[0].id
  policy = data.aws_iam_policy_document.kms_use[0].json
}
