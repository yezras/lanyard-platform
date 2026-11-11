#!/usr/bin/env bash
# LOCAL topology proof harness (G1.3 / G1.4 partial evidence).
#
# Proves product-repo properties that do NOT require live AWS staging:
#   - docker-compose binds control-plane host publish to 127.0.0.1 only
#   - docker-smoke publishes CP on loopback only
#   - production topology ADR documents private-only CP + service auth names
#   - optional: unit/integration tests for service auth when G1.2 code is present
#
# This script NEVER claims staging G1 ready. It exits:
#   0 — local properties pass (partial evidence only)
#   1 — local properties failed (regression)
#
# Usage (from monorepo root):
#   bash scripts/local-topology-proof.sh
#   LOCAL_TOPOLOGY_RUN_UNIT_TESTS=1 bash scripts/local-topology-proof.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { echo "[local-topology-proof] $*"; }
err() { echo "[local-topology-proof] ERROR: $*" >&2; }
fail() { err "$*"; exit 1; }

ERRORS=0
soft_fail() {
  err "$*"
  ERRORS=$((ERRORS + 1))
}

log "LOCAL only — not staging. root=$ROOT"

# --- ADR presence + doctrine phrases ---
ADR="artifacts/portal-production-topology.md"
[[ -f "$ADR" ]] || soft_fail "missing $ADR"
if [[ -f "$ADR" ]]; then
  for phrase in "public ALB" "private" "CONTROL_PLANE_SERVICE_TOKEN" "fail-closed" "BFF is the public API edge"; do
    grep -Fiq "$phrase" "$ADR" || soft_fail "ADR missing phrase: $phrase"
  done
  log "ADR doctrine phrases present"
fi

# --- compose: CP loopback host bind ---
COMPOSE="docker-compose.yml"
[[ -f "$COMPOSE" ]] || soft_fail "missing $COMPOSE"
if [[ -f "$COMPOSE" ]]; then
  # Extract rough control-plane service block
  CP_BLOCK="$(awk '
    /^  control-plane:/ {grab=1}
    grab && /^  [a-z]/ && !/^  control-plane:/ {exit}
    grab && /^volumes:/ {exit}
    grab {print}
  ' "$COMPOSE")"
  if [[ -z "$CP_BLOCK" ]]; then
    soft_fail "could not find control-plane service in $COMPOSE"
  else
    echo "$CP_BLOCK" | grep -Eq '127\.0\.0\.1:3100:3100' \
      || soft_fail "compose control-plane must publish 127.0.0.1:3100:3100"
    echo "$CP_BLOCK" | grep -Eq '0\.0\.0\.0:3100' \
      && soft_fail "compose control-plane must not publish 0.0.0.0:3100"
    # bare host port without host IP is forbidden for CP
    if echo "$CP_BLOCK" | grep -E '^\s+-\s+"?3100:3100"?' >/dev/null; then
      soft_fail "compose control-plane uses bare 3100:3100 (must be loopback-bound)"
    fi
    log "compose CP host bind: loopback OK"
  fi
fi

# --- docker-smoke: CP loopback ---
SMOKE="scripts/docker-smoke.sh"
[[ -f "$SMOKE" ]] || soft_fail "missing $SMOKE"
if [[ -f "$SMOKE" ]]; then
  grep -Eq -- '-p\s+"127\.0\.0\.1:\$\{CP_HOST_PORT\}:3100"' "$SMOKE" \
    || soft_fail "docker-smoke must publish CP as 127.0.0.1:\${CP_HOST_PORT}:3100"
  grep -Eq -- '-p\s+"\$\{CP_HOST_PORT\}:3100"' "$SMOKE" \
    && soft_fail "docker-smoke must not publish CP without loopback bind"
  grep -Eq -- '-p\s+"0\.0\.0\.0:\$\{CP_HOST_PORT\}:3100"' "$SMOKE" \
    && soft_fail "docker-smoke must not publish CP on 0.0.0.0"
  log "docker-smoke CP host bind: loopback OK"
fi

# --- staging harness scripts exist and fail-closed ---
for s in \
  scripts/staging-g1-cp-boundary-proof.sh \
  scripts/staging-g3-brain-rpc-proof.sh \
  scripts/local-topology-proof.sh
do
  [[ -f "$s" ]] || soft_fail "missing harness $s"
done
# Staging scripts must refuse to pass without env (spot-check by invoking without env)
if [[ -f scripts/staging-g1-cp-boundary-proof.sh ]]; then
  set +e
  out="$(bash scripts/staging-g1-cp-boundary-proof.sh 2>&1)"
  code=$?
  set -e
  if [[ "$code" -eq 0 ]]; then
    soft_fail "staging-g1-cp-boundary-proof.sh must not exit 0 without staging env"
  elif [[ "$code" -eq 2 ]]; then
    log "staging G1 harness fail-closed without env (exit 2) OK"
  else
    # exit 1 is also acceptable fail-closed if script treats missing env as error
    if echo "$out" | grep -Eiq 'FAIL CLOSED|STAGING_'; then
      log "staging G1 harness refused without env (exit $code) OK"
    else
      soft_fail "staging G1 harness unexpected exit $code without env: $out"
    fi
  fi
fi
if [[ -f scripts/staging-g3-brain-rpc-proof.sh ]]; then
  set +e
  out="$(bash scripts/staging-g3-brain-rpc-proof.sh 2>&1)"
  code=$?
  set -e
  if [[ "$code" -eq 0 ]]; then
    soft_fail "staging-g3-brain-rpc-proof.sh must not exit 0 without staging env"
  elif [[ "$code" -eq 2 ]]; then
    log "staging G3 harness fail-closed without env (exit 2) OK"
  else
    if echo "$out" | grep -Eiq 'FAIL CLOSED|STAGING_'; then
      log "staging G3 harness refused without env (exit $code) OK"
    else
      soft_fail "staging G3 harness unexpected exit $code without env: $out"
    fi
  fi
fi

# --- optional unit tests (G1.2 service auth when present) ---
if [[ "${LOCAL_TOPOLOGY_RUN_UNIT_TESTS:-0}" == "1" ]]; then
  if [[ -f packages/control-plane/src/service-auth.ts ]]; then
    log "running control-plane service-auth + private-topology tests"
    pnpm --filter @lanyard/control-plane test -- private-topology service-auth 2>&1 \
      || soft_fail "control-plane topology/service-auth tests failed"
  else
    log "SKIP unit service-auth: packages/control-plane/src/service-auth.ts not present (needs G1.2 PR #13 merge)"
  fi
  if [[ -f packages/bff/src/brain-rpc.ts ]]; then
    log "running bff brain-rpc tests (G3.3)"
    pnpm --filter @lanyard/bff test -- brain-rpc 2>&1 \
      || soft_fail "bff brain-rpc tests failed"
  else
    log "SKIP brain-rpc unit: packages/bff/src/brain-rpc.ts not present (needs G3.3 PR #14 merge)"
  fi
else
  log "skip unit tests (set LOCAL_TOPOLOGY_RUN_UNIT_TESTS=1 to run when code is present)"
fi

if [[ "$ERRORS" -gt 0 ]]; then
  fail "$ERRORS local topology check(s) failed — partial G1 evidence incomplete"
fi

log "PASS (LOCAL partial evidence only)"
log "NOT claimed: readiness-matrix G1 ready, live staging public-probe, live BFF↔CP service auth in AWS"
log "Next: operator runs scripts/staging-g1-cp-boundary-proof.sh with STAGING_* env when staging exists"
exit 0
