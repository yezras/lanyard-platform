#!/usr/bin/env bash
# Offline security acceptance checklist for private-by-default (company-brain-deploy).
# Documents and asserts deploy-owned controls that CI can run without AWS.
#
# Items that require live AWS, Tailscale, or firewall are **staging-required** and are
# documented in references/runbooks/security-e2e-acceptance.md (LOCAL vs STAGING matrix).
# This script only fails on LOCAL offline regressions.
#
# Usage (from repo root):
#   bash scripts/security-acceptance-checklist.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EC2_MAIN="$ROOT/modules/company-brain-ec2/main.tf"
EC2_VARS="$ROOT/modules/company-brain-ec2/variables.tf"
TENANT_VARS="$ROOT/templates/tenant/variables.tf"
TENANT_TFVARS_EX="$ROOT/templates/tenant/terraform.tfvars.example"
EC2_TFVARS_EX="$ROOT/modules/company-brain-ec2/terraform.tfvars.example"
RELAY_TFVARS_EX="$ROOT/modules/customer-gateway-relay/terraform.tfvars.example"
E2E_DOC="$ROOT/references/runbooks/security-e2e-acceptance.md"
MATRIX="$ROOT/references/readiness-matrix.md"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }
soft_note() { echo "NOTE: $*"; }

echo "==> security-acceptance-checklist (offline / LOCAL)"
echo "    root=$ROOT"
echo "    staging-required items: see references/runbooks/security-e2e-acceptance.md"

# --- files that must exist ---
for f in \
  "$EC2_MAIN" \
  "$EC2_VARS" \
  "$TENANT_VARS" \
  "$TENANT_TFVARS_EX" \
  "$E2E_DOC" \
  "$MATRIX" \
  "$ROOT/scripts/policy-as-code-security.sh" \
  "$ROOT/scripts/validate-production-gates.sh" \
  "$ROOT/scripts/smoke-controlled-egress.sh" \
  "$ROOT/scripts/smoke-hermes-profiles.sh" \
  "$ROOT/scripts/smoke-artifact-attestation.sh" \
  "$ROOT/scripts/restore-from-snapshot.sh" \
  "$ROOT/scripts/check-snapshot-age.sh" \
  "$ROOT/scripts/bootstrap-host.sh" \
  "$ROOT/artifacts/README.md"
do
  [ -f "$f" ] || fail "missing required path: $f"
done
pass "required scripts, runbooks, and module files present"

# ---------------------------------------------------------------------------
# Checklist item: no public IP (production mode)
# ---------------------------------------------------------------------------
grep -Eq 'associate_public_ip\s*=\s*var\.network_mode\s*==\s*"production"\s*\?\s*false' "$EC2_MAIN" \
  || fail "production must force associate_public_ip=false"
grep -Fq 'network_mode=production requires explicit subnet_id' "$EC2_MAIN" \
  || fail "production subnet precondition missing"
pass "LOCAL: no public IP in production network_mode"

# ---------------------------------------------------------------------------
# Checklist item: no public SSH by default
# ---------------------------------------------------------------------------
grep -Eq 'default\s*=\s*\[\]' "$EC2_VARS" || fail "operator_ssh_cidrs must default empty"
grep -Eq 'create_ssh_ingress' "$EC2_MAIN" || fail "create_ssh_ingress missing"
grep -A8 'variable "operator_ssh_cidrs"' "$EC2_VARS" | grep -Fq '0.0.0.0/0' \
  || fail "must reject SSH from 0.0.0.0/0"
pass "LOCAL: no public SSH by default (empty CIDRs; 0.0.0.0/0 rejected)"

# ---------------------------------------------------------------------------
# Checklist item: controlled egress
# ---------------------------------------------------------------------------
grep -Eq 'egress_mode' "$EC2_MAIN" || fail "egress_mode wiring missing"
grep -Eq 'forbids egress_mode=open|egress_mode != "open"' "$EC2_MAIN" \
  || fail "production must forbid open egress"
bash "$ROOT/scripts/smoke-controlled-egress.sh" >/dev/null \
  || fail "smoke-controlled-egress.sh failed"
pass "LOCAL: controlled egress (smoke-controlled-egress.sh)"

# ---------------------------------------------------------------------------
# Checklist item: Tailscale optional/secondary
# ---------------------------------------------------------------------------
grep -Eq 'variable\s+"enable_tailscale"' "$EC2_VARS" || fail "enable_tailscale variable missing"
if grep -A10 'variable "enable_tailscale"' "$EC2_VARS" | grep -Eq 'default\s*=\s*false'; then
  pass "LOCAL: Tailscale optional (default off)"
else
  fail "enable_tailscale should default false (secondary/optional)"
fi
[ -f "$ROOT/references/runbooks/tailscale-operator-access.md" ] \
  || fail "missing Tailscale operator runbook"
grep -Eiq 'secondary|optional|SSM' "$ROOT/references/runbooks/tailscale-operator-access.md" \
  || fail "Tailscale runbook should describe secondary/optional posture"

# ---------------------------------------------------------------------------
# Checklist item: secrets absent from example tfvars (placeholders only)
# ---------------------------------------------------------------------------
scan_tfvars_secrets() {
  local f="$1"
  [ -f "$f" ] || return 0
  # Fail if a line looks like a real secret assignment (not commented, not REPLACE, not empty)
  # Patterns: password/secret/token/api_key = "something-not-placeholder"
  local hits
  hits="$(grep -nEi \
    '^([[:space:]]*)(relay_instance_secret|password|api_key|auth_token|gateway_relay_secret|tailscale_auth_key)[[:space:]]*=' \
    "$f" 2>/dev/null || true)"
  if [ -n "$hits" ]; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      # Allow empty, REPLACE_*, UNCONFIGURED, commented placeholders, or empty quotes
      if echo "$line" | grep -Eqi 'REPLACE|UNCONFIGURED|""|'\'''\''|#|null|<.*>'; then
        continue
      fi
      # Lab-only examples may set empty string — still ok if value is empty or placeholder-ish
      if echo "$line" | grep -Eq '=\s*""|=\s*null|=\s*"lab-|=\s*"example'; then
        continue
      fi
      fail "example tfvars may contain non-placeholder secret-like value: $f :: $line"
    done <<< "$hits"
  fi
  # Live-looking long hex/base64 secrets (heuristic)
  if grep -nE '=\s*"[A-Za-z0-9+/]{40,}={0,2}"' "$f" 2>/dev/null | grep -viE 'REPLACE|UNCONFIGURED|example|sha256|digest|ami-' | grep -q .; then
    soft_note "long base64-like string in $f — review manually (allowed if clearly a fake digest/pin)"
  fi
}

for ex in "$TENANT_TFVARS_EX" "$EC2_TFVARS_EX" "$RELAY_TFVARS_EX" \
  "$ROOT/modules/product-artifact-infra/terraform.tfvars.example" \
  "$ROOT/environments/platform-staging/terraform.tfvars.example"
do
  scan_tfvars_secrets "$ex"
done
# Tenant example should use SSM for relay secret, not inline value
grep -Eq 'relay_secret_source\s*=\s*"ssm"' "$TENANT_TFVARS_EX" \
  || fail "tenant example should show relay_secret_source=ssm"
if grep -Eq '^\s*relay_instance_secret\s*=' "$TENANT_TFVARS_EX"; then
  # Only allowed if empty or commented elsewhere — fail if non-empty active assignment
  if grep -E '^\s*relay_instance_secret\s*=\s*"[^"]+"' "$TENANT_TFVARS_EX" | grep -vqE 'REPLACE|""'; then
    fail "tenant example must not set live relay_instance_secret"
  fi
fi
pass "LOCAL: example tfvars free of live secrets (placeholders / SSM refs)"

# ---------------------------------------------------------------------------
# Checklist item: attestation path exists
# ---------------------------------------------------------------------------
grep -Eq 'REQUIRE_ARTIFACT_ATTESTATION|Ed25519|attest' "$ROOT/scripts/bootstrap-host.sh" \
  || fail "bootstrap missing attestation path"
grep -Eq 'REQUIRE_ARTIFACT_ATTESTATION|Ed25519' "$ROOT/artifacts/README.md" \
  || fail "artifacts/README must document attestation"
bash "$ROOT/scripts/smoke-artifact-attestation.sh" >/dev/null \
  || fail "smoke-artifact-attestation.sh failed"
pass "LOCAL: attestation path exists (bootstrap + smoke-artifact-attestation)"

# ---------------------------------------------------------------------------
# Checklist item: RBAC profiles smoke
# ---------------------------------------------------------------------------
[ -f "$ROOT/scripts/hermes-profiles/admin.json" ] || fail "missing admin profile seed"
[ -f "$ROOT/scripts/hermes-profiles/contributor.json" ] || fail "missing contributor profile seed"
bash "$ROOT/scripts/smoke-hermes-profiles.sh" >/dev/null \
  || fail "smoke-hermes-profiles.sh failed"
pass "LOCAL: RBAC profiles smoke (admin/contributor)"

# ---------------------------------------------------------------------------
# Checklist item: restore scripts exist
# ---------------------------------------------------------------------------
[ -x "$ROOT/scripts/restore-from-snapshot.sh" ] || [ -f "$ROOT/scripts/restore-from-snapshot.sh" ] \
  || fail "restore-from-snapshot.sh missing"
[ -f "$ROOT/scripts/check-snapshot-age.sh" ] || fail "check-snapshot-age.sh missing"
[ -f "$ROOT/references/runbooks/dlm-restore-drill.md" ] || fail "dlm-restore-drill runbook missing"
bash -n "$ROOT/scripts/restore-from-snapshot.sh" || fail "restore-from-snapshot.sh bash -n failed"
bash -n "$ROOT/scripts/check-snapshot-age.sh" || fail "check-snapshot-age.sh bash -n failed"
pass "LOCAL: restore + snapshot-age scripts and runbook present"

# Opt-in DR snapshot copy defaults off; production encryption preserved (cbd-mta.7.4)
[ -f "$ROOT/scripts/smoke-dlm-dr-snapshot-copy.sh" ] || fail "smoke-dlm-dr-snapshot-copy.sh missing"
bash -n "$ROOT/scripts/smoke-dlm-dr-snapshot-copy.sh" || fail "smoke-dlm-dr-snapshot-copy.sh bash -n failed"
bash "$ROOT/scripts/smoke-dlm-dr-snapshot-copy.sh" >/dev/null \
  || fail "smoke-dlm-dr-snapshot-copy.sh failed"
grep -Eiq 'RPO|RTO' "$ROOT/references/runbooks/dlm-restore-drill.md" \
  || fail "dlm-restore-drill must document RPO/RTO for DR copy"
pass "LOCAL: DLM DR snapshot copy fail-closed + RPO/RTO docs"

# ---------------------------------------------------------------------------
# Checklist item: production gates validate
# ---------------------------------------------------------------------------
bash "$ROOT/scripts/validate-production-gates.sh" >/dev/null \
  || fail "validate-production-gates.sh failed"
pass "LOCAL: production gates validate (honesty / fail-closed)"

# ---------------------------------------------------------------------------
# Policy-as-code suite
# ---------------------------------------------------------------------------
bash "$ROOT/scripts/policy-as-code-security.sh" >/dev/null \
  || fail "policy-as-code-security.sh failed"
pass "LOCAL: policy-as-code-security.sh"

# ---------------------------------------------------------------------------
# E2E runbook must document LOCAL vs STAGING matrix
# ---------------------------------------------------------------------------
grep -Eiq 'LOCAL|offline' "$E2E_DOC" || fail "security-e2e-acceptance.md missing LOCAL section"
grep -Eiq 'STAGING|staging-required|live AWS' "$E2E_DOC" \
  || fail "security-e2e-acceptance.md missing STAGING matrix"
for phrase in \
  'relay revocation' \
  'Tailscale' \
  'public IP' \
  'controlled egress' \
  'attestation'
do
  grep -Eiq "$phrase" "$E2E_DOC" || fail "security-e2e-acceptance.md missing coverage: $phrase"
done
pass "LOCAL: security-e2e-acceptance.md documents LOCAL vs STAGING matrix"

# ---------------------------------------------------------------------------
# Honesty: readiness must not claim pen-test / production private-by-default complete
# (also enforced by validate-production-gates.sh after .22 updates)
# ---------------------------------------------------------------------------
if grep -Eqi 'penetration test.*(complete|passed|ready)|pen-test.*(complete|passed|ready)' "$MATRIX"; then
  if grep -Eqi 'penetration test.*(NOT|pending|blocked|not signed)|pen-test.*(NOT|pending|blocked)' "$MATRIX"; then
    :
  else
    fail "readiness matrix must not claim pen-test complete without honest negation"
  fi
fi
pass "LOCAL: readiness matrix does not falsely claim pen-test complete"

echo
echo "All LOCAL security acceptance checklist items passed."
echo "STAGING-required E2E items remain operator-owned — see:"
echo "  references/runbooks/security-e2e-acceptance.md"
exit 0
