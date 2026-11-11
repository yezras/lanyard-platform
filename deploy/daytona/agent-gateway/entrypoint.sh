#!/usr/bin/env bash
# Agent gateway guest entrypoint — Daytona sandbox (Bucket A image).
#
# Bead: lp-b7w (entrypoint: wait vault mount, start gateway foreground)
# Bead: lp-zuh.6 / lp-zuh.9.3 (ensure_vault_mount + mount-s3 prebake; kitchen-sink seed)
# Bead: lp-zuh.11.4 (MemPalace command-shim + MEMPALACE_BIN for Node which)
# Bead: lp-oop.21 (LANYARD_IMAGE_KIND=tool-only: vault wait + idle, no agent runtime)
# Bead: lp-vqr0.12 (T8: gateway exec is not gated on post-mount writable)
# Image:  lp-e9l (Dockerfile / product CLI prebake); mount-s3 prebake lp-zuh.9.3
# Plan:   docs/plans/0008-daytona-agent-sandboxes/overview.md §4.3
# Env:    docs/plans/0008-daytona-agent-sandboxes/gateway-env-contract.md
# Mount:  docs/plans/0008-daytona-agent-sandboxes/spike-3en-s3-vault-mount.md
#
# Process supervisor contract:
#   1. ensure_vault_mount: idempotent Mountpoint at VAULT_ROOT when wake inject present
#   2. Wait until VAULT_ROOT is ready (mount / readable), with timeout → fail
#      Writable is not a boot gate (lp-vqr0.12 / T8). pending write is not a dead sandbox.
#   3. Refresh injected gateway env material (Bucket C) on ephemeral disk
#   4. Seed kitchen-sink agent config when missing (lp-qh2 / lp-zuh.4/5)
#   5. Seed default Workspace project into $BACKEND_HOME/projects.db (lp-zuh.10.7)
#      primary_path under VAULT_ROOT (not ephemeral BACKEND_HOME/workspace)
#   6. exec company-brain-backend gateway in foreground
#      → gateway death becomes container/VM exit status (non-zero if gateway ≠0)
#
# Allowed side effects only:
#   - ensure Mountpoint at VAULT_ROOT when inject env present (no remount if up)
#   - wait on vault readiness
#   - write/refresh Bucket C env file under BACKEND_HOME
#   - seed $BACKEND_HOME/config.yaml (kitchen-sink; lab pilot)
#   - seed $BACKEND_HOME/projects.db default Workspace (lp-zuh.10.7)
#   - mkdir BACKEND_HOME if missing
#   - start gateway (exec)
#
# Anti-patterns (plan §4.3) — DO NOT:
#   - apt-get / yum / apk install product CLIs
#   - pip install / npm install / cargo install on boot
#   - curl|bash installers for tools / mount-s3 download on boot
#   - bake or invent secrets here
#   - call Daytona APIs or require DAYTONA_API_KEY
#   - set GATEWAY_RELAY_* from sandbox_id
#   - hold gateway exec on post-mount writable timeout (lp-vqr0.12 / T8)
#
# Helper vars for this script only may use LANYARD_ENTRY_* (stripped before
# gateway exec; see gateway-env-contract.md).

set -euo pipefail

log() {
  printf '%s entrypoint: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

# --- config (LANYARD_ENTRY_* helpers; not agent product contract) -------------

VAULT_ROOT="${VAULT_ROOT:-/mnt/vault}"
LANYARD_ENTRY_VAULT_WAIT_SEC="${LANYARD_ENTRY_VAULT_WAIT_SEC:-60}"
LANYARD_ENTRY_VAULT_POLL_SEC="${LANYARD_ENTRY_VAULT_POLL_SEC:-1}"
LANYARD_ENTRY_VAULT_READY_FILE="${LANYARD_ENTRY_VAULT_READY_FILE:-}"
LANYARD_ENTRY_POST_MOUNT_WRITABLE_SEC="${LANYARD_ENTRY_POST_MOUNT_WRITABLE_SEC:-0}"
LANYARD_ENTRY_GATEWAY_BIN="${LANYARD_ENTRY_GATEWAY_BIN:-${BACKEND_INSTALL_PATH:-/opt/company-brain-backend/current}/bin/company-brain-backend}"
if [[ -z "${LANYARD_ENTRY_ENV_FILE+x}" ]]; then
  LANYARD_ENTRY_ENV_FILE="${BACKEND_HOME:-/var/lib/company-brain-backend}/gateway.env"
fi
if [[ $# -eq 0 && "${LANYARD_IMAGE_KIND:-}" != "tool-only" ]]; then
  set -- gateway
fi

# restored header only is NOT acceptable — full body follows in this same string
