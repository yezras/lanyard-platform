output "account_id" {
  description = "Resolved tenant account ID (input or caller when baseline applied). Null in pure contract mode without account_id."
  value       = local.resolved_account_id
}

output "tenant_slug" {
  description = "Tenant slug for this factory request / baseline."
  value       = var.tenant_slug
}

output "project_name" {
  description = "Project name / AWS name prefix."
  value       = var.project_name
}

output "environment_class" {
  description = "sandbox or production-client."
  value       = var.environment_class
}

output "hosting_track" {
  description = "Always lanyard_hosted for this module."
  value       = "lanyard_hosted"
}

output "isolation_mode" {
  description = "Always account (account-per-tenant production target)."
  value       = "account"
}

output "account_request_contract" {
  description = "JSON-serializable request payload for Control Tower / AFT / org operators (not applied by Terraform)."
  value       = local.account_request_contract
}

output "account_request_contract_json" {
  description = "Pretty JSON form of account_request_contract for tickets / AFT custom fields."
  value       = jsonencode(local.account_request_contract)
}

output "target_ou_path" {
  description = "Documented OU path for CT/AFT placement."
  value       = var.target_ou_path
}

output "sso_permission_set_names" {
  description = "Expected IAM Identity Center permission set names (org-level assignment is live-gated)."
  value       = var.sso_permission_set_names
}

output "scp_template_files" {
  description = "Baseline SCP JSON templates shipped with this module (operator-attached at OU; not applied here)."
  value       = [for f in local.scp_template_files : "modules/account-factory/scp/${f}"]
}

output "deploy_role_arn" {
  description = "Tenant deploy role ARN (null when not created). AssumeRole only — no static keys."
  value       = try(aws_iam_role.deploy[0].arn, null)
}

output "deploy_role_name" {
  description = "Deploy role name."
  value       = try(aws_iam_role.deploy[0].name, local.deploy_role_name)
}

output "break_glass_role_arn" {
  description = "Break-glass role ARN (null when not created)."
  value       = try(aws_iam_role.break_glass[0].arn, null)
}

output "kms_key_arn" {
  description = "Tenant CMK ARN (null when KMS not created). Wire to company-brain-ec2 dedicated_kms_key_arn."
  value       = try(aws_kms_key.tenant[0].arn, null)
}

output "kms_key_id" {
  description = "Tenant CMK ID."
  value       = try(aws_kms_key.tenant[0].key_id, null)
}

output "kms_alias_name" {
  description = "KMS alias name for the tenant CMK."
  value       = local.kms_alias_name
}

output "state_bucket_name" {
  description = "Terraform state S3 bucket name (created or planned name)."
  value       = try(aws_s3_bucket.tfstate[0].id, local.state_bucket_name)
}

output "state_bucket_arn" {
  description = "Terraform state S3 bucket ARN."
  value       = try(aws_s3_bucket.tfstate[0].arn, null)
}

output "state_lock_table_name" {
  description = "DynamoDB lock table name for Terraform state."
  value       = try(aws_dynamodb_table.tfstate_lock[0].name, local.lock_table_name)
}

output "log_group_name" {
  description = "Baseline CloudWatch log group for the tenant."
  value       = try(aws_cloudwatch_log_group.tenant[0].name, local.log_group_name)
}

output "backup_vault_arn" {
  description = "AWS Backup vault ARN (null when not created). DLM remains primary for EC2 module volumes."
  value       = try(aws_backup_vault.tenant[0].arn, null)
}

output "budget_name" {
  description = "Monthly budget name (null when not created)."
  value       = try(aws_budgets_budget.monthly[0].name, null)
}

output "state_backend_config_template" {
  description = "Partial backend config template for tenant Terraform (S3 + DynamoDB). Fill region/bucket after apply."
  value       = <<-EOT
    # Per-tenant remote state — never share one state file across production clients.
    # No static AWS keys: use SSO / assume-role credentials that can access this account.

    terraform {
      backend "s3" {
        bucket         = "${try(aws_s3_bucket.tfstate[0].id, local.state_bucket_name)}"
        key            = "company-brain/${var.tenant_slug}/terraform.tfstate"
        region         = "${var.region}"
        dynamodb_table = "${try(aws_dynamodb_table.tfstate_lock[0].name, local.lock_table_name)}"
        encrypt        = true
        ${local.create_kms ? "kms_key_id     = \"${try(aws_kms_key.tenant[0].arn, local.kms_alias_name)}\"" : "# kms_key_id = optional CMK ARN"}
      }
    }
  EOT
}

output "terraform_provider_assume_role_hcl" {
  description = "Provider alias snippet for Lanyard operators deploying into the tenant account (no static keys)."
  value       = <<-EOT
    # Lanyard platform credentials on default provider (management account).
    # Tenant data-plane apply uses alias — separate state backend in the tenant account.

    variable "tenant_deploy_role_arn" {
      type        = string
      description = "From module.account_factory.deploy_role_arn"
    }

    provider "aws" {
      alias  = "tenant"
      region = var.region

      assume_role {
        role_arn     = var.tenant_deploy_role_arn
        session_name = "lanyard-account-factory-${var.tenant_slug}"
        # external_id = var.tenant_deploy_external_id  # when deploy_role_external_id was set on the factory role
      }
    }

    # Tenant modules:
    #   module "brain" {
    #     source = "../../modules/company-brain-ec2"
    #     providers = { aws = aws.tenant }
    #     dedicated_kms_key_arn = module.account_factory.kms_key_arn
    #     ...
    #   }
  EOT
}

output "assume_role_cli_template" {
  description = "CLI template to assume the deploy role (session credentials only)."
  value       = <<-EOT
    export AWS_PROFILE=lanyard-platform   # management/ops principal in trust
    # Add --external-id "$EXTERNAL_ID" when the deploy role trust requires ExternalId.
    CREDS=$(aws sts assume-role \
      --role-arn "${try(aws_iam_role.deploy[0].arn, "arn:aws:iam::ACCOUNT_ID:role/company-brain/${local.deploy_role_name}")}" \
      --role-session-name "lanyard-af-${var.tenant_slug}" \
      --duration-seconds ${var.max_session_duration_seconds} \
      --query 'Credentials' --output json)
    export AWS_ACCESS_KEY_ID=$(echo "$CREDS" | jq -r .AccessKeyId)
    export AWS_SECRET_ACCESS_KEY=$(echo "$CREDS" | jq -r .SecretAccessKey)
    export AWS_SESSION_TOKEN=$(echo "$CREDS" | jq -r .SessionToken)
    aws sts get-caller-identity
  EOT
}

output "tenant_template_wiring" {
  description = "Suggested templates/tenant variable values after account is ready."
  value = {
    hosting_track         = "lanyard_hosted"
    isolation_mode        = "account"
    production_intent     = var.environment_class == "production-client"
    project_name          = var.project_name
    tenant_slug           = var.tenant_slug
    aws_account_id        = local.resolved_account_id
    dedicated_kms_key_arn = try(aws_kms_key.tenant[0].arn, "<from kms_key_arn output after baseline apply>")
    log_group_prefix      = local.log_group_name
  }
}

output "decommission_quarantine_checklist" {
  description = "Operator checklist for quarantine / decommission (see runbook for live steps)."
  value = {
    quarantine = [
      "Detach SSO permission sets for non-break-glass users",
      "Attach deny-all SCP or move account to Quarantine OU (org admin)",
      "Disable deploy role trust (remove principals) or delete deploy role",
      "Stop/terminate company-brain-ec2; retain EBS snapshots per contract",
      "Confirm budget + CloudTrail/org trail still capture events",
    ]
    decommission = [
      "Destroy tenant stack (company-brain-ec2) via deploy role or break-glass",
      "Destroy account-factory baseline (roles, budget; retain KMS/state if required for audit)",
      "Close or suspend account per org policy (CT Account Factory close flow if used)",
      "Remove ExternalId / secrets from Lanyard secret store",
      "Update private ops inventory; never leave shared state keys",
    ]
    no_static_keys = "This module never creates iam:AccessKey or IAM users."
  }
}

output "module_status" {
  description = "Honesty: infra_ready contract; live org/CT/AFT apply is operator-owned."
  value       = "infra_ready_not_auto_applied"
}

output "control_tower_aft_integration_summary" {
  description = "How operators wire this contract to Control Tower / AFT without this module mutating Organizations."
  value = {
    account_vending    = "Submit account_request_contract via CT Account Factory (console/API) or AFT account request pipeline into target_ou_path."
    scp_attach         = "Attach scp/*.json at OU (production-clients / sandbox) with org management account — not this module."
    sso                = "Assign sso_permission_set_names via IAM Identity Center to the vended account."
    post_vend_baseline = "Apply this module with create_account_baseline=true and account_id=<vended> using AFT customizations or operator pipeline in the member account."
    tenant_deploy      = "Consume deploy_role_arn + state_backend_config_template + kms_key_arn in templates/tenant (artifact contract only; no Core clone)."
    live_org_api       = "Disabled (enable_live_organizations_api locked false)."
  }
}
