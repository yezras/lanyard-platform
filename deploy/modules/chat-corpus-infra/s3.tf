# Dedicated L10 chat corpus bucket — separate from vault (blast radius).
# Layout: tenants/{tenant_id}/chat-corpus/v1/...
# See docs/plans/0011-tenant-chat-corpus/infra-bucket-iam-lifecycle.md

resource "aws_s3_bucket" "corpus" {
  bucket        = var.corpus_bucket_name
  force_destroy = var.s3_force_destroy

  tags = merge(local.common_tags, {
    Name    = var.corpus_bucket_name
    Purpose = "l10-chat-corpus"
  })
}

resource "aws_s3_bucket_versioning" "corpus" {
  bucket = aws_s3_bucket.corpus.id

  versioning_configuration {
    status = var.s3_versioning_enabled ? "Enabled" : "Suspended"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "corpus" {
  bucket = aws_s3_bucket.corpus.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = var.s3_sse_algorithm
      kms_master_key_id = local.effective_kms_key_id
    }
    bucket_key_enabled = var.s3_sse_algorithm == "aws:kms"
  }
}

resource "aws_s3_bucket_public_access_block" "corpus" {
  bucket = aws_s3_bucket.corpus.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "corpus" {
  bucket = aws_s3_bucket.corpus.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# Lifecycle: L10 retention on chat-corpus objects + hygiene rules.
# Default TTL 90d (lp-gkh.1). Legal hold is ops process, not TF.
resource "aws_s3_bucket_lifecycle_configuration" "corpus" {
  bucket = aws_s3_bucket.corpus.id

  depends_on = [aws_s3_bucket_versioning.corpus]

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"

    filter {
      prefix = ""
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = var.s3_abort_incomplete_multipart_days
    }
  }

  rule {
    id     = "expire-chat-corpus-objects"
    status = "Enabled"

    filter {
      # All tenants' corpus trees share the mid-path segment.
      # S3 lifecycle filter is prefix-based; tenants/*/ is not a wild-card,
      # so we filter on the empty prefix and document that non-corpus keys
      # must not be stored in this dedicated bucket. (Separate-from-vault.)
      prefix = "tenants/"
    }

    expiration {
      days = var.retention_days
    }
  }

  dynamic "rule" {
    for_each = var.s3_versioning_enabled && var.s3_noncurrent_version_expiration_days > 0 ? [1] : []
    content {
      id     = "expire-noncurrent-versions"
      status = "Enabled"

      filter {
        prefix = "tenants/"
      }

      noncurrent_version_expiration {
        noncurrent_days = var.s3_noncurrent_version_expiration_days
      }
    }
  }
}

# Optional dedicated CMK (prod isolation from vault / shared keys).
resource "aws_kms_key" "corpus" {
  count = local.use_module_kms ? 1 : 0

  description             = "L10 chat corpus SSE-KMS for ${var.name_prefix}"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = merge(local.common_tags, { Name = "${var.name_prefix}-chat-corpus-kms" })
}

resource "aws_kms_alias" "corpus" {
  count = local.use_module_kms ? 1 : 0

  name          = "alias/${var.name_prefix}-chat-corpus"
  target_key_id = aws_kms_key.corpus[0].key_id
}

# ---------------------------------------------------------------------------
# Bucket policy hardening
#   1. Deny non-TLS
#   2. Deny public ACL grants on PutObject
# ---------------------------------------------------------------------------

locals {
  corpus_bucket_policy_statements = [
    {
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource = [
        aws_s3_bucket.corpus.arn,
        "${aws_s3_bucket.corpus.arn}/*",
      ]
      Condition = {
        Bool = {
          "aws:SecureTransport" = "false"
        }
      }
    },
    {
      Sid       = "DenyPublicObjectAcls"
      Effect    = "Deny"
      Principal = "*"
      Action = [
        "s3:PutObject",
        "s3:PutObjectAcl",
      ]
      Resource = ["${aws_s3_bucket.corpus.arn}/*"]
      Condition = {
        StringEquals = {
          "s3:x-amz-acl" = [
            "public-read",
            "public-read-write",
            "authenticated-read",
          ]
        }
      }
    },
  ]
}

resource "aws_s3_bucket_policy" "corpus" {
  bucket = aws_s3_bucket.corpus.id

  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = local.corpus_bucket_policy_statements
  })

  depends_on = [aws_s3_bucket_public_access_block.corpus]
}
