#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${ROOT}/skills/self-improve"
DEST="${HERMES_HOME:-$HOME/.hermes}/skills/self-improve"

if [ ! -d "$SRC" ]; then
  echo "Missing skill source: $SRC" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST")"
rsync -a --delete "$SRC/" "$DEST/"
echo "Synced self-improve skill to $DEST"