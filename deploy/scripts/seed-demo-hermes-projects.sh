#!/usr/bin/env bash
# Register demo Hermes projects for lab/mocklab (Legal + Operations).
#
# Depends on phase 5 filesystem seed (scripts/seed-demo-vault.sh) so folder
# paths exist under VAULT_ROOT. Writes into the Hermes runtime projects.db
# (default: /home/hermes/.hermes/projects.db via HERMES_HOME).
#
# Usage (on host as root, after vault seed):
#   sudo bash scripts/seed-demo-hermes-projects.sh
#   sudo bash scripts/seed-demo-hermes-projects.sh --dry-run
#   sudo bash scripts/seed-demo-hermes-projects.sh --list-only
#
# Idempotent: skips create when slug already exists (does not auto-suffix
# legal-2 — hermes create would otherwise invent a new slug).
#
# See: references/plans/lanyard-hermes-gateway-and-mocklab-vault/phase-6-projects-rbac.md
set -euo pipefail

VAULT_ROOT="${VAULT_ROOT:-/opt/company-brain}"
HERMES_BIN="${HERMES_BIN:-/opt/hermes-lanyard/bin/hermes}"
RUNTIME_USER="${RUNTIME_USER:-hermes}"
HERMES_HOME_DEFAULT="/home/${RUNTIME_USER}/.hermes"
HERMES_HOME="${HERMES_HOME:-$HERMES_HOME_DEFAULT}"
DRY_RUN="${DRY_RUN:-0}"
LIST_ONLY="${LIST_ONLY:-0}"

usage() {
  cat <<EOF
Usage: $0 [options]

  --vault-root PATH   Vault root (default: /opt/company-brain or \$VAULT_ROOT)
  --hermes-bin PATH   Hermes CLI (default: /opt/hermes-lanyard/bin/hermes)
  --hermes-home PATH  HERMES_HOME for projects.db (default: /home/hermes/.hermes)
  --runtime-user NAME Unix user to run hermes as when root (default: hermes)
  --dry-run           Print actions only; do not create
  --list-only         Only run hermes project list as runtime user
  -h, --help          This help

Environment: VAULT_ROOT, HERMES_BIN, HERMES_HOME, RUNTIME_USER, DRY_RUN
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --vault-root) VAULT_ROOT="$2"; shift 2 ;;
    --hermes-bin) HERMES_BIN="$2"; shift 2 ;;
    --hermes-home) HERMES_HOME="$2"; shift 2 ;;
    --runtime-user) RUNTIME_USER="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --list-only) LIST_ONLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

log() { echo "[seed-demo-hermes-projects] $*"; }
warn() { echo "[seed-demo-hermes-projects] WARN: $*" >&2; }
err() { echo "[seed-demo-hermes-projects] ERROR: $*" >&2; }

if [ ! -x "$HERMES_BIN" ]; then
  err "hermes binary not executable: $HERMES_BIN"
  exit 1
fi

# Run hermes as the runtime user when invoked as root (gateway owns projects.db).
run_hermes() {
  if [ "$(id -u)" -eq 0 ] && id -u "$RUNTIME_USER" >/dev/null 2>&1; then
    runuser -u "$RUNTIME_USER" -- env \
      HOME="/home/${RUNTIME_USER}" \
      HERMES_HOME="$HERMES_HOME" \
      VAULT_ROOT="$VAULT_ROOT" \
      PATH="$(dirname "$HERMES_BIN"):/usr/bin:/bin" \
      "$HERMES_BIN" "$@"
  else
    env HOME="${HOME:-/home/${RUNTIME_USER}}" \
      HERMES_HOME="$HERMES_HOME" \
      VAULT_ROOT="$VAULT_ROOT" \
      PATH="$(dirname "$HERMES_BIN"):${PATH:-/usr/bin:/bin}" \
      "$HERMES_BIN" "$@"
  fi
}

# True if slug already registered (active or would collide).
slug_exists() {
  local slug="$1"
  # project show exits non-zero when missing
  if run_hermes project show "$slug" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

ensure_project() {
  local name="$1" slug="$2" folder="$3" desc="$4"

  if [ ! -d "$folder" ]; then
    err "folder missing (run seed-demo-vault.sh first): $folder"
    exit 2
  fi

  if slug_exists "$slug"; then
    log "skip (exists): $slug → $folder"
    return 0
  fi

  if [ "$DRY_RUN" = "1" ]; then
    log "dry-run create: $name ($slug) → $folder"
    return 0
  fi

  log "create: $name ($slug) → $folder"
  run_hermes project create "$name" "$folder" \
    --slug "$slug" \
    --description "$desc"
}

if [ "$LIST_ONLY" = "1" ]; then
  run_hermes project list
  exit 0
fi

log "HERMES_BIN=$HERMES_BIN"
log "HERMES_HOME=$HERMES_HOME"
log "VAULT_ROOT=$VAULT_ROOT"
log "RUNTIME_USER=$RUNTIME_USER dry_run=$DRY_RUN"

# Fix ownership if an earlier root-run created projects.db as root (harmless if ok).
if [ "$(id -u)" -eq 0 ] && [ -f "${HERMES_HOME}/projects.db" ]; then
  if [ -n "$(stat -c '%U' "${HERMES_HOME}/projects.db" 2>/dev/null || true)" ]; then
    owner="$(stat -c '%U' "${HERMES_HOME}/projects.db" 2>/dev/null || true)"
    if [ "$owner" = "root" ]; then
      warn "chown projects.db from root → $RUNTIME_USER"
      chown "${RUNTIME_USER}:${RUNTIME_USER}" \
        "${HERMES_HOME}/projects.db" \
        "${HERMES_HOME}/projects.db-wal" \
        "${HERMES_HOME}/projects.db-shm" 2>/dev/null || true
    fi
  fi
fi

ensure_project "Legal" "legal" \
  "${VAULT_ROOT}/Projects/Legal" \
  "Demo Legal project (synthetic)"

ensure_project "Operations" "operations" \
  "${VAULT_ROOT}/Projects/Operations" \
  "Demo Operations project (synthetic)"

log "--- hermes project list ---"
run_hermes project list || true

if [ -f "${HERMES_HOME}/projects.db" ]; then
  log "projects.db: ${HERMES_HOME}/projects.db ($(stat -c '%U:%G %a' "${HERMES_HOME}/projects.db" 2>/dev/null || echo present))"
fi

log "done"
