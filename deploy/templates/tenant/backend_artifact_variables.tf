# ---------------------------------------------------------------------------
# Tenant root: backend artifact variables (lp-k7g.7.3 / rewired lp-k7g.10.2)
#
# Additive under deploy/templates/tenant/. New backend_artifact_* live here.
# Legacy hermes_artifact_* / relay_contract_major / hermes_install_path stay in
# variables.tf so post-import validate does not see duplicate declarations.
#
# Design: docs/architecture/deploy-backend-artifact-variables.md
# ---------------------------------------------------------------------------

# ---- Primary (generic backend; maps from CompatibilityPinsV2 backend.*) ---

variable "backend_artifact_url" {
  type        = string
  description = "HTTPS or s3:// URL for the selected backend runtime artifact (pins: backend.url)."
  default     = null

  validation {
    condition = (
      var.backend_artifact_url == null
      || var.backend_artifact_url == "UNCONFIGURED"
      || var.backend_artifact_url == "REPLACE_ME"
      || can(regex("^https://", var.backend_artifact_url))
      || can(regex("^s3://", var.backend_artifact_url))
    )
    error_message = "backend_artifact_url must be null, UNCONFIGURED, REPLACE_ME, https://…, or s3://…."
  }
}

variable "backend_artifact_version" {
  type        = string
  description = "Pinned backend artifact version (pins: backend.version). Not a git branch."
  default     = null
}

variable "backend_artifact_sha256" {
  type        = string
  description = "Expected SHA-256 of the backend artifact (pins: backend.sha256)."
  default     = null
}

variable "backend_artifact_kind" {
  type        = string
  description = "Backend kind: hermes_upstream | hermes_lanyard | lanyard_agent (pins: backend.kind)."
  default     = "hermes_lanyard"

  validation {
    condition     = contains(["hermes_upstream", "hermes_lanyard", "lanyard_agent"], var.backend_artifact_kind)
    error_message = "backend_artifact_kind must be hermes_upstream, hermes_lanyard, or lanyard_agent."
  }
}

variable "backend_artifact_arch" {
  type        = string
  description = <<-EOT
    Backend runtime arch label (pins: backend.arch). Default linux-x86_64 for mocklab /
    typical EC2. Optional linux-aarch64 when an arm tarball was published.
    Prefer arch-labeled artifact URLs; do not silently use unlabeled hermes/<ver>/ paths.
  EOT
  default     = "linux-x86_64"

  validation {
    condition     = contains(["linux-x86_64", "linux-aarch64"], var.backend_artifact_arch)
    error_message = "backend_artifact_arch must be linux-x86_64 (default) or linux-aarch64."
  }
}

variable "backend_artifact_signature_b64" {
  type        = string
  description = "Optional base64 Ed25519 signature (pins: backend.signature_b64)."
  default     = ""
}

variable "backend_contract_runtime_layout" {
  type        = number
  description = "pins: backend.contract.runtime_layout"
  default     = 1

  validation {
    condition     = var.backend_contract_runtime_layout >= 1
    error_message = "backend_contract_runtime_layout must be >= 1."
  }
}

variable "backend_contract_relay" {
  type        = number
  description = "pins: backend.contract.relay (replaces relay_contract_major)."
  default     = null

  validation {
    condition     = var.backend_contract_relay == null ? true : var.backend_contract_relay >= 1
    error_message = "backend_contract_relay must be null or >= 1."
  }
}

variable "backend_contract_brain_rpc" {
  type        = number
  description = "pins: backend.contract.brain_rpc"
  default     = 1

  validation {
    condition     = var.backend_contract_brain_rpc >= 1
    error_message = "backend_contract_brain_rpc must be >= 1."
  }
}

variable "backend_install_path" {
  type        = string
  description = "Backend extract/install path (replaces hermes_install_path)."
  default     = null
}

# Legacy hermes_artifact_* / relay_contract_major / hermes_install_path remain
# in variables.tf only (product defaults). Prefer backend_artifact_* when setting
# pins; wire into module.company_brain in a follow-on bead (lp-k7g.10.3).
