#!/usr/bin/env bash
# Stub for bin/company-brain-backend when no release tarball is baked (lp-e9l / lp-b7w).
#
# Local/CI proof builds use this so docker build + entrypoint smoke work without
# external Hermes / Lanyard Agent product source (stays outside this monorepo).
# Production release builds pass AGENT_TARBALL / agent-release/*.tar.gz to
# install-agent-runtime.sh, which replaces this file with the real binary.
#
# Contract: `company-brain-backend gateway` per backend-runtime-v1.
# This stub does not dial Relay, call Daytona, or log secret values.
#
# Smoke helpers (not product contract):
#   LANYARD_FAKE_GATEWAY_SLEEP_SEC  hold before exit (default 2; 0 = immediate)
#   LANYARD_FAKE_GATEWAY_EXIT_CODE  exit status after gateway (default 0)

set -euo pipefail

cmd="${1:-}"
shift || true

case "${cmd}" in
  gateway)
    echo "fake-gateway: starting (stub runtime; not a real agent)" >&2
    echo "fake-gateway: VAULT_ROOT=${VAULT_ROOT:-unset}" >&2
    echo "fake-gateway: GATEWAY_RELAY_INSTANCE_ID=${GATEWAY_RELAY_INSTANCE_ID:-unset}" >&2
    echo "fake-gateway: BACKEND_HOME=${BACKEND_HOME:-unset}" >&2
    # Stay up briefly so docker run smoke can observe a live process, then exit.
    # Set LANYARD_FAKE_GATEWAY_SLEEP_SEC to hold longer; 0 = exit immediately after log.
    sleep "${LANYARD_FAKE_GATEWAY_SLEEP_SEC:-2}"
    exit_code="${LANYARD_FAKE_GATEWAY_EXIT_CODE:-0}"
    echo "fake-gateway: exit ${exit_code}" >&2
    exit "${exit_code}"
    ;;
  version|--version)
    echo "company-brain-backend (fake) 0.0.0-local+lp-e9l"
    exit 0
    ;;
  *)
    echo "fake-gateway: unknown command '${cmd:-}' (expected: gateway)" >&2
    exit 2
    ;;
esac
