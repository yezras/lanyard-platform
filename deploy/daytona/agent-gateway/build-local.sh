#!/usr/bin/env bash
# Local build proof for agent-gateway image (lp-e9l / lp-b7w / lp-zuh.9.3 / lp-zuh.10.2).
# Default platform: linux/amd64 (Daytona container snapshot).
# Also supports linux/arm64 (Fargate / multi-arch product requirement).
# ECR push is CI workflow agent-gateway-image.yml (lp-wu1) when lab vars exist.
# Snapshot register: create-snapshot-from-digest.sh (lp-1wa / lp-zuh.9.3).
#
# Usage (from monorepo root or this directory):
#   bash deploy/daytona/agent-gateway/build-local.sh
#   bash deploy/daytona/agent-gateway/build-local.sh --run-smoke
#   bash deploy/daytona/agent-gateway/build-local.sh --tool-only
#   PLATFORM=linux/arm64 bash deploy/daytona/agent-gateway/build-local.sh
#
# --tool-only (lp-oop.21 / plan 0015): Dockerfile target tool-only.
# Skips AGENT_TARBALL / agent-release extract. Does not write
# DAYTONA_DEFAULT_SNAPSHOT or MockLab agent_snapshot_id.
# --require-real-agent (lp-na7d): agent-gateway must contain real lanyard-agent,
# not fake-gateway stub. Fails closed if no tarball baked. Live publish path.
#
# Optional env:
#   IMAGE_TAG      default lanyard/agent-gateway:local
#                  (--tool-only default lanyard/agent-gateway:tool-only-local)
#   PLATFORM       default linux/amd64 (or linux/arm64)
#   TARGET         Dockerfile target (default agent-gateway)
#   AGENT_TARBALL  context-relative path under agent-release/ (or empty for stub)
#                  Ignored for --tool-only / TARGET=tool-only (lp-oop.21).
#   LANYARD_REQUIRE_REAL_AGENT  1 = fail closed if stub shipped (lp-na7d). Default 0 for local stub proof.
#   MOUNT_S3_VERSION  default 1.23.0 (Dockerfile ARG)
#   MEMPALACE_VERSION default 3.7.0 (Dockerfile ARG; lp-zuh.10.2)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_TAG="${IMAGE_TAG:-}"
PLATFORM="${PLATFORM:-linux/amd64}"
TARGET="${TARGET:-}"
RUN_SMOKE=0
REQUIRE_REAL_AGENT="${LANYARD_REQUIRE_REAL_AGENT:-0}"
BUILD_ARGS=()

for arg in "$@"; do
  case "${arg}" in
    --run-smoke) RUN_SMOKE=1 ;;
    --tool-only) TARGET=tool-only ;;
    --require-real-agent) REQUIRE_REAL_AGENT=1 ;;
    --target=*) TARGET="${arg#--target=}" ;;
    --help|-h)
      sed -n '2,40p' "$0"
      exit 0
      ;;
    *)
      echo "unknown arg: ${arg}" >&2
      exit 2
      ;;
  esac
done

# lp-na7d: live pin must bake real agent. Auto-resolve AGENT_TARBALL if not set but a single
# archive exists in agent-release/ (convenience for operators who dropped the tarball).
if [[ "${TARGET}" != "tool-only" && "${REQUIRE_REAL_AGENT}" == "1" && -z "${AGENT_TARBALL:-}" ]]; then
  shopt -s nullglob
  _candidates=("${ROOT}/agent-release"/*.tar.gz "${ROOT}/agent-release"/*.tgz)
  shopt -u nullglob
  _real=()
  for _c in "${_candidates[@]+"${_candidates[@]}"}"; do
    if [[ -f "${_c}" && -s "${_c}" ]]; then _real+=("$(basename "${_c}")"); fi
  done
  if [[ "${#_real[@]}" -eq 1 ]]; then
    AGENT_TARBALL="${_real[0]}"
    echo "lp-na7d: auto-resolved AGENT_TARBALL=${AGENT_TARBALL} for REQUIRE_REAL_AGENT=1" >&2
  elif [[ "${#_real[@]}" -gt 1 ]]; then
    echo "lp-na7d: multiple archives in agent-release/; pass AGENT_TARBALL=name.tar.gz (REQUIRE_REAL_AGENT=1)" >&2
    printf '  %s\n' "${_real[@]}" >&2
    exit 1
  fi
fi

if [[ -z "${IMAGE_TAG}" ]]; then
  if [[ "${TARGET}" == "tool-only" ]]; then
    IMAGE_TAG="lanyard/agent-gateway:tool-only-local"
  else
    IMAGE_TAG="lanyard/agent-gateway:local"
  fi
fi

case "${PLATFORM}" in
  linux/amd64|linux/arm64) ;;
  *)
    echo "error: PLATFORM must be linux/amd64 or linux/arm64 (got ${PLATFORM})" >&2
    exit 2
    ;;
esac

if [[ "${TARGET}" == "tool-only" && -n "${AGENT_TARBALL:-}" ]]; then
  echo "note: --tool-only ignores AGENT_TARBALL=${AGENT_TARBALL} (lp-oop.21)" >&2
elif [[ -n "${AGENT_TARBALL:-}" ]]; then
  BUILD_ARGS+=(--build-arg "AGENT_TARBALL=${AGENT_TARBALL}")
fi
# lp-na7d: require real agent gate for live pin
if [[ "${REQUIRE_REAL_AGENT}" == "1" ]]; then
  BUILD_ARGS+=(--build-arg "LANYARD_REQUIRE_REAL_AGENT=1")
fi
if [[ -n "${MOUNT_S3_VERSION:-}" ]]; then
  BUILD_ARGS+=(--build-arg "MOUNT_S3_VERSION=${MOUNT_S3_VERSION}")
fi
if [[ -n "${MEMPALACE_VERSION:-}" ]]; then
  BUILD_ARGS+=(--build-arg "MEMPALACE_VERSION=${MEMPALACE_VERSION}")
fi

TARGET_ARGS=()
if [[ -n "${TARGET}" ]]; then
  case "${TARGET}" in
    tool-only|agent-gateway|toolbox) ;;
    *)
      echo "error: TARGET must be tool-only, agent-gateway, or toolbox (got ${TARGET})" >&2
      exit 2
      ;;
  esac
  TARGET_ARGS+=(--target "${TARGET}")
fi

echo "==> docker build --platform ${PLATFORM} ${TARGET_ARGS[*]+${TARGET_ARGS[*]}} -t ${IMAGE_TAG}"
docker build \
  --platform "${PLATFORM}" \
  "${TARGET_ARGS[@]+"${TARGET_ARGS[@]}"}" \
  -t "${IMAGE_TAG}" \
  "${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"}" \
  -f "${ROOT}/Dockerfile" \
  "${ROOT}"

echo "==> verify baked entrypoint matches build context (lp-frwn: stale-layer guard)"
CTX_MD5="$(md5sum "${ROOT}/entrypoint.sh" | awk '{print $1}')"
BAKED_MD5="$(docker run --rm --platform "${PLATFORM}" --entrypoint /bin/bash "${IMAGE_TAG}" -c 'md5sum /usr/local/lib/lanyard/entrypoint.sh' | awk '{print $1}')"
if [ "${CTX_MD5}" != "${BAKED_MD5}" ]; then
  echo "FAIL: baked entrypoint.sh (${BAKED_MD5}) != context entrypoint.sh (${CTX_MD5}) — stale layer; rebuild with --no-cache" >&2
  exit 1
fi
echo "entrypoint md5 match: ${BAKED_MD5}"

echo "==> verify prebaked CLIs + mount-s3 + mempalace + vault ownership"
docker run --rm --platform "${PLATFORM}" --entrypoint /bin/bash "${IMAGE_TAG}" -lc '
  set -euo pipefail
  command -v git
  command -v curl
  command -v jq
  command -v python3
  command -v mount-s3
  command -v fusermount
  command -v mempalace
  mount-s3 --version
  # lp-zuh.9.3: mount-s3 prebaked (no boot install); version pin is build ARG default.
  mount-s3 --version 2>&1 | grep -Eq "mount-s3[[:space:]]+1\.23\.0"
  # lp-zuh.10.2: mempalace CLI prebaked (no boot pip/uv); default pin 3.7.0.
  mempalace --version
  mempalace --version 2>&1 | grep -Eq "3\.7\.0"
  # brain uid can resolve mempalace on PATH (guest ready probe).
  test -x "$(command -v mempalace)"
  # /mnt/vault owned by gateway user (uid 990 brain) for empty local fallback.
  test -d /mnt/vault
  test "$(stat -c "%u:%g" /mnt/vault)" = "990:990"
  # Secrets must not be baked as ENV defaults.
  if env | grep -Eiq "^(GATEWAY_RELAY_SECRET|OPENAI_API_KEY|XAI_API_KEY|DAYTONA_API_KEY|AWS_SECRET_ACCESS_KEY)="; then
    echo "FAIL: secret-like ENV present in image" >&2
    env | grep -Ei "SECRET|API_KEY|AWS_SECRET" >&2 || true
    exit 1
  fi
  echo "prebake + mount-s3 + mempalace + vault ownership + no-secret-env OK"
'

if [[ "${TARGET}" == "tool-only" ]]; then
  echo "==> verify tool-only has no lanyard-agent tree (lp-oop.22)"
  IMAGE_TAG="${IMAGE_TAG}" PLATFORM="${PLATFORM}" \
    bash "${ROOT}/smoke-no-lanyard-agent-tree.sh" --image "${IMAGE_TAG}"
  docker run --rm --platform "${PLATFORM}" --entrypoint /bin/bash "${IMAGE_TAG}" -lc '
    set -euo pipefail
    if [[ -e /opt/company-brain-backend/current/bin/company-brain-backend ]]; then
      echo "FAIL: tool-only image contains company-brain-backend (agent runtime)" >&2
      exit 1
    fi
    if [[ -e /tmp/agent-tarball-stage ]]; then
      echo "FAIL: tool-only image left /tmp/agent-tarball-stage" >&2
      exit 1
    fi
    echo "tool-only: no agent runtime / tarball stage OK"
  '
else
  echo "==> verify gateway binary (agent-gateway default)"
  docker run --rm --platform "${PLATFORM}" --entrypoint /bin/bash "${IMAGE_TAG}" -lc '
    set -euo pipefail
    test -x /opt/company-brain-backend/current/bin/company-brain-backend
    /opt/company-brain-backend/current/bin/company-brain-backend version
    echo "gateway binary OK"
  '
  if [[ "${REQUIRE_REAL_AGENT}" == "1" ]]; then
    echo "==> lp-na7d: verify real agent baked (not fake-gateway stub)"
    docker run --rm --platform "${PLATFORM}" --entrypoint /bin/bash "${IMAGE_TAG}" -lc '
      set -euo pipefail
      bin="/opt/company-brain-backend/current/bin/company-brain-backend"
      if grep -q "fake-gateway" "${bin}" 2>/dev/null; then
        echo "FAIL: image still contains fake-gateway stub (lp-na7d)" >&2
        exit 1
      fi
      test -d /opt/company-brain-backend/current/lanyard-agent
      test -f /opt/company-brain-backend/current/lanyard-agent/apps/gateway/dist/main.js
      grep -q "lanyard-agent" "${bin}"
      cat /opt/company-brain-backend/current/manifest/backend.json | grep -q "lanyard_agent"
      echo "lp-na7d: real agent bake OK (lanyard-agent tree + gateway main.js + manifest)"
    '
  fi
fi

# Guest ready path: non-root brain user must see mempalace on PATH.
echo "==> verify brain (uid 990) has mempalace on PATH"
docker run --rm --platform "${PLATFORM}" --user 990:990 --entrypoint /bin/bash "${IMAGE_TAG}" -lc '
  set -euo pipefail
  test "$(id -u)" = "990"
  command -v mempalace
  mempalace --version 2>&1 | grep -Eq "3\.7\.0"
  echo "brain mempalace on PATH OK"
'

# Write probe as gateway uid (avoids su/PAM on system user nologin).
echo "==> verify brain (uid 990) can write /mnt/vault empty fallback"
docker run --rm --platform "${PLATFORM}" --user 990:990 --entrypoint /bin/bash "${IMAGE_TAG}" -lc '
  set -euo pipefail
  test "$(id -u)" = "990"
  test -w /mnt/vault
  mkdir -p /mnt/vault/.lanyard-fallback-write-probe
  rmdir /mnt/vault/.lanyard-fallback-write-probe
  echo "brain write to /mnt/vault OK"
'

if [[ "${RUN_SMOKE}" -eq 1 ]]; then
  echo "==> entrypoint run smoke (fake vault + wake env)"
  vault="$(mktemp -d)"
  trap 'rm -rf "${vault}"' EXIT
  # Guest runs as uid 990 (brain); host mount must be world-readable.
  chmod 0755 "${vault}"
  touch "${vault}/.vault-ready"
  chmod 0644 "${vault}/.vault-ready"
  if [[ "${TARGET}" == "tool-only" ]]; then
    docker run --rm --platform "${PLATFORM}" \
      -e VAULT_ROOT=/mnt/vault \
      -e LANYARD_ENTRY_VAULT_READY_FILE=.vault-ready \
      -e LANYARD_ENTRY_VAULT_WAIT_SEC=10 \
      -v "${vault}:/mnt/vault:ro" \
      "${IMAGE_TAG}" \
      true
  else
    docker run --rm --platform "${PLATFORM}" \
      -e VAULT_ROOT=/mnt/vault \
      -e BACKEND_HOME=/var/lib/company-brain-backend \
      -e GATEWAY_RELAY_URL=wss://relay.example/ws \
      -e GATEWAY_RELAY_ID=inst_local_proof \
      -e GATEWAY_RELAY_INSTANCE_ID=inst_local_proof \
      -e GATEWAY_RELAY_SECRET=local-not-a-real-secret \
      -e LANYARD_ENTRY_VAULT_READY_FILE=.vault-ready \
      -e LANYARD_ENTRY_VAULT_WAIT_SEC=10 \
      -e LANYARD_FAKE_GATEWAY_SLEEP_SEC=0 \
      -v "${vault}:/mnt/vault:ro" \
      "${IMAGE_TAG}"
  fi
fi

echo "RESULT: local build proof OK (${IMAGE_TAG}, ${PLATFORM}${TARGET:+, target=${TARGET}})"
