output "replication_group_id" {
  description = "ElastiCache replication group id."
  value       = aws_elasticache_replication_group.portal.id
}

output "replication_group_arn" {
  description = "ElastiCache replication group ARN."
  value       = aws_elasticache_replication_group.portal.arn
}

output "primary_endpoint_address" {
  description = "Primary endpoint hostname (non-secret). Wire with port for ECS env or secret JSON host key."
  value       = aws_elasticache_replication_group.portal.primary_endpoint_address
}

output "reader_endpoint_address" {
  description = "Reader endpoint hostname when multi-node; may equal primary on single-node."
  value       = aws_elasticache_replication_group.portal.reader_endpoint_address
}

output "port" {
  description = "Valkey/Redis port."
  value       = aws_elasticache_replication_group.portal.port
}

output "engine" {
  description = "Configured engine (valkey or redis)."
  value       = var.engine
}

output "security_group_id" {
  description = "Security group attached to the replication group."
  value       = aws_security_group.portal_valkey.id
}

output "subnet_group_name" {
  description = "ElastiCache subnet group name (private subnets)."
  value       = aws_elasticache_subnet_group.portal.name
}

output "transit_encryption_enabled" {
  description = "Always true — TLS required."
  value       = true
}

output "at_rest_encryption_enabled" {
  description = "Always true — at-rest encryption is mandatory."
  value       = true
}

# ---------------------------------------------------------------------------
# Secret references — preferred consumption path for BFF/relay ECS tasks
# ---------------------------------------------------------------------------

output "redis_url_secret_arn" {
  description = <<-EOT
    Secrets Manager secret ARN whose JSON payload includes:
      - url / REDIS_URL (full rediss://… TLS URL with auth token)
      - host, port, auth_token, engine, tls
    Wire ECS secrets / task runtime to fetch this secret — do not put the
    auth token in terraform.tfvars or commit it. Terraform state still holds the
    generated token (standard ElastiCache+TF tradeoff); restrict state backend access.
  EOT
  value       = aws_secretsmanager_secret.redis_url.arn
}

output "redis_url_secret_name" {
  description = "Secrets Manager secret name for the REDIS_URL payload."
  value       = aws_secretsmanager_secret.redis_url.name
}

output "redis_url_ssm_parameter_name" {
  description = "SSM parameter name that stores the secret ARN (not the auth token). Null when create_ssm_parameter_pointer=false."
  value       = try(aws_ssm_parameter.redis_url_secret_arn[0].name, null)
}

output "redis_url_ssm_parameter_arn" {
  description = "SSM parameter ARN pointing at the Secrets Manager secret ARN."
  value       = try(aws_ssm_parameter.redis_url_secret_arn[0].arn, null)
}

output "redis_url_shape" {
  description = <<-EOT
    Non-secret URL shape with auth token redacted (rediss://:***@host:port).
    Use redis_url_secret_arn for the real REDIS_URL value.
    Product env key: REDIS_URL (Portal G5 BFF shared state / G6 relay bus).
  EOT
  value       = local.redis_url_shape
}

output "ecs_secret_injection" {
  description = "Machine-readable ECS secrets wiring (host/port + secret ARN; no plaintext auth)."
  value = {
    preferred_env_keys = ["REDIS_URL"]
    secret_arn_output  = "redis_url_secret_arn"
    secret_json_keys = [
      "url",
      "REDIS_URL",
      "host",
      "port",
      "auth_token",
      "engine",
      "tls",
    ]
    endpoint_host_output = "primary_endpoint_address"
    endpoint_port_output = "port"
    ssm_pointer_output   = "redis_url_ssm_parameter_name"
    # Example ECS container secrets block (operator fills task definition):
    # secrets = [{ name = "REDIS_URL", valueFrom = "<redis_url_secret_arn>:REDIS_URL::" }]
    note = "Fetch secret at task start or via ECS secrets injection; never commit tokens or full rediss URLs to git/tfvars."
  }
}

output "cloudwatch_alarm_arns" {
  description = "CloudWatch alarm ARNs when create_cloudwatch_alarms=true; empty list otherwise."
  value = compact(concat(
    try([aws_cloudwatch_metric_alarm.cpu[0].arn], []),
    try([aws_cloudwatch_metric_alarm.memory[0].arn], []),
    try([aws_cloudwatch_metric_alarm.evictions[0].arn], []),
  ))
}

output "module_status" {
  description = "Honesty summary: module is real Terraform; apply remains operator-owned; G5/G6 still product-gated."
  value = {
    component                = "portal-valkey"
    engine                   = var.engine
    transit_encryption       = true
    at_rest_encryption       = true
    private_subnets_only     = true
    auth_via                 = "secretsmanager"
    product_env_contract     = "REDIS_URL"
    production_apply         = "operator_owned_not_auto_applied"
    readiness                = "infra_ready_until_applied"
    not_production_certified = true
    gated_portal_shared      = "G5 BFF shared state and G6 relay bus still require product consumers + staging evidence before desired_count > 1"
  }
}
