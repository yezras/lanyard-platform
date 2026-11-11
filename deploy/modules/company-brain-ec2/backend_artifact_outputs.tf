# ---------------------------------------------------------------------------
# Backend artifact outputs (lp-k7g.7.3)
#
# Primary shape uses backend_* keys. Temporary hermes_* keys dual-write the
# same effective values for existing consumers (outputs.artifact_pins hermes_*).
# Remove hermes_* keys after migration window.
# ---------------------------------------------------------------------------

output "backend_artifact_pins" {
  description = <<-EOT
    Effective backend artifact coordinates passed into bootstrap / user_data.
    Prefer this over legacy artifact_pins.hermes_* keys.
  EOT
  value = {
    url           = local.effective_backend_artifact_url
    version       = local.effective_backend_artifact_version
    sha256        = local.effective_backend_artifact_sha256
    kind          = local.effective_backend_artifact_kind
    arch          = local.effective_backend_artifact_arch
    signature_b64 = local.effective_backend_artifact_signature_b64
    install_path  = local.effective_backend_install_path
    contract = {
      runtime_layout = local.effective_backend_contract_runtime_layout
      relay          = local.effective_backend_contract_relay
      brain_rpc      = local.effective_backend_contract_brain_rpc
    }
    using_legacy_alias = local.backend_using_legacy_alias
  }
}

output "backend_artifact_url" {
  description = "Effective backend artifact URL (backend_artifact_url or temporary hermes_artifact_url)."
  value       = local.effective_backend_artifact_url
}

output "backend_artifact_version" {
  description = "Effective backend artifact version."
  value       = local.effective_backend_artifact_version
}

output "backend_artifact_sha256" {
  description = "Effective backend artifact SHA-256."
  value       = local.effective_backend_artifact_sha256
}

output "backend_artifact_kind" {
  description = "Backend product kind (hermes_upstream | hermes_lanyard | lanyard_agent)."
  value       = local.effective_backend_artifact_kind
}

output "backend_artifact_arch" {
  description = "Backend runtime arch label (linux-x86_64 default | linux-aarch64 optional)."
  value       = local.effective_backend_artifact_arch
}

# --- TEMPORARY legacy-shaped fields (mirror pre-migration artifact_pins) ---
# When merging into outputs.tf, replace hermes_* keys in artifact_pins with
# the structure below (or dual-write until consumers migrate).

output "artifact_pins_backend_migration" {
  description = <<-EOT
    TEMPORARY dual-shape backend pin map for migration: backend_* primary + hermes_*
    aliases with identical effective values. On merge into existing artifact_pins
    output, keep client_core_* from var.client_core_artifact_*; replace hermes_*
    with backend_* (and dual-write hermes_* only during the migration window).
  EOT
  value = {
    # Primary
    backend_url                     = local.effective_backend_artifact_url
    backend_version                 = local.effective_backend_artifact_version
    backend_sha256                  = local.effective_backend_artifact_sha256
    backend_kind                    = local.effective_backend_artifact_kind
    backend_arch                    = local.effective_backend_artifact_arch
    backend_contract_relay          = local.effective_backend_contract_relay
    backend_contract_runtime_layout = local.effective_backend_contract_runtime_layout
    backend_contract_brain_rpc      = local.effective_backend_contract_brain_rpc
    # TEMPORARY aliases (same values)
    hermes_url           = local.effective_backend_artifact_url
    hermes_version       = local.effective_backend_artifact_version
    hermes_sha256        = local.effective_backend_artifact_sha256
    hermes_arch          = local.effective_backend_artifact_arch
    relay_contract_major = tostring(local.effective_backend_contract_relay)
  }
}
