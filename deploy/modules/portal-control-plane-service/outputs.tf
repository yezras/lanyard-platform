output "alb_arn" {
  description = "Internal control-plane ALB ARN (private only)."
  value       = aws_lb.control_plane.arn
}

output "alb_dns_name" {
  description = "Internal control-plane ALB DNS name (VPC-only resolution)."
  value       = aws_lb.control_plane.dns_name
}

output "alb_zone_id" {
  description = "ALB hosted zone ID."
  value       = aws_lb.control_plane.zone_id
}

output "alb_internal" {
  description = "Always true — public control-plane ALB is rejected."
  value       = aws_lb.control_plane.internal
}

output "alb_security_group_id" {
  description = "Security group on the internal control-plane ALB."
  value       = aws_security_group.alb.id
}

output "task_security_group_id" {
  description = "Security group on control-plane Fargate tasks (allow this on RDS allowed_security_group_ids)."
  value       = aws_security_group.tasks.id
}

output "target_group_arn" {
  description = "Control-plane target group ARN (/health health checks)."
  value       = aws_lb_target_group.control_plane.arn
}

output "ecs_cluster_name" {
  description = "ECS cluster name."
  value       = local.cluster_name
}

output "ecs_service_name" {
  description = "ECS service name."
  value       = aws_ecs_service.control_plane.name
}

output "task_definition_arn" {
  description = "Task definition ARN (image pinned by digest)."
  value       = aws_ecs_task_definition.control_plane.arn
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

output "task_role_arn" {
  description = "Control-plane task role ARN (not the execution role)."
  value       = aws_iam_role.task.arn
}

output "task_role_name" {
  description = "Control-plane task role name (CLI attach for instance-secret-material SM)."
  value       = aws_iam_role.task.name
}

output "secret_names" {
  description = "Container env names injected from Secrets Manager / SSM (names only — never secret values or ARNs)."
  value       = sort(keys(local.effective_secrets))
}

output "instance_secret_material_sm_configured" {
  description = "True when instance_secret_material_sm_secret_arn is set (ARN not echoed)."
  value       = local.instance_secret_material_sm_configured
}

output "module_status" {
  description = "Honesty summary: private-only control-plane compute; G1 staging proof still required."
  value = {
    component             = "portal-control-plane-service"
    public_edge           = false
    internal_alb          = true
    assign_public_ip      = false
    private_subnets_only  = true
    digest_pinned         = true
    secrets_injected      = length(local.effective_secrets)
    production_apply      = "operator_owned_not_auto_applied"
    readiness             = "infra_ready_until_applied_and_pinned"
    gated_portal_security = "G1 private control-plane staging proof still required for production claim"
  }
}
