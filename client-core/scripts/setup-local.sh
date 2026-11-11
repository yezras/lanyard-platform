#!/usr/bin/env bash
# Verify/create empty scaffold for a client-core vault seed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p \
  "$ROOT/Clients/Active" \
  "$ROOT/Clients/Discovery" \
  "$ROOT/Clients/Prospect" \
  "$ROOT/Clients/Graveyard" \
  "$ROOT/Knowledge" \
  "$ROOT/Projects" \
  "$ROOT/staging/uploads" \
  "$ROOT/memory/deep" \
  "$ROOT/packs"

# Keep gitkeep markers for empty dirs
for d in \
  "$ROOT/Clients/Active" \
  "$ROOT/Clients/Discovery" \
  "$ROOT/Clients/Prospect" \
  "$ROOT/Clients/Graveyard" \
  "$ROOT/Knowledge" \
  "$ROOT/Projects" \
  "$ROOT/staging/uploads"
do
  touch "$d/.gitkeep"
done

for cmd in git rg sqlite3; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing optional/required command: $cmd" >&2
  fi
done

if ! command -v wacli >/dev/null 2>&1; then
  echo "Optional: wacli not installed (enable pack wacli + packs/wacli/tools/wacli/install-wacli.sh)" >&2
fi

if ! command -v focr >/dev/null 2>&1; then
  echo "Optional: focr not installed (enable pack focr)" >&2
fi

echo "client-core scaffold verified at $ROOT"
echo "Enable packs with: $ROOT/scripts/enable-pack.sh <name>"
