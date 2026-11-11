output "topology" {
  description = "Named topology this module implements (ADR 0006)."
  value       = "staging-platform-shared-ds"
}

output "alb_arn" {
  description = "Public Document Server ALB ARN (browser → Docs edge)."
  value       = aws_lb.docs.arn
}

output "alb_dns_name" {
  description = "Public Document Server ALB DNS name (browser loads api.js from here)."
  value       = aws_lb.docs.dns_name
}

output "alb_zone_id" {
  description = "ALB hosted zone ID for Route53 aliases."
  value       = aws_lb.docs.zone_id
}

output "alb_security_group_id" {
  description = "Security group on the public Docs ALB."
  value       = aws_security_group.alb.id
}

output "task_security_group_id" {
  description = "Security group on Document Server Fargate tasks."
  value       = aws_security_group.tasks.id
}

output "target_group_arn" {
  description = "Docs target group ARN (/healthcheck)."
  value       = aws_lb_target_group.docs.arn
}

output "ecs_cluster_name" {
  description = "ECS cluster name used by the Document Server service."
  value       = local.cluster_name
}

output "ecs_service_name" {
  description = "ECS service name."
  value       = aws_ecs_service.docs.name
}

output "task_definition_arn" {
  description = "Task definition ARN (image pinned by digest)."
  value       = aws_ecs_task_definition.docs.arn
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

output "document_server_public_base_url" {
  description = "Browser-facing Document Server base URL. Prefers CloudFront HTTPS when enable_cloudfront_https; else ALB https/http from enable_https."
  value = (
    var.enable_cloudfront_https
    ? "https://${aws_cloudfront_distribution.docs[0].domain_name}"
    : (
      var.enable_https
      ? "https://${aws_lb.docs.dns_name}"
      : "http://${aws_lb.docs.dns_name}"
    )
  )
}

output "document_server_host" {
  description = "Hostname(s) for BFF_OFFICE_DOCUMENT_SERVER_HOSTS allowlist (no scheme). When CloudFront HTTPS is on, CF domain + ALB DNS."
  value = (
    var.enable_cloudfront_https
    ? join(",", distinct(compact([
      aws_cloudfront_distribution.docs[0].domain_name,
      aws_lb.docs.dns_name,
    ])))
    : aws_lb.docs.dns_name
  )
}

output "cloudfront_distribution_id" {
  description = "Docs CloudFront distribution ID when enable_cloudfront_https (null otherwise)."
  value       = var.enable_cloudfront_https ? aws_cloudfront_distribution.docs[0].id : null
}

output "cloudfront_domain_name" {
  description = "Docs CloudFront domain name (*.cloudfront.net or alias) when enable_cloudfront_https."
  value       = var.enable_cloudfront_https ? aws_cloudfront_distribution.docs[0].domain_name : null
}

output "jwt_secret_arn" {
  description = "Secrets Manager ARN for JWT secret (ARN only — never the secret value)."
  value       = local.jwt_secret_arn_effective
}

output "jwt_secret_name" {
  description = "Secrets Manager secret name when created by this module (null when external ARN)."
  value       = var.create_jwt_secret ? local.jwt_secret_name : null
}

output "jwt_secret_ssm_parameter_name" {
  description = "SSM parameter holding JWT secret ARN pointer (null when external JWT ARN)."
  value       = var.create_jwt_secret ? aws_ssm_parameter.jwt_secret_arn[0].name : null
}

output "license_secret_arn" {
  description = "Optional license material SM ARN (null on free track when no shell/existing ARN)."
  value       = local.license_secret_arn_effective
}

output "secret_names" {
  description = "Container env names injected from Secrets Manager (names only)."
  value       = ["JWT_SECRET"]
}

output "bff_office_secret_binding" {
  description = "Suggested BFF secrets map entry for shared JWT (ARN only)."
  value = {
    BFF_OFFICE_JWT_SECRET = {
      value_from = local.jwt_secret_arn_effective
    }
  }
}

output "module_status" {
  description = "Honesty summary for readiness matrix."
  value = {
    component                  = "staging-document-server"
    topology                   = "staging-platform-shared-ds"
    bead                       = "lp-5q6.34"
    public_edge                = true
    desired_count              = var.desired_count
    digest_pinned              = true
    jwt_from_secrets_manager   = true
    license_material_in_git    = false
    free_track_community_image = true
    production_apply           = "operator_owned_not_auto_applied"
    readiness                  = "infra_ready_until_applied_and_pinned"
    production_document_server = "blocked_by_license_and_security_gates"
    staging_shared_residual    = "accepted_for_staging_data_only"
    rollback                   = "desired_count=0 or enable_staging_document_server=false; keep onlyoffice_editor flag off — previews unaffected"
  }
}
