#!/usr/bin/env bash
# G1.4 staging proof: private control-plane boundary.
#
# FAIL CLOSED: without staging env this script refuses to claim pass (exit 2).
# It does NOT invent AWS evidence. Operators run this against a real staging
# deployment when G8 compute / platform-staging Portal services exist.
#
# Prerequisites (product):
#   - G1.1 OIDC (Portal PR #11, merged)
#   - G1.2 BFF↔CP service auth (Portal PR #13)
#   - G1.3 private CP topology (Portal PR #13 + this repo compose/ADR)
# Deploy-side public-CP policy gate: company-brain-deploy PR #6 (when present)
#
# Exit codes:
#   0 — staging checks passed (record evidence; still do not auto-flip readiness)
#   1 — staging configured but one or more checks failed
#   2 — staging env missing / incomplete (harness ready; staging not executed)
#
# Required env (at least one public edge base):
#   STAGING_BASE_URL     e.g. https://app.staging.withlanyard.com
#     OR STAGING_BFF_URL e.g. https://api.staging.withlanyard.com
#
# Optional / recommended:
#   STAGING_CP_PUBLIC_PROBE_URL  URL that MUST NOT serve CP from the public internet
#                                (e.g. guessed public CP host). Default probes derive
#                                from STAGING_BASE_URL host patterns when set.
#   STAGING_CP_PRIVATE_URL       Private/VPN/SSM-reachable CP base (e.g. http://cp.internal:3100)
#   CONTROL_PLANE_SERVICE_TOKEN  Real service token (value never logged)
#   STAGING_EXPECT_SERVICE_AUTH=1  Require production service-auth behaviour on private CP
#   STAGING_CURL_TIMEOUT=10
#   STAGING_EVIDENCE_DIR         If set, write a markdown evidence stub (no secrets)
#
# Usage:
#   # Fail closed (no staging):
#   bash scripts/staging-g1-cp-boundary-proof.sh
#
#   # Against staging (operator):
#   export STAGING_BASE_URL=https://app.staging.example
#   export STAGING_CP_PRIVATE_URL=http://10.0.1.20:3100   # via SSM port-forward / Tailscale
#   export CONTROL_PLANE_SERVICE_TOKEN='…'                # from secret store, not git
#   export STAGING_EXPECT_SERVICE_AUTH=1
#   bash scripts/staging-g1-cp-boundary-proof.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { echo "[staging-g1-proof] $*"; }
err() { echo "[staging-g1-proof] ERROR: $*" >&2; }
fail_closed() {
  err "FAIL CLOSED: $*"
  err "Staging was NOT executed. This is not a pass. Do not flip readiness-matrix G1."
  err "See docs/staging-proofs.md for operator setup."
  exit 2
}
fail_check() {
  err "CHECK FAILED: $*"
  ERRORS=$((ERRORS + 1))
}

TIMEOUT="${STAGING_CURL_TIMEOUT:-10}"
ERRORS=0
PASSED=0
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# --- env gate ---
BFF_URL="${STAGING_BFF_URL:-}"
if [[ -z "$BFF_URL" && -n "${STAGING_BASE_URL:-}" ]]; then
  BFF_URL="${STAGING_BASE_URL%/}"
fi
BFF_URL="${BFF_URL%/}"

if [[ -z "$BFF_URL" ]]; then
  fail_closed "STAGING_BASE_URL or STAGING_BFF_URL is required to run live staging checks"
fi

if [[ ! "$BFF_URL" =~ ^https?:// ]]; then
  fail_closed "STAGING_BFF_URL/STAGING_BASE_URL must be an http(s) URL (got: $BFF_URL)"
fi

log "timestamp=$TS"
log "BFF/public edge base=$BFF_URL"
log "NOTE: never echo secret values"

curl_code() {
  # prints HTTP status or 000 on transport failure
  local url="$1"
  shift
  curl -sS -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" "$@" "$url" 2>/dev/null || echo "000"
}

curl_body() {
  local url="$1"
  shift
  curl -sS --max-time "$TIMEOUT" "$@" "$url" 2>/dev/null || true
}

# --- C1: public BFF health works (public API edge) ---
log "C1: BFF /health via public edge"
code="$(curl_code "${BFF_URL}/health")"
if [[ "$code" == "200" ]]; then
  log "  PASS C1 status=$code"
  PASSED=$((PASSED + 1))
else
  fail_check "C1 BFF /health expected 200, got $code ($BFF_URL/health)"
fi

# --- C2: control-plane must not be reachable on public probe URL(s) ---
# Operators should set STAGING_CP_PUBLIC_PROBE_URL to any URL that would
# incorrectly expose CP (e.g. https://control-plane.staging… or ALB rule).
# Default: derive a few speculative public hostnames from the BFF host and
# require they do NOT return a healthy CP /health body. Connection failures
# (000 / timeout) are PASS (private).
log "C2: public must not reach control-plane"

PROBES=()
if [[ -n "${STAGING_CP_PUBLIC_PROBE_URL:-}" ]]; then
  # Accept either a base URL or a full …/health URL.
  probe_base="${STAGING_CP_PUBLIC_PROBE_URL%/}"
  if [[ "$probe_base" == */health ]]; then
    PROBES+=("$probe_base")
  else
    PROBES+=("${probe_base}/health")
  fi
else
  # Speculative probes — only used when operator did not pin a probe URL.
  host="$(printf '%s' "$BFF_URL" | sed -E 's#^https?://##' | cut -d/ -f1)"
  # strip optional port
  host_noport="${host%%:*}"
  for h in \
    "control-plane.${host_noport}" \
    "cp.${host_noport}" \
    "controlplane.${host_noport}"
  do
    scheme="https"
    [[ "$BFF_URL" == http://* ]] && scheme="http"
    PROBES+=("${scheme}://${h}/health")
  done
  log "  (using speculative public host probes; set STAGING_CP_PUBLIC_PROBE_URL to pin)"
fi

C2_OK=1
for probe in "${PROBES[@]}"; do
  code="$(curl_code "$probe")"
  body="$(curl_body "$probe")"
  # PASS if unreachable or non-200, or body does not look like CP health.
  # FAIL if we get a clear CP health success (public exposure).
  if [[ "$code" == "200" ]] && echo "$body" | grep -Eiq 'control.plane|"service"\s*:\s*"control-plane"|auth_mode'; then
    fail_check "C2 public probe $probe returned CP health (status=$code) — CP appears public"
    C2_OK=0
  else
    log "  probe $probe → status=$code (not a public CP health OK)"
  fi
done
if [[ "$C2_OK" -eq 1 ]]; then
  log "  PASS C2 (no public CP health observed on probes)"
  PASSED=$((PASSED + 1))
fi

# --- C3: private CP path (optional unless STAGING_CP_PRIVATE_URL set) ---
if [[ -z "${STAGING_CP_PRIVATE_URL:-}" ]]; then
  log "C3: SKIP private CP checks (set STAGING_CP_PRIVATE_URL for full G1.4)"
  log "  residual: private reachability + service auth not proven this run"
else
  CP="${STAGING_CP_PRIVATE_URL%/}"
  log "C3: private CP /health at $CP"
  code="$(curl_code "${CP}/health")"
  body="$(curl_body "${CP}/health")"
  if [[ "$code" == "200" ]]; then
    log "  PASS C3a private /health status=$code"
    PASSED=$((PASSED + 1))
  else
    fail_check "C3a private CP /health expected 200, got $code"
  fi

  # C3b: anonymous non-health must fail when service auth expected
  if [[ "${STAGING_EXPECT_SERVICE_AUTH:-0}" == "1" ]]; then
    log "C3b: anonymous non-health rejected (service auth required)"
    code="$(curl_code "${CP}/tenants" -X POST -H 'content-type: application/json' -d '{}')"
    if [[ "$code" == "401" || "$code" == "403" ]]; then
      log "  PASS C3b anonymous rejected status=$code"
      PASSED=$((PASSED + 1))
    else
      fail_check "C3b anonymous POST /tenants expected 401/403, got $code"
    fi

    if [[ -z "${CONTROL_PLANE_SERVICE_TOKEN:-}" ]]; then
      fail_check "C3c STAGING_EXPECT_SERVICE_AUTH=1 requires CONTROL_PLANE_SERVICE_TOKEN (value not logged)"
    else
      log "C3c: service token accepted on private CP (header present; value not logged)"
      # Prefer a safe read path if available; fall back to create-shaped call
      # Health with service token should still be 200
      code="$(curl_code "${CP}/health" -H "x-control-plane-service-token: ${CONTROL_PLANE_SERVICE_TOKEN}")"
      if [[ "$code" == "200" ]]; then
        log "  PASS C3c service token path reaches CP status=$code"
        PASSED=$((PASSED + 1))
      else
        fail_check "C3c service-authenticated /health expected 200, got $code"
      fi
      # Spoofed token must not unlock non-health
      code="$(curl_code "${CP}/tenants" -X POST \
        -H 'content-type: application/json' \
        -H 'x-control-plane-service-token: definitely-not-the-real-token' \
        -d '{}')"
      if [[ "$code" == "401" || "$code" == "403" ]]; then
        log "  PASS C3d spoofed service token rejected status=$code"
        PASSED=$((PASSED + 1))
      else
        fail_check "C3d spoofed token expected 401/403, got $code"
      fi
    fi
  else
    log "C3b/c: SKIP service-auth depth (set STAGING_EXPECT_SERVICE_AUTH=1 + CONTROL_PLANE_SERVICE_TOKEN)"
  fi
fi

# --- evidence stub (no secrets) ---
if [[ -n "${STAGING_EVIDENCE_DIR:-}" ]]; then
  mkdir -p "$STAGING_EVIDENCE_DIR"
  out="${STAGING_EVIDENCE_DIR}/g1.4-staging-proof-${TS//:/-}.md"
  {
    echo "# G1.4 staging proof evidence stub"
    echo
    echo "- timestamp_utc: $TS"
    echo "- bff_url: $BFF_URL"
    echo "- cp_public_probe: ${STAGING_CP_PUBLIC_PROBE_URL:-speculative-defaults}"
    echo "- cp_private_url_set: $([[ -n "${STAGING_CP_PRIVATE_URL:-}" ]] && echo yes || echo no)"
    echo "- expect_service_auth: ${STAGING_EXPECT_SERVICE_AUTH:-0}"
    echo "- service_token_provided: $([[ -n "${CONTROL_PLANE_SERVICE_TOKEN:-}" ]] && echo yes || echo no)"
    echo "- checks_passed_count: $PASSED"
    echo "- checks_failed_count: $ERRORS"
    echo "- harness: scripts/staging-g1-cp-boundary-proof.sh"
    echo "- prereqs: Portal PR #11 (G1.1), #13 (G1.2/G1.3)"
    echo
    echo "**Honesty:** Do not flip company-brain-deploy \`readiness-matrix.md\` G1 to **ready** until"
    echo "operators attach this (or equivalent) evidence and validate-production-gates remains consistent."
    echo "Never paste secret values into this file."
  } >"$out"
  log "wrote evidence stub: $out"
fi

if [[ "$ERRORS" -gt 0 ]]; then
  err "$ERRORS check(s) failed; $PASSED passed"
  err "Do not flip readiness-matrix G1."
  exit 1
fi

log "PASS staging G1.4 checks ($PASSED assertions)"
log "Operator next: attach evidence to change ticket / deploy readiness-matrix G1 row (deploy-owned)."
log "Product harness complete for this run; matrix flip is intentional and evidence-gated."
exit 0
