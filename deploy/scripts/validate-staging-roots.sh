#!/usr/bin/env bash
# Validate deploy staging roots after monorepo move (lp-k7g.10.6).
# Runs terraform fmt -check, terraform validate on CI roots, and bootstrap smokes.
# Usage (from deploy/ or monorepo root):
#   bash deploy/scripts/validate-staging-roots.sh
#   bash scripts/validate-staging-roots.sh   # when cwd is deploy/
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$DEPLOY_ROOT"

err() { echo "[validate-staging-roots] ERROR: $*" >&2; }
log() { echo "[validate-staging-roots] $*"; }
fail() { err "$*"; exit 1; }

log "deploy root: $DEPLOY_ROOT"

if ! command -v terraform >/dev/null 2>&1; then
  fail "terraform CLI required for full staging validation"
fi

log "1/3 terraform fmt -check -recursive"
terraform fmt -check -recursive || fail "terraform fmt -check failed (run: terraform fmt -recursive)"

log "2/3 terraform init -backend=false + validate (CI roots)"
ROOTS=(
  modules/company-brain-ec2
  modules/customer-gateway-relay
  modules/tier3-dedicated-relay
  modules/product-artifact-infra
  modules/security-observability
  modules/control-plane-rds
  modules/platform-vpc
  modules/portal-valkey
  modules/portal-static-edge
  modules/portal-bff-service
  modules/portal-relay-service
  modules/portal-control-plane-service
  modules/customer-account-access
  modules/account-factory
  templates/tenant
  environments/platform-staging
)
for d in "${ROOTS[@]}"; do
  log "  -> $d"
  (
    cd "$d"
    terraform init -backend=false -input=false -no-color >/dev/null
    terraform validate -no-color
  ) || fail "terraform validate failed for $d"
done
# configuration_aliases modules: dedicated smokes
log "  -> modules/portal-dns-tls (smoke)"
bash scripts/smoke-portal-dns-tls.sh
log "  -> modules/portal-waf (smoke)"
bash scripts/smoke-portal-waf.sh

log "3/3 bootstrap + staging compose smokes"
bash scripts/smoke-bootstrap-extract.sh
bash scripts/smoke-bootstrap-inject.sh
bash scripts/smoke-bootstrap-backend-install.sh
bash scripts/smoke-backend-systemd-unit.sh
bash scripts/smoke-platform-staging-compose.sh

log "All staging root validation checks passed."
echo "PASS: validate-staging-roots"
