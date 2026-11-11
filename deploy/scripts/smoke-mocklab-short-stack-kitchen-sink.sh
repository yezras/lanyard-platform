#!/usr/bin/env bash
# Offline smoke: lp-oop.34 kitchen-sink prove script + runner exist (no browser, no AWS).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROVE="$ROOT/deploy/scripts/prove-mocklab-short-stack-kitchen-sink.sh"
SMOKE_SELF="$ROOT/deploy/scripts/smoke-mocklab-short-stack-kitchen-sink.sh"
RUNNER="$ROOT/artifacts/ui/lp-oop.34/run_qa.py"
SERVE="$ROOT/portal/packages/bff/scripts/serve-short-stack-kitchen-sink.ts"
TESTING="$ROOT/docs/plans/0015-short-stack/testing.md"
PHASE8="$ROOT/docs/plans/0015-short-stack/phase-8-dual-run-proof.md"
README="$ROOT/artifacts/ui/lp-oop.34/README.md"
STACK_README="$ROOT/artifacts/mocklab/short-stack/README.md"
GATE="$ROOT/artifacts/mocklab/short-stack/kitchen-sink/RESULT.md"

err() { echo "[smoke-mocklab-short-stack-kitchen-sink] ERROR: $*" >&2; }
log() { echo "[smoke-mocklab-short-stack-kitchen-sink] $*"; }
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
require_file "$STACK_README"

bash -n "$PROVE" || fail "prove script failed bash -n"
bash -n "$SMOKE_SELF" || fail "smoke script failed bash -n"
python3 -m py_compile "$RUNNER" || fail "run_qa.py failed py_compile"

grep -Eq 'lp-oop\.34' "$PROVE" "$RUNNER" "$SERVE" "$TESTING" "$PHASE8" \
  || fail "lp-oop.34 must be named in prove/runner/serve/testing/phase-8"
grep -Eq 'GO_WITH_WAIVERS|Waivers named|waivers' "$PROVE" "$RUNNER" \
  || fail "waivers must be named (not silent)"
grep -Eq 'guest.path.still|Guest path still|guest_path_still_available' \
  "$PROVE" "$RUNNER" "$SERVE" \
  || fail "guest path still available assertion missing"
grep -Eq 'withlanyard.com' "$RUNNER" \
  || fail "runner must refuse live AWS MockLab URL"
grep -Eq 'CHAT_DELIVERY=harness|chatDelivery: "harness"' "$SERVE" \
  || fail "serve script must set ChatDelivery=harness"
grep -Eq 'vaultPlane: "cp_s3"|VaultPlane=cp_s3' "$SERVE" \
  || fail "serve script must set VaultPlane=cp_s3"
grep -Eq 'DEFAULT_CHAT_DELIVERY=relay|guest_path_default' "$PROVE" "$SERVE" \
  || fail "guest default relay must be asserted"
grep -Eq 'FLIP_LIVE' "$PROVE" \
  || fail "prove script must refuse live flip"
grep -Eq 'lp-oop\.34' "$STACK_README" \
  || fail "short-stack README must name lp-oop.34"

if [[ -f "$GATE" ]]; then
  grep -Eq 'GO_WITH_WAIVERS|\*\*GO\*\*' "$GATE" \
    || fail "gate RESULT.md must be GO or GO_WITH_WAIVERS"
  grep -Eq 'WAIVED|PRODUCT_NA|EXPLICIT_HARD_RESIDUAL' "$GATE" \
    || fail "gate RESULT.md must name waivers"
fi

log "OK: lp-oop.34 kitchen-sink prove/smoke files present"
echo "smoke-mocklab-short-stack-kitchen-sink: PASS"
