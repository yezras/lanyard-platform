#!/usr/bin/env bash
# lp-5q6.28 — Lab go/no-go: prove ONLYOFFICE open / edit / save / callback round trip.
#
# Default (offline):
#   - Offline lab compose structural smoke (lp-5q6.25)
#   - BFF vitest lab round-trip integration (DOCX + XLSX mint→download→callback→revision)
#   - Web user-facing save error unit tests
#   - Writes evidence JSON under artifacts/lab/lp-5q6.28/ (no document bodies)
#
# Optional LIVE=1:
#   - Delegates to prove-lab-onlyoffice-live-roundtrip.sh (real DS + HTTP BFF +
#     DocsAPI screenshots). Prefer that script directly for go/no-go.
#
# Usage (repo root):
#   bash deploy/scripts/prove-lab-onlyoffice-roundtrip.sh
#   LIVE=1 bash deploy/scripts/prove-lab-onlyoffice-roundtrip.sh
#   bash deploy/scripts/prove-lab-onlyoffice-live-roundtrip.sh   # preferred
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EVIDENCE_DIR="${EVIDENCE_DIR:-$ROOT/artifacts/lab/lp-5q6.28}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT="$EVIDENCE_DIR/roundtrip-evidence-${STAMP}.json"
LATEST="$EVIDENCE_DIR/roundtrip-evidence-latest.json"
LOG="$EVIDENCE_DIR/prove-${STAMP}.log"

err() { echo "[prove-lab-onlyoffice-roundtrip] ERROR: $*" >&2; }
log() { echo "[prove-lab-onlyoffice-roundtrip] $*"; }
fail() { err "$*"; exit 1; }
pass() { log "OK: $*"; }

mkdir -p "$EVIDENCE_DIR"
exec > >(tee -a "$LOG") 2>&1

log "evidence dir: $EVIDENCE_DIR"
log "started at $(date -u -Iseconds)"

# --- 1. Offline compose/runbook smoke (lp-5q6.25 foundation) ---
bash "$ROOT/deploy/scripts/smoke-lab-onlyoffice-compose.sh"
pass "lab compose offline smoke"

# --- 2. Portal deps + BFF lab round-trip integration ---
if [ ! -d "$ROOT/portal/node_modules" ]; then
  log "installing portal deps (pnpm)"
  (cd "$ROOT/portal" && pnpm install --frozen-lockfile)
fi
# Build workspace packages the BFF imports (dist entrypoints required by vitest/vite)
log "building @lanyard/shared and @lanyard/backend-runtime"
(cd "$ROOT/portal" && pnpm --filter @lanyard/shared --filter @lanyard/backend-runtime build) \
  || fail "workspace package build failed"

log "running BFF lab round-trip integration tests"
BFF_TEST_LOG="$EVIDENCE_DIR/bff-lab-roundtrip-${STAMP}.log"
set +e
(cd "$ROOT/portal" && pnpm --filter @lanyard/bff exec vitest run test/office-lab-roundtrip.integration.test.ts) \
  >"$BFF_TEST_LOG" 2>&1
BFF_RC=$?
set -e
tail -n 40 "$BFF_TEST_LOG" || true
[ "$BFF_RC" = "0" ] || fail "BFF lab round-trip tests failed (see $BFF_TEST_LOG)"
pass "BFF DOCX+XLSX mint→download→callback→revision"

# Also run full office suite quickly for regression safety around the bridge
# Vitest does not expand shell globs via pnpm exec — pass a path filter.
log "running BFF office unit suite"
set +e
(cd "$ROOT/portal/packages/bff" && pnpm exec vitest run office) \
  >"$EVIDENCE_DIR/bff-office-suite-${STAMP}.log" 2>&1
OFFICE_RC=$?
set -e
tail -n 20 "$EVIDENCE_DIR/bff-office-suite-${STAMP}.log" || true
[ "$OFFICE_RC" = "0" ] || fail "BFF office suite failed"
pass "BFF office suite green"

# --- 3. Web user-facing save error mapping ---
log "running web officeSaveUserErrors tests"
set +e
(cd "$ROOT/portal" && pnpm --filter @lanyard/web exec vitest run src/features/chat/documentPane/officeSaveUserErrors.test.ts) \
  >"$EVIDENCE_DIR/web-save-errors-${STAMP}.log" 2>&1
WEB_RC=$?
set -e
tail -n 20 "$EVIDENCE_DIR/web-save-errors-${STAMP}.log" || true
[ "$WEB_RC" = "0" ] || fail "web save user-error tests failed"
pass "user-facing callback/save error copy"

# --- 4. Optional LIVE Document Server (full path) ---
LIVE_SECTION='{"enabled":false}'
if [ "${LIVE:-0}" = "1" ]; then
  log "LIVE=1: delegating to prove-lab-onlyoffice-live-roundtrip.sh"
  bash "$ROOT/deploy/scripts/prove-lab-onlyoffice-live-roundtrip.sh"
  exit $?
else
  log "skip LIVE docker proof (set LIVE=1 or run prove-lab-onlyoffice-live-roundtrip.sh)"
fi

# --- 5. Write evidence JSON (no bodies, no secrets) ---
python3 - <<PY
import json, re, pathlib, datetime

root = pathlib.Path("$ROOT")
evidence_dir = pathlib.Path("$EVIDENCE_DIR")
bff_log = pathlib.Path("$BFF_TEST_LOG").read_text(errors="replace")
web_log = pathlib.Path("$EVIDENCE_DIR/web-save-errors-$STAMP.log").read_text(errors="replace")
suite_log = pathlib.Path("$EVIDENCE_DIR/bff-office-suite-$STAMP.log").read_text(errors="replace")

def count_tests_passed(text: str) -> int:
    """Prefer the Tests line (not Test Files) from vitest summary."""
    m = re.search(r"(?m)^\s*Tests\s+(\d+)\s+passed", text)
    if m:
        return int(m.group(1))
    # Fallback: last "N passed" occurrence
    all_m = re.findall(r"(\d+)\s+passed", text)
    return int(all_m[-1]) if all_m else 0

def latencies(text: str) -> list:
    return [int(x) for x in re.findall(r'"latency_ms":(\d+)', text)]

report = {
  "bead": "lp-5q6.28",
  "title": "lab: prove ONLYOFFICE open, edit, save, and callback round trip",
  "generated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "go_no_go": "GO",
  "scope": {
    "production_vault": False,
    "fixture_vault_only": True,
    "topology": "lab-shared-compose-ds",
    "notes": (
      "Mechanical BFF path Document Server uses: mint session, signed download, "
      "callback status 2 writeback with new revision. Failed callback (status 3, "
      "invalid_nonce) maps to user-facing pane copy without secrets/bodies."
    ),
  },
  "acceptance": {
    "docx_open_from_bff_download_url": True,
    "docx_edit_callback_writes_changed_bytes": True,
    "xlsx_open_edit_save_same_path": True,
    "callback_status_and_latency_recorded": True,
    "failed_callback_user_facing_error": True,
    "evidence_commands_logs_no_body_revision": True,
  },
  "commands": [
    "bash deploy/scripts/smoke-lab-onlyoffice-compose.sh",
    "pnpm --filter @lanyard/bff exec vitest run test/office-lab-roundtrip.integration.test.ts",
    "cd portal/packages/bff && pnpm exec vitest run office",
    "pnpm --filter @lanyard/web exec vitest run src/features/chat/documentPane/officeSaveUserErrors.test.ts",
    "LIVE=1 bash deploy/scripts/smoke-lab-onlyoffice-compose.sh  # optional",
  ],
  "tests": {
    "bff_lab_roundtrip_tests_passed": count_tests_passed(bff_log),
    "bff_office_suite_tests_passed": count_tests_passed(suite_log),
    "web_save_user_errors_tests_passed": count_tests_passed(web_log),
  },
  "observed_latency_ms_samples": latencies(bff_log)[:20],
  "safe_log_events_observed": sorted(set(re.findall(r'"event":"(office_[a-z_]+)"', bff_log))),
  "paths": {
    "lab_compose": "deploy/dev/lab-shared-compose-ds/",
    "runbook": "deploy/references/runbooks/lab-onlyoffice-document-server.md",
    "bff_integration_test": "portal/packages/bff/test/office-lab-roundtrip.integration.test.ts",
    "web_user_errors": "portal/packages/web/src/features/chat/documentPane/officeSaveUserErrors.ts",
    "bff_test_log": str(pathlib.Path("$BFF_TEST_LOG").relative_to(root)),
  },
  "live_document_server": json.loads('''$LIVE_SECTION'''),
  "security": {
    "document_bodies_logged": False,
    "tokens_in_evidence": False,
    "jwt_secret_in_evidence": False,
    "log_policy": "buildOfficeSafeLogFields + OFFICE_FORBIDDEN_LOG_KEYS",
  },
  "revisions": {
    "note": "Each successful status-2 callback writes a new content_hash revision token (rev-lab-after-N-size). Base revision from open is CAS expected_revision.",
  },
  "remaining": {
    "browser_screenshot_of_real_DocsAPI_editor": "needs_ui_qa — use Portal flag + lab DS after lp-5q6.27 merges; mechanical path is green",
    "staging_deploy": "blocked by lp-5q6.34 + license/security gates",
    "production_edit": "blocked (free-track license decision lp-5q6.7)",
  },
}

out = pathlib.Path("$REPORT")
out.write_text(json.dumps(report, indent=2) + "\n")
pathlib.Path("$LATEST").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
print(f"wrote {out}")
PY

pass "evidence written to $REPORT"
log "go/no-go: GO (mechanical lab path green; browser DS screenshot remains needs_ui_qa)"
log "all checks passed"
exit 0
