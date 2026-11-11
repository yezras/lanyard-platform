#!/usr/bin/env bash
# Offline dry-run smoke for daytona → EC2 rollback checklist (lp-ky7).
#
# Validates rollback runbook completeness, stop-before-flip ordering,
# clear sandbox_id, CP flip surface (registry PATCH), credential-preserving
# registry UPDATE, dual-run test evidence, and cross-links.
# No AWS, no live Daytona API, no network, no secrets.
#
# Usage (from repo root):
#   bash deploy/scripts/smoke-rollback-daytona-to-ec2.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DOC="$ROOT/docs/plans/0008-daytona-agent-sandboxes/rollback-daytona-to-ec2.md"
DUAL="$ROOT/docs/plans/0008-daytona-agent-sandboxes/dual-run-runtime-kind.md"
ISSUE_MAP="$ROOT/docs/plans/0008-daytona-agent-sandboxes/issue-map.md"
OVERVIEW="$ROOT/docs/plans/0008-daytona-agent-sandboxes/overview.md"
APP_SRC="$ROOT/portal/packages/control-plane/src/app.ts"
REG_SRC="$ROOT/portal/packages/control-plane/src/deployment-registry.ts"
ORCH_SRC="$ROOT/portal/packages/control-plane/src/instance-orchestrator.ts"
ORCH_API="$ROOT/portal/packages/control-plane/src/orchestrator-api.ts"
RUNTIME_PATH="$ROOT/portal/packages/control-plane/src/runtime-path.ts"
DUAL_TEST="$ROOT/portal/packages/control-plane/test/runtime-kind-dual-run.test.ts"

fail() { echo "[smoke-rollback-daytona-to-ec2] FAIL: $*" >&2; exit 1; }
pass() { echo "[smoke-rollback-daytona-to-ec2] PASS: $*"; }
log() { echo "[smoke-rollback-daytona-to-ec2] $*"; }

# --- presence ---
[[ -f "$DOC" ]] || fail "missing checklist $DOC"
[[ -f "$DUAL" ]] || fail "missing dual-run doc $DUAL"
[[ -f "$APP_SRC" ]] || fail "missing $APP_SRC"
[[ -f "$REG_SRC" ]] || fail "missing $REG_SRC"
[[ -f "$ORCH_SRC" ]] || fail "missing $ORCH_SRC"
[[ -f "$ORCH_API" ]] || fail "missing $ORCH_API"
[[ -f "$RUNTIME_PATH" ]] || fail "missing $RUNTIME_PATH"
[[ -f "$DUAL_TEST" ]] || fail "missing $DUAL_TEST"
pass "checklist + dependency docs + CP sources present"

# --- checklist acceptance axes ---
for needle in \
  "lp-ky7" \
  "lp-gu2" \
  "lp-6h8" \
  "runtime_kind" \
  "instance_id" \
  "secret" \
  "sandbox_id" \
  "stop" \
  "archive" \
  "PATCH" \
  "registry" \
  "ec2" \
  "daytona" \
  "Pre-requisites" \
  "Validation" \
  "Residual" \
  "dry-run" \
  "offline" \
  "EC2 host" \
  "retain" \
  "credential" \
  "Do not" \
  "lp-u00"
do
  grep -qi -- "$needle" "$DOC" || fail "checklist missing required coverage: $needle"
done
pass "checklist covers stop, clear binding, flip keep credentials, EC2 host, residual"

# Must require stop while still daytona (ordering)
grep -qi "WHILE.*daytona\|while still.*daytona\|stop before flip\|before.*flip" "$DOC" \
  || fail "checklist must require stop while still runtime_kind=daytona"
pass "checklist requires stop-before-flip ordering"

# Must clear sandbox_id on rollback (not warm retain alone)
grep -qi "sandbox_id.*null\|clear.*sandbox_id\|sandbox_id.*clear" "$DOC" \
  || fail "checklist must require clearing sandbox_id"
pass "checklist requires clear sandbox_id"

# Must keep instance credentials
grep -qi "keep.*credential\|secret_hash.*Unchanged\|Do not.*rotate\|Do not.*re-register" "$DOC" \
  || fail "checklist must require keeping instance_id/secret (no re-register/rotate)"
pass "checklist requires keep instance_id + secret"

# Must note EC2 host still exists
grep -qi "EC2 host must still exist\|ec2_host_exists\|host still exists" "$DOC" \
  || fail "checklist must note EC2 host must still exist for dual-run rollback"
pass "checklist requires EC2 host still exists"

# --- CP stop API exists ---
grep -qF 'ORCHESTRATOR_ROUTE_TEMPLATES.stop' "$APP_SRC" \
  || grep -qE 'instances/:instanceId/stop|/stop' "$ORCH_API" \
  || fail "CP missing stop route surface"
grep -q 'stopSandbox\|async function stop\|function stop' "$ORCH_SRC" \
  || fail "orchestrator missing stop implementation"
grep -q 'archiveSandbox\|archive(' "$ORCH_SRC" \
  || fail "orchestrator missing archive surface for optional thrift step"
pass "CP stop + archive surfaces present"

# --- CP flip API exists (lp-gu2 registry PATCH) ---
grep -qF 'app.patch("/tenants/:id/instances/:instanceId/registry"' "$APP_SRC" \
  || fail "CP missing PATCH registry route"
grep -n 'runtime_kind' "$APP_SRC" | grep -q 'RUNTIME_KINDS' \
  || fail "app.ts runtime_kind not wired to RUNTIME_KINDS"
pass "CP PATCH registry accepts runtime_kind (flip path exists)"

# --- dual-path: stop is no-op on ec2 (ordering consequence) ---
grep -q 'no_op_always_on\|decideStopPath' "$RUNTIME_PATH" \
  || fail "runtime-path missing decideStopPath / ec2 no-op"
grep -q 'stop_sandbox_if_bound\|daytona' "$RUNTIME_PATH" \
  || fail "runtime-path missing daytona stop branch"
pass "dual-path stop: ec2 no-op; daytona stops sandbox"

# --- retainSandboxOnStop default true; rollback clears via false or PATCH ---
grep -q 'retainSandboxOnStop' "$ORCH_SRC" \
  || fail "orchestrator missing retainSandboxOnStop (lp-6bg) — rollback must clear binding explicitly"
pass "retainSandboxOnStop present (rollback must clear sandbox_id deliberately)"

# --- registry UPDATE must not rewrite secrets ---
if ! awk '
  /export async function updateInstanceRegistry/ { in_fn=1 }
  in_fn { print }
  in_fn && /^export async function / && !/updateInstanceRegistry/ { exit }
  in_fn && /^export function / { exit }
' "$REG_SRC" | grep -q 'UPDATE gateway_instances SET'; then
  fail "could not locate UPDATE in updateInstanceRegistry"
fi

UPD_BODY="$(awk '
  /export async function updateInstanceRegistry/ { in_fn=1 }
  in_fn { print }
  in_fn && /^export async function / && !/updateInstanceRegistry/ { exit }
  in_fn && /^export function / { exit }
' "$REG_SRC")"

echo "$UPD_BODY" | grep -q 'runtime_kind' || fail "updateInstanceRegistry does not set runtime_kind"
echo "$UPD_BODY" | grep -q 'sandbox_id' || fail "updateInstanceRegistry does not set sandbox_id"
# Fail if secret columns appear in the UPDATE assignment list
if echo "$UPD_BODY" | grep -E 'UPDATE gateway_instances SET' -A40 | grep -qE 'secret_hash|secret_salt'; then
  fail "updateInstanceRegistry UPDATE must not touch secret_hash/secret_salt"
fi
pass "registry UPDATE sets runtime_kind/sandbox_id and omits secret columns"

# --- dual-run test evidence (rollback: stop + flip to ec2) ---
grep -q 'lp-ky7' "$DUAL_TEST" \
  || fail "dual-run test missing lp-ky7 rollback case"
grep -qi 'rollback' "$DUAL_TEST" \
  || fail "dual-run test missing rollback coverage"
grep -q 'runtime_kind: "ec2"' "$DUAL_TEST" || fail "dual-run test missing ec2 kind"
grep -q 'retainSandboxOnStop' "$DUAL_TEST" \
  || fail "dual-run test must exercise clear sandbox binding (retainSandboxOnStop)"
grep -q 'real harness (via harness-local)' "$DUAL_TEST" || fail "dual-run test missing real harness"
pass "dual-run tests cover rollback stop + flip to ec2"

# --- cross-links ---
grep -qF "lp-ky7" "$DUAL" || fail "dual-run doc missing lp-ky7 pointer"
grep -qF "rollback-daytona-to-ec2.md" "$DUAL" || fail "dual-run doc missing rollback checklist link"
grep -qF "lp-ky7" "$ISSUE_MAP" || fail "issue-map missing lp-ky7"
grep -qF "rollback-daytona-to-ec2.md" "$ISSUE_MAP" \
  || fail "issue-map missing rollback-daytona-to-ec2.md link"
if [[ -f "$OVERVIEW" ]]; then
  grep -qE "lp-ky7|rollback-daytona-to-ec2" "$OVERVIEW" \
    || grep -qF "rollback-daytona-to-ec2.md" "$OVERVIEW" \
    || grep -qi "rollback" "$OVERVIEW" \
    || log "WARN: overview.md has no explicit lp-ky7/rollback link (non-fatal if issue-map linked)"
fi
pass "cross-links dual-run / issue-map"

# --- self syntax ---
bash -n "$0" || fail "bash -n self"
pass "smoke script syntax"

# --- dry-run summary (no cloud) ---
cat <<EOF

[smoke-rollback-daytona-to-ec2] dry-run summary
  aws_invoked=0
  daytona_api_invoked=0
  secrets_printed=0
  checklist=$DOC
  stop_api=POST /internal/instances/:instanceId/stop
  flip_api=PATCH /tenants/:id/instances/:instanceId/registry
  order=stop_while_daytona_then_clear_sandbox_id_then_flip_ec2
  keep_credentials=secret_hash/salt omitted from registry UPDATE
  offline_evidence=docs+dual-run tests+this smoke
  residual=live lab needs operator AWS+Daytona+existing EC2 host (see checklist §5)
  result=PASS
EOF

pass "lp-ky7 offline rollback dry-run complete"
