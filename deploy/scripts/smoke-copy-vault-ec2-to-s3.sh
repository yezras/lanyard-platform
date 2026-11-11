#!/usr/bin/env bash
# Offline smoke for copy-vault-ec2-to-s3.sh (lp-3ux).
#
# Builds local fixture dirs, runs --dry-run + --execute --verify, checks
# file count + sha256 equality, and proves mismatch detection.
# No AWS credentials, no network, no live EC2.
#
# Usage (from repo root):
#   bash deploy/scripts/smoke-copy-vault-ec2-to-s3.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/deploy/scripts/copy-vault-ec2-to-s3.sh"
DOC="$ROOT/docs/plans/0008-daytona-agent-sandboxes/vault-ec2-to-s3-copy.md"
DUAL="$ROOT/docs/plans/0008-daytona-agent-sandboxes/dual-run-runtime-kind.md"

fail() { echo "[smoke-copy-vault-ec2-to-s3] FAIL: $*" >&2; exit 1; }
pass() { echo "[smoke-copy-vault-ec2-to-s3] PASS: $*"; }
log() { echo "[smoke-copy-vault-ec2-to-s3] $*"; }

[[ -f "$SCRIPT" ]] || fail "missing $SCRIPT"
[[ -f "$DOC" ]] || fail "missing runbook $DOC"
bash -n "$SCRIPT" || fail "bash -n copy-vault-ec2-to-s3.sh"
pass "script syntax + runbook present"

# Runbook must cover acceptance axes
for needle in \
  "lp-3ux" \
  "checksum" \
  "file count" \
  "Rollback" \
  "dry-run" \
  "--execute" \
  "freeze" \
  "residual" \
  "tenants/" \
  "copy-vault-ec2-to-s3.sh"
do
  grep -qi -- "$needle" "$DOC" || fail "runbook missing required coverage: $needle"
done
pass "runbook covers dry-run, verify, freeze, rollback, residual"

grep -qF "lp-3ux" "$DUAL" || fail "dual-run doc missing lp-3ux pointer"
grep -qF "vault-ec2-to-s3-copy.md" "$DUAL" || fail "dual-run doc missing runbook link"
pass "dual-run doc links vault copy runbook"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/lp-3ux-smoke.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

SRC="$TMP/ec2-vault"
DST="$TMP/s3-mirror"
MAN="$TMP/manifests"
mkdir -p \
  "$SRC/Projects/Legal" \
  "$SRC/Projects/Operations/Sub" \
  "$SRC/Knowledge/Company" \
  "$SRC/.seed"

printf 'legal memo body\n' >"$SRC/Projects/Legal/memo.md"
printf 'ops runbook\n' >"$SRC/Projects/Operations/runbook.md"
printf 'nested detail\n' >"$SRC/Projects/Operations/Sub/detail.md"
printf 'handbook snippet\n' >"$SRC/Knowledge/Company/handbook.md"
printf 'seeded=1\n' >"$SRC/.seed/demo-vault.seeded"
# empty dir should not affect file count
mkdir -p "$SRC/empty-dir"

EXPECTED_COUNT=5

# --- dry-run (no dest writes) ---
log "dry-run against fixtures..."
OUT="$TMP/dry-run.out"
bash "$SCRIPT" \
  --source "$SRC" \
  --dest-local "$DST" \
  --manifest-dir "$MAN/dry" \
  --dry-run >"$OUT" 2>&1 || {
  cat "$OUT" >&2
  fail "dry-run exited non-zero"
}
grep -q 'mode=dry-run' "$OUT" || fail "dry-run output missing mode=dry-run"
grep -q "source_file_count=${EXPECTED_COUNT}" "$OUT" || fail "dry-run wrong file count"
[[ ! -d "$DST" ]] || [[ -z "$(find "$DST" -type f 2>/dev/null | head -1)" ]] \
  || fail "dry-run must not write dest files"
[[ -f "$MAN/dry/dry-run-summary.txt" ]] || fail "missing dry-run-summary.txt"
[[ -f "$MAN/dry/source.sha256" ]] || fail "missing source manifest from dry-run"
pass "dry-run: planned ${EXPECTED_COUNT} files, no dest writes, summary emitted"

# --- employee-vault refuse ---
if bash "$SCRIPT" --source "$TMP/Lanyard" --dest-local "$DST" --dry-run >/dev/null 2>&1; then
  # create fake Lanyard and re-test
  :
fi
mkdir -p "$TMP/Lanyard/x"
echo y >"$TMP/Lanyard/x/f.txt"
if bash "$SCRIPT" --source "$TMP/Lanyard" --dest-local "$DST" --dry-run >/dev/null 2>&1; then
  fail "expected refuse on employee-vault-like /Lanyard source"
fi
pass "refuses employee-vault-like source paths"

# --- bad prefix shape (S3 dry-run, no AWS) ---
if bash "$SCRIPT" \
  --source "$SRC" \
  --bucket lanyard-mocklab-vault-123456789012 \
  --prefix "bad/prefix/" \
  --dry-run >/dev/null 2>&1; then
  fail "expected refuse on non-canonical S3 prefix"
fi
pass "refuses non-canonical S3 prefix"

# S3 dry-run (no AWS calls)
OUT_S3="$TMP/dry-s3.out"
bash "$SCRIPT" \
  --source "$SRC" \
  --s3-uri "s3://lanyard-mocklab-vault-123456789012/tenants/mocklab/vault/" \
  --manifest-dir "$MAN/dry-s3" \
  --dry-run >"$OUT_S3" 2>&1 || {
  cat "$OUT_S3" >&2
  fail "S3 dry-run exited non-zero"
}
grep -q 'live AWS not invoked' "$OUT_S3" || fail "S3 dry-run should state AWS not invoked"
pass "S3 dry-run offline-safe (no AWS)"

# --- execute + verify (local dest) ---
log "execute + verify against local dest..."
OUT_X="$TMP/execute.out"
bash "$SCRIPT" \
  --source "$SRC" \
  --dest-local "$DST" \
  --manifest-dir "$MAN/exec" \
  --execute --verify >"$OUT_X" 2>&1 || {
  cat "$OUT_X" >&2
  fail "execute+verify exited non-zero"
}
grep -q 'file count match' "$OUT_X" || fail "missing file count match line"
grep -q 'sha256 manifest match' "$OUT_X" || fail "missing sha256 match line"
[[ -f "$DST/Projects/Legal/memo.md" ]] || fail "dest missing memo.md"
[[ -f "$DST/Projects/Operations/Sub/detail.md" ]] || fail "dest missing nested detail"
[[ -f "$MAN/exec/verify-report.txt" ]] || fail "missing verify-report.txt"
grep -q 'result=PASS' "$MAN/exec/verify-report.txt" || fail "verify-report not PASS"
# content identity
cmp -s "$SRC/Projects/Legal/memo.md" "$DST/Projects/Legal/memo.md" || fail "memo content mismatch"
pass "execute+verify: count=${EXPECTED_COUNT}, checksums match, content identical"

# --- mismatch detection (verify-only; no re-copy) ---
log "proving checksum mismatch detection..."
printf 'tampered-after-copy\n' >"$DST/Projects/Legal/memo.md"
if bash "$SCRIPT" \
  --source "$SRC" \
  --dest-local "$DST" \
  --manifest-dir "$MAN/mismatch" \
  --verify-only >/dev/null 2>&1; then
  fail "expected verify-only to fail on tampered dest"
fi
pass "verify-only detects checksum mismatch"

# Restore dest for idempotent re-execute
bash "$SCRIPT" \
  --source "$SRC" \
  --dest-local "$DST" \
  --manifest-dir "$MAN/restore" \
  --execute --verify >/dev/null

# --- idempotent re-execute ---
bash "$SCRIPT" \
  --source "$SRC" \
  --dest-local "$DST" \
  --manifest-dir "$MAN/idem" \
  --execute --verify >/dev/null
pass "idempotent re-execute still verifies"

# --- evidence blob for residual / PR ---
EVIDENCE="$TMP/evidence.txt"
{
  echo "bead=lp-3ux"
  echo "mode=offline-fixture"
  echo "source_file_count=${EXPECTED_COUNT}"
  echo "dry_run=PASS"
  echo "execute_verify=PASS"
  echo "mismatch_detection=PASS"
  echo "aws_invoked=0"
  echo "timestamp_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >"$EVIDENCE"
log "evidence:"
cat "$EVIDENCE"
# Copy evidence into repo-relative tmp is not needed; stdout is enough.
# Also assert help exits 0
bash "$SCRIPT" --help >/dev/null

pass "lp-3ux offline smoke complete (fixtures only; live lab residual in runbook)"
