output "alb_arn" {
  description = "Public relay ALB ARN (separate from BFF; customer-host WSS edge)."
  value       = aws_lb.relay.arn
}

output "alb_dns_name" {
  description = "Public relay ALB DNS name (basis for wss:// customer-host egress URL)."
  value       = aws_lb.relay.dns_name
}

output "alb_zone_id" {
  description = "ALB hosted zone ID for Route53 aliases."
  value       = aws_lb.relay.zone_id
}

output "alb_security_group_id" {
  description = "Security group on the public relay ALB."
  value       = aws_security_group.alb.id
}

output "task_security_group_id" {
  description = "Security group on relay Fargate tasks."
  value       = aws_security_group.tasks.id
}

output "target_group_arn" {
  description = "Relay target group ARN (/health health checks)."
  value       = aws_lb_target_group.relay.arn
}

output "ecs_cluster_name" {
  description = "ECS cluster name used by the relay service."
  value       = local.cluster_name
}

output "ecs_service_name" {
  description = "ECS service name."
  value       = aws_ecs_service.relay.name
}

output "task_definition_arn" {
  description = "Task definition ARN (image pinned by digest)."
  value       = aws_ecs_task_definition.relay.arn
}

output "image_pin" {
  description = "Deploy authority: repository + digest."
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

output "module_status" {
  description = "Honesty summary for readiness matrix."
  value = {
    component        = "portal-relay-service"
    public_edge      = true
    service_role     = "relay"
    desired_count    = var.desired_count
    digest_pinned    = true
    secrets_injected = length(local.effective_secrets)
    production_apply = "operator_owned_not_auto_applied"
    readiness        = "infra_ready_until_applied_and_pinned"
    scale_gate       = "desired_count>1 requires G6 acknowledge"
    security_note    = "G2 relay credential lifecycle still required for production security claim"
  }
}
