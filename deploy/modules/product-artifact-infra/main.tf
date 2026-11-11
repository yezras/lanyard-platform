locals {
  common_tags = merge(
    {
      Project     = "company-brain-deploy"
      Component   = "product-artifact-infra"
      Environment = var.environment
      ManagedBy   = "terraform"
    },
    var.tags,
  )

  # Normalize prefixes (ensure trailing slash; strip accidental leading slash)
  hermes_prefix_raw      = trimprefix(coalesce(var.artifact_prefixes.hermes, "hermes/"), "/")
  client_core_prefix_raw = trimprefix(coalesce(var.artifact_prefixes.client_core, "client-core/"), "/")
  portal_web_prefix_raw  = trimprefix(coalesce(var.artifact_prefixes.portal_web, "portal-web/"), "/")
  hermes_prefix          = endswith(local.hermes_prefix_raw, "/") ? local.hermes_prefix_raw : "${local.hermes_prefix_raw}/"
  client_core_prefix = (
    endswith(local.client_core_prefix_raw, "/") ? local.client_core_prefix_raw : "${local.client_core_prefix_raw}/"
  )
  portal_web_prefix = (
    endswith(local.portal_web_prefix_raw, "/") ? local.portal_web_prefix_raw : "${local.portal_web_prefix_raw}/"
  )

  prefix_by_key = {
    hermes      = local.hermes_prefix
    client_core = local.client_core_prefix
    portal_web  = local.portal_web_prefix
  }

  ecr_repository_names = {
    for svc in var.portal_services :
    svc => "${var.name_prefix}/portal/${svc}"
  }

  # Fail closed if OIDC publishers enabled without provider ARN
  oidc_enabled = var.enable_oidc_publishers

  publishers = local.oidc_enabled ? var.publisher_repos : {}

  # Default trust: release tags only for each product repo
  publisher_subjects = {
    for k, v in local.publishers :
    k => length(coalesce(v.subjects, [])) > 0 ? v.subjects : [
      "repo:${var.github_org}/${v.repository}:ref:refs/tags/*"
    ]
  }

  # Map publisher → S3 prefix strings they may write
  publisher_s3_prefixes = {
    for k, v in local.publishers :
    k => [
      for pk in coalesce(v.s3_write_prefix_keys, []) :
      local.prefix_by_key[pk]
    ]
  }

  # Map publisher → ECR service keys they may push
  publisher_ecr_services = {
    for k, v in local.publishers :
    k => [
      for svc in coalesce(v.ecr_push_services, []) :
      svc if contains(var.portal_services, svc)
    ]
  }
}

# Guard: OIDC requires an existing provider ARN (module never creates the provider).
check "oidc_provider_required_when_enabled" {
  assert {
    condition     = !var.enable_oidc_publishers || (var.github_oidc_provider_arn != null && var.github_oidc_provider_arn != "")
    error_message = "enable_oidc_publishers=true requires github_oidc_provider_arn set to an existing OIDC provider ARN (this module does not create the provider)."
  }
}

# Guard: no publisher may request ECR services outside portal_services.
check "publisher_ecr_subset_of_portal_services" {
  assert {
    condition = alltrue(flatten([
      for k, v in var.publisher_repos : [
        for svc in coalesce(v.ecr_push_services, []) :
        contains(var.portal_services, svc)
      ]
    ]))
    error_message = "publisher_repos.*.ecr_push_services must be a subset of portal_services."
  }
}

# Guard: customer-managed KMS is preferred when SSE is aws:kms (null uses AWS-managed aws/s3).
# Soft guidance only: null remains valid for deliberate AWS-managed use; README documents key policy.
check "kms_key_recommended_when_sse_kms" {
  assert {
    condition = (
      var.s3_sse_algorithm != "aws:kms" ||
      (var.s3_kms_key_id != null && var.s3_kms_key_id != "")
    )
    error_message = "s3_sse_algorithm=aws:kms without s3_kms_key_id uses the AWS-managed aws/s3 key. Prefer a customer-managed CMK ARN in s3_kms_key_id and least-privilege key policy for publishers and brain-host readers (see module README)."
  }
}
