#!/usr/bin/env bash
# ensure-omnibox — Mode A Omnibox host install (bwrap_inrepo)
#
# Idempotent install of bubblewrap (if missing), policy seeds, wrapper, and
# workspace layout. Does NOT require Omnigent server (Mode A only).
# Does NOT wrap the long-lived hermes-gateway process.
#
# Usage (on host, typically after ensure-runtime-hardening / bootstrap):
#   sudo bash scripts/ensure-omnibox.sh
#   sudo bash scripts/ensure-omnibox.sh --require
#   bash scripts/ensure-omnibox.sh --dry-run
#   ENABLE_OMNIBOX=0 bash scripts/ensure-omnibox.sh   # no-op skip (bootstrap off)
#   OMNIBOX_REQUIRED=1 bash scripts/ensure-omnibox.sh --dry-run
#
# Offline (CI / laptop): --dry-run validates seeds + planned layout without root.
#
# Host layout:
#   /etc/company-brain/omnibox/{admin,contributor}.yaml
#   /etc/company-brain/omnibox/host-impacting-tools.json  (phase 5 hook registry)
#   /var/lib/company-brain/omnibox/workspaces/{admin,contributor}/
#   /usr/local/sbin/run-under-omnibox
#   /usr/local/sbin/omnibox-build-shell-exec-argv         (phase 5 argv helper)
#
# Flags / env:
#   ENABLE_OMNIBOX=0|1     default 1 when script is invoked; 0 skips live install
#   OMNIBOX_REQUIRED=0|1   with --require: fail closed if seeds/backend missing
#
# Backend: bwrap_inrepo (phase 0). See:
#   references/runbooks/omnibox-mode-a-spike.md
#   references/omnibox-mode-a-hermes-hook.md
#   references/plans/omnibox-hermes-mode-a/phase-3-ensure-smoke.md
#   scripts/omnibox/
#
# Beads: cbd-o9s.9 (ensure), cbd-o9s.11 (hook registry + argv builder install)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEED_DIR="${OMNIBOX_SEED_DIR:-$ROOT/scripts/omnibox}"
WRAPPER_SRC="${OMNIBOX_WRAPPER_SRC:-$SEED_DIR/run-under-omnibox.sh}"
ARGV_BUILDER_SRC="${OMNIBOX_ARGV_BUILDER_SRC:-$SEED_DIR/build-shell-exec-argv.py}"
HOST_TOOLS_SRC="${OMNIBOX_HOST_TOOLS_SRC:-$SEED_DIR/host-impacting-tools.json}"
POLICY_DST="${OMNIBOX_POLICY_DST:-/etc/company-brain/omnibox}"
WRAPPER_DST="${OMNIBOX_WRAPPER_DST:-/usr/local/sbin/run-under-omnibox}"
ARGV_BUILDER_DST="${OMNIBOX_ARGV_BUILDER_DST:-/usr/local/sbin/omnibox-build-shell-exec-argv}"
WORKSPACE_ROOT="${OMNIBOX_WORKSPACE_ROOT:-/var/lib/company-brain/omnibox}"
RUNTIME_USER="${RUNTIME_USER:-hermes}"
RUNTIME_GROUP="${RUNTIME_GROUP:-$RUNTIME_USER}"
ENABLE_OMNIBOX="${ENABLE_OMNIBOX:-1}"
OMNIBOX_REQUIRED="${OMNIBOX_REQUIRED:-0}"
DRY_RUN="${DRY_RUN:-0}"
INSTALL_BWRAP="${INSTALL_BWRAP:-1}"
OMNIBOX_BWRAP="${OMNIBOX_BWRAP:-bwrap}"

PROFILES=(admin contributor)

usage() {
  cat <<EOF
Usage: $0 [options]

Idempotent Mode A Omnibox host install (bubblewrap + policies + wrapper).

  --dry-run              Print actions; no root mutations (offline-safe)
  --require              Fail closed if seeds/backend missing (or set OMNIBOX_REQUIRED=1)
  --no-bwrap-install     Do not attempt package install of bubblewrap
  --seed-dir PATH        Policy + wrapper source dir (default: scripts/omnibox)
  --policy-dst PATH      Install policies here (default: /etc/company-brain/omnibox)
  --wrapper-dst PATH     Install wrapper here (default: /usr/local/sbin/run-under-omnibox)
  --workspace-root PATH  Workspace root (default: /var/lib/company-brain/omnibox)
  --runtime-user NAME    Owner for workspaces (default: hermes)

Environment:
  ENABLE_OMNIBOX=0|1     Skip live install when 0 (default 1 when invoked)
  OMNIBOX_REQUIRED=0|1   Same as --require
  OMNIBOX_BWRAP          bubblewrap binary name/path (default: bwrap)
  RUNTIME_USER           Workspace owner (default: hermes)

Does not require Omnigent server. Feature flag for Hermes gateway is
OMNIBOX_ENABLED (phase 4); this script installs host artifacts only.
EOF
}

log() { echo "[ensure-omnibox] $*"; }
warn() { echo "[ensure-omnibox] WARN: $*" >&2; }
err() { echo "[ensure-omnibox] ERROR: $*" >&2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --require) OMNIBOX_REQUIRED=1; shift ;;
    --no-bwrap-install) INSTALL_BWRAP=0; shift ;;
    --seed-dir) SEED_DIR="$2"; WRAPPER_SRC="${OMNIBOX_WRAPPER_SRC:-$SEED_DIR/run-under-omnibox.sh}"; shift 2 ;;
    --policy-dst) POLICY_DST="$2"; shift 2 ;;
    --wrapper-dst) WRAPPER_DST="$2"; shift 2 ;;
    --workspace-root) WORKSPACE_ROOT="$2"; shift 2 ;;
    --runtime-user) RUNTIME_USER="$2"; RUNTIME_GROUP="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) err "Unknown arg: $1"; usage >&2; exit 2 ;;
  esac
done

run() {
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY-RUN: $*"
    return 0
  fi
  "$@"
}

require_root_for_live() {
  if [ "$DRY_RUN" = "1" ]; then
    return 0
  fi
  if [ "$(id -u)" != "0" ]; then
    err "Live Omnibox install requires root (or use --dry-run)."
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Seed / layout validation (offline-safe)
# ---------------------------------------------------------------------------
check_seeds() {
  local role f missing=0
  [ -d "$SEED_DIR" ] || {
    err "Missing seed directory: $SEED_DIR"
    return 1
  }
  for role in "${PROFILES[@]}"; do
    f="$SEED_DIR/${role}.yaml"
    if [ ! -f "$f" ]; then
      err "Missing policy seed: $f"
      missing=1
      continue
    fi
    # Basic schema markers (no secrets expected in seeds)
    grep -Eq "^profile:[[:space:]]*${role}[[:space:]]*$" "$f" \
      || { err "Seed $f missing profile: $role"; missing=1; }
    grep -Eq '^backend:[[:space:]]*bwrap_inrepo' "$f" \
      || { err "Seed $f must set backend: bwrap_inrepo"; missing=1; }
    grep -Eq 'never_grant:' "$f" \
      || { err "Seed $f missing never_grant"; missing=1; }
    # Secrets must never be granted — .env path is the offline smoke signal
    grep -Eq '\.env' "$f" \
      || { err "Seed $f never_grant must mention .env (gateway secrets)"; missing=1; }
    # No live secret material in seed files
    if grep -Eiq '(api[_-]?key|secret_key|password|BEGIN (RSA |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16})' "$f"; then
      err "Seed $f appears to contain secret-like material (forbidden in repo seeds)"
      missing=1
    fi
  done

  # Contributor must be stricter: shell not expected; path_prefixes_only on vault
  local contrib="$SEED_DIR/contributor.yaml"
  if [ -f "$contrib" ]; then
    grep -Eq 'path_prefixes_only:[[:space:]]*true' "$contrib" \
      || { err "contributor.yaml must set path_prefixes_only: true on vault grant"; missing=1; }
    grep -Eq 'expected:[[:space:]]*false' "$contrib" \
      || { err "contributor.yaml shell.expected must be false"; missing=1; }
    # Explicit .env deny for contributor (required offline smoke)
    grep -Fq '/home/hermes/.hermes/.env' "$contrib" \
      || { err "contributor.yaml never_grant must include /home/hermes/.hermes/.env"; missing=1; }
  fi

  local admin="$SEED_DIR/admin.yaml"
  if [ -f "$admin" ]; then
    grep -Eq 'expected:[[:space:]]*true' "$admin" \
      || { err "admin.yaml shell.expected must be true"; missing=1; }
    grep -Fq '/opt/company-brain' "$admin" \
      || { err "admin.yaml must grant /opt/company-brain"; missing=1; }
  fi

  if [ ! -f "$WRAPPER_SRC" ]; then
    err "Missing wrapper source: $WRAPPER_SRC"
    missing=1
  elif [ ! -x "$WRAPPER_SRC" ] && [ ! -r "$WRAPPER_SRC" ]; then
    err "Wrapper source not readable: $WRAPPER_SRC"
    missing=1
  else
    # Syntax check when bash can read it
    if ! bash -n "$WRAPPER_SRC" 2>/dev/null; then
      err "Wrapper source fails bash -n: $WRAPPER_SRC"
      missing=1
    fi
  fi

  # Phase 5: host-impacting registry + argv builder (Hermes hook contract)
  if [ ! -f "$HOST_TOOLS_SRC" ]; then
    err "Missing host-impacting tools registry: $HOST_TOOLS_SRC"
    missing=1
  else
    grep -Eq '"shell_exec"' "$HOST_TOOLS_SRC" \
      || { err "host-impacting registry must list shell_exec"; missing=1; }
    grep -Eq '"host_impacting_tools"' "$HOST_TOOLS_SRC" \
      || { err "host-impacting registry missing host_impacting_tools"; missing=1; }
    grep -Eq '"vault_only_tools"' "$HOST_TOOLS_SRC" \
      || { err "host-impacting registry missing vault_only_tools"; missing=1; }
  fi
  if [ ! -f "$ARGV_BUILDER_SRC" ]; then
    err "Missing argv builder: $ARGV_BUILDER_SRC"
    missing=1
  elif ! python3 -m py_compile "$ARGV_BUILDER_SRC" 2>/dev/null; then
    err "argv builder fails python compile: $ARGV_BUILDER_SRC"
    missing=1
  fi

  if [ "$missing" -ne 0 ]; then
    return 1
  fi
  log "Policy seeds OK under $SEED_DIR (admin + contributor; no secrets)"
  log "Hook contract seeds OK (host-impacting-tools.json + build-shell-exec-argv.py)"
  return 0
}

check_planned_layout() {
  log "Planned host layout:"
  log "  policies:  $POLICY_DST/{admin,contributor}.yaml"
  log "  registry:  $POLICY_DST/host-impacting-tools.json (phase 5)"
  log "  wrapper:   $WRAPPER_DST  (OMNIBOX_WRAPPER)"
  log "  argv helper: $ARGV_BUILDER_DST  (OMNIBOX_ARGV_BUILDER)"
  log "  workspaces:$WORKSPACE_ROOT/workspaces/{admin,contributor}/"
  log "  runtime:   $POLICY_DST/runtime/ (phase-6 egress; dir only)"
  log "  owner:     $RUNTIME_USER:$RUNTIME_GROUP (workspaces)"
  return 0
}

# ---------------------------------------------------------------------------
# bubblewrap package
# ---------------------------------------------------------------------------
bwrap_present() {
  command -v "$OMNIBOX_BWRAP" >/dev/null 2>&1
}

install_bubblewrap() {
  if [ "$INSTALL_BWRAP" != "1" ]; then
    log "Skipping bubblewrap package install (INSTALL_BWRAP=0)"
    if ! bwrap_present; then
      if [ "$OMNIBOX_REQUIRED" = "1" ]; then
        err "bubblewrap not found (OMNIBOX_BWRAP=$OMNIBOX_BWRAP) and install disabled"
        return 1
      fi
      warn "bubblewrap not found; install bubblewrap package or set OMNIBOX_BWRAP"
    fi
    return 0
  fi

  if bwrap_present; then
    local ver
    ver="$("$OMNIBOX_BWRAP" --version 2>/dev/null | head -n1 || echo present)"
    log "bubblewrap already present: $ver"
    return 0
  fi

  if [ "$DRY_RUN" = "1" ]; then
    log "DRY-RUN: would install bubblewrap package (dnf/yum/apt) — currently missing"
    if [ "$OMNIBOX_REQUIRED" = "1" ]; then
      # Offline dry-run with --require: seeds matter more than live package;
      # note absence but do not fail CI when package managers cannot run.
      warn "bubblewrap binary not on PATH (ok for offline dry-run; required on live host)"
    fi
    return 0
  fi

  require_root_for_live
  log "Installing bubblewrap package..."
  if command -v dnf >/dev/null 2>&1; then
    dnf install -y bubblewrap
  elif command -v yum >/dev/null 2>&1; then
    yum install -y bubblewrap
  elif command -v apt-get >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y bubblewrap
  else
    err "No supported package manager (dnf/yum/apt-get); install bubblewrap manually"
    if [ "$OMNIBOX_REQUIRED" = "1" ]; then
      return 1
    fi
    return 1
  fi

  if ! bwrap_present; then
    err "bubblewrap install completed but $OMNIBOX_BWRAP still not on PATH"
    return 1
  fi
  log "Installed bubblewrap: $("$OMNIBOX_BWRAP" --version 2>/dev/null | head -n1 || echo ok)"
  return 0
}

# ---------------------------------------------------------------------------
# Install policies + wrapper + workspaces
# ---------------------------------------------------------------------------
install_policies() {
  local role src
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY-RUN: would mkdir -p $POLICY_DST $POLICY_DST/runtime"
    for role in "${PROFILES[@]}"; do
      log "DRY-RUN: would install -m 0644 $SEED_DIR/${role}.yaml → $POLICY_DST/${role}.yaml"
    done
    return 0
  fi
  require_root_for_live
  install -d -m 0755 "$POLICY_DST"
  install -d -m 0755 "$POLICY_DST/runtime"
  for role in "${PROFILES[@]}"; do
    src="$SEED_DIR/${role}.yaml"
    install -m 0644 "$src" "$POLICY_DST/${role}.yaml"
  done
  log "Installed policies → $POLICY_DST/"
}

install_wrapper() {
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY-RUN: would install -m 0755 $WRAPPER_SRC → $WRAPPER_DST"
    log "DRY-RUN: Hermes would set OMNIBOX_WRAPPER=$WRAPPER_DST"
    return 0
  fi
  require_root_for_live
  install -d -m 0755 "$(dirname "$WRAPPER_DST")"
  install -m 0755 "$WRAPPER_SRC" "$WRAPPER_DST"
  log "Installed wrapper → $WRAPPER_DST (OMNIBOX_WRAPPER)"
}

install_hook_contract() {
  # Phase 5: host-impacting tool registry + argv builder (Hermes hook contract).
  # Does not enable product wrap by itself — see references/omnibox-mode-a-hermes-hook.md.
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY-RUN: would install -m 0644 $HOST_TOOLS_SRC → $POLICY_DST/host-impacting-tools.json"
    log "DRY-RUN: would install -m 0755 $ARGV_BUILDER_SRC → $ARGV_BUILDER_DST"
    log "DRY-RUN: Hermes would set OMNIBOX_ARGV_BUILDER=$ARGV_BUILDER_DST"
    return 0
  fi
  require_root_for_live
  install -d -m 0755 "$POLICY_DST"
  install -m 0644 "$HOST_TOOLS_SRC" "$POLICY_DST/host-impacting-tools.json"
  install -d -m 0755 "$(dirname "$ARGV_BUILDER_DST")"
  install -m 0755 "$ARGV_BUILDER_SRC" "$ARGV_BUILDER_DST"
  log "Installed hook registry → $POLICY_DST/host-impacting-tools.json"
  log "Installed argv builder → $ARGV_BUILDER_DST (OMNIBOX_ARGV_BUILDER)"
}

install_workspaces() {
  local ws
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY-RUN: would mkdir -p $WORKSPACE_ROOT/workspaces/{admin,contributor,sessions}"
    log "DRY-RUN: would chown $RUNTIME_USER:$RUNTIME_GROUP workspaces (if user exists)"
    return 0
  fi
  require_root_for_live
  install -d -m 0755 "$WORKSPACE_ROOT"
  install -d -m 0755 "$WORKSPACE_ROOT/workspaces"
  for ws in admin contributor sessions; do
    install -d -m 0750 "$WORKSPACE_ROOT/workspaces/$ws"
  done
  if id "$RUNTIME_USER" >/dev/null 2>&1; then
    chown -R "$RUNTIME_USER:$RUNTIME_GROUP" "$WORKSPACE_ROOT"
    log "Workspaces owned by $RUNTIME_USER:$RUNTIME_GROUP under $WORKSPACE_ROOT"
  else
    warn "Runtime user $RUNTIME_USER missing; workspaces created root-owned (run ensure-runtime-hardening first)"
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
log "Company Brain Omnibox ensure (Mode A / bwrap_inrepo)"
log "  enable_omnibox=$ENABLE_OMNIBOX required=$OMNIBOX_REQUIRED dry_run=$DRY_RUN"
log "  seed_dir=$SEED_DIR"
log "  policy_dst=$POLICY_DST wrapper_dst=$WRAPPER_DST"
log "  workspace_root=$WORKSPACE_ROOT runtime_user=$RUNTIME_USER"

if ! check_seeds; then
  err "Seed validation failed"
  exit 1
fi
check_planned_layout

# ENABLE_OMNIBOX=0: bootstrap-off path — validate seeds only, skip mutations
if [ "$ENABLE_OMNIBOX" != "1" ] && [ "$DRY_RUN" != "1" ]; then
  log "ENABLE_OMNIBOX=$ENABLE_OMNIBOX — skipping live install (seeds validated)"
  if [ "$OMNIBOX_REQUIRED" = "1" ]; then
    log "OMNIBOX_REQUIRED=1 with ENABLE_OMNIBOX=0: seeds OK; host install not applied"
  fi
  log "Omnibox ensure complete (skipped install)."
  exit 0
fi

if [ "$ENABLE_OMNIBOX" != "1" ] && [ "$DRY_RUN" = "1" ]; then
  log "ENABLE_OMNIBOX=$ENABLE_OMNIBOX with --dry-run: still reporting planned layout (no mutations)"
fi

if ! install_bubblewrap; then
  if [ "$OMNIBOX_REQUIRED" = "1" ] && [ "$DRY_RUN" != "1" ]; then
    err "bubblewrap required but unavailable"
    exit 1
  fi
  if [ "$DRY_RUN" != "1" ]; then
    err "bubblewrap install failed"
    exit 1
  fi
fi

install_policies
install_wrapper
install_hook_contract
install_workspaces

log "Omnibox ensure complete."
if [ "$DRY_RUN" = "1" ]; then
  log "Dry-run only — re-run without --dry-run as root on the host after bootstrap."
  log "Hermes env (phase 4/5): OMNIBOX_ENABLED=0|1 OMNIBOX_WRAPPER=$WRAPPER_DST OMNIBOX_ARGV_BUILDER=$ARGV_BUILDER_DST"
fi
