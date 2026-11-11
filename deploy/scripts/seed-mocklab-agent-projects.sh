#!/usr/bin/env bash
# Seed MockLab default agent project into projects.db (lp-zuh.10.7).
#
# Product defaults after vault seed (lp-zuh.9.5):
#   Workspace → /mnt/vault/Projects/Workspace  (primary_path under vault)
#
# Usage:
#   bash deploy/scripts/seed-mocklab-agent-projects.sh
#   BACKEND_HOME=/var/lib/company-brain-backend VAULT_ROOT=/mnt/vault \
#     bash deploy/scripts/seed-mocklab-agent-projects.sh
#   bash deploy/scripts/seed-mocklab-agent-projects.sh --list-only
#   bash deploy/scripts/seed-mocklab-agent-projects.sh --dry-run
#
# On Daytona guest (after image bake with seed-default-projects.py):
#   python3 /usr/local/lib/lanyard/seed-default-projects.py
#
# Idempotent. Does not write secrets. Does not call network.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SEED_PY_CANDIDATES=(
  "${SEED_DEFAULT_PROJECTS_PY:-}"
  "/usr/local/lib/lanyard/seed-default-projects.py"
  "${ROOT}/deploy/daytona/agent-gateway/seed-default-projects.py"
)

SEED_PY=""
for c in "${SEED_PY_CANDIDATES[@]}"; do
  [[ -n "$c" && -f "$c" ]] || continue
  SEED_PY="$c"
  break
done

if [[ -z "$SEED_PY" ]]; then
  echo "[seed-mocklab-agent-projects] ERROR: seed-default-projects.py not found" >&2
  echo "  tried: ${SEED_PY_CANDIDATES[*]}" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "[seed-mocklab-agent-projects] ERROR: python3 required" >&2
  exit 1
fi

BACKEND_HOME="${BACKEND_HOME:-/var/lib/company-brain-backend}"
VAULT_ROOT="${VAULT_ROOT:-/mnt/vault}"

echo "[seed-mocklab-agent-projects] SEED_PY=$SEED_PY" >&2
exec python3 "$SEED_PY" \
  --backend-home "$BACKEND_HOME" \
  --vault-root "$VAULT_ROOT" \
  "$@"