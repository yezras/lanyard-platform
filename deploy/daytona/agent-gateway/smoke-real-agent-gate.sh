#!/usr/bin/env bash
# Smoke for lp-na7d: live agent-gateway must bake real lanyard-agent, not fake-gateway.
# No Docker required for core checks; optional docker build gate when Docker is available.
#
# Bead: lp-na7d
# Hypothesis: live pin must bake real tarball; stub never becomes agent_ready.
#
# Checks:
#  1. Dockerfile has LANYARD_REQUIRE_REAL_AGENT arg and fail-closed gate
#  2. install-agent-runtime respects LANYARD_REQUIRE_REAL_AGENT
#  3. workflow publish path sets REQUIRE_REAL_AGENT=1 and AGENT_TARBALL wiring
#  4. agent-release contains pinned real tarball (mailbox-era 8835654…)
#  5. gws stub present (lp-xhf4.21) but agent gateway is not stub
#  6. Optional: docker build with stub + REQUIRE=1 fails; with real tarball passes (when docker available)
#
# Usage:
#   bash deploy/daytona/agent-gateway/smoke-real-agent-gate.sh
#   bash deploy/daytona/agent-gateway/smoke-real-agent-gate.sh --docker  # also try docker builds if docker present

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKERFILE="${ROOT}/Dockerfile"
INSTALL_RT="${ROOT}/install-agent-runtime.sh"
FAKE="${ROOT}/fake-gateway.sh"
WORKFLOW="${ROOT}/../../..//.github/workflows/agent-gateway-image.yml"
# Workflow is at repo root .github/workflows/agent-gateway-image.yml
REPO_ROOT="$(cd "${ROOT}/../../.." && pwd)"
WF="${REPO_ROOT}/.github/workflows/agent-gateway-image.yml"
BUILD_LOCAL="${ROOT}/build-local.sh"
AGENT_TARBALL_PIN="lanyard-agent-0.0.0-main.8835654f4ecd.tar.gz"
AGENT_RELEASE_DIR="${ROOT}/agent-release"
FAILED=0
pass() { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1"; FAILED=$((FAILED+1)); }
SKIP_DOCKER=1
if [[ "${1:-}" == "--docker" ]]; then SKIP_DOCKER=0; fi

echo "==> lp-na7d real-agent gate smoke (fake-gateway vs real bake)"
echo "    root: ${ROOT}"
echo

# 1. Dockerfile gate
if grep -q 'LANYARD_REQUIRE_REAL_AGENT' "${DOCKERFILE}" && grep -q 'lp-na7d' "${DOCKERFILE}"; then
  pass "Dockerfile declares LANYARD_REQUIRE_REAL_AGENT (lp-na7d)"
else
  fail "Dockerfile missing LANYARD_REQUIRE_REAL_AGENT / lp-na7d"
fi

if grep -q 'if \[ "${LANYARD_REQUIRE_REAL_AGENT}" = "1" \]' "${DOCKERFILE}" && grep -q 'fake-gateway' "${DOCKERFILE}"; then
  pass "Dockerfile has stub fail-closed check when REQUIRE_REAL_AGENT=1"
else
  fail "Dockerfile missing fail-closed gate for fake-gateway when REQUIRE_REAL_AGENT=1"
fi

if grep -q 'lanyard-agent.*apps/gateway/dist/main.js' "${DOCKERFILE}" && grep -q 'lanyard-agent tree missing' "${DOCKERFILE}"; then
  pass "Dockerfile verifies lanyard-agent tree + gateway main.js under REQUIRE_REAL_AGENT"
else
  fail "Dockerfile missing lanyard-agent tree verification"
fi

if grep -q 'ARG LANYARD_REQUIRE_REAL_AGENT' "${DOCKERFILE}"; then
  pass "Dockerfile ARG LANYARD_REQUIRE_REAL_AGENT present (re-declared after FROM)"
else
  fail "Dockerfile missing ARG LANYARD_REQUIRE_REAL_AGENT after FROM"
fi

# 2. install-agent-runtime respects flag
if grep -q 'LANYARD_REQUIRE_REAL_AGENT' "${INSTALL_RT}" && grep -q 'refusing stub (lp-na7d)' "${INSTALL_RT}"; then
  pass "install-agent-runtime respects LANYARD_REQUIRE_REAL_AGENT (lp-na7d)"
else
  fail "install-agent-runtime missing LANYARD_REQUIRE_REAL_AGENT guard"
fi

# Functional: with no tarball and REQUIRE=0 keeps stub
tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT
stage="${tmpdir}/stage"
install_path="${tmpdir}/install"
mkdir -p "${stage}" "${install_path}/bin"
cp "${FAKE}" "${install_path}/bin/company-brain-backend"
chmod +x "${install_path}/bin/company-brain-backend"
set +e
LANYARD_REQUIRE_REAL_AGENT=0 bash "${INSTALL_RT}" "" "${stage}" "${install_path}" >/tmp/lp-na7d-0.log 2>&1
rc0=$?
set -e
if [[ "${rc0}" -eq 0 ]] && grep -q "fake-gateway" "${install_path}/bin/company-brain-backend" 2>/dev/null; then
  pass "install-agent-runtime with REQUIRE=0 keeps stub (local proof)"
else
  fail "install-agent-runtime with REQUIRE=0 should keep stub (rc=${rc0})"
fi

# Functional: with no tarball and REQUIRE=1 fails
mkdir -p "${stage}" "${install_path}/bin"
cp "${FAKE}" "${install_path}/bin/company-brain-backend"
chmod +x "${install_path}/bin/company-brain-backend"
set +e
LANYARD_REQUIRE_REAL_AGENT=1 bash "${INSTALL_RT}" "" "${stage}" "${install_path}" >/tmp/lp-na7d-1.log 2>&1
rc1=$?
set -e
if [[ "${rc1}" -ne 0 ]] && grep -q "LANYARD_REQUIRE_REAL_AGENT=1" /tmp/lp-na7d-1.log; then
  pass "install-agent-runtime with REQUIRE=1 fails closed on stub (lp-na7d)"
else
  fail "install-agent-runtime with REQUIRE=1 should fail closed on stub (rc=${rc1})"
fi

# Functional: with real tarball and REQUIRE=1 succeeds
if [[ -f "${AGENT_RELEASE_DIR}/${AGENT_TARBALL_PIN}" ]]; then
  stage2="${tmpdir}/stage2"
  install2="${tmpdir}/install2"
  mkdir -p "${stage2}" "${install2}"
  cp "${AGENT_RELEASE_DIR}/${AGENT_TARBALL_PIN}" "${stage2}/"
  cp "${FAKE}" "${install2}/bin/company-brain-backend" 2>/dev/null || mkdir -p "${install2}/bin" && cp "${FAKE}" "${install2}/bin/company-brain-backend"
  chmod +x "${install2}/bin/company-brain-backend"
  # Need install path bin dir exists for script's check
  set +e
  LANYARD_REQUIRE_REAL_AGENT=1 bash "${INSTALL_RT}" "${AGENT_TARBALL_PIN}" "${stage2}" "${install2}" >/tmp/lp-na7d-real.log 2>&1
  rc_real=$?
  set -e
  if [[ "${rc_real}" -eq 0 ]] && grep -q "lanyard-agent" "${install2}/bin/company-brain-backend" 2>/dev/null && [[ -f "${install2}/lanyard-agent/apps/gateway/dist/main.js" ]]; then
    pass "install-agent-runtime with real tarball + REQUIRE=1 bakes real agent (lp-na7d)"
  else
    fail "install-agent-runtime with real tarball + REQUIRE=1 failed (rc=${rc_real})"
    cat /tmp/lp-na7d-real.log | sed 's/^/    /' | tail -n 40
  fi
  if [[ -f "${install2}/manifest/backend.json" ]] && grep -q "lanyard_agent" "${install2}/manifest/backend.json"; then
    pass "real bake writes manifest/backend.json with lanyard_agent kind"
  else
    fail "real bake missing manifest/backend.json lanyard_agent"
  fi
else
  fail "pinned tarball missing at ${AGENT_RELEASE_DIR}/${AGENT_TARBALL_PIN} (lp-na7d)"
fi

# 3. Workflow publish path
if [[ -f "${WF}" ]]; then
  if grep -q 'LANYARD_REQUIRE_REAL_AGENT=1' "${WF}" && grep -q 'lp-na7d' "${WF}"; then
    pass "workflow sets LANYARD_REQUIRE_REAL_AGENT=1 for publish (lp-na7d)"
  else
    fail "workflow missing LANYARD_REQUIRE_REAL_AGENT=1 for publish"
  fi
  if grep -q 'AGENT_TARBALL' "${WF}" && grep -q 'auto-resolved' "${WF}"; then
    pass "workflow resolves AGENT_TARBALL for publish (lp-na7d)"
  else
    fail "workflow missing AGENT_TARBALL resolve for publish"
  fi
  if grep -q 'fake-gateway' "${WF}" && grep -q 'publish image still contains fake-gateway' "${WF}"; then
    pass "workflow verifies publish image not stub (lp-na7d)"
  else
    fail "workflow missing publish stub verification"
  fi
  if grep -q 'multiple archives' "${WF}"; then
    pass "workflow fails closed on multiple archives (lp-na7d)"
  else
    fail "workflow missing multiple archives guard"
  fi
else
  fail "workflow file not found at ${WF}"
fi

# 4. build-local.sh
if grep -q 'LANYARD_REQUIRE_REAL_AGENT' "${BUILD_LOCAL}" && grep -q -- '--require-real-agent' "${BUILD_LOCAL}" && grep -q 'lp-na7d' "${BUILD_LOCAL}"; then
  pass "build-local.sh supports --require-real-agent / LANYARD_REQUIRE_REAL_AGENT (lp-na7d)"
else
  fail "build-local.sh missing lp-na7d require-real-agent wiring"
fi

# 5. agent-release pin
if [[ -f "${AGENT_RELEASE_DIR}/${AGENT_TARBALL_PIN}" && -s "${AGENT_RELEASE_DIR}/${AGENT_TARBALL_PIN}" ]]; then
  pass "agent-release contains pinned real tarball ${AGENT_TARBALL_PIN} (lp-na7d)"
  # Verify sha256
  sha_file="${AGENT_RELEASE_DIR}/${AGENT_TARBALL_PIN}.sha256"
  if [[ -f "${sha_file}" ]]; then
    if (cd "${AGENT_RELEASE_DIR}" && sha256sum -c "${AGENT_TARBALL_PIN}.sha256" >/dev/null 2>&1); then
      pass "pinned tarball sha256 matches"
    else
      fail "pinned tarball sha256 mismatch"
    fi
  else
    fail "pinned tarball sha256 file missing"
  fi
  # Verify tarball contains gateway main.js (handle SIGPIPE with pipefail)
  set +o pipefail
  if tar tzf "${AGENT_RELEASE_DIR}/${AGENT_TARBALL_PIN}" 2>/dev/null | grep -q "apps/gateway/dist/main.js"; then
    _targz_rc=0
  else
    _targz_rc=$?
  fi
  set -o pipefail
  if [[ "${_targz_rc}" -eq 0 ]]; then
    pass "pinned tarball contains apps/gateway/dist/main.js"
  else
    fail "pinned tarball missing apps/gateway/dist/main.js"
  fi
else
  fail "agent-release missing pinned tarball ${AGENT_TARBALL_PIN}"
fi

# .gitignore allows pin
if grep -q "${AGENT_TARBALL_PIN}" "${AGENT_RELEASE_DIR}/.gitignore"; then
  pass ".gitignore allows pinned tarball (lp-na7d)"
else
  fail ".gitignore does not allow pinned tarball"
fi

# gws still present (lp-xhf4.21 not regressed)
if grep -q 'GOOGLE_WORKSPACE_CLI_TOKEN' "${ROOT}/gws" && grep -q 'GOOGLE_WORKSPACE_CLI_TOKEN' "${DOCKERFILE}"; then
  pass "gws stub still wired (lp-xhf4.21 not regressed)"
else
  fail "gws wiring missing"
fi

# Optional docker gate
if [[ "${SKIP_DOCKER}" -eq 0 ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "  SKIP  docker not available for build gate"
  else
    echo "==> lp-na7d optional docker build gate"
    # Build stub with REQUIRE=1 should fail
    set +e
    docker build --platform linux/amd64 --build-arg "LANYARD_REQUIRE_REAL_AGENT=1" -t lanyard/agent-gateway:lp-na7d-stub-fail -f "${DOCKERFILE}" "${ROOT}" >/tmp/lp-na7d-docker-stub.log 2>&1
    rc_docker_stub=$?
    set -e
    if [[ "${rc_docker_stub}" -ne 0 ]]; then
      pass "docker build stub + REQUIRE=1 fails closed (lp-na7d) — as intended when no tarball"
    else
      # If it succeeded, means tarball was present (single archive auto-picked). Check if real baked.
      # In worktree we have a pin, so it would pick real and succeed. That's also ok if real baked.
      if docker run --rm --entrypoint /bin/bash lanyard/agent-gateway:lp-na7d-stub-fail -c 'grep -q "fake-gateway" /opt/company-brain-backend/current/bin/company-brain-backend && echo stub || echo real' 2>/dev/null | grep -q real; then
        pass "docker build with REQUIRE=1 baked real agent (pin present) — gate passes"
      else
        fail "docker build stub + REQUIRE=1 unexpectedly succeeded with stub"
      fi
    fi
    # Build real with REQUIRE=1 should succeed and not contain fake-gateway
    if [[ -f "${AGENT_RELEASE_DIR}/${AGENT_TARBALL_PIN}" ]]; then
      set +e
      docker build --platform linux/amd64 --build-arg "AGENT_TARBALL=${AGENT_TARBALL_PIN}" --build-arg "LANYARD_REQUIRE_REAL_AGENT=1" -t lanyard/agent-gateway:lp-na7d-real -f "${DOCKERFILE}" "${ROOT}" >/tmp/lp-na7d-docker-real.log 2>&1
      rc_docker_real=$?
      set -e
      if [[ "${rc_docker_real}" -eq 0 ]]; then
        if docker run --rm --entrypoint /bin/bash lanyard/agent-gateway:lp-na7d-real -c 'test -d /opt/company-brain-backend/current/lanyard-agent && grep -q "lanyard-agent" /opt/company-brain-backend/current/bin/company-brain-backend && ! grep -q "fake-gateway" /opt/company-brain-backend/current/bin/company-brain-backend && echo ok' 2>/dev/null | grep -q ok; then
          pass "docker build real tarball + REQUIRE=1 succeeds and is not stub (lp-na7d)"
        else
          fail "docker build real tarball produced stub or missing tree"
        fi
      else
        fail "docker build real tarball + REQUIRE=1 failed (rc=${rc_docker_real})"
        cat /tmp/lp-na7d-docker-real.log | tail -n 40 | sed 's/^/    /'
      fi
    fi
  fi
else
  echo "  SKIP  docker gate skipped (pass --docker to enable)"
fi

echo
if [[ "${FAILED}" -ne 0 ]]; then
  echo "RESULT: ${FAILED} failure(s) (lp-na7d)"
  exit 1
fi
echo "RESULT: all lp-na7d real-agent gate checks passed"
exit 0
