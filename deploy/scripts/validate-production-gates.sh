#!/usr/bin/env bash
# Fail-closed offline validator: production security honesty for company-brain-deploy.
# No network, no AWS credentials, no terraform apply.
#
# Ensures readiness docs cannot claim production Portal/relay security ready while
# G1 (private control-plane) / G2 (relay credential lifecycle) / G3 (Brain RPC)
# remain blocked. Requires live proofs residual ledger (lp-t7q.7).
#
# Usage:
#   bash scripts/validate-production-gates.sh
# Exit 0 = docs/gates consistent (honest blocked or fully ready).
# Exit 1 = false ready / missing checklist / contradictory claims.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MATRIX="${PRODUCTION_GATES_MATRIX:-$ROOT/references/readiness-matrix.md}"
ISOLATION_DOC="${PRODUCTION_GATES_ISOLATION_DOC:-$ROOT/references/tenant-isolation-decision.md}"
GATE_RUNBOOK="${PRODUCTION_GATES_RUNBOOK:-$ROOT/references/runbooks/production-security-gate.md}"
ISO_RUNBOOK="${PRODUCTION_GATES_ISO_RUNBOOK:-$ROOT/references/runbooks/tenant-isolation.md}"
SIGNOFF_DOC="${PRODUCTION_GATES_SIGNOFF:-$ROOT/references/production-security-signoff.md}"
THREAT_MODEL="${PRODUCTION_GATES_THREAT_MODEL:-$ROOT/references/threat-model-private-by-default.md}"
PENTEST_RUNBOOK="${PRODUCTION_GATES_PENTEST_RUNBOOK:-$ROOT/references/runbooks/penetration-test-and-signoff.md}"
E2E_ACCEPTANCE="${PRODUCTION_GATES_E2E:-$ROOT/references/runbooks/security-e2e-acceptance.md}"

err() { echo "[validate-production-gates] ERROR: $*" >&2; }
log() { echo "[validate-production-gates] $*"; }
fail() { err "$*"; exit 1; }

ERRORS=0
soft_fail() {
  err "$*"
  ERRORS=$((ERRORS + 1))
}

require_file() {
  local f="$1"
  [ -f "$f" ] || soft_fail "required file missing: $f"
}

log "root=$ROOT"
require_file "$MATRIX"
require_file "$ISOLATION_DOC"
require_file "$GATE_RUNBOOK"
require_file "$ISO_RUNBOOK"
require_file "$SIGNOFF_DOC"
require_file "$THREAT_MODEL"
require_file "$PENTEST_RUNBOOK"
require_file "$E2E_ACCEPTANCE"

if [ ! -f "$MATRIX" ]; then
  fail "cannot continue without readiness matrix"
fi

# --- Required section headers / phrases (checklist presence) ---
require_matrix_phrase() {
  local phrase="$1"
  grep -Fq "$phrase" "$MATRIX" || soft_fail "readiness matrix missing required phrase: $phrase"
}

require_matrix_phrase "Production security gates (private-by-default)"
require_matrix_phrase "Authenticated private control-plane boundary"
require_matrix_phrase "credential lifecycle"
require_matrix_phrase "Replay resistance"
require_matrix_phrase "Payload log"
require_matrix_phrase "Per-tenant authorization"
require_matrix_phrase "fail-closed"
require_matrix_phrase "validate-production-gates.sh"

# G1 / G2 / G3 must appear as blocked while production security / host ops not cleared
G1_LINE="$(grep -E 'Private control-plane boundary \(\*\*G1\*\*\)|\*\*G1\*\*.*private control-plane|Authenticated \*\*private control-plane' "$MATRIX" | head -n 1 || true)"
G2_LINE="$(grep -E 'Relay credential lifecycle \(\*\*G2\*\*\)|\*\*G2\*\*.*credential lifecycle|Relay \*\*credential lifecycle\*\*' "$MATRIX" | head -n 1 || true)"
G3_LINE="$(grep -E '\|\s*\*\*G3\*\*\s*\|.*Brain RPC|Brain RPC for customer-host' "$MATRIX" | head -n 1 || true)"

if [ -z "$G1_LINE" ]; then
  soft_fail "could not find G1 private control-plane gate row in readiness matrix"
else
  echo "$G1_LINE" | grep -Fq '**blocked**' || soft_fail "G1 private control-plane must be **blocked** until product clears it (line: $G1_LINE)"
  log "G1 status honest: blocked"
fi

if [ -z "$G2_LINE" ]; then
  soft_fail "could not find G2 relay credential lifecycle gate row in readiness matrix"
else
  echo "$G2_LINE" | grep -Fq '**blocked**' || soft_fail "G2 relay credential lifecycle must be **blocked** until product clears it (line: $G2_LINE)"
  log "G2 status honest: blocked"
fi

if [ -z "$G3_LINE" ]; then
  soft_fail "could not find G3 Brain RPC gate row in readiness matrix"
else
  echo "$G3_LINE" | grep -Fq '**blocked**' || soft_fail "G3 Brain RPC must be **blocked** until live G3.4 staging E2E is recorded (line: $G3_LINE)"
  log "G3 status honest: blocked"
fi

# Live proofs residual ledger (lp-t7q.7 / cbd-mta.6.*) — pass/fail/blocked notes without ready claims
LIVE_PROOFS_RESIDUAL="${PRODUCTION_GATES_LIVE_PROOFS_RESIDUAL:-$ROOT/references/runbooks/readiness-live-proofs-residual.md}"
if [ -f "$LIVE_PROOFS_RESIDUAL" ]; then
  for phrase in 'G1.4' 'G1a' 'G2' 'G3.4' 'blocked' 'fail-closed' 'lp-t7q.7'; do
    grep -Fq "$phrase" "$LIVE_PROOFS_RESIDUAL" \
      || soft_fail "live proofs residual missing required phrase: $phrase"
  done
  # Residual must not claim live gates ready without evidence language
  if grep -Eqi 'G1\.4[[:space:]]*\|\s*\*\*ready\*\*|live status.*\*\*ready\*\*' "$LIVE_PROOFS_RESIDUAL"; then
    bad_live="$(grep -niE 'G1\.4|G1a|G3\.4|G2 \(S4\)' "$LIVE_PROOFS_RESIDUAL" | grep -E '\*\*ready\*\*' | grep -viE 'product|not |never|until|blocked' || true)"
    if [ -n "$bad_live" ]; then
      soft_fail "live proofs residual must not mark live gates ready without evidence: $bad_live"
    fi
  fi
  grep -Eq 'readiness-live-proofs-residual|lp-t7q\.7' "$MATRIX" \
    || soft_fail "readiness matrix must reference readiness-live-proofs-residual / lp-t7q.7"
  log "live proofs residual present (lp-t7q.7); G1.4/G1a/G2/G3.4 honesty required"
else
  soft_fail "required live proofs residual missing: $LIVE_PROOFS_RESIDUAL (lp-t7q.7)"
fi

# Production security overall claim
if grep -Eqi 'Production Portal/relay security status:[[:space:]]*READY' "$MATRIX"; then
  soft_fail "matrix claims Production Portal/relay security READY while validator expects G1/G2 still blocked"
fi
grep -Eqi 'Production Portal/relay security status:[[:space:]]*BLOCKED' "$MATRIX" \
  || soft_fail "matrix must state Production Portal/relay security status: BLOCKED while G1/G2 blocked"

# Relay production security row
PROD_RELAY_SEC="$(grep -E 'Relay / control-plane \*\*production security\*\*|Relay / control-plane \*\*production security\*\*' "$MATRIX" || true)"
if [ -n "$PROD_RELAY_SEC" ]; then
  echo "$PROD_RELAY_SEC" | grep -Fq '**blocked**' \
    || soft_fail "Relay/control-plane production security row must be **blocked**"
  log "production security deploy-surface row: blocked"
fi

# RDS honesty: module may be infra_ready; must not claim fully ready/applied production RDS
if grep -Eqi 'RDS / Postgres Terraform.*\*\*ready\*\*' "$MATRIX"; then
  soft_fail "matrix must not mark Control-plane RDS Terraform **ready** (use infra_ready until applied; production CP still gated)"
fi
# Product Postgres (G4.1) uses CONTROL_PLANE_DATABASE_URL; historical SQLite path may still be documented
grep -Eq 'CONTROL_PLANE_DATABASE_URL|better-sqlite3|CONTROL_PLANE_DB_PATH' "$MATRIX" \
  || soft_fail "matrix must mention CONTROL_PLANE_DATABASE_URL (product Postgres) and/or historical better-sqlite3 / CONTROL_PLANE_DB_PATH for G4 honesty"
# G4.3 module surface when present: private posture smoke file exists
if [ -d "$ROOT/modules/control-plane-rds" ]; then
  [ -f "$ROOT/scripts/smoke-control-plane-rds.sh" ] \
    || soft_fail "modules/control-plane-rds present but scripts/smoke-control-plane-rds.sh missing"
  grep -Eqi 'infra_ready|not applied|gated until applied' "$MATRIX" \
    || soft_fail "matrix must keep RDS apply honesty (infra_ready / not applied / gated until applied)"
  log "control-plane-rds module present: expect infra_ready (not full ready) in matrix"
fi

# Platform compute / G8: modules may be infra_ready; must not claim production **ready** without staging
if grep -E 'Platform compute \(Portal CloudFront' "$MATRIX" | grep -Fq '**ready**'; then
  soft_fail "Platform compute must not be **ready** while security/product gates blocked (use infra_ready)"
fi
if grep -E '\|\s*\*\*G8\*\*' "$MATRIX" | grep -Fq '**ready**'; then
  soft_fail "G8 matrix row must not be **ready** without recorded staging evidence (use infra_ready or blocked)"
fi
# When G8 modules exist, require smoke + runbook + infra_ready honesty
if [ -d "$ROOT/modules/portal-static-edge" ] || [ -d "$ROOT/modules/portal-bff-service" ]; then
  [ -f "$ROOT/scripts/smoke-portal-compute.sh" ] \
    || soft_fail "portal compute modules present but scripts/smoke-portal-compute.sh missing"
  [ -f "$ROOT/references/runbooks/portal-compute-staging-apply.md" ] \
    || soft_fail "portal compute modules present but portal-compute-staging-apply runbook missing"
  grep -Eqi 'infra_ready' "$MATRIX" \
    || soft_fail "matrix must keep infra_ready honesty when portal compute modules exist"
  # Forbid false "production certified" language for G8
  if grep -Eqi 'G8.*production certified|Portal compute.*production ready' "$MATRIX"; then
    bad_g8="$(grep -niE 'G8.*production certified|Portal compute.*production ready' "$MATRIX" | grep -viE 'not |never|blocked|infra_ready|without' || true)"
    if [ -n "$bad_g8" ]; then
      soft_fail "matrix must not claim G8 production certified/ready: $bad_g8"
    fi
  fi
  log "portal compute modules present: expect G8/platform compute infra_ready (not full ready)"
fi

# Tier 3 dedicated relay: infra_ready deployable topology; not production-certified claim
TIER3_LINE="$(grep -E 'Tier 3 dedicated relay' "$MATRIX" | head -n 1 || true)"
if [ -z "$TIER3_LINE" ]; then
  soft_fail "could not find Tier 3 dedicated relay row in readiness matrix"
else
  echo "$TIER3_LINE" | grep -Eqi 'infra_ready' \
    || soft_fail "Tier 3 dedicated relay must be **infra_ready** (deployable; not production claim); line: $TIER3_LINE"
  # Must not claim production-ready / production-complete
  if echo "$TIER3_LINE" | grep -Eqi 'production[- ]?(ready|complete|certified)' \
    && ! echo "$TIER3_LINE" | grep -Eqi 'not|until|blocked|infra_ready'; then
    soft_fail "Tier 3 row must not claim production readiness without negation; line: $TIER3_LINE"
  fi
  log "Tier 3 dedicated relay status honest: infra_ready (not production-certified)"
fi

# Module surface: compose portal-relay-service; honesty variables present
TIER3_MOD="$ROOT/modules/tier3-dedicated-relay"
if [ -d "$TIER3_MOD" ]; then
  if [ -f "$TIER3_MOD/main.tf" ]; then
    grep -Eq 'source[[:space:]]*=[[:space:]]*"\.\./portal-relay-service"' "$TIER3_MOD/main.tf" \
      || soft_fail "modules/tier3-dedicated-relay must compose ../portal-relay-service (real ALB/ECS)"
    log "tier3-dedicated-relay: composes portal-relay-service (deployable)"
  fi
  for phrase in acknowledge_not_auto_applied claim_production_ready image_digest; do
    grep -RFq "$phrase" "$TIER3_MOD" --include='*.tf' \
      || soft_fail "modules/tier3-dedicated-relay missing honesty/pin variable: $phrase"
  done
  if [ -f "$TIER3_MOD/variables.tf" ]; then
    grep -Eq 'variable[[:space:]]+"claim_production_ready"' "$TIER3_MOD/variables.tf" \
      || soft_fail "tier3 variables.tf missing claim_production_ready"
    grep -Eq 'variable[[:space:]]+"acknowledge_not_auto_applied"' "$TIER3_MOD/variables.tf" \
      || soft_fail "tier3 variables.tf missing acknowledge_not_auto_applied"
    grep -A12 'variable "claim_production_ready"' "$TIER3_MOD/variables.tf" | grep -Eq '== false|condition.*=.*false' \
      || soft_fail "tier3 claim_production_ready must validate false"
  fi
  if [ -f "$TIER3_MOD/README.md" ]; then
    grep -Eqi 'infra_ready' "$TIER3_MOD/README.md" \
      || soft_fail "tier3 README must state infra_ready"
    grep -Eqi 'not production|not auto-applied|staging proof' "$TIER3_MOD/README.md" \
      || soft_fail "tier3 README must state not production-certified / not auto-applied"
  fi
  if [ -f "$ROOT/index.yaml" ]; then
    grep -Eq 'tier3_dedicated_relay:[[:space:]]*infra_ready' "$ROOT/index.yaml" \
      || soft_fail "index.yaml product_gates.tier3_dedicated_relay must be infra_ready*"
  fi
else
  soft_fail "modules/tier3-dedicated-relay directory missing"
fi

# Forbidden oversell phrases across key docs (production claim while gates blocked)
# Allow phrases that explicitly say NOT ready / blocked.
scan_false_ready() {
  local file="$1"
  [ -f "$file" ] || return 0
  # Lines that claim production ready for portal/relay/control-plane security without negation
  local hits
  hits="$(grep -nEi \
    'production[[:space:]]+(portal|relay|control[- ]plane).{0,60}ready|relay/control-plane.{0,40}(production|security).{0,40}ready|(portal|relay)[[:space:]]+production[[:space:]]+complete' \
    "$file" 2>/dev/null || true)"
  if [ -n "$hits" ]; then
    while IFS= read -r hit; do
      [ -z "$hit" ] && continue
      # Allow explicit negation / honesty language (markdown-tolerant)
      if echo "$hit" | grep -Eqi \
        'not[[:space:]*]|never|blocked|must not|do not|is not|aren.t|cannot|fail-closed|wiring only|wiring-only|sketch|same as|Must \*\*not\*\*|must \*\*not\*\*|Must not claim|not claim|not the same|remain\*\*blocked\*\*|remains \*\*blocked\*\*|status: BLOCKED|while G1|while \*\*G1'; then
        continue
      fi
      soft_fail "possible false production-ready claim in $file :: $hit"
    done <<< "$hits"
  fi
}

for f in \
  "$MATRIX" \
  "$ROOT/INDEX.md" \
  "$ROOT/references/migration-phases.md" \
  "$ROOT/modules/customer-gateway-relay/README.md" \
  "$ROOT/modules/tier3-dedicated-relay/README.md" \
  "$GATE_RUNBOOK"
do
  scan_false_ready "$f"
done

# Isolation decision must record both tracks and production target
if [ -f "$ISOLATION_DOC" ]; then
  grep -Fq 'lanyard_hosted' "$ISOLATION_DOC" || soft_fail "isolation decision missing lanyard_hosted"
  grep -Fq 'customer_account' "$ISOLATION_DOC" || soft_fail "isolation decision missing customer_account"
  grep -Eqi 'account-per-tenant|Account-per-tenant' "$ISOLATION_DOC" \
    || soft_fail "isolation decision missing account-per-tenant production target"
  grep -Eqi 'VPC-per-tenant|vpc_interim|per-tenant KMS' "$ISOLATION_DOC" \
    || soft_fail "isolation decision missing interim VPC/KMS partition model"
  grep -Eqi 'Tradeoff' "$ISOLATION_DOC" || soft_fail "isolation decision missing tradeoffs section"
  log "tenant isolation decision present with required content"
fi

# Tenant template must expose isolation variables (enforceable contract)
TENANT_VARS="$ROOT/templates/tenant/variables.tf"
if [ -f "$TENANT_VARS" ]; then
  for v in production_intent isolation_mode dedicated_kms_key_arn log_group_prefix aws_account_id; do
    grep -Eq "variable[[:space:]]+\"$v\"" "$TENANT_VARS" \
      || soft_fail "templates/tenant/variables.tf missing variable \"$v\""
  done
  log "tenant template isolation variables present"
else
  soft_fail "templates/tenant/variables.tf missing"
fi

# index.yaml should list production gate script when indexes maintained
if [ -f "$ROOT/index.yaml" ]; then
  grep -Eq 'validate-production-gates|tenant-isolation-decision' "$ROOT/index.yaml" \
    || soft_fail "index.yaml should reference validate-production-gates and/or tenant-isolation-decision"
fi

# ---------------------------------------------------------------------------
# Independent pen-test / production security sign-off honesty (cbd-zzx.22)
# ---------------------------------------------------------------------------
if [ -f "$SIGNOFF_DOC" ]; then
  grep -Eq 'Status:[[:space:]]*\*\*NOT SIGNED\*\*|^\*\*Status: NOT SIGNED\*\*' "$SIGNOFF_DOC" \
    || soft_fail "production-security-signoff.md must declare Status: NOT SIGNED until external pen test or written residual-risk acceptance"
  # Must not claim signed/pen-test complete in the authoritative status table
  if grep -Eqi 'Overall status[[:space:]]*\|[[:space:]]*\*\*SIGNED\*\*' "$SIGNOFF_DOC"; then
    soft_fail "sign-off overall status must not be SIGNED without completing the formal process"
  fi
  if grep -Eqi 'Independent penetration test[[:space:]]*\|[[:space:]]*\*\*(completed|passed|done)\*\*' "$SIGNOFF_DOC"; then
    soft_fail "sign-off must not claim independent pen test completed/passed while using this honesty gate (update validator when real sign-off lands)"
  fi
  grep -Eqi 'NOT SIGNED' "$SIGNOFF_DOC" || soft_fail "sign-off template missing NOT SIGNED marker"
  log "production-security-signoff.md present with NOT SIGNED status"
else
  soft_fail "references/production-security-signoff.md missing"
fi

if [ -f "$THREAT_MODEL" ]; then
  grep -Eiq 'STRIDE|trust boundar' "$THREAT_MODEL" \
    || soft_fail "threat model must cover STRIDE/trust boundaries"
  for phrase in 'relay' 'artifact' 'multi-tenant' 'IMDS' 'supply chain'; do
    grep -Eiq "$phrase" "$THREAT_MODEL" \
      || soft_fail "threat model missing coverage phrase: $phrase"
  done
  log "threat-model-private-by-default.md present with required coverage"
fi

if [ -f "$PENTEST_RUNBOOK" ]; then
  grep -Eiq 'independent|third-party|external' "$PENTEST_RUNBOOK" \
    || soft_fail "pen-test runbook must describe independent/external engagement"
  grep -Eiq 'bead|triage|finding' "$PENTEST_RUNBOOK" \
    || soft_fail "pen-test runbook must describe findings triage"
  grep -Eiq 'residual risk' "$PENTEST_RUNBOOK" \
    || soft_fail "pen-test runbook must cover residual risk acceptance"
  log "penetration-test-and-signoff.md present"
fi

# Readiness must not claim pen-test complete or production private-by-default certified
if [ -f "$MATRIX" ]; then
  require_matrix_phrase "pen-test"
  # Positive false claims
  if grep -Eqi 'penetration test[[:space:]]+(passed|complete|completed)|pen-test[[:space:]]+(passed|complete|completed)' "$MATRIX"; then
    # Allow only if clearly negated on same line
    bad_pt="$(grep -niE 'penetration test[[:space:]]+(passed|complete|completed)|pen-test[[:space:]]+(passed|complete|completed)' "$MATRIX" | grep -viE 'not |never|pending|blocked|NOT SIGNED|not completed|not executed' || true)"
    if [ -n "$bad_pt" ]; then
      soft_fail "readiness matrix appears to claim pen-test complete: $bad_pt"
    fi
  fi
  # Private-by-default production claim must remain blocked pending sign-off
  if grep -Eqi 'private-by-default.*(certified|sign-off complete|production ready)' "$MATRIX"; then
    bad_pbd="$(grep -niE 'private-by-default.*(certified|sign-off complete|production ready)' "$MATRIX" | grep -viE 'not |never|blocked|pending|NOT SIGNED|must not' || true)"
    if [ -n "$bad_pbd" ]; then
      soft_fail "readiness matrix must not claim private-by-default production certified: $bad_pbd"
    fi
  fi
  grep -Eqi 'sign-off|NOT SIGNED|production-security-signoff' "$MATRIX" \
    || soft_fail "readiness matrix must reference production security sign-off / NOT SIGNED"
  log "readiness matrix does not claim pen-test complete; sign-off referenced"
fi

# Policy-as-code + acceptance scripts should exist for cbd-zzx.21 wiring honesty
for s in \
  "$ROOT/scripts/policy-as-code-security.sh" \
  "$ROOT/scripts/security-acceptance-checklist.sh"
do
  [ -f "$s" ] || soft_fail "missing security CI script: $s"
done

# Optional: if FORCE_CLAIM_PRODUCTION_SECURITY_READY=1, require G1/G2 ready (for future flip)
if [ "${FORCE_CLAIM_PRODUCTION_SECURITY_READY:-0}" = "1" ]; then
  log "FORCE_CLAIM_PRODUCTION_SECURITY_READY=1: requiring G1/G2 ready"
  echo "$G1_LINE" | grep -Fq '**ready**' || soft_fail "forced production claim but G1 not ready"
  echo "$G2_LINE" | grep -Fq '**ready**' || soft_fail "forced production claim but G2 not ready"
fi

if [ "$ERRORS" -gt 0 ]; then
  fail "$ERRORS production-gate honesty check(s) failed (fail-closed)"
fi

log "OK — production security gates documented as blocked (G1/G2/G3); live proofs residual honest; no false ready claims detected"
exit 0
