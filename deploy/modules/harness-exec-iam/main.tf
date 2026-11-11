locals {
  common_tags = merge(
    {
      Project     = "company-brain-deploy"
      Component   = "harness-exec-iam"
      Environment = var.environment
      ManagedBy   = "terraform"
      Role        = "harness-exec"
      Bead        = "lp-oop.38.20"
    },
    var.tags,
  )

  catalog = jsondecode(file("${path.module}/secret-catalog.json"))

  secret_names = distinct(concat(
    tolist(local.catalog.secret_names),
    var.extra_secret_names,
  ))

  extra_secret_arns_stripped = distinct(compact([
    for arn in var.extra_secret_arns :
    length(split(":", arn)) > 7 ? join(":", slice(split(":", arn), 0, 7)) : arn
  ]))

  # IAM Resource patterns. SM puts a random suffix on the live ARN; -* matches it.
  secret_arn_patterns = distinct(concat(
    [
      for n in local.secret_names :
      "arn:aws:secretsmanager:${var.aws_region}:${var.aws_account_id}:secret:${n}-*"
    ],
    local.extra_secret_arns_stripped,
  ))

  role_name = var.role_name != "" ? var.role_name : "${var.name_prefix}-harness-exec"

  has_secrets = length(local.secret_arn_patterns) > 0
}

check "catalog_includes_live_harness_secrets" {
  assert {
    condition = alltrue([
      contains(local.secret_names, "lanyard/staging/portal/harness-litellm"),
      contains(local.secret_names, "lanyard/staging/portal/daytona"),
    ])
    error_message = "harness exec catalog must include harness-litellm and daytona (lp-oop.38.20). IAM reconcile must keep GetSecretValue on those names."
  }
}

check "no_wildcard_secret_resource" {
  assert {
    condition     = !contains(local.secret_arn_patterns, "*")
    error_message = "harness exec GetSecretValue must not use Resource=\"*\"."
  }
}
