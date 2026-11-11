#!/usr/bin/env bash
# Enforce Hermes admin + contributor profile seeds on a Company Brain host.
#
# This is the host-path RBAC enforce control. Terraform hermes_profile_hints
# are documentation only and do NOT create or gate profiles.
#
# Usage:
#   bash scripts/ensure-hermes-profiles.sh [--hermes-home PATH] [--require]
#   REQUIRE_HERMES_PROFILES=1 bash scripts/ensure-hermes-profiles.sh
#
# Seeds land under:
#   $HERMES_HOME/profiles/{admin,contributor}.json
#   /etc/company-brain/hermes-profiles/ (best-effort mirror)
#
# See references/hermes-profile-rbac.md.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HERMES_HOME="${HERMES_HOME:-${HOME:-/home/ec2-user}/.hermes}"
REQUIRE_HERMES_PROFILES="${REQUIRE_HERMES_PROFILES:-0}"
SEED_DIR="${HERMES_PROFILE_SEED_DIR:-$ROOT/scripts/hermes-profiles}"

usage() {
  cat <<EOF
Usage: $0 [--hermes-home PATH] [--require] [--seed-dir PATH]

Write and verify admin + contributor Hermes profile seeds.
With --require (or REQUIRE_HERMES_PROFILES=1), exit non-zero if seeds cannot
be written or contributor elevation is detected.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --hermes-home) HERMES_HOME="$2"; shift 2 ;;
    --seed-dir) SEED_DIR="$2"; shift 2 ;;
    --require) REQUIRE_HERMES_PROFILES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

export HERMES_HOME REQUIRE_HERMES_PROFILES

# Prefer bootstrap helpers (single source of write/verify logic) when available.
BOOTSTRAP="${ROOT}/scripts/bootstrap-host.sh"
if [ ! -f "$BOOTSTRAP" ]; then
  echo "[ensure-hermes-profiles] ERROR: bootstrap-host.sh not found at $BOOTSTRAP" >&2
  exit 1
fi
# shellcheck disable=SC1090
BOOTSTRAP_HOST_LIB_ONLY=1 source "$BOOTSTRAP"

# Re-bind log/err after sourcing bootstrap (which defines its own prefixes).
log() { echo "[ensure-hermes-profiles] $*"; }
err() { echo "[ensure-hermes-profiles] ERROR: $*" >&2; }

# If checked-in seed templates exist, validate them before writing (offline CI).
if [ -d "$SEED_DIR" ]; then
  for role in admin contributor; do
    seed="$SEED_DIR/${role}.json"
    if [ -f "$seed" ]; then
      log "Validating seed template: $seed"
      case "$role" in
        contributor)
          verify_contributor_not_elevated "$seed" || exit 5
          ;;
        admin)
          if ! grep -Eq '"profile_manage"|"system_ops"|"vault_full"' "$seed"; then
            err "Admin seed template missing admin-only capabilities: $seed"
            exit 5
          fi
          ;;
      esac
    fi
  done
fi

ensure_hermes_profiles "$HERMES_HOME"
log "Done."
