#!/usr/bin/env bash
# lp-oop.36 — Browser no-tool turn on the harness path (lp-oop.31 acceptance).
#
# Starts a local BFF (ChatDelivery=harness) + Vite, drives Playwright, writes
# artifacts/ui/lp-oop.36/. Does not flip live AWS chat_delivery. Does not
# terraform apply. Does not print secret values.
#
# Usage (from monorepo root):
#   bash deploy/scripts/prove-mocklab-short-stack-no-tool-ui.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ART="${UI_ARTIFACTS:-$ROOT/artifacts/ui/lp-oop.36}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$ART/prove-${STAMP}.log"
BFF_PORT="${BFF_PORT:-4136}"
WEB_PORT="${WEB_PORT:-3136}"
TENANT_SLUG="${UI_QA_TENANT_SLUG:-mocklab}"
EMAIL="${UI_QA_EMAIL:-agent-dev@mocklab.local}"
PASSWORD="${UI_QA_PASSWORD:-local-dev-password}"
MAIN_PORTAL="${LANYARD_PLATFORM_CHECKOUT:-/home/operator/Lanyard-Dev/lanyard-platform}/portal"
TSX="${TSX:-$MAIN_PORTAL/node_modules/.bin/tsx}"
VITE="${VITE:-$MAIN_PORTAL/packages/web/node_modules/.bin/vite}"
PY="${WEB_UI_PY:-$HOME/.grok/skills/web-ui-testing/.venv/bin/python}"
KILL_BROWSERS="$HOME/.grok/skills/web-ui-testing/scripts/kill_browsers.sh"

mkdir -p "$ART"

err() { echo "[prove-mocklab-short-stack-no-tool-ui] ERROR: $*" >&2; }
log() { echo "[prove-mocklab-short-stack-no-tool-ui] $*"; }
fail() { err "$*"; exit 1; }

exec > >(tee -a "$LOG") 2>&1

echo "== lp-oop.36 prove-mocklab-short-stack-no-tool-ui =="
echo "ROOT=$ROOT STAMP=$STAMP BFF_PORT=$BFF_PORT WEB_PORT=$WEB_PORT"

[[ -x "$TSX" ]] || fail "tsx not found at $TSX (portal install required)"
[[ -x "$VITE" ]] || fail "vite not found at $VITE"
[[ -x "$PY" ]] || fail "Playwright python missing ($PY). Run web-ui-testing doctor."

BFF_PID=""
WEB_PID=""
cleanup() {
  if [[ -n "$WEB_PID" ]] && kill -0 "$WEB_PID" 2>/dev/null; then
    kill "$WEB_PID" 2>/dev/null || true
    wait "$WEB_PID" 2>/dev/null || true
  fi
  if [[ -n "$BFF_PID" ]] && kill -0 "$BFF_PID" 2>/dev/null; then
    kill "$BFF_PID" 2>/dev/null || true
    wait "$BFF_PID" 2>/dev/null || true
  fi
  if [[ -x "$KILL_BROWSERS" ]]; then
    bash "$KILL_BROWSERS" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# Isolated worktree: compile workspace pkgs this BFF imports and point
# @lanyard/* at *this* tree (main checkout shared may predate harness).
TSC="${TSC:-$MAIN_PORTAL/packages/shared/node_modules/.bin/tsc}"
[[ -x "$TSC" ]] || fail "tsc not found at $TSC"
if [[ ! -e "$ROOT/portal/packages/shared/node_modules" && -d "$MAIN_PORTAL/packages/shared/node_modules" ]]; then
  ln -sfn "$MAIN_PORTAL/packages/shared/node_modules" "$ROOT/portal/packages/shared/node_modules"
fi
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

log "starting harness-path BFF on 127.0.0.1:$BFF_PORT"
(
  cd "$ROOT/portal/packages/bff"
  env -u HARNESS_SERVICE_TOKEN -u LANYARD_HARNESS_SERVICE_TOKEN \
    BFF_PORT="$BFF_PORT" \
    UI_QA_TENANT_SLUG="$TENANT_SLUG" \
    UI_QA_EMAIL="$EMAIL" \
    UI_QA_PASSWORD="$PASSWORD" \
    "$TSX" scripts/serve-short-stack-ui-qa.ts
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

# Prefer the installed product web tree (this worktree is apps/web without
# its own pnpm install). UI is unchanged on this leaf.
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
export UI_QA_MARKER="lp-oop.36-ui-no-tool-ping"

log "Playwright $BASE_URL"
set +e
"$PY" "$ART/run_qa.py"
qa_rc=$?
set -e

# Mirror proof shots into lp-oop.31 so the original acceptance path has PNGs.
MIRROR="$ROOT/artifacts/ui/lp-oop.31"
mkdir -p "$MIRROR"
for f in 01-login-home.png 02-agents.png 03-new-chat-composer.png \
         04-prompt-sent.png 05-assistant-reply.png REPORT.json; do
  if [[ -f "$ART/$f" ]]; then
    cp -f "$ART/$f" "$MIRROR/$f"
  fi
done

RESULT="$ART/RESULT.md"
{
  echo "# lp-oop.36 — harness-path no-tool UI proof"
  echo
  echo "**Result:** $([[ $qa_rc -eq 0 ]] && echo PASS || echo FAIL)"
  echo "**Stamp:** $STAMP"
  echo "**Bead:** \`lp-oop.36\` (UI re-open of \`lp-oop.31\`)"
  echo
  echo "## Hop"
  echo
  echo '```'
  echo "Browser  ─HTTP + SSE─►  BFF (CHAT_DELIVERY=harness)  ─HTTP + SSE─►  Harness"
  echo '```'
  echo
  echo "Relay was **not** on the hop (see \`REPORT.json\` \`hop.relay\`). Live AWS MockLab \`chat_delivery\` is **not** flipped."
  echo
  echo "## Re-run"
  echo
  echo '```bash'
  echo "bash deploy/scripts/prove-mocklab-short-stack-no-tool-ui.sh"
  echo '```'
  echo
  echo "## Honesty"
  echo
  echo "- Live AWS browser path stays guest-gateway + Relay (Hermes 504 on production is out of this leaf)."
  echo "- Playwright on a flipped MockLab is \`lp-oop.33\`."
  echo "- Login used the local UI-QA seed user, not \`.env.mocklab-agent-dev\`."
} >"$RESULT"

log "qa_rc=$qa_rc artifacts=$ART"
[[ $qa_rc -eq 0 ]] || fail "Playwright UI QA failed (see $ART/REPORT.json)"
log "PASS"
exit 0
