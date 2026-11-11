#!/usr/bin/env bash
# Copy MockLab kitchen-sink config.yaml + skills/workflows trees into a
# writable BACKEND_HOME (lp-oop.38.18). Same document as the vault seed pack.
#
# Does not copy the Daytona guest product tree. Does not restore a fat snapshot.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="${MOCKLAB_VAULT_SEED_SOURCE:-$ROOT/artifacts/mocklab-vault-seed}"
DEST="${BACKEND_HOME:-}"
FORCE="${FORCE:-0}"

usage() {
  cat <<EOF
Usage: $0 --dest BACKEND_HOME [--source DIR] [--force]

  --dest DIR    Writable harness BACKEND_HOME
  --source DIR  Vault seed pack (default: deploy/artifacts/mocklab-vault-seed)
  --force       Overwrite existing config.yaml / trees

Environment: BACKEND_HOME, MOCKLAB_VAULT_SEED_SOURCE, FORCE
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dest) DEST="$2"; shift 2 ;;
    --source) SOURCE="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

log() { echo "[materialize-mocklab-harness-backend-home] $*"; }
err() { echo "[materialize-mocklab-harness-backend-home] ERROR: $*" >&2; }

if [ -z "$DEST" ]; then
  err "provide --dest or BACKEND_HOME"
  exit 2
fi
if [ ! -d "$SOURCE" ]; then
  err "seed source not found: $SOURCE"
  exit 2
fi
if [ ! -f "$SOURCE/config.yaml" ]; then
  err "seed source missing config.yaml: $SOURCE"
  exit 2
fi

mkdir -p "$DEST"

copy_file() {
  local rel="$1"
  local src="$SOURCE/$rel"
  local dst="$DEST/$rel"
  if [ ! -e "$src" ]; then
    return 0
  fi
  mkdir -p "$(dirname "$dst")"
  if [ "$FORCE" != "1" ] && [ -e "$dst" ]; then
    return 0
  fi
  if command -v install >/dev/null 2>&1; then
    install -m 0644 "$src" "$dst"
  else
    cp -f "$src" "$dst"
    chmod 0644 "$dst"
  fi
}

copy_tree() {
  local rel="$1"
  local src="$SOURCE/$rel"
  if [ ! -d "$src" ]; then
    mkdir -p "$DEST/$rel"
    return 0
  fi
  mkdir -p "$DEST/$rel"
  (cd "$src" && find . -type f -print) | sed 's|^\./||' | while read -r f; do
    [ -n "$f" ] || continue
    copy_file "$rel/$f"
  done
}

copy_file "config.yaml"
copy_tree "skills"
copy_tree "workflows"
mkdir -p "$DEST/mempalace" "$DEST/cron" "$DEST/state"

log "BACKEND_HOME=$DEST"
log "config=$DEST/config.yaml"
