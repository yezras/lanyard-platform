#!/usr/bin/env bash
# Offline smoke for Daytona unused-sandbox archive hygiene (lp-oop.37.7).
# No AWS, no live Daytona, no secrets. Proves dry-run default, keep-set
# protection for bound sandbox_id, and --apply refuse without a keep-set.
#
# Usage (from repo root):
#   bash deploy/scripts/smoke-archive-unused-daytona-sandboxes.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOL="$ROOT/deploy/scripts/archive-unused-daytona-sandboxes.py"
WRAPPER="$ROOT/deploy/daytona/archive-orphan-sandboxes.py"
DOC="$ROOT/docs/runbooks/daytona-sandbox-archive-hygiene.md"
BUMP="$ROOT/docs/plans/0008-daytona-agent-sandboxes/agent-snapshot-bump-runbook.md"

fail() { echo "[smoke-archive-unused-daytona-sandboxes] FAIL: $*" >&2; exit 1; }
pass() { echo "[smoke-archive-unused-daytona-sandboxes] PASS: $*"; }
log() { echo "[smoke-archive-unused-daytona-sandboxes] $*"; }

[[ -f "$TOOL" ]] || fail "missing $TOOL"
[[ -f "$WRAPPER" ]] || fail "missing $WRAPPER"
[[ -f "$DOC" ]] || fail "missing $DOC"
pass "script + wrapper + runbook present"

python3 -m py_compile "$TOOL" || fail "py_compile archive-unused-daytona-sandboxes.py"
python3 -m py_compile "$WRAPPER" || fail "py_compile archive-orphan-sandboxes.py"
pass "py_compile"

SELF_OUT="$(python3 "$TOOL" --self-test 2>&1)" || fail "--self-test exited $?"
echo "$SELF_OUT" | grep -q "self-test ok" || fail "--self-test missing ok line"
echo "$SELF_OUT" | grep -Eiq 'DAYTONA_API_KEY=|Bearer [A-Za-z0-9]{12,}|CONTROL_PLANE_SERVICE_TOKEN=' \
  && fail "self-test output looks like it leaked a secret" || true
pass "--self-test"

HELP="$(python3 "$TOOL" --help 2>&1)"
echo "$HELP" | grep -q -- "--apply" || fail "help missing --apply"
echo "$HELP" | grep -qi "dry-run" || fail "help missing dry-run"
echo "$HELP" | grep -q -- "--keep-id" || fail "help missing --keep-id"
echo "$HELP" | grep -q -- "--cp-instances-json" || fail "help missing --cp-instances-json"
pass "help documents dry-run default + keep-set"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/archive-unused-sandboxes-smoke.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

BOUND="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
ORPHAN="11111111-2222-3333-4444-555555555555"
STARTED="99999999-aaaa-bbbb-cccc-dddddddddddd"

cat >"$TMP/sandboxes.json" <<EOF
{
  "items": [
    {"id": "$BOUND", "state": "stopped", "disk": 3, "updatedAt": "2026-08-17T00:00:00Z"},
    {"id": "$ORPHAN", "state": "stopped", "disk": 3, "updatedAt": "2026-08-16T00:00:00Z"},
    {"id": "$STARTED", "state": "started", "disk": 3, "updatedAt": "2026-08-16T00:00:00Z"},
    {"id": "already-archived", "state": "archived", "disk": 3}
  ]
}
EOF

cat >"$TMP/instances.json" <<EOF
{
  "tenant_id": "319d3808-e533-44db-bfdf-7b6ef8caaae1",
  "instances": [
    {"instance_id": "inst-mocklab", "sandbox_id": "$BOUND", "presence": "offline"}
  ]
}
EOF

PLAN="$(python3 "$TOOL" \
  --sandboxes-json "$TMP/sandboxes.json" \
  --cp-instances-json "$TMP/instances.json" 2>&1)" || fail "fixture dry-run exited $?"

echo "$PLAN" | grep -q "dry_run=true" || fail "default run is not dry-run"
echo "$PLAN" | grep -q "keep $BOUND" || fail "bound sandbox_id not kept"
echo "$PLAN" | grep -q "would_archive $ORPHAN" || fail "unbound stopped not targeted"
echo "$PLAN" | grep -q "skip $STARTED" || fail "unbound started not skipped"
echo "$PLAN" | grep -q "reason=bound_instance" || fail "keep reason missing"
echo "$PLAN" | grep -q "reason=started_unbound" || fail "started skip reason missing"
echo "$PLAN" | grep "would_archive $BOUND" >/dev/null && fail "bound id was targeted" || true
echo "$PLAN" | grep -q "disk_cap_GiB 30" || fail "missing 30GiB cap in plan"
echo "$PLAN" | grep -Eiq 'DAYTONA_API_KEY=|Bearer [A-Za-z0-9]{12,}' \
  && fail "dry-run plan looks like it leaked a secret" || true
pass "fixture dry-run keeps bound id, archives unused, skips started"

set +e
APPLY_OUT="$(python3 "$TOOL" --apply --sandboxes-json "$TMP/sandboxes.json" 2>&1)"
APPLY_RC=$?
set -e
[[ "$APPLY_RC" -eq 2 ]] || fail "--apply with fixture/empty keep-set exit $APPLY_RC (want 2)"
echo "$APPLY_OUT" | grep -qi "refuse" || fail "--apply refuse message missing"
pass "--apply without keep-set / fixture is refused"

# Wrapper still exists and points at the safe script.
grep -q "archive-unused-daytona-sandboxes.py" "$WRAPPER" \
  || fail "wrapper does not exec the new script"
grep -q "lp-oop.37.7" "$WRAPPER" || fail "wrapper missing bead id"
pass "legacy wrapper forwards to keep-set script"

for needle in \
  "lp-oop.37.7" \
  "30" \
  "sandbox_id" \
  "dry-run" \
  "--apply" \
  "keep-set" \
  "409" \
  "idle" \
  "MockLab" \
  "Pending" \
  "terraform"
do
  grep -qi -- "$needle" "$DOC" || fail "runbook missing coverage: $needle"
done
pass "runbook covers keep-set, dry-run, 409, live-proof pending"

grep -q "archive-unused-daytona-sandboxes.py" "$BUMP" \
  || fail "snapshot bump runbook still points only at the old apply-everything script"
pass "snapshot bump runbook points at the keep-set script"

log "all checks passed"
