# Object Lock must be enabled at bucket creation (cannot be added later).
# Combined with versioning + default retention, this is the real immutability
# contract: S3 versioning alone still allows a new current version on the same key.
resource "aws_s3_bucket" "artifacts" {
  bucket              = var.artifact_bucket_name
  force_destroy       = var.s3_force_destroy
  object_lock_enabled = true

  tags = merge(local.common_tags, {
    Name    = var.artifact_bucket_name
    Purpose = "product-release-artifacts"
  })
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  versioning_configuration {
    status = "Enabled"
  }
}

# Default retention applies to new objects. Lifecycle noncurrent expiration cannot
# delete a locked object version until its retention period ends (Object Lock wins).
resource "aws_s3_bucket_object_lock_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    default_retention {
      mode = var.s3_object_lock_default_retention_mode
      days = var.s3_object_lock_default_retention_days
    }
  }

  depends_on = [aws_s3_bucket_versioning.artifacts]
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = var.s3_sse_algorithm
      kms_master_key_id = var.s3_sse_algorithm == "aws:kms" ? var.s3_kms_key_id : null
    }
    bucket_key_enabled = var.s3_sse_algorithm == "aws:kms"
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  depends_on = [aws_s3_bucket_versioning.artifacts]

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

  dynamic "rule" {
    for_each = var.s3_noncurrent_version_expiration_days > 0 ? [1] : []
    content {
      id     = "expire-noncurrent-versions"
      status = "Enabled"

      filter {
        prefix = ""
      }

      noncurrent_version_expiration {
        noncurrent_days = var.s3_noncurrent_version_expiration_days
      }
    }
  }
}

# ---------------------------------------------------------------------------
# Bucket policy hardening
#   1. Always deny non-TLS (aws:SecureTransport=false)
#   2. Optional: deny requests not via allowed VPC endpoints (advanced;
#      auto-exempts OIDC publisher roles + explicit exempt principal ARNs so
#      GitHub Actions publishers and operator admin roles are not locked out)
# ---------------------------------------------------------------------------

locals {
  # OIDC publisher roles (when enabled): cover both the IAM role ARN and the
  # sts:assumed-role session ARN pattern used by AssumeRoleWithWebIdentity.
  s3_vpc_endpoint_publisher_exempt_arns = flatten([
    for r in aws_iam_role.publisher : [
      r.arn,
      "arn:aws:sts::${split(":", r.arn)[4]}:assumed-role/${r.name}/*",
    ]
  ])

  # Operator-supplied exempt ARNs: if an IAM role ARN is given, also exempt
  # assumed-role sessions for that role name so CLI/console sessions match.
  # Assumed-role ARNs use the role *name* (final path segment), not the IAM path.
  s3_vpc_endpoint_operator_exempt_arns = flatten([
    for arn in var.s3_vpc_endpoint_exempt_principal_arns : (
      can(regex("^arn:aws:iam::[0-9]{12}:role/.+$", arn)) ? [
        arn,
        "arn:aws:sts::${split(":", arn)[4]}:assumed-role/${element(split("/", arn), length(split("/", arn)) - 1)}/*",
      ] : [arn]
    )
  ])

  # Principals that may reach the bucket without a matching SourceVpce when
  # s3_vpc_endpoint_ids is non-empty.
  s3_vpc_endpoint_exempt_arns = distinct(concat(
    local.s3_vpc_endpoint_operator_exempt_arns,
    local.s3_vpc_endpoint_publisher_exempt_arns,
  ))

  artifact_bucket_policy_statements = concat(
    [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.artifacts.arn,
          "${aws_s3_bucket.artifacts.arn}/*",
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      },
    ],
    length(var.s3_vpc_endpoint_ids) > 0 ? [
      {
        Sid       = "DenyRequestsOutsideAllowedVPCEndpoints"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.artifacts.arn,
          "${aws_s3_bucket.artifacts.arn}/*",
        ]
        # Deny when SourceVpce is not in the allow-list AND principal is not exempt.
        # Multiple condition operators are ANDed. StringNotEquals multi-value is true
        # when the request value matches none of the list. ArnNotLike supports
        # assumed-role/* session patterns for temporary credentials.
        Condition = merge(
          {
            StringNotEquals = {
              "aws:SourceVpce" = var.s3_vpc_endpoint_ids
            }
          },
          length(local.s3_vpc_endpoint_exempt_arns) > 0 ? {
            ArnNotLike = {
              "aws:PrincipalArn" = local.s3_vpc_endpoint_exempt_arns
            }
          } : {},
        )
      },
    ] : [],
  )
}

resource "aws_s3_bucket_policy" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = local.artifact_bucket_policy_statements
  })

  # Public access block must exist first so block_public_policy does not race
  # with the first policy put (still fully private; this policy only denies).
  depends_on = [aws_s3_bucket_public_access_block.artifacts]
}
