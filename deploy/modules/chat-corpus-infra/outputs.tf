output "corpus_bucket_id" {
  description = "S3 bucket name for the L10 chat corpus."
  value       = aws_s3_bucket.corpus.id
}

output "corpus_bucket_arn" {
  description = "S3 bucket ARN for the L10 chat corpus."
  value       = aws_s3_bucket.corpus.arn
}

output "corpus_bucket_region" {
  description = "Region of the corpus bucket (for s3:// URL construction)."
  value       = aws_s3_bucket.corpus.region
}

output "corpus_prefix_template" {
  description = "Normative object key prefix template (tenants/{tenant_id}/chat-corpus/v1/)."
  value       = var.corpus_prefix_template
}

output "object_key_template" {
  description = "Full turn-object key template for CorpusWriter (lp-gkh.4)."
  value       = "tenants/{tenant_id}/chat-corpus/v1/year={YYYY}/month={MM}/day={DD}/thread={thread_id}/turn={turn_id}.json"
}

output "corpus_sse" {
  description = "Server-side encryption settings."
  value = {
    algorithm   = var.s3_sse_algorithm
    kms_key_set = local.effective_kms_key_id != null
    kms_key_id  = local.effective_kms_key_id
  }
}

output "kms_key_arn" {
  description = "CMK ARN when create_kms_key created one; otherwise null or the input key."
  value       = local.effective_kms_key_id
}

output "retention_days" {
  description = "Lifecycle expiration days for corpus objects under tenants/."
  value       = var.retention_days
}

output "lifecycle_summary" {
  description = "Documented lifecycle rules for operator runbooks."
  value = {
    expire_current_objects_days     = var.retention_days
    expire_noncurrent_versions      = var.s3_versioning_enabled && var.s3_noncurrent_version_expiration_days > 0
    noncurrent_expiration_days      = var.s3_noncurrent_version_expiration_days
    abort_incomplete_multipart_days = var.s3_abort_incomplete_multipart_days
    filter_prefix                   = "tenants/"
    notes = [
      "L10 default TTL is 90 days (lp-gkh.1); floor 30 days.",
      "Legal hold suspends deletion under ops process — not automated here.",
      "chat_corpus_enabled=false stops new writes; existing objects still expire via lifecycle.",
      "Dedicated bucket: do not store vault objects here.",
    ]
  }
}

output "writer_role_arn" {
  description = "IAM role ARN for CorpusWriter (empty when create_iam_roles is false)."
  value       = try(aws_iam_role.writer[0].arn, null)
}

output "writer_role_name" {
  description = "IAM role name for CorpusWriter."
  value       = try(aws_iam_role.writer[0].name, null)
}

output "reader_role_arn" {
  description = "IAM role ARN for training export reader (empty when create_iam_roles is false)."
  value       = try(aws_iam_role.reader[0].arn, null)
}

output "reader_role_name" {
  description = "IAM role name for training export reader."
  value       = try(aws_iam_role.reader[0].name, null)
}

output "writer_policy_json" {
  description = "Writer policy document JSON (for attach-to-existing-role or lab review)."
  value       = data.aws_iam_policy_document.writer.json
}

output "reader_policy_json" {
  description = "Reader policy document JSON (for attach-to-existing-role or lab review)."
  value       = data.aws_iam_policy_document.reader.json
}

output "deny_vault_resources" {
  description = "Object ARN patterns explicitly denied for corpus roles (vault blast-radius wall)."
  value       = local.deny_vault_resources
}

output "public_access_blocked" {
  description = "Always true: all four S3 Block Public Access flags are on."
  value       = true
}

output "contract_summary" {
  description = "Machine-readable L10 corpus infra contract (lp-gkh.3)."
  value = {
    bead                   = "lp-gkh.3"
    plan                   = "0011-tenant-chat-corpus"
    bucket                 = aws_s3_bucket.corpus.id
    separate_from_vault    = true
    prefix_template        = var.corpus_prefix_template
    object_key_template    = "tenants/{tenant_id}/chat-corpus/v1/year={YYYY}/month={MM}/day={DD}/thread={thread_id}/turn={turn_id}.json"
    sse_algorithm          = var.s3_sse_algorithm
    retention_days         = var.retention_days
    public_access_blocked  = true
    tls_only_bucket_policy = true
    writer_actions         = ["s3:PutObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts", "s3:ListBucket", "s3:GetBucketLocation"]
    reader_actions         = ["s3:GetObject", "s3:GetObjectVersion", "s3:ListBucket", "s3:GetBucketLocation"]
    vault_paths_denied     = true
    create_iam_roles       = var.create_iam_roles
    gated_not_provided = [
      "live_apply_to_lab_or_staging",
      "bff_corpus_writer_implementation_lp-gkh.4",
      "training_export_cli_lp-gkh.8",
      "per_tenant_sts_session_policies",
      "chat_corpus_enabled_cp_fields_lp-gkh.6",
    ]
  }
}
