output "tenant_slug" {
  description = "Portal tenant slug for this dedicated relay pool."
  value       = local.tenant_slug
}

output "relay_hostname" {
  description = "Dedicated relay DNS hostname (isolated pool per compliance tenant)."
  value       = local.relay_hostname
}

output "relay_wss_url" {
  description = "Customer GATEWAY_RELAY_URL / customer-gateway-relay relay_wss_url input (wss:// only)."
  value       = local.relay_wss_url
}

output "sow_summary" {
  description = "Copy-paste SOW bullet for Tier 3 dedicated relay isolation."
  value       = "Dedicated relay endpoint ${local.relay_wss_url} — gateway traffic isolated from global relay pool; portal remains at https://app.withlanyard.com/${local.tenant_slug}."
}

output "alb_arn" {
  description = "Public dedicated relay ALB ARN."
  value       = module.relay.alb_arn
}

output "alb_dns_name" {
  description = "Public dedicated relay ALB DNS name (basis for wss:// until DNS alias is created)."
  value       = module.relay.alb_dns_name
}

output "alb_zone_id" {
  description = "ALB hosted zone ID for Route53 aliases (portal-dns-tls or this module's optional record)."
  value       = module.relay.alb_zone_id
}

output "alb_security_group_id" {
  description = "Security group on the public dedicated relay ALB."
  value       = module.relay.alb_security_group_id
}

output "task_security_group_id" {
  description = "Security group on dedicated relay Fargate tasks (private)."
  value       = module.relay.task_security_group_id
}

output "target_group_arn" {
  description = "Dedicated relay target group ARN (/health health checks)."
  value       = module.relay.target_group_arn
}

output "ecs_cluster_name" {
  description = "ECS cluster name used by the dedicated relay service."
  value       = module.relay.ecs_cluster_name
}

output "ecs_service_name" {
  description = "ECS service name."
  value       = module.relay.ecs_service_name
}

output "task_definition_arn" {
  description = "Task definition ARN (image pinned by digest)."
  value       = module.relay.task_definition_arn
}

output "image_pin" {
  description = "Deploy authority: repository + digest."
  value       = module.relay.image_pin
}

output "health_check" {
  description = "ALB and container health check contract."
  value       = module.relay.health_check
}

output "secret_names" {
  description = "Container env names injected from Secrets Manager / SSM (names only — never secret values)."
  value       = module.relay.secret_names
}

output "dns_record_fqdn" {
  description = "Route53 alias FQDN when create_dns_record=true; null otherwise."
  value       = local.create_dns ? aws_route53_record.relay[0].fqdn : null
}

output "waf_associated" {
  description = "True when a WAFv2 Web ACL is associated to the dedicated relay ALB."
  value       = local.associate_waf
}

output "module_status" {
  description = "Honesty summary for readiness matrix (infra_ready until staging proof)."
  value = {
    component             = "tier3-dedicated-relay"
    status                = local.module_status
    production_ready      = local.production_ready
    creates_aws_resources = local.creates_aws_resources
    readiness             = local.readiness_matrix_status
    production_apply      = local.production_apply
    public_edge           = true
    service_role          = "dedicated-relay"
    relay_tier            = "dedicated"
    tenant_slug           = local.tenant_slug
    relay_hostname        = local.relay_hostname
    relay_wss_url         = local.relay_wss_url
    desired_count         = var.desired_count
    digest_pinned         = true
    secrets_injected      = length(var.secrets)
    dns_record            = local.create_dns
    waf_associated        = local.associate_waf
    composed_module       = "portal-relay-service"
    scale_gate            = "desired_count>1 requires G6 acknowledge"
    security_note         = "G2 relay credential lifecycle still required for production security claim; not production-certified from module presence alone"
  }
}

output "production_ready" {
  description = "Always false until staging proof + G2. Do not claim production-complete from this module."
  value       = local.production_ready
}

output "creates_aws_resources" {
  description = "Always true. This module composes real ALB/ECS (and optional DNS/WAF) resources."
  value       = local.creates_aws_resources
}

output "readiness_status" {
  description = "Matches references/readiness-matrix.md Tier 3 row (infra_ready until staging proof)."
  value       = local.readiness_matrix_status
}
