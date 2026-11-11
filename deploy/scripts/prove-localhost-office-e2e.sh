#!/usr/bin/env bash
# lp-5q6.38 — Localhost mocklab product chain go/no-go.
#
#   chat → agent write → pane refresh → human ONLYOFFICE save (through lab DS)
#   → vault reopen proves vault bytes (not DS cache)
#
# FULL PRODUCT GO requires LIVE lab Document Server + DocsAPI through-DS forcesave.
# Offline BFF/web tests alone are residual and insufficient for merge GO.
#
# Environment of record: localhost (mocklab-on-local + lab-shared-compose-ds).
# Does NOT authorize AWS staging or production customer Office edit.
#
# Usage (repo root):
#   bash deploy/scripts/prove-localhost-office-e2e.sh
#   REQUIRE_LIVE=1 bash deploy/scripts/prove-localhost-office-e2e.sh   # default
#   REQUIRE_LIVE=0 bash deploy/scripts/prove-localhost-office-e2e.sh   # offline only
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EVIDENCE_DIR="${EVIDENCE_DIR:-$ROOT/artifacts/localhost/lp-5q6.38}"
SHOT_DIR="$EVIDENCE_DIR/screenshots"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$EVIDENCE_DIR/prove-${STAMP}.log"
PORT="${LAB_BFF_PORT:-4100}"
DS_PORT="${DS_HOST_PORT:-8080}"
DS_URL="${LAB_DS_URL:-http://127.0.0.1:${DS_PORT}}"
PUBLIC_BASE="${LAB_BFF_PUBLIC_BASE:-http://host.docker.internal:${PORT}}"
JWT_SECRET="${BFF_OFFICE_JWT_SECRET:-lab-jwt-secret-placeholder}"
BFF_URL="http://127.0.0.1:${PORT}"
REQUIRE_LIVE="${REQUIRE_LIVE:-1}"
SERVER_PID=""
VITE_PID=""

err() { echo "[prove-localhost-office-e2e] ERROR: $*" >&2; }
log() { echo "[prove-localhost-office-e2e] $*"; }
fail() { err "$*"; exit 1; }
pass() { log "OK: $*"; }

# BFF mints DS-reachable URLs (host.docker.internal). Host curl needs loopback.
host_reachable_url() {
  python3 -c 'import sys; print(sys.argv[1].replace("host.docker.internal", "127.0.0.1"))' "$1"
}

cleanup() {
  if [ -n "${VITE_PID}" ] && kill -0 "$VITE_PID" 2>/dev/null; then
    kill "$VITE_PID" 2>/dev/null || true
    wait "$VITE_PID" 2>/dev/null || true
  fi
  if [ -n "${SERVER_PID}" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

mkdir -p "$EVIDENCE_DIR" "$SHOT_DIR"
exec > >(tee -a "$LOG") 2>&1

log "started $(date -u -Iseconds)"
log "evidence=$EVIDENCE_DIR port=$PORT ds=$DS_URL require_live=$REQUIRE_LIVE"

# --- 0. Portal deps ---
if [ ! -d "$ROOT/portal/node_modules" ]; then
  (cd "$ROOT/portal" && pnpm install --frozen-lockfile)
fi
(cd "$ROOT/portal" && pnpm --filter @lanyard/shared --filter @lanyard/backend-runtime build) || true

# --- 1. Offline BFF vault-proven chain (document_key rotation asserted in test) ---
log "offline BFF vault-proven chain"
(cd "$ROOT/portal/packages/bff" && pnpm exec vitest run test/office-localhost-e2e-chain.integration.test.ts) \
  >"$EVIDENCE_DIR/offline-bff-${STAMP}.log" 2>&1 \
  || { tail -n 80 "$EVIDENCE_DIR/offline-bff-${STAMP}.log" || true; fail "offline BFF chain failed"; }
pass "BFF agent→human-save→vault-reopen chain (offline; document_key rotates)"

# --- 2. Offline web pane artifact refresh ---
log "offline web pane openGeneration refresh"
(cd "$ROOT/portal/packages/web" && pnpm exec vitest run src/features/chat/documentPane/localhostE2eChain.test.ts) \
  >"$EVIDENCE_DIR/offline-web-${STAMP}.log" 2>&1 \
  || { tail -n 80 "$EVIDENCE_DIR/offline-web-${STAMP}.log" || true; fail "offline web pane chain failed"; }
pass "web pane agent write → open/refresh (offline)"

# --- 3. Lab compose smoke (structure + optional LIVE up) ---
LIVE_COMPOSE=0
if curl -fsS --connect-timeout 2 "$DS_URL/healthcheck" 2>/dev/null | grep -qiE 'true|ok'; then
  LIVE_COMPOSE=1
  pass "Document Server already healthy at $DS_URL"
else
  log "DS not up — attempting lab compose (LIVE=1)"
  if LIVE=1 bash "$ROOT/deploy/scripts/smoke-lab-onlyoffice-compose.sh" \
    >"$EVIDENCE_DIR/compose-${STAMP}.log" 2>&1; then
    LIVE_COMPOSE=1
    pass "lab compose Document Server up"
  else
    log "WARN: could not start Document Server (see compose log)"
    tail -n 40 "$EVIDENCE_DIR/compose-${STAMP}.log" || true
  fi
fi

LIVE_STATUS="not_run"
LIVE_AGENT=false
LIVE_DL=false
LIVE_CB=false
LIVE_THROUGH_DS=false
LIVE_REOPEN=false
LIVE_DOCSAPI=false
LIVE_KEY_ROTATE=false
LIVE_HUMAN_SHA=""
LIVE_AGENT_SHA=""
LIVE_REOPEN_SHA=""
LIVE_DOC_KEY1_PREFIX=""
LIVE_DOC_KEY2_PREFIX=""
LIVE_REVISION_TOKEN=""
LIVE_SESSION_PREFIX=""
LIVE_ASSEMBLED_HOST=""
LIVE_REQUEST_IDS='[]'
STORY_OK=false

if [ "$LIVE_COMPOSE" = "1" ]; then
  API_BYTES="$(curl -fsS --connect-timeout 5 "$DS_URL/web-apps/apps/api/documents/api.js" | wc -c | tr -d ' ')"
  [ "${API_BYTES:-0}" -gt 1000 ] || fail "api.js too small ($API_BYTES)"
  pass "Document Server api.js ($API_BYTES bytes)"

  if docker exec lab-onlyoffice-ds getent hosts host.docker.internal >/dev/null 2>&1 \
    || docker exec lab-onlyoffice-ds ping -c1 -W1 host.docker.internal >/dev/null 2>&1; then
    pass "DS resolves host.docker.internal"
  else
    fail "DS cannot resolve host.docker.internal (required for BFF download)"
  fi

  export LAB_BFF_PORT="$PORT"
  export LAB_DS_URL="$DS_URL"
  export LAB_BFF_PUBLIC_BASE="$PUBLIC_BASE"
  export BFF_OFFICE_JWT_SECRET="$JWT_SECRET"
  export BFF_OFFICE_PUBLIC_BASE_URL="$PUBLIC_BASE"
  export BFF_OFFICE_DOCUMENT_SERVER_HOSTS="127.0.0.1,localhost,lab-onlyoffice-ds,onlyoffice,host.docker.internal,documentserver"

  log "starting live lab BFF on :$PORT"
  (cd "$ROOT/portal/packages/bff" && pnpm exec tsx scripts/lab-onlyoffice-live-server.mts) \
    >"$EVIDENCE_DIR/live-bff-${STAMP}.log" 2>&1 &
  SERVER_PID=$!

  for i in $(seq 1 60); do
    if curl -fsS --connect-timeout 1 "$BFF_URL/lab/health" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      tail -n 80 "$EVIDENCE_DIR/live-bff-${STAMP}.log" || true
      fail "lab BFF exited early"
    fi
    sleep 0.5
  done
  curl -fsS "$BFF_URL/lab/health" >/dev/null || fail "lab BFF health failed"
  pass "lab BFF healthy"

  # --- 5a. Agent fixture write (real OOXML seed) ---
  AGENT_JSON="$(curl -fsS -X POST "$BFF_URL/lab/e2e/agent-write" -H 'content-type: application/json' -d '{}')"
  echo "$AGENT_JSON" | python3 -c 'import sys,json; d=json.load(sys.stdin); assert d.get("ok") is True, d; print("agent", d["sha256_prefix"], d["size_bytes"])' \
    || fail "agent-write failed: $AGENT_JSON"
  LIVE_AGENT_SHA="$(echo "$AGENT_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["sha256_prefix"])')"
  LIVE_AGENT=true
  pass "agent fixture write on e2e-proof.docx (sha_prefix=$LIVE_AGENT_SHA)"

  # --- 5b. View mint for pre-save document_key (content-hash revision) ---
  MINT_VIEW1="$(curl -fsS -X POST "$BFF_URL/lab/mint" \
    -H 'content-type: application/json' \
    -d '{"path":"/Projects/Lab/e2e-proof.docx","mode":"view"}')"
  python3 -c 'import sys,json; d=json.load(sys.stdin); assert d["http_status"] in (200,201), d' <<<"$MINT_VIEW1" \
    || fail "view mint1 failed: $MINT_VIEW1"
  DOC_KEY1="$(echo "$MINT_VIEW1" | python3 -c 'import sys,json; print(json.load(sys.stdin)["body"]["document_key"])')"
  LIVE_DOC_KEY1_PREFIX="$(python3 -c 'k="'"$DOC_KEY1"'"; print(k[:16]+"…" if len(k)>16 else k)')"
  LIVE_SESSION_PREFIX="$(echo "$MINT_VIEW1" | python3 -c 'import sys,json; s=json.load(sys.stdin)["body"]["session_id"]; print(s[:12]+"…" if len(s)>12 else s)')"
  LIVE_REQUEST_IDS='["localhost-e2e-live-mint","localhost-e2e-through-ds-forcesave","localhost-e2e-live-reopen"]'

  # Edit mint for DS container download proof (unique edit key)
  MINT_JSON="$(curl -fsS -X POST "$BFF_URL/lab/mint" \
    -H 'content-type: application/json' \
    -d '{"path":"/Projects/Lab/e2e-proof.docx","mode":"edit"}')"
  python3 -c 'import sys,json; d=json.load(sys.stdin); assert d["http_status"] in (200,201), d' <<<"$MINT_JSON" \
    || fail "edit mint failed: $MINT_JSON"
  DOWNLOAD_URL="$(echo "$MINT_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["body"]["editor_config"]["document"]["url"])')"

  # --- 5c. DS container downloads agent vault bytes (real network boundary) ---
  DL_BYTES="$(docker exec lab-onlyoffice-ds curl -fsS --connect-timeout 5 -o /tmp/lab-e2e.docx -w '%{http_code}:%{size_download}' "$DOWNLOAD_URL" || echo 'fail:0')"
  echo "$DL_BYTES" | grep -q '^200:' || fail "DS container download failed: $DL_BYTES"
  DL_SIZE="$(echo "$DL_BYTES" | cut -d: -f2)"
  [ "${DL_SIZE:-0}" -gt 100 ] || fail "DS download too small: $DL_SIZE"
  LIVE_DL=true
  pass "DS container opened e2e DOCX from BFF signed download ($DL_SIZE bytes)"

  # --- 5d. Through-DS human save (Playwright DocsAPI + Command Service forcesave) ---
  # HARD REQUIREMENT: must not use synthetic curl status-2 with /lab/fixtures/human-edited.docx
  PW_VENV="${PW_VENV:-/tmp/.venv-pw-lp5q638}"
  if [ ! -x "$PW_VENV/bin/pytest" ]; then
    python3 -m venv "$PW_VENV"
    "$PW_VENV/bin/pip" install -q -U pip
    "$PW_VENV/bin/pip" install -q playwright pytest pytest-playwright pyyaml
    "$PW_VENV/bin/playwright" install chromium >/dev/null 2>&1 || true
  fi

  export LAB_BFF_URL="$BFF_URL"
  export LAB_DS_URL="$DS_URL"
  export UI_ARTIFACTS="$SHOT_DIR"
  # Unset BASE_URL so story tests skip; through-DS test still runs
  unset BASE_URL || true

  set +e
  (
    cd "$ROOT/portal/packages/web/ui-testing"
    "$PW_VENV/bin/pytest" -v test_localhost_office_e2e.py::test_through_ds_human_save_forcesave \
      \
      --output "$SHOT_DIR/pytest-through-ds-out"
  ) >"$EVIDENCE_DIR/playwright-through-ds-${STAMP}.log" 2>&1
  PW_RC=$?
  set -e
  tail -n 60 "$EVIDENCE_DIR/playwright-through-ds-${STAMP}.log" || true

  if [ "$PW_RC" != "0" ]; then
    # Also capture classic DocsAPI open residual for debugging (non-blocking)
    log "through-DS Playwright failed (rc=$PW_RC)"
    LIVE_STATUS="failed"
  else
    LIVE_DOCSAPI=true
    pass "Playwright through-DS human save (DocsAPI + forcesave)"

    # Parse save-callback-evidence.json (must exist and assert through DS)
    SAVE_EV="$SHOT_DIR/save-callback-evidence.json"
    [ -f "$SAVE_EV" ] || fail "missing $SAVE_EV"
    python3 - <<PY
import json, sys
from pathlib import Path
p = Path("$SAVE_EV")
d = json.loads(p.read_text())
assert d.get("write_observed") is True, d
assert d.get("through_document_server") is True, d
assert d.get("assembled_fetch_source") == "document_server", d
assert "/lab/fixtures/" not in str(d.get("assembled_pathname_prefix") or ""), d
assert d.get("vault_differs_from_agent") is True, d
# no full JWT / session tokens
text = p.read_text()
assert "eyJ" not in text, "JWT leaked into save-callback-evidence"
assert "nonce=" not in text
print("through_ds_ok", d.get("vault_sha256_prefix"), d.get("assembled_fetch_host"))
PY
    LIVE_CB=true
    LIVE_THROUGH_DS=true
    # Prefer durable vault state from live BFF (forcesave may be followed by status-2)
    EV_JSON="$(curl -fsS "$BFF_URL/lab/evidence")"
    LIVE_HUMAN_SHA="$(echo "$EV_JSON" | python3 -c 'import sys,json; e=json.load(sys.stdin).get("e2e") or {}; print(e.get("vault_sha256_prefix") or "")')"
    if [ -z "$LIVE_HUMAN_SHA" ]; then
      LIVE_HUMAN_SHA="$(python3 -c 'import json; print(json.load(open("'"$SAVE_EV"'"))["vault_sha256_prefix"])')"
    fi
    LIVE_ASSEMBLED_HOST="$(python3 -c 'import json; print(json.load(open("'"$SAVE_EV"'")).get("assembled_fetch_host") or "")')"
    LIVE_REVISION_TOKEN="$(echo "$EV_JSON" | python3 -c 'import sys,json; ws=json.load(sys.stdin).get("writes") or []; print(ws[-1]["revision_token"] if ws else "")')"
    echo "$EV_JSON" | python3 -c 'import sys,json; e=json.load(sys.stdin).get("e2e") or {}; assert e.get("vault_differs_from_agent") is True, e'
    pass "human through-DS save wrote vault (sha_prefix=$LIVE_HUMAN_SHA host=$LIVE_ASSEMBLED_HOST)"
  fi

  # Classic DOCX/XLSX open screenshots (roundtrip fixtures) — supplementary
  set +e
  (
    cd "$ROOT/portal/packages/web/ui-testing"
    export UI_ARTIFACTS="$SHOT_DIR"
    "$PW_VENV/bin/pytest" -v \
      test_onlyoffice_live_roundtrip.py::test_docx_opens_in_editor_from_bff_download \
      test_onlyoffice_live_roundtrip.py::test_xlsx_opens_in_editor_from_bff_download \
      \
      --output "$SHOT_DIR/pytest-open-out"
  ) >"$EVIDENCE_DIR/playwright-open-${STAMP}.log" 2>&1
  set -e
  if [ -f "$SHOT_DIR/xlsx-editor-open.png" ]; then
    pass "supplementary DocsAPI open screenshots (docx/xlsx roundtrip)"
  fi

  if [ "$LIVE_THROUGH_DS" = "true" ]; then
    # --- 5e. document_key rotation + vault reopen (not DS cache) ---
    # Re-mint after human save: content-hash revision changed → new document_key
    MINT2="$(curl -fsS -X POST "$BFF_URL/lab/mint" \
      -H 'content-type: application/json' \
      -d '{"path":"/Projects/Lab/e2e-proof.docx","mode":"view"}')"
    DOC_KEY2="$(echo "$MINT2" | python3 -c 'import sys,json; print(json.load(sys.stdin)["body"]["document_key"])')"
    LIVE_DOC_KEY2_PREFIX="$(echo "$DOC_KEY2" | python3 -c 'import sys; k=sys.stdin.read().strip(); print(k[:16]+"…" if len(k)>16 else k)')"
    python3 - <<PY
k1 = """$DOC_KEY1"""
k2 = """$DOC_KEY2"""
assert k1 and k2 and k1 != k2, (k1[:20], k2[:20], "document_key must rotate after human save")
print("document_key_rotated", k1[:16]+"…", "→", k2[:16]+"…")
PY
    LIVE_KEY_ROTATE=true
    pass "document_key rotated after human save ($LIVE_DOC_KEY1_PREFIX → $LIVE_DOC_KEY2_PREFIX)"

    DL2_URL="$(echo "$MINT2" | python3 -c 'import sys,json; print(json.load(sys.stdin)["body"]["editor_config"]["document"]["url"])')"
    DL2_URL_HOST="$(host_reachable_url "$DL2_URL")"
    # Host-side vault download — never log full tokenized URL
    DL2_CODE_SIZE="$(curl -fsS --connect-timeout 5 -o "$EVIDENCE_DIR/reopen-download.bin" -w '%{http_code}:%{size_download}' "$DL2_URL_HOST" || echo 'fail:0')"
    echo "$DL2_CODE_SIZE" | grep -q '^200:' || fail "reopen download failed: $DL2_CODE_SIZE"
    LIVE_REOPEN_SHA="$(python3 - <<'PY'
import hashlib, pathlib
p = pathlib.Path("'"$EVIDENCE_DIR"'") / "reopen-download.bin"
print(hashlib.sha256(p.read_bytes()).hexdigest()[:16])
PY
)"
    python3 - <<PY
assert """$LIVE_REOPEN_SHA""" == """$LIVE_HUMAN_SHA""", (
    "reopen sha must equal human vault sha",
    """$LIVE_REOPEN_SHA""",
    """$LIVE_HUMAN_SHA""",
)
assert """$LIVE_REOPEN_SHA""" != """$LIVE_AGENT_SHA""", "reopen must not be agent seed"
print("reopen_ok", """$LIVE_REOPEN_SHA""")
PY
    # Extra: vault is source of truth — overwrite vault, download must follow vault not DS
    curl -fsS -X POST "$BFF_URL/lab/e2e/agent-write" -H 'content-type: application/json' -d '{}' >/dev/null
    # After agent-write, vault is agent again; re-mint and download must be agent seed (proves vault source)
    MINT3="$(curl -fsS -X POST "$BFF_URL/lab/mint" \
      -H 'content-type: application/json' \
      -d '{"path":"/Projects/Lab/e2e-proof.docx","mode":"view"}')"
    DL3_URL="$(echo "$MINT3" | python3 -c 'import sys,json; print(json.load(sys.stdin)["body"]["editor_config"]["document"]["url"])')"
    DL3_URL_HOST="$(host_reachable_url "$DL3_URL")"
    curl -fsS --connect-timeout 5 -o "$EVIDENCE_DIR/vault-source.bin" "$DL3_URL_HOST" >/dev/null
    python3 - <<PY
import hashlib, pathlib
sha = hashlib.sha256((pathlib.Path("'"$EVIDENCE_DIR"'")/"vault-source.bin").read_bytes()).hexdigest()[:16]
assert sha == """$LIVE_AGENT_SHA""", (sha, """$LIVE_AGENT_SHA""", "download must track vault after overwrite")
print("vault_source_ok", sha)
PY
    rm -f "$EVIDENCE_DIR/reopen-download.bin" "$EVIDENCE_DIR/vault-source.bin"
    LIVE_REOPEN=true
    pass "reopen download serves vault bytes (sha==human); vault overwrite proves vault source not DS cache"

    LIVE_STATUS="passed"
  fi
fi

# --- 6. Story screenshots (optional Vite) ---
STORY_PORT="${STORY_PORT:-3027}"
if [ -d "$ROOT/portal/packages/web/node_modules" ] || [ -d "$ROOT/portal/node_modules" ]; then
  log "starting Vite story host on :$STORY_PORT"
  (cd "$ROOT/portal/packages/web" && pnpm exec vite --port "$STORY_PORT" --host 127.0.0.1 --strictPort) \
    >"$EVIDENCE_DIR/vite-story-${STAMP}.log" 2>&1 &
  VITE_PID=$!
  for i in $(seq 1 40); do
    if curl -fsS --connect-timeout 1 "http://127.0.0.1:${STORY_PORT}/" >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done
  if curl -fsS --connect-timeout 1 "http://127.0.0.1:${STORY_PORT}/" >/dev/null 2>&1; then
    PW_VENV="${PW_VENV:-/tmp/.venv-pw-lp5q638}"
    if [ ! -x "$PW_VENV/bin/pytest" ]; then
      python3 -m venv "$PW_VENV"
      "$PW_VENV/bin/pip" install -q -U pip
      "$PW_VENV/bin/pip" install -q playwright pytest pytest-playwright pyyaml
      "$PW_VENV/bin/playwright" install chromium >/dev/null 2>&1 || true
    fi
    export BASE_URL="http://127.0.0.1:${STORY_PORT}"
    export UI_ARTIFACTS="$SHOT_DIR"
    set +e
    (
      cd "$ROOT/portal/packages/web/ui-testing"
      "$PW_VENV/bin/pytest" -v \
        test_localhost_office_e2e.py::test_story_e2e_chain_pane_visible \
        test_localhost_office_e2e.py::test_story_progress_strip \
        \
        --output "$SHOT_DIR/pytest-story-out"
    ) >"$EVIDENCE_DIR/playwright-story-${STAMP}.log" 2>&1
    STORY_RC=$?
    set -e
    if [ "$STORY_RC" = "0" ] && [ -f "$SHOT_DIR/01-story-e2e-chain-pane.png" ]; then
      STORY_OK=true
      pass "story screenshots (e2e_chain + progress)"
    else
      log "WARN: story screenshots residual (see playwright-story log)"
      tail -n 30 "$EVIDENCE_DIR/playwright-story-${STAMP}.log" || true
    fi
  else
    log "WARN: Vite story host did not become ready"
  fi
fi

# --- 7. Evidence JSON (sanitized) ---
python3 - <<PY
import json, pathlib, datetime
from pathlib import Path

evidence_dir = Path("$EVIDENCE_DIR")
shot_dir = Path("$SHOT_DIR")
stamp = "$STAMP"
live_status = """$LIVE_STATUS"""
live_agent = """$LIVE_AGENT""" == "true"
live_dl = """$LIVE_DL""" == "true"
live_cb = """$LIVE_CB""" == "true"
live_through = """$LIVE_THROUGH_DS""" == "true"
live_reopen = """$LIVE_REOPEN""" == "true"
live_docsapi = """$LIVE_DOCSAPI""" == "true"
live_key = """$LIVE_KEY_ROTATE""" == "true"
story_ok = """$STORY_OK""" == "true"

full_go = (
    live_status == "passed"
    and live_agent
    and live_dl
    and live_cb
    and live_through
    and live_reopen
    and live_key
)

shots = sorted([p.name for p in shot_dir.iterdir() if p.is_file()]) if shot_dir.is_dir() else []

report = {
  "bead_id": "lp-5q6.38",
  "title": "localhost mocklab proof: chat → agent write → pane refresh → human ONLYOFFICE save",
  "timestamp_utc": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
  "stamp": stamp,
  "environment": "localhost_mocklab_lab_ds",
  "topology": "lab-shared-compose-ds",
  "mode": "live_lab_through_ds" if full_go else f"residual_{live_status}",
  "go_no_go": {
    "offline_chain": "GO",
    "live_lab_ds": "GO" if live_status == "passed" else ("NOT_RUN" if live_status == "not_run" else "NO_GO"),
    "through_document_server_human_save": "GO" if live_through else "NO_GO",
    "full_product_chain": "GO" if full_go else "NO_GO",
    "browser_docsapi": "GO" if live_docsapi else "NO_GO",
    "story_screenshots": "GO" if story_ok else "RESIDUAL",
    "verdict_note": (
      "Localhost mocklab + lab Document Server product chain. "
      "Human save MUST assemble via Document Server (forcesave/callback URL host = DS), "
      "not synthetic BFF fixture status-2. "
      "Does NOT authorize AWS staging or production customer Office edit."
    ),
  },
  "checks": {
    "lab_compose_smoke": True,
    "bff_vault_proven_chain": True,
    "web_pane_artifact_refresh": True,
    "live_ds_health": live_status != "not_run",
    "live_agent_fixture_write": live_agent,
    "live_ds_container_download": live_dl,
    "live_through_ds_human_save": live_through,
    "live_human_callback_vault_write": live_cb,
    "live_document_key_rotated": live_key,
    "live_vault_reopen_not_ds_cache": live_reopen,
    "live_docsapi_screenshots": live_docsapi,
    "story_screenshots": story_ok,
    "live_status": live_status,
  },
  "ids": {
    "session_id_prefix": """$LIVE_SESSION_PREFIX""" or None,
    "revision_token": """$LIVE_REVISION_TOKEN""" or None,
    "document_key_prefix_before": """$LIVE_DOC_KEY1_PREFIX""" or None,
    "document_key_prefix_after": """$LIVE_DOC_KEY2_PREFIX""" or None,
    "agent_sha256_prefix": """$LIVE_AGENT_SHA""" or None,
    "human_sha256_prefix": """$LIVE_HUMAN_SHA""" or None,
    "reopen_sha256_prefix": """$LIVE_REOPEN_SHA""" or None,
    "assembled_fetch_host": """$LIVE_ASSEMBLED_HOST""" or None,
    "request_ids": json.loads("""$LIVE_REQUEST_IDS"""),
  },
  "acceptance_map": [
    {
      "criterion": "Local user opens a chat thread on localhost mocklab",
      "offline": "web pane chain + story e2e_chain (chat column)",
      "live": "lab BFF health + mint as authenticated local user",
    },
    {
      "criterion": "Agent or fixture creates/updates DOCX/XLSX + progress",
      "offline": "web emit plan + pane progress",
      "live": "POST /lab/e2e/agent-write real OOXML seed",
    },
    {
      "criterion": "Chat pane opens or updates for that artifact",
      "offline": "web reducer openGeneration",
      "live": "mint Office session for e2e path + DocsAPI open",
    },
    {
      "criterion": "Pane refreshes to the new revision after write",
      "offline": "openGeneration bump proven",
      "live": "assert mint2.document_key != mint1.document_key after human save",
      "asserted": live_key,
    },
    {
      "criterion": "Human edits through ONLYOFFICE (lab DS) and save callback writes vault",
      "offline": "BFF callback write proven (memory DS host) — residual alone",
      "live": "DocsAPI connector edit + Command Service forcesave; assembled_fetch_source=document_server; write_observed=true",
      "asserted": live_through,
    },
    {
      "criterion": "Reload/reopen proves bytes from vault, not DS cache",
      "offline": "poisoned DS cache assertion",
      "live": "reopen sha==human; vault overwrite then download tracks vault",
      "asserted": live_reopen,
    },
    {
      "criterion": "Evidence: sanitized screenshots, request IDs, revision IDs; no secrets",
      "offline": "JSON without bodies/tokens",
      "live": "session/document_key prefixes only; no JWT/nonce/download tokens",
    },
    {
      "criterion": "Explicit non-claim: does not authorize AWS staging or production",
      "offline": "documented",
      "live": "documented",
    },
  ],
  "screenshots": shots,
  "artifacts": {
    "report": str(evidence_dir / f"e2e-chain-evidence-{stamp}.json"),
    "latest": str(evidence_dir / "e2e-chain-evidence-latest.json"),
    "screenshots_dir": str(shot_dir),
  },
  "non_claims": [
    "Does not authorize AWS staging Office edit",
    "Does not authorize production customer Office edit",
    "Does not claim live_office_api_deployed on app.withlanyard.com",
  ],
  "no_secrets": True,
  "through_ds_required": True,
}

# Write go/no-go SVG (no secrets)
verdict = "FULL PRODUCT GO (localhost)" if full_go else "NO-GO / RESIDUAL"
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="720" height="160">
  <rect width="100%" height="100%" fill="#0f172a"/>
  <text x="24" y="48" fill="#e2e8f0" font-family="system-ui,sans-serif" font-size="22">lp-5q6.38 localhost mocklab Office E2E</text>
  <text x="24" y="84" fill="{"#4ade80" if full_go else "#f87171"}" font-family="system-ui,sans-serif" font-size="28" font-weight="700">{verdict}</text>
  <text x="24" y="120" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="14">through-DS human save · vault reopen · no AWS staging claim · {stamp}</text>
</svg>
'''
(shot_dir / "00-go-no-go.svg").write_text(svg)

out_path = evidence_dir / f"e2e-chain-evidence-{stamp}.json"
latest = evidence_dir / "e2e-chain-evidence-latest.json"
text = json.dumps(report, indent=2) + "\n"
# Fail closed on secret-like material in report
for banned in ("eyJ", "nonce=", "lab-onlyoffice-jwt-secret", "Bearer "):
    if banned in text:
        raise SystemExit(f"refusing to write evidence containing {banned!r}")
out_path.write_text(text)
latest.write_text(text)
print(json.dumps({"full_go": full_go, "live_status": live_status, "report": str(out_path)}, indent=2))
PY

# Final verdict
if [ "$LIVE_STATUS" = "passed" ] && [ "$LIVE_THROUGH_DS" = "true" ] && [ "$LIVE_REOPEN" = "true" ] && [ "$LIVE_KEY_ROTATE" = "true" ]; then
  log "=========================================="
  log "FULL PRODUCT GO (localhost mocklab + lab DS through-DS human save)"
  log "=========================================="
  exit 0
fi

if [ "$REQUIRE_LIVE" = "1" ]; then
  fail "REQUIRE_LIVE=1 but live through-DS path did not pass (status=$LIVE_STATUS through_ds=$LIVE_THROUGH_DS reopen=$LIVE_REOPEN key_rotate=$LIVE_KEY_ROTATE)"
fi

log "Verdict: offline chain GO; live residual (status=$LIVE_STATUS) — not FULL PRODUCT GO"
exit 0
