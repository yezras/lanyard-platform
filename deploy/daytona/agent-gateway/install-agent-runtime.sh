#!/usr/bin/env bash
# Install agent runtime into BACKEND_INSTALL_PATH during image build (lp-e9l).
#
# Plan §4.3: product binary is prebaked in Bucket A (image), never install-on-boot.
# This script runs only in Dockerfile RUN layers — not from entrypoint.sh.
#
# Usage:
#   install-agent-runtime.sh <AGENT_TARBALL_ARG> <stage_dir> <install_path>
#
# Accepted tarball layouts:
#   1) backend-runtime-v1: bin/company-brain-backend (+ optional manifest/)
#   2) lanyard-agent product (source+dist-v1): VERSION + apps/gateway/dist/main.js
#      → installs under $INSTALL_PATH/lanyard-agent/, pnpm install, writes
#        bin/company-brain-backend wrapper (gateway → node gateway main).
#
# - If AGENT_TARBALL_ARG is non-empty: extract that path relative to stage_dir
#   (or absolute if provided as absolute) into install_path.
# - Else if stage_dir contains exactly one *.tar.gz: extract it.
# - Else: leave existing stub bin/company-brain-backend in place (local proof).
#
# Never reads secrets from the environment into files.

set -euo pipefail

AGENT_TARBALL_ARG="${1:-}"
STAGE_DIR="${2:-/tmp/agent-tarball-stage}"
INSTALL_PATH="${3:-/opt/company-brain-backend/current}"

log() { printf 'install-agent-runtime: %s\n' "$*" >&2; }

tarball=""

if [[ -n "${AGENT_TARBALL_ARG}" ]]; then
  if [[ "${AGENT_TARBALL_ARG}" = /* ]]; then
    tarball="${AGENT_TARBALL_ARG}"
  elif [[ -f "${STAGE_DIR}/${AGENT_TARBALL_ARG}" ]]; then
    tarball="${STAGE_DIR}/${AGENT_TARBALL_ARG}"
  elif [[ -f "${AGENT_TARBALL_ARG}" ]]; then
    tarball="${AGENT_TARBALL_ARG}"
  else
    log "ERROR: AGENT_TARBALL='${AGENT_TARBALL_ARG}' not found under ${STAGE_DIR}"
    exit 1
  fi
else
  # Prefer a single release archive dropped into agent-release/ (build context).
  shopt -s nullglob
  candidates=("${STAGE_DIR}"/*.tar.gz "${STAGE_DIR}"/*.tgz)
  shopt -u nullglob
  # Filter out empty placeholders / .gitkeep-only dirs (no real archives).
  real=()
  for c in "${candidates[@]+"${candidates[@]}"}"; do
    if [[ -f "${c}" && -s "${c}" ]]; then
      real+=("${c}")
    fi
  done
  if [[ "${#real[@]}" -eq 1 ]]; then
    tarball="${real[0]}"
  elif [[ "${#real[@]}" -gt 1 ]]; then
    log "ERROR: multiple archives in ${STAGE_DIR}; pass AGENT_TARBALL=name.tar.gz"
    printf '  %s\n' "${real[@]}" >&2
    exit 1
  fi
fi

if [[ -z "${tarball}" ]]; then
  if [[ "${LANYARD_REQUIRE_REAL_AGENT:-0}" == "1" ]]; then
    log "ERROR: LANYARD_REQUIRE_REAL_AGENT=1 but no release tarball found (AGENT_TARBALL empty and no single archive in ${STAGE_DIR}) — refusing stub (lp-na7d)"
    exit 1
  fi
  log "no release tarball; keeping stub company-brain-backend for local proof"
  exit 0
fi

log "extracting ${tarball} → ${INSTALL_PATH}"
tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

tar -xzf "${tarball}" -C "${tmpdir}"

# Accept either archive-root = install tree, or nested single top-level dir.
src="${tmpdir}"
entries=("${tmpdir}"/*)
if [[ "${#entries[@]}" -eq 1 && -d "${entries[0]}" ]]; then
  src="${entries[0]}"
fi

is_backend_runtime_v1=0
is_lanyard_agent_product=0

if [[ -e "${src}/bin/company-brain-backend" ]]; then
  is_backend_runtime_v1=1
elif [[ -f "${src}/apps/gateway/dist/main.js" && -f "${src}/package.json" ]]; then
  is_lanyard_agent_product=1
elif [[ -f "${src}/version-metadata.json" ]]; then
  # Product layout without dist would be invalid for bake.
  log "ERROR: lanyard-agent tarball missing apps/gateway/dist/main.js (build before pack)"
  exit 1
fi

mkdir -p "${INSTALL_PATH}/bin"

if [[ "${is_backend_runtime_v1}" -eq 1 ]]; then
  log "layout=backend-runtime-v1"
  rm -rf "${INSTALL_PATH:?}/"*
  mkdir -p "${INSTALL_PATH}"
  cp -a "${src}/." "${INSTALL_PATH}/"
  chmod 0755 "${INSTALL_PATH}/bin/company-brain-backend" || true

elif [[ "${is_lanyard_agent_product}" -eq 1 ]]; then
  log "layout=lanyard-agent source+dist-v1 → wrapping as company-brain-backend"
  # Keep product tree under install_path/lanyard-agent so node resolution works.
  LA_ROOT="${INSTALL_PATH}/lanyard-agent"
  rm -rf "${LA_ROOT}"
  mkdir -p "${LA_ROOT}"
  cp -a "${src}/." "${LA_ROOT}/"

  if ! command -v node >/dev/null 2>&1; then
    log "ERROR: node is required to install lanyard-agent product tarball (bake Node in Dockerfile)"
    exit 1
  fi
  if ! command -v pnpm >/dev/null 2>&1; then
    if command -v corepack >/dev/null 2>&1; then
      log "enabling pnpm via corepack"
      corepack enable
      # Prefer packageManager field when present.
      if [[ -f "${LA_ROOT}/package.json" ]]; then
        pm="$(node -e 'const p=require(process.argv[1]); process.stdout.write(p.packageManager||"")' "${LA_ROOT}/package.json" || true)"
        if [[ -n "${pm}" ]]; then
          corepack prepare "${pm}" --activate || true
        fi
      fi
    fi
  fi
  if ! command -v pnpm >/dev/null 2>&1; then
    log "ERROR: pnpm not found after corepack; cannot install LA deps"
    exit 1
  fi

  log "pnpm install --frozen-lockfile (prod deps) at ${LA_ROOT}"
  (
    cd "${LA_ROOT}"
    # Image bake is offline-ish after registry fetch; no secrets.
    pnpm install --frozen-lockfile --prod=false
  )

  GW_MAIN="${LA_ROOT}/apps/gateway/dist/main.js"
  CLI_MAIN="${LA_ROOT}/apps/cli/dist/main.js"
  if [[ ! -f "${GW_MAIN}" ]]; then
    log "ERROR: missing ${GW_MAIN} after extract"
    exit 1
  fi
  chmod +x "${GW_MAIN}" 2>/dev/null || true
  [[ -f "${CLI_MAIN}" ]] && chmod +x "${CLI_MAIN}" 2>/dev/null || true

  # Contract entrypoint: company-brain-backend gateway → lanyard-agent-gateway
  cat >"${INSTALL_PATH}/bin/company-brain-backend" <<EOF
#!/usr/bin/env bash
# backend-runtime-v1 entrypoint wrapper for Lanyard Agent product layout.
# Baked at image build; never install-on-boot.
set -euo pipefail
LA_ROOT="${LA_ROOT}"
GW_MAIN="\${LA_ROOT}/apps/gateway/dist/main.js"
CLI_MAIN="\${LA_ROOT}/apps/cli/dist/main.js"
cmd="\${1:-}"
shift || true
case "\${cmd}" in
  gateway)
    exec node "\${GW_MAIN}" "\$@"
    ;;
  version|--version|-V)
    if [[ -f "\${LA_ROOT}/VERSION" ]]; then
      printf 'company-brain-backend (lanyard-agent) %s\n' "\$(tr -d '[:space:]' <"\${LA_ROOT}/VERSION")"
    elif [[ -f "\${LA_ROOT}/version-metadata.json" ]]; then
      node -e 'const m=require(process.argv[1]); process.stdout.write("company-brain-backend (lanyard-agent) "+m.version+"\\n")' "\${LA_ROOT}/version-metadata.json"
    else
      echo "company-brain-backend (lanyard-agent) unknown"
    fi
    exit 0
    ;;
  cli)
    exec node "\${CLI_MAIN}" "\$@"
    ;;
  "" )
    echo "usage: company-brain-backend gateway|version|cli …" >&2
    exit 2
    ;;
  *)
    # Allow passthrough of unknown first arg to gateway for forward-compat.
    exec node "\${GW_MAIN}" "\${cmd}" "\$@"
    ;;
esac
EOF
  chmod 0755 "${INSTALL_PATH}/bin/company-brain-backend"

  # Optional contract-ish manifest for operators (not secrets).
  mkdir -p "${INSTALL_PATH}/manifest"
  LA_VER="unknown"
  LA_SHA="unknown"
  [[ -f "${LA_ROOT}/VERSION" ]] && LA_VER="$(tr -d '[:space:]' <"${LA_ROOT}/VERSION")"
  if [[ -f "${LA_ROOT}/version-metadata.json" ]]; then
    LA_SHA="$(node -e 'const m=require(process.argv[1]); process.stdout.write(m.gitCommit||"unknown")' "${LA_ROOT}/version-metadata.json" 2>/dev/null || echo unknown)"
  fi
  cat >"${INSTALL_PATH}/manifest/backend.json" <<EOF
{
  "schema_version": 1,
  "kind": "lanyard_agent",
  "version": "${LA_VER}",
  "entrypoint": "bin/company-brain-backend",
  "contract": {
    "runtime_layout": 1,
    "relay": 1,
    "brain_rpc": 1
  },
  "provenance": {
    "source_repo": "https://github.com/LanyardBrain/lanyard-agent",
    "git_sha": "${LA_SHA}",
    "layout": "lanyard-agent-source+dist-v1-wrapped"
  }
}
EOF

else
  log "ERROR: unrecognized tarball layout (need bin/company-brain-backend or lanyard-agent product tree)"
  ls -la "${src}" >&2 || true
  exit 1
fi

if [[ ! -x "${INSTALL_PATH}/bin/company-brain-backend" ]]; then
  log "ERROR: bin/company-brain-backend not executable after install"
  exit 1
fi

log "agent runtime installed at ${INSTALL_PATH}"
"${INSTALL_PATH}/bin/company-brain-backend" version || true
