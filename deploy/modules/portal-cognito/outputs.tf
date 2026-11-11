output "user_pool_id" {
  description = "Cognito user pool id. Set BFF COGNITO_USER_POOL_ID."
  value       = aws_cognito_user_pool.portal.id
}

output "user_pool_arn" {
  description = "Cognito user pool ARN."
  value       = aws_cognito_user_pool.portal.arn
}

output "client_id" {
  description = "BFF app client id. Set BFF COGNITO_CLIENT_ID."
  value       = aws_cognito_user_pool_client.bff.id
}

output "client_secret" {
  description = "BFF app client secret. Inject as COGNITO_CLIENT_SECRET via Secrets Manager, never plaintext ECS env."
  value       = aws_cognito_user_pool_client.bff.client_secret
  sensitive   = true
}

output "bff_env" {
  description = "Non-secret BFF environment keys for Cognito."
  value = {
    COGNITO_USER_POOL_ID = aws_cognito_user_pool.portal.id
    COGNITO_CLIENT_ID    = aws_cognito_user_pool_client.bff.id
  }
}
