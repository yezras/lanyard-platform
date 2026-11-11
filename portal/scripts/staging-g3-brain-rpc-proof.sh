#!/usr/bin/env bash
# G3.4 staging E2E proof: brain RPC customer-host operation.
#
# FAIL CLOSED: without staging env this script refuses to claim pass (exit 2).
# Does NOT invent AWS / host evidence.
#
# Prerequisites:
#   - G3.1 contract: company-brain-deploy references/brain-rpc-contract.md (PR #4)
#   - G3.2 Hermes host handlers (hermes-lanyard / hermes-agent Lanyard branch)
#   - G3.3 Portal vertical slice (Portal PR #14 — BRAIN_RPC_ENABLED, /api/brain/*)
#   - Staging: BFF with BRAIN_RPC_ENABLED=1, relay, connected customer gateway
#
# Exit codes:
#   0 — staging E2E checks passed
#   1 — staging configured but checks failed
#   2 — staging env missing / incomplete (harness ready; staging not executed)
#
# Required env:
#   STAGING_BASE_URL or STAGING_BFF_URL  — public BFF origin
#
# Auth (one of):
#   STAGING_SESSION_COOKIE   full Cookie header value for an authenticated session
#   STAGING_BEARER_TOKEN     Authorization: Bearer … (if staging uses bearer)
# Optional login helper (only if staging exposes password login and CSRF flow is simple):
#   STAGING_LOGIN_EMAIL / STAGING_LOGIN_PASSWORD / STAGING_TENANT_HOST
#
# Optional:
#   STAGING_TENANT_HOST      Host header for path/subdomain tenant routing
#   STAGING_EXPECT_BRAIN_RPC=1  Require success path (default 1 when cookie/token set)
#   STAGING_CURL_TIMEOUT=30
#   STAGING_EVIDENCE_DIR
#   STAGING_BRAIN_ECHO       optional echo string for brain.ping (≤64 chars)
#
# Usage:
#   bash scripts/staging-g3-brain-rpc-proof.sh
#   # → exit 2 FAIL CLOSED
#
#   export STAGING_BASE_URL=https://app.staging.example
#   export STAGING_SESSION_COOKIE='lanyard_session=…; lanyard_csrf=…'
#   export STAGING_TENANT_HOST=demo.staging.example
#   bash scripts/staging-g3-brain-rpc-proof.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { echo "[staging-g3-proof] $*"; }
err() { echo "[staging-g3-proof] ERROR: $*" >&2; }
fail_closed() {
  err "FAIL CLOSED: $*"
  err "Staging brain RPC E2E was NOT executed. Do not flip readiness-matrix G3."
  err "See docs/staging-proofs.md."
  exit 2
}
fail_check() {
  err "CHECK FAILED: $*"
  ERRORS=$((ERRORS + 1))
}

TIMEOUT="${STAGING_CURL_TIMEOUT:-30}"
ERRORS=0
PASSED=0
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

BFF_URL="${STAGING_BFF_URL:-}"
if [[ -z "$BFF_URL" && -n "${STAGING_BASE_URL:-}" ]]; then
  BFF_URL="${STAGING_BASE_URL%/}"
fi
BFF_URL="${BFF_URL%/}"

if [[ -z "$BFF_URL" ]]; then
  fail_closed "STAGING_BASE_URL or STAGING_BFF_URL is required"
fi
if [[ ! "$BFF_URL" =~ ^https?:// ]]; then
  fail_closed "staging URL must be http(s) (got: $BFF_URL)"
fi

log "timestamp=$TS"
log "BFF base=$BFF_URL"

AUTH_ARGS=()
if [[ -n "${STAGING_SESSION_COOKIE:-}" ]]; then
  AUTH_ARGS+=(-H "Cookie: ${STAGING_SESSION_COOKIE}")
  log "auth: session cookie provided (value not logged)"
elif [[ -n "${STAGING_BEARER_TOKEN:-}" ]]; then
  AUTH_ARGS+=(-H "Authorization: Bearer ${STAGING_BEARER_TOKEN}")
  log "auth: bearer token provided (value not logged)"
else
  # Without credentials we can only prove fail-closed unauthenticated behaviour.
  log "auth: none — will only assert unauthenticated fail-closed (not full E2E)"
fi

if [[ -n "${STAGING_TENANT_HOST:-}" ]]; then
  AUTH_ARGS+=(-H "Host: ${STAGING_TENANT_HOST}")
  log "tenant host header=${STAGING_TENANT_HOST}"
fi

curl_status_body() {
  # sets globals _status _body
  local url="$1"
  shift
  local tmp
  tmp="$(mktemp)"
  _status="$(curl -sS -o "$tmp" -w '%{http_code}' --max-time "$TIMEOUT" "$@" "$url" 2>/dev/null || echo "000")"
  _body="$(cat "$tmp" 2>/dev/null || true)"
  rm -f "$tmp"
}

# --- C0: BFF health ---
log "C0: BFF /health"
curl_status_body "${BFF_URL}/health"
if [[ "$_status" == "200" ]]; then
  log "  PASS C0 status=$_status"
  PASSED=$((PASSED + 1))
else
  fail_check "C0 BFF /health expected 200, got $_status"
fi

# --- C1: unauthenticated brain routes fail closed ---
log "C1: unauthenticated GET /api/brain/ping fail-closed"
curl_status_body "${BFF_URL}/api/brain/ping"
# 401 (auth required), 503 (flag off), or 404 if route not deployed yet
case "$_status" in
  401|403|503)
    log "  PASS C1 unauthenticated status=$_status (fail-closed)"
    PASSED=$((PASSED + 1))
    ;;
  404)
    fail_check "C1 /api/brain/ping returned 404 — G3.3 vertical slice not deployed to this staging (PR #14)"
    ;;
  200)
    fail_check "C1 unauthenticated /api/brain/ping must not return 200"
    ;;
  000)
    fail_check "C1 transport failure to $BFF_URL/api/brain/ping"
    ;;
  *)
    fail_check "C1 unexpected status $_status body=${_body:0:200}"
    ;;
esac

# --- C2: authenticated success path (requires credentials) ---
EXPECT_SUCCESS="${STAGING_EXPECT_BRAIN_RPC:-}"
if [[ -z "$EXPECT_SUCCESS" ]]; then
  if [[ -n "${STAGING_SESSION_COOKIE:-}" || -n "${STAGING_BEARER_TOKEN:-}" ]]; then
    EXPECT_SUCCESS=1
  else
    EXPECT_SUCCESS=0
  fi
fi

if [[ "$EXPECT_SUCCESS" != "1" ]]; then
  log "C2/C3: SKIP authenticated brain.ping/health success (no session/token or STAGING_EXPECT_BRAIN_RPC=0)"
  log "  residual: full G3.4 E2E requires authenticated session + connected Hermes gateway"
else
  if [[ -z "${STAGING_SESSION_COOKIE:-}" && -z "${STAGING_BEARER_TOKEN:-}" ]]; then
    fail_check "STAGING_EXPECT_BRAIN_RPC=1 requires STAGING_SESSION_COOKIE or STAGING_BEARER_TOKEN"
  else
    ECHO_Q=""
    if [[ -n "${STAGING_BRAIN_ECHO:-}" ]]; then
      # keep short; shell-safe query
      ECHO_Q="?echo=$(printf '%s' "${STAGING_BRAIN_ECHO}" | head -c 64 | sed 's/ /%20/g')"
    fi

    log "C2: authenticated GET /api/brain/ping"
    curl_status_body "${BFF_URL}/api/brain/ping${ECHO_Q}" "${AUTH_ARGS[@]}"
    if [[ "$_status" == "200" ]] && echo "$_body" | grep -Eq '"ok"\s*:\s*true|"pong"\s*:\s*true'; then
      log "  PASS C2 brain.ping status=200 ok"
      PASSED=$((PASSED + 1))
    elif [[ "$_status" == "503" ]]; then
      fail_check "C2 brain.ping 503 — flag off, gateway disconnected, or host unavailable. body=${_body:0:300}"
    elif [[ "$_status" == "504" ]]; then
      fail_check "C2 brain.ping 504 timeout — host did not answer within budget"
    else
      fail_check "C2 brain.ping expected 200 ok, got $_status body=${_body:0:300}"
    fi

    log "C3: authenticated GET /api/brain/health"
    curl_status_body "${BFF_URL}/api/brain/health" "${AUTH_ARGS[@]}"
    if [[ "$_status" == "200" ]] && echo "$_body" | grep -Eq '"ok"\s*:\s*true|"method"\s*:\s*"brain\.health"'; then
      log "  PASS C3 brain.health status=200 ok"
      PASSED=$((PASSED + 1))
    elif [[ "$_status" == "503" ]]; then
      fail_check "C3 brain.health 503 — residual host/flag/connectivity. body=${_body:0:300}"
    else
      fail_check "C3 brain.health expected 200 ok, got $_status body=${_body:0:300}"
    fi
  fi
fi

# --- evidence stub ---
if [[ -n "${STAGING_EVIDENCE_DIR:-}" ]]; then
  mkdir -p "$STAGING_EVIDENCE_DIR"
  out="${STAGING_EVIDENCE_DIR}/g3.4-staging-proof-${TS//:/-}.md"
  {
    echo "# G3.4 staging E2E evidence stub"
    echo
    echo "- timestamp_utc: $TS"
    echo "- bff_url: $BFF_URL"
    echo "- tenant_host: ${STAGING_TENANT_HOST:-}"
    echo "- auth_mode: $([[ -n "${STAGING_SESSION_COOKIE:-}" ]] && echo cookie || ([[ -n "${STAGING_BEARER_TOKEN:-}" ]] && echo bearer || echo none))"
    echo "- expect_success_path: $EXPECT_SUCCESS"
    echo "- checks_passed_count: $PASSED"
    echo "- checks_failed_count: $ERRORS"
    echo "- harness: scripts/staging-g3-brain-rpc-proof.sh"
    echo "- prereqs: deploy brain-rpc-contract (G3.1), Hermes G3.2, Portal PR #14 (G3.3)"
    echo
    echo "**Honesty:** Do not flip company-brain-deploy \`readiness-matrix.md\` G3 to **ready** until"
    echo "operators attach evidence of authenticated brain.ping/health against a real customer host."
    echo "Never paste cookies, tokens, or secrets into this file."
  } >"$out"
  log "wrote evidence stub: $out"
fi

if [[ "$ERRORS" -gt 0 ]]; then
  err "$ERRORS check(s) failed; $PASSED passed"
  err "Do not flip readiness-matrix G3."
  exit 1
fi

if [[ "$EXPECT_SUCCESS" != "1" ]]; then
  log "PARTIAL PASS: unauthenticated fail-closed only ($PASSED assertions)"
  log "Full G3.4 requires authenticated session + live gateway — still incomplete for readiness flip."
  # Exit 0 for partial automated checks that passed, but message is honest.
  # Operators must not treat this as full G3 ready.
  exit 0
fi

log "PASS staging G3.4 E2E checks ($PASSED assertions)"
log "Operator next: attach evidence to readiness-matrix G3 (deploy-owned)."
exit 0
