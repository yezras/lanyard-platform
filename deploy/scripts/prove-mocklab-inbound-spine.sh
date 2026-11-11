#!/usr/bin/env bash
# lp-k5c4.10 — MockLab inbound-spine evidence pack.
#
# Offline vitest (enqueue, deliverInbound=0, start_from_stopped, stall
# watchdog) plus live Taste/toolbox/cron against the existing MockLab stack.
# Does not terraform apply. Does not restage. Does not print secrets.
#
# Usage (from monorepo root):
#   bash deploy/scripts/prove-mocklab-inbound-spine.sh
#
# Evidence:
#   artifacts/mocklab/lp-k5c4/live-proof-evidence-latest.json
#   artifacts/mocklab/lp-k5c4/RESULT.md
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EVIDENCE_DIR="${EVIDENCE_DIR:-$ROOT/artifacts/mocklab/lp-k5c4}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$EVIDENCE_DIR/prove-${STAMP}.log"
PROBE="$EVIDENCE_DIR/run_live_probe.py"

mkdir -p "$EVIDENCE_DIR"

err() { echo "[prove-mocklab-inbound-spine] ERROR: $*" >&2; }
log() { echo "[prove-mocklab-inbound-spine] $*"; }
fail() { err "$*"; exit 1; }
pass() { log "OK: $*"; }

exec > >(tee -a "$LOG") 2>&1

echo "== lp-k5c4.10 prove-mocklab-inbound-spine =="
echo "ROOT=$ROOT"
echo "STAMP=$STAMP"

if grep -Eq 'terraform apply|ecs update-service --desired-count' "$0"; then
  grep -Eq 'Does not terraform apply|does not terraform apply|Does not restage' "$0" \
    || fail "prove script mentions apply without a do-not"
fi
pass "prove does not apply AWS / restage"

resolve_vitest() {
  local c
  for c in \
    "$ROOT/portal/packages/bff/node_modules/.bin/vitest" \
    "$ROOT/portal/node_modules/.bin/vitest" \
    "${LANYARD_PLATFORM_CHECKOUT:-/home/operator/Lanyard-Dev/lanyard-platform}/portal/packages/bff/node_modules/.bin/vitest" \
    "${LANYARD_PLATFORM_CHECKOUT:-/home/operator/Lanyard-Dev/lanyard-platform}/portal/node_modules/.bin/vitest"
  do
    if [[ -x "$c" ]]; then
      echo "$c"
      return 0
    fi
  done
  if command -v vitest >/dev/null 2>&1; then
    command -v vitest
    return 0
  fi
  return 1
}

link_if_missing() {
  local dest="$1"
  local src="$2"
  if [[ -e "$dest" ]]; then
    return 0
  fi
  if [[ -e "$src" ]]; then
    log "linking $dest -> $src"
    ln -s "$src" "$dest"
  fi
}

ensure_portal_node_modules() {
  local donor="${LANYARD_PLATFORM_CHECKOUT:-/home/operator/Lanyard-Dev/lanyard-platform}/portal"
  link_if_missing "$ROOT/portal/node_modules" "$donor/node_modules" || true
  link_if_missing "$ROOT/portal/packages/bff/node_modules" "$donor/packages/bff/node_modules" || true
  link_if_missing "$ROOT/portal/packages/shared/node_modules" "$donor/packages/shared/node_modules" || true
}

ensure_portal_node_modules
VITEST="$(resolve_vitest)" || fail "vitest not found (pnpm install in portal/ or set LANYARD_PLATFORM_CHECKOUT)"

log "offline spine tests"
(
  cd "$ROOT/portal/packages/bff"
  "$VITEST" run \
    test/inbound-spine-evidence-pack.test.ts \
    test/chat-delivery-events.test.ts
)
pass "offline spine + evidence-pack tests"

[[ -f "$PROBE" ]] || fail "missing $PROBE"
python3 -m py_compile "$PROBE" || fail "probe failed py_compile"
pass "probe syntax"

if [[ "${SKIP_LIVE:-}" == "1" ]]; then
  log "SKIP_LIVE=1 — not hitting MockLab"
else
  log "live MockLab probe (existing stack)"
  python3 "$PROBE" || fail "live probe failed"
  pass "live probe"
fi

LATEST="$EVIDENCE_DIR/live-proof-evidence-latest.json"
[[ -f "$LATEST" ]] || fail "missing evidence $LATEST"

python3 - "$LATEST" <<'PY'
import json, re, sys
from pathlib import Path
data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
if data.get("bead_id") != "lp-k5c4.10":
    raise SystemExit("bead_id")
if data.get("result") != "PASS":
    raise SystemExit(f"result={data.get('result')}")
hold = data.get("hold") or {}
if hold.get("terraform_apply") is not False:
    raise SystemExit("hold.terraform_apply")
if hold.get("restage") is not False:
    raise SystemExit("hold.restage")
if hold.get("status") != "lifted_for_proof_only":
    raise SystemExit("hold.status")
persist = data.get("persist") or {}
if persist.get("chat_delivery") != "harness":
    raise SystemExit("persist")
if persist.get("process_env_chat_delivery") != "relay":
    raise SystemExit("process env must stay relay")
if persist.get("spine_enabled") is not True:
    raise SystemExit("spineEnabled")
taste = data.get("taste") or {}
if int(taste.get("http_status") or 0) != 200:
    raise SystemExit("taste http")
sse = taste.get("sse") or {}
if sse.get("hung") is True or sse.get("outcome") not in {"completed", "stall_error"}:
    raise SystemExit("taste sse hang")
toolbox = data.get("toolbox") or {}
path = toolbox.get("path")
if toolbox.get("sandbox_id_bound") and path == "cold_create":
    raise SystemExit("cold_create on bound sandbox")
if path not in {None, "start_from_stopped", "already_online", "warm_pool"}:
    raise SystemExit(f"toolbox path {path}")
if toolbox.get("cold_create") is True:
    raise SystemExit("cold_create")
hop = data.get("hop") or {}
calls = hop.get("deliverInbound_calls")
if calls is None or int(calls) != 0:
    raise SystemExit("deliverInbound")
checks = data.get("checks") or {}
for key in (
    "hold.no_terraform_apply",
    "persist.harness",
    "taste.http_200",
    "taste.sse_not_hang",
    "hop.deliverInbound_zero",
    "hold.lifted_for_proof_only",
):
    if checks.get(key) is not True:
        raise SystemExit(f"check {key}")
blob = json.dumps(data)
if re.search(r"AKIA[0-9A-Z]{16}", blob):
    raise SystemExit("aws key")
if "placeholder-harness-service-token" in blob:
    raise SystemExit("token leaked")
if re.search(r"lanyard_session=[A-Za-z0-9]{16,}", blob):
    raise SystemExit("session cookie")
print("evidence schema OK")
PY
pass "evidence JSON"

grep -Eq 'Does not terraform apply|No `terraform apply`|No terraform apply' \
  "$EVIDENCE_DIR/RESULT.md" "$EVIDENCE_DIR/README.md" \
  || fail "RESULT/README must say no terraform apply"
grep -Eq 'lp-k5c4\.10' "$EVIDENCE_DIR/RESULT.md" "$EVIDENCE_DIR/README.md" \
  || fail "must name lp-k5c4.10"

echo "prove-mocklab-inbound-spine: PASS"
