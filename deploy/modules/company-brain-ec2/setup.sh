#!/usr/bin/env bash
# modules/company-brain-ec2/setup.sh
# Optional post-seed host helpers (Tailscale drop-in, local scaffold hooks,
# runtime hardening: unprivileged company-brain user + systemd sandbox).
# Primary install path is /usr/local/sbin/company-brain-bootstrap
# (user_data injects monorepo scripts/bootstrap-host.sh).
#
# Usage (on the instance, after company-brain-bootstrap has seeded the vault):
#   cd /opt/company-brain
#   # or copy this setup.sh onto the host from company-brain-deploy / monorepo deploy/
#   ./setup.sh
#
# Safe to re-run.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Repo root when this file lives at modules/company-brain-ec2/setup.sh
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

VAULT_ROOT="${VAULT_ROOT:-/opt/company-brain}"
# Platform paths (lp-k7g.10.4 / company-brain-backend.service)
BACKEND_INSTALL_ROOT="${BACKEND_INSTALL_ROOT:-/opt/company-brain-backend}"
BACKEND_INSTALL_PATH="${BACKEND_INSTALL_PATH:-${BACKEND_INSTALL_ROOT}/current}"
BACKEND_HOME="${BACKEND_HOME:-/var/lib/company-brain-backend}"
# Hermes-compatible aliases (equal to platform paths when unset)
HERMES_INSTALL_PATH="${HERMES_INSTALL_PATH:-$BACKEND_INSTALL_PATH}"
HERMES_HOME="${HERMES_HOME:-$BACKEND_HOME}"
RUNTIME_USER="${RUNTIME_USER:-company-brain}"
# Set ENSURE_RUNTIME_HARDENING=0 to skip user/systemd/allowlist hardening.
ENSURE_RUNTIME_HARDENING="${ENSURE_RUNTIME_HARDENING:-1}"
INSTALL_FOCR="${INSTALL_FOCR:-0}"
INIT_CRM="${INIT_CRM:-1}"
INIT_EVALS="${INIT_EVALS:-1}"
SYNC_SELF_IMPROVE="${SYNC_SELF_IMPROVE:-1}"

log() { echo -e "\033[0;32m[company-brain-setup]\033[0m $*"; }
warn() { echo -e "\033[0;33m[company-brain-setup]\033[0m $*"; }
err() { echo -e "\033[0;31m[company-brain-setup]\033[0m $*" >&2; }

log "Company Brain post-seed setup starting"
log "  Vault root:            $VAULT_ROOT"
log "  Backend install path:  $BACKEND_INSTALL_PATH"
log "  Backend home:          $BACKEND_HOME"
log "  Hermes aliases:        install=$HERMES_INSTALL_PATH home=$HERMES_HOME"
log "  Runtime user:          $RUNTIME_USER"

# ---------------------------------------------------------------------------
# 1. Backend / Hermes on PATH (installed by bootstrap into BACKEND_INSTALL_PATH)
# ---------------------------------------------------------------------------
for _bin_root in "$BACKEND_INSTALL_PATH" "$HERMES_INSTALL_PATH"; do
  if [ -d "$_bin_root/bin" ]; then
    case ":$PATH:" in
      *":$_bin_root/bin:"*) ;;
      *) export PATH="$_bin_root/bin:$PATH" ;;
    esac
  fi
done
unset _bin_root

if [ -d "$HOME/.local/bin" ]; then
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) export PATH="$HOME/.local/bin:$PATH" ;;
  esac
fi

if [ -x "$BACKEND_INSTALL_PATH/bin/company-brain-backend" ]; then
  log "Backend entrypoint: $BACKEND_INSTALL_PATH/bin/company-brain-backend"
elif command -v company-brain-backend >/dev/null 2>&1; then
  log "Backend on PATH: $(command -v company-brain-backend)"
else
  warn "company-brain-backend not found under $BACKEND_INSTALL_PATH — run bootstrap first."
fi

if command -v hermes >/dev/null 2>&1; then
  log "Hermes (compat) version: $(hermes --version 2>/dev/null || echo 'unknown')"
fi

# ---------------------------------------------------------------------------
# 2. Seed-local scaffold (client-core scripts, if present)
# ---------------------------------------------------------------------------
if [ -x "$VAULT_ROOT/scripts/setup-local.sh" ]; then
  log "Running scripts/setup-local.sh"
  "$VAULT_ROOT/scripts/setup-local.sh" || warn "setup-local.sh reported missing optional tools (ok on first pass)"
else
  warn "scripts/setup-local.sh not found under $VAULT_ROOT — seed may be incomplete"
fi

if [ "$INIT_CRM" = "1" ] && [ -x "$VAULT_ROOT/scripts/init-crm-db.sh" ]; then
  if [ -f "$VAULT_ROOT/Clients/clients_crm.db" ]; then
    log "CRM DB already present (leaving it alone)"
  else
    log "Initializing empty CRM database"
    "$VAULT_ROOT/scripts/init-crm-db.sh" || warn "init-crm-db.sh failed"
  fi
fi

if [ "$INIT_EVALS" = "1" ] && [ -x "$VAULT_ROOT/scripts/init-evals-db.sh" ]; then
  log "Initializing evals.db at vault root (idempotent): $VAULT_ROOT"
  "$VAULT_ROOT/scripts/init-evals-db.sh" "$VAULT_ROOT" || warn "init-evals-db.sh failed"
fi

if [ "$SYNC_SELF_IMPROVE" = "1" ] && [ -x "$VAULT_ROOT/scripts/sync-self-improve-to-hermes.sh" ]; then
  log "Syncing self-improve skill into Hermes"
  (cd "$VAULT_ROOT" && ./scripts/sync-self-improve-to-hermes.sh) || warn "self-improve sync failed"
fi

# ---------------------------------------------------------------------------
# 3. Optional focr (OCR worker / ingest host)
# ---------------------------------------------------------------------------
if [ "$INSTALL_FOCR" = "1" ]; then
  if [ -x "$VAULT_ROOT/scripts/install-focr.sh" ]; then
    log "Installing franken_ocr (INSTALL_FOCR=1)"
    "$VAULT_ROOT/scripts/install-focr.sh" || warn "focr install failed"
  else
    warn "focr install script missing in seed; skip or supply via pack"
  fi
else
  log "Skipping focr (set INSTALL_FOCR=1 on OCR workers ≥ 8 GB RAM)"
fi

# ---------------------------------------------------------------------------
# 4. Optional Tailscale secondary access (install + enroll + accept-dns)
# ---------------------------------------------------------------------------
# Primary operator path remains SSM Session Manager. Tailscale is optional mesh
# secondary access. Auth key must come from SSM/Secrets Manager — never paste a
# long-lived key into this script or tfvars. See:
#   references/runbooks/tailscale-operator-access.md
#
# ENABLE_TAILSCALE=1 — run enroll helper when present, else best-effort install path
# TAILSCALE_CONFIG_FILE — default /etc/company-brain/tailscale.env (from user_data)
ENROLL_BIN="${TAILSCALE_ENROLL_BIN:-/usr/local/sbin/company-brain-tailscale-enroll}"
ENROLL_SRC="$SCRIPT_DIR/scripts/tailscale-enroll.sh"
TAILSCALE_DROPIN_SRC="$SCRIPT_DIR/systemd/tailscaled.service.d/accept-dns-off.conf"

if [ "${ENABLE_TAILSCALE:-0}" = "1" ]; then
  if [ -x "$ENROLL_BIN" ]; then
    log "Running Tailscale enroll helper: $ENROLL_BIN"
    sudo "$ENROLL_BIN" || warn "Tailscale enroll failed — check IAM/secret/egress (SSM still primary)"
  elif [ -f "$ENROLL_SRC" ]; then
    log "Installing enroll helper from $ENROLL_SRC"
    sudo install -m 0755 -o root -g root "$ENROLL_SRC" "$ENROLL_BIN"
    sudo "$ENROLL_BIN" || warn "Tailscale enroll failed — check IAM/secret/egress (SSM still primary)"
  else
    warn "ENABLE_TAILSCALE=1 but enroll helper missing ($ENROLL_BIN / $ENROLL_SRC)"
    warn "Re-apply with enable_tailscale=true or copy scripts/tailscale-enroll.sh onto the host"
  fi
elif command -v tailscale >/dev/null 2>&1; then
  # Light path: package already present (manual install) — ensure accept-dns drop-in only
  if [ -f "$TAILSCALE_DROPIN_SRC" ]; then
    TAILSCALE_DROPIN_DEST="/etc/systemd/system/tailscaled.service.d/accept-dns-off.conf"
    sudo mkdir -p /etc/systemd/system/tailscaled.service.d
    dropin_changed=false
    if ! sudo cmp -s "$TAILSCALE_DROPIN_SRC" "$TAILSCALE_DROPIN_DEST" 2>/dev/null; then
      sudo cp "$TAILSCALE_DROPIN_SRC" "$TAILSCALE_DROPIN_DEST"
      dropin_changed=true
    fi
    if $dropin_changed; then
      sudo systemctl daemon-reload
      if systemctl is-active --quiet tailscaled 2>/dev/null; then
        sudo systemctl restart tailscaled || warn "tailscaled restart failed after drop-in install"
      fi
      log "Installed tailscaled drop-in: accept-dns=false survives reboot"
    else
      log "Tailscale accept-dns drop-in already installed"
    fi
  fi
  if tailscale set --accept-dns=false 2>/dev/null; then
    log "Tailscale accept-dns=false applied"
  else
    warn "tailscale set --accept-dns=false not ready yet — drop-in applies after tailscaled starts"
  fi
else
  log "Skipping Tailscale (set ENABLE_TAILSCALE=1 after enable_tailscale=true, or install manually)"
fi

# ---------------------------------------------------------------------------
# 5. Optional data volume mount hint
# ---------------------------------------------------------------------------
if [ -b /dev/xvdf ] || [ -b /dev/nvme1n1 ]; then
  warn "Secondary block device detected. If you set data_volume_size_gb, format/mount to /data and point VAULT_ROOT there. See references/deployment.md"
fi

# ---------------------------------------------------------------------------
# 5b. Optional CloudWatch agent re-apply (host log shipping)
# ---------------------------------------------------------------------------
# user_data installs the agent when enable_host_log_shipping=true. Re-run here if
# the config file exists but the agent is not active (e.g. after AMI restore).
CW_AGENT_CFG="${CW_AGENT_CFG:-/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json}"
if [ "${ENSURE_CW_AGENT:-1}" = "1" ] && [ -f "$CW_AGENT_CFG" ]; then
  if command -v amazon-cloudwatch-agent-ctl >/dev/null 2>&1; then
    if systemctl is-active --quiet amazon-cloudwatch-agent 2>/dev/null; then
      log "CloudWatch agent already active (host log shipping)"
    else
      log "Starting CloudWatch agent from $CW_AGENT_CFG"
      sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
        -a fetch-config -m ec2 -s -c "file:$CW_AGENT_CFG" || warn "CloudWatch agent start failed"
    fi
  else
    warn "CloudWatch agent config present but amazon-cloudwatch-agent-ctl missing — install amazon-cloudwatch-agent"
  fi
else
  log "Skipping CloudWatch agent ensure (no config at $CW_AGENT_CFG or ENSURE_CW_AGENT=0)"
fi

# ---------------------------------------------------------------------------
# 5c. Runtime hardening (unprivileged service user, systemd sandbox, allowlists)
# ---------------------------------------------------------------------------
# Full implementation: scripts/ensure-runtime-hardening.sh
# Docs: references/runbooks/host-runtime-hardening.md
# Unit: company-brain-backend.service (BACKEND_HOME + /opt/company-brain-backend/current)
# Also installs materialize-backend-secrets from monorepo (not embedded in user_data).
RUNTIME_HARDENING_SCRIPT="${RUNTIME_HARDENING_SCRIPT:-$REPO_ROOT/scripts/ensure-runtime-hardening.sh}"
if [ "$ENSURE_RUNTIME_HARDENING" = "1" ] && [ -f "$RUNTIME_HARDENING_SCRIPT" ]; then
  log "Applying host runtime hardening (user=$RUNTIME_USER backend_home=$BACKEND_HOME)"
  _hardening_env=(
    RUNTIME_USER="$RUNTIME_USER"
    VAULT_ROOT="$VAULT_ROOT"
    BACKEND_HOME="$BACKEND_HOME"
    BACKEND_INSTALL_PATH="$BACKEND_INSTALL_PATH"
    BACKEND_INSTALL_ROOT="$BACKEND_INSTALL_ROOT"
    HERMES_HOME="$HERMES_HOME"
    HERMES_INSTALL_PATH="$HERMES_INSTALL_PATH"
  )
  if [ "$(id -u)" = "0" ]; then
    env "${_hardening_env[@]}" \
      bash "$RUNTIME_HARDENING_SCRIPT" || warn "runtime hardening reported errors"
  elif command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    sudo -n env "${_hardening_env[@]}" \
      bash "$RUNTIME_HARDENING_SCRIPT" || warn "runtime hardening reported errors"
  else
    warn "runtime hardening needs root — run: sudo bash $RUNTIME_HARDENING_SCRIPT"
    # Offline-friendly: still validate unit directives when non-root
    bash "$RUNTIME_HARDENING_SCRIPT" --dry-run || warn "runtime hardening dry-run failed"
  fi
  unset _hardening_env
elif [ "$ENSURE_RUNTIME_HARDENING" = "1" ]; then
  warn "ensure-runtime-hardening.sh not found at $RUNTIME_HARDENING_SCRIPT (copy deploy scripts/)"
else
  log "Skipping runtime hardening (ENSURE_RUNTIME_HARDENING=0)"
fi

# ---------------------------------------------------------------------------
# 5d. Backend runtime secrets materialize (AWS SM ARN only — never secret values)
# ---------------------------------------------------------------------------
# user_data writes /etc/company-brain/backend-runtime-secrets.env (ARN/region only).
# Materialize tool is installed by ensure-runtime-hardening (above) or copied here
# from monorepo — NOT embedded in user_data (EC2 16 KiB budget with bootstrap).
# systemd ExecStartPre also invokes materialize for rotation-friendly restarts.
MATERIALIZE_BIN="${MATERIALIZE_BACKEND_SECRETS_BIN:-/usr/local/sbin/materialize-backend-secrets}"
MATERIALIZE_PY_DST="${MATERIALIZE_BACKEND_SECRETS_PY:-/usr/local/lib/company-brain/materialize-backend-secrets.py}"
MATERIALIZE_PY_SRC="${MATERIALIZE_PY_SRC:-$REPO_ROOT/scripts/materialize-backend-secrets.py}"
MATERIALIZE_WRAPPER_SRC="${MATERIALIZE_WRAPPER_SRC:-$SCRIPT_DIR/scripts/materialize-backend-secrets.sh}"
SECRETS_ENV_FILE="${BACKEND_RUNTIME_SECRETS_ENV_FILE:-/etc/company-brain/backend-runtime-secrets.env}"

_install_materialize_from_repo() {
  if [ ! -f "$MATERIALIZE_PY_SRC" ] || [ ! -f "$MATERIALIZE_WRAPPER_SRC" ]; then
    return 1
  fi
  if [ "$(id -u)" = "0" ]; then
    install -d -m 0755 "$(dirname "$MATERIALIZE_PY_DST")"
    install -d -m 0755 "$(dirname "$MATERIALIZE_BIN")"
    install -m 0755 "$MATERIALIZE_PY_SRC" "$MATERIALIZE_PY_DST"
    install -m 0755 "$MATERIALIZE_WRAPPER_SRC" "$MATERIALIZE_BIN"
    chown root:root "$MATERIALIZE_PY_DST" "$MATERIALIZE_BIN"
    return 0
  fi
  if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    sudo -n install -d -m 0755 "$(dirname "$MATERIALIZE_PY_DST")"
    sudo -n install -d -m 0755 "$(dirname "$MATERIALIZE_BIN")"
    sudo -n install -m 0755 "$MATERIALIZE_PY_SRC" "$MATERIALIZE_PY_DST"
    sudo -n install -m 0755 "$MATERIALIZE_WRAPPER_SRC" "$MATERIALIZE_BIN"
    sudo -n chown root:root "$MATERIALIZE_PY_DST" "$MATERIALIZE_BIN"
    return 0
  fi
  return 1
}

if [ "${ENSURE_BACKEND_RUNTIME_SECRETS:-1}" = "1" ]; then
  if [ -f "$SECRETS_ENV_FILE" ] || [ -n "${BACKEND_RUNTIME_SECRETS_ARN:-}" ] || [ -x "$MATERIALIZE_BIN" ]; then
    if [ ! -x "$MATERIALIZE_BIN" ]; then
      if _install_materialize_from_repo; then
        log "Installed materialize-backend-secrets from monorepo deploy path"
      else
        warn "BACKEND_RUNTIME_SECRETS configured but $MATERIALIZE_BIN missing — run ensure-runtime-hardening or copy deploy scripts"
      fi
    fi
    if [ -x "$MATERIALIZE_BIN" ]; then
      log "Materializing backend runtime secrets from SM (ARN ref only; values not logged)"
      if [ "$(id -u)" = "0" ]; then
        MATERIALIZE_FILE_OWNER="$RUNTIME_USER" "$MATERIALIZE_BIN" \
          || warn "materialize-backend-secrets failed — check IAM/ARN/envelope"
      elif command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
        sudo -n env MATERIALIZE_FILE_OWNER="$RUNTIME_USER" BACKEND_HOME="$BACKEND_HOME" \
          "$MATERIALIZE_BIN" || warn "materialize-backend-secrets failed — check IAM/ARN/envelope"
      else
        warn "materialize needs root for $BACKEND_HOME ownership — run: sudo $MATERIALIZE_BIN"
      fi
    fi
  else
    log "Skipping backend runtime secrets materialize (no ARN config / wrapper)"
  fi
else
  log "Skipping backend runtime secrets materialize (ENSURE_BACKEND_RUNTIME_SECRETS=0)"
fi
unset -f _install_materialize_from_repo

# ---------------------------------------------------------------------------
# 6. Next steps
# ---------------------------------------------------------------------------
echo
log "=== Next steps (on this instance) ==="
echo
echo "1. Verify backend entrypoint:"
echo "   $BACKEND_INSTALL_PATH/bin/company-brain-backend --help || hermes doctor"
echo
echo "2. Configure model (product CLI; xAI Grok OAuth recommended where supported):"
echo "   hermes model   # Hermes kinds; lanyard_agent uses product-specific config"
echo
echo "3. Secrets (never commit) — prefer AWS SM + materialize over hand-edited keys:"
echo "   # Terraform: backend_runtime_secrets_arn = \"arn:aws:secretsmanager:…:secret:…\""
echo "   sudo /usr/local/sbin/materialize-backend-secrets   # ARN from /etc/company-brain/backend-runtime-secrets.env"
echo "   # outputs: $BACKEND_HOME/.env.secrets (mode 0600); optional config.secrets.yaml"
echo "   # manual lab only: sudo -u $RUNTIME_USER \$EDITOR $BACKEND_HOME/.env"
echo "   # migration hermes path: /home/hermes/.hermes/.env (drop-in User=hermes)"
echo
echo "4. Portal relay (if using Lanyard Web Portal):"
echo "   # Apply modules/customer-gateway-relay or set GATEWAY_RELAY_* from control-plane provision"
echo "   # See: modules/customer-gateway-relay/ and references/provision-runbook.md"
echo
echo "5. Confirm profiles admin + contributor under BACKEND_HOME:"
echo "   sudo BACKEND_HOME=$BACKEND_HOME HERMES_HOME=$BACKEND_HOME bash scripts/ensure-hermes-profiles.sh --require"
echo
echo "6. Enable sandboxed gateway unit (after env + model ready):"
echo "   sudo systemctl enable --now company-brain-backend"
echo "   # See: references/runbooks/host-runtime-hardening.md"
echo "   # Migration: hermes-gateway remains available via ensure --install-legacy-unit"
echo
echo "Environment overrides:"
echo "   VAULT_ROOT=... BACKEND_HOME=... BACKEND_INSTALL_PATH=... RUNTIME_USER=company-brain"
echo "   HERMES_HOME / HERMES_INSTALL_PATH are aliases (set equal to platform paths)"
echo "   ENSURE_RUNTIME_HARDENING=0 ENSURE_BACKEND_RUNTIME_SECRETS=0 ENABLE_TAILSCALE=1"
echo "   INSTALL_FOCR=1 INIT_CRM=0 INIT_EVALS=0 SYNC_SELF_IMPROVE=0"
echo
log "Setup complete."
