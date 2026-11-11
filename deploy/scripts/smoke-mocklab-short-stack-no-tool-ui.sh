#!/usr/bin/env bash
# Offline smoke: lp-oop.36 UI prove script + runner exist (no browser, no AWS).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROVE="$ROOT/deploy/scripts/prove-mocklab-short-stack-no-tool-ui.sh"
SMOKE_SELF="$ROOT/deploy/scripts/smoke-mocklab-short-stack-no-tool-ui.sh"
RUNNER="$ROOT/artifacts/ui/lp-oop.36/run_qa.py"
SERVE="$ROOT/portal/packages/bff/scripts/serve-short-stack-ui-qa.ts"
TESTING="$ROOT/docs/plans/0015-short-stack/testing.md"

err() { echo "[smoke-mocklab-short-stack-no-tool-ui] ERROR: $*" >&2; }
log() { echo "[smoke-mocklab-short-stack-no-tool-ui] $*"; }
fail() { err "$*"; exit 1; }

require_file() {
  [[ -f "$1" ]] || fail "required file missing: $1"
}

require_file "$PROVE"
require_file "$SMOKE_SELF"
require_file "$RUNNER"
require_file "$SERVE"
require_file "$TESTING"

bash -n "$PROVE" || fail "prove script failed bash -n"
bash -n "$SMOKE_SELF" || fail "smoke script failed bash -n"
python3 -m py_compile "$RUNNER" || fail "run_qa.py failed py_compile"

grep -Eq 'lp-oop\.36' "$PROVE" "$RUNNER" "$SERVE" "$TESTING" \
  || fail "lp-oop.36 must be named in prove/runner/serve/testing"
grep -Eq 'Relay not on the hop|relay-not-on-hop|relay\.not_on_hop' \
  "$PROVE" "$RUNNER" "$SERVE" \
  || fail "Relay-not-on-hop assertion missing"
grep -Eq 'withlanyard.com' "$RUNNER" \
  || fail "runner must refuse live AWS MockLab URL"

log "OK: lp-oop.36 UI prove/smoke files present"
