#!/usr/bin/env bash
# lp-jzl.8 — Offline smoke: durable registry + fire path + schedule evaluator
# (real-harness / vitest only — no live MockLab, Daytona API, AWS, or terraform)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CP="${ROOT}/portal/packages/control-plane"
OUT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULT="${OUT_DIR}/RESULT.md"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SHA="$(git -C "${ROOT}" rev-parse --short HEAD 2>/dev/null || echo unknown)"

FILES=(
  test/durable-job-registry.test.ts
  test/scheduled-task-fire.integration.test.ts
  test/schedule-evaluator.test.ts
)

if [[ ! -d "${CP}" ]]; then
  echo "control-plane package not found at ${CP}" >&2
  exit 2
fi

cd "${CP}"

if [[ ! -d node_modules ]] && [[ ! -d "${ROOT}/portal/node_modules" ]]; then
  echo "node_modules missing; run: (cd portal && pnpm install --filter @lanyard/control-plane...)" >&2
  exit 2
fi

LOG="$(mktemp)"
trap 'rm -f "${LOG}"' EXIT

set +e
pnpm exec vitest run "${FILES[@]}" >"${LOG}" 2>&1
CODE=$?
set -e

# Parse summary lines from vitest
TEST_FILES_LINE="$(rg -n 'Test Files' "${LOG}" | tail -1 | cut -d: -f2- | sed 's/^ *//' || true)"
TESTS_LINE="$(rg -n '^ *Tests ' "${LOG}" | tail -1 | cut -d: -f2- | sed 's/^ *//' || true)"
DURATION_LINE="$(rg -n 'Duration' "${LOG}" | tail -1 | cut -d: -f2- | sed 's/^ *//' || true)"

if [[ ${CODE} -eq 0 ]]; then
  VERDICT="PASS"
else
  VERDICT="FAIL"
fi

{
  echo "# lp-jzl.8 — Offline scheduled-task fire smoke"
  echo
  echo "| Field | Value |"
  echo "| --- | --- |"
  echo "| **When (UTC)** | ${STAMP} |"
  echo "| **Git SHA** | \`${SHA}\` |"
  echo "| **Package** | \`@lanyard/control-plane\` |"
  echo "| **Mode** | Offline (real-harness + injectable clock) |"
  echo "| **Live MockLab** | Not run (see EVIDENCE.md residual) |"
  echo "| **Verdict** | **${VERDICT}** |"
  echo "| **Exit code** | ${CODE} |"
  echo
  echo "## Suites"
  echo
  echo '```'
  printf '%s\n' "${FILES[@]}"
  echo '```'
  echo
  echo "## Vitest summary"
  echo
  echo '```'
  echo "${TEST_FILES_LINE:-"(no Test Files line)"}"
  echo "${TESTS_LINE:-"(no Tests line)"}"
  echo "${DURATION_LINE:-"(no Duration line)"}"
  echo '```'
  echo
  echo "## Full vitest log"
  echo
  echo '```'
  cat "${LOG}"
  echo '```'
  echo
  echo "## Expected mapping (acceptance)"
  echo
  echo "| Suite | Covers |"
  echo "| --- | --- |"
  echo "| \`durable-job-registry.test.ts\` | lp-jzl.10.1 — platform SoT + rematerialize after stop/re-wake |"
  echo "| \`scheduled-task-fire.integration.test.ts\` | lp-jzl.7 — ensure_online → mid_turn run → idle stop; job survives |"
  echo "| \`schedule-evaluator.test.ts\` | lp-jzl.10.2 — due scan from platform SoT; fire without guest ticker |"
  echo
  if [[ "${VERDICT}" == "PASS" ]]; then
    echo "Offline operational fire path is proven in-process. Live one-fire remains residual until OPERATOR HOLD / stack allows (EVIDENCE.md)."
  else
    echo "Offline smoke failed — do not claim fire path green. Fix tests before re-running live runbook."
  fi
} >"${RESULT}"

echo "Wrote ${RESULT} (verdict=${VERDICT})"
cat "${LOG}"
exit "${CODE}"
