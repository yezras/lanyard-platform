#!/usr/bin/env bash
# Build-time install of MemPalace CLI into the agent-gateway image.
#
# Bead: lp-zuh.10.2 (MemPalace CLI baked into agent-gateway snapshot)
# Bead: lp-zuh.11.4 (POSIX `command` shim so Node which() can resolve mempalace)
# Plan §4.3: product CLIs are Bucket A prebake — never install-on-boot.
#
# Usage (as root, during docker build):
#   install-mempalace.sh [VERSION]
# Env overrides:
#   MEMPALACE_VERSION   default 3.7.0
#   MEMPALACE_VENV      default /opt/mempalace
#   MEMPALACE_BIN_LINK  default /usr/local/bin/mempalace
#
# Installs a pinned PyPI release into an isolated venv and symlinks the
# console script onto PATH so guest ready can see mempalace without boot pip.
#
# Also installs a real `/usr/local/bin/command` shim: Lanyard Agent
# `@lanyard-agent/memory` defaultWhich uses child_process.spawn("command",
# ["-v", name]) without a shell. On Linux `command` is a shell builtin, so
# spawn returns ENOENT and GET /ready reports mempalace.reason=binary_missing
# even when mempalace is on PATH. The shim makes that probe succeed.

set -euo pipefail

VERSION="${1:-${MEMPALACE_VERSION:-3.7.0}}"
VENV="${MEMPALACE_VENV:-/opt/mempalace}"
BIN_LINK="${MEMPALACE_BIN_LINK:-/usr/local/bin/mempalace}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "install-mempalace: must run as root (image build only)" >&2
  exit 1
fi

if ! [[ "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+([a-zA-Z0-9._-]+)?$ ]]; then
  echo "install-mempalace: invalid version '${VERSION}' (expect PEP 440-ish X.Y.Z…)" >&2
  exit 2
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "install-mempalace: python3 is required (prebake python3 in Dockerfile first)" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
# python3-venv + ensurepip provide an isolated install root; no boot-time pip.
apt-get update
apt-get install -y --no-install-recommends \
  python3-venv \
  python3-pip
rm -rf /var/lib/apt/lists/*

echo "install-mempalace: creating venv at ${VENV}"
python3 -m venv "${VENV}"
rm -rf "${VENV}"
python3 -m venv "${VENV}"

# shellcheck disable=SC1091
source "${VENV}/bin/activate"
python -m pip install --upgrade pip setuptools wheel
echo "install-mempalace: pip install mempalace==${VERSION}"
python -m pip install --no-cache-dir "mempalace==${VERSION}"
deactivate

if [[ ! -x "${VENV}/bin/mempalace" ]]; then
  echo "install-mempalace: ERROR missing ${VENV}/bin/mempalace after pip install" >&2
  ls -la "${VENV}/bin" >&2 || true
  exit 1
fi

mkdir -p "$(dirname "${BIN_LINK}")"
ln -sfn "${VENV}/bin/mempalace" "${BIN_LINK}"
# Also expose companion MCP console script when present (optional).
if [[ -x "${VENV}/bin/mempalace-mcp" ]]; then
  ln -sfn "${VENV}/bin/mempalace-mcp" "$(dirname "${BIN_LINK}")/mempalace-mcp"
fi

# Ensure world-readable/executable for non-root gateway user (uid 990 brain).
chmod -R a+rX "${VENV}"
chmod 0755 "${BIN_LINK}"

command -v mempalace >/dev/null
got="$(mempalace --version 2>&1 | head -1 || true)"
echo "install-mempalace: installed: ${got}"
# Accept "mempalace X.Y.Z" or "X.Y.Z" depending on upstream CLI formatting.
if ! echo "${got}" | grep -Eq "${VERSION}"; then
  echo "install-mempalace: version mismatch (want ${VERSION}, got '${got}')" >&2
  exit 1
fi

# PATH check as non-root would see it (no secrets, no home install).
if [[ "$(readlink -f "${BIN_LINK}")" != "$(readlink -f "${VENV}/bin/mempalace")" ]]; then
  echo "install-mempalace: BIN_LINK does not resolve to venv binary" >&2
  exit 1
fi

echo "install-mempalace: mempalace=$(command -v mempalace) version=${VERSION} venv=${VENV}"

# ---------------------------------------------------------------------------
# POSIX `command` shim (lp-zuh.11.4) — Node which() without shell
# ---------------------------------------------------------------------------
SHIM_DIR="${MEMPALACE_COMMAND_SHIM_DIR:-/usr/local/lib/lanyard/bin}"
SHIM_PATH="${SHIM_DIR}/command"
SHIM_LINK="${MEMPALACE_COMMAND_SHIM_LINK:-/usr/local/bin/command}"

mkdir -p "${SHIM_DIR}"
cat > "${SHIM_PATH}" <<'SHIM'
#!/bin/sh
# Real executable so node:child_process can run `command -v <bin>` (lp-zuh.11.4).
# Do not look up PATH `command` (this file) for lookups — use which/type -P only.
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
echo "command-shim: unsupported invocation: $*" >&2
exit 127
SHIM
chmod 0755 "${SHIM_PATH}"
ln -sfn "${SHIM_PATH}" "${SHIM_LINK}"

if ! "${SHIM_PATH}" -v mempalace >/dev/null; then
  echo "install-mempalace: command-shim failed to resolve mempalace" >&2
  exit 1
fi
echo "install-mempalace: command-shim ok ($("${SHIM_PATH}" -v mempalace) via ${SHIM_LINK})"
