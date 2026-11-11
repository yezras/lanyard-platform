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

# Absolute path the gateway uses for vault I/O (parity with EC2).
VAULT_ROOT="${VAULT_ROOT:-/mnt/vault}"

# Seconds to wait for mount; fail closed if exceeded.
LANYARD_ENTRY_VAULT_WAIT_SEC="${LANYARD_ENTRY_VAULT_WAIT_SEC:-60}"

# Poll interval while waiting for vault (seconds).
LANYARD_ENTRY_VAULT_POLL_SEC="${LANYARD_ENTRY_VAULT_POLL_SEC:-1}"

# Optional marker file under VAULT_ROOT; if set, wait until it exists.
# Local smoke uses .vault-ready; live Mountpoint may leave this empty and
# only require the directory to be mounted/readable.
LANYARD_ENTRY_VAULT_READY_FILE="${LANYARD_ENTRY_VAULT_READY_FILE:-}"

# Historical wait after mount-s3 for first write. Default 0: not a gateway
# boot gate (lp-vqr0.12 / T8). A positive value is logged and ignored so a
# live 1200 inject cannot resurrect minutes-on-Send. Mountpoint first-write
# remains lp-puzc; file tools wait on vault_writable.
LANYARD_ENTRY_POST_MOUNT_WRITABLE_SEC="${LANYARD_ENTRY_POST_MOUNT_WRITABLE_SEC:-0}"

# Gateway binary (contract name). Image ships stub or release artifact here.
LANYARD_ENTRY_GATEWAY_BIN="${LANYARD_ENTRY_GATEWAY_BIN:-${BACKEND_INSTALL_PATH:-/opt/company-brain-backend/current}/bin/company-brain-backend}"

# Bucket C env materialization path (refreshed every wake).
# - unset → default $BACKEND_HOME/gateway.env
# - set empty → skip file write
# Default under BACKEND_HOME (ephemeral sandbox disk — not durable vault).
if [[ -z "${LANYARD_ENTRY_ENV_FILE+x}" ]]; then
  LANYARD_ENTRY_ENV_FILE="${BACKEND_HOME:-/var/lib/company-brain-backend}/gateway.env"
fi

# Subcommand / args after env ready (default: gateway).
# tool-only (lp-oop.21) has no agent runtime — do not invent a gateway command.
if [[ $# -eq 0 && "${LANYARD_IMAGE_KIND:-}" != "tool-only" ]]; then
  set -- gateway
fi

# --- never package-install (static guard comments for reviewers + smoke) ------
# NO_PACKAGE_INSTALL: apt-get install
# NO_PACKAGE_INSTALL: pip install
# NO_PACKAGE_INSTALL: npm install
# NO_PACKAGE_INSTALL: cargo install
# Product CLIs belong in the image build (Bucket A), not this script.
# mount-s3 + fusermount are pre-baked (lp-zuh.9.3); never download/install here.

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    die "required env ${name} is missing (wake inject / Bucket C — not baked in image)"
  fi
}

vault_ready() {
  [[ -d "${VAULT_ROOT}" && -r "${VAULT_ROOT}" ]] || return 1
  if [[ -n "${LANYARD_ENTRY_VAULT_READY_FILE}" ]]; then
    [[ -e "${VAULT_ROOT}/${LANYARD_ENTRY_VAULT_READY_FILE}" ]] || return 1
  fi
  return 0
}

# True when VAULT_ROOT is already a mount (Mountpoint / volume), not an empty stub dir.
vault_is_mounted() {
  findmnt -n "${VAULT_ROOT}" >/dev/null 2>&1
}

# Writable check for durable product dirs (agent uid must create workflows/cron/…).
vault_is_writable() {
  local probe="${VAULT_ROOT}/.lanyard-vault-write-probe.$$"
  if touch "${probe}" 2>/dev/null; then
    rm -f "${probe}" 2>/dev/null || true
    return 0
  fi
  return 1
}

# Domain: vault write is independent of gateway boot (lp-vqr0.12 / T8).
# writable = probe succeeded; pending = not writable yet (not a dead sandbox).
vault_write_state() {
  if vault_is_writable; then
    printf 'writable'
  else
    printf 'pending'
  fi
}

# Persist write-state on ephemeral disk and log. Never blocks, never dies.
record_vault_write_state() {
  local context="${1:-}"
  local state
  state="$(vault_write_state)"
  if [[ -n "${BACKEND_HOME:-}" ]]; then
    mkdir -p "${BACKEND_HOME}" 2>/dev/null || true
    printf '%s\n' "${state}" > "${BACKEND_HOME}/.lanyard-vault-write-state" 2>/dev/null || true
  fi
  if [[ "${state}" == "writable" ]]; then
    log "vault write state=writable at ${VAULT_ROOT}${context:+ (${context})}"
  else
    log "WARN: vault write state=pending at ${VAULT_ROOT}${context:+ (${context})}; uid=$(id -u) cannot write; gateway proceeds; file tools wait on vault_writable (lp-vqr0.12). This does not fix lp-puzc."
  fi
}

# Ensure durable S3 vault is mounted at VAULT_ROOT (lp-zuh.6 / spike-3en).
#
# Idempotent: skip when already a mount (writable or pending).
# Requires wake inject (Bucket C): AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY
# (+ optional AWS_SESSION_TOKEN), S3_VAULT_PREFIX, LANYARD_VAULT_BUCKET (or
# S3_VAULT_BUCKET). mount-s3 + fusermount prebaked in image.
#
# Does not log secret values. On mount-s3 failure: log WARN and continue if
# LANYARD_ENTRY_VAULT_MOUNT_OPTIONAL=1 (lab); otherwise die so cold boot does
# not pretend an empty stub is the vault. Post-mount not-writable is pending,
# not a boot failure (lp-vqr0.12 / T8).
ensure_vault_mount() {
  local bucket="${LANYARD_VAULT_BUCKET:-${S3_VAULT_BUCKET:-}}"
  local prefix="${S3_VAULT_PREFIX:-}"
  local region="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
  local optional="${LANYARD_ENTRY_VAULT_MOUNT_OPTIONAL:-0}"

  # Do not mkdir a missing VAULT_ROOT here when there is no mount inject —
  # that would make wait_for_vault succeed on a fake empty local dir and hide
  # the "vault not ready" timeout (lp-b7w offline smoke + cold-boot fail-closed).

  if vault_is_mounted; then
    record_vault_write_state "already mounted"
    return 0
  fi

  # No mount yet — try Mountpoint when wake inject provided prefix + bucket + AWS keys.
  if [[ -z "${prefix}" || -z "${bucket}" ]]; then
    log "vault mount skipped: S3_VAULT_PREFIX and LANYARD_VAULT_BUCKET/S3_VAULT_BUCKET required for mount-s3"
    if [[ "${optional}" == "1" ]]; then
      return 0
    fi
    # Empty local stub is the failure mode that caused mkdir EACCES for workflows.
    if [[ -d "${VAULT_ROOT}" ]] && vault_is_writable; then
      return 0
    fi
    die "VAULT_ROOT=${VAULT_ROOT} not a writable Mountpoint and no S3 prefix/bucket for mount-s3"
  fi

  if [[ -z "${AWS_ACCESS_KEY_ID:-}" || -z "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
    log "vault mount skipped: AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY not injected (Bucket C)"
    if [[ "${optional}" == "1" ]]; then
      return 0
    fi
    if [[ -d "${VAULT_ROOT}" ]] && vault_is_writable; then
      return 0
    fi
    die "VAULT_ROOT=${VAULT_ROOT} not writable and no AWS mount credentials"
  fi

  if ! command -v mount-s3 >/dev/null 2>&1; then
    die "mount-s3 not on PATH (bake into agent-gateway image — lp-zuh.9.3; never install-on-boot)"
  fi

  # Mountpoint requires an empty directory target — create only when mounting.
  mkdir -p "${VAULT_ROOT}" 2>/dev/null || true

  if [[ -n "$(ls -A "${VAULT_ROOT}" 2>/dev/null || true)" ]]; then
    log "WARN: ${VAULT_ROOT} not empty; attempting mount-s3 anyway may fail"
  fi

  log "mounting s3://${bucket}/${prefix} → ${VAULT_ROOT} (region=${region}; secret values not logged)"
  # Mountpoint flags:
  # - --allow-other only when root or fuse.conf has user_allow_other (non-root
  #   Daytona containers run as brain; allow_other without that setting fails
  #   fusermount EPERM — lp-zuh.9.4 live proof).
  # - --uid/--gid when LANYARD_ENTRY_VAULT_UID/GID set (image default brain 990).
  local -a mp_args=(
    --prefix "${prefix}"
    --region "${region}"
    --allow-delete
    --allow-overwrite
  )
  local allow_other=0
  if [[ "$(id -u)" -eq 0 ]]; then
    allow_other=1
  elif grep -Eq '^[[:space:]]*user_allow_other' /etc/fuse.conf 2>/dev/null; then
    allow_other=1
  fi
  if [[ "${allow_other}" -eq 1 ]]; then
    mp_args+=(--allow-other)
  else
    log "mount-s3: skipping --allow-other (non-root without user_allow_other in fuse.conf)"
  fi
  if [[ -n "${LANYARD_ENTRY_VAULT_UID:-}" ]]; then
    mp_args+=(--uid "${LANYARD_ENTRY_VAULT_UID}")
  fi
  if [[ -n "${LANYARD_ENTRY_VAULT_GID:-}" ]]; then
    mp_args+=(--gid "${LANYARD_ENTRY_VAULT_GID}")
  fi

  if ! mount-s3 "${mp_args[@]}" "${bucket}" "${VAULT_ROOT}"; then
    if [[ "${optional}" == "1" ]]; then
      log "WARN: mount-s3 failed (optional=1); continuing with ${VAULT_ROOT} as-is"
      return 0
    fi
    die "mount-s3 failed for bucket=${bucket} prefix=${prefix} → ${VAULT_ROOT}"
  fi

  # Mountpoint first-write can take minutes (lp-puzc). Gateway exec is not
  # gated on writable (lp-vqr0.12 / T8). A live
  # LANYARD_ENTRY_POST_MOUNT_WRITABLE_SEC=1200 inject must not block boot.
  local wmax="${LANYARD_ENTRY_POST_MOUNT_WRITABLE_SEC:-0}"
  if ! [[ "${wmax}" =~ ^[0-9]+$ ]]; then
    wmax=0
  fi
  if (( wmax > 0 )); then
    log "LANYARD_ENTRY_POST_MOUNT_WRITABLE_SEC=${wmax} ignored for gateway boot (lp-vqr0.12)"
  fi
  record_vault_write_state "post-mount"
}

wait_for_vault() {
  local waited=0
  local poll="${LANYARD_ENTRY_VAULT_POLL_SEC}"
  if ! [[ "${poll}" =~ ^[0-9]+$ ]] || (( poll < 1 )); then
    poll=1
  fi
  if ! [[ "${LANYARD_ENTRY_VAULT_WAIT_SEC}" =~ ^[0-9]+$ ]]; then
    die "LANYARD_ENTRY_VAULT_WAIT_SEC must be a non-negative integer"
  fi

  # Mountpoint when wake inject provides AWS + prefix (lp-zuh.6 / lp-zuh.9.4).
  # Fail closed when vault inject is fully present (prefix+bucket+AWS_*) so cold
  # boot never pretends a local empty stub is the durable vault. Optional only
  # when inject is incomplete (legacy pilots without STS) or operator sets
  # LANYARD_ENTRY_VAULT_MOUNT_OPTIONAL=1 explicitly.
  if [[ -z "${LANYARD_ENTRY_VAULT_MOUNT_OPTIONAL+x}" ]]; then
    if [[ -n "${S3_VAULT_PREFIX:-}" && -n "${LANYARD_VAULT_BUCKET:-${S3_VAULT_BUCKET:-}}" && -n "${AWS_ACCESS_KEY_ID:-}" && -n "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
      LANYARD_ENTRY_VAULT_MOUNT_OPTIONAL=0
    else
      LANYARD_ENTRY_VAULT_MOUNT_OPTIONAL=1
    fi
  fi
  ensure_vault_mount || true

  log "waiting for vault at VAULT_ROOT=${VAULT_ROOT} (timeout=${LANYARD_ENTRY_VAULT_WAIT_SEC}s)"
  while ! vault_ready; do
    if (( waited >= LANYARD_ENTRY_VAULT_WAIT_SEC )); then
      die "vault not ready at ${VAULT_ROOT} after ${LANYARD_ENTRY_VAULT_WAIT_SEC}s"
    fi
    sleep "${poll}"
    waited=$((waited + poll))
  done
  record_vault_write_state "ready"
}

# Write/refresh Bucket C parity env for the guest (modes match EC2 EnvironmentFile intent).
# Never logs secret values. File is optional when LANYARD_ENTRY_ENV_FILE is empty.
refresh_gateway_env_file() {
  if [[ -z "${LANYARD_ENTRY_ENV_FILE}" ]]; then
    log "skipping gateway env file (LANYARD_ENTRY_ENV_FILE empty)"
    return 0
  fi

  local env_dir
  env_dir="$(dirname "${LANYARD_ENTRY_ENV_FILE}")"
  mkdir -p "${env_dir}"

  # Atomic refresh: write temp then rename so readers never see a partial file.
  local tmp
  tmp="${LANYARD_ENTRY_ENV_FILE}.tmp.$$"
  umask 077
  {
    printf '# Generated by lanyard agent-gateway entrypoint (lp-b7w). Do not edit.\n'
    printf '# Refreshed at wake; Bucket C inject. Secrets present — mode 0600.\n'
    printf 'GATEWAY_RELAY_URL=%s\n' "${GATEWAY_RELAY_URL}"
    printf 'GATEWAY_RELAY_ID=%s\n' "${GATEWAY_RELAY_ID}"
    printf 'GATEWAY_RELAY_INSTANCE_ID=%s\n' "${GATEWAY_RELAY_INSTANCE_ID}"
    printf 'GATEWAY_RELAY_SECRET=%s\n' "${GATEWAY_RELAY_SECRET}"
    printf 'VAULT_ROOT=%s\n' "${VAULT_ROOT}"
    printf 'BACKEND_HOME=%s\n' "${BACKEND_HOME}"
    if [[ -n "${BACKEND_KIND:-}" ]]; then
      printf 'BACKEND_KIND=%s\n' "${BACKEND_KIND}"
    fi
    if [[ -n "${BACKEND_INSTALL_PATH:-}" ]]; then
      printf 'BACKEND_INSTALL_PATH=%s\n' "${BACKEND_INSTALL_PATH}"
    fi
    if [[ -n "${BRAIN_TENANT_ID:-}" ]]; then
      printf 'BRAIN_TENANT_ID=%s\n' "${BRAIN_TENANT_ID}"
    fi
    if [[ -n "${COMPANY_BRAIN_VAULT_ROOT:-}" ]]; then
      printf 'COMPANY_BRAIN_VAULT_ROOT=%s\n' "${COMPANY_BRAIN_VAULT_ROOT}"
    fi
    # Model / LiteLLM inject (optional; CP wake-injects when SM keys present)
    if [[ -n "${LITELLM_MASTER_KEY:-}" ]]; then
      printf 'LITELLM_MASTER_KEY=%s\n' "${LITELLM_MASTER_KEY}"
    fi
    if [[ -n "${POOLSIDE_API_KEY:-}" ]]; then
      printf 'POOLSIDE_API_KEY=%s\n' "${POOLSIDE_API_KEY}"
    fi
    if [[ -n "${XAI_API_KEY:-}" ]]; then
      printf 'XAI_API_KEY=%s\n' "${XAI_API_KEY}"
    fi
    if [[ -n "${OPENAI_API_KEY:-}" ]]; then
      printf 'OPENAI_API_KEY=%s\n' "${OPENAI_API_KEY}"
    fi
    # Vault mount helpers (names only in comments; values are secrets when present)
    if [[ -n "${S3_VAULT_PREFIX:-}" ]]; then
      printf 'S3_VAULT_PREFIX=%s\n' "${S3_VAULT_PREFIX}"
    fi
    if [[ -n "${LANYARD_VAULT_BUCKET:-}" ]]; then
      printf 'LANYARD_VAULT_BUCKET=%s\n' "${LANYARD_VAULT_BUCKET}"
    fi
    if [[ -n "${S3_VAULT_BUCKET:-}" ]]; then
      printf 'S3_VAULT_BUCKET=%s\n' "${S3_VAULT_BUCKET}"
    fi
    if [[ -n "${AWS_ACCESS_KEY_ID:-}" ]]; then
      printf 'AWS_ACCESS_KEY_ID=%s\n' "${AWS_ACCESS_KEY_ID}"
    fi
    if [[ -n "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
      printf 'AWS_SECRET_ACCESS_KEY=%s\n' "${AWS_SECRET_ACCESS_KEY}"
    fi
    if [[ -n "${AWS_SESSION_TOKEN:-}" ]]; then
      printf 'AWS_SESSION_TOKEN=%s\n' "${AWS_SESSION_TOKEN}"
    fi
    if [[ -n "${AWS_REGION:-}" ]]; then
      printf 'AWS_REGION=%s\n' "${AWS_REGION}"
    fi
    if [[ -n "${AWS_DEFAULT_REGION:-}" ]]; then
      printf 'AWS_DEFAULT_REGION=%s\n' "${AWS_DEFAULT_REGION}"
    fi
  } >"${tmp}"
  chmod 0600 "${tmp}"
  mv -f "${tmp}" "${LANYARD_ENTRY_ENV_FILE}"
  log "refreshed gateway env file at ${LANYARD_ENTRY_ENV_FILE} (mode 0600; secret value not logged)"
}

# Seed Lanyard Agent kitchen-sink config when missing (Daytona pilot / MockLab).
# Product path: Poolside via OpenAI-compatible API + optional LiteLLM master key env.
#
# Kitchen-sink (MockLab QA): enable every agent-YAML surface the Zod schema accepts —
# tools.catalog_search, subagents, workflow, cron, mempalace, all skills (disabled: []),
# open pairing, shell_approval off. Operators may replace $BACKEND_HOME/config.yaml.
# Default: never overwrite an existing file. Set LANYARD_ENTRY_FORCE_SEED_CONFIG=1 to
# re-seed (lab only; restarts must re-read config).
#
# Not in default agent YAML (platform / residual):
#   - MCP servers → LA MCP Zod+stdio client: lp-zuh.14.3 / lp-vw3 (enable via LANYARD_ENTRY_SEED_MCP=1 after pin). Lab path:
#     /opt/lanyard/lab-mcp + kitchen-sink-mcp.fragment.yaml (lp-zuh.10.6).
#     Optional LANYARD_ENTRY_SEED_MCP=1 merges fragment ONLY when LA pin accepts
#     the key; default off so strict parse never bricks cold wake.
#   - OnlyOffice → staging Document Server + BFF_OFFICE_* + web VITE_ONLYOFFICE_*
#     (lp-zuh.10.3 MockLab GO path; lab writeback BFF_OFFICE_VAULT_EDIT=true).

# Lab-only MCP fragment path (prebaked in agent-gateway image; lp-zuh.10.6).
LANYARD_LAB_MCP_SERVER="${LANYARD_LAB_MCP_SERVER:-/opt/lanyard/lab-mcp/lab_echo_server.py}"
LANYARD_KITCHEN_SINK_MCP_FRAGMENT="${LANYARD_KITCHEN_SINK_MCP_FRAGMENT:-/usr/local/lib/lanyard/kitchen-sink-mcp.fragment.yaml}"

# Append lab_echo mcp_servers when explicitly requested (lab / MockLab only).
# Requires LA pin that accepts top-level mcp_servers (lp-vw3); otherwise gateway
# config parse fails closed. Never invent tokens — lab_echo is secret-free.
maybe_seed_lab_mcp() {
  local cfg="${1:-}"
  if [[ -z "${cfg}" || ! -f "${cfg}" ]]; then
    return 0
  fi
  if [[ "${LANYARD_ENTRY_SEED_MCP:-}" != "1" ]]; then
    return 0
  fi
  if grep -qE '^[[:space:]]*mcp_servers:[[:space:]]*$' "${cfg}" 2>/dev/null; then
    log "mcp_servers already present in ${cfg}; skip LANYARD_ENTRY_SEED_MCP merge"
    return 0
  fi
  if [[ ! -f "${LANYARD_LAB_MCP_SERVER}" ]]; then
    log "WARN: LANYARD_ENTRY_SEED_MCP=1 but lab MCP server missing at ${LANYARD_LAB_MCP_SERVER}"
    return 0
  fi
  if [[ -f "${LANYARD_KITCHEN_SINK_MCP_FRAGMENT}" ]]; then
    # Strip comment-only header lines from fragment; keep mcp_servers block.
    {
      printf '\n# --- lab MCP (LANYARD_ENTRY_SEED_MCP=1; lp-zuh.10.6 / lp-vw3) ---\n'
      grep -v '^#' "${LANYARD_KITCHEN_SINK_MCP_FRAGMENT}" | grep -v '^[[:space:]]*$' || true
      printf '\n'
    } >>"${cfg}"
  else
    {
      printf '\n# --- lab MCP (LANYARD_ENTRY_SEED_MCP=1; lp-zuh.10.6 / lp-vw3) ---\n'
      printf 'mcp_servers:\n'
      printf '  lab_echo:\n'
      printf '    transport: stdio\n'
      printf '    enabled: true\n'
      printf '    command: python3\n'
      printf '    args:\n'
      printf '      - %s\n' "${LANYARD_LAB_MCP_SERVER}"
    } >>"${cfg}"
  fi
  log "merged lab-only mcp_servers (lab_echo) into ${cfg} (LANYARD_ENTRY_SEED_MCP=1; requires LA MCP schema)"
}

ensure_agent_config() {
  local cfg="${BACKEND_HOME}/config.yaml"
  if [[ -f "${cfg}" && -s "${cfg}" && "${LANYARD_ENTRY_FORCE_SEED_CONFIG:-}" != "1" ]]; then
    log "agent config present at ${cfg} (set LANYARD_ENTRY_FORCE_SEED_CONFIG=1 to re-seed kitchen-sink)"
    # Still allow MCP append on existing config when explicitly requested.
    maybe_seed_lab_mcp "${cfg}"
    export LANYARD_CONFIG="${cfg}"
    return 0
  fi
  # Process-local only under BACKEND_HOME (ephemeral on Daytona).
  # Durable product data lives under VAULT_ROOT (S3 Mountpoint) — lp-zuh.5.
  mkdir -p "${BACKEND_HOME}/state"
  # Best-effort durable dirs on vault (Mountpoint must be writable by agent uid).
  # Fail open: empty/root-only stub still lets config seed; ops must fix mount.
  local vault="${VAULT_ROOT:-/mnt/vault}"
  mkdir -p \
    "${vault}/skills" \
    "${vault}/workflows" \
    "${vault}/cron" \
    "${vault}/mempalace" \
    "${vault}/.agent-runtime" \
    2>/dev/null || log "WARN: could not mkdir under ${vault} (permission/mount?). Durable paths still point at vault in config."
  umask 077
  cat >"${cfg}" <<'EOF'
# Auto-seeded by agent-gateway entrypoint — MockLab kitchen-sink (lp-zuh.4/5).
# Prefer Poolside for product inference; keys from wake inject (env only).
# Schema: lanyard-agent packages/config (configSchema). Strict — no unknown keys.
#
# MCP: omitted by default (lp-vw3 / lp-zuh.10.6). Lab path is lab_echo via
# LANYARD_ENTRY_SEED_MCP=1 after LA accepts mcp_servers — never invent tokens.
#
# Durable FS under VAULT_ROOT (/mnt/vault → S3). Process-local only:
# session sqlite, gateway.env, logs under BACKEND_HOME.
tenant_id: mocklab
vault_root: /mnt/vault
# Skill packages on durable vault (empty disabled = all enabled).
skills_roots:
  - /mnt/vault/skills
skills:
  disabled: []
default_model: "poolside/laguna-s-2.1"
litellm:
  # OpenAI-compatible Poolside inference. Agent LiteLLM client appends /v1/...
  # LITELLM_MASTER_KEY is also injected for hosts that run a local LiteLLM proxy.
  base_url: https://inference.poolside.ai
  master_key_env: POOLSIDE_API_KEY
session:
  # Ephemeral session DB on host disk (chat SoT + optional S3 export elsewhere).
  sqlite_path: /var/lib/company-brain-backend/state/sessions.db
gateway:
  health_host: 127.0.0.1
  health_port: 9100
  drain_timeout_ms: 30000
  max_concurrent_sessions: 8
channels:
  portal:
    enabled: true
    relay_url_env: GATEWAY_RELAY_URL
    relay_id_env: GATEWAY_RELAY_ID
    relay_secret_env: GATEWAY_RELAY_SECRET
    relay_instance_id_env: GATEWAY_RELAY_INSTANCE_ID
pairing:
  mode: open
# Lab: no human gate on bash (isolated sandbox). Never ship off to production.
shell_approval:
  mode: off
# Durable MemPalace on vault (search-only write policy in v1).
mempalace:
  enabled: true
  path: /mnt/vault/mempalace
  wing: mocklab
  write_policy:
    mode: disabled
# Portal NL create (cronjob tool) + Settings Crons — durable job store on vault.
cron:
  enabled: true
  state_dir: /mnt/vault
# Stable tools[] = builtins + search_tool + use_tool (hidden/MCP via search).
tools:
  catalog_search:
    enabled: true
# Nested subagents for Portal chips / activity pane (shared cwd — single-writer lab).
subagents:
  enabled: true
  max_concurrent: 0
  max_depth: 1
  default_isolation: none
# Programmatic workflows — durable run state on vault (lp-zuh.10.5).
# Explicit state_dir IS the workflowsDir: runs at {state_dir}/wf_*/ (program,
# args, state, journal). Do not confuse with definition_roots (IR *.json).
# Writers need Mountpoint no-rename fallback (ENOSYS) — LA workflow run-store.
workflow:
  enabled: true
  agent_budget: 128
  max_active_runs: 16
  state_dir: /mnt/vault
  definition_roots:
    - /mnt/vault/workflows
EOF
  # Prefer BACKEND_HOME path in session sqlite when BACKEND_HOME differs from default
  if [[ "${BACKEND_HOME}" != "/var/lib/company-brain-backend" ]]; then
    sed -i "s|/var/lib/company-brain-backend|${BACKEND_HOME}|g" "${cfg}" || true
  fi
  maybe_seed_lab_mcp "${cfg}"
  chmod 0640 "${cfg}"
  export LANYARD_CONFIG="${cfg}"
  if [[ "${LANYARD_ENTRY_FORCE_SEED_CONFIG:-}" == "1" ]]; then
    log "force-seeded kitchen-sink agent config at ${cfg} (Poolside + all add-ons)"
  else
    log "seeded kitchen-sink agent config at ${cfg} (Poolside + all add-ons)"
  fi
}

# Seed ≥1 agent project with primary_path under vault (lp-zuh.10.7).
# Prefers vault .seed/default-projects.json when present; else Workspace default.
# Fail-open: missing python/sqlite or unwritable BACKEND_HOME logs WARN and continues
# (gateway still boots; projects.list may stay empty until operator re-seed).
ensure_default_projects() {
  local seed_py="${LANYARD_ENTRY_SEED_PROJECTS_PY:-/usr/local/lib/lanyard/seed-default-projects.py}"
  local vault="${VAULT_ROOT:-/mnt/vault}"
  local home="${BACKEND_HOME:-/var/lib/company-brain-backend}"
  local -a args=(
    --backend-home "${home}"
    --vault-root "${vault}"
  )

  if [[ "${LANYARD_ENTRY_SKIP_SEED_PROJECTS:-}" == "1" ]]; then
    log "skip default projects seed (LANYARD_ENTRY_SKIP_SEED_PROJECTS=1)"
    return 0
  fi

  if [[ ! -f "${seed_py}" ]]; then
    log "WARN: seed-default-projects.py missing at ${seed_py}; projects.list may be empty"
    return 0
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    log "WARN: python3 missing; cannot seed projects.db"
    return 0
  fi

  # Prefer durable vault document from lp-zuh.9.5 when mounted.
  if [[ -f "${vault}/.seed/default-projects.json" ]]; then
    args+=(--from-json "${vault}/.seed/default-projects.json")
  fi

  mkdir -p "${home}" 2>/dev/null || true
  # Also ensure the product Workspace dir on vault when writable.
  mkdir -p "${vault}/Projects/Workspace" 2>/dev/null \
    || log "WARN: could not mkdir ${vault}/Projects/Workspace (mount perms?)"

  if python3 "${seed_py}" "${args[@]}" >/tmp/lanyard-seed-projects.out 2>/tmp/lanyard-seed-projects.err; then
    log "default projects seed OK (projects.db under ${home}; see seed-default-projects)"
    if [[ -s /tmp/lanyard-seed-projects.err ]]; then
      # Log non-secret stderr summary (no tokens in seeder).
      log "seed-default-projects: $(tr '\n' ' ' </tmp/lanyard-seed-projects.err | head -c 400)"
    fi
  else
    log "WARN: default projects seed failed (projects.list may be empty); stderr follows"
    if [[ -s /tmp/lanyard-seed-projects.err ]]; then
      log "seed-default-projects: $(tr '\n' ' ' </tmp/lanyard-seed-projects.err | head -c 400)"
    fi
  fi
  rm -f /tmp/lanyard-seed-projects.out /tmp/lanyard-seed-projects.err 2>/dev/null || true
}

ensure_gateway_env() {
  # Parity names — gateway-env-contract.md (lp-vey). Values from wake inject.
  require_env GATEWAY_RELAY_URL
  require_env GATEWAY_RELAY_ID
  require_env GATEWAY_RELAY_INSTANCE_ID
  require_env GATEWAY_RELAY_SECRET
  require_env VAULT_ROOT
  require_env BACKEND_HOME

  # Identity anti-pattern check: must not use sandbox_id as Relay identity.
  # We cannot know sandbox_id here without Daytona knowledge; warn only if the
  # orchestrator mistakenly exported LANYARD_ENTRY_SANDBOX_ID equal to instance.
  if [[ -n "${LANYARD_ENTRY_SANDBOX_ID:-}" ]]; then
    if [[ "${GATEWAY_RELAY_INSTANCE_ID}" == "${LANYARD_ENTRY_SANDBOX_ID}" ]]; then
      die "GATEWAY_RELAY_INSTANCE_ID must be permanent instance_id, not sandbox_id"
    fi
    if [[ "${GATEWAY_RELAY_ID}" == "${LANYARD_ENTRY_SANDBOX_ID}" ]]; then
      die "GATEWAY_RELAY_ID must be permanent instance_id, not sandbox_id"
    fi
  fi

  # Ensure runtime home exists on ephemeral sandbox disk (not durable vault).
  mkdir -p "${BACKEND_HOME}"

  # Legacy alias: if set, must equal VAULT_ROOT.
  if [[ -n "${COMPANY_BRAIN_VAULT_ROOT:-}" && "${COMPANY_BRAIN_VAULT_ROOT}" != "${VAULT_ROOT}" ]]; then
    die "COMPANY_BRAIN_VAULT_ROOT must equal VAULT_ROOT when set"
  fi

  # Refresh Bucket C env materialization (file under BACKEND_HOME).
  refresh_gateway_env_file
  ensure_agent_config
  # Product default Directory project (vault primary_path) before gateway boot
  # so LA seedDefaultProject (BACKEND_HOME/workspace) no-ops on non-empty store.
  ensure_default_projects

  log "gateway env present (instance_id=${GATEWAY_RELAY_INSTANCE_ID}; secret value not logged)"
}

# MemPalace runtime helpers (lp-zuh.11.4).
# LA memory defaultWhich spawns PATH `command -v` without a shell. When the
# image ships the install-mempalace command shim, Node finds it. For pins that
# predate the shim, write a guest-local shim under BACKEND_HOME/bin and put it
# first on PATH. Also export MEMPALACE_BIN absolute path for tool wiring.
ensure_mempalace_runtime() {
  local mp_bin=""
  if [[ -n "${MEMPALACE_BIN:-}" && -x "${MEMPALACE_BIN}" ]]; then
    mp_bin="${MEMPALACE_BIN}"
  elif [[ -x /usr/local/bin/mempalace ]]; then
    mp_bin=/usr/local/bin/mempalace
  elif command -v mempalace >/dev/null 2>&1; then
    mp_bin="$(command -v mempalace)"
  fi
  if [[ -n "${mp_bin}" ]]; then
    export MEMPALACE_BIN="${mp_bin}"
    log "MEMPALACE_BIN=${MEMPALACE_BIN}"
  fi

  # Prefer image-baked shim from install-mempalace.sh when present.
  if [[ -x /usr/local/bin/command ]] || [[ -x /usr/local/lib/lanyard/bin/command ]]; then
    return 0
  fi

  # Guest-local shim so Node spawn("command", ["-v", ...]) works when the
  # image predates the install-mempalace shim. Prefer product bin (PATH-first
  # for company-brain-backend layout) then BACKEND_HOME/bin.
  local install_root="${BACKEND_INSTALL_PATH:-/opt/company-brain-backend/current}"
  local home="${BACKEND_HOME:-/var/lib/company-brain-backend}"
  local shim_dir=""
  if [[ -d "${install_root}/bin" && -w "${install_root}/bin" ]]; then
    shim_dir="${install_root}/bin"
  else
    shim_dir="${home}/bin"
  fi
  local shim="${shim_dir}/command"
  mkdir -p "${shim_dir}"
  cat > "${shim}" <<'SHIM'
#!/bin/sh
if [ "$1" = "-v" ] && [ -n "${2:-}" ]; then
  if [ -x /usr/bin/which ]; then
    out="$(/usr/bin/which -- "$2" 2>/dev/null || true)"
    if [ -n "$out" ]; then
      printf '%s\n' "$out"
      exit 0
    fi
  fi
  if [ -x /bin/which ]; then
    out="$(/bin/which -- "$2" 2>/dev/null || true)"
    if [ -n "$out" ]; then
      printf '%s\n' "$out"
      exit 0
    fi
  fi
  if [ -x /bin/bash ]; then
    out="$(/bin/bash -c 'type -P -- "$1"' _ "$2" 2>/dev/null || true)"
    if [ -n "$out" ]; then
      printf '%s\n' "$out"
      exit 0
    fi
  fi
  exit 1
fi
if [ -x /bin/bash ]; then
  exec /bin/bash -c 'builtin command "$@"' _ "$@"
fi
exit 127
SHIM
  chmod 0755 "${shim}"
  case ":${PATH}:" in
    *":${shim_dir}:"*) ;;
    *) export PATH="${shim_dir}:${PATH}" ;;
  esac
  log "installed guest command-shim at ${shim} (PATH for MemPalace which)"
}

# Drop LANYARD_ENTRY_* helpers so the agent product process only sees parity names.
strip_entry_helpers() {
  local name
  # Collect first — unsetting while iterating environ is unsafe in bash.
  local -a to_unset=()
  while IFS= read -r name; do
    [[ -n "${name}" ]] && to_unset+=("${name}")
  done < <(env | sed -n 's/^\(LANYARD_ENTRY_[^=]*\)=.*/\1/p')
  if ((${#to_unset[@]} > 0)); then
    unset "${to_unset[@]}"
  fi
}

start_gateway() {
  if [[ ! -x "${LANYARD_ENTRY_GATEWAY_BIN}" ]]; then
    die "gateway binary not executable: ${LANYARD_ENTRY_GATEWAY_BIN}"
  fi
  local gateway_bin="${LANYARD_ENTRY_GATEWAY_BIN}"
  # Lanyard Agent wrap: `gateway` subcommand + --config when LANYARD_CONFIG is set.
  local -a args=("$@")
  if [[ ${#args[@]} -eq 0 ]]; then
    args=(gateway)
  fi
  if [[ -n "${LANYARD_CONFIG:-}" && -f "${LANYARD_CONFIG}" ]]; then
    # Avoid duplicating --config if operator already passed it.
    local has_config=0
    local a
    for a in "${args[@]}"; do
      if [[ "${a}" == "--config" || "${a}" == -c ]]; then
        has_config=1
        break
      fi
    done
    if [[ "${has_config}" -eq 0 ]]; then
      args+=(--config "${LANYARD_CONFIG}")
    fi
  fi
  ensure_mempalace_runtime
  log "exec ${gateway_bin} ${args[*]} (foreground; death → container exit status)"
  # Strip helpers after last use of LANYARD_ENTRY_* (gateway_bin already captured).
  strip_entry_helpers
  # Foreground via exec: we become the gateway. Gateway death is the
  # container/VM process exit code (non-zero if gateway exits non-zero).
  # tini (PID 1 in the image) reaps and forwards signals to this process.
  exec "${gateway_bin}" "${args[@]}"
}

# Short-stack toolbox guest (lp-oop.21). Mount vault, then idle for Daytona
# toolbox exec. No agent runtime, no GATEWAY_RELAY_* / provider keys required.
start_tool_only() {
  require_env VAULT_ROOT
  wait_for_vault
  log "tool-only guest ready (no agent runtime; idle for toolbox)"
  strip_entry_helpers
  if [[ $# -eq 0 || "${1:-}" == "gateway" ]]; then
    exec sleep infinity
  fi
  exec "$@"
}

main() {
  # Hard fail if someone reintroduces install-on-boot in a wrapper.
  if [[ "${LANYARD_ENTRY_ALLOW_PACKAGE_INSTALL:-}" == "1" ]]; then
    die "LANYARD_ENTRY_ALLOW_PACKAGE_INSTALL is forbidden (plan §4.3)"
  fi

  if [[ "${LANYARD_IMAGE_KIND:-}" == "tool-only" ]]; then
    start_tool_only "$@"
  fi

  wait_for_vault
  ensure_gateway_env
  start_gateway "$@"
}

main "$@"
