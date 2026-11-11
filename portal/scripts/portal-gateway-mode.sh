#!/usr/bin/env bash
# Exclusive gateway mode for local Portal chat.
#
# Relay maps one WebSocket session per instanceId (last connect wins). Mock and
# Hermes both use the seeded demo instance (RELAY_DEV_SECRETS[0]), so only ONE
# brain may be connected if you want predictable tool/citation SSE.
#
# Usage:
#   ./scripts/portal-gateway-mode.sh mock     # ChatToolCalls + citations demo
#   ./scripts/portal-gateway-mode.sh hermes   # real Hermes brain
#   ./scripts/portal-gateway-mode.sh status
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SESSION="${PORTAL_TMUX_SESSION:-lanyard-portal}"
MODE="${1:-}"

usage() {
  cat <<'EOF'
Usage: ./scripts/portal-gateway-mode.sh <mock|hermes|status>

  mock    Stop Hermes (systemd + processes), ensure mock-gateway owns relay
  hermes  Stop mock-gateway tmux window, start hermes-gateway.service (or hermes script)
  status  Show which brain is connected (best-effort)

Only one of mock / Hermes may hold gatewayId=dev-gateway at a time.
EOF
}

stop_hermes() {
  if systemctl --user is-active --quiet hermes-gateway.service 2>/dev/null; then
    echo "Stopping user systemd unit hermes-gateway.service …"
    systemctl --user stop hermes-gateway.service || true
  fi
  # Any ad-hoc hermes gateway run (not via the unit)
  for pid in $(ps -eo pid,cmd | awk '/hermes_cli\.main gateway run/ && !/awk/ {print $1}'); do
    echo "Stopping hermes gateway pid=$pid …"
    kill -TERM "$pid" 2>/dev/null || true
  done
  sleep 1
  for pid in $(ps -eo pid,cmd | awk '/hermes_cli\.main gateway run/ && !/awk/ {print $1}'); do
    kill -KILL "$pid" 2>/dev/null || true
  done
}

stop_mock_tmux() {
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    if tmux list-windows -t "$SESSION" -F '#{window_name}' 2>/dev/null | grep -qx 'mock-gateway'; then
      echo "Killing tmux window $SESSION:mock-gateway …"
      tmux kill-window -t "$SESSION:mock-gateway" 2>/dev/null || true
    fi
  fi
  for pid in $(ps -eo pid,cmd | awk '/scripts\/dev-mock-gateway|dev:mock-gateway/ && !/awk/ {print $1}'); do
    # kill tree root carefully — only mock node scripts
    case "$(ps -p "$pid" -o cmd= 2>/dev/null || true)" in
      *dev-mock-gateway*|*dev:mock-gateway*) kill -TERM "$pid" 2>/dev/null || true ;;
    esac
  done
}

start_mock_tmux() {
  if ! tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "No tmux session '$SESSION'. Start the stack with: pnpm dev:tmux" >&2
    echo "Then re-run: $0 mock" >&2
    exit 1
  fi
  stop_mock_tmux
  sleep 1
  echo "Starting mock-gateway in tmux session $SESSION …"
  tmux new-window -t "$SESSION" -n mock-gateway -c "$ROOT" \
    "source '$ROOT/.data/demo-env.sh' 2>/dev/null || true; pnpm dev:mock-gateway; echo EXIT:\$?; sleep 3600"
  sleep 2
  if tmux capture-pane -t "$SESSION:mock-gateway" -p -S -20 2>/dev/null | grep -q 'handshake complete'; then
    echo "mock-gateway: handshake complete — send a chat message to see tools + citations."
  else
    echo "mock-gateway started (check: tmux attach -t $SESSION, window mock-gateway)"
  fi
}

start_hermes() {
  stop_mock_tmux
  if systemctl --user list-unit-files 2>/dev/null | grep -q '^hermes-gateway.service'; then
    echo "Starting hermes-gateway.service …"
    systemctl --user start hermes-gateway.service
    sleep 1
    systemctl --user is-active hermes-gateway.service || true
  else
    echo "No hermes-gateway.service — run: ./scripts/dev-lanyard-hermes-gateway.sh"
  fi
  echo "Hermes mode: tools only appear if Hermes emits portal_event tool_progress"
  echo "  (or pure emoji tool chrome). Citations need metadata.citations or file tool targets."
}

show_status() {
  echo "Portal gateway exclusivity status"
  echo "  tmux session: $SESSION"
  if systemctl --user is-active --quiet hermes-gateway.service 2>/dev/null; then
    echo "  hermes-gateway.service: active"
  else
    echo "  hermes-gateway.service: inactive"
  fi
  if ps -eo cmd | awk '/hermes_cli\.main gateway run/ && !/awk/ {found=1} END{exit !found}'; then
    echo "  hermes process: running"
  else
    echo "  hermes process: not running"
  fi
  if ps -eo cmd | awk '/scripts\/dev-mock-gateway|dev:mock-gateway/ && !/awk/ {found=1} END{exit !found}'; then
    echo "  mock-gateway process: running"
  else
    echo "  mock-gateway process: not running"
  fi
  if tmux has-session -t "$SESSION" 2>/dev/null && \
    tmux list-windows -t "$SESSION" -F '#{window_name}' 2>/dev/null | grep -qx 'mock-gateway'; then
    echo "  tmux mock-gateway window: present"
  else
    echo "  tmux mock-gateway window: absent"
  fi
  echo ""
  echo "Both running at once → last connect owns instanceId; other never gets inbound."
}

case "$MODE" in
  mock)
    stop_hermes
    start_mock_tmux
    show_status
    ;;
  hermes)
    start_hermes
    show_status
    ;;
  status)
    show_status
    ;;
  *)
    usage
    exit 1
    ;;
esac
