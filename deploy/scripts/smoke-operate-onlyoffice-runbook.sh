#!/usr/bin/env bash
# Offline smoke: day-2 ONLYOFFICE ops runbook coverage (lp-5q6.36).
# No Docker, no AWS, no network.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNBOOK="$ROOT/references/runbooks/operate-onlyoffice-document-server.md"
LAB="$ROOT/references/runbooks/lab-onlyoffice-document-server.md"
STAGING="$ROOT/references/runbooks/staging-document-server.md"

err() { echo "[smoke-operate-onlyoffice-runbook] ERROR: $*" >&2; }
log() { echo "[smoke-operate-onlyoffice-runbook] $*"; }
fail() { err "$*"; exit 1; }
pass() { log "OK: $*"; }

require_file() {
  local f="$1"
  [ -f "$f" ] || fail "required file missing: $f"
}

require_file "$RUNBOOK"
require_file "$LAB"
require_file "$STAGING"
pass "ops + lab + staging runbooks present"

grep -Eq 'lp-5q6\.36' "$RUNBOOK" \
  || fail "ops runbook must reference bead lp-5q6.36"
grep -Eq 'lab-shared-compose-ds' "$RUNBOOK" \
  || fail "ops runbook must name lab-shared-compose-ds"
grep -Eq 'staging-platform-shared-ds' "$RUNBOOK" \
  || fail "ops runbook must name staging-platform-shared-ds"
grep -Eq 'prod-per-tenant-ds' "$RUNBOOK" \
  || fail "ops runbook must name prod-per-tenant-ds"
pass "topology names present"

# Acceptance: lifecycle
for needle in \
  'Start' \
  'Stop' \
  'Upgrade' \
  'Health check' \
  'rollback' \
  'onlyoffice_editor' \
  'BFF_OFFICE_VAULT_EDIT' \
  'desired_count'
do
  grep -Fqi "$needle" "$RUNBOOK" \
    || fail "ops runbook must cover lifecycle/flag item: $needle"
done
pass "start/stop/upgrade/health/rollback/flags"

# Acceptance: JWT rotation across BFF + DS
for needle in \
  'JWT rotation' \
  'BFF_OFFICE_JWT_SECRET' \
  'JWT_SECRET' \
  'Secrets Manager' \
  'force-new-deployment' \
  'put-secret-value'
do
  grep -Fqi "$needle" "$RUNBOOK" \
    || fail "ops runbook must cover JWT rotation item: $needle"
done
pass "JWT rotation across BFF and Document Server"

# Acceptance: purge + retention
for needle in \
  'Forgotten files' \
  'cache purge' \
  'retention' \
  'docker compose down -v' \
  'lab_onlyoffice' \
  'force-new-deployment' \
  '24h'
do
  grep -Fqi "$needle" "$RUNBOOK" \
    || fail "ops runbook must cover purge/retention item: $needle"
done
pass "forgotten files, purge, retention"

# Acceptance: failures + logs
for needle in \
  'Failure' \
  'CloudWatch' \
  'docker compose logs' \
  'office_callback' \
  'download failed' \
  'token'
do
  grep -Fqi "$needle" "$RUNBOOK" \
    || fail "ops runbook must cover failure/log item: $needle"
done
pass "failure modes and log locations"

# Cross-links from env runbooks into day-2 ops
grep -Eq 'operate-onlyoffice-document-server' "$STAGING" \
  || fail "staging runbook must link operate-onlyoffice-document-server"
grep -Eq 'operate-onlyoffice-document-server|lp-5q6\.36' "$LAB" \
  || fail "lab runbook must link ops runbook or lp-5q6.36"
pass "lab/staging cross-links"

# No committed secret-looking placeholders as real values in ops runbook body
if grep -Eiq 'sk-live-|AKIA[0-9A-Z]{16}|BEGIN (RSA |OPENSSH )?PRIVATE KEY' "$RUNBOOK"; then
  fail "ops runbook must not contain live-looking secret material"
fi
pass "no live secret material patterns"

log "ALL CHECKS PASSED (offline; not a live DS apply)"
