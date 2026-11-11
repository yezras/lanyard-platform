variable "aws_region" {
  description = "AWS region for IAM (global) and vault bucket region for tags."
  type        = string
  default     = "us-east-1"
}

variable "vault_bucket_name" {
  description = "Lab vault bucket (must already exist; lp-d26)."
  type        = string
  default     = "lanyard-mocklab-vault-123456789012"
}

variable "role_name" {
  description = "Shared base mount role name."
  type        = string
  default     = "lanyard-sandbox-vault-mount"
}

variable "orchestrator_principal_arns" {
  description = "CP task role ARN(s) allowed to AssumeRole the base mount role."
  type        = list(string)
  # Lab account 123456789012 — non-secret ARN (role name public in account).
  default = [
    "arn:aws:iam::123456789012:role/lanyard-platform-staging-cp-task",
  ]
}

variable "attach_orchestrator_assume_policy" {
  description = "Attach sts:AssumeRole inline policy to CP task role."
  type        = bool
  default     = true
}

variable "external_id" {
  description = "Optional AssumeRole ExternalId (private tfvars only)."
  type        = string
  default     = null
  sensitive   = true
}
