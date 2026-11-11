#!/usr/bin/env bash
# Connect local Hermes gateway (real brain) to Portal relay as lanyard_web.
# Knowledge vault: $HOME/Lanyard (MemPalace / company brain). Runtime: ~/.hermes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${PORTAL_DATA_DIR:-$ROOT/.data}/demo-env.sh"
BRAIN_ROOT="${LANYARD_BRAIN_ROOT:-$HOME/Lanyard}"

if [[ ! -d "$BRAIN_ROOT" ]]; then
  echo "Lanyard brain directory not found: $BRAIN_ROOT" >&2
  echo "Set LANYARD_BRAIN_ROOT if your vault lives elsewhere." >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — start control-plane and run scripts/seed-demo-tenant.sh" >&2
  exit 1
fi

# shellcheck source=/dev/null
source "$ENV_FILE"

if [[ -z "${RELAY_DEV_SECRETS:-}" ]]; then
  echo "RELAY_DEV_SECRETS is empty. Re-run scripts/seed-demo-tenant.sh" >&2
  exit 1
fi

if ! command -v hermes >/dev/null 2>&1; then
  echo "hermes CLI not found on PATH (install Hermes agent)." >&2
  exit 1
fi

eval "$(python3 - <<'PY'
import json, os, shlex
raw = os.environ.get("RELAY_DEV_SECRETS", "[]")
seeds = json.loads(raw)
if not seeds:
    raise SystemExit("RELAY_DEV_SECRETS has no entries")
s = seeds[0]
for k in ("gatewayId", "instanceId", "secret"):
    if not s.get(k):
        raise SystemExit(f"RELAY_DEV_SECRETS missing {k}")
print(f"export GATEWAY_RELAY_ID={shlex.quote(s['gatewayId'])}")
print(f"export GATEWAY_RELAY_INSTANCE_ID={shlex.quote(s['instanceId'])}")
print(f"export GATEWAY_RELAY_SECRET={shlex.quote(s['secret'])}")
PY
)"

export GATEWAY_RELAY_URL="${GATEWAY_RELAY_URL:-ws://127.0.0.1:8787/relay}"
export GATEWAY_RELAY_PLATFORMS=lanyard_web
export GATEWAY_RELAY_BOT_IDS='{"lanyard_web":{"botId":"lanyard-web"}}'
export TERMINAL_CWD="$BRAIN_ROOT"

echo "Hermes gateway → Portal relay (lanyard_web)"
echo "  relay:     $GATEWAY_RELAY_URL"
echo "  gatewayId: $GATEWAY_RELAY_ID"
echo "  instance:  $GATEWAY_RELAY_INSTANCE_ID"
echo "  brain cwd: $TERMINAL_CWD"
echo ""
echo "Only ONE brain per instanceId (last connect wins)."
echo "  Prefer: ./scripts/portal-gateway-mode.sh hermes"
echo "  Or stop mock: tmux kill-window -t lanyard-portal:mock-gateway"
echo "  Or stop Hermes later for tools demo: systemctl --user stop hermes-gateway.service"
echo "Portal UI: http://demo.localhost:3010  (dev@demo.local — testing.md)"
echo ""

# Soft-stop mock so this Hermes process can own the session
if pgrep -f 'scripts/dev-mock-gateway' >/dev/null 2>&1; then
  echo "Warning: mock-gateway process looks running — kill it or tools/chat routing will fight."
fi

cd "$BRAIN_ROOT"
exec hermes gateway run --accept-hooks
