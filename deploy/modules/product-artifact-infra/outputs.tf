output "artifact_bucket_id" {
  description = "S3 bucket name for product release tarballs (Hermes + client-core + portal-web)."
  value       = aws_s3_bucket.artifacts.id
}

output "artifact_bucket_arn" {
  description = "S3 bucket ARN for product release tarballs."
  value       = aws_s3_bucket.artifacts.arn
}

output "artifact_bucket_region" {
  description = "Region of the artifact bucket (for s3:// URL construction)."
  value       = aws_s3_bucket.artifacts.region
}

output "artifact_bucket_object_lock_enabled" {
  description = "Always true: Object Lock is enabled at bucket creation for immutable release artifacts."
  value       = aws_s3_bucket.artifacts.object_lock_enabled
}

output "artifact_bucket_object_lock_default_retention" {
  description = "Default Object Lock retention applied to new objects (mode + days)."
  value = {
    mode = var.s3_object_lock_default_retention_mode
    days = var.s3_object_lock_default_retention_days
  }
}

output "artifact_bucket_tls_only" {
  description = "Always true: bucket policy denies s3:* when aws:SecureTransport is false."
  value       = true
}

output "artifact_bucket_vpc_endpoint_restriction" {
  description = "Optional VPC endpoint restriction status (empty allow-list = unrestricted public S3 API path; still private via PAB + IAM)."
  value = {
    enabled                = length(var.s3_vpc_endpoint_ids) > 0
    vpc_endpoint_ids       = var.s3_vpc_endpoint_ids
    exempt_principal_count = length(local.s3_vpc_endpoint_exempt_arns)
  }
}

output "artifact_bucket_sse" {
  description = "Server-side encryption settings for the artifact bucket."
  value = {
    algorithm   = var.s3_sse_algorithm
    kms_key_set = var.s3_kms_key_id != null && var.s3_kms_key_id != ""
  }
}

output "artifact_prefixes" {
  description = "Normalized product object key prefixes (trailing slash)."
  value = {
    hermes      = local.hermes_prefix
    client_core = local.client_core_prefix
    portal_web  = local.portal_web_prefix
  }
}

output "hermes_artifact_url_template" {
  description = "Operator template for hermes pin URL (replace VERSION and FILENAME)."
  value       = "s3://${aws_s3_bucket.artifacts.id}/${local.hermes_prefix}<VERSION>/<FILENAME>"
}

output "client_core_artifact_url_template" {
  description = "Operator template for client-core pin URL (replace VERSION and FILENAME)."
  value       = "s3://${aws_s3_bucket.artifacts.id}/${local.client_core_prefix}<VERSION>/<FILENAME>"
}

output "portal_web_artifact_url_template" {
  description = "Operator template for portal-web pin URL (replace VERSION; object is portal-web.tar.gz)."
  value       = "s3://${aws_s3_bucket.artifacts.id}/${local.portal_web_prefix}<VERSION>/portal-web.tar.gz"
}

output "ecr_repository_urls" {
  description = "Map of portal service → ECR repository URL (digest-pin at deploy)."
  value = {
    for k, r in aws_ecr_repository.portal :
    k => r.repository_url
  }
}

output "ecr_repository_arns" {
  description = "Map of portal service → ECR repository ARN."
  value = {
    for k, r in aws_ecr_repository.portal :
    k => r.arn
  }
}

output "ecr_repository_names" {
  description = "Map of portal service → ECR repository name."
  value = {
    for k, r in aws_ecr_repository.portal :
    k => r.name
  }
}

output "oidc_publisher_role_arns" {
  description = "Map of publisher key → IAM role ARN (empty when enable_oidc_publishers is false)."
  value = {
    for k, r in aws_iam_role.publisher :
    k => r.arn
  }
}

output "oidc_publisher_role_names" {
  description = "Map of publisher key → IAM role name."
  value = {
    for k, r in aws_iam_role.publisher :
    k => r.name
  }
}

output "oidc_publisher_trust_subjects" {
  description = "Effective OIDC sub claim patterns per publisher (default: release tags only)."
  value       = local.publisher_subjects
}

output "release_contract_summary" {
  description = "Machine-readable summary of the deploy-facing release contract this module enables."
  value = {
    s3_bucket              = aws_s3_bucket.artifacts.id
    hermes_prefix          = local.hermes_prefix
    client_core_prefix     = local.client_core_prefix
    portal_web_prefix      = local.portal_web_prefix
    s3_versioning          = "Enabled"
    s3_object_lock_enabled = true
    s3_object_lock_default_retention = {
      mode = var.s3_object_lock_default_retention_mode
      days = var.s3_object_lock_default_retention_days
    }
    s3_force_destroy            = var.s3_force_destroy
    s3_tls_only                 = true
    s3_vpc_endpoint_restriction = length(var.s3_vpc_endpoint_ids) > 0
    s3_sse_algorithm            = var.s3_sse_algorithm
    portal_services             = var.portal_services
    ecr_tag_mutability          = "IMMUTABLE"
    oidc_publishers_on          = var.enable_oidc_publishers
    deploy_pins_require = [
      "portal.images.*.repository + digest (sha256:…)",
      "portal.web.version + sha256 + url (static web artifact)",
      "hermes.version + sha256 + url",
      "client_core.version + sha256 + url",
      "relay_contract.major",
    ]
    gated_not_provided = [
      "portal_ecs_or_service_deployment",
      "control_plane_rds_postgres_see_modules_control_plane_rds",
      "product_repo_release_workflows",
      "portal_static_web_packaging_and_publish",
    ]
  }
}
