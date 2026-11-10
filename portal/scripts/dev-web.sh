#!/usr/bin/env bash
# Start the Vite web dev server with demo-env OnlyOffice flags when present.
#
# lp-upc: VITE_ONLYOFFICE_EDITOR / VITE_ONLYOFFICE_DS_URL are build-time (Vite
# injects import.meta.env at process start). Sourcing after vite starts has no
# effect. Default file open is always client VaultReader preview; OnlyOffice is
# Edit-only behind the feature flag + Document Server URL + vault_edit.
#
# Usage (from portal/):
#   bash scripts/dev-web.sh
#   pnpm dev:web
#
# Optional overrides:
#   VITE_ONLYOFFICE_EDITOR=false bash scripts/dev-web.sh
#   VITE_ONLYOFFICE_DS_URL=http://127.0.0.1:8080 bash scripts/dev-web.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/.data/demo-env.sh" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT/.data/demo-env.sh"
fi

# Lab defaults when seed has not run yet (harmless if DS is down — Edit fails
# closed to preview). Set VITE_ONLYOFFICE_EDITOR=false to force preview-only.
export VITE_ONLYOFFICE_EDITOR="${VITE_ONLYOFFICE_EDITOR:-true}"
export VITE_ONLYOFFICE_DS_URL="${VITE_ONLYOFFICE_DS_URL:-http://127.0.0.1:8080}"

echo "dev-web: VITE_ONLYOFFICE_EDITOR=$VITE_ONLYOFFICE_EDITOR"
echo "dev-web: VITE_ONLYOFFICE_DS_URL=$VITE_ONLYOFFICE_DS_URL"
echo "dev-web: default open = client preview; OnlyOffice = Edit when DS+flag+vault_edit"

exec pnpm --filter @lanyard/web run dev
