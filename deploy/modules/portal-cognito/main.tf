locals {
  common_tags = merge(
    {
      Project     = "company-brain-deploy"
      Component   = "portal-cognito"
      Environment = var.environment
      ManagedBy   = "terraform"
      Role        = "portal-password-idp"
    },
    var.tags,
  )

  pool_name   = "${var.name_prefix}-users"
  client_name = "${var.name_prefix}-bff"
}

check "acknowledge_not_auto_applied" {
  assert {
    condition     = var.acknowledge_not_auto_applied == true
    error_message = "acknowledge_not_auto_applied must be true before planning portal Cognito."
  }
}

resource "aws_cognito_user_pool" "portal" {
  name = local.pool_name

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_numbers   = true
    require_symbols   = false
    require_uppercase = false
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  tags = local.common_tags
}

resource "aws_cognito_user_pool_client" "bff" {
  name         = local.client_name
  user_pool_id = aws_cognito_user_pool.portal.id

  generate_secret                      = true
  explicit_auth_flows                  = ["ALLOW_ADMIN_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  allowed_oauth_flows_user_pool_client = false
}
