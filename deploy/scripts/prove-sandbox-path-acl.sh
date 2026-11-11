#!/usr/bin/env bash
# lp-uxy.6 — Prove cwd/project path ACL negatives + Omnibox Mode A wrap status.
#
# Offline-by-default. Never prints or commits secrets.
#
# Always runs (monorepo):
#   - deploy/scripts/omnibox/test-project-path-escape.py  (negative path ACL)
#   - deploy/scripts/omnibox/build-shell-exec-argv.py --self-test
#   - deploy/scripts/smoke-omnibox.sh
#
# Optional (when roots set / discoverable):
#   - LANYARD_AGENT_ROOT: agent-core tools-sandbox.test.ts (claimed LA backend)
#   - HERMES_LANYARD_ROOT: tests/agent/test_omnibox.py (HL product wrap)
#
# Usage (from monorepo root):
#   bash deploy/scripts/prove-sandbox-path-acl.sh
#   LANYARD_AGENT_ROOT=../lanyard-agent HERMES_LANYARD_ROOT=../hermes-lanyard \
#     bash deploy/scripts/prove-sandbox-path-acl.sh
#
# Evidence:
#   artifacts/security/lp-uxy.6/path-acl-evidence-<stamp>.json
#   artifacts/security/lp-uxy.6/path-acl-evidence-latest.json
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OMNIBOX_DIR="$ROOT/deploy/scripts/omnibox"
if [[ ! -d "$OMNIBOX_DIR" ]]; then
  ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  OMNIBOX_DIR="$ROOT/scripts/omnibox"
fi

EVIDENCE_DIR="${EVIDENCE_DIR:-$ROOT/artifacts/security/lp-uxy.6}"
mkdir -p "$EVIDENCE_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$EVIDENCE_DIR/prove-${STAMP}.log"
EVIDENCE_JSON="$EVIDENCE_DIR/path-acl-evidence-${STAMP}.json"
EVIDENCE_LATEST="$EVIDENCE_DIR/path-acl-evidence-latest.json"
CHECKS_JSON="$EVIDENCE_DIR/checks-${STAMP}.json"

LANYARD_AGENT_ROOT="${LANYARD_AGENT_ROOT:-}"
HERMES_LANYARD_ROOT="${HERMES_LANYARD_ROOT:-}"

if [[ -z "$LANYARD_AGENT_ROOT" ]]; then
  for cand in \
    "$ROOT/../lanyard-agent" \
    "${HOME:-}/Lanyard-Dev/lanyard-agent" \
    "/home/operator/Lanyard-Dev/lanyard-agent"; do
    if [[ -d "$cand/packages/agent-core" ]]; then
      LANYARD_AGENT_ROOT="$cand"
      break
    fi
  done
fi
if [[ -z "$HERMES_LANYARD_ROOT" ]]; then
  for cand in \
    "$ROOT/../hermes-lanyard" \
    "${HOME:-}/Lanyard-Dev/hermes-lanyard" \
    "/home/operator/Lanyard-Dev/hermes-lanyard"; do
    if [[ -f "$cand/agent/omnibox.py" ]]; then
      HERMES_LANYARD_ROOT="$cand"
      break
    fi
  done
fi

exec > >(tee -a "$LOG") 2>&1

echo "== lp-uxy.6 prove-sandbox-path-acl =="
echo "ROOT=$ROOT"
echo "STAMP=$STAMP"
echo "LANYARD_AGENT_ROOT=${LANYARD_AGENT_ROOT:-<none>}"
echo "HERMES_LANYARD_ROOT=${HERMES_LANYARD_ROOT:-<none>}"

FAILED=0
pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*" >&2; FAILED=1; }

# Accumulate checks as lines: key|provenance|detail
CHECKS_LINES=()
NOTES=()
add_check() {
  local key="$1" prov="$2" detail="${3:-}"
  CHECKS_LINES+=("${key}|${prov}|${detail}")
  pass "$key ($prov)${detail:+ — $detail}"
}

PATH_TEST="$OMNIBOX_DIR/test-project-path-escape.py"
ARGV_BUILDER="$OMNIBOX_DIR/build-shell-exec-argv.py"
SMOKE_OMNIBOX="$ROOT/deploy/scripts/smoke-omnibox.sh"
[[ -f "$SMOKE_OMNIBOX" ]] || SMOKE_OMNIBOX="$ROOT/scripts/smoke-omnibox.sh"

# --- 1. Monorepo project path-escape negative suite ---
if [[ ! -f "$PATH_TEST" ]]; then
  fail "missing $PATH_TEST"
else
  path_json="$EVIDENCE_DIR/path-escape-unit-${STAMP}.json"
  if python3 "$PATH_TEST" --json >"$path_json"; then
    add_check "path_escape.project_negative" unit "test-project-path-escape.py"
  else
    fail "project path-escape negative suite failed (see $path_json)"
    NOTES+=("path-escape unit failed")
  fi
fi

# --- 2. Omnibox argv builder ---
if [[ -f "$ARGV_BUILDER" ]]; then
  if python3 "$ARGV_BUILDER" --self-test; then
    add_check "omnibox.argv_builder_self_test" unit "build-shell-exec-argv.py"
  else
    fail "argv builder self-test failed"
  fi
else
  fail "missing argv builder"
fi

# --- 3. Omnibox offline smoke ---
if [[ -f "$SMOKE_OMNIBOX" ]]; then
  if bash "$SMOKE_OMNIBOX"; then
    add_check "omnibox.smoke_mode_a" unit "smoke-omnibox.sh"
  else
    fail "smoke-omnibox.sh failed"
  fi
else
  fail "missing smoke-omnibox.sh"
fi

# --- 4. Optional LA tools-sandbox (claimed backend) ---
LA_SHA=""
if [[ -n "${LANYARD_AGENT_ROOT:-}" && -d "$LANYARD_AGENT_ROOT/packages/agent-core" ]]; then
  LA_SHA="$(git -C "$LANYARD_AGENT_ROOT" rev-parse HEAD 2>/dev/null || true)"
  SB_LOG="$EVIDENCE_DIR/la-tools-sandbox-${STAMP}.log"
  SB_CWD="$LANYARD_AGENT_ROOT/packages/agent-core"
  set +e
  (cd "$SB_CWD" && pnpm exec vitest run test/tools-sandbox.test.ts) >"$SB_LOG" 2>&1
  SB_RC=$?
  set -e
  if [[ $SB_RC -eq 0 ]]; then
    add_check "host.sandbox_enforced.la_tools_sandbox" unit "tools-sandbox.test.ts sha=$LA_SHA"
  else
    fail "LA tools-sandbox failed (rc=$SB_RC) — see $SB_LOG"
    NOTES+=("LA tools-sandbox failed")
  fi
else
  NOTES+=("LANYARD_AGENT_ROOT not set/found — skipped claimed LA tools-sandbox")
fi

# --- 5. Optional HL omnibox unit suite ---
HL_SHA=""
HL_OMNIBOX_SHA=""
if [[ -n "${HERMES_LANYARD_ROOT:-}" && -f "$HERMES_LANYARD_ROOT/agent/omnibox.py" ]]; then
  HL_SHA="$(git -C "$HERMES_LANYARD_ROOT" rev-parse HEAD 2>/dev/null || true)"
  HL_OMNIBOX_SHA="$(git -C "$HERMES_LANYARD_ROOT" log -1 --format=%H -- agent/omnibox.py 2>/dev/null || true)"
  HL_LOG="$EVIDENCE_DIR/hl-omnibox-${STAMP}.log"
  set +e
  (cd "$HERMES_LANYARD_ROOT" && python3 -m pytest tests/agent/test_omnibox.py -q) >"$HL_LOG" 2>&1
  HL_RC=$?
  set -e
  if [[ $HL_RC -eq 0 ]]; then
    add_check "omnibox.hl_product_wrap_unit" unit "test_omnibox.py sha=$HL_SHA wrap_file=$HL_OMNIBOX_SHA"
  else
    fail "HL omnibox unit failed (rc=$HL_RC) — see $HL_LOG"
    NOTES+=("HL omnibox unit failed")
  fi
else
  NOTES+=("HERMES_LANYARD_ROOT not set/found — skipped HL omnibox unit")
fi

# --- Report residual honesty ---
REPORT="$ROOT/docs/security/lp-uxy.6-agent-sandbox-path-acl-omnibox.md"
if [[ -f "$REPORT" ]]; then
  grep -q 'ESCAPABLE' "$REPORT" || fail "report must document ESCAPABLE residuals"
  grep -qi 'lp-kng' "$REPORT" || fail "report must link lp-kng for VM isolation"
  grep -qi 'OMNIBOX' "$REPORT" || fail "report must discuss Omnibox"
  add_check "docs.sandbox_report_present" unit "lp-uxy.6 report"
else
  fail "missing security report $REPORT"
fi

HOOK="$ROOT/deploy/references/omnibox-mode-a-hermes-hook.md"
[[ -f "$HOOK" ]] || HOOK="$ROOT/references/omnibox-mode-a-hermes-hook.md"
if [[ -f "$HOOK" ]]; then
  if grep -Eqi 'cbd-o9s\.17|product wrap landed|hermes-lanyard' "$HOOK" \
    && grep -Eqi 'residual|default OFF|OMNIBOX_ENABLED=0' "$HOOK"; then
    add_check "docs.omnibox_hook_residual_honest" unit "omnibox-mode-a-hermes-hook.md"
  else
    fail "hook doc must state product wrap status and residual honestly"
  fi
else
  fail "missing omnibox hook contract doc"
fi

# --- Write checks sidecar + evidence via Python ---
export STAMP FAILED EVIDENCE_JSON EVIDENCE_LATEST CHECKS_JSON LOG
export LA_SHA HL_SHA HL_OMNIBOX_SHA
printf '%s\n' "${CHECKS_LINES[@]+"${CHECKS_LINES[@]}"}" >"$EVIDENCE_DIR/checks-lines-${STAMP}.txt"
printf '%s\n' "${NOTES[@]+"${NOTES[@]}"}" >"$EVIDENCE_DIR/notes-${STAMP}.txt"

python3 - <<'PY'
import json
import os
from datetime import datetime, timezone

stamp = os.environ["STAMP"]
failed = os.environ["FAILED"]
evidence_json = os.environ["EVIDENCE_JSON"]
evidence_latest = os.environ["EVIDENCE_LATEST"]
checks_json = os.environ["CHECKS_JSON"]
evidence_dir = os.path.dirname(evidence_json)
log_name = os.path.basename(os.environ.get("LOG", f"prove-{stamp}.log"))

checks = {}
provenance = {}
lines_path = os.path.join(evidence_dir, f"checks-lines-{stamp}.txt")
if os.path.isfile(lines_path):
    with open(lines_path, encoding="utf-8") as f:
        for raw in f:
            raw = raw.strip()
            if not raw:
                continue
            parts = raw.split("|", 2)
            if len(parts) < 2:
                continue
            key, prov = parts[0], parts[1]
            detail = parts[2] if len(parts) > 2 else ""
            checks[key] = True
            provenance[key] = prov if not detail else f"{prov}:{detail}"

notes = []
notes_path = os.path.join(evidence_dir, f"notes-{stamp}.txt")
if os.path.isfile(notes_path):
    with open(notes_path, encoding="utf-8") as f:
        notes = [ln.strip() for ln in f if ln.strip()]

la_sha = os.environ.get("LA_SHA") or None
hl_sha = os.environ.get("HL_SHA") or None
hl_omnibox_sha = os.environ.get("HL_OMNIBOX_SHA") or None
if la_sha == "":
    la_sha = None
if hl_sha == "":
    hl_sha = None
if hl_omnibox_sha == "":
    hl_omnibox_sha = None

sidecar = {
    "checks": checks,
    "provenance": provenance,
    "notes": notes,
    "la_sha": la_sha,
    "hl_sha": hl_sha,
    "hl_omnibox_sha": hl_omnibox_sha,
}
with open(checks_json, "w", encoding="utf-8") as f:
    json.dump(sidecar, f, indent=2, sort_keys=True)
    f.write("\n")

required = [
    "path_escape.project_negative",
    "omnibox.argv_builder_self_test",
    "omnibox.smoke_mode_a",
    "docs.sandbox_report_present",
    "docs.omnibox_hook_residual_honest",
]
all_required = all(checks.get(k) is True for k in required)
go = all_required and failed == "0"

doc = {
    "bead_id": "lp-uxy.6",
    "title": "Agent sandbox cwd path ACL proof + Omnibox Mode A wrap status",
    "timestamp_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "stamp": stamp,
    "joint_go": "GO" if go else "NO-GO",
    "checks": checks,
    "check_provenance": provenance,
    "required_checks": required,
    "optional_checks": [
        "host.sandbox_enforced.la_tools_sandbox",
        "omnibox.hl_product_wrap_unit",
    ],
    "pins": {
        "lanyard_agent_sha": la_sha,
        "hermes_lanyard_sha": hl_sha,
        "hermes_lanyard_omnibox_file_sha": hl_omnibox_sha,
    },
    "report": "docs/security/lp-uxy.6-agent-sandbox-path-acl-omnibox.md",
    "residuals": [
        "LA bash absolute-path / .. escape when shell tool available",
        "Omnibox Mode A default OMNIBOX_ENABLED=0 on host",
        "LA has no Omnibox product wrap",
        "Shared-kernel residual (bubblewrap) — see lp-kng for VM isolation",
        "Admin shell_exec blast radius",
    ],
    "non_claims": [
        "Not AWS staging Omnibox live table (lp-t7q.6)",
        "Not production pen-test / security sign-off",
        "Not Daytona multi-tenant isolation",
        "No secrets in evidence",
    ],
    "notes": notes,
    "failed": failed != "0",
    "log": log_name,
}
with open(evidence_json, "w", encoding="utf-8") as f:
    json.dump(doc, f, indent=2, sort_keys=True)
    f.write("\n")
with open(evidence_latest, "w", encoding="utf-8") as f:
    json.dump(doc, f, indent=2, sort_keys=True)
    f.write("\n")
print(f"Wrote {evidence_json}")
print(f"joint_go={doc['joint_go']}")
raise SystemExit(0 if go else 1)
PY
