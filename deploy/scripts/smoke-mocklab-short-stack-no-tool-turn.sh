#!/usr/bin/env bash
# Offline smoke: lp-oop.31 no-tool turn evidence + prove script (no AWS, no harness start).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MONO="$(cd "$ROOT/.." && pwd)"
EVIDENCE_DIR="$MONO/artifacts/mocklab/short-stack"
PROVE="$ROOT/scripts/prove-mocklab-short-stack-no-tool-turn.sh"
SMOKE_SELF="$ROOT/scripts/smoke-mocklab-short-stack-no-tool-turn.sh"
README="$EVIDENCE_DIR/README.md"
RESULT="$EVIDENCE_DIR/RESULT.md"
LATEST="$EVIDENCE_DIR/no-tool-turn-evidence-latest.json"
PHASE8="$MONO/docs/plans/0015-short-stack/phase-8-dual-run-proof.md"
TESTING="$MONO/docs/plans/0015-short-stack/testing.md"

err() { echo "[smoke-mocklab-short-stack-no-tool-turn] ERROR: $*" >&2; }
log() { echo "[smoke-mocklab-short-stack-no-tool-turn] $*"; }
fail() { err "$*"; exit 1; }
pass() { log "OK: $*"; }

require_file() {
  local f="$1"
  [[ -f "$f" ]] || fail "required file missing: $f"
}

require_file "$PROVE"
require_file "$SMOKE_SELF"
require_file "$README"
require_file "$RESULT"
require_file "$LATEST"
require_file "$PHASE8"
require_file "$TESTING"
pass "prove + evidence + phase-8 files present"

bash -n "$PROVE" || fail "prove script failed bash -n"
bash -n "$SMOKE_SELF" || fail "smoke script failed bash -n"
pass "bash -n"

grep -Eq 'lp-oop\.31' "$PROVE" "$README" "$RESULT" "$PHASE8" "$TESTING" \
  || fail "lp-oop.31 must be named in prove/readme/result/phase-8/testing"
grep -Eq 'Relay not on the hop|relay.not_on_hop|Relay was \*\*not\*\* on the hop' "$RESULT" \
  || fail "RESULT.md must state Relay was not on the hop"
grep -Eq 'createHarnessTurnServer' "$PROVE" "$RESULT" \
  || fail "must name createHarnessTurnServer (real LA, not real harness)"
grep -Eq 'real harness' "$PROVE" "$RESULT" \
  || fail "must explicitly say real harness was not used"
pass "docs name the live hop"

if grep -Eiq 'terraform apply|ecs update-service --desired-count' "$PROVE"; then
  grep -Eq 'Does not terraform apply|does not terraform apply|No AWS apply|does not `?terraform apply' "$PROVE" \
    || fail "prove script mentions apply without a do-not"
fi
pass "prove does not apply AWS"

# Evidence JSON shape
python3 - "$LATEST" <<'PY'
import json, re, sys
from pathlib import Path
p = Path(sys.argv[1])
data = json.loads(p.read_text())
if data.get("bead_id") != "lp-oop.31":
    raise SystemExit("bead_id")
if data.get("result") != "PASS":
    raise SystemExit("result")
checks = data.get("checks") or {}
for key in ("relay.not_on_hop", "harness.echo_no_tools", "sse.no_tool_progress", "evidence.no_secrets"):
    if checks.get(key) is not True:
        raise SystemExit(f"check {key}")
relay = data.get("relay") or {}
for key in (
    "deliverInbound_calls",
    "interruptInbound_calls",
    "openChatEventStream_calls",
    "fetchChatHistory_calls",
):
    if int(relay.get(key, 1)) != 0:
        raise SystemExit(f"relay {key}")
if data.get("topology", {}).get("fake_harness_http") is not False:
    raise SystemExit("fake_harness_http must be false")
blob = json.dumps(data)
if re.search(r"AKIA[0-9A-Z]{16}", blob):
    raise SystemExit("aws key")
if "placeholder-harness-service-token" in blob or "test-harness-service-token" in blob:
    raise SystemExit("token value leaked")
if "GATEWAY_RELAY_SECRET=" in blob:
    raise SystemExit("relay secret")
print("evidence shape ok")
PY
pass "evidence JSON: PASS + Relay zero + no secrets"

# README landing zone
grep -Eq 'lp-oop\.31' "$README" || fail "README must list lp-oop.31"
grep -Eq 'No secrets' "$README" || fail "README must say No secrets"
pass "README landing zone"

echo "smoke-mocklab-short-stack-no-tool-turn: PASS"
