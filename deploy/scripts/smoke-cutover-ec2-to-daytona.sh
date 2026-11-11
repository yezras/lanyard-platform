#!/usr/bin/env bash
# Offline dry-run smoke for EC2 → daytona cutover checklist (lp-6h8).
#
# Validates checklist doc completeness, CP flip surface (registry PATCH),
# credential-preserving registry UPDATE, dual-run test evidence, and
# cross-links. No AWS, no Daytona API, no network, no secrets.
#
# Usage (from repo root):
#   bash deploy/scripts/smoke-cutover-ec2-to-daytona.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DOC="$ROOT/docs/plans/0008-daytona-agent-sandboxes/cutover-ec2-to-daytona.md"
DUAL="$ROOT/docs/plans/0008-daytona-agent-sandboxes/dual-run-runtime-kind.md"
VAULT="$ROOT/docs/plans/0008-daytona-agent-sandboxes/vault-ec2-to-s3-copy.md"
ISSUE_MAP="$ROOT/docs/plans/0008-daytona-agent-sandboxes/issue-map.md"
APP_SRC="$ROOT/portal/packages/control-plane/src/app.ts"
REG_SRC="$ROOT/portal/packages/control-plane/src/deployment-registry.ts"
DUAL_TEST="$ROOT/portal/packages/control-plane/test/runtime-kind-dual-run.test.ts"
VAULT_SMOKE="$ROOT/deploy/scripts/smoke-copy-vault-ec2-to-s3.sh"

fail() { echo "[smoke-cutover-ec2-to-daytona] FAIL: $*" >&2; exit 1; }
pass() { echo "[smoke-cutover-ec2-to-daytona] PASS: $*"; }
log() { echo "[smoke-cutover-ec2-to-daytona] $*"; }

# --- presence ---
[[ -f "$DOC" ]] || fail "missing checklist $DOC"
[[ -f "$DUAL" ]] || fail "missing dual-run doc $DUAL"
[[ -f "$VAULT" ]] || fail "missing vault copy runbook $VAULT"
[[ -f "$APP_SRC" ]] || fail "missing $APP_SRC"
[[ -f "$REG_SRC" ]] || fail "missing $REG_SRC"
[[ -f "$DUAL_TEST" ]] || fail "missing $DUAL_TEST"
pass "checklist + dependency docs + CP sources present"

# --- checklist acceptance axes ---
for needle in \
  "lp-6h8" \
  "lp-gu2" \
  "lp-3ux" \
  "runtime_kind" \
  "instance_id" \
  "secret" \
  "Pre-requisites" \
  "DAYTONA_TENANT_ALLOWLIST" \
  "agent_snapshot" \
  "PATCH" \
  "registry" \
  "ensure-online" \
  "ensure_online" \
  "Validation gates" \
  "Residual" \
  "dry-run" \
  "offline" \
  "Rollback" \
  "lp-ky7" \
  "Do not" \
  "credential"
do
  grep -qi -- "$needle" "$DOC" || fail "checklist missing required coverage: $needle"
done
pass "checklist covers pre-reqs, flip keep credentials, wake, gates, residual"

# Must explicitly keep instance credentials (not re-register / rotate)
grep -qi "keep.*instance\|instance_id.*unchanged\|secret_hash.*Unchanged\|Do not.*rotate\|Do not.*re-register" "$DOC" \
  || fail "checklist must require keeping instance_id/secret (no re-register/rotate)"
pass "checklist requires keep instance_id + secret"

# --- CP flip API exists (lp-gu2 registry PATCH) ---
grep -qF 'app.patch("/tenants/:id/instances/:instanceId/registry"' "$APP_SRC" \
  || fail "CP missing PATCH registry route"
grep -qE 'instanceRegistrySchema[\s\S]*runtime_kind' "$APP_SRC" \
  || grep -A20 'instanceRegistrySchema' "$APP_SRC" | grep -q 'runtime_kind' \
  || fail "instanceRegistrySchema missing runtime_kind"
# Explicit: schema includes runtime_kind enum
grep -n 'runtime_kind' "$APP_SRC" | grep -q 'RUNTIME_KINDS' \
  || fail "app.ts runtime_kind not wired to RUNTIME_KINDS"
pass "CP PATCH registry accepts runtime_kind (flip path exists)"

# --- registry UPDATE must not rewrite secrets ---
# Extract updateInstanceRegistry function body and assert credential columns
# are not assigned (keep instance secret on cutover).
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
# Fail if secret columns appear in the UPDATE assignment list
if echo "$UPD_BODY" | grep -E 'UPDATE gateway_instances SET' -A30 | grep -qE 'secret_hash|secret_salt'; then
  fail "updateInstanceRegistry UPDATE must not touch secret_hash/secret_salt"
fi
pass "registry UPDATE sets runtime_kind and omits secret columns"

# --- dual-run test evidence (flip + ensure_online) ---
grep -q 'registry update can set runtime_kind' "$DUAL_TEST" \
  || fail "dual-run test missing registry update cutover case"
grep -q 'runtime_kind: "daytona"' "$DUAL_TEST" || fail "dual-run test missing daytona flip"
grep -q 'ensureOnline' "$DUAL_TEST" || fail "dual-run test missing ensureOnline after flip"
grep -q 'real harness (via harness-local)' "$DUAL_TEST" || fail "dual-run test missing real harness"
pass "dual-run tests cover registry flip + real harness ensure_online"

# --- cross-links ---
grep -qF "lp-6h8" "$DUAL" || fail "dual-run doc missing lp-6h8 pointer"
grep -qF "cutover-ec2-to-daytona.md" "$DUAL" || fail "dual-run doc missing cutover checklist link"
grep -qF "lp-6h8" "$VAULT" || fail "vault copy runbook missing lp-6h8 handoff"
grep -qF "cutover-ec2-to-daytona.md" "$ISSUE_MAP" || grep -qF "lp-6h8" "$ISSUE_MAP" \
  || fail "issue-map missing lp-6h8"
pass "cross-links dual-run / vault / issue-map"

# --- vault prereq smoke script exists (do not re-run full vault smoke here) ---
[[ -f "$VAULT_SMOKE" ]] || fail "missing vault prereq smoke $VAULT_SMOKE"
bash -n "$VAULT_SMOKE" || fail "bash -n vault smoke failed"
pass "vault copy prereq smoke present (lp-3ux)"

# --- self syntax ---
bash -n "$0" || fail "bash -n self"
pass "smoke script syntax"

# --- dry-run summary (no cloud) ---
cat <<EOF

[smoke-cutover-ec2-to-daytona] dry-run summary
  aws_invoked=0
  daytona_api_invoked=0
  secrets_printed=0
  checklist=$DOC
  flip_api=PATCH /tenants/:id/instances/:instanceId/registry
  keep_credentials=secret_hash/salt omitted from registry UPDATE
  offline_evidence=docs+dual-run tests+this smoke
  residual=live pilot needs operator AWS+Daytona (see checklist §5)
  result=PASS
EOF

pass "lp-6h8 offline cutover dry-run complete"
