output "role_arn" {
  description = "Customer IAM role ARN for Lanyard sts:AssumeRole (Track B deploy)."
  value       = aws_iam_role.lanyard_deploy.arn
}

output "role_name" {
  description = "Customer IAM role name."
  value       = aws_iam_role.lanyard_deploy.name
}

output "role_path" {
  description = "IAM path of the deploy role."
  value       = aws_iam_role.lanyard_deploy.path
}

output "permissions_boundary_arn" {
  description = "Permissions boundary policy ARN (null when create_permissions_boundary=false)."
  value       = try(aws_iam_policy.permissions_boundary[0].arn, null)
}

output "external_id_parameter_name" {
  description = "Lanyard-side secret/SSM *name* for the ExternalId (not the secret value). Operators store the ExternalId there."
  value       = local.external_id_parameter_name
}

output "external_id_required" {
  description = "Always true: trust policy requires sts:ExternalId."
  value       = true
}

output "max_session_duration_seconds" {
  description = "Max STS session duration configured on the role."
  value       = aws_iam_role.lanyard_deploy.max_session_duration
}

output "session_tags_enabled" {
  description = "Whether trust requires Project + TenantSlug session tags."
  value       = var.enable_session_tags
}

output "project_name" {
  description = "Project tag / IAM scope for this tenant."
  value       = var.project_name
}

output "tenant_slug" {
  description = "Tenant slug used for session tags and ExternalId parameter path default."
  value       = var.tenant_slug
}

output "secret_path_prefix" {
  description = "SSM/Secrets Manager path prefix allowed for this tenant deploy role."
  value       = local.secret_path_prefix
}

output "artifact_s3_bucket_arns" {
  description = "Approved artifact bucket ARNs on the deploy role (empty if HTTPS-only pins)."
  value       = var.artifact_s3_bucket_arns
}

output "artifact_get_object_arns" {
  description = "Effective s3:GetObject resource ARNs for product prefixes."
  value       = local.artifact_get_object_arns
}

output "assume_role_cli_template" {
  description = "Operator CLI template. Replace EXTERNAL_ID from the Lanyard secret store (never commit the value)."
  value       = <<-EOT
    # Load ExternalId from Lanyard secret store (name only documented):
    #   ${local.external_id_parameter_name}
    export AWS_PROFILE=lanyard-platform   # or env credentials for a Lanyard principal in trust
    CREDS=$(aws sts assume-role \
      --role-arn "${aws_iam_role.lanyard_deploy.arn}" \
      --role-session-name "lanyard-track-b-${var.tenant_slug}" \
      --external-id "$EXTERNAL_ID" \
      --duration-seconds ${var.max_session_duration_seconds} \
      ${var.enable_session_tags ? "--tags Key=Project,Value=${var.project_name} Key=TenantSlug,Value=${var.tenant_slug} --transitive-tag-keys Project TenantSlug" : ""} \
      --query 'Credentials' --output json)
    export AWS_ACCESS_KEY_ID=$(echo "$CREDS" | jq -r .AccessKeyId)
    export AWS_SECRET_ACCESS_KEY=$(echo "$CREDS" | jq -r .SecretAccessKey)
    export AWS_SESSION_TOKEN=$(echo "$CREDS" | jq -r .SessionToken)
    aws sts get-caller-identity
  EOT
}

output "terraform_provider_assume_role_hcl" {
  description = "Snippet for Lanyard-side tenant root: provider alias with assume_role (ExternalId from private var/secret)."
  value       = <<-EOT
    # Lanyard operator / automation credentials stay on the default provider (or a platform alias).
    # Customer data-plane apply uses a separate alias — never mix state backends.

    variable "customer_deploy_role_arn" {
      type        = string
      description = "From module.customer_account_access.role_arn (customer account)."
    }

    variable "customer_deploy_external_id" {
      type        = string
      sensitive   = true
      description = "From Lanyard secret ${local.external_id_parameter_name} — never git."
    }

    provider "aws" {
      alias  = "customer"
      region = var.region

      assume_role {
        role_arn     = var.customer_deploy_role_arn
        external_id  = var.customer_deploy_external_id
        session_name = "lanyard-track-b-${var.tenant_slug}"
        duration     = "${var.max_session_duration_seconds}s"
        ${var.enable_session_tags ? "tags = {\n          Project    = \"${var.project_name}\"\n          TenantSlug = \"${var.tenant_slug}\"\n        }\n        transitive_tag_keys = [\"Project\", \"TenantSlug\"]" : ""}
      }
    }

    # Tenant modules (company-brain-ec2, etc.) must use: providers = { aws = aws.customer }
    # Remote state backend for Track B remains in the *customer* account (or customer-owned bucket) —
    # separate from Lanyard platform state. Do not share one state file across tenants.
  EOT
}

output "platform_artifact_bucket_policy_statement_json" {
  description = <<-EOT
    Optional statement for the *platform* product-artifact S3 bucket policy (Lanyard account) granting
    GetObject to a customer instance role ARN. Replace INSTANCE_ROLE_ARN after company-brain-ec2 apply.
    Alternative: customer mirrors artifacts into their own bucket (no cross-account grant).
  EOT
  value = length(var.artifact_s3_bucket_arns) == 0 ? null : jsonencode({
    Sid    = "TrackBCustomerInstanceArtifactRead_${var.project_name}"
    Effect = "Allow"
    Principal = {
      AWS = "INSTANCE_ROLE_ARN"
    }
    Action = [
      "s3:GetObject",
      "s3:GetObjectVersion",
    ]
    Resource = local.artifact_get_object_arns
  })
}

output "hosting_track" {
  description = "Always customer_account for this module."
  value       = "customer_account"
}

output "module_status" {
  description = "Honesty: infra_ready contract, not live multi-account apply certified from examples."
  value       = "infra_ready_not_auto_applied"
}

output "rotate_revoke_offboard_summary" {
  description = "Operator actions for ExternalId rotate, role revoke, and tenant offboard (see runbook)."
  value = {
    rotate_external_id = "Generate new ExternalId; update customer role trust (re-apply module); update Lanyard secret ${local.external_id_parameter_name}; invalidate old sessions."
    revoke_access      = "Remove Lanyard principal from lanyard_principal_arns or delete role; optionally attach deny-all inline policy; confirm no access keys exist on the role."
    offboard_tenant    = "Revoke role; delete customer deploy role + boundary; purge Lanyard ExternalId secret; destroy tenant stack in customer account; retain customer-owned snapshots per contract."
    no_long_lived_keys = "This module never creates iam:AccessKey or IAM users."
  }
}
