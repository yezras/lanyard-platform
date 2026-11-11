#!/usr/bin/env bash
# Offline smoke for scripts/seed-demo-vault.sh (tmpdir only; no host/AWS).
#
# Usage (from repo root):
#   bash scripts/smoke-seed-demo-vault.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEED="$ROOT/scripts/seed-demo-vault.sh"
SRC="$ROOT/artifacts/demo-vault"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

[ -f "$SEED" ] || fail "missing $SEED"
[ -d "$SRC/Projects/Legal" ] || fail "missing demo source Projects/Legal"
[ -d "$SRC/Projects/Operations" ] || fail "missing demo source Projects/Operations"
[ -f "$SRC/Clients/Active/Acme_Demo/AGENTS.md" ] || fail "missing Acme_Demo AGENTS.md"

bash -n "$SEED" || fail "bash -n seed-demo-vault.sh"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/cb-seed-demo-vault-smoke.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

VAULT="$TMP/vault"
mkdir -p "$VAULT"

# --- employee-vault refusal ---
if bash "$SEED" --vault-root "$TMP/Lanyard" --no-ownership >/dev/null 2>&1; then
  fail "expected refuse on path ending in /Lanyard"
fi
if bash "$SEED" --vault-root "$TMP/employee-vault" --no-ownership >/dev/null 2>&1; then
  fail "expected refuse on employee-vault path"
fi
pass "refuses employee-vault-like paths"

# --- first seed ---
bash "$SEED" --vault-root "$VAULT" --no-ownership >/dev/null
[ -f "$VAULT/Projects/Legal/memo.md" ] || fail "Legal/memo.md missing after seed"
[ -f "$VAULT/Projects/Operations/runbook.md" ] || fail "Operations/runbook.md missing"
[ -f "$VAULT/Projects/Operations/Subfolder/detail.md" ] || fail "Operations nested detail missing"
[ -f "$VAULT/Knowledge/Company/handbook-snippet.md" ] || fail "Knowledge snippet missing"
[ -f "$VAULT/Clients/Active/Acme_Demo/notes/2026-07-01-kickoff.md" ] || fail "Acme kickoff missing"
[ -f "$VAULT/.seed/demo-vault.seeded" ] || fail "seed marker missing"
grep -Fq 'company-brain-demo-vault' "$VAULT/Projects/Legal/memo.md" || fail "demo marker missing in memo"
pass "MVP tree seeded under tmp vault"

# --- idempotent re-run (no force) ---
echo "operator-edit" >"$VAULT/Projects/Legal/custom-note.md"
# Mutate a demo file to look like custom content without marker
printf 'custom non-demo body\n' >"$VAULT/Projects/Legal/memo.md"
bash "$SEED" --vault-root "$VAULT" --no-ownership >/dev/null
[ -f "$VAULT/Projects/Legal/custom-note.md" ] || fail "custom file should remain"
grep -Fq 'custom non-demo body' "$VAULT/Projects/Legal/memo.md" || fail "non-demo memo should not be overwritten without --force"
# Demo file with marker should still update path exists for AGENTS
[ -f "$VAULT/Projects/Legal/AGENTS.md" ] || fail "AGENTS.md should remain"
pass "idempotent: preserves non-demo content without --force"

# --- force overwrites ---
bash "$SEED" --vault-root "$VAULT" --no-ownership --force >/dev/null
grep -Fq 'company-brain-demo-vault' "$VAULT/Projects/Legal/memo.md" || fail "force should restore demo memo"
[ -f "$VAULT/Projects/Legal/custom-note.md" ] || fail "force should not delete unrelated custom files"
pass "force restores demo-managed files; keeps custom siblings"

# --- dry-run does not write new vault ---
EMPTY="$TMP/empty-vault"
mkdir -p "$EMPTY"
bash "$SEED" --vault-root "$EMPTY" --no-ownership --dry-run >/dev/null
# dry-run may mkdir root but should not write tree content files
if [ -f "$EMPTY/Projects/Legal/memo.md" ]; then
  fail "dry-run must not write content files"
fi
pass "dry-run writes no content files"

echo "OK: smoke-seed-demo-vault"
