#!/usr/bin/env bash
# Seed synthetic demo vault content for lab/mocklab (deploy-only; not client-core).
#
# Usage (from repo root or any cwd):
#   bash scripts/seed-demo-vault.sh
#   sudo VAULT_ROOT=/opt/company-brain bash scripts/seed-demo-vault.sh
#   bash scripts/seed-demo-vault.sh --vault-root /tmp/test-vault --force
#   bash scripts/seed-demo-vault.sh --dry-run
#
# Defaults:
#   VAULT_ROOT=/opt/company-brain
#   SOURCE= <repo>/artifacts/demo-vault
#
# Safety:
#   - Refuses paths that look like the employee vault
#   - Idempotent; does not overwrite non-demo files unless --force
#   - Optional hermes group access for runtime user (matches ensure-runtime-hardening)
#
# See: artifacts/demo-vault/README.md
#      references/plans/lanyard-hermes-gateway-and-mocklab-vault/phase-5-mock-vault-seed.md
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VAULT_ROOT="${VAULT_ROOT:-/opt/company-brain}"
SOURCE="${DEMO_VAULT_SOURCE:-$ROOT/artifacts/demo-vault}"
FORCE="${FORCE:-0}"
DRY_RUN="${DRY_RUN:-0}"
APPLY_OWNERSHIP="${APPLY_OWNERSHIP:-1}"
RUNTIME_USER="${RUNTIME_USER:-hermes}"
RUNTIME_GROUP="${RUNTIME_GROUP:-$RUNTIME_USER}"
DEMO_MARKER="company-brain-demo-vault"
SEED_MARKER_REL=".seed/demo-vault.seeded"

usage() {
  cat <<EOF
Usage: $0 [options]

  --vault-root PATH   Target vault (default: /opt/company-brain or \$VAULT_ROOT)
  --source DIR        Demo content tree (default: artifacts/demo-vault)
  --force             Overwrite existing files even if they lack the demo marker
  --dry-run           Print actions only
  --no-ownership      Skip chgrp/chmod for hermes group access
  --runtime-user NAME Group/user for vault RW (default: hermes)
  -h, --help          This help

Environment: VAULT_ROOT, DEMO_VAULT_SOURCE, FORCE, DRY_RUN, RUNTIME_USER, APPLY_OWNERSHIP
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --vault-root) VAULT_ROOT="$2"; shift 2 ;;
    --source) SOURCE="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --no-ownership) APPLY_OWNERSHIP=0; shift ;;
    --runtime-user) RUNTIME_USER="$2"; RUNTIME_GROUP="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

log() { echo "[seed-demo-vault] $*"; }
warn() { echo "[seed-demo-vault] WARN: $*" >&2; }
err() { echo "[seed-demo-vault] ERROR: $*" >&2; }

# Resolve absolute path without requiring the path to exist (bash-only).
abs_path() {
  local p="$1"
  if command -v realpath >/dev/null 2>&1; then
    realpath -m "$p" 2>/dev/null && return 0
  fi
  # Fallback: expand leading ~
  case "$p" in
    /*) printf '%s\n' "$p" ;;
    ~*) printf '%s\n' "${p/#\~/$HOME}" ;;
    *) printf '%s\n' "$(pwd)/$p" ;;
  esac
}

looks_like_employee_vault() {
  local root="$1"
  local abs
  abs="$(abs_path "$root")"

  # Hard refuse: known employee-vault path patterns (doctrine: /home/operator/Lanyard)
  case "$abs" in
    */employee-vault|*/employee-vault/*|*/employee_vault|*/employee_vault/*)
      return 0
      ;;
    */Lanyard|*/Lanyard/*)
      # Employee vault is commonly .../Lanyard; never treat as demo target
      return 0
      ;;
  esac

  # Refuse if marker files that indicate an operator employee vault (not client spine)
  if [ -f "$abs/.employee-vault" ] || [ -f "$abs/EMPLOYEE-VAULT.md" ]; then
    return 0
  fi

  # Refuse if git remote clearly names employee-vault (best-effort, no network)
  if [ -d "$abs/.git" ] && command -v git >/dev/null 2>&1; then
    local remote
    remote="$(git -C "$abs" remote get-url origin 2>/dev/null || true)"
    case "$remote" in
      *employee-vault*|*employee_vault*)
        return 0
        ;;
    esac
  fi

  return 1
}

is_demo_file() {
  local f="$1"
  # First ~20 lines for marker (HTML comment or plain)
  head -n 20 "$f" 2>/dev/null | grep -Fq "$DEMO_MARKER"
}

files_identical() {
  local a="$1" b="$2"
  if command -v cmp >/dev/null 2>&1; then
    cmp -s "$a" "$b"
  else
    [ "$(checksum "$a")" = "$(checksum "$b")" ]
  fi
}

checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    cksum "$1" | awk '{print $1"-"$2}'
  fi
}

install_file() {
  local src="$1"
  local dest="$2"
  local rel="${3:-$dest}"

  if [ ! -f "$src" ]; then
    err "Missing source file: $src"
    return 1
  fi

  if [ -e "$dest" ] && [ ! -f "$dest" ]; then
    warn "Skip $rel (destination exists and is not a regular file)"
    SKIPPED=$((SKIPPED + 1))
    return 0
  fi

  if [ -f "$dest" ]; then
    if files_identical "$src" "$dest"; then
      log "unchanged: $rel"
      UNCHANGED=$((UNCHANGED + 1))
      return 0
    fi
    if [ "$FORCE" = "1" ] || is_demo_file "$dest"; then
      :
    else
      warn "skip (non-demo content, use --force): $rel"
      SKIPPED=$((SKIPPED + 1))
      return 0
    fi
  fi

  if [ "$DRY_RUN" = "1" ]; then
    log "DRY-RUN: install $rel"
    WRITTEN=$((WRITTEN + 1))
    return 0
  fi

  mkdir -p "$(dirname "$dest")"
  # install(1) is portable enough on Amazon Linux / Ubuntu; cp fallback
  if command -v install >/dev/null 2>&1; then
    install -m 0644 "$src" "$dest"
  else
    cp -f "$src" "$dest"
    chmod 0644 "$dest"
  fi
  log "wrote: $rel"
  WRITTEN=$((WRITTEN + 1))
}

apply_vault_group_access() {
  if [ "$APPLY_OWNERSHIP" != "1" ]; then
    log "ownership skip (--no-ownership)"
    return 0
  fi
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY-RUN: would chgrp -R $RUNTIME_GROUP $VAULT_ROOT and chmod g+rwX"
    return 0
  fi
  if [ "$(id -u)" != "0" ]; then
    warn "not root; skip vault group ownership (run with sudo on host for hermes access)"
    return 0
  fi
  if ! getent group "$RUNTIME_GROUP" >/dev/null 2>&1; then
    warn "group $RUNTIME_GROUP missing; skip ownership (create via ensure-runtime-hardening)"
    return 0
  fi
  # Match ensure-runtime-hardening: root-owned tree, hermes group RW
  chgrp -R "$RUNTIME_GROUP" "$VAULT_ROOT" || true
  chmod -R g+rwX "$VAULT_ROOT" || true
  chmod o-rwx "$VAULT_ROOT" 2>/dev/null || true
  log "vault group access for $RUNTIME_GROUP on $VAULT_ROOT"
}

# --- main ---
VAULT_ROOT="$(abs_path "$VAULT_ROOT")"
SOURCE="$(abs_path "$SOURCE")"

if [ ! -d "$SOURCE" ]; then
  err "Demo source not found: $SOURCE"
  exit 2
fi

if looks_like_employee_vault "$VAULT_ROOT"; then
  err "Refusing seed: path looks like employee vault: $VAULT_ROOT"
  err "Demo content must never land in the employee vault. Use /opt/company-brain (or a temp dir)."
  exit 3
fi

if [ ! -d "$VAULT_ROOT" ]; then
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY-RUN: would mkdir -p $VAULT_ROOT"
  else
    mkdir -p "$VAULT_ROOT"
    log "created vault root: $VAULT_ROOT"
  fi
fi

WRITTEN=0
UNCHANGED=0
SKIPPED=0

log "source=$SOURCE"
log "vault_root=$VAULT_ROOT force=$FORCE dry_run=$DRY_RUN"

# Walk all regular files under source; skip README.md at demo-vault root (docs only)
while IFS= read -r -d '' src; do
  rel="${src#"$SOURCE"/}"
  case "$rel" in
    README.md) continue ;;
    .*) continue ;;
  esac
  dest="$VAULT_ROOT/$rel"
  install_file "$src" "$dest" "$rel"
done < <(find "$SOURCE" -type f -print0 | sort -z)

# Provenance marker (always safe to refresh when we wrote or already seeded)
marker_src=""
if [ "$DRY_RUN" != "1" ]; then
  mkdir -p "$VAULT_ROOT/.seed"
  {
    echo "# $DEMO_MARKER"
    echo "seeded_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date)"
    echo "source=$SOURCE"
    echo "written=$WRITTEN unchanged=$UNCHANGED skipped=$SKIPPED force=$FORCE"
  } >"$VAULT_ROOT/$SEED_MARKER_REL"
  log "marker: $SEED_MARKER_REL"
else
  log "DRY-RUN: would write $SEED_MARKER_REL"
fi

apply_vault_group_access

log "done: written=$WRITTEN unchanged=$UNCHANGED skipped=$SKIPPED"
if [ "$SKIPPED" -gt 0 ] && [ "$FORCE" != "1" ]; then
  log "hint: re-run with --force to overwrite non-demo files"
fi
exit 0
