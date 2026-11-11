#!/usr/bin/env bash
# Offline smoke: Hermes admin/contributor profile seeds and elevation block.
#
# Usage (from repo root):
#   bash scripts/smoke-hermes-profiles.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BOOTSTRAP="$ROOT/scripts/bootstrap-host.sh"
ENSURE="$ROOT/scripts/ensure-hermes-profiles.sh"
SEED_DIR="$ROOT/scripts/hermes-profiles"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

[ -f "$BOOTSTRAP" ] || fail "missing $BOOTSTRAP"
[ -f "$ENSURE" ] || fail "missing $ENSURE"
[ -f "$SEED_DIR/admin.json" ] || fail "missing admin seed template"
[ -f "$SEED_DIR/contributor.json" ] || fail "missing contributor seed template"

# shellcheck disable=SC1090
BOOTSTRAP_HOST_LIB_ONLY=1 source "$BOOTSTRAP"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/cb-hermes-profiles-smoke.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

# --- checked-in seeds: contributor must lack admin-only caps ---
verify_contributor_not_elevated "$SEED_DIR/contributor.json" || fail "checked-in contributor seed elevated"
grep -Eq '"profile_manage"|"system_ops"|"vault_full"' "$SEED_DIR/admin.json" \
  || fail "checked-in admin seed missing admin-only caps"
pass "checked-in seed templates: contributor not elevated; admin has ops caps"

# --- write seeds into a fake HERMES_HOME ---
export HERMES_HOME="$TMP/hermes-home"
mkdir -p "$HERMES_HOME"
ensure_hermes_profiles "$HERMES_HOME"
[ -f "$HERMES_HOME/profiles/admin.json" ] || fail "admin.json not written"
[ -f "$HERMES_HOME/profiles/contributor.json" ] || fail "contributor.json not written"
verify_contributor_not_elevated "$HERMES_HOME/profiles/contributor.json" \
  || fail "written contributor seed elevated"
pass "ensure_hermes_profiles writes admin + contributor under HERMES_HOME/profiles"

# --- ensure script CLI path ---
export HERMES_HOME="$TMP/hermes-home-cli"
mkdir -p "$HERMES_HOME"
bash "$ENSURE" --hermes-home "$HERMES_HOME" --require
[ -f "$HERMES_HOME/profiles/admin.json" ] || fail "ensure script missing admin"
[ -f "$HERMES_HOME/profiles/contributor.json" ] || fail "ensure script missing contributor"
pass "ensure-hermes-profiles.sh --require succeeds"

# --- elevation attempt blocked: inject admin-only cap into contributor and verify ---
BAD="$TMP/bad-contributor.json"
cp "$SEED_DIR/contributor.json" "$BAD"
# Inject forbidden capability (simulates unauthorized role elevation)
if command -v python3 >/dev/null 2>&1; then
  python3 - "$BAD" <<'PY'
import json, sys
path = sys.argv[1]
with open(path) as f:
    data = json.load(f)
data["capabilities"].append("profile_manage")
with open(path, "w") as f:
    json.dump(data, f)
PY
else
  # Fallback: crude inject
  sed -i 's/"chat"/"chat", "profile_manage"/' "$BAD"
fi
if ( verify_contributor_not_elevated "$BAD" ) >/dev/null 2>&1; then
  fail "expected elevation detection for profile_manage on contributor"
fi
pass "unauthorized contributor elevation (profile_manage) blocked"

for cap in system_ops shell_exec gateway_config beads_admin vault_full; do
  BAD2="$TMP/bad-$cap.json"
  printf '%s\n' "{\"name\":\"contributor\",\"capabilities\":[\"vault_read\",\"$cap\"]}" >"$BAD2"
  if ( verify_contributor_not_elevated "$BAD2" ) >/dev/null 2>&1; then
    fail "expected elevation detection for $cap"
  fi
done
pass "all admin-only capabilities blocked on contributor"

# --- capability boundary matrix ---
ADMIN_CAPS="$(tr -d '\n' <"$SEED_DIR/admin.json")"
CONTRIB_CAPS="$(tr -d '\n' <"$SEED_DIR/contributor.json")"
echo "$ADMIN_CAPS" | grep -q 'vault_full' || fail "admin must have vault_full"
echo "$CONTRIB_CAPS" | grep -q 'vault_full' && fail "contributor must not have vault_full"
echo "$CONTRIB_CAPS" | grep -q 'vault_write' || fail "contributor must have vault_write"
pass "capability boundary matrix admin ⊃ contributor (no elevation)"

echo
echo "All Hermes profile RBAC smoke checks passed."
