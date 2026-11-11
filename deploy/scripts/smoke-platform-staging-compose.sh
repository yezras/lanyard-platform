#!/usr/bin/env bash
# Offline smoke: environments/platform-staging composes central platform layers.
# No AWS credentials, no terraform apply.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGING="$ROOT/environments/platform-staging"

err() { echo "[smoke-platform-staging-compose] ERROR: $*" >&2; }
log() { echo "[smoke-platform-staging-compose] $*"; }
fail() { err "$*"; exit 1; }
pass() { log "OK: $*"; }

require_file() {
  local f="$1"
  [ -f "$f" ] || fail "required file missing: $f"
}

require_dir() {
  local d="$1"
  [ -d "$d" ] || fail "required directory missing: $d"
}

require_dir "$STAGING"
for f in main.tf variables.tf outputs.tf versions.tf INDEX.md terraform.tfvars.example backend.tf.example; do
  require_file "$STAGING/$f"
done

# --- Relative module sources (no floating main) ---
MAIN="$STAGING/main.tf"
for mod in \
  product-artifact-infra \
  platform-vpc \
  control-plane-rds \
  portal-valkey \
  portal-bff-service \
  portal-relay-service \
  portal-control-plane-service \
  portal-static-edge \
  portal-dns-tls \
  staging-document-server
do
  grep -Eq "source[[:space:]]*=[[:space:]]*\"\\.\\./\\.\\./modules/${mod}\"" "$MAIN" \
    || fail "platform-staging must use relative source ../../modules/${mod}"
done
if grep -Eq 'ref=main|ref=master|git::' "$MAIN"; then
  fail "platform-staging must not float on git ref=main/master or remote git sources"
fi
pass "all compose layers use relative module sources"

# --- Layer enable variables ---
VARS="$STAGING/variables.tf"
for v in \
  enable_platform_vpc \
  enable_control_plane_rds \
  enable_portal_valkey \
  enable_portal_bff \
  enable_portal_relay \
  enable_portal_control_plane \
  enable_portal_static_edge \
  enable_portal_dns_tls \
  enable_staging_document_server \
  auto_wire_security_groups
do
  grep -Eq "variable[[:space:]]+\"${v}\"" "$VARS" \
    || fail "platform-staging variables.tf must declare $v"
done
pass "layer enable flags declared"

# Staging Document Server (lp-5q6.34) — default off; SM JWT wiring when on
if ! grep -A12 'variable "enable_staging_document_server"' "$VARS" | grep -Eq 'default[[:space:]]*=[[:space:]]*false'; then
  fail "enable_staging_document_server must default to false"
fi
grep -Eq 'variable[[:space:]]+"bff_execution_extra_secret_arns"' "$VARS" \
  || fail "platform-staging must declare bff_execution_extra_secret_arns (lp-oop.38.20 harness exec residual)"
grep -Eq 'execution_extra_secret_arns' "$MAIN" \
  || fail "platform-staging must pass execution_extra_secret_arns into portal_bff"
pass "BFF exec extra SM ARNs wired for shared harness residual"

grep -Eq 'BFF_OFFICE_JWT_SECRET' "$MAIN" \
  || fail "platform-staging must wire BFF_OFFICE_JWT_SECRET for staging Document Server JWT"
grep -Eq 'staging-platform-shared-ds|staging_document_server' "$MAIN" \
  || fail "platform-staging must reference staging-platform-shared-ds / staging_document_server"
grep -Eq 'document_server_jwt_secret_arn|document_server_topology' "$STAGING/outputs.tf" \
  || fail "platform-staging must output document_server_jwt_secret_arn / topology"
pass "staging Document Server layer default-off + JWT ARN wiring"

# --- Control plane internal only (G1) ---
# Must set internal = true on control-plane module; never internal = false near control-plane.
grep -Eq 'internal[[:space:]]*=[[:space:]]*true' "$MAIN" \
  || fail "platform-staging must set internal = true for control-plane service"
if grep -Ev '^\s*#' "$MAIN" | grep -Eiq 'control.plane|control_plane|portal_control_plane' ; then
  # Strip comments and ensure no internal=false in the same file body near CP composition
  body="$(grep -Ev '^\s*#' "$MAIN" || true)"
  if echo "$body" | grep -Eq 'internal[[:space:]]*=[[:space:]]*false'; then
    # Allow only if clearly not the control-plane module (BFF/relay live in other modules)
    # Root must not pass internal=false to any module.
    fail "platform-staging root must not set internal = false (control-plane is internal-only)"
  fi
fi
pass "control-plane composed as internal ALB only"

# --- RDS private / encrypted contract via module ---
grep -Eq 'publicly_accessible[[:space:]]*=[[:space:]]*false' "$MAIN" \
  || fail "platform-staging must set publicly_accessible = false for RDS"
grep -Eq 'module[[:space:]]+"control_plane_rds"' "$MAIN" \
  || fail "platform-staging must declare module.control_plane_rds"
pass "RDS composed private (publicly_accessible=false)"

# --- Digest pins for BFF / relay / CP (reject tag-only authority) ---
grep -Eq 'image_digest' "$MAIN" || fail "platform-staging must wire image_digest for portal services"
grep -Eq 'sha256:' "$MAIN" || fail "platform-staging must document/use sha256 digest placeholders"
# Modules reject :latest / tag-only; root must pin repository@digest pattern
for mod in portal-bff-service portal-relay-service portal-control-plane-service; do
  grep -Eq 'sha256:\[a-f0-9\]\{64\}|sha256:.*64' "$ROOT/modules/${mod}/variables.tf" \
    || grep -Eq 'image_digest must be sha256' "$ROOT/modules/${mod}/variables.tf" \
    || fail "module $mod must validate image_digest as sha256: + 64 hex"
  grep -Eq ':latest' "$ROOT/modules/${mod}/variables.tf" \
    || fail "module $mod must reject :latest on image_repository"
done
pass "image digest pins wired (modules reject tag-only / :latest)"

# --- ECR repositories from product-artifact-infra (no copy/paste) ---
grep -Eq 'ecr_repository_urls\["bff"\]|ecr_repository_urls\["relay"\]|ecr_repository_urls\["control-plane"\]' "$MAIN" \
  || fail "platform-staging must default image_repository from product_artifacts.ecr_repository_urls"
pass "ECR repository URLs wired from product-artifact-infra"

# --- Private CONTROL_PLANE_URL into BFF/relay ---
grep -Eq 'CONTROL_PLANE_URL' "$MAIN" \
  || fail "platform-staging must wire CONTROL_PLANE_URL for BFF/relay private CP access"
grep -Eq 'inject_control_plane_url_into_bff|inject_control_plane_url_into_relay' "$VARS" \
  || fail "platform-staging must declare inject_control_plane_url_into_* toggles"
grep -Eq 'alb_dns_name' "$MAIN" \
  || fail "platform-staging must derive CONTROL_PLANE_URL from internal CP ALB DNS"
pass "CONTROL_PLANE_URL wired from private CP ALB DNS"

# --- RDS secret ARN → CP (never plaintext password) ---
grep -Eq 'database_url_secret_arn' "$MAIN" \
  || fail "platform-staging must wire database_url_secret_arn into control-plane"
grep -Eq 'control_plane_database_url_secret_arn' "$MAIN" \
  || fail "platform-staging must reference control_plane_rds secret ARN output"
pass "RDS secret ARN wired to CP CONTROL_PLANE_DATABASE_URL"

# --- Valkey secret ARN → BFF/relay when enabled ---
grep -Eq 'redis_url_secret_arn' "$MAIN" \
  || fail "platform-staging must wire redis_url_secret_arn into BFF/relay secrets when valkey on"
grep -Eq 'REDIS_URL' "$MAIN" \
  || fail "platform-staging must inject REDIS_URL secret key for BFF/relay"
pass "Valkey REDIS_URL secret ARN wiring present"

# --- Static edge BFF origin from BFF ALB ---
grep -Eq 'bff_origin_domain_name' "$MAIN" \
  || fail "platform-staging must set bff_origin_domain_name on static edge"
grep -Eq 'module\.portal_bff\[0\]\.alb_dns_name|portal_bff\[0\]\.alb_dns_name' "$MAIN" \
  || fail "platform-staging must wire static edge BFF origin from portal_bff ALB DNS"
pass "static edge BFF origin wired from BFF ALB DNS"

# --- Two-phase SG composition (external rules, not broad CIDRs) ---
grep -Eq 'aws_vpc_security_group_ingress_rule' "$MAIN" \
  || fail "platform-staging must use aws_vpc_security_group_ingress_rule for task SG wiring"
grep -Eq 'rds_from_control_plane_tasks|rds_from_control_plane' "$MAIN" \
  || fail "platform-staging must wire RDS ingress from control-plane tasks"
grep -Eq 'cp_alb_from_bff_tasks|cp_alb_from_relay_tasks' "$MAIN" \
  || fail "platform-staging must wire CP ALB ingress from BFF/relay tasks via external rules"
grep -Eq 'cp_alb_clients_label|rds_clients_label|valkey_clients_label' "$MAIN" \
  || fail "platform-staging must use label SGs to avoid module cycles"
# Must not open data-plane with 0.0.0.0/0 in root
if grep -Ev '^\s*#|error_message|description|must not|never' "$MAIN" "$VARS" | grep -Eq '0\.0\.0\.0/0'; then
  fail "platform-staging must not use 0.0.0.0/0 for SG/CIDR wiring"
fi
# Prefer SG refs over temporary broad private CIDRs for auto-wire path
grep -Eq 'allowed_cidr_blocks[[:space:]]*=[[:space:]]*var\.(rds|valkey)_allowed_cidr_blocks' "$MAIN" \
  || fail "platform-staging must pass CIDR overrides only via variables (default empty)"
pass "SG composition uses external rules / label SGs (no 0.0.0.0/0)"

# --- Product artifact Object Lock still explicit ---
for needle in s3_object_lock_default_retention_mode s3_object_lock_default_retention_days s3_force_destroy; do
  grep -Eq "$needle" "$MAIN" || fail "platform-staging main.tf must set $needle explicitly"
  grep -Eq "$needle" "$VARS" || fail "platform-staging variables.tf must declare $needle"
done
pass "product-artifact Object Lock inputs retained"

# --- Outputs: non-secret endpoints, IDs, secret ARNs ---
OUT="$STAGING/outputs.tf"
for o in \
  artifact_bucket_id \
  ecr_repository_urls \
  vpc_id \
  control_plane_database_url_secret_arn \
  redis_url_secret_arn \
  bff_alb_dns_name \
  relay_alb_dns_name \
  control_plane_alb_dns_name \
  control_plane_alb_internal \
  control_plane_url \
  end_to_end_wiring \
  cloudfront_domain_name \
  apply_readiness \
  compose_layers
do
  grep -Eq "output[[:space:]]+\"${o}\"" "$OUT" \
    || fail "platform-staging outputs.tf must declare $o"
done
# Secret ARNs only — not password/token value outputs
if grep -Eiq 'output[[:space:]]+"(db_password|master_password|auth_token|redis_password|CONTROL_PLANE_DATABASE_URL_value)"' "$OUT"; then
  fail "platform-staging must not output secret values (passwords/tokens)"
fi
# control_plane_url is a private hostname URL (non-secret); must not be sensitive
if grep -A3 'output[[:space:]]\+"control_plane_url"' "$OUT" | grep -Eq 'sensitive[[:space:]]*=[[:space:]]*true'; then
  fail "control_plane_url is non-secret private DNS and must not be marked sensitive"
fi
pass "outputs cover non-secret endpoints, IDs, secret ARNs, and wiring evidence"

# --- No live backend / tfvars committed ---
if [ -f "$STAGING/backend.tf" ]; then
  fail "environments/platform-staging/backend.tf must not be committed (use backend.tf.example)"
fi
if [ -f "$STAGING/terraform.tfvars" ]; then
  fail "environments/platform-staging/terraform.tfvars must not be committed (use .example)"
fi
pass "no live backend.tf or terraform.tfvars"

# --- Example honesty ---
EX="$STAGING/terraform.tfvars.example"
grep -Eq 'REPLACE' "$EX" || fail "tfvars.example must keep REPLACE placeholders for apply gate"
grep -Eq 'enable_portal_valkey' "$EX" || fail "tfvars.example must document enable_portal_valkey"
grep -Eq 'enable_portal_dns_tls' "$EX" || fail "tfvars.example must document enable_portal_dns_tls"
grep -Eq 'infra_ready|NOT apply-ready|not production' "$EX" "$STAGING/INDEX.md" \
  || fail "examples must state infra_ready / not apply-ready honesty"
pass "example tfvars remain placeholder-safe and honest"

# --- Backend example only (no committed live backend) ---
BE="$STAGING/backend.tf.example"
require_file "$BE"
grep -Eiq 'backend|s3|bucket' "$BE" || fail "backend.tf.example must sketch remote state"
pass "backend.tf.example present (live backend.tf forbidden)"

# --- Root INDEX: DNS/TLS layer + honesty + operator runbook link ---
IDX="$STAGING/INDEX.md"
grep -Eqi 'portal-dns-tls|enable_portal_dns_tls|DNS/TLS' "$IDX" \
  || fail "environments/platform-staging/INDEX.md must document DNS/TLS layer"
grep -Eqi 'infra_ready' "$IDX" || fail "platform-staging INDEX must state infra_ready"
grep -Eq 'platform-staging-compose\.md|product-artifact-staging-apply\.md|portal-compute-staging-apply\.md' "$IDX" \
  || fail "platform-staging INDEX must link operator apply/rollback runbooks"
pass "platform-staging INDEX documents layers, honesty, runbooks"

# --- Repository indexes cover composed root ---
ROOT_INDEX="$ROOT/INDEX.md"
ROOT_YAML="$ROOT/index.yaml"
grep -Eq 'environments/platform-staging' "$ROOT_INDEX" \
  || fail "root INDEX.md must list environments/platform-staging"
grep -Eq 'smoke-platform-staging-compose' "$ROOT_INDEX" \
  || fail "root INDEX.md must list smoke-platform-staging-compose.sh"
grep -Eq 'platform-staging-compose\.md' "$ROOT_INDEX" \
  || fail "root INDEX.md must list references/runbooks/platform-staging-compose.md"
grep -Eq 'path:[[:space:]]*environments/platform-staging' "$ROOT_YAML" \
  || fail "index.yaml must map environments/platform-staging"
grep -Eq 'smoke-platform-staging-compose' "$ROOT_YAML" \
  || fail "index.yaml must map smoke-platform-staging-compose"
grep -Eq 'platform-staging-compose' "$ROOT_YAML" \
  || fail "index.yaml must map platform-staging-compose runbook"
# YAML must not leave dual purpose keys for platform-staging (parser keeps last; ban duplicates)
dup_purpose="$(awk '
  /platform-staging:/{ p=1; c=0; next }
  p && /^[[:space:]]+purpose:/{ c++; if (c>1) print }
  p && /^  [a-zA-Z0-9_-]+:/ && !/purpose:/{ p=0 }
' "$ROOT_YAML" || true)"
if [ -n "$dup_purpose" ]; then
  fail "index.yaml environments.platform-staging must declare a single purpose key"
fi
pass "root INDEX.md and index.yaml cover platform-staging compose"

# --- Compose apply/rollback runbook (backend, secrets, honesty) ---
RUNBOOK="$ROOT/references/runbooks/platform-staging-compose.md"
require_file "$RUNBOOK"
for needle in \
  'infra_ready' \
  'backend' \
  'rollback' \
  'secret' \
  'terraform apply' \
  'not production' \
  'smoke-platform-staging-compose' \
  'environments/platform-staging'
do
  grep -Eiq "$needle" "$RUNBOOK" \
    || fail "platform-staging-compose runbook must cover: $needle"
done
# Explicit non-claims
grep -Eiq 'not production-applied|not auto-applied|not production-certified|G1|G2' "$RUNBOOK" \
  || fail "compose runbook must keep production honesty (G1/G2 / not auto-applied)"
pass "platform-staging-compose apply/rollback runbook present"

# --- CI covers compose smoke + terraform validate for root + sibling modules ---
CI="$ROOT/.github/workflows/ci.yml"
require_file "$CI"
grep -Eq 'smoke-platform-staging-compose\.sh' "$CI" \
  || fail "ci.yml must run smoke-platform-staging-compose.sh"
grep -Eq 'environments/platform-staging' "$CI" \
  || fail "ci.yml must terraform validate environments/platform-staging"
for mod in \
  product-artifact-infra \
  platform-vpc \
  control-plane-rds \
  portal-valkey \
  portal-dns-tls \
  portal-static-edge \
  portal-bff-service \
  portal-relay-service \
  portal-control-plane-service \
  staging-document-server
do
  grep -Eq "modules/${mod}" "$CI" \
    || fail "ci.yml must cover modules/${mod} (validate or dedicated smoke)"
done
for smoke in \
  smoke-portal-compute.sh \
  smoke-platform-vpc.sh \
  smoke-control-plane-rds.sh \
  smoke-portal-valkey.sh \
  smoke-portal-dns-tls.sh \
  smoke-product-artifact-iam.sh \
  smoke-staging-document-server.sh
do
  grep -Eq "$smoke" "$CI" || fail "ci.yml must run $smoke (sibling module coverage)"
done
pass "CI covers platform-staging compose + all composed modules"

# --- terraform validate ---
# SKIP_TERRAFORM=1 keeps monorepo offline validate.sh free of registry/network
# while still exercising compose structure + path wiring after the deploy move.
if [[ "${SKIP_TERRAFORM:-}" == "1" ]]; then
  log "SKIP_TERRAFORM=1; skipping terraform init/validate (offline monorepo gate)"
elif command -v terraform >/dev/null 2>&1; then
  log "Running terraform init -backend=false && validate in platform-staging"
  (
    cd "$STAGING"
    terraform init -backend=false -input=false -no-color >/dev/null
    terraform validate -no-color
  ) || fail "terraform validate failed for environments/platform-staging"
  pass "terraform validate"
else
  log "terraform not installed; skipping validate (CI runs it)"
fi

log "All platform-staging compose checks passed"
echo "PASS: platform-staging compose"
