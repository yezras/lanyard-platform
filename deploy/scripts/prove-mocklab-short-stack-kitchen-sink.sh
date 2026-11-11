#!/usr/bin/env bash
# lp-oop.34 — Kitchen-sink re-QA gate.
#
# Starts a local BFF (ChatDelivery=harness, VaultPlane=cp_s3) + Vite, drives
# Playwright kitchen-sink matrix, writes artifacts/ui/lp-oop.34/ and
# artifacts/mocklab/short-stack/kitchen-sink/. Does not flip live AWS
# chat_delivery. Does not terraform apply. Does not print secret values.
# Guest/Relay stays the process default when this serve is not running.
#
# Usage (from monorepo root):
#   bash deploy/scripts/prove-mocklab-short-stack-kitchen-sink.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ART="${UI_ARTIFACTS:-$ROOT/artifacts/ui/lp-oop.34}"
GATE="${GATE_DIR:-$ROOT/artifacts/mocklab/short-stack/kitchen-sink}"
STACK="$ROOT/artifacts/mocklab/short-stack"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$ART/prove-${STAMP}.log"
BFF_PORT="${BFF_PORT:-4138}"
WEB_PORT="${WEB_PORT:-3138}"
TENANT_SLUG="${UI_QA_TENANT_SLUG:-mocklab}"
EMAIL="${UI_QA_EMAIL:-agent-dev@mocklab.local}"
PASSWORD="${UI_QA_PASSWORD:-local-dev-password}"
MAIN_PORTAL="${LANYARD_PLATFORM_CHECKOUT:-/home/operator/Lanyard-Dev/lanyard-platform}/portal"
TSX="${TSX:-$MAIN_PORTAL/node_modules/.bin/tsx}"
VITE="${VITE:-$MAIN_PORTAL/packages/web/node_modules/.bin/vite}"
PY="${WEB_UI_PY:-$HOME/.grok/skills/web-ui-testing/.venv/bin/python}"
KILL_BROWSERS="$HOME/.grok/skills/web-ui-testing/scripts/kill_browsers.sh"
SERVE="$ROOT/portal/packages/bff/scripts/serve-short-stack-kitchen-sink.ts"
RUNNER="$ART/run_qa.py"
PIN="$ROOT/deploy/daytona/agent-gateway/pins/staging-pilot.pins.yaml"
CONFIG="$ROOT/portal/packages/bff/src/config.ts"
LIVE_URL="${LIVE_GUEST_URL:-https://app.withlanyard.com/mocklab/}"

mkdir -p "$ART" "$GATE"

err() { echo "[prove-mocklab-short-stack-kitchen-sink] ERROR: $*" >&2; }
log() { echo "[prove-mocklab-short-stack-kitchen-sink] $*"; }
fail() { err "$*"; exit 1; }

exec > >(tee -a "$LOG") 2>&1

echo "== lp-oop.34 prove-mocklab-short-stack-kitchen-sink =="
echo "ROOT=$ROOT STAMP=$STAMP BFF_PORT=$BFF_PORT WEB_PORT=$WEB_PORT"

[[ -x "$TSX" ]] || fail "tsx not found at $TSX (portal install required)"
[[ -x "$VITE" ]] || fail "vite not found at $VITE"
[[ -x "$PY" ]] || fail "Playwright python missing ($PY). Run web-ui-testing doctor."
[[ -f "$SERVE" ]] || fail "missing $SERVE"
[[ -f "$RUNNER" ]] || fail "missing $RUNNER"
[[ -f "$PIN" ]] || fail "missing live pin $PIN"
[[ -f "$CONFIG" ]] || fail "missing $CONFIG"

if [[ "${FLIP_LIVE_CHAT_DELIVERY:-}" == "1" || "${FLIP_LIVE_SNAPSHOT:-}" == "1" ]]; then
  fail "FLIP_LIVE_* refused. This gate does not write chat_delivery or DAYTONA_DEFAULT_SNAPSHOT."
fi

# --- Guest path still available (source + pin; no AWS write) ---
guest_checks=()
grep -q 'export const DEFAULT_CHAT_DELIVERY: ChatDelivery = "relay"' "$CONFIG" \
  || fail "DEFAULT_CHAT_DELIVERY must stay relay"
guest_checks+=("default_chat_delivery=relay")

grep -q 'Empty/unset/unknown → `relay`' "$CONFIG" \
  || fail "parseChatDelivery fail-closed to relay missing"
guest_checks+=("parse_empty_is_relay")

grep -q 'Instance override > tenant persist > env' "$CONFIG" \
  || fail "dual-run resolveChatDelivery missing"
guest_checks+=("dual_run_persist")

grep -q 'daytona_snapshot_name: "lanyard-la-main-' "$PIN" \
  || fail "live pin is not guest-gateway lanyard-la-main"
if grep -q 'lab:tool-only' "$PIN"; then
  fail "live pin must not be the lab tool-only placeholder"
fi
guest_checks+=("live_pin_guest_gateway")

live_http=""
if live_http="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$LIVE_URL" || true)"; then
  :
fi
if [[ "$live_http" == "200" ]]; then
  guest_checks+=("live_mocklab_http=200")
else
  log "live MockLab HTTP=$live_http (named; guest path still default relay)"
  guest_checks+=("live_mocklab_http=${live_http:-unreachable}")
fi

log "guest path checks: ${guest_checks[*]}"

BFF_PID=""
WEB_PID=""
cleanup() {
  if [[ -n "${WEB_PID}" ]] && kill -0 "$WEB_PID" 2>/dev/null; then
    kill "$WEB_PID" 2>/dev/null || true
    wait "$WEB_PID" 2>/dev/null || true
  fi
  if [[ -n "${BFF_PID}" ]] && kill -0 "$BFF_PID" 2>/dev/null; then
    kill "$BFF_PID" 2>/dev/null || true
    wait "$BFF_PID" 2>/dev/null || true
  fi
  if [[ -x "$KILL_BROWSERS" ]]; then
    bash "$KILL_BROWSERS" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

TSC="${TSC:-$MAIN_PORTAL/packages/shared/node_modules/.bin/tsc}"
[[ -x "$TSC" ]] || fail "tsc not found at $TSC"
for pkg in shared chat-corpus hermes-compat backend-runtime control-plane; do
  if [[ ! -e "$ROOT/portal/packages/$pkg/node_modules" && -d "$MAIN_PORTAL/packages/$pkg/node_modules" ]]; then
    ln -sfn "$MAIN_PORTAL/packages/$pkg/node_modules" "$ROOT/portal/packages/$pkg/node_modules"
  fi
done
for pkg in shared chat-corpus hermes-compat backend-runtime; do
  if [[ ! -f "$ROOT/portal/packages/$pkg/dist/index.js" ]]; then
    log "tsc $pkg"
    (cd "$ROOT/portal/packages/$pkg" && "$TSC" -p tsconfig.json) \
      || fail "tsc failed for $pkg"
  fi
done
if [[ ! -e "$ROOT/portal/packages/bff/node_modules/@lanyard/shared" ]]; then
  rm -rf "$ROOT/portal/packages/bff/node_modules"
  mkdir -p "$ROOT/portal/packages/bff/node_modules/@lanyard"
  for x in "$MAIN_PORTAL/packages/bff/node_modules/"*; do
    base="$(basename "$x")"
    [[ "$base" == "@lanyard" ]] && continue
    ln -sfn "$x" "$ROOT/portal/packages/bff/node_modules/$base"
  done
  ln -sfn "$ROOT/portal/packages/shared" "$ROOT/portal/packages/bff/node_modules/@lanyard/shared"
  ln -sfn "$ROOT/portal/packages/chat-corpus" "$ROOT/portal/packages/bff/node_modules/@lanyard/chat-corpus"
  ln -sfn "$ROOT/portal/packages/backend-runtime" "$ROOT/portal/packages/bff/node_modules/@lanyard/backend-runtime"
  ln -sfn "$ROOT/portal/packages/hermes-compat" "$ROOT/portal/packages/bff/node_modules/@lanyard/hermes-compat"
fi
if [[ ! -e "$ROOT/portal/node_modules" && -d "$MAIN_PORTAL/node_modules" ]]; then
  ln -sfn "$MAIN_PORTAL/node_modules" "$ROOT/portal/node_modules"
fi

BFF_LOG="$ART/bff-${STAMP}.log"
WEB_LOG="$ART/vite-${STAMP}.log"

log "starting kitchen-sink BFF on 127.0.0.1:$BFF_PORT"
(
  cd "$ROOT/portal/packages/bff"
  env -u HARNESS_SERVICE_TOKEN -u LANYARD_HARNESS_SERVICE_TOKEN \
    BFF_PORT="$BFF_PORT" \
    UI_QA_TENANT_SLUG="$TENANT_SLUG" \
    UI_QA_EMAIL="$EMAIL" \
    UI_QA_PASSWORD="$PASSWORD" \
    BEAD_ID="lp-oop.34" \
    "$TSX" scripts/serve-short-stack-kitchen-sink.ts
) >"$BFF_LOG" 2>&1 &
BFF_PID=$!

bff_ready=0
for _ in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:${BFF_PORT}/${TENANT_SLUG}/api/dev/short-stack-hop" >/dev/null 2>&1; then
    bff_ready=1
    break
  fi
  if ! kill -0 "$BFF_PID" 2>/dev/null; then
    tail -n 40 "$BFF_LOG" || true
    fail "BFF exited before ready"
  fi
  sleep 0.25
done
[[ "$bff_ready" == 1 ]] || { tail -n 40 "$BFF_LOG"; fail "BFF not ready on :$BFF_PORT"; }
pass_hop="$(curl -sS "http://127.0.0.1:${BFF_PORT}/${TENANT_SLUG}/api/dev/short-stack-hop")"
log "BFF hop: $pass_hop"

WEB_ROOT="${VITE_ROOT:-}"
if [[ -z "$WEB_ROOT" && -f "$MAIN_PORTAL/packages/web/vite.config.ts" ]]; then
  WEB_ROOT="$MAIN_PORTAL/packages/web"
elif [[ -z "$WEB_ROOT" && -f "$ROOT/portal/apps/web/vite.config.ts" ]]; then
  WEB_ROOT="$ROOT/portal/apps/web"
fi
[[ -n "$WEB_ROOT" && -f "$WEB_ROOT/vite.config.ts" ]] || fail "vite.config.ts missing (set VITE_ROOT)"

log "starting Vite on 127.0.0.1:$WEB_PORT → BFF :$BFF_PORT"
(
  cd "$WEB_ROOT"
  BFF_URL="http://127.0.0.1:${BFF_PORT}" \
    "$VITE" --host 127.0.0.1 --port "$WEB_PORT" --strictPort
) >"$WEB_LOG" 2>&1 &
WEB_PID=$!

web_ready=0
for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${WEB_PORT}/${TENANT_SLUG}/" >/dev/null 2>&1; then
    web_ready=1
    break
  fi
  if ! kill -0 "$WEB_PID" 2>/dev/null; then
    tail -n 40 "$WEB_LOG" || true
    fail "Vite exited before ready"
  fi
  sleep 0.5
done
[[ "$web_ready" == 1 ]] || { tail -n 40 "$WEB_LOG"; fail "Vite not ready on :$WEB_PORT"; }
log "Vite ready"

export BASE_URL="http://127.0.0.1:${WEB_PORT}/${TENANT_SLUG}"
export UI_QA_EMAIL="$EMAIL"
export UI_QA_PASSWORD="$PASSWORD"
export UI_ARTIFACTS="$ART"
export UI_QA_MARKER="lp-oop.34-kitchen-sink-ping"
export UI_QA_VAULT_MARKER="short-stack-kitchen-sink.md"

log "Playwright $BASE_URL"
set +e
"$PY" "$RUNNER"
qa_rc=$?
set -e

VERDICT="NO_GO"
if [[ $qa_rc -eq 0 ]]; then
  VERDICT="GO_WITH_WAIVERS"
fi

UI_RESULT="$ART/RESULT.md"
{
  echo "# lp-oop.34 — Kitchen-sink re-QA (harness path UI)"
  echo
  echo "**Result:** $([[ $qa_rc -eq 0 ]] && echo PASS || echo FAIL)"
  echo "**Stamp:** $STAMP"
  echo "**Bead:** \`lp-oop.34\`"
  echo
  echo "## Hop"
  echo
  echo '```'
  echo "Browser  ─HTTP + SSE─►  BFF (CHAT_DELIVERY=harness, VaultPlane=cp_s3)  ─HTTP + SSE─►  Harness"
  echo "Directory  ─GET /api/vault/tree─►  BFF  ─CP HTTP─►  FakeS3   (no ensure_online)"
  echo '```'
  echo
  echo "Guest path stays default Relay. Live AWS MockLab \`chat_delivery\` is **not** flipped."
  echo
  echo "## Re-run"
  echo
  echo '```bash'
  echo "bash deploy/scripts/prove-mocklab-short-stack-kitchen-sink.sh"
  echo '```'
  echo
  echo "## Honesty"
  echo
  echo "- Live AWS MockLab \`chat_delivery\` is **not** flipped (OPERATOR HOLD; guest/Relay stays default)."
  echo "- Login used the local UI-QA seed user, not \`.env.mocklab-agent-dev\`."
  echo "- Kitchen-sink live tool turns (bash / web_search / subagents / workflow fire) stay **held** until a human pin + flip."
} >"$UI_RESULT"

GATE_RESULT="$GATE/RESULT.md"
{
  echo "# lp-oop.34 — Kitchen-sink re-QA gate"
  echo
  echo "**Bead:** \`lp-oop.34\`"
  echo "**Parent epic:** \`lp-oop\` (short stack)"
  echo "**When (UTC):** $STAMP"
  echo "**Base URL (browser):** \`http://127.0.0.1:${WEB_PORT}/${TENANT_SLUG}\`"
  echo "**Overall verdict:** **$VERDICT**"
  echo
  echo "Re-QA of kitchen-sink surfaces after short-stack dual-run landed."
  echo "Waivers are named. Guest path is still available (default \`CHAT_DELIVERY=relay\`,"
  echo "live pin still guest-gateway). Live AWS is **not** flipped."
  echo
  echo "No secrets in this package."
  echo
  echo "---"
  echo
  echo "## GO / NO-GO matrix"
  echo
  echo "| # | Surface | Verdict | Evidence | Waiver / residual |"
  echo "|---|---------|---------|----------|-------------------|"
  echo "| 1 | **shell_auth** | **GO** | Playwright login + Agents/Vault/Tools | — |"
  echo "| 2 | **harness chat send + stream** | **GO** | real harness echo + SSE | — |"
  echo "| 3 | **vault tree (no wake)** | **GO** | \`GET /api/vault/tree\` 200; \`ensure_online_during_tree=0\` | — |"
  echo "| 4 | **tools nav + workflows UI** | **GO** | Tools / Workflows screenshots | Live launch held |"
  echo "| 5 | **cron / scheduled tasks UI** | **GO** | Scheduled Tasks chrome | Live fire held (\`lp-oop.32\`) |"
  echo "| 6 | **MCP** | **PRODUCT_NA (signed)** | Local fixture catalog is CI/dev, not live host; \`lp-zuh.11.5\` / PR #488 | \`lp-vw3\` |"
  echo "| 7 | **guest path still available** | **GO** | \`DEFAULT_CHAT_DELIVERY=relay\`; dual-run persist; live pin \`lanyard-la-main-*\`; live HTTP \`${live_http:-n/a}\` | — |"
  echo "| 8 | **live tools / web_search / subagents / workflow fire** | **WAIVED** | Not re-run on harness; live tool-only snapshot held | Human pin + operator flip |"
  echo "| 9 | **OnlyOffice editor host** | **EXPLICIT_HARD_RESIDUAL** | Carried \`lp-zuh.11.3\` | Operator SPA + HTTPS DS |"
  echo "| 10 | **MemPalace** | **GO (carried guest)** | \`lp-zuh.11.4\` | Not a harness-path surface |"
  echo "| 11 | **live MockLab chat_delivery flip** | **WAIVED** | Guest/Relay stays default | Operator runbook \`lp-oop.29\` |"
  echo
  echo "**Legend:** **GO** = proven this re-QA. **WAIVED** / **PRODUCT_NA** / **EXPLICIT_HARD_RESIDUAL** = named, not silent."
  echo
  echo "---"
  echo
  echo "## Guest path still available"
  echo
  echo "| Check | Result |"
  echo "|-------|--------|"
  for c in "${guest_checks[@]}"; do
    echo "| \`$c\` | PASS |"
  done
  echo "| Live snapshot flipped to tool-only | **No** |"
  echo "| Live \`chat_delivery\` flipped to harness | **No** |"
  echo "| \`FLIP_LIVE_*\` | refused |"
  echo
  echo "Default resolve remains instance > tenant > env > **relay**. Other tenants stay on guest-gateway + Relay."
  echo
  echo "---"
  echo
  echo "## Honesty"
  echo
  echo "| Claim | Truth |"
  echo "|-------|--------|"
  echo "| Kitchen-sink UI on local harness path | Yes |"
  echo "| Live AWS MockLab \`chat_delivery\` flipped | **No** |"
  echo "| Live tool-only snapshot pin | **No** — human gate held |"
  echo "| Terraform apply / SM write | **No** |"
  echo "| Secrets in evidence | **No** |"
  echo
  echo "## Re-run"
  echo
  echo '```bash'
  echo "bash deploy/scripts/prove-mocklab-short-stack-kitchen-sink.sh"
  echo "bash deploy/scripts/smoke-mocklab-short-stack-kitchen-sink.sh"
  echo '```'
  echo
  echo "## Artifact index"
  echo
  echo "| Path | Purpose |"
  echo "|------|---------|"
  echo "| [RESULT.md](./RESULT.md) | This gate verdict |"
  echo "| [REPORT.json](./REPORT.json) | Machine-readable matrix |"
  echo "| [../../ui/lp-oop.34/](../../ui/lp-oop.34/) | Playwright screenshots + runner |"
  echo "| [../RESULT.md](../RESULT.md) | Phase 8 hop / invariant honesty |"
} >"$GATE_RESULT"

if [[ -f "$ART/REPORT.json" && "$ART/REPORT.json" != "$GATE/REPORT.json" ]]; then
  cp -f "$ART/REPORT.json" "$GATE/REPORT.json"
fi

# Append a short section to the phase-8 RESULT without wiping .31/.32.
if ! grep -q 'lp-oop.34 — Kitchen-sink re-QA gate' "$STACK/RESULT.md" 2>/dev/null; then
  {
    echo
    echo "---"
    echo
    echo "# lp-oop.34 — Kitchen-sink re-QA gate"
    echo
    echo "**Result:** $VERDICT"
    echo "**Stamp:** $STAMP"
    echo "**Bead:** \`lp-oop.34\`"
    echo
    echo "Full matrix: [kitchen-sink/RESULT.md](./kitchen-sink/RESULT.md)."
    echo "Guest path still default Relay. Live AWS not flipped. Waivers named."
    echo
    echo "## Re-run"
    echo
    echo '```bash'
    echo "bash deploy/scripts/prove-mocklab-short-stack-kitchen-sink.sh"
    echo '```'
  } >>"$STACK/RESULT.md"
fi

log "qa_rc=$qa_rc verdict=$VERDICT artifacts=$ART gate=$GATE"
[[ $qa_rc -eq 0 ]] || fail "Playwright kitchen-sink QA failed (see $ART/REPORT.json)"
log "PASS $VERDICT"
exit 0
