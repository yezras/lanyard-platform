# ---------------------------------------------------------------------------
# Tenant outputs for generic backend artifact pins (lp-k7g.7.3 / rewired lp-k7g.10.2)
#
# New backend_* outputs only. Legacy hermes_artifact_version / relay_contract_major
# remain in outputs.tf so post-import validate has no duplicate output names.
# ---------------------------------------------------------------------------

output "backend_artifact_url" {
  description = "Backend artifact URL (new name preferred; falls back to hermes_artifact_url)."
  value       = coalesce(var.backend_artifact_url, var.hermes_artifact_url, "UNCONFIGURED")
}

output "backend_artifact_version" {
  description = "Backend artifact version (generic; falls back to hermes_artifact_version)."
  value       = coalesce(var.backend_artifact_version, var.hermes_artifact_version, "UNCONFIGURED")
}

output "backend_artifact_sha256" {
  description = "Backend artifact SHA-256."
  value       = coalesce(var.backend_artifact_sha256, var.hermes_artifact_sha256, "UNCONFIGURED")
}

output "backend_artifact_kind" {
  description = "Backend product kind."
  value       = var.backend_artifact_kind
}

output "backend_artifact_arch" {
  description = "Backend runtime arch label (linux-x86_64 default | linux-aarch64 optional)."
  value       = var.backend_artifact_arch
}

output "backend_contract_relay" {
  description = "Relay contract major (number; falls back to relay_contract_major string)."
  value = coalesce(
    var.backend_contract_relay,
    try(tonumber(var.relay_contract_major), null),
    1
  )
}
