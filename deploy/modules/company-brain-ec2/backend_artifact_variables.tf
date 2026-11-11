# ---------------------------------------------------------------------------
# Backend artifact contract (lp-k7g.7.3 / rewired lp-k7g.10.2)
#
# Additive interface under deploy/modules/company-brain-ec2/.
# New backend_artifact_* / backend_contract_* / backend_install_path live here.
# Legacy hermes_artifact_* / relay_contract_major / hermes_install_path remain in
# variables.tf (product defaults) so Terraform does not see duplicate declarations
# after the monorepo import. Locals in backend_artifact_locals.tf resolve both.
#
# Design: docs/architecture/deploy-backend-artifact-variables.md
# Pins v2: compatibility/schema.json (backend.url / version / sha256 / kind / contract)
# client_core_artifact_* stays separate (not defined here).
# ---------------------------------------------------------------------------

# ---- Primary backend artifact pins (generic; any backend.kind) ------------

variable "backend_artifact_url" {
  description = <<-EOT
    HTTPS or s3:// URL for the selected backend runtime artifact (any backend.kind).
    Aligns with CompatibilityPinsV2 backend.url. http:// is rejected.
    Null means resolve via temporary hermes_artifact_url alias (migration only).
  EOT
  type        = string
  default     = null

  validation {
    condition = (
      var.backend_artifact_url == null
      || var.backend_artifact_url == "UNCONFIGURED"
      || var.backend_artifact_url == "REPLACE_ME"
      || can(regex("^https://", var.backend_artifact_url))
      || can(regex("^s3://", var.backend_artifact_url))
    )
    error_message = "backend_artifact_url must be null, UNCONFIGURED, REPLACE_ME, https://…, or s3://… (http:// and other schemes are rejected)."
  }
}

variable "backend_artifact_version" {
  description = <<-EOT
    Pinned backend artifact version string (e.g. v0.1.0-g7h2). Not a git branch.
    Aligns with CompatibilityPinsV2 backend.version. Null → temporary hermes_artifact_version.
  EOT
  type        = string
  default     = null
}

variable "backend_artifact_sha256" {
  description = <<-EOT
    Expected SHA-256 hex digest of the backend artifact (64 hex; optional sha256: prefix
    may be normalized by bootstrap). Aligns with CompatibilityPinsV2 backend.sha256.
    Null → temporary hermes_artifact_sha256.
  EOT
  type        = string
  default     = null
}

variable "backend_artifact_kind" {
  description = <<-EOT
    Backend product kind matching contracts/backend-runtime-v1 and pins v2 backend.kind:
      hermes_upstream | hermes_lanyard | lanyard_agent
    Default hermes_lanyard matches current company-brain-deploy Hermes-Lanyard pins.
  EOT
  type        = string
  default     = "hermes_lanyard"

  validation {
    condition     = contains(["hermes_upstream", "hermes_lanyard", "lanyard_agent"], var.backend_artifact_kind)
    error_message = "backend_artifact_kind must be hermes_upstream, hermes_lanyard, or lanyard_agent."
  }
}

variable "backend_artifact_arch" {
  description = <<-EOT
    CPU/OS platform label for the backend runtime tarball (native wheels).
    Aligns with CompatibilityPinsV2 backend.arch and product TARGET_ARCH:
      linux-x86_64   — default product (mocklab, typical t3.* EC2)
      linux-aarch64  — optional arm pack only when published
    Operators must set intentionally. Prefer arch-labeled pin URLs
    (…/<arch>/…) once labeled objects exist; do not silently fall back to
    unlabeled hermes/<version>/… keys. Product workflow may echo hermes.arch /
    hermes.target_arch with the same value. Env: BACKEND_ARTIFACT_ARCH.
  EOT
  type        = string
  default     = "linux-x86_64"

  validation {
    condition     = contains(["linux-x86_64", "linux-aarch64"], var.backend_artifact_arch)
    error_message = "backend_artifact_arch must be linux-x86_64 (default) or linux-aarch64."
  }
}

variable "backend_artifact_signature_b64" {
  description = <<-EOT
    Optional base64 Ed25519 signature over the backend tarball bytes
    (CompatibilityPinsV2 backend.signature_b64). Empty skips signature verify unless
    artifact_attestation.require is enforced in pins/bootstrap.
  EOT
  type        = string
  default     = ""
}

# ---- Contract majors (pins v2 backend.contract.*) -------------------------

variable "backend_contract_runtime_layout" {
  description = "Major version of the backend runtime layout contract (pins: backend.contract.runtime_layout)."
  type        = number
  default     = 1

  validation {
    condition     = var.backend_contract_runtime_layout >= 1
    error_message = "backend_contract_runtime_layout must be an integer >= 1."
  }
}

variable "backend_contract_relay" {
  description = <<-EOT
    Major version of the relay connector contract (pins: backend.contract.relay).
    Replaces relay_contract_major. Null → temporary relay_contract_major (string) or 1.
  EOT
  type        = number
  default     = null

  validation {
    condition     = var.backend_contract_relay == null ? true : var.backend_contract_relay >= 1
    error_message = "backend_contract_relay must be null or an integer >= 1."
  }
}

variable "backend_contract_brain_rpc" {
  description = "Major version of the brain RPC contract (pins: backend.contract.brain_rpc)."
  type        = number
  default     = 1

  validation {
    condition     = var.backend_contract_brain_rpc >= 1
    error_message = "backend_contract_brain_rpc must be an integer >= 1."
  }
}

variable "backend_install_path" {
  description = <<-EOT
    Backend install root for versioned layout (lp-k7g.7.4).
    Preferred default: /opt/company-brain-backend
      versions/<version>/   # extracted archive
      current -> versions/<version>
    Generic name replaces hermes_install_path. Null → hermes_install_path from
    variables.tf or /opt/company-brain-backend once bootstrap reads BACKEND_*.
    See docs/architecture/deploy-bootstrap-backend-install.md.
  EOT
  type        = string
  default     = null
}

# Legacy hermes_artifact_* / relay_contract_major / hermes_install_path are
# declared only in variables.tf (product surface). Prefer backend_artifact_*
# above when setting pins; backend_artifact_locals.tf resolves conflicts.
