#!/usr/bin/env bash
# Host/runtime hardening for Company Brain EC2 (lp-k7g.10.4 / cbd-zzx.15).
#
# Creates unprivileged service user, applies ownership/modes, installs sandboxed
# systemd unit templates, seeds tool allowlists, hardens secrets files.
#
# Aligns with company-brain-backend.service (phase 3 / lp-k7g.7.5):
#   BACKEND_INSTALL_PATH=/opt/company-brain-backend/current
#   BACKEND_HOME=/var/lib/company-brain-backend
#   User=company-brain
#   Secrets: $BACKEND_HOME/.env mode 0600
#
# Usage (on host, typically after company-brain-bootstrap):
#   sudo bash scripts/ensure-runtime-hardening.sh
#   sudo bash scripts/ensure-runtime-hardening.sh --dry-run
#   RUNTIME_USER=company-brain BACKEND_HOME=/var/lib/company-brain-backend \
#     bash scripts/ensure-runtime-hardening.sh
#
# Offline (CI / laptop): --dry-run validates scripts + unit directives without root.
#
# See: references/runbooks/host-runtime-hardening.md
#      docs/architecture/deploy-backend-systemd-service.md
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_USER="${RUNTIME_USER:-company-brain}"
RUNTIME_GROUP="${RUNTIME_GROUP:-$RUNTIME_USER}"
VAULT_ROOT="${VAULT_ROOT:-/opt/company-brain}"

# Platform paths (primary contract)
BACKEND_INSTALL_ROOT="${BACKEND_INSTALL_ROOT:-/opt/company-brain-backend}"
BACKEND_INSTALL_PATH="${BACKEND_INSTALL_PATH:-${BACKEND_INSTALL_ROOT}/current}"
BACKEND_HOME="${BACKEND_HOME:-/var/lib/company-brain-backend}"

# Hermes-compatible aliases (same absolute paths as platform names when unset)
HERMES_INSTALL_PATH="${HERMES_INSTALL_PATH:-$BACKEND_INSTALL_PATH}"
HERMES_HOME="${HERMES_HOME:-$BACKEND_HOME}"

# Service account home (may differ from BACKEND_HOME when state is under /var/lib)
SERVICE_HOME="${SERVICE_HOME:-/home/${RUNTIME_USER}}"

SYSTEMD_SRC="${SYSTEMD_SRC:-$ROOT/modules/company-brain-ec2/systemd}"
SYSTEMD_DST="${SYSTEMD_DST:-/etc/systemd/system}"
# Primary unit (generic). Legacy hermes-gateway remains available via INSTALL_LEGACY_UNIT.
SERVICE_UNIT="${SERVICE_UNIT:-company-brain-backend}"
LEGACY_SERVICE_UNIT="${LEGACY_SERVICE_UNIT:-hermes-gateway}"
INSTALL_LEGACY_UNIT="${INSTALL_LEGACY_UNIT:-0}"
TOOL_ALLOWLIST_SRC="${TOOL_ALLOWLIST_SRC:-$ROOT/scripts/tool-allowlists}"
TOOL_ALLOWLIST_DST="${TOOL_ALLOWLIST_DST:-/etc/company-brain/tool-allowlists}"
# Materialize host tool (lp-645.4): not embedded in user_data (16 KiB budget).
MATERIALIZE_PY_SRC="${MATERIALIZE_PY_SRC:-$ROOT/scripts/materialize-backend-secrets.py}"
MATERIALIZE_WRAPPER_SRC="${MATERIALIZE_WRAPPER_SRC:-$ROOT/modules/company-brain-ec2/scripts/materialize-backend-secrets.sh}"
MATERIALIZE_PY_DST="${MATERIALIZE_PY_DST:-/usr/local/lib/company-brain/materialize-backend-secrets.py}"
MATERIALIZE_WRAPPER_DST="${MATERIALIZE_WRAPPER_DST:-/usr/local/sbin/materialize-backend-secrets}"
DRY_RUN="${DRY_RUN:-0}"
INSTALL_SYSTEMD="${INSTALL_SYSTEMD:-1}"
INSTALL_MATERIALIZE="${INSTALL_MATERIALIZE:-1}"
CREATE_USER="${CREATE_USER:-1}"
APPLY_OWNERSHIP="${APPLY_OWNERSHIP:-1}"
SEED_TOOL_ALLOWLISTS="${SEED_TOOL_ALLOWLISTS:-1}"
HARDEN_SECRETS="${HARDEN_SECRETS:-1}"
ENABLE_SERVICE="${ENABLE_SERVICE:-0}"

# Required layout dirs under BACKEND_HOME (contracts/backend-runtime-v1/filesystem-layout.md)
BACKEND_HOME_DIRS=(profiles skills cron logs sessions workspace)

usage() {
  cat <<EOF
Usage: $0 [options]

  --dry-run                   Print actions; skip mutations (also offline unit checks)
  --no-systemd                Do not install unit files
  --no-materialize            Do not install materialize-backend-secrets host tool
  --no-user                   Do not create runtime user
  --no-ownership              Do not chown install/home/vault paths
  --no-tool-allowlists        Do not seed tool allowlist configs
  --no-secrets                Do not chmod secret files
  --enable-service            systemctl enable --now company-brain-backend (requires root)
  --install-legacy-unit       Also install hermes-gateway.service (migration hosts)
  --runtime-user NAME         Default: company-brain
  --vault-root PATH           Default: /opt/company-brain
  --backend-home PATH         Default: /var/lib/company-brain-backend
  --backend-install PATH      Default: /opt/company-brain-backend/current
  --backend-install-root PATH Default: /opt/company-brain-backend
  --hermes-install PATH       Alias for --backend-install (compatibility)
  --hermes-home PATH          Alias for --backend-home (compatibility)
  --systemd-src PATH          Default: modules/company-brain-ec2/systemd
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --no-systemd) INSTALL_SYSTEMD=0; shift ;;
    --no-materialize) INSTALL_MATERIALIZE=0; shift ;;
    --no-user) CREATE_USER=0; shift ;;
    --no-ownership) APPLY_OWNERSHIP=0; shift ;;
    --no-tool-allowlists) SEED_TOOL_ALLOWLISTS=0; shift ;;
    --no-secrets) HARDEN_SECRETS=0; shift ;;
    --enable-service) ENABLE_SERVICE=1; shift ;;
    --install-legacy-unit) INSTALL_LEGACY_UNIT=1; shift ;;
    --runtime-user)
      RUNTIME_USER="$2"
      RUNTIME_GROUP="$2"
      SERVICE_HOME="/home/${RUNTIME_USER}"
      shift 2
      ;;
    --vault-root) VAULT_ROOT="$2"; shift 2 ;;
    --backend-home)
      BACKEND_HOME="$2"
      HERMES_HOME="$2"
      shift 2
      ;;
    --backend-install)
      BACKEND_INSTALL_PATH="$2"
      HERMES_INSTALL_PATH="$2"
      shift 2
      ;;
    --backend-install-root) BACKEND_INSTALL_ROOT="$2"; shift 2 ;;
    --hermes-install)
      # Compatibility: Hermes flag sets platform install path
      BACKEND_INSTALL_PATH="$2"
      HERMES_INSTALL_PATH="$2"
      shift 2
      ;;
    --hermes-home)
      BACKEND_HOME="$2"
      HERMES_HOME="$2"
      shift 2
      ;;
    --systemd-src) SYSTEMD_SRC="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

log() { echo "[runtime-hardening] $*"; }
warn() { echo "[runtime-hardening] WARN: $*" >&2; }
err() { echo "[runtime-hardening] ERROR: $*" >&2; }

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
    err "Live hardening requires root (or use --dry-run)."
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Offline checks: unit sandbox directives present
# ---------------------------------------------------------------------------
REQUIRED_UNIT_DIRECTIVES=(
  "User="
  "NoNewPrivileges=true"
  "ProtectSystem=strict"
  "ProtectHome=true"
  "PrivateTmp=true"
  "RestrictSUIDSGID=true"
  "ReadWritePaths="
)

check_unit_file() {
  local unit="$1"
  local label="$2"
  local d
  [ -f "$unit" ] || { err "Missing unit template: $unit"; return 1; }
  for d in "${REQUIRED_UNIT_DIRECTIVES[@]}"; do
    if ! grep -qF "$d" "$unit"; then
      err "Unit missing required directive '$d': $unit"
      return 1
    fi
  done
  if grep -Eq '^User=root' "$unit"; then
    err "Unit must not set User=root"
    return 1
  fi
  log "Unit sandbox directives OK: $label ($unit)"
  return 0
}

check_unit_files() {
  local unit="$SYSTEMD_SRC/${SERVICE_UNIT}.service"
  check_unit_file "$unit" "$SERVICE_UNIT" || return 1

  # Generic unit must not run as root and should prefer company-brain User=
  if ! grep -Eq "^User=${RUNTIME_USER}\$" "$unit" && ! grep -Eq '^User=company-brain$' "$unit"; then
    warn "Unit User= does not match RUNTIME_USER=$RUNTIME_USER (expected company-brain in template)"
  fi

  # Contract entrypoint + generic paths
  if ! grep -Eq '^ExecStart=.*/bin/company-brain-backend gateway' "$unit"; then
    err "Unit must ExecStart …/bin/company-brain-backend gateway: $unit"
    return 1
  fi
  if ! grep -qF 'BACKEND_HOME=' "$unit"; then
    err "Unit missing BACKEND_HOME=: $unit"
    return 1
  fi
  if ! grep -qF 'BACKEND_INSTALL_PATH=' "$unit"; then
    err "Unit missing BACKEND_INSTALL_PATH=: $unit"
    return 1
  fi

  # ReadWritePaths: BACKEND_HOME + VAULT_ROOT + service home + tmp (not install tree)
  local rwp
  rwp="$(grep -E '^ReadWritePaths=' "$unit" | head -n1 || true)"
  [ -n "$rwp" ] || { err "Unit missing ReadWritePaths=: $unit"; return 1; }
  echo "$rwp" | grep -qF '/var/lib/company-brain-backend' \
    || { err "ReadWritePaths must include BACKEND_HOME (/var/lib/company-brain-backend)"; return 1; }
  echo "$rwp" | grep -qF '/opt/company-brain' \
    || { err "ReadWritePaths must include VAULT_ROOT (/opt/company-brain)"; return 1; }
  # Install tree must stay immutable under ProtectSystem=strict (not in ReadWritePaths)
  if echo "$rwp" | grep -qE '/opt/company-brain-backend(/| |$)'; then
    err "ReadWritePaths must not grant write to install tree /opt/company-brain-backend"
    return 1
  fi
  log "ReadWritePaths OK (BACKEND_HOME + vault + home/tmp; install tree excluded)"

  if [ "$INSTALL_LEGACY_UNIT" = "1" ]; then
    local legacy="$SYSTEMD_SRC/${LEGACY_SERVICE_UNIT}.service"
    if [ -f "$legacy" ]; then
      check_unit_file "$legacy" "$LEGACY_SERVICE_UNIT" || return 1
    else
      warn "INSTALL_LEGACY_UNIT=1 but missing $legacy"
    fi
  fi
  return 0
}

check_tool_allowlists() {
  local admin="$TOOL_ALLOWLIST_SRC/admin.json"
  local contrib="$TOOL_ALLOWLIST_SRC/contributor.json"
  [ -f "$admin" ] || { err "Missing $admin"; return 1; }
  [ -f "$contrib" ] || { err "Missing $contrib"; return 1; }
  for tool in shell_exec system_ops profile_manage gateway_config beads_admin; do
    if ! grep -Eq "\"${tool}\"" "$contrib"; then
      err "Contributor tool allowlist should mention deny-side tool '$tool': $contrib"
      return 1
    fi
  done
  grep -Eq '"deny"' "$contrib" || { err "Contributor allowlist missing deny array"; return 1; }
  grep -Eq '"shell_exec"' "$admin" || { err "Admin allowlist missing shell_exec"; return 1; }
  log "Tool allowlist seeds OK under $TOOL_ALLOWLIST_SRC"
  return 0
}

# ---------------------------------------------------------------------------
# User creation
# ---------------------------------------------------------------------------
ensure_runtime_user() {
  if [ "$CREATE_USER" != "1" ]; then
    log "Skipping user creation (CREATE_USER=0)"
    return 0
  fi
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY-RUN: would ensure system user '$RUNTIME_USER' (home $SERVICE_HOME, shell nologin)"
    return 0
  fi
  require_root_for_live
  if id "$RUNTIME_USER" >/dev/null 2>&1; then
    log "Runtime user already exists: $RUNTIME_USER"
  else
    if command -v useradd >/dev/null 2>&1; then
      useradd --system --create-home --home-dir "$SERVICE_HOME" \
        --shell /sbin/nologin --comment "Company Brain backend runtime" \
        "$RUNTIME_USER" 2>/dev/null \
        || useradd -r -m -d "$SERVICE_HOME" -s /bin/false \
          -c "Company Brain backend runtime" "$RUNTIME_USER"
      log "Created runtime user: $RUNTIME_USER"
    else
      err "useradd not found; cannot create $RUNTIME_USER"
      exit 3
    fi
  fi
  mkdir -p "$SERVICE_HOME"
  chown "$RUNTIME_USER:$RUNTIME_GROUP" "$SERVICE_HOME"
  chmod 750 "$SERVICE_HOME"
}

# ---------------------------------------------------------------------------
# Ownership + modes (backend install + BACKEND_HOME + vault)
# ---------------------------------------------------------------------------
ensure_ownership() {
  if [ "$APPLY_OWNERSHIP" != "1" ]; then
    log "Skipping ownership apply"
    return 0
  fi
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY-RUN: would chown $RUNTIME_USER:$RUNTIME_GROUP backend install ($BACKEND_INSTALL_ROOT or $BACKEND_INSTALL_PATH)"
    log "DRY-RUN: would ensure BACKEND_HOME=$BACKEND_HOME (layout dirs: ${BACKEND_HOME_DIRS[*]})"
    log "DRY-RUN: would ensure vault group access on $VAULT_ROOT"
    return 0
  fi
  require_root_for_live
  if ! id "$RUNTIME_USER" >/dev/null 2>&1; then
    err "Runtime user $RUNTIME_USER missing; create user first"
    exit 3
  fi

  # Own backend install tree (binaries executable; not world-writable).
  # Prefer install root so versioned dirs + current symlink are covered.
  local install_target=""
  if [ -d "$BACKEND_INSTALL_ROOT" ]; then
    install_target="$BACKEND_INSTALL_ROOT"
  elif [ -d "$BACKEND_INSTALL_PATH" ]; then
    install_target="$BACKEND_INSTALL_PATH"
  elif [ -d "$HERMES_INSTALL_PATH" ] && [ "$HERMES_INSTALL_PATH" != "$BACKEND_INSTALL_PATH" ]; then
    # Migration: legacy Hermes flat install still present
    install_target="$HERMES_INSTALL_PATH"
  fi

  if [ -n "$install_target" ]; then
    chown -R "$RUNTIME_USER:$RUNTIME_GROUP" "$install_target"
    chmod -R u+rwX,g+rX,o-rwx "$install_target" || true
    log "Owned backend install: $install_target → $RUNTIME_USER"
  else
    warn "Backend install path missing (run bootstrap first): $BACKEND_INSTALL_ROOT or $BACKEND_INSTALL_PATH"
  fi

  # BACKEND_HOME layout (runtime state; contract tree)
  mkdir -p "$BACKEND_HOME"
  local d
  for d in "${BACKEND_HOME_DIRS[@]}"; do
    mkdir -p "$BACKEND_HOME/$d"
  done
  chown -R "$RUNTIME_USER:$RUNTIME_GROUP" "$BACKEND_HOME"
  chmod 700 "$BACKEND_HOME"
  for d in "${BACKEND_HOME_DIRS[@]}"; do
    chmod 700 "$BACKEND_HOME/$d" 2>/dev/null || true
  done
  log "Owned BACKEND_HOME: $BACKEND_HOME → $RUNTIME_USER (layout dirs ready)"

  # Hermes alias home only if distinct from BACKEND_HOME (migration hosts)
  if [ "$HERMES_HOME" != "$BACKEND_HOME" ]; then
    mkdir -p "$HERMES_HOME/profiles" "$HERMES_HOME/logs"
    chown -R "$RUNTIME_USER:$RUNTIME_GROUP" "$HERMES_HOME"
    chmod 700 "$HERMES_HOME"
    log "Owned distinct HERMES_HOME (migration): $HERMES_HOME"
  fi

  if [ -d "$VAULT_ROOT" ]; then
    # Keep operator-friendly access: root owns tree, service group RW for runtime
    chgrp -R "$RUNTIME_GROUP" "$VAULT_ROOT" || true
    chmod -R g+rwX "$VAULT_ROOT" || true
    chmod o-rwx "$VAULT_ROOT" 2>/dev/null || true
    log "Vault group access for $RUNTIME_GROUP: $VAULT_ROOT"
  else
    warn "Vault root missing: $VAULT_ROOT"
  fi
}

harden_secrets() {
  if [ "$HARDEN_SECRETS" != "1" ]; then
    log "Skipping secrets hardening"
    return 0
  fi
  local candidates=(
    "$BACKEND_HOME/.env"
    "$BACKEND_HOME/.env.secrets"
    "$BACKEND_HOME/config.secrets.yaml"
    "$HERMES_HOME/.env"
    "$HERMES_HOME/.env.secrets"
    "$HERMES_HOME/config.secrets.yaml"
  )
  # Migration / first-boot operator paths
  if [ -n "${HOME:-}" ] && [ -f "${HOME}/.hermes/.env" ]; then
    candidates+=("${HOME}/.hermes/.env")
  fi
  if [ -f /home/ec2-user/.hermes/.env ]; then
    candidates+=(/home/ec2-user/.hermes/.env)
  fi
  if [ -f /home/hermes/.hermes/.env ]; then
    candidates+=(/home/hermes/.hermes/.env)
  fi

  local f
  for f in "${candidates[@]}"; do
    if [ "$DRY_RUN" = "1" ]; then
      if [ -f "$f" ] || [ "$f" = "$BACKEND_HOME/.env" ]; then
        log "DRY-RUN: would chmod 0600 and chown $RUNTIME_USER (if service path) on $f"
      fi
      continue
    fi
    if [ -f "$f" ]; then
      chmod 0600 "$f"
      case "$f" in
        "$BACKEND_HOME"/*|"$HERMES_HOME"/*|"$SERVICE_HOME"/*|/home/"$RUNTIME_USER"/*)
          chown "$RUNTIME_USER:$RUNTIME_GROUP" "$f"
          ;;
      esac
      log "Secrets mode 0600: $f"
    fi
  done
  # Ensure primary secrets path exists (empty placeholder) under BACKEND_HOME
  if [ "$DRY_RUN" != "1" ]; then
    if [ ! -f "$BACKEND_HOME/.env" ]; then
      mkdir -p "$BACKEND_HOME"
      touch "$BACKEND_HOME/.env"
      chown "$RUNTIME_USER:$RUNTIME_GROUP" "$BACKEND_HOME/.env"
      chmod 0600 "$BACKEND_HOME/.env"
      log "Created empty secrets file (0600): $BACKEND_HOME/.env"
    fi
  else
    log "DRY-RUN: would ensure secrets file 0600 at $BACKEND_HOME/.env"
  fi
}

# ---------------------------------------------------------------------------
# materialize-backend-secrets host tool (lp-645.4)
# ---------------------------------------------------------------------------
# Installed from monorepo deploy/scripts — NOT base64gzip-embedded in user_data
# (combined bootstrap + secrets fragment must stay under EC2 16 KiB gzip limit).
install_materialize_tools() {
  if [ "$INSTALL_MATERIALIZE" != "1" ]; then
    log "Skipping materialize tool install"
    return 0
  fi
  if [ ! -f "$MATERIALIZE_PY_SRC" ]; then
    warn "materialize tool source missing: $MATERIALIZE_PY_SRC (skip install)"
    return 0
  fi
  if [ ! -f "$MATERIALIZE_WRAPPER_SRC" ]; then
    warn "materialize wrapper source missing: $MATERIALIZE_WRAPPER_SRC (skip install)"
    return 0
  fi
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY-RUN: would install $MATERIALIZE_PY_SRC → $MATERIALIZE_PY_DST"
    log "DRY-RUN: would install $MATERIALIZE_WRAPPER_SRC → $MATERIALIZE_WRAPPER_DST"
    return 0
  fi
  require_root_for_live
  install -d -m 0755 "$(dirname "$MATERIALIZE_PY_DST")"
  install -d -m 0755 "$(dirname "$MATERIALIZE_WRAPPER_DST")"
  install -m 0755 "$MATERIALIZE_PY_SRC" "$MATERIALIZE_PY_DST"
  install -m 0755 "$MATERIALIZE_WRAPPER_SRC" "$MATERIALIZE_WRAPPER_DST"
  chown root:root "$MATERIALIZE_PY_DST" "$MATERIALIZE_WRAPPER_DST"
  log "Installed materialize-backend-secrets → $MATERIALIZE_WRAPPER_DST (py=$MATERIALIZE_PY_DST)"
}

# ---------------------------------------------------------------------------
# systemd units
# ---------------------------------------------------------------------------
_install_one_unit() {
  local name="$1"
  local unit_src="$SYSTEMD_SRC/${name}.service"
  local dropin_src="$SYSTEMD_SRC/${name}.service.d"
  [ -f "$unit_src" ] || { err "Missing $unit_src"; return 1; }

  if [ "$DRY_RUN" = "1" ]; then
    log "DRY-RUN: would install $unit_src → $SYSTEMD_DST/${name}.service"
    [ -d "$dropin_src" ] && log "DRY-RUN: would install drop-ins from $dropin_src"
    return 0
  fi
  require_root_for_live
  install -d -m 0755 "$SYSTEMD_DST"
  install -m 0644 "$unit_src" "$SYSTEMD_DST/${name}.service"
  if [ -d "$dropin_src" ]; then
    install -d -m 0755 "$SYSTEMD_DST/${name}.service.d"
    local f
    for f in "$dropin_src"/*.conf; do
      [ -f "$f" ] || continue
      install -m 0644 "$f" "$SYSTEMD_DST/${name}.service.d/"
    done
  fi
  log "Installed ${name}.service under $SYSTEMD_DST"
}

install_systemd_units() {
  if [ "$INSTALL_SYSTEMD" != "1" ]; then
    log "Skipping systemd install"
    return 0
  fi

  _install_one_unit "$SERVICE_UNIT" || return 1

  if [ "$INSTALL_LEGACY_UNIT" = "1" ]; then
    if [ -f "$SYSTEMD_SRC/${LEGACY_SERVICE_UNIT}.service" ]; then
      _install_one_unit "$LEGACY_SERVICE_UNIT" || warn "legacy unit install failed"
    else
      warn "INSTALL_LEGACY_UNIT=1 but ${LEGACY_SERVICE_UNIT}.service not found"
    fi
  fi

  if [ "$DRY_RUN" = "1" ]; then
    return 0
  fi
  require_root_for_live
  systemctl daemon-reload
  if [ "$ENABLE_SERVICE" = "1" ]; then
    systemctl enable --now "${SERVICE_UNIT}.service" \
      || warn "enable/start ${SERVICE_UNIT} failed (artifact/layout?)"
  else
    log "Unit installed but not enabled (set ENABLE_SERVICE=1 or --enable-service after backend is configured)"
  fi
}

# ---------------------------------------------------------------------------
# Tool allowlist seeds
# ---------------------------------------------------------------------------
seed_tool_allowlists() {
  if [ "$SEED_TOOL_ALLOWLISTS" != "1" ]; then
    log "Skipping tool allowlist seed"
    return 0
  fi
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY-RUN: would copy $TOOL_ALLOWLIST_SRC/{admin,contributor}.json → $TOOL_ALLOWLIST_DST/"
    log "DRY-RUN: would mirror under $BACKEND_HOME/tool-allowlists/"
    return 0
  fi
  require_root_for_live
  install -d -m 0755 "$TOOL_ALLOWLIST_DST"
  install -m 0644 "$TOOL_ALLOWLIST_SRC/admin.json" "$TOOL_ALLOWLIST_DST/admin.json"
  install -m 0644 "$TOOL_ALLOWLIST_SRC/contributor.json" "$TOOL_ALLOWLIST_DST/contributor.json"
  if id "$RUNTIME_USER" >/dev/null 2>&1; then
    install -d -m 0755 "$BACKEND_HOME/tool-allowlists"
    install -m 0644 -o "$RUNTIME_USER" -g "$RUNTIME_GROUP" \
      "$TOOL_ALLOWLIST_SRC/admin.json" "$BACKEND_HOME/tool-allowlists/admin.json"
    install -m 0644 -o "$RUNTIME_USER" -g "$RUNTIME_GROUP" \
      "$TOOL_ALLOWLIST_SRC/contributor.json" "$BACKEND_HOME/tool-allowlists/contributor.json"
  fi
  log "Seeded tool allowlists → $TOOL_ALLOWLIST_DST"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
log "Company Brain runtime hardening"
log "  runtime_user=$RUNTIME_USER dry_run=$DRY_RUN"
log "  vault=$VAULT_ROOT"
log "  backend_install_root=$BACKEND_INSTALL_ROOT"
log "  backend_install_path=$BACKEND_INSTALL_PATH"
log "  backend_home=$BACKEND_HOME"
log "  service_unit=$SERVICE_UNIT (legacy_unit_install=$INSTALL_LEGACY_UNIT)"
log "  hermes_aliases: HERMES_HOME=$HERMES_HOME HERMES_INSTALL_PATH=$HERMES_INSTALL_PATH"

check_unit_files
check_tool_allowlists

ensure_runtime_user
ensure_ownership
harden_secrets
seed_tool_allowlists
install_materialize_tools
install_systemd_units

log "Runtime hardening complete."
if [ "$DRY_RUN" = "1" ]; then
  log "Dry-run only — re-run without --dry-run as root on the host after bootstrap."
fi
