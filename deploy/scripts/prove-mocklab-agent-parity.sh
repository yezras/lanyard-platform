#!/usr/bin/env bash
# lp-rt5.8 — Docker mocklab joint GO with Lanyard Agent (backend.kind=lanyard_agent).
#
# Falsifiable gate (grill Q7–Q8 / phase-6-mocklab-joint-go.md):
#   script exit 0  AND  evidence joint_go=GO with required checks true
#
# Fail-closed rules (reviewer rework):
#   - Source greps alone NEVER set a required check true (no residual rubber-stamp).
#   - Offline residual for office/sandbox/HL/composer/stamp requires vitest exit 0.
#   - Live-required checks need real LA+BFF Brain RPC probes.
#   - Evidence topology.components / live_probe only claim services actually probed.
#
# NOT GO: offline unit tests alone; Portal fixture backend; host without Brain RPC.
# Does NOT authorize AWS staging or production customer claims.
#
# Usage (monorepo root):
#   bash deploy/scripts/prove-mocklab-agent-parity.sh
#   REQUIRE_LIVE=1 bash deploy/scripts/prove-mocklab-agent-parity.sh   # default
#   REQUIRE_LIVE=0 bash deploy/scripts/prove-mocklab-agent-parity.sh   # residual only (no GO)
#
# Optional env:
#   BFF_URL=http://127.0.0.1:4000
#   LA_HEALTH_URL=http://127.0.0.1:9100
#   RELAY_URL=http://127.0.0.1:8787
#   CP_URL=http://127.0.0.1:3100
#   WEB_URL=http://127.0.0.1:3010
#   TENANT_HOST=demo.localhost
#   DEV_USER_EMAIL / DEV_USER_PASSWORD  (lab demo user)
#   EVIDENCE_DIR=artifacts/mocklab/lp-rt5
#   PORTAL_ROOT=portal
#   LANYARD_AGENT_ROOT=../lanyard-agent
#   SKIP_UNIT=0|1
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EVIDENCE_DIR="${EVIDENCE_DIR:-$ROOT/artifacts/mocklab/lp-rt5}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$EVIDENCE_DIR/prove-${STAMP}.log"
REQUIRE_LIVE="${REQUIRE_LIVE:-1}"
SKIP_UNIT="${SKIP_UNIT:-0}"
BFF_URL="${BFF_URL:-http://127.0.0.1:4000}"
LA_HEALTH_URL="${LA_HEALTH_URL:-http://127.0.0.1:9100}"
RELAY_URL="${RELAY_URL:-http://127.0.0.1:8787}"
CP_URL="${CP_URL:-http://127.0.0.1:3100}"
WEB_URL="${WEB_URL:-http://127.0.0.1:3010}"
TENANT_HOST="${TENANT_HOST:-demo.localhost}"
DEV_USER_EMAIL="${DEV_USER_EMAIL:-dev@demo.local}"
DEV_USER_PASSWORD="${DEV_USER_PASSWORD:-local-dev-password}"
PORTAL_ROOT="${PORTAL_ROOT:-$ROOT/portal}"
LANYARD_AGENT_ROOT="${LANYARD_AGENT_ROOT:-}"
COOKIE_JAR=""
CSRF_TOKEN=""
BODY_FILE=""

err() { echo "[prove-mocklab-agent-parity] ERROR: $*" >&2; }
log() { echo "[prove-mocklab-agent-parity] $*"; }
fail() { err "$*"; exit 1; }
pass() { log "OK: $*"; }

mkdir -p "$EVIDENCE_DIR"
exec > >(tee -a "$LOG") 2>&1

cleanup() {
  if [[ -n "${COOKIE_JAR:-}" && -f "${COOKIE_JAR:-}" ]]; then
    rm -f "$COOKIE_JAR"
  fi
  if [[ -n "${BODY_FILE:-}" && -f "${BODY_FILE:-}" ]]; then
    rm -f "$BODY_FILE"
  fi
}
trap cleanup EXIT

log "started $(date -u -Iseconds)"
log "evidence=$EVIDENCE_DIR require_live=$REQUIRE_LIVE bff=$BFF_URL la=$LA_HEALTH_URL"

# --- check registry (required joint GO set) ---
declare -A CHECK
declare -A PROVENANCE   # live | unit | missing — never residual_source for required
for k in \
  backend_kind_lanyard_agent \
  settings_sections_match_capabilities \
  projects_list_nonempty \
  chat_working_directory_stamped \
  composer_skills_from_host \
  composer_no_default_agent_stubs \
  office_preview_inline_docx \
  office_preview_inline_xlsx \
  office_preview_inline_pptx \
  office_no_unsupported_placeholder \
  host_sandbox_enforced \
  hermes_lanyard_regression \
  brain_rpc_live \
  topology_components
do
  CHECK[$k]=false
  PROVENANCE[$k]=missing
done

BACKEND_VERSION=""
BACKEND_HEALTH_SERVICE=""
LA_READY_JSON=""
SNAPSHOT_JSON=""
PROJECTS_JSON=""
PRIMARY_PATH=""
STAMPED_VAULT_PATH=""
STAMPED_THREAD_ID=""
SKILL_COUNT=0
PROJECT_COUNT=0
NOTES=()
NON_CLAIMS=(
  "Not AWS staging"
  "Not production customer OnlyOffice"
  "Not third harness (Codex/OpenCode/Pi)"
  "Not CP vault project store unification"
  "Joint GO is Docker mocklab / localhost mocklab topology only"
  "Office preview residual is unit (vaultPreviewKind), not browser UI QA"
)

# ---------- helpers ----------
body_file() {
  if [[ -z "${BODY_FILE:-}" ]]; then
    BODY_FILE="$(mktemp)"
  fi
  echo "$BODY_FILE"
}

http_code() {
  local method="$1" url="$2"; shift 2
  curl -sS -o "$(body_file)" -w '%{http_code}' -X "$method" "$url" "$@" || echo "000"
}

set_check() {
  # set_check <name> <live|unit> <note>
  local name="$1" how="$2" note="${3:-}"
  if [[ "$how" != "live" && "$how" != "unit" ]]; then
    fail "internal: set_check only accepts live|unit (got $how for $name)"
  fi
  CHECK[$name]=true
  PROVENANCE[$name]="$how"
  if [[ -n "$note" ]]; then
    pass "$name via $how — $note"
  else
    pass "$name via $how"
  fi
}

run_vitest() {
  # run_vitest <cwd> <log-suffix> <vitest args...>
  local cwd="$1" suffix="$2"; shift 2
  local logf="$EVIDENCE_DIR/unit-${suffix}-${STAMP}.log"
  set +e
  (cd "$cwd" && pnpm exec vitest run "$@") >"$logf" 2>&1
  local rc=$?
  set -e
  echo "$rc"
  return 0
}

# Prefer a portal tree that can actually execute vitest
resolve_portal_for_units() {
  local candidates=(
    "$PORTAL_ROOT"
    "$ROOT/portal"
    "/home/operator/Lanyard-Dev/lanyard-platform/portal"
  )
  local c
  for c in "${candidates[@]}"; do
    if [[ -d "$c/packages/web" && -d "$c/node_modules/.pnpm" ]]; then
      echo "$c"
      return 0
    fi
  done
  # Worktree with package-level node_modules only
  for c in "${candidates[@]}"; do
    if [[ -d "$c/packages/web/node_modules" || -x "$c/packages/web/node_modules/.bin/vitest" ]]; then
      echo "$c"
      return 0
    fi
  done
  echo "$PORTAL_ROOT"
}

# ---------- 0. Topology presence (docs + compose) ----------
TOPOLOGY_DOC="$ROOT/docs/architecture/mocklab-agent-parity-topology.md"
COMPOSE_FILE="$ROOT/deploy/dev/mocklab-agent-parity/docker-compose.yml"
[[ -f "$TOPOLOGY_DOC" ]] || fail "missing topology doc $TOPOLOGY_DOC"
[[ -f "$COMPOSE_FILE" ]] || fail "missing compose $COMPOSE_FILE"
for phrase in "control-plane" "relay" "bff" "lanyard_agent" "joint_go"; do
  grep -Fiq "$phrase" "$TOPOLOGY_DOC" || fail "topology doc missing: $phrase"
done
for svc in postgres control-plane relay bff; do
  grep -Eq "^[[:space:]]*${svc}:" "$COMPOSE_FILE" || fail "compose missing service: $svc"
done
grep -Eq '127\.0\.0\.1:3100:3100' "$COMPOSE_FILE" || fail "compose CP must publish 127.0.0.1:3100:3100"
# topology_components is finalized after live probes (docs alone are not enough)
NOTES+=("topology docs+compose present; live_probe finalizes topology_components")
pass "topology doc + compose components present (pending live probe)"

# ---------- 1. Unit residual (must exit 0 — source greps do not count) ----------
export CI="${CI:-true}"
UNIT_PORTAL="$(resolve_portal_for_units)"
log "unit portal root=$UNIT_PORTAL"

# Resolve Lanyard Agent checkout
if [[ -z "$LANYARD_AGENT_ROOT" ]]; then
  for cand in \
    "$ROOT/../lanyard-agent" \
    "/home/operator/Lanyard-Dev/lanyard-agent"
  do
    if [[ -d "$cand/packages/agent-core" ]]; then
      LANYARD_AGENT_ROOT="$cand"
      break
    fi
  done
fi

if [[ "$SKIP_UNIT" == "1" ]]; then
  NOTES+=("SKIP_UNIT=1 — unit residual skipped; required residual checks stay false")
else
  log "offline residual: required vitest (fail-closed; no source-only rubber-stamp)"

  # --- composer: no default agent stubs ---
  if [[ -f "$UNIT_PORTAL/packages/web/src/features/chat/chatComposerTriggers.test.ts" ]]; then
    rc="$(run_vitest "$UNIT_PORTAL/packages/web" "composer" \
      src/features/chat/chatComposerTriggers.test.ts)"
    if [[ "$rc" == "0" ]]; then
      set_check composer_no_default_agent_stubs unit "chatComposerTriggers.test.ts"
    else
      NOTES+=("composer unit residual failed (see unit-composer-${STAMP}.log)")
    fi
  else
    NOTES+=("chatComposerTriggers.test.ts missing under unit portal")
  fi

  # --- office inline preview residual (docx/xlsx/pptx + never unsupported) ---
  if [[ -f "$UNIT_PORTAL/packages/web/src/features/vault/vaultPreviewKind.test.ts" ]]; then
    rc="$(run_vitest "$UNIT_PORTAL/packages/web" "office-preview" \
      src/features/vault/vaultPreviewKind.test.ts)"
    if [[ "$rc" == "0" ]]; then
      set_check office_preview_inline_docx unit "vaultPreviewKind.test.ts"
      set_check office_preview_inline_xlsx unit "vaultPreviewKind.test.ts"
      set_check office_preview_inline_pptx unit "vaultPreviewKind.test.ts"
      set_check office_no_unsupported_placeholder unit "vaultPreviewKind.test.ts Office never unsupported"
    else
      NOTES+=("office unit residual failed (see unit-office-preview-${STAMP}.log)")
    fi
  else
    NOTES+=("vaultPreviewKind.test.ts missing — office residual cannot pass without unit proof")
  fi

  # --- working_directory stamp helper unit ---
  WD_UNIT_OK=0
  if [[ -f "$UNIT_PORTAL/packages/bff/test/chat-working-directory.test.ts" ]]; then
    rc="$(run_vitest "$UNIT_PORTAL/packages/bff" "working-directory" \
      test/chat-working-directory.test.ts)"
    if [[ "$rc" == "0" ]]; then
      WD_UNIT_OK=1
      NOTES+=("chat-working-directory unit residual exit 0 (live stamp still required for GO)")
      pass "chat-working-directory unit residual"
    else
      NOTES+=("chat-working-directory unit residual failed (see unit-working-directory-${STAMP}.log)")
    fi
  else
    NOTES+=("chat-working-directory.test.ts missing under unit portal")
  fi

  # --- hermes_lanyard regression (fixture path + projects.db reader on same Portal build) ---
  HL_ARGS=()
  [[ -f "$UNIT_PORTAL/packages/bff/test/hermes-projects.test.ts" ]] && HL_ARGS+=(test/hermes-projects.test.ts)
  [[ -f "$UNIT_PORTAL/packages/bff/test/settings-snapshot.test.ts" ]] && HL_ARGS+=(test/settings-snapshot.test.ts)
  if [[ ${#HL_ARGS[@]} -gt 0 ]]; then
    rc="$(run_vitest "$UNIT_PORTAL/packages/bff" "hermes-lanyard" "${HL_ARGS[@]}")"
    if [[ "$rc" == "0" ]]; then
      set_check hermes_lanyard_regression unit "hermes-projects + settings-snapshot fixture path"
    else
      NOTES+=("hermes_lanyard unit residual failed (see unit-hermes-lanyard-${STAMP}.log)")
    fi
  else
    NOTES+=("HL unit residual tests missing under unit portal")
  fi

  # --- host.sandbox_enforced via agent-core tools-sandbox (must pass; no ProjectPathEscape source residual) ---
  if [[ -n "$LANYARD_AGENT_ROOT" && -d "$LANYARD_AGENT_ROOT/packages/agent-core" ]]; then
    SB_CWD=""
    if [[ -x "$LANYARD_AGENT_ROOT/packages/agent-core/node_modules/.bin/vitest" ]] \
      || [[ -d "$LANYARD_AGENT_ROOT/packages/agent-core/node_modules/vitest" ]]; then
      SB_CWD="$LANYARD_AGENT_ROOT/packages/agent-core"
    elif [[ -d "$LANYARD_AGENT_ROOT/node_modules" ]]; then
      SB_CWD="$LANYARD_AGENT_ROOT"
    fi
    if [[ -n "$SB_CWD" ]]; then
      logf="$EVIDENCE_DIR/unit-sandbox-${STAMP}.log"
      set +e
      if [[ "$SB_CWD" == *"/packages/agent-core" ]]; then
        (cd "$SB_CWD" && pnpm exec vitest run test/tools-sandbox.test.ts) >"$logf" 2>&1
      else
        (cd "$SB_CWD" && pnpm exec vitest run packages/agent-core/test/tools-sandbox.test.ts) >"$logf" 2>&1
      fi
      SB_RC=$?
      set -e
      if [[ $SB_RC -eq 0 ]]; then
        set_check host_sandbox_enforced unit "agent-core tools-sandbox.test.ts"
      else
        NOTES+=("host.sandbox unit residual failed (see unit-sandbox-${STAMP}.log) — source residual NOT accepted")
      fi
    else
      NOTES+=("agent vitest not available under LANYARD_AGENT_ROOT=$LANYARD_AGENT_ROOT")
    fi
  else
    NOTES+=("LANYARD_AGENT_ROOT not found — host.sandbox_enforced incomplete")
  fi
fi

# Informational source notes only (never set CHECK)
if [[ -f "$UNIT_PORTAL/packages/web/src/features/chat/chatComposerTriggers.ts" ]]; then
  if grep -RIn --include='*.ts' --include='*.tsx' -E 'DEFAULT_AGENT_STUBS\s*=' \
    "$UNIT_PORTAL/packages/web/src" 2>/dev/null | grep -v '\.test\.' >/dev/null; then
    NOTES+=("WARN source: DEFAULT_AGENT_STUBS assignment still present outside tests")
  fi
fi

# ---------- 2. Live topology probe ----------
LIVE_OK=0
LA_OK=0
BFF_OK=0
RELAY_OK=0
CP_OK=0
WEB_OK=0
PG_OK=0
DS_OK=0

probe_http() {
  local url="$1"
  curl -fsS --connect-timeout 2 "$url" >/dev/null 2>&1
}

if probe_http "$BFF_URL/health"; then
  BFF_OK=1
  pass "BFF healthy $BFF_URL"
else
  log "BFF not healthy at $BFF_URL"
fi

if probe_http "$CP_URL/health"; then
  CP_OK=1
  pass "CP healthy $CP_URL"
else
  log "CP not healthy at $CP_URL"
fi

if probe_http "$RELAY_URL/health"; then
  RELAY_OK=1
  pass "relay healthy $RELAY_URL"
else
  log "relay not healthy at $RELAY_URL"
fi

if curl -fsS --connect-timeout 2 -o /dev/null -w '' "$WEB_URL" 2>/dev/null \
  || curl -fsS --connect-timeout 2 -o /dev/null -w '' "$WEB_URL/" 2>/dev/null; then
  WEB_OK=1
  pass "web reachable $WEB_URL"
else
  log "web not reachable at $WEB_URL"
fi

# Postgres: try docker label or host port
if docker ps --format '{{.Names}}' 2>/dev/null | grep -Eq 'postgres|portal-postgres'; then
  PG_OK=1
  pass "postgres container present"
elif (echo >/dev/tcp/127.0.0.1/5432) >/dev/null 2>&1; then
  PG_OK=1
  pass "postgres port 5432 open"
else
  log "postgres not detected"
fi

if curl -fsS --connect-timeout 2 "http://127.0.0.1:8080/healthcheck" 2>/dev/null | grep -qiE 'true|ok'; then
  DS_OK=1
  pass "lab Document Server healthy (optional)"
fi

LA_HEALTH_BODY=""
if LA_HEALTH_BODY="$(curl -fsS --connect-timeout 2 "$LA_HEALTH_URL/health" 2>/dev/null)"; then
  BACKEND_HEALTH_SERVICE="$(printf '%s' "$LA_HEALTH_BODY" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("service",""))' 2>/dev/null || true)"
  if [[ "$BACKEND_HEALTH_SERVICE" == "lanyard-agent-gateway" ]]; then
    LA_OK=1
    pass "LA gateway health service=$BACKEND_HEALTH_SERVICE"
  else
    log "LA health returned unexpected service='$BACKEND_HEALTH_SERVICE'"
  fi
else
  log "LA health not reachable at $LA_HEALTH_URL"
fi

if [[ $LA_OK -eq 1 && $BFF_OK -eq 1 ]]; then
  LIVE_OK=1
fi

# topology_components requires docs+compose (already) AND live LA+BFF (+ ideally CP/relay)
if [[ $LIVE_OK -eq 1 && $CP_OK -eq 1 && $RELAY_OK -eq 1 ]]; then
  set_check topology_components live "LA+BFF+CP+relay healthy (hybrid host/docker mocklab)"
elif [[ $LIVE_OK -eq 1 ]]; then
  NOTES+=("LA+BFF up but CP($CP_OK)/relay($RELAY_OK) incomplete — topology_components false")
else
  NOTES+=("live topology incomplete LA=$LA_OK BFF=$BFF_OK")
fi

if [[ "$REQUIRE_LIVE" == "1" && $LIVE_OK -ne 1 ]]; then
  err "REQUIRE_LIVE=1 but live LA+BFF not both healthy"
  err "Start mocklab topology (see docs/architecture/mocklab-agent-parity-topology.md)"
  err "  - portal: CP + relay + BFF (BRAIN_RPC_ENABLED=1)"
  err "  - lanyard-agent gateway on $LA_HEALTH_URL dialing relay"
fi

# ---------- 3. Live Brain RPC path via BFF ----------
if [[ $LIVE_OK -eq 1 ]]; then
  COOKIE_JAR="$(mktemp)"
  HOST_HDR=(-H "Host: ${TENANT_HOST}")

  CSRF_JSON="$(curl -fsS "${HOST_HDR[@]}" -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BFF_URL/api/auth/csrf" || true)"
  CSRF_TOKEN="$(printf '%s' "$CSRF_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("csrf_token",""))' 2>/dev/null || true)"

  if [[ -z "$CSRF_TOKEN" ]]; then
    NOTES+=("could not obtain CSRF token")
  else
    login_code="$(curl -sS -o "$(body_file)" -w '%{http_code}' \
      -X POST "$BFF_URL/api/auth/login" \
      "${HOST_HDR[@]}" \
      -H "content-type: application/json" \
      -H "x-csrf-token: $CSRF_TOKEN" \
      -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
      -d "{\"email\":\"$DEV_USER_EMAIL\",\"password\":\"$DEV_USER_PASSWORD\"}" || echo 000)"
    if [[ "$login_code" != "200" ]]; then
      NOTES+=("login HTTP $login_code body=$(head -c 200 "$(body_file)" 2>/dev/null || true)")
      log "login failed ($login_code) — Brain RPC authenticated checks skipped"
    else
      pass "logged in as lab demo user (email only logged)"

      # brain.ping (capture body immediately — shared body_file is overwritten by later probes)
      PING_BODY="$EVIDENCE_DIR/brain-ping-${STAMP}.json"
      ping_code="$(curl -sS -o "$PING_BODY" -w '%{http_code}' \
        "${HOST_HDR[@]}" -b "$COOKIE_JAR" \
        "$BFF_URL/api/brain/ping?echo=lp-rt5.8" || echo 000)"
      if [[ "$ping_code" == "200" && -s "$PING_BODY" ]]; then
        set_check brain_rpc_live live "brain.ping via BFF"
        BACKEND_VERSION="$(python3 - "$PING_BODY" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
r=d.get("result") or {}
print(r.get("contract_version") or d.get("request_id") or "unknown")
PY
)"
      else
        PING_NOTE="$(head -c 300 "$PING_BODY" 2>/dev/null | tr '\n' ' ' || true)"
        NOTES+=("brain.ping HTTP $ping_code: $PING_NOTE")
        log "brain.ping failed HTTP $ping_code — $PING_NOTE"
      fi

      # settings.snapshot — sections must match host-backed capabilities honesty
      SNAP_BODY="$EVIDENCE_DIR/settings-snapshot-${STAMP}.json"
      snap_code="$(curl -sS -o "$SNAP_BODY" -w '%{http_code}' \
        "${HOST_HDR[@]}" -b "$COOKIE_JAR" \
        "$BFF_URL/api/settings/snapshot" || echo 000)"
      if [[ "$snap_code" == "200" && -s "$SNAP_BODY" ]]; then
        SNAPSHOT_JSON="$(cat "$SNAP_BODY")"
        # Fail-closed validation: non-fixture; host kind; all section keys present as arrays
        if python3 - "$SNAP_BODY" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p))
src = str(d.get("source") or "")
if src == "fixture":
    print("fixture snapshot not allowed for joint GO", file=sys.stderr)
    sys.exit(2)
if src not in ("lanyard_agent", "projects_db", "backend_home", "hermes", "hermes_lanyard"):
    # still require non-empty honest source
    if not src:
        print("missing snapshot source", file=sys.stderr)
        sys.exit(3)
# Required section keys (capabilities-facing inventory)
for key in ("skills", "models", "crons", "mcp_servers", "integrations"):
    if key not in d:
        print(f"missing section key {key}", file=sys.stderr)
        sys.exit(4)
    if not isinstance(d[key], list):
        print(f"section {key} is not a list", file=sys.stderr)
        sys.exit(5)
# Host-backed LA joint GO expects skills inventory from agent when source is lanyard_agent
if src == "lanyard_agent" and not isinstance(d.get("skills"), list):
    sys.exit(6)
print(src)
sys.exit(0)
PY
        then
          SNAP_SRC="$(python3 -c 'import json; print(json.load(open("'"$SNAP_BODY"'")).get("source",""))')"
          SKILL_COUNT="$(python3 -c 'import json; d=json.load(open("'"$SNAP_BODY"'")); print(len(d.get("skills") or []))')"
          set_check settings_sections_match_capabilities live \
            "source=$SNAP_SRC section keys present (skills/models/crons/mcp/integrations)"
          if [[ "${SKILL_COUNT:-0}" -gt 0 ]]; then
            set_check composer_skills_from_host live "skills=$SKILL_COUNT from host snapshot"
          else
            NOTES+=("settings.snapshot skills empty — composer.skills_from_host false until host seeds skills")
          fi
        else
          NOTES+=("settings.snapshot failed sections_match_capabilities validation")
        fi
      else
        NOTES+=("settings.snapshot HTTP $snap_code: $(head -c 300 "$SNAP_BODY" 2>/dev/null || true)")
      fi

      # projects.list — preferred /api/agent/projects, legacy dual-mount /api/hermes/projects
      PROJ_BODY="$EVIDENCE_DIR/projects-${STAMP}.json"
      proj_code="$(curl -sS -o "$PROJ_BODY" -w '%{http_code}' \
        "${HOST_HDR[@]}" -b "$COOKIE_JAR" \
        "$BFF_URL/api/agent/projects" || echo 000)"
      PROJ_PATH="/api/agent/projects"
      if [[ "$proj_code" == "404" ]]; then
        proj_code="$(curl -sS -o "$PROJ_BODY" -w '%{http_code}' \
          "${HOST_HDR[@]}" -b "$COOKIE_JAR" \
          "$BFF_URL/api/hermes/projects" || echo 000)"
        PROJ_PATH="/api/hermes/projects"
        NOTES+=("preferred /api/agent/projects 404 — used legacy dual-mount $PROJ_PATH (HL dual-mount still live)")
      fi
      if [[ "$proj_code" == "200" && -s "$PROJ_BODY" ]]; then
        PROJECTS_JSON="$(cat "$PROJ_BODY")"
        PROJECT_COUNT="$(python3 -c 'import json; d=json.load(open("'"$PROJ_BODY"'")); print(len(d.get("projects") or []))')"
        if [[ "${PROJECT_COUNT:-0}" -gt 0 ]]; then
          set_check projects_list_nonempty live "via $PROJ_PATH count=$PROJECT_COUNT"
          PRIMARY_PATH="$(python3 -c 'import json; d=json.load(open("'"$PROJ_BODY"'")); ps=d.get("projects") or []; print((ps[0].get("primary_path") or ps[0].get("path") or "") if ps else "")')"
          PRIMARY_ID="$(python3 -c 'import json; d=json.load(open("'"$PROJ_BODY"'")); ps=d.get("projects") or []; print((ps[0].get("id") or "") if ps else "")')"
          pass "primary_path=${PRIMARY_PATH:-?} id=${PRIMARY_ID:-?}"
        else
          NOTES+=("projects.list returned empty array")
        fi
      else
        NOTES+=("projects.list HTTP $proj_code: $(head -c 300 "$PROJ_BODY" 2>/dev/null || true)")
      fi

      # Live working_directory stamp: create thread with project_id → project_vault_path == primary_path
      # primary_path presence alone is NOT enough (reviewer fail-closed).
      if [[ -n "${PRIMARY_ID:-}" && -n "${PRIMARY_PATH:-}" ]]; then
        CSRF_JSON="$(curl -fsS "${HOST_HDR[@]}" -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BFF_URL/api/auth/csrf" || true)"
        CSRF_TOKEN="$(printf '%s' "$CSRF_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("csrf_token",""))' 2>/dev/null || true)"
        THR_BODY="$EVIDENCE_DIR/thread-stamp-${STAMP}.json"
        thr_code="$(curl -sS -o "$THR_BODY" -w '%{http_code}' \
          -X POST "$BFF_URL/api/chat/threads" \
          "${HOST_HDR[@]}" \
          -H "content-type: application/json" \
          -H "x-csrf-token: $CSRF_TOKEN" \
          -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
          -d "{\"title\":\"lp-rt5.8-stamp-${STAMP}\",\"project_id\":\"$PRIMARY_ID\"}" || echo 000)"
        if [[ ( "$thr_code" == "200" || "$thr_code" == "201" ) && -s "$THR_BODY" ]]; then
          STAMPED_VAULT_PATH="$(python3 - "$THR_BODY" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
print(d.get("project_vault_path") or "")
PY
)"
          STAMPED_THREAD_ID="$(python3 - "$THR_BODY" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
print(d.get("thread_id") or "")
PY
)"
          if [[ -n "$STAMPED_VAULT_PATH" && "$STAMPED_VAULT_PATH" == "$PRIMARY_PATH" ]]; then
            set_check chat_working_directory_stamped live \
              "thread $STAMPED_THREAD_ID project_vault_path==primary_path"
          else
            NOTES+=("thread create returned project_vault_path='$STAMPED_VAULT_PATH' expected '$PRIMARY_PATH'")
          fi
        else
          NOTES+=("chat thread stamp HTTP $thr_code: $(head -c 300 "$THR_BODY" 2>/dev/null || true)")
        fi
      else
        NOTES+=("cannot live-stamp working_directory without project id+primary_path")
      fi
    fi
  fi

  # backend.kind fingerprint from LA health (not hermes) + brain.ping
  if [[ "$BACKEND_HEALTH_SERVICE" == "lanyard-agent-gateway" && ${CHECK[brain_rpc_live]} == true ]]; then
    set_check backend_kind_lanyard_agent live "health service + brain.ping"
  elif [[ "$BACKEND_HEALTH_SERVICE" == "lanyard-agent-gateway" ]]; then
    NOTES+=("LA health is lanyard-agent-gateway but brain.ping not live — kind claimed only with Brain RPC")
  fi

  LA_READY_JSON="$(curl -fsS --connect-timeout 2 "$LA_HEALTH_URL/ready" 2>/dev/null || true)"
  if [[ -n "$LA_READY_JSON" ]]; then
    printf '%s' "$LA_READY_JSON" >"$EVIDENCE_DIR/la-ready-${STAMP}.json"
  fi
fi

if [[ ${CHECK[composer_skills_from_host]} != true ]]; then
  NOTES+=("Seed host skills under BACKEND_HOME/skills or skills_roots for composer.skills_from_host")
fi

# ---------- 4. Verdict ----------
REQUIRED=(
  backend_kind_lanyard_agent
  settings_sections_match_capabilities
  projects_list_nonempty
  chat_working_directory_stamped
  composer_skills_from_host
  composer_no_default_agent_stubs
  office_preview_inline_docx
  office_preview_inline_xlsx
  office_preview_inline_pptx
  office_no_unsupported_placeholder
  host_sandbox_enforced
  hermes_lanyard_regression
  brain_rpc_live
  topology_components
)

# Fail-closed: provenance must be live or unit (never residual_source)
ALL_TRUE=1
for k in "${REQUIRED[@]}"; do
  if [[ "${CHECK[$k]}" != true ]]; then
    ALL_TRUE=0
    log "MISSING: $k (provenance=${PROVENANCE[$k]})"
  elif [[ "${PROVENANCE[$k]}" != "live" && "${PROVENANCE[$k]}" != "unit" ]]; then
    ALL_TRUE=0
    CHECK[$k]=false
    log "REJECT: $k provenance=${PROVENANCE[$k]} not live|unit (fail-closed)"
  else
    log "PASS: $k (provenance=${PROVENANCE[$k]})"
  fi
done

JOINT_GO="NO-GO"
if [[ "$REQUIRE_LIVE" == "1" && $ALL_TRUE -eq 1 ]]; then
  JOINT_GO="GO"
elif [[ "$REQUIRE_LIVE" != "1" ]]; then
  JOINT_GO="NO-GO"
  NOTES+=("REQUIRE_LIVE!=1 — cannot claim joint GO")
fi

# ---------- 5. Write evidence ----------
EVIDENCE_FILE="$EVIDENCE_DIR/joint-go-evidence-${STAMP}.json"
LATEST="$EVIDENCE_DIR/joint-go-evidence-latest.json"

CHECKS_JSON="$(
  python3 - <<PY
import json
def b(v: str) -> bool:
    return v.strip().lower() == "true"
print(json.dumps({
  "backend.kind_lanyard_agent": b("${CHECK[backend_kind_lanyard_agent]}"),
  "settings.sections_match_capabilities": b("${CHECK[settings_sections_match_capabilities]}"),
  "projects.list_nonempty": b("${CHECK[projects_list_nonempty]}"),
  "chat.working_directory_stamped": b("${CHECK[chat_working_directory_stamped]}"),
  "composer.skills_from_host": b("${CHECK[composer_skills_from_host]}"),
  "composer.no_default_agent_stubs": b("${CHECK[composer_no_default_agent_stubs]}"),
  "office.preview_inline_docx": b("${CHECK[office_preview_inline_docx]}"),
  "office.preview_inline_xlsx": b("${CHECK[office_preview_inline_xlsx]}"),
  "office.preview_inline_pptx": b("${CHECK[office_preview_inline_pptx]}"),
  "office.no_unsupported_placeholder": b("${CHECK[office_no_unsupported_placeholder]}"),
  "host.sandbox_enforced": b("${CHECK[host_sandbox_enforced]}"),
  "hermes_lanyard.regression": b("${CHECK[hermes_lanyard_regression]}"),
  "brain_rpc.live": b("${CHECK[brain_rpc_live]}"),
  "topology.components": b("${CHECK[topology_components]}"),
}))
PY
)"

PROVENANCE_JSON="$(
  python3 - <<PY
import json
print(json.dumps({
  "backend.kind_lanyard_agent": "${PROVENANCE[backend_kind_lanyard_agent]}",
  "settings.sections_match_capabilities": "${PROVENANCE[settings_sections_match_capabilities]}",
  "projects.list_nonempty": "${PROVENANCE[projects_list_nonempty]}",
  "chat.working_directory_stamped": "${PROVENANCE[chat_working_directory_stamped]}",
  "composer.skills_from_host": "${PROVENANCE[composer_skills_from_host]}",
  "composer.no_default_agent_stubs": "${PROVENANCE[composer_no_default_agent_stubs]}",
  "office.preview_inline_docx": "${PROVENANCE[office_preview_inline_docx]}",
  "office.preview_inline_xlsx": "${PROVENANCE[office_preview_inline_xlsx]}",
  "office.preview_inline_pptx": "${PROVENANCE[office_preview_inline_pptx]}",
  "office.no_unsupported_placeholder": "${PROVENANCE[office_no_unsupported_placeholder]}",
  "host.sandbox_enforced": "${PROVENANCE[host_sandbox_enforced]}",
  "hermes_lanyard.regression": "${PROVENANCE[hermes_lanyard_regression]}",
  "brain_rpc.live": "${PROVENANCE[brain_rpc_live]}",
  "topology.components": "${PROVENANCE[topology_components]}",
}))
PY
)"

NOTES_JSON="$(printf '%s\n' "${NOTES[@]+"${NOTES[@]}"}" | python3 -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')"
NON_CLAIMS_JSON="$(printf '%s\n' "${NON_CLAIMS[@]}" | python3 -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')"

export EVIDENCE_FILE STAMP JOINT_GO BACKEND_HEALTH_SERVICE BACKEND_VERSION LA_HEALTH_URL
export BFF_OK CP_OK RELAY_OK LA_OK WEB_OK PG_OK DS_OK SKILL_COUNT PROJECT_COUNT PRIMARY_PATH
export STAMPED_VAULT_PATH STAMPED_THREAD_ID
export CHECKS_JSON PROVENANCE_JSON NOTES_JSON NON_CLAIMS_JSON

python3 <<'PY'
import json, os
from datetime import datetime, timezone

checks = json.loads(os.environ["CHECKS_JSON"])
provenance = json.loads(os.environ["PROVENANCE_JSON"])
kind = "lanyard_agent" if checks.get("backend.kind_lanyard_agent") else "unknown"
primary = os.environ.get("PRIMARY_PATH") or ""

# Only claim components actually probed healthy (or optional observed)
probed = {
  "postgres": bool(int(os.environ.get("PG_OK") or 0)),
  "control-plane": bool(int(os.environ.get("CP_OK") or 0)),
  "relay": bool(int(os.environ.get("RELAY_OK") or 0)),
  "bff": bool(int(os.environ.get("BFF_OK") or 0)),
  "web": bool(int(os.environ.get("WEB_OK") or 0)),
  "lanyard_agent": bool(int(os.environ.get("LA_OK") or 0)),
  "lab_document_server_optional": bool(int(os.environ.get("DS_OK") or 0)),
}
components = [name for name, ok in probed.items() if ok and not name.endswith("_optional")]
if probed.get("lab_document_server_optional"):
    optional = ["lab_document_server"]
else:
    optional = []

doc = {
  "bead_id": "lp-rt5.8",
  "sister_bead_id": "lac-yt3.6",
  "title": "Docker mocklab joint GO with Lanyard Agent",
  "timestamp_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "stamp": os.environ["STAMP"],
  "environment": "docker_mocklab_agent_parity",
  "topology": {
    "name": "docker_mocklab_agent_parity",
    "doc": "docs/architecture/mocklab-agent-parity-topology.md",
    "compose": "deploy/dev/mocklab-agent-parity/docker-compose.yml",
    "deployment_mode": "hybrid_host_process_or_compose",
    "components": components,
    "optional_components": optional,
    "components_probed": probed,
    "live_probe": {
      "bff_ok": bool(int(os.environ.get("BFF_OK") or 0)),
      "cp_ok": bool(int(os.environ.get("CP_OK") or 0)),
      "relay_ok": bool(int(os.environ.get("RELAY_OK") or 0)),
      "la_ok": bool(int(os.environ.get("LA_OK") or 0)),
      "web_ok": bool(int(os.environ.get("WEB_OK") or 0)),
      "postgres_ok": bool(int(os.environ.get("PG_OK") or 0)),
      "lab_ds_ok": bool(int(os.environ.get("DS_OK") or 0)),
    },
  },
  "backend": {
    "kind": kind,
    "health_service": os.environ.get("BACKEND_HEALTH_SERVICE") or "",
    "version": os.environ.get("BACKEND_VERSION") or "",
    "health_url": os.environ.get("LA_HEALTH_URL") or "",
  },
  "joint_go": os.environ["JOINT_GO"],
  "checks": checks,
  "check_provenance": provenance,
  "fail_closed": {
    "residual_source_never_sets_required": True,
    "required_provenance": ["live", "unit"],
  },
  "metrics": {
    "skill_count": int(os.environ.get("SKILL_COUNT") or 0),
    "project_count": int(os.environ.get("PROJECT_COUNT") or 0),
    "primary_path_prefix": primary[:64],
    "stamped_vault_path_prefix": (os.environ.get("STAMPED_VAULT_PATH") or "")[:64],
    "stamped_thread_id": os.environ.get("STAMPED_THREAD_ID") or "",
  },
  "notes": json.loads(os.environ["NOTES_JSON"]),
  "non_claims": json.loads(os.environ["NON_CLAIMS_JSON"]),
  "log": f"prove-{os.environ['STAMP']}.log",
}
path = os.environ["EVIDENCE_FILE"]
with open(path, "w") as f:
    json.dump(doc, f, indent=2)
    f.write("\n")
print(path)
PY

ln -sfn "$(basename "$EVIDENCE_FILE")" "$LATEST"
pass "wrote $EVIDENCE_FILE (joint_go=$JOINT_GO)"
log "latest -> $LATEST"

if [[ "$JOINT_GO" != "GO" ]]; then
  err "joint_go=$JOINT_GO — see checks/notes/check_provenance in evidence"
  exit 1
fi

log "joint_go=GO — all required checks true with live|unit provenance"
exit 0
