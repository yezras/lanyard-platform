#!/usr/bin/env bash
# Offline smoke: lp-oop.32 invariant script + RESULT.md (no AWS, no snapshot flip).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MONO="$(cd "$ROOT/.." && pwd)"
EVIDENCE_DIR="$MONO/artifacts/mocklab/short-stack"
PROVE="$ROOT/scripts/prove-mocklab-short-stack-invariants.sh"
SMOKE_SELF="$ROOT/scripts/smoke-mocklab-short-stack-invariants.sh"
README="$EVIDENCE_DIR/README.md"
RESULT="$EVIDENCE_DIR/RESULT.md"
LATEST="$EVIDENCE_DIR/invariants-evidence-latest.json"
PHASE8="$MONO/docs/plans/0015-short-stack/phase-8-dual-run-proof.md"
TESTING="$MONO/docs/plans/0015-short-stack/testing.md"
LIVE_PIN="$ROOT/daytona/agent-gateway/pins/staging-pilot.pins.yaml"
LAB_PIN="$MONO/artifacts/lab/short-stack/tool-only.pins.yaml"
LAB_CHECK="$MONO/artifacts/lab/short-stack/check-not-live.sh"

err() { echo "[smoke-mocklab-short-stack-invariants] ERROR: $*" >&2; }
log() { echo "[smoke-mocklab-short-stack-invariants] $*"; }
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
require_file "$LIVE_PIN"
require_file "$LAB_PIN"
require_file "$LAB_CHECK"
pass "prove + evidence + phase-8 files present"

bash -n "$PROVE" || fail "prove script failed bash -n"
bash -n "$SMOKE_SELF" || fail "smoke script failed bash -n"
bash "$LAB_CHECK" || fail "lab pin check-not-live failed"
pass "bash -n + lab pin not-live"

grep -Eq 'lp-oop\.32' "$PROVE" "$README" "$RESULT" "$PHASE8" "$TESTING" \
  || fail "lp-oop.32 must be named in prove/readme/result/phase-8/testing"
grep -Eq 'Live snapshot unchanged|live snapshot unchanged|Live MockLab snapshot flipped' "$RESULT" \
  || fail "RESULT.md must record live snapshot honesty"
grep -Eq 'HELD|held' "$RESULT" || fail "RESULT.md must hold the live tool turn"
grep -Eq 'FLIP_LIVE_SNAPSHOT' "$PROVE" || fail "prove must refuse FLIP_LIVE_SNAPSHOT"
pass "docs name the hold + invariants"

if grep -Eiq 'terraform apply|ecs update-service --desired-count' "$PROVE"; then
  grep -Eq 'No AWS apply|does not terraform apply|does not write' "$PROVE" \
    || fail "prove script mentions apply without a do-not"
fi
pass "prove does not apply AWS"

# Live pin must still match the lab pin's recorded sha.
recorded="$(awk -F'"' '/pin_file_sha256:/ {print $2; exit}' "$LAB_PIN")"
actual="$(sha256sum "$LIVE_PIN" | awk '{print $1}')"
[[ "$recorded" == "$actual" ]] || fail "live pin sha $actual != recorded $recorded"
pass "live snapshot sha unchanged"

python3 - "$LATEST" "$actual" <<'PY'
import json, re, sys
from pathlib import Path
p = Path(sys.argv[1])
live_sha = sys.argv[2]
data = json.loads(p.read_text())
if data.get("bead_id") != "lp-oop.32":
    raise SystemExit("bead_id")
if data.get("result") != "PASS":
    raise SystemExit("result")
if data.get("live_tool_turn") != "held":
    raise SystemExit("live_tool_turn must be held")
snap = data.get("live_snapshot") or {}
if snap.get("unchanged") is not True:
    raise SystemExit("live_snapshot.unchanged")
if snap.get("wrote_daytona_default_snapshot") is not False:
    raise SystemExit("wrote_daytona_default_snapshot")
if snap.get("wrote_mocklab_agent_snapshot_id") is not False:
    raise SystemExit("wrote_mocklab_agent_snapshot_id")
if snap.get("sha256") != live_sha:
    raise SystemExit("evidence sha != live pin sha")
checks = data.get("checks") or {}
for key in (
    "live.snapshot.unchanged",
    "toolbox.no_agent_tree",
    "create_env.no_provider_keys",
    "same_user.same_sandbox",
    "second_user.tenant_primary_fallback",
    "tenant_a.cannot_exec_tenant_b",
    "browser.no_harness_daytona_tokens",
    "vault.tree.no_ensure_online",
    "evidence.no_secrets",
):
    if checks.get(key) is not True:
        raise SystemExit(f"check {key}")
blob = json.dumps(data)
if re.search(r"AKIA[0-9A-Z]{16}", blob):
    raise SystemExit("aws key")
if "placeholder-harness-service-token" in blob or "test-harness-service-token" in blob:
    raise SystemExit("token value leaked")
if "GATEWAY_RELAY_SECRET=" in blob:
    raise SystemExit("relay secret")
print("evidence shape ok")
PY
pass "evidence JSON: PASS + live hold + no secrets"

grep -Eq 'lp-oop\.32' "$README" || fail "README must list lp-oop.32"
grep -Eq 'No secrets' "$README" || fail "README must say No secrets"
pass "README landing zone"

echo "smoke-mocklab-short-stack-invariants: PASS"
