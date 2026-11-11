#!/usr/bin/env bash
# modules/company-brain-ec2/scripts/tailscale-enroll.sh
# Optional Tailscale install + enrollment for Company Brain Hermes hosts.
#
# Auth key is NEVER expected as a long-lived env in tfvars/user_data.
# Fetch a one-time (or short-lived) auth key from SSM Parameter Store or
# Secrets Manager using the instance role, then pass it only to `tailscale up`.
#
# Config (non-secret) is loaded from:
#   /etc/company-brain/tailscale.env  (written by user_data when enable_tailscale=true)
# Override any key via the environment before invoking this script.
#
# Usage (on the instance):
#   sudo /usr/local/sbin/company-brain-tailscale-enroll
#   sudo ENABLE_TAILSCALE_INSTALL=1 /usr/local/sbin/company-brain-tailscale-enroll
#
# Safe to re-run: if already logged in and TAILSCALE_FORCE_REENROLL!=1, exits 0.
set -euo pipefail

CONFIG_FILE="${TAILSCALE_CONFIG_FILE:-/etc/company-brain/tailscale.env}"
if [ -f "$CONFIG_FILE" ]; then
  # shellcheck disable=SC1090
  set -a
  # shellcheck source=/dev/null
  . "$CONFIG_FILE"
  set +a
fi

log() { echo -e "\033[0;32m[company-brain-tailscale]\033[0m $*"; }
warn() { echo -e "\033[0;33m[company-brain-tailscale]\033[0m $*"; }
err() { echo -e "\033[0;31m[company-brain-tailscale]\033[0m $*" >&2; }

if [ "$(id -u)" -ne 0 ]; then
  err "Run as root (sudo)."
  exit 1
fi

# ---------------------------------------------------------------------------
# Config defaults (non-secret)
# ---------------------------------------------------------------------------
PROJECT_NAME="${PROJECT_NAME:-company-brain}"
TAILSCALE_AUTH_SECRET_SOURCE="${TAILSCALE_AUTH_SECRET_SOURCE:-ssm}" # ssm | secretsmanager
TAILSCALE_AUTH_SECRET_SSM_PARAMETER="${TAILSCALE_AUTH_SECRET_SSM_PARAMETER:-}"
TAILSCALE_AUTH_SECRET_SECRETS_MANAGER_ARN="${TAILSCALE_AUTH_SECRET_SECRETS_MANAGER_ARN:-}"
AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
# Comma-separated Tailscale ACL tags, e.g. tag:tenant=acme-brain,tag:role=company-brain
TAILSCALE_TAGS="${TAILSCALE_TAGS:-tag:tenant=${PROJECT_NAME},tag:role=company-brain}"
TAILSCALE_HOSTNAME="${TAILSCALE_HOSTNAME:-${PROJECT_NAME}-hermes}"
# accept-dns must stay false so VPC resolver / model API egress keep working
TAILSCALE_ACCEPT_DNS="${TAILSCALE_ACCEPT_DNS:-false}"
TAILSCALE_ACCEPT_ROUTES="${TAILSCALE_ACCEPT_ROUTES:-false}"
TAILSCALE_SSH="${TAILSCALE_SSH:-false}"
# Extra args appended to `tailscale up` (space-separated; advanced)
TAILSCALE_EXTRA_UP_ARGS="${TAILSCALE_EXTRA_UP_ARGS:-}"
ENABLE_TAILSCALE_INSTALL="${ENABLE_TAILSCALE_INSTALL:-1}"
TAILSCALE_FORCE_REENROLL="${TAILSCALE_FORCE_REENROLL:-0}"
# When 1, skip enroll if already connected (default). Set 0 to always re-auth.
TAILSCALE_SKIP_IF_LOGGED_IN="${TAILSCALE_SKIP_IF_LOGGED_IN:-1}"

resolve_region() {
  if [ -n "${AWS_REGION:-}" ]; then
    echo "$AWS_REGION"
    return
  fi
  if command -v curl >/dev/null 2>&1; then
    # IMDSv2
    token=$(curl -sS -X PUT "http://169.254.169.254/latest/api/token" \
      -H "X-aws-ec2-metadata-token-ttl-seconds: 60" --connect-timeout 2 || true)
    if [ -n "$token" ]; then
      curl -sS -H "X-aws-ec2-metadata-token: $token" \
        --connect-timeout 2 \
        "http://169.254.169.254/latest/meta-data/placement/region" || true
      return
    fi
  fi
  echo ""
}

AWS_REGION="$(resolve_region)"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-$AWS_REGION}"

# ---------------------------------------------------------------------------
# Install tailscale if needed
# ---------------------------------------------------------------------------
install_tailscale() {
  if command -v tailscale >/dev/null 2>&1 && command -v tailscaled >/dev/null 2>&1; then
    log "tailscale already installed: $(tailscale version 2>/dev/null | head -1 || echo unknown)"
    return 0
  fi

  if [ "$ENABLE_TAILSCALE_INSTALL" != "1" ]; then
    err "tailscale not installed and ENABLE_TAILSCALE_INSTALL!=1"
    exit 2
  fi

  log "Installing Tailscale (requires HTTPS egress to pkgs.tailscale.com / install script)"
  if command -v dnf >/dev/null 2>&1; then
    # Prefer official package path when available; fall back to install.sh
    if dnf install -y tailscale 2>/dev/null; then
      :
    else
      if ! command -v curl >/dev/null 2>&1; then
        dnf install -y curl 2>/dev/null || true
      fi
      curl -fsSL https://tailscale.com/install.sh | sh
    fi
  elif command -v yum >/dev/null 2>&1; then
    curl -fsSL https://tailscale.com/install.sh | sh
  else
    err "No dnf/yum; install tailscale manually or prebake on golden AMI"
    exit 2
  fi

  systemctl enable --now tailscaled 2>/dev/null || true
  log "tailscale installed"
}

# ---------------------------------------------------------------------------
# accept-dns drop-in (keep VPC DNS for model/API egress)
# ---------------------------------------------------------------------------
install_accept_dns_dropin() {
  local dest="/etc/systemd/system/tailscaled.service.d/accept-dns-off.conf"
  mkdir -p /etc/systemd/system/tailscaled.service.d
  cat >"$dest" <<'DROPIN'
# company-brain-tailscale-enroll — keep VPC DNS for public internet;
# MagicDNS can break egress for model/API calls on Hermes EC2.
[Service]
ExecStartPost=-/usr/bin/bash -c 'for i in $(seq 1 45); do /usr/bin/tailscale set --accept-dns=false 2>/dev/null && exit 0; sleep 2; done; exit 0'
DROPIN
  systemctl daemon-reload
  if systemctl is-active --quiet tailscaled 2>/dev/null; then
    systemctl restart tailscaled || warn "tailscaled restart failed after drop-in"
  fi
  log "Installed tailscaled drop-in: accept-dns=false"
}

# ---------------------------------------------------------------------------
# Fetch one-time auth key (never log the value)
# ---------------------------------------------------------------------------
fetch_auth_key() {
  local key=""
  case "$TAILSCALE_AUTH_SECRET_SOURCE" in
    ssm)
      if [ -z "$TAILSCALE_AUTH_SECRET_SSM_PARAMETER" ]; then
        err "TAILSCALE_AUTH_SECRET_SSM_PARAMETER is empty (source=ssm)"
        exit 3
      fi
      if ! command -v aws >/dev/null 2>&1; then
        err "aws CLI required to fetch SSM parameter"
        exit 3
      fi
      log "Fetching auth key from SSM Parameter Store (name only; value not logged)"
      key=$(aws ssm get-parameter \
        --name "$TAILSCALE_AUTH_SECRET_SSM_PARAMETER" \
        --with-decryption \
        ${AWS_REGION:+--region "$AWS_REGION"} \
        --query 'Parameter.Value' \
        --output text)
      ;;
    secretsmanager)
      if [ -z "$TAILSCALE_AUTH_SECRET_SECRETS_MANAGER_ARN" ]; then
        err "TAILSCALE_AUTH_SECRET_SECRETS_MANAGER_ARN is empty (source=secretsmanager)"
        exit 3
      fi
      if ! command -v aws >/dev/null 2>&1; then
        err "aws CLI required to fetch Secrets Manager secret"
        exit 3
      fi
      log "Fetching auth key from Secrets Manager (ARN only; value not logged)"
      key=$(aws secretsmanager get-secret-value \
        --secret-id "$TAILSCALE_AUTH_SECRET_SECRETS_MANAGER_ARN" \
        ${AWS_REGION:+--region "$AWS_REGION"} \
        --query 'SecretString' \
        --output text)
      # Support JSON {"authkey":"..."} or raw string
      if command -v python3 >/dev/null 2>&1; then
        parsed=$(printf '%s' "$key" | python3 -c '
import json,sys
raw=sys.stdin.read().strip()
try:
  o=json.loads(raw)
  if isinstance(o, dict):
    print(o.get("authkey") or o.get("auth_key") or o.get("TS_AUTHKEY") or raw)
  else:
    print(raw)
except Exception:
  print(raw)
' 2>/dev/null || printf '%s' "$key")
        key="$parsed"
      fi
      ;;
    *)
      err "Unknown TAILSCALE_AUTH_SECRET_SOURCE=$TAILSCALE_AUTH_SECRET_SOURCE (use ssm|secretsmanager)"
      exit 3
      ;;
  esac

  if [ -z "$key" ] || [ "$key" = "None" ]; then
    err "Auth key empty after fetch — check IAM and secret contents"
    exit 3
  fi
  # Print only to stdout for capture; callers must not log
  printf '%s' "$key"
}

already_logged_in() {
  if ! command -v tailscale >/dev/null 2>&1; then
    return 1
  fi
  # BackendState Running + Self present ≈ enrolled
  if tailscale status --json 2>/dev/null | grep -q '"BackendState": "Running"'; then
    return 0
  fi
  if tailscale status 2>/dev/null | grep -qE '^[0-9]'; then
    return 0
  fi
  return 1
}

enroll() {
  if [ "$TAILSCALE_SKIP_IF_LOGGED_IN" = "1" ] && [ "$TAILSCALE_FORCE_REENROLL" != "1" ]; then
    if already_logged_in; then
      log "Already enrolled in Tailscale; skip (set TAILSCALE_FORCE_REENROLL=1 to re-auth)"
      # Ensure accept-dns stays off
      tailscale set --accept-dns=false 2>/dev/null || true
      return 0
    fi
  fi

  local authkey
  authkey="$(fetch_auth_key)"

  # Build tag flags: --advertise-tags=tag:a,tag:b
  local tags_clean
  tags_clean=$(printf '%s' "$TAILSCALE_TAGS" | tr -d ' ')
  local up_args=(
    --authkey="$authkey"
    --hostname="$TAILSCALE_HOSTNAME"
    --accept-dns="$TAILSCALE_ACCEPT_DNS"
    --accept-routes="$TAILSCALE_ACCEPT_ROUTES"
  )
  if [ -n "$tags_clean" ]; then
    up_args+=(--advertise-tags="$tags_clean")
  fi
  if [ "$TAILSCALE_SSH" = "true" ] || [ "$TAILSCALE_SSH" = "1" ]; then
    up_args+=(--ssh)
  fi
  # shellcheck disable=SC2206
  if [ -n "$TAILSCALE_EXTRA_UP_ARGS" ]; then
    # intentional word-split for advanced operator overrides
    extra=( $TAILSCALE_EXTRA_UP_ARGS )
    up_args+=("${extra[@]}")
  fi

  log "Enrolling with tags=${tags_clean:-none} hostname=$TAILSCALE_HOSTNAME (auth key not logged)"
  # Clear authkey from shell history risk: run and unset immediately
  if ! tailscale up "${up_args[@]}"; then
    unset authkey
    err "tailscale up failed"
    exit 4
  fi
  unset authkey

  tailscale set --accept-dns=false 2>/dev/null || true
  log "Enrollment complete"
  tailscale status 2>/dev/null | head -20 || true
  log "Operator access is secondary mesh path — prefer SSM Session Manager as primary break-glass"
  log "See references/runbooks/tailscale-operator-access.md"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
install_tailscale
install_accept_dns_dropin
systemctl enable --now tailscaled 2>/dev/null || true
enroll
log "Done."
