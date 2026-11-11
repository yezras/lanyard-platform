#!/usr/bin/env bash
# Start the LA HTTP turn server from a local lanyard-agent checkout (lp-oop.30).
# Lab only. No AWS. Requires LANYARD_AGENT_ROOT pointing at a built tree that
# exports createHarnessTurnServer (@lanyard-agent/adapters-portal, PR 242).
#
# Kitchen-sink BACKEND_HOME (lp-oop.38.18): materialize vault seed
# config.yaml + skills/workflows into a writable home, then exec
# start-la-harness.mjs (settings snapshot loader).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="$(cd "$ROOT/../.." && pwd)"

fail() { echo "[run-lab-harness] ERROR: $*" >&2; exit 1; }
log() { echo "[run-lab-harness] $*"; }

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

AGENT_ROOT="${LANYARD_AGENT_ROOT:-}"
[[ -n "$AGENT_ROOT" ]] || fail "set LANYARD_AGENT_ROOT to a lanyard-agent checkout"
[[ -d "$AGENT_ROOT" ]] || fail "LANYARD_AGENT_ROOT is not a directory: $AGENT_ROOT"

# Prefer harness subtree (start wrapper remaps package-root dist/index.js).
CANDIDATES=(
  "$AGENT_ROOT/packages/adapters-portal/dist/harness/index.js"
  "$AGENT_ROOT/packages/adapters-portal/dist/index.js"
)
MODULE=""
for c in "${CANDIDATES[@]}"; do
  if [[ -f "$c" ]]; then
    MODULE="$c"
    break
  fi
done
[[ -n "$MODULE" ]] || fail "build @lanyard-agent/adapters-portal first (missing dist/harness/index.js under $AGENT_ROOT)"

HOST="${HARNESS_HOST:-127.0.0.1}"
PORT="${HARNESS_PORT:-${HARNESS_HOST_PORT:-8080}}"
TOKEN="${LANYARD_HARNESS_SERVICE_TOKEN:-${HARNESS_SERVICE_TOKEN:-placeholder-harness-service-token}}"
[[ -n "$TOKEN" ]] || fail "HARNESS_SERVICE_TOKEN / LANYARD_HARNESS_SERVICE_TOKEN is empty"

BACKEND_HOME="${BACKEND_HOME:-${LANYARD_BACKEND_HOME:-$ROOT/.backend-home}}"
bash "$DEPLOY/scripts/materialize-mocklab-harness-backend-home.sh" --dest "$BACKEND_HOME" \
  || fail "could not materialize kitchen-sink BACKEND_HOME"

export HARNESS_HOST="$HOST"
export HARNESS_PORT="$PORT"
export LANYARD_HARNESS_SERVICE_TOKEN="$TOKEN"
export HARNESS_SERVICE_TOKEN="$TOKEN"
export HARNESS_MODULE="$MODULE"
export BACKEND_HOME

log "module=$MODULE host=$HOST port=$PORT BACKEND_HOME=$BACKEND_HOME"
log "guest CHAT_DELIVERY stays relay unless lab BFF is flipped"

# createHarnessTurnServer + settings snapshot via start-la-harness.mjs
exec node "$ROOT/start-la-harness.mjs"
