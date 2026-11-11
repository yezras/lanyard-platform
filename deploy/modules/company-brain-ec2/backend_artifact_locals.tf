# ---------------------------------------------------------------------------
# Effective backend artifact pins (lp-k7g.7.3)
#
# Prefer backend_artifact_* / backend_contract_* / backend_install_path.
# Fall back to TEMPORARY hermes_* / relay_contract_major aliases.
# Fail plan when both sides are set to conflicting non-sentinel values.
#
# Wire templatefile(user_data) and outputs to local.effective_backend_* only.
# Design: docs/architecture/deploy-backend-artifact-variables.md
# ---------------------------------------------------------------------------

locals {
  # Sentinels treated as "unset" for conflict detection and coalesce.
  _backend_url_sentinels = toset(["", "UNCONFIGURED", "REPLACE_ME"])

  _backend_url_new = (
    var.backend_artifact_url == null || contains(local._backend_url_sentinels, var.backend_artifact_url)
    ? null
    : var.backend_artifact_url
  )
  _backend_url_legacy = (
    var.hermes_artifact_url == null || contains(local._backend_url_sentinels, var.hermes_artifact_url)
    ? null
    : var.hermes_artifact_url
  )

  _backend_version_new = (
    var.backend_artifact_version == null || contains(local._backend_url_sentinels, var.backend_artifact_version)
    ? null
    : var.backend_artifact_version
  )
  _backend_version_legacy = (
    var.hermes_artifact_version == null || contains(local._backend_url_sentinels, var.hermes_artifact_version)
    ? null
    : var.hermes_artifact_version
  )

  _backend_sha_new = (
    var.backend_artifact_sha256 == null || contains(local._backend_url_sentinels, var.backend_artifact_sha256)
    ? null
    : var.backend_artifact_sha256
  )
  _backend_sha_legacy = (
    var.hermes_artifact_sha256 == null || contains(local._backend_url_sentinels, var.hermes_artifact_sha256)
    ? null
    : var.hermes_artifact_sha256
  )

  _relay_from_legacy = (
    var.relay_contract_major == null || var.relay_contract_major == ""
    ? null
    : try(tonumber(var.relay_contract_major), null)
  )

  # --- Effective values consumed by user_data + outputs --------------------

  effective_backend_artifact_url = coalesce(
    local._backend_url_new,
    local._backend_url_legacy,
    "UNCONFIGURED"
  )

  effective_backend_artifact_version = coalesce(
    local._backend_version_new,
    local._backend_version_legacy,
    "UNCONFIGURED"
  )

  effective_backend_artifact_sha256 = coalesce(
    local._backend_sha_new,
    local._backend_sha_legacy,
    "UNCONFIGURED"
  )

  effective_backend_artifact_kind          = var.backend_artifact_kind
  effective_backend_artifact_arch          = var.backend_artifact_arch
  effective_backend_artifact_signature_b64 = var.backend_artifact_signature_b64

  effective_backend_contract_runtime_layout = var.backend_contract_runtime_layout
  effective_backend_contract_relay = coalesce(
    var.backend_contract_relay,
    local._relay_from_legacy,
    1
  )
  effective_backend_contract_brain_rpc = var.backend_contract_brain_rpc

  # Versioned install root (lp-k7g.7.4): versions/<ver>/ + current symlink.
  # Legacy hermes_install_path may still be /opt/hermes-lanyard during migration.
  effective_backend_install_path = coalesce(
    var.backend_install_path,
    var.hermes_install_path,
    "/opt/company-brain-backend"
  )

  # True when any legacy alias supplied a non-sentinel value (ops signal).
  backend_using_legacy_alias = (
    local._backend_url_legacy != null
    || local._backend_version_legacy != null
    || local._backend_sha_legacy != null
    || local._relay_from_legacy != null
    || var.hermes_install_path != null
  )
}

# Conflict checks: both new and legacy set to real, differing values → fail plan.
check "backend_artifact_url_alias_conflict" {
  assert {
    condition = (
      local._backend_url_new == null
      || local._backend_url_legacy == null
      || local._backend_url_new == local._backend_url_legacy
    )
    error_message = "backend_artifact_url and hermes_artifact_url (legacy) are both set and differ. Use only backend_artifact_url."
  }
}

check "backend_artifact_version_alias_conflict" {
  assert {
    condition = (
      local._backend_version_new == null
      || local._backend_version_legacy == null
      || local._backend_version_new == local._backend_version_legacy
    )
    error_message = "backend_artifact_version and hermes_artifact_version (legacy) are both set and differ. Use only backend_artifact_version."
  }
}

check "backend_artifact_sha256_alias_conflict" {
  assert {
    condition = (
      local._backend_sha_new == null
      || local._backend_sha_legacy == null
      || local._backend_sha_new == local._backend_sha_legacy
    )
    error_message = "backend_artifact_sha256 and hermes_artifact_sha256 (legacy) are both set and differ. Use only backend_artifact_sha256."
  }
}

check "backend_contract_relay_alias_conflict" {
  assert {
    condition = (
      var.backend_contract_relay == null
      || local._relay_from_legacy == null
      || var.backend_contract_relay == local._relay_from_legacy
    )
    error_message = "backend_contract_relay and relay_contract_major (legacy) are both set and differ. Use only backend_contract_relay."
  }
}
