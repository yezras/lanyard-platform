# Tenant terraform.tfvars fragment — Hermes-Lanyard via generic backend_artifact_*
# Bead: lp-k7g.12.5
#
# Copy into a private tenant overlay (never commit live account-specific values
# that include secrets). Aligns with:
#   compatibility/pins.hermes-lanyard-staging.example.yaml
#   deploy/templates/tenant/terraform.tfvars.backend_artifact.example
#
# Preferred long-term URLs use platform S3:
#   s3://$BUCKET/backends/hermes-lanyard/v0.1.0-g7h3/backend.tar.gz
# HTTPS private GH remains valid; inject GITHUB_TOKEN/GH_TOKEN on the host
# from SSM/Secrets Manager (not Terraform state when avoidable).

backend_artifact_kind    = "hermes_lanyard"
backend_artifact_url     = "https://github.com/LanyardBrain/hermes-lanyard/releases/download/v0.1.0-g7h3/hermes-v0.1.0-g7h3.tar.gz"
backend_artifact_version = "v0.1.0-g7h3"
backend_artifact_sha256  = "a372580396e170436c22e44a61fbcdf8d2c7cf4f5d328694bb5afdf279904db9"

backend_contract_runtime_layout = 1
backend_contract_relay          = 1
backend_contract_brain_rpc      = 1

# Optional versioned install root (default in bootstrap):
# backend_install_path = "/opt/company-brain-backend"

# client-core remains SEPARATE (do not nest under backend)
client_core_artifact_url     = "https://github.com/LanyardBrain/client-core/releases/download/v0.1.0-g7c2/client-core-v0.1.0-g7c2.tar.gz"
client_core_artifact_version = "v0.1.0-g7c2"
client_core_artifact_sha256  = "ef21c313525afdca9902c40814293bbe924f428c219d93cf80398941c1f181e1"

# Do NOT set hermes_artifact_* to different values in the same apply.
# New tenants: prefer only backend_artifact_* above.
