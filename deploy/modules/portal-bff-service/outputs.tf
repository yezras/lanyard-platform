output "alb_arn" {
  description = "Public BFF ALB ARN (browser API edge)."
  value       = aws_lb.bff.arn
}

output "alb_dns_name" {
  description = "Public BFF ALB DNS name."
  value       = aws_lb.bff.dns_name
}

output "alb_zone_id" {
  description = "ALB hosted zone ID for Route53 aliases."
  value       = aws_lb.bff.zone_id
}

output "alb_security_group_id" {
  description = "Security group on the public BFF ALB."
  value       = aws_security_group.alb.id
}

output "task_security_group_id" {
  description = "Security group on BFF Fargate tasks (allow-list this SG on private backends)."
  value       = aws_security_group.tasks.id
}

output "target_group_arn" {
  description = "BFF target group ARN (/health health checks)."
  value       = aws_lb_target_group.bff.arn
}

output "ecs_cluster_name" {
  description = "ECS cluster name used by the BFF service."
  value       = local.cluster_name
}

output "ecs_service_name" {
  description = "ECS service name."
  value       = aws_ecs_service.bff.name
}

output "task_definition_arn" {
  description = "Task definition ARN (image pinned by digest)."
  value       = aws_ecs_task_definition.bff.arn
}

output "image_pin" {
  description = "Deploy authority: repository + digest (tag is hint only)."
  value = {
    repository = var.image_repository
    digest     = var.image_digest
    tag_hint   = var.image_tag_hint
    image      = local.image
  }
}

output "health_check" {
  description = "ALB and container health check contract."
  value = {
    path = var.health_check_path
    port = var.container_port
  }
}

output "secret_names" {
  description = "Container env names injected from Secrets Manager / SSM (names only — never secret values)."
  value       = sort(keys(local.effective_secrets))
}

output "execution_extra_secret_arn_count" {
  description = "Count of IAM-only extra SM ARNs on the exec role (not injected into the BFF container)."
  value       = length(local.execution_extra_sm_arns)
}

output "module_status" {
  description = "Honesty summary for readiness matrix."
  value = {
    component        = "portal-bff-service"
    public_edge      = true
    service_role     = "bff"
    desired_count    = var.desired_count
    digest_pinned    = true
    secrets_injected = length(local.effective_secrets)
    production_apply = "operator_owned_not_auto_applied"
    readiness        = "infra_ready_until_applied_and_pinned"
    scale_gate       = "desired_count>1 requires G5 acknowledge"
  }
}
