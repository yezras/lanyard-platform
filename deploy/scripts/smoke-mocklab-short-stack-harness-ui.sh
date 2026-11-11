#!/usr/bin/env bash
# Offline smoke: lp-oop.33 UI prove script + runner exist (no browser, no AWS).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROVE="$ROOT/deploy/scripts/prove-mocklab-short-stack-harness-ui.sh"
SMOKE_SELF="$ROOT/deploy/scripts/smoke-mocklab-short-stack-harness-ui.sh"
RUNNER="$ROOT/artifacts/ui/lp-oop.33/run_qa.py"
SERVE="$ROOT/portal/packages/bff/scripts/serve-short-stack-harness-ui.ts"
TESTING="$ROOT/docs/plans/0015-short-stack/testing.md"
PHASE8="$ROOT/docs/plans/0015-short-stack/phase-8-dual-run-proof.md"
README="$ROOT/artifacts/ui/lp-oop.33/README.md"

err() { echo "[smoke-mocklab-short-stack-harness-ui] ERROR: $*" >&2; }
log() { echo "[smoke-mocklab-short-stack-harness-ui] $*"; }
fail() { err "$*"; exit 1; }

require_file() {
  [[ -f "$1" ]] || fail "required file missing: $1"
}

require_file "$PROVE"
require_file "$SMOKE_SELF"
require_file "$RUNNER"
require_file "$SERVE"
require_file "$TESTING"
require_file "$PHASE8"
require_file "$README"

bash -n "$PROVE" || fail "prove script failed bash -n"
bash -n "$SMOKE_SELF" || fail "smoke script failed bash -n"
python3 -m py_compile "$RUNNER" || fail "run_qa.py failed py_compile"

grep -Eq 'lp-oop\.33' "$PROVE" "$RUNNER" "$SERVE" "$TESTING" "$PHASE8" \
  || fail "lp-oop.33 must be named in prove/runner/serve/testing/phase-8"
grep -Eq 'did_not_502_wake|did-not-502-wake|did not 502 wake' \
  "$PROVE" "$RUNNER" "$SERVE" \
  || fail "vault tree did-not-502-wake assertion missing"
grep -Eq 'withlanyard.com' "$RUNNER" \
  || fail "runner must refuse live AWS MockLab URL"
grep -Eq 'CHAT_DELIVERY=harness|chatDelivery: "harness"' "$SERVE" \
  || fail "serve script must set ChatDelivery=harness"
grep -Eq 'vaultPlane: "cp_s3"|VaultPlane=cp_s3' "$SERVE" \
  || fail "serve script must set VaultPlane=cp_s3"

log "OK: lp-oop.33 UI prove/smoke files present"
echo "smoke-mocklab-short-stack-harness-ui: PASS"
