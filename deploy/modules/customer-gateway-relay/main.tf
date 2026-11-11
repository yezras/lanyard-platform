locals {
  relay_base_url = trimsuffix(trimspace(var.relay_wss_url), "/")

  secret_source = var.relay_secret_source
  is_inline     = local.secret_source == "inline"
  is_ssm        = local.secret_source == "ssm"
  is_sm         = local.secret_source == "secretsmanager"
  is_production = var.deployment_mode == "production"

  # Inline secret value only when lab+inline; never read for production path outputs/files.
  inline_secret = local.is_inline ? var.relay_instance_secret : ""

  ssm_parameter_name = trimspace(var.relay_secret_ssm_parameter_name)
  sm_secret_arn      = trimspace(var.relay_secret_secretsmanager_secret_arn)

  # Prefer explicit ARN; otherwise name-scoped pattern for IAM docs (account filled at attach time).
  ssm_parameter_arn = trimspace(var.relay_secret_ssm_parameter_arn) != "" ? trimspace(var.relay_secret_ssm_parameter_arn) : (
    local.ssm_parameter_name != "" ? "arn:aws:ssm:*:*:parameter${startswith(local.ssm_parameter_name, "/") ? "" : "/"}${local.ssm_parameter_name}" : ""
  )

  # Non-secret Hermes env always present.
  hermes_env_public = {
    GATEWAY_RELAY_URL         = local.relay_base_url
    GATEWAY_RELAY_ID          = var.relay_instance_id
    GATEWAY_RELAY_INSTANCE_ID = var.relay_instance_id
    GATEWAY_RELAY_PLATFORMS   = var.relay_platform
  }

  # Reference-only hints for host-side fetch (not consumed by Hermes natively).
  hermes_env_secret_ref = local.is_ssm ? {
    GATEWAY_RELAY_SECRET_SSM_PARAMETER = local.ssm_parameter_name
    } : local.is_sm ? {
    GATEWAY_RELAY_SECRET_SECRETS_MANAGER_ARN = local.sm_secret_arn
  } : {}

  # Full env map: includes GATEWAY_RELAY_SECRET only for lab+inline.
  hermes_env = merge(
    local.hermes_env_public,
    local.hermes_env_secret_ref,
    local.is_inline ? { GATEWAY_RELAY_SECRET = local.inline_secret } : {}
  )

  hermes_gateway_yaml_public = {
    relay_url         = local.relay_base_url
    relay_id          = var.relay_instance_id
    relay_instance_id = var.relay_instance_id
  }

  hermes_gateway_yaml = merge(
    local.hermes_gateway_yaml_public,
    local.is_inline ? { relay_secret = local.inline_secret } : {}
  )

  env_output_path = var.hermes_env_output_path != "" ? var.hermes_env_output_path : "${var.hermes_home}/.env.relay"

  # local_file may include plaintext secret only in lab+inline.
  write_secret_to_file = var.write_hermes_env_file && local.is_inline && !local.is_production

  relay_secret_iam_policy = local.is_ssm ? {
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "GetRelaySecretParameter"
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
        ]
        Resource = [local.ssm_parameter_arn]
      },
      {
        # KMS decrypt when SecureString uses a CMK (default aws/ssm is account-managed).
        Sid      = "DecryptSecureString"
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = ["*"]
        Condition = {
          StringEquals = {
            "kms:ViaService" = "ssm.*.amazonaws.com"
          }
        }
      },
    ]
    } : local.is_sm ? {
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "GetRelaySecret"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [local.sm_secret_arn]
      },
      {
        Sid      = "DecryptSecret"
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = ["*"]
        Condition = {
          StringEquals = {
            "kms:ViaService" = "secretsmanager.*.amazonaws.com"
          }
        }
      },
    ]
    } : {
    Version   = "2012-10-17"
    Statement = []
  }

  host_secret_fetch_command = local.is_ssm ? join(" ", [
    "aws ssm get-parameter",
    "--name ${local.ssm_parameter_name}",
    "--with-decryption",
    "--query Parameter.Value",
    "--output text",
    ]) : local.is_sm ? join(" ", [
    "aws secretsmanager get-secret-value",
    "--secret-id ${local.sm_secret_arn}",
    "--query SecretString",
    "--output text",
  ]) : "# lab/inline: secret already available as Terraform input — do not use for production"
}

# ---------------------------------------------------------------------------
# Contract checks (terraform validate / plan)
# ---------------------------------------------------------------------------

check "production_rejects_inline_secret" {
  assert {
    condition     = !(local.is_production && local.is_inline)
    error_message = "deployment_mode=production rejects relay_secret_source=inline. Use ssm or secretsmanager and store the secret outside Terraform (see references/runbooks/relay-secret-lifecycle.md)."
  }
}

check "inline_requires_secret_value" {
  assert {
    condition     = !local.is_inline || length(trimspace(var.relay_instance_secret)) > 0
    error_message = "relay_instance_secret must be non-empty when relay_secret_source=inline (lab only)."
  }
}

check "ssm_requires_parameter_name" {
  assert {
    condition     = !local.is_ssm || length(local.ssm_parameter_name) > 0
    error_message = "relay_secret_ssm_parameter_name is required when relay_secret_source=ssm."
  }
}

check "secretsmanager_requires_arn" {
  assert {
    condition     = !local.is_sm || length(local.sm_secret_arn) > 0
    error_message = "relay_secret_secretsmanager_secret_arn is required when relay_secret_source=secretsmanager."
  }
}

check "production_no_secret_local_file" {
  assert {
    condition     = !(local.is_production && var.write_hermes_env_file && local.is_inline)
    error_message = "production forbids write_hermes_env_file with inline secrets (would write secret material into the working tree). Keep write_hermes_env_file=false or use ssm/secretsmanager references only."
  }
}

check "production_no_inline_secret_in_tf" {
  assert {
    condition     = !(local.is_production && length(trimspace(var.relay_instance_secret)) > 0)
    error_message = "deployment_mode=production forbids setting relay_instance_secret (would land in Terraform state). Put the secret in SSM/Secrets Manager and leave this variable empty."
  }
}

# Render env fragment: production path never embeds the secret value.
resource "local_file" "hermes_relay_env" {
  count = var.write_hermes_env_file ? 1 : 0

  filename        = local.env_output_path
  file_permission = "0600"
  content = templatefile("${path.module}/templates/hermes-gateway-relay.env.tpl", {
    relay_url                 = local.relay_base_url
    relay_instance_id         = var.relay_instance_id
    relay_platform            = var.relay_platform
    tenant_slug               = var.tenant_slug
    generated_at_utc          = timestamp()
    include_secret            = local.write_secret_to_file
    relay_secret              = local.write_secret_to_file ? local.inline_secret : ""
    secret_source             = local.secret_source
    ssm_parameter_name        = local.ssm_parameter_name
    secretsmanager_secret_arn = local.sm_secret_arn
    host_secret_fetch_command = local.host_secret_fetch_command
  })
}
