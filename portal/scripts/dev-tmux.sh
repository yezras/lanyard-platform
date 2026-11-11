#!/usr/bin/env bash
# Start portal dev stack in tmux: control-plane, relay, bff, web (one window each).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SESSION="${PORTAL_TMUX_SESSION:-lanyard-portal}"
CP_URL="${CONTROL_PLANE_URL:-http://127.0.0.1:3100}"
DATA_DIR="${PORTAL_DATA_DIR:-$ROOT/.data}"
mkdir -p "$DATA_DIR"
# G4.1: Postgres (docker compose service). Override with CONTROL_PLANE_DATABASE_URL.
DEFAULT_PG_URL="postgres://portal:portal@127.0.0.1:5432/portal_cp"
export CONTROL_PLANE_DATABASE_URL="${CONTROL_PLANE_DATABASE_URL:-${DATABASE_URL:-$DEFAULT_PG_URL}}"
export DATABASE_URL="${DATABASE_URL:-$CONTROL_PLANE_DATABASE_URL}"
# G1.2: CP fails closed without CONTROL_PLANE_SERVICE_TOKEN (or explicit
# CONTROL_PLANE_DEV_OPEN). Local placeholder matches seed/BFF/docker-compose;
# production rejects this value. Override via env if needed.
export CONTROL_PLANE_SERVICE_TOKEN="${CONTROL_PLANE_SERVICE_TOKEN:-placeholder-control-plane-service-token}"

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is not installed. Install tmux or run the four terminals from README.md"
  exit 1
fi

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "Attaching to existing session: $SESSION"
  if [[ "${PORTAL_TMUX_NO_ATTACH:-}" == "1" ]]; then
    exit 0
  fi
  exec tmux attach -t "$SESSION"
fi

cd "$ROOT"

# Start local Postgres if docker is available (G4.1).
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "Ensuring local Postgres (docker compose)…"
  docker compose up -d postgres >/dev/null
  for _ in $(seq 1 30); do
    if docker compose exec -T postgres pg_isready -U portal -d portal_cp >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
else
  echo "docker not available — ensure Postgres is reachable at CONTROL_PLANE_DATABASE_URL"
fi

wait_for_cp() {
  for _ in $(seq 1 45); do
    if curl -sf "$CP_URL/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "control-plane did not become healthy at $CP_URL/health"
  return 1
}

tmux new-session -d -s "$SESSION" -n control-plane -c "$ROOT" \
  "export CONTROL_PLANE_DATABASE_URL='$CONTROL_PLANE_DATABASE_URL' DATABASE_URL='$DATABASE_URL' CONTROL_PLANE_URL='$CP_URL' CONTROL_PLANE_SERVICE_TOKEN='$CONTROL_PLANE_SERVICE_TOKEN'; pnpm dev:control-plane"

echo "Waiting for control-plane…"
wait_for_cp

# Seed presents the same service token (header) that CP was started with.
CONTROL_PLANE_SERVICE_TOKEN="$CONTROL_PLANE_SERVICE_TOKEN" \
  CONTROL_PLANE_URL="$CP_URL" \
  "$ROOT/scripts/seed-demo-tenant.sh"
CONTROL_PLANE_SERVICE_TOKEN="$CONTROL_PLANE_SERVICE_TOKEN" \
  "$ROOT/scripts/assign-demo-member-roles.sh" || true

tmux new-window -t "$SESSION" -n relay -c "$ROOT" \
  "source '$ROOT/.data/demo-env.sh' 2>/dev/null || true; pnpm dev:relay"

# Hermes user unit shares demo gatewayId/instanceId — stop it so mock owns chat tools.
if systemctl --user is-active --quiet hermes-gateway.service 2>/dev/null; then
  echo "Stopping hermes-gateway.service so mock-gateway can own the relay session…"
  systemctl --user stop hermes-gateway.service || true
fi

tmux new-window -t "$SESSION" -n mock-gateway -c "$ROOT" \
  "source '$ROOT/.data/demo-env.sh' 2>/dev/null || true; sleep 2; pnpm dev:mock-gateway"

tmux new-window -t "$SESSION" -n bff -c "$ROOT" \
  "source '$ROOT/.data/demo-env.sh' 2>/dev/null || true; pnpm dev:bff"

# lp-upc: web must source demo-env so Vite sees VITE_ONLYOFFICE_EDITOR / DS URL
# at process start. Default open stays client preview; Edit needs flag+DS.
tmux new-window -t "$SESSION" -n web -c "$ROOT" \
  "source '$ROOT/.data/demo-env.sh' 2>/dev/null || true; pnpm --filter @lanyard/web run dev"

tmux select-window -t "$SESSION:control-plane"

echo ""
echo "Portal stack in tmux session: $SESSION"
echo "  Windows: control-plane | relay | bff | web  (Ctrl-b n / Ctrl-b p)"
echo "  UI:  http://demo.localhost:3010  (or http://localhost:3010)"
echo "  OnlyOffice Edit env: sourced from .data/demo-env.sh when present (VITE_ONLYOFFICE_*)"
echo "  Attach: tmux attach -t $SESSION"
echo "  Detach: Ctrl-b d"
echo ""

if [[ "${PORTAL_TMUX_NO_ATTACH:-}" == "1" ]]; then
  exit 0
fi

exec tmux attach -t "$SESSION"