output "role_name" {
  description = "Harness ECS execution role name."
  value       = try(aws_iam_role.execution[0].name, local.role_name)
}

output "role_arn" {
  description = "Harness ECS execution role ARN (null when create_role is false)."
  value       = try(aws_iam_role.execution[0].arn, null)
}

output "secret_names" {
  description = "SM secret names the exec role may GetSecretValue (names only — never values)."
  value       = local.secret_names
}

output "secret_arn_patterns" {
  description = "IAM Resource ARN patterns (account/region + name + -*). Never secret values."
  value       = local.secret_arn_patterns
}

output "module_status" {
  description = "Honesty summary. Not auto-applied."
  value = {
    component        = "harness-exec-iam"
    bead             = "lp-oop.38.20"
    create_role      = var.create_role
    secret_count     = length(local.secret_names)
    production_apply = "operator_owned_not_auto_applied"
  }
}
