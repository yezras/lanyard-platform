# Lab apply root for sandbox vault mount IAM (lp-zuh.9.1).
# Applies the shared base role + CP task AssumeRole grant against the existing
# mocklab vault bucket. No S3 bucket create/destroy. No long-lived access keys.
#
# Operator:
#   export AWS_PROFILE=lanyard-main AWS_REGION=us-east-1
#   terraform init && terraform plan && terraform apply
#
# State: local by default for lab; move to remote backend if operators prefer.
# Never commit terraform.tfvars with secrets or *.tfstate.

module "sandbox_vault_mount_iam" {
  source = "../../modules/sandbox-vault-mount-iam"

  name_prefix       = "lanyard-platform-lab"
  environment       = "lab"
  role_name         = var.role_name
  vault_bucket_name = var.vault_bucket_name

  orchestrator_principal_arns       = var.orchestrator_principal_arns
  attach_orchestrator_assume_policy = var.attach_orchestrator_assume_policy
  external_id                       = var.external_id
}
