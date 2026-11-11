terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    local = {
      source  = "hashicorp/local"
      version = ">= 2.4.0"
    }
  }
}

# ---------------------------------------------------------------------------
# AWS provider — optional assume-role into the tenant / customer account
#
# Track A (lanyard_hosted): set deploy_role_arn from modules/account-factory
#   output deploy_role_arn (after create_account_baseline). Optional ExternalId
#   when the factory role trust was configured with deploy_role_external_id.
#
# Track B (customer_account): set deploy_role_arn from
#   modules/customer-account-access output role_arn AND deploy_role_external_id
#   from the Lanyard secret store (external_id_parameter_name — never git).
#
# Operators may instead SSO directly into the target account and leave
# deploy_role_arn null (no assume_role block). Never put long-lived access keys
# in provider blocks or tfvars.
#
# Dual-alias pattern (platform + tenant) is documented in providers.tf.example
# for roots that also touch Lanyard platform resources in the same tree.
# ---------------------------------------------------------------------------

provider "aws" {
  region = var.region

  dynamic "assume_role" {
    for_each = local.use_deploy_role ? [1] : []
    content {
      role_arn     = var.deploy_role_arn
      session_name = local.deploy_role_session_name
      external_id  = local.deploy_role_external_id_effective
      duration     = "${var.deploy_role_session_duration_seconds}s"

      # Session tags only when enable_deploy_role_session_tags (Track B default on).
      tags = (
        length(local.deploy_role_session_tags_effective) > 0
        ? local.deploy_role_session_tags_effective
        : null
      )
      transitive_tag_keys = (
        length(local.deploy_role_session_tags_effective) > 0
        ? keys(local.deploy_role_session_tags_effective)
        : null
      )
    }
  }
}
