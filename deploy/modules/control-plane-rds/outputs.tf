output "db_instance_id" {
  description = "RDS instance identifier."
  value       = aws_db_instance.control_plane.id
}

output "db_instance_arn" {
  description = "RDS instance ARN."
  value       = aws_db_instance.control_plane.arn
}

output "db_instance_endpoint" {
  description = "RDS endpoint host:port (non-secret)."
  value       = aws_db_instance.control_plane.endpoint
}

output "db_instance_address" {
  description = "RDS hostname only (non-secret)."
  value       = aws_db_instance.control_plane.address
}

output "db_instance_port" {
  description = "Postgres port."
  value       = aws_db_instance.control_plane.port
}

output "db_name" {
  description = "Application database name."
  value       = var.db_name
}

output "master_username" {
  description = "Master username (password is only in Secrets Manager)."
  value       = var.master_username
}

output "security_group_id" {
  description = "Security group attached to the RDS instance."
  value       = aws_security_group.control_plane_db.id
}

output "db_subnet_group_name" {
  description = "DB subnet group name (private subnets)."
  value       = aws_db_subnet_group.control_plane.name
}

output "publicly_accessible" {
  description = "Always false — public RDS is rejected."
  value       = aws_db_instance.control_plane.publicly_accessible
}

output "storage_encrypted" {
  description = "Always true — encryption is mandatory."
  value       = aws_db_instance.control_plane.storage_encrypted
}

# ---------------------------------------------------------------------------
# Secret references — preferred consumption path for control-plane tasks
# ---------------------------------------------------------------------------

output "control_plane_database_url_secret_arn" {
  description = <<-EOT
    Secrets Manager secret ARN whose JSON payload includes:
      - url / CONTROL_PLANE_DATABASE_URL / DATABASE_URL (full postgresql://… URL)
      - host, port, dbname, username, password
    Wire the control-plane task to fetch this secret at runtime — do not put the
    password in terraform.tfvars or commit it. Terraform state still holds the
    generated password (standard RDS+TF tradeoff); restrict state backend access.
  EOT
  value       = aws_secretsmanager_secret.database_url.arn
}

output "control_plane_database_url_secret_name" {
  description = "Secrets Manager secret name for the CONTROL_PLANE_DATABASE_URL payload."
  value       = aws_secretsmanager_secret.database_url.name
}

output "control_plane_database_url_ssm_parameter_name" {
  description = "SSM parameter name that stores the secret ARN (not the password). Null when create_ssm_parameter_pointer=false."
  value       = try(aws_ssm_parameter.database_url_secret_arn[0].name, null)
}

output "control_plane_database_url_ssm_parameter_arn" {
  description = "SSM parameter ARN pointing at the Secrets Manager secret ARN."
  value       = try(aws_ssm_parameter.database_url_secret_arn[0].arn, null)
}

output "control_plane_database_url_shape" {
  description = <<-EOT
    Non-secret URL shape with password redacted (postgresql://user:***@host:port/db).
    Use control_plane_database_url_secret_arn for the real CONTROL_PLANE_DATABASE_URL value.
    Product env keys: CONTROL_PLANE_DATABASE_URL or DATABASE_URL (Portal G4.1).
  EOT
  value       = local.database_url_shape
}

output "control_plane_env_contract" {
  description = "How Portal control-plane should consume this module's outputs (no raw password)."
  value = {
    preferred_env_keys = ["CONTROL_PLANE_DATABASE_URL", "DATABASE_URL"]
    secret_arn_output  = "control_plane_database_url_secret_arn"
    secret_json_keys = [
      "url",
      "CONTROL_PLANE_DATABASE_URL",
      "DATABASE_URL",
      "host",
      "port",
      "dbname",
      "username",
      "password",
    ]
    ssm_pointer_output = "control_plane_database_url_ssm_parameter_name"
    note               = "Fetch secret at task start; never commit passwords or full URLs to git/tfvars."
  }
}

output "module_status" {
  description = "Honesty summary: module is real Terraform; apply remains operator-owned and production CP still needs G1 private boundary."
  value = {
    component             = "control-plane-rds"
    engine                = "postgres"
    publicly_accessible   = false
    storage_encrypted     = true
    private_subnets_only  = true
    secrets_via           = "secretsmanager"
    product_env_contract  = "CONTROL_PLANE_DATABASE_URL"
    production_apply      = "operator_owned_not_auto_applied"
    readiness             = "infra_ready_until_applied"
    gated_portal_security = "G1 private control-plane boundary still required for production claim"
  }
}
