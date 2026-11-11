#!/usr/bin/env bash
# Offline smoke: lp-oop.38.13 memory_read/write placement (toolbox MemPalace CLI).
# No AWS, no Daytona, no Fargate PATH probe.
set -euo pipefail

MONO="$(cd "$(dirname "$0")/../.." && pwd)"
DOC="$MONO/docs/architecture/short-stack-tool-placement.md"
START="$MONO/deploy/dev/mocklab-short-stack-harness/start-la-harness.mjs"
DF="$MONO/deploy/dev/mocklab-short-stack-harness/Dockerfile"
PIN="$MONO/artifacts/mocklab/short-stack/la-harness.pins.yaml"
LA_SHA="c41aca03268446ed13299572250ec7709e6eb342"

err() { echo "[smoke-harness-mempalace-placement] ERROR: $*" >&2; }
log() { echo "[smoke-harness-mempalace-placement] $*"; }
fail() { err "$*"; exit 1; }
pass() { log "OK: $*"; }

[[ -f "$DOC" ]] || fail "missing $DOC"
[[ -f "$START" ]] || fail "missing $START"
[[ -f "$DF" ]] || fail "missing $DF"
[[ -f "$PIN" ]] || fail "missing $PIN"

grep -Fq '`memory_read`, `memory_write`' "$DOC" \
  || fail "placement inventory missing memory_read/write row"
grep -Fq 'Toolbox CLI' "$DOC" \
  || fail "memory row must be Toolbox CLI"
grep -Fq '/usr/local/bin/mempalace' "$DOC" \
  || fail "memory row must name snapshot binary"
grep -Fq '/mnt/vault/mempalace' "$DOC" \
  || fail "memory row must name palace dir"
grep -Fq 'sandbox_id' "$DOC" \
  || fail "memory row must fail-close missing sandbox_id"
grep -Fq 'write_policy' "$DOC" \
  || fail "memory row must gate memory_write on write_policy"
grep -Fq 'absent `mempalace.enabled` is not off' "$DOC" \
  || fail "memory row must default-on when Fargate has no guest config.yaml"
grep -Fq 'HARNESS_MEMPALACE_ENABLED=0' "$DOC" \
  || fail "memory row must name the env kill switch"
grep -Fq 'Do not copy the palace onto Fargate' "$DOC" \
  || fail "placement must forbid palace on Fargate"
grep -Fq 'Running `mempalace` (or any vault CLI) on Fargate' "$DOC" \
  || fail "placement must forbid mempalace on Fargate"

grep -Eq 'createEnvToolsTurnRunner' "$START" \
  || fail "start wrapper must still prefer createEnvToolsTurnRunner"
grep -Fq 'HARNESS_REQUIRE_SPAWN' "$START" \
  || fail "start wrapper must keep HARNESS_REQUIRE_SPAWN (c41aca0 is stacked on live spawn)"
grep -Fq 'HARNESS_REQUIRE_MEMORY' "$START" \
  || fail "start wrapper must fail-boot when memory_read is missing"
grep -Fq 'ensure-subagents-config.mjs' "$START" \
  || fail "start wrapper must keep 38.14 subagents seed (do not roll pre-spawn 0451e08)"
grep -Fq '2477b22' "$START" \
  || fail "start wrapper must name live spawn pin 2477b22"
grep -Fq 'c41aca0' "$START" \
  || fail "start wrapper must name memory pin c41aca0"
grep -Fq 'memory_read=present' "$START" \
  || fail "start wrapper must log memory_read present/missing at boot"
grep -Fq 'packages/memory' "$DF" \
  || fail "harness image must COPY packages/memory"
grep -Fq 'HARNESS_REQUIRE_SPAWN' "$DF" \
  || fail "Dockerfile must fail-boot when spawn schemas are missing"
grep -Fq 'HARNESS_REQUIRE_MEMORY' "$DF" \
  || fail "Dockerfile must fail-boot when memory_read is missing"
if grep -Eiq 'usr/local/bin/mempalace|pip install.*mempalace|apt-get install.*mempalace' "$DF"; then
  fail "harness image must not bake the mempalace CLI (palace stays on the sandbox)"
fi

grep -Fq 'bead: lp-oop.38.13' "$PIN" \
  || fail "pin must name bead lp-oop.38.13 under memory_bind"
grep -Fq 'placement: toolbox-cli' "$PIN" \
  || fail "pin memory_bind must be toolbox-cli"
grep -Fq 'binary: /usr/local/bin/mempalace' "$PIN" \
  || fail "pin must name snapshot binary"
grep -Fq 'palace_path: /mnt/vault/mempalace' "$PIN" \
  || fail "pin must name vault palace"
grep -Fq 'spawn: ToolboxClient.execute' "$PIN" \
  || fail "pin must inject ToolboxClient.execute as spawn"
grep -Fq 'fail_closed_without_sandbox_id: true' "$PIN" \
  || fail "pin must fail-close missing sandbox_id"
grep -Fq 'write_policy_disabled_omits_memory_write: true' "$PIN" \
  || fail "pin must omit memory_write when write_policy is disabled"
grep -Fq "$LA_SHA" "$PIN" \
  || fail "pin must name companion LA SHA $LA_SHA"
grep -Fq 'stacked_on_la_sha: 2477b22ec4d33161a6ff122cef6b01fe268d98de' "$PIN" \
  || fail "pin must stack memory SHA on live spawn 2477b22"
grep -Fq 'HARNESS_REQUIRE_SPAWN' "$PIN" \
  || fail "pin note must keep HARNESS_REQUIRE_SPAWN across the memory roll"
grep -Fq 'HARNESS_REQUIRE_MEMORY' "$PIN" \
  || fail "pin note must fail-boot when memory_read is missing"

pass "placement: toolbox MemPalace CLI, palace on vault, write_policy gate"
pass "start wrapper keeps spawn seed + HARNESS_REQUIRE_SPAWN; image copies memory, not mempalace CLI"
pass "pin: toolbox spawn, vault palace, LA $LA_SHA stacked on 2477b22"
echo "[smoke-harness-mempalace-placement] PASS"
