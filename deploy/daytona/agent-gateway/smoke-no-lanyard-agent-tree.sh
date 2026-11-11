#!/usr/bin/env bash
# Smoke: fail if the guest ships the lanyard-agent product tree (lp-oop.22).
#
# Short-stack tool-only images must not contain
#   /opt/company-brain-backend/current/lanyard-agent
# The script is fail-closed: any present tree (dir, file, or symlink) is
# non-zero. Default mode is an offline fixture proof (no Docker).
#
# Usage (from monorepo root or this directory):
#   bash deploy/daytona/agent-gateway/smoke-no-lanyard-agent-tree.sh
#   bash deploy/daytona/agent-gateway/smoke-no-lanyard-agent-tree.sh --root /opt/company-brain-backend/current
#   bash deploy/daytona/agent-gateway/smoke-no-lanyard-agent-tree.sh --image lanyard/agent-gateway:tool-only-local
#   IMAGE_TAG=lanyard/agent-gateway:tool-only-local \
#     bash deploy/daytona/agent-gateway/smoke-no-lanyard-agent-tree.sh --image
#
# Optional env:
#   INSTALL_PATH   install root inside the guest (default
#                  /opt/company-brain-backend/current)
#   IMAGE_TAG      default image for --image
#   PLATFORM       docker platform (default linux/amd64)
#
# Plan: docs/plans/0015-short-stack/ phase 6. Epic lp-oop. GH #450. ADR 0011.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
README="${ROOT}/README.md"
DOCKERFILE="${ROOT}/Dockerfile"
INSTALL_PATH="${INSTALL_PATH:-/opt/company-brain-backend/current}"
PLATFORM="${PLATFORM:-linux/amd64}"
TREE_NAME="lanyard-agent"

MODE="self-test"
ROOT_ARG=""
IMAGE_ARG="${IMAGE_TAG:-}"

usage() {
  sed -n '2,24p' "$0"
}

forbidden_tree() {
  local install_path="${1%/}"
  printf '%s/%s' "${install_path}" "${TREE_NAME}"
}

tree_present() {
  local path
  path="$(forbidden_tree "$1")"
  [[ -e "${path}" || -L "${path}" ]]
}

# Check mode: print PASS/FAIL and return 0 only when the tree is absent.
check_install_path() {
  local install_path="$1"
  local path
  path="$(forbidden_tree "${install_path}")"
  if tree_present "${install_path}"; then
    echo "FAIL: lanyard-agent tree present at ${path}" >&2
    ls -la "${path}" >&2 || true
    return 1
  fi
  echo "PASS: no lanyard-agent tree at ${path}"
  return 0
}

check_image() {
  local image="$1"
  local guest_path
  guest_path="$(forbidden_tree "${INSTALL_PATH}")"
  if ! command -v docker >/dev/null 2>&1; then
    echo "FAIL: docker is required for --image (not on PATH)" >&2
    return 1
  fi
  if ! docker image inspect "${image}" >/dev/null 2>&1; then
    echo "FAIL: docker image not found: ${image}" >&2
    return 1
  fi
  docker run --rm --platform "${PLATFORM}" --entrypoint /bin/bash "${image}" -lc "
    set -euo pipefail
    path='${guest_path}'
    if [[ -e \"\${path}\" || -L \"\${path}\" ]]; then
      echo \"FAIL: lanyard-agent tree present at \${path}\" >&2
      ls -la \"\${path}\" >&2 || true
      exit 1
    fi
    echo \"PASS: no lanyard-agent tree at \${path}\"
  "
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root)
      MODE="root"
      ROOT_ARG="${2:-}"
      if [[ -z "${ROOT_ARG}" ]]; then
        echo "error: --root requires an install path" >&2
        exit 2
      fi
      shift 2
      ;;
    --root=*)
      MODE="root"
      ROOT_ARG="${1#--root=}"
      shift
      ;;
    --image)
      MODE="image"
      if [[ -n "${2:-}" && "${2}" != --* ]]; then
        IMAGE_ARG="$2"
        shift 2
      else
        shift
      fi
      ;;
    --image=*)
      MODE="image"
      IMAGE_ARG="${1#--image=}"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "unknown arg: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "${MODE}" in
  root)
    check_install_path "${ROOT_ARG}"
    exit $?
    ;;
  image)
    if [[ -z "${IMAGE_ARG}" ]]; then
      echo "error: --image requires IMAGE_TAG or an image argument" >&2
      exit 2
    fi
    check_image "${IMAGE_ARG}"
    exit $?
    ;;
esac

# --- offline self-test (default): prove non-zero if tree present -------------
FAILED=0
pass() { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1"; FAILED=$((FAILED + 1)); }

echo "==> no lanyard-agent tree smoke (lp-oop.22)"
echo "    dir: ${ROOT}"
echo

if [[ -f "${ROOT}/smoke-no-lanyard-agent-tree.sh" ]]; then
  pass "smoke-no-lanyard-agent-tree.sh present"
else
  fail "smoke-no-lanyard-agent-tree.sh missing"
fi

if grep -q 'smoke-no-lanyard-agent-tree.sh' "${README}" \
  && grep -q 'lp-oop.22' "${README}" \
  && grep -q '/opt/company-brain-backend/current/lanyard-agent' "${README}"; then
  pass "README documents smoke + forbidden tree path"
else
  fail "README missing lp-oop.22 smoke documentation"
fi

if grep -Eq '^FROM .+ AS tool-only' "${DOCKERFILE}" \
  && grep -q '/opt/company-brain-backend/current/lanyard-agent' "${DOCKERFILE}"; then
  pass "Dockerfile tool-only target cites forbidden tree path"
else
  fail "Dockerfile missing tool-only / lanyard-agent absence contract"
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

dirty="${tmpdir}/dirty-current"
clean="${tmpdir}/clean-current"
mkdir -p "${dirty}/${TREE_NAME}/apps/gateway/dist" "${clean}/bin"
printf '%s\n' '0.0.0-dirty-fixture' >"${dirty}/${TREE_NAME}/VERSION"

set +e
out_dirty="$("${BASH_SOURCE[0]}" --root "${dirty}" 2>&1)"
rc_dirty=$?
set -e
if [[ "${rc_dirty}" -ne 0 ]] \
  && echo "${out_dirty}" | grep -q 'FAIL: lanyard-agent tree present'; then
  pass "non-zero when ${TREE_NAME}/ tree is present (rc=${rc_dirty})"
else
  fail "expected non-zero when tree present (rc=${rc_dirty})"
  echo "${out_dirty}" | sed 's/^/    /'
fi

# Symlink also counts (defense against a relocated product tree).
link_root="${tmpdir}/link-current"
mkdir -p "${link_root}" "${tmpdir}/elsewhere/${TREE_NAME}"
ln -s "${tmpdir}/elsewhere/${TREE_NAME}" "${link_root}/${TREE_NAME}"
set +e
out_link="$("${BASH_SOURCE[0]}" --root "${link_root}" 2>&1)"
rc_link=$?
set -e
if [[ "${rc_link}" -ne 0 ]]; then
  pass "non-zero when ${TREE_NAME} is a symlink"
else
  fail "expected non-zero for symlink tree (rc=${rc_link})"
  echo "${out_link}" | sed 's/^/    /'
fi

set +e
out_clean="$("${BASH_SOURCE[0]}" --root "${clean}" 2>&1)"
rc_clean=$?
set -e
if [[ "${rc_clean}" -eq 0 ]] \
  && echo "${out_clean}" | grep -q 'PASS: no lanyard-agent tree'; then
  pass "zero when ${TREE_NAME}/ tree is absent"
else
  fail "expected zero when tree absent (rc=${rc_clean})"
  echo "${out_clean}" | sed 's/^/    /'
fi

if [[ -n "${IMAGE_TAG:-}" ]] && command -v docker >/dev/null 2>&1 \
  && docker image inspect "${IMAGE_TAG}" >/dev/null 2>&1; then
  set +e
  out_img="$("${BASH_SOURCE[0]}" --image "${IMAGE_TAG}" 2>&1)"
  rc_img=$?
  set -e
  if [[ "${rc_img}" -eq 0 ]]; then
    pass "IMAGE_TAG=${IMAGE_TAG} has no lanyard-agent tree"
  else
    fail "IMAGE_TAG=${IMAGE_TAG} contains lanyard-agent tree (rc=${rc_img})"
    echo "${out_img}" | sed 's/^/    /'
  fi
else
  echo "  SKIP  --image (set IMAGE_TAG to a built tool-only image to inspect)"
fi

echo
if [[ "${FAILED}" -ne 0 ]]; then
  echo "RESULT: ${FAILED} failure(s) (lp-oop.22)"
  exit 1
fi
echo "RESULT: no lanyard-agent tree smoke passed (lp-oop.22)"
exit 0
