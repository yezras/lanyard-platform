#!/usr/bin/env bash
# Offline honesty guard for readiness live proofs residual (lp-t7q.7).
# Does NOT hit staging/AWS. Fails if residual ledger is missing required gates,
# over-claims ready, or validators would allow false matrix flips.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOC="${ROOT}/references/runbooks/readiness-live-proofs-residual.md"
MATRIX="${ROOT}/references/readiness-matrix.md"
VALIDATOR="${ROOT}/scripts/validate-production-gates.sh"
E2E="${ROOT}/references/runbooks/security-e2e-acceptance.md"
PORTAL_PROOFS="${ROOT}/../portal/docs/staging-proofs.md"
G1_HARNESS="${ROOT}/../portal/scripts/staging-g1-cp-boundary-proof.sh"
G3_HARNESS="${ROOT}/../portal/scripts/staging-g3-brain-rpc-proof.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "OK: $*"; }

[[ -f "$DOC" ]] || fail "missing residual ledger: $DOC"
[[ -f "$MATRIX" ]] || fail "missing readiness matrix: $MATRIX"
[[ -f "$VALIDATOR" ]] || fail "missing validator: $VALIDATOR"

need() {
  local file="$1" pat="$2" msg="$3"
  grep -Eq "$pat" "$file" || fail "$msg"
  pass "$msg"
}

# --- Residual ledger content ---
need "$DOC" 'lp-t7q\.7' "residual documents bead lp-t7q.7"
need "$DOC" 'cbd-mta\.6' "residual links migrated source cbd-mta.6"
need "$DOC" 'G1\.4' "residual covers G1.4"
need "$DOC" 'G1a' "residual covers G1a"
need "$DOC" '\*\*G2\*\*|G2 \(S4\)|G2 S4' "residual covers G2"
need "$DOC" 'G3\.4|\*\*G3\*\*' "residual covers G3.4"
need "$DOC" 'Live gate ledger|pass / fail / blocked' "residual has live gate ledger"
need "$DOC" 'fail-closed|FAIL CLOSED' "residual states fail-closed"

# Each live gate must have an explicit blocked note (not ready)
for gate_pat in 'G1\.4' 'G1a' 'G2' 'G3\.4'; do
  # Find lines mentioning the gate and require blocked language nearby in residual table
  if ! grep -E "$gate_pat" "$DOC" | grep -Eiq 'blocked'; then
    fail "residual must mark live $gate_pat as blocked until evidence"
  fi
  pass "live $gate_pat has blocked note in residual"
done

# Must not claim live staging executed / matrix ready from monorepo alone
if grep -Eiq 'live staging.*(pass|passed|complete|executed).*(G1\.4|G1a|G2|G3)' "$DOC"; then
  # Allow only when clearly negated on same line
  bad="$(grep -niE 'live staging.*(pass|passed|complete|executed)' "$DOC" | grep -viE 'not |never|no |until|blocked|without|not executed|not recorded' || true)"
  if [[ -n "$bad" ]]; then
    fail "residual appears to claim live staging executed: $bad"
  fi
fi
pass "residual does not claim live staging executed"

if grep -Eiq 'matrix G1.*\*\*ready\*\*|G1\.4.*\*\*ready\*\*|flip.*G1.*ready' "$DOC"; then
  bad="$(grep -niE 'G1.*\*\*ready\*\*|flip.*ready' "$DOC" | grep -viE 'not |never|until|do not|must not|without|stay|stays|blocked|only then|may propose' || true)"
  if [[ -n "$bad" ]]; then
    fail "residual appears to claim matrix ready: $bad"
  fi
fi
pass "residual does not claim matrix ready without evidence path"

# Forbidden secret material patterns
if grep -Eiq 'lanyard_session=[A-Za-z0-9]{16,}|CONTROL_PLANE_SERVICE_TOKEN=[A-Za-z0-9]{8,}|GATEWAY_RELAY_SECRET=[^P]' "$DOC"; then
  fail "residual appears to contain secret material"
fi
pass "no obvious secret material in residual"

# --- Matrix honesty ---
need "$MATRIX" 'readiness-live-proofs-residual|lp-t7q\.7' \
  "readiness-matrix references live proofs residual / lp-t7q.7"
need "$MATRIX" '\*\*G1\*\*.*\*\*blocked\*\*|Authenticated \*\*private control-plane.*\*\*blocked\*\*' \
  "matrix G1 remains blocked"
need "$MATRIX" '\*\*G2\*\*.*\*\*blocked\*\*|Relay \*\*credential lifecycle\*\*.*\*\*blocked\*\*' \
  "matrix G2 remains blocked"
need "$MATRIX" '\|\s*\*\*G3\*\*.*\*\*blocked\*\*|Brain RPC.*\*\*blocked\*\*' \
  "matrix G3 remains blocked"
need "$MATRIX" 'G1a.*\*\*blocked\*\*|live proof.*\*\*blocked\*\*|Live G1a.*blocked|blocked.*live proof' \
  "matrix G1a live proof remains blocked"

# Production security overall claim must stay BLOCKED
grep -Eqi 'Production Portal/relay security status:[[:space:]]*BLOCKED' "$MATRIX" \
  || fail "matrix must state Production Portal/relay security status: BLOCKED"
pass "production Portal/relay security status BLOCKED"

# --- Validator still fail-closed for G1/G2/G3 ---
need "$VALIDATOR" 'G1' "validator mentions G1"
need "$VALIDATOR" 'G2' "validator mentions G2"
need "$VALIDATOR" 'G3|Brain RPC' "validator enforces G3 honesty"
need "$VALIDATOR" 'readiness-live-proofs-residual|LIVE_PROOFS_RESIDUAL' \
  "validator requires live proofs residual"
need "$VALIDATOR" 'fail-closed|FAIL CLOSED|\*\*blocked\*\*' "validator is fail-closed"

# Run validator (must pass while gates blocked)
bash "$VALIDATOR" >/dev/null
pass "validate-production-gates.sh exits 0 with honest blocked matrix"

# --- Companion surfaces ---
if [[ -f "$E2E" ]]; then
  need "$E2E" 'readiness-live-proofs-residual|lp-t7q\.7|G1\.4' \
    "security-e2e-acceptance references residual or G1.4"
fi

if [[ -f "$PORTAL_PROOFS" ]]; then
  need "$PORTAL_PROOFS" 'fail closed|FAIL CLOSED|exit 2' \
    "portal staging-proofs documents fail-closed"
  need "$PORTAL_PROOFS" 'readiness-live-proofs-residual|lp-t7q\.7|deploy/references/runbooks' \
    "portal staging-proofs links deploy residual"
fi

# Harnesses must fail closed without STAGING_* (exit 2)
if [[ -f "$G1_HARNESS" ]]; then
  set +e
  out="$(bash "$G1_HARNESS" 2>&1)"
  rc=$?
  set -e
  [[ "$rc" -eq 2 ]] || fail "staging-g1 harness must exit 2 without STAGING_* (got $rc)"
  echo "$out" | grep -Eiq 'FAIL CLOSED|fail closed' \
    || fail "staging-g1 harness must print FAIL CLOSED"
  pass "G1.4 harness fail-closed exit 2"
fi

if [[ -f "$G3_HARNESS" ]]; then
  set +e
  out="$(bash "$G3_HARNESS" 2>&1)"
  rc=$?
  set -e
  [[ "$rc" -eq 2 ]] || fail "staging-g3 harness must exit 2 without STAGING_* (got $rc)"
  echo "$out" | grep -Eiq 'FAIL CLOSED|fail closed' \
    || fail "staging-g3 harness must print FAIL CLOSED"
  pass "G3.4 harness fail-closed exit 2"
fi

echo "smoke-readiness-live-proofs-residual: PASS"
exit 0
