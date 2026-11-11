#!/usr/bin/env bash
# lp-hdzm.31 Mock Lab Stripe 6-tuple residual. Offline CP proof plus live
# /admin probe. Never prints Class C tokens. Not an auto-merge gate.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORTAL="$ROOT/portal"
cd "$ROOT"

EVIDENCE_DIR="$ROOT/artifacts/mocklab/lp-hdzm.31"

log() { echo "[lp-hdzm.31] $*"; }
fail() { echo "[lp-hdzm.31] ERROR: $*" >&2; exit 1; }

if [[ -z "${CONTROL_PLANE_DATABASE_URL:-}" && -z "${DATABASE_URL:-}" ]]; then
  export CONTROL_PLANE_DATABASE_URL="${CONTROL_PLANE_DATABASE_URL:-postgres://portal:portal@127.0.0.1:5432/portal_cp}"
  log "using local compose CONTROL_PLANE_DATABASE_URL"
fi

if [[ -n "${STRIPE_RESTRICTED_KEY:-}" ]]; then
  log "STRIPE_RESTRICTED_KEY is set (live Stripe GET /v1/customers)"
else
  log "STRIPE_RESTRICTED_KEY unset; proving against stub fetch"
fi

mkdir -p "$EVIDENCE_DIR"

log "vitest 6-tuple + residual"
(cd "$PORTAL" && pnpm --filter @lanyard/control-plane exec vitest run \
  test/mocklab-stripe-six-tuple.test.ts \
  test/mocklab-stripe-residual.test.ts \
  test/mocklab-stripe-residual.integration.test.ts)

log "write evidence"
(cd "$PORTAL" && pnpm --filter @lanyard/control-plane exec tsx \
  scripts/prove-mocklab-stripe-residual.ts)

[[ -f "$EVIDENCE_DIR/REPORT.json" ]] || fail "missing $EVIDENCE_DIR/REPORT.json"
[[ -f "$EVIDENCE_DIR/RESULT.md" ]] || fail "missing $EVIDENCE_DIR/RESULT.md"

python3 - "$EVIDENCE_DIR/REPORT.json" <<'PY'
import json, sys
path = sys.argv[1]
report = json.load(open(path))
blob = json.dumps(report)
for needle in ("sk_live_", "sk_test_lp_hdzm31", "Bearer sk_"):
    if needle in blob:
        raise SystemExit(f"evidence leaked secret marker {needle}")
if report.get("passed") is not True:
    raise SystemExit("REPORT.json passed is not true")
checks = report["evidence"]["checks"]
required = (
    "six_tuple",
    "one_surface",
    "cp_row",
    "tool_2xx",
    "no_token_on_sandbox",
    "rewake_no_prompt",
    "member_omit_fail_closed",
)
missing = [name for name in required if checks.get(name) is not True]
if missing:
    raise SystemExit(f"failed checks: {missing}")
print("evidence checks ok")
PY

log "OK evidence under artifacts/mocklab/lp-hdzm.31/"
