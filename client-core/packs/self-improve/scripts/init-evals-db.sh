#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <VaultRoot>" >&2
  echo "Creates <VaultRoot>/evals.db from Core self-improve schema (idempotent)." >&2
  exit 1
fi

VAULT_ROOT="$(cd "$1" && pwd)"
PY="${ROOT}/skills/self-improve/scripts/self_improve_tools.py"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required" >&2
  exit 1
fi

python3 "$PY" init-eval-db --vault-root "$VAULT_ROOT"