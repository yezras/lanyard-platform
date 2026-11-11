locals {
  common_tags = merge(
    {
      Name        = var.role_name
      Environment = var.environment
      Purpose     = "sandbox-vault-mount"
      Plan        = "0008-daytona-agent-sandboxes"
      Bead        = "lp-zuh.9.1"
    },
    var.tags,
  )

  vault_bucket_arn = "arn:aws:s3:::${var.vault_bucket_name}"

  # Upper-bound object tree for the *shared* base role (session policy narrows
  # to one tenant at mint time). Mid-path wildcard is intentional; never whole-bucket.
  vault_object_arn_upper = "${local.vault_bucket_arn}/tenants/*/vault/*"

  # ListBucket s3:prefix conditions for any tenant vault tree only
  # (not whole-bucket, not tenants/* broadly — session policy narrows further).
  list_prefix_values_upper = [
    "tenants/*/vault/",
    "tenants/*/vault/*",
  ]

  # Platform sibling under every tenant — never guest-reachable via base or session.
  platform_deny_resources = [
    "${local.vault_bucket_arn}/tenants/*/_platform",
    "${local.vault_bucket_arn}/tenants/*/_platform/*",
  ]

  # Keep secret value only for trust condition; expose a non-sensitive boolean.
  external_id_set = nonsensitive(
    var.external_id != null && var.external_id != ""
  )
  external_id_effective = (
    local.external_id_set
    ? var.external_id
    : null
  )

  # Role principals only (for inline AssumeRole attach). Users need out-of-band grant.
  orchestrator_role_names = distinct([
    for arn in var.orchestrator_principal_arns :
    regex("^arn:aws:iam::[0-9]{12}:role/(.+)$", arn)[0]
    if can(regex("^arn:aws:iam::[0-9]{12}:role/", arn))
  ])

  create_role = var.create_base_role && length(var.orchestrator_principal_arns) > 0

  attach_assume = (
    local.create_role &&
    var.attach_orchestrator_assume_policy &&
    length(local.orchestrator_role_names) > 0
  )
}

check "no_wildcard_orchestrator_principal" {
  assert {
    condition = alltrue([
      for a in var.orchestrator_principal_arns : a != "*" && !endswith(a, ":root")
    ])
    error_message = "orchestrator_principal_arns must not use * or account-root principals."
  }
}

check "vault_bucket_name_shape" {
  assert {
    condition = (
      can(regex("^lanyard-mocklab-vault-", var.vault_bucket_name)) ||
      can(regex("^lanyard-vault-", var.vault_bucket_name))
    )
    error_message = "vault_bucket_name must be lanyard-mocklab-vault-* or lanyard-vault-*."
  }
}
