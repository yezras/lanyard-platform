#!/usr/bin/env bash
# Offline smoke: lp-k5c4.10 inbound-spine evidence pack (no AWS apply).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROVE="$ROOT/deploy/scripts/prove-mocklab-inbound-spine.sh"
SMOKE_SELF="$ROOT/deploy/scripts/smoke-mocklab-inbound-spine.sh"
EVIDENCE_DIR="$ROOT/artifacts/mocklab/lp-k5c4"
README="$EVIDENCE_DIR/README.md"
RESULT="$EVIDENCE_DIR/RESULT.md"
LATEST="$EVIDENCE_DIR/live-proof-evidence-latest.json"
PROBE="$EVIDENCE_DIR/run_live_probe.py"
TEST="$ROOT/portal/packages/bff/test/inbound-spine-evidence-pack.test.ts"
SPINE="$ROOT/portal/packages/bff/src/inbound-spine.ts"
HOLD="$ROOT/deploy/environments/platform-staging/OPERATOR-HOLD-LOCALHOST-ONLY.md"

err() { echo "[smoke-mocklab-inbound-spine] ERROR: $*" >&2; }
log() { echo "[smoke-mocklab-inbound-spine] $*"; }
fail() { err "$*"; exit 1; }
pass() { log "OK: $*"; }

require_file() {
  [[ -f "$1" ]] || fail "required file missing: $1"
}

require_file "$PROVE"
require_file "$SMOKE_SELF"
require_file "$README"
require_file "$RESULT"
require_file "$LATEST"
require_file "$PROBE"
require_file "$TEST"
require_file "$SPINE"
require_file "$HOLD"

bash -n "$PROVE" || fail "prove failed bash -n"
bash -n "$SMOKE_SELF" || fail "smoke failed bash -n"
python3 -m py_compile "$PROBE" || fail "probe py_compile"
pass "bash -n + probe compile"

grep -Eq 'lp-k5c4\.10' "$PROVE" "$README" "$RESULT" "$TEST" \
  || fail "lp-k5c4.10 must be named"
grep -Eq 'Does not terraform apply|does not terraform apply|No `terraform apply`' \
  "$PROVE" "$README" "$RESULT" \
  || fail "must forbid terraform apply"
grep -Eq 'HOLD|lifted' "$README" "$RESULT" \
  || fail "HOLD must be named"
grep -Eq 'spineEnabled' "$SPINE" "$RESULT" \
  || fail "spineEnabled must be named"
pass "docs name the bead + HOLD"

if grep -Eiq 'terraform apply|ecs update-service --desired-count' "$PROVE" "$PROBE"; then
  grep -Eq 'Does not terraform apply|does not terraform apply|Does not restage|does not restage' \
    "$PROVE" \
    || fail "prove mentions apply without a do-not"
fi
pass "no AWS restage"

python3 - "$LATEST" <<'PY'
import json, re, sys
from pathlib import Path
data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
if data.get("bead_id") != "lp-k5c4.10":
    raise SystemExit("bead_id")
if data.get("result") != "PASS":
    raise SystemExit("result")
hold = data.get("hold") or {}
if hold.get("terraform_apply") is not False or hold.get("restage") is not False:
    raise SystemExit("hold apply")
if hold.get("status") != "lifted_for_proof_only":
    raise SystemExit("hold status")
if (data.get("persist") or {}).get("chat_delivery") != "harness":
    raise SystemExit("persist")
if (data.get("persist") or {}).get("process_env_chat_delivery") != "relay":
    raise SystemExit("env harness global forbidden")
taste = data.get("taste") or {}
if int(taste.get("http_status") or 0) != 200:
    raise SystemExit("taste")
sse = taste.get("sse") or {}
if sse.get("outcome") not in {"completed", "stall_error"} or sse.get("hung") is True:
    raise SystemExit("sse hang")
toolbox = data.get("toolbox") or {}
if toolbox.get("path") == "cold_create":
    raise SystemExit("cold_create")
calls = (data.get("hop") or {}).get("deliverInbound_calls")
if calls is None or int(calls) != 0:
    raise SystemExit("deliverInbound")
checks = data.get("checks") or {}
for key in (
    "taste.http_200",
    "taste.sse_not_hang",
    "hop.deliverInbound_zero",
    "hold.no_terraform_apply",
    "hold.lifted_for_proof_only",
):
    if checks.get(key) is not True:
        raise SystemExit(f"check {key}")
blob = json.dumps(data)
if re.search(r"AKIA[0-9A-Z]{16}", blob) or "lanyard_session=" in blob:
    raise SystemExit("secrets")
print("evidence shape ok")
PY
pass "evidence JSON: PASS + HOLD + no secrets"

grep -Eq 'No secrets' "$README" || fail "README must say No secrets"
pass "README landing zone"

echo "smoke-mocklab-inbound-spine: PASS"
