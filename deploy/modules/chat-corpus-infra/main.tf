locals {
  common_tags = merge(
    {
      Name        = var.name_prefix
      Environment = var.environment
      Purpose     = "l10-chat-corpus"
      Plan        = "0011-tenant-chat-corpus"
      Bead        = "lp-gkh.3"
    },
    var.tags,
  )

  # Canonical prefix fragments (normative layout lock).
  # Full object key example:
  #   tenants/{tenant_id}/chat-corpus/v1/year=YYYY/month=MM/day=DD/thread={tid}/turn={turn_id}.json
  corpus_prefix_root = "tenants/"
  corpus_prefix_mid  = "chat-corpus/v1/"

  # ListBucket conditions: any tenant's corpus tree (platform writer/reader).
  # Per-tenant STS session policies (future) may narrow to one tenant_id.
  list_prefix_values = [
    "tenants/",
    "tenants/*",
    "tenants/*/chat-corpus/",
    "tenants/*/chat-corpus/*",
    "tenants/*/chat-corpus/v1/",
    "tenants/*/chat-corpus/v1/*",
  ]

  object_resource_arns = [
    "${aws_s3_bucket.corpus.arn}/tenants/*/chat-corpus/v1/*",
  ]

  # Deny vault paths on this bucket (if colocated by mistake) and configured patterns.
  deny_vault_resources = distinct(concat(
    [
      "${aws_s3_bucket.corpus.arn}/tenants/*/vault",
      "${aws_s3_bucket.corpus.arn}/tenants/*/vault/*",
    ],
    var.vault_object_arn_patterns,
  ))

  use_module_kms = var.create_kms_key && var.s3_sse_algorithm == "aws:kms" && (var.s3_kms_key_id == null || var.s3_kms_key_id == "")

  effective_kms_key_id = (
    var.s3_sse_algorithm == "aws:kms"
    ? (local.use_module_kms ? aws_kms_key.corpus[0].arn : var.s3_kms_key_id)
    : null
  )
}

check "kms_when_aws_kms" {
  assert {
    condition = (
      var.s3_sse_algorithm != "aws:kms" ||
      local.use_module_kms ||
      (var.s3_kms_key_id != null && var.s3_kms_key_id != "")
    )
    error_message = "When s3_sse_algorithm is aws:kms, set s3_kms_key_id or create_kms_key = true."
  }
}

check "corpus_prefix_template_v1" {
  assert {
    condition     = var.corpus_prefix_template == "tenants/{tenant_id}/chat-corpus/v1/"
    error_message = "corpus_prefix_template must remain tenants/{tenant_id}/chat-corpus/v1/ for v1 layout lock."
  }
}
