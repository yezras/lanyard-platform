#!/usr/bin/env bash
# Offline smoke: modules/staging-document-server + platform-staging wiring (lp-5q6.34).
# Topology: staging-platform-shared-ds. No AWS credentials, no terraform apply.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOD="$ROOT/modules/staging-document-server"
STAGING="$ROOT/environments/platform-staging"
RUNBOOK="$ROOT/references/runbooks/staging-document-server.md"

err() { echo "[smoke-staging-document-server] ERROR: $*" >&2; }
log() { echo "[smoke-staging-document-server] $*"; }
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

# --- Layout ---
require_dir "$MOD"
for f in versions.tf variables.tf main.tf outputs.tf README.md INDEX.md terraform.tfvars.example; do
  require_file "$MOD/$f"
done
require_file "$RUNBOOK"
pass "module tree + runbook present"

# --- Topology identity ---
grep -Eq 'staging-platform-shared-ds' "$MOD/main.tf" "$MOD/outputs.tf" "$MOD/README.md" \
  || fail "module must declare topology staging-platform-shared-ds"
grep -Eq 'lp-5q6\.34' "$MOD/main.tf" "$MOD/README.md" "$RUNBOOK" \
  || fail "module/runbook must reference bead lp-5q6.34"
pass "topology staging-platform-shared-ds + bead label"

# --- Image pin + Community free track ---
grep -Eq 'onlyoffice/documentserver' "$MOD/variables.tf" "$MOD/terraform.tfvars.example" \
  || fail "module must default to onlyoffice/documentserver Community image"
grep -Eq 'sha256:\[a-f0-9\]\{64\}|image_digest must be sha256' "$MOD/variables.tf" \
  || fail "module must validate image_digest as sha256 + 64 hex"
grep -Eq ':latest' "$MOD/variables.tf" \
  || fail "module must reject :latest on image_repository"
pass "Community image + digest pin contract"

# --- JWT / license from Secrets Manager, never plain env ---
grep -Eq 'aws_secretsmanager_secret' "$MOD/main.tf" \
  || fail "module must create or reference Secrets Manager for JWT"
grep -Eq 'JWT_SECRET' "$MOD/main.tf" \
  || fail "module must inject JWT_SECRET from secrets map"
grep -Eq 'known_plaintext_secret_names|plaintext_secret_violations' "$MOD/main.tf" \
  || fail "module must reject JWT/license in plain environment_variables"
# Outputs must not expose secret values
if grep -Eiq 'output[[:space:]]+"(jwt_secret_value|jwt_password|secret_string)"' "$MOD/outputs.tf"; then
  fail "module must not output JWT secret values"
fi
grep -Eq 'jwt_secret_arn' "$MOD/outputs.tf" \
  || fail "module must output jwt_secret_arn (ARN only)"
pass "JWT via Secrets Manager; ARNs only in outputs"

# --- Health checks ---
grep -Eq 'healthcheck|/healthcheck' "$MOD/main.tf" "$MOD/variables.tf" \
  || fail "module must health-check /healthcheck"
grep -Eq 'aws_lb_target_group' "$MOD/main.tf" \
  || fail "module must define ALB target group with health checks"
grep -Eq 'healthCheck' "$MOD/main.tf" \
  || fail "module must define container healthCheck"
pass "ALB + container /healthcheck present"

# --- Browser edge + DS→BFF egress ---
grep -Eq 'internal[[:space:]]*=[[:space:]]*false' "$MOD/main.tf" \
  || fail "Docs ALB must be internet-facing for browser → Document Server"
grep -Eq 'aws_vpc_security_group_egress_rule' "$MOD/main.tf" \
  || fail "tasks must have egress for DS→BFF download/callback"
grep -Eq 'document_server_public_base_url|document_server_host' "$MOD/outputs.tf" \
  || fail "module must output browser base URL and host for BFF allowlist"
pass "browser edge + DS egress + host outputs"

# --- Honesty gates ---
grep -Eq 'acknowledge_not_auto_applied' "$MOD/variables.tf" "$MOD/main.tf" \
  || fail "module missing acknowledge_not_auto_applied"
grep -Eq 'acknowledge_staging_shared_residual' "$MOD/variables.tf" "$MOD/main.tf" \
  || fail "module missing acknowledge_staging_shared_residual"
grep -Eq 'acknowledge_not_auto_applied[[:space:]]*=[[:space:]]*true' "$MOD/terraform.tfvars.example" \
  || fail "example must set acknowledge_not_auto_applied = true"
grep -Eq 'acknowledge_staging_shared_residual[[:space:]]*=[[:space:]]*true' "$MOD/terraform.tfvars.example" \
  || fail "example must set acknowledge_staging_shared_residual = true"
grep -Eiq 'not auto-applied|infra_ready|not production' "$MOD/README.md" \
  || fail "README must state infra_ready / not auto-applied / not production"
pass "honesty gates + example acknowledges"

# --- Rollback contract ---
grep -Eq 'desired_count' "$MOD/variables.tf" \
  || fail "module must allow desired_count=0 rollback"
grep -Eiq 'preview|rollback|feature flag|onlyoffice_editor' "$MOD/README.md" "$RUNBOOK" \
  || fail "docs must describe rollback that keeps previews working"
pass "rollback / preview-safe docs"

# --- Memory floor for ONLYOFFICE ---
grep -Eq 'memory must be at least 4096|>= 4096' "$MOD/variables.tf" \
  || fail "module must require memory >= 4096"
pass "memory floor >= 4096 MiB"

# --- Platform-staging compose wiring ---
MAIN="$STAGING/main.tf"
VARS="$STAGING/variables.tf"
OUT="$STAGING/outputs.tf"
EX="$STAGING/terraform.tfvars.example"
require_file "$MAIN"
require_file "$VARS"
require_file "$OUT"
require_file "$EX"

grep -Eq 'source[[:space:]]*=[[:space:]]*"\.\./\.\./modules/staging-document-server"' "$MAIN" \
  || fail "platform-staging must use relative source ../../modules/staging-document-server"
grep -Eq 'enable_staging_document_server' "$VARS" "$MAIN" "$EX" \
  || fail "platform-staging must declare enable_staging_document_server"
# Default off for cheap offline validate
grep -Eq 'variable[[:space:]]+"enable_staging_document_server"' "$VARS" \
  || fail "enable_staging_document_server variable missing"
if ! grep -A12 'variable "enable_staging_document_server"' "$VARS" | grep -Eq 'default[[:space:]]*=[[:space:]]*false'; then
  fail "enable_staging_document_server must default to false"
fi
grep -Eq 'BFF_OFFICE_JWT_SECRET' "$MAIN" \
  || fail "platform-staging must wire BFF_OFFICE_JWT_SECRET from DS JWT ARN"
grep -Eq 'BFF_OFFICE_PUBLIC_BASE_URL|BFF_OFFICE_DOCUMENT_SERVER_HOSTS' "$MAIN" \
  || fail "platform-staging must wire Office public base + DS hosts into BFF env"
grep -Eq 'document_server_jwt_secret_arn|document_server_alb_dns_name|document_server_topology' "$OUT" \
  || fail "platform-staging must output DS DNS, topology, jwt_secret_arn"
grep -Eq 'enable_staging_document_server[[:space:]]*=[[:space:]]*false' "$EX" \
  || fail "tfvars.example must keep enable_staging_document_server = false"
# lp-zuh.12.2 / lp-zuh.12.9: HTTPS cutover allowlist + Docs hostname SAN + CF Option B
grep -Eq 'distinct\(compact\(|document_server_public_hostname' "$MAIN" \
  || fail "platform-staging must dual-list Docs public hostname + ALB DNS in BFF allowlist"
grep -Eq 'document_server_hostname[[:space:]]*=[[:space:]]*var.document_server_public_hostname' "$MAIN" \
  || fail "platform-staging must pass Docs hostname into portal-dns-tls regional SAN"
grep -Eq 'enable_cloudfront_https|document_server_enable_cloudfront_https' "$MAIN" "$VARS" "$MOD/variables.tf" \
  || fail "platform-staging/module must support CloudFront HTTPS Docs edge (lp-zuh.12.9)"
grep -Eq 'aws_cloudfront_distribution' "$MOD/main.tf" \
  || fail "staging-document-server must define optional CloudFront distribution"
# lp-zuh.13.3: OnlyOffice scheme via CloudFront-Forwarded-Proto (not X-Forwarded-Proto alone)
grep -Eq '33f36d7e-f396-46d9-90e0-52428a34d9dc|AllViewerAndCloudFrontHeaders' "$MOD/main.tf" \
  || fail "staging-document-server CF ORP must be Managed-AllViewerAndCloudFrontHeaders-2022-06 (lp-zuh.13.3)"
grep -Eq 'CloudFront-Forwarded-Proto|lp-zuh\.13\.3' "$MOD/main.tf" "$RUNBOOK" \
  || fail "module/runbook must document CloudFront-Forwarded-Proto for https:// cache/files (lp-zuh.13.3)"
grep -Eq 'lp-zuh\.12\.2|lp-zuh\.12\.9|lp-zuh\.13\.3|document_server_enable_https|document_server_enable_cloudfront_https' "$EX" "$RUNBOOK" \
  || fail "tfvars.example/runbook must document MockLab HTTPS enable (ALB ACM and/or CloudFront)"
pass "platform-staging compose wiring (default off) + HTTPS allowlist/SAN/CF"

# --- Runbook coverage ---
for needle in \
  'staging-platform-shared-ds' \
  'JWT' \
  'Secrets Manager' \
  'healthcheck' \
  'BFF_OFFICE_PUBLIC_BASE_URL' \
  'api.js' \
  'rollback' \
  'preview' \
  'desired_count' \
  'not production' \
  'acknowledge_staging_shared_residual'
do
  grep -Fqi "$needle" "$RUNBOOK" \
    || fail "runbook must document/mention: $needle"
done
pass "runbook covers secrets, reachability, health, rollback"

# --- BFF rejects Office JWT in plain env ---
BFF_MAIN="$ROOT/modules/portal-bff-service/main.tf"
require_file "$BFF_MAIN"
grep -Eq 'BFF_OFFICE_JWT_SECRET' "$BFF_MAIN" \
  || fail "portal-bff-service must list BFF_OFFICE_JWT_SECRET as known plaintext secret name"
pass "BFF rejects Office JWT in plain environment_variables"

# --- Optional terraform validate (module alone needs fake network inputs; skip root when off) ---
if [[ "${SKIP_TERRAFORM:-0}" != "1" ]] && command -v terraform >/dev/null 2>&1; then
  log "terraform fmt -check module..."
  terraform fmt -check -recursive "$MOD" \
    || fail "terraform fmt -check failed for staging-document-server"
  # Root validate with defaults (DS off) remains the compose smoke's job.
  pass "terraform fmt clean on module"
else
  log "SKIP_TERRAFORM=1 or terraform missing — fmt skipped"
fi

log "ALL CHECKS PASSED (offline; not a live staging apply)"
