#!/usr/bin/env bash
# Offline smoke: Omnibox Mode A policy seeds + ensure --dry-run + wrapper contract.
#
# Usage (from repo root):
#   bash scripts/smoke-omnibox.sh
#
# Fails closed if policy seeds are missing. Does not require root, bwrap install,
# or live host mutations. No secrets in repo paths.
#
# Bead: cbd-o9s.9
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENSURE="$ROOT/scripts/ensure-omnibox.sh"
OMNIBOX_DIR="$ROOT/scripts/omnibox"
WRAPPER="$OMNIBOX_DIR/run-under-omnibox.sh"
ADMIN="$OMNIBOX_DIR/admin.yaml"
CONTRIB="$OMNIBOX_DIR/contributor.yaml"
README="$OMNIBOX_DIR/README.md"
SPIKE="$ROOT/references/runbooks/omnibox-mode-a-spike.md"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# --- artifacts present ---
[ -f "$ENSURE" ] || fail "missing $ENSURE"
[ -f "$WRAPPER" ] || fail "missing $WRAPPER"
[ -x "$WRAPPER" ] || [ -r "$WRAPPER" ] || fail "wrapper not readable: $WRAPPER"
[ -f "$ADMIN" ] || fail "missing policy seed: $ADMIN"
[ -f "$CONTRIB" ] || fail "missing policy seed: $CONTRIB"
[ -f "$README" ] || fail "missing $README"
[ -f "$SPIKE" ] || fail "missing spike runbook: $SPIKE"
pass "omnibox artifacts present (ensure, wrapper, admin/contributor seeds, README, spike)"

# --- shell syntax ---
bash -n "$ENSURE" || fail "bash -n ensure-omnibox.sh"
bash -n "$WRAPPER" || fail "bash -n run-under-omnibox.sh"
pass "shell syntax ok (ensure + wrapper)"

# --- policy seed contracts ---
for role in admin contributor; do
  f="$OMNIBOX_DIR/${role}.yaml"
  grep -Eq "^profile:[[:space:]]*${role}[[:space:]]*$" "$f" \
    || fail "$role seed missing profile: $role"
  grep -Eq '^backend:[[:space:]]*bwrap_inrepo' "$f" \
    || fail "$role seed must use backend: bwrap_inrepo"
  grep -Eq 'never_grant:' "$f" || fail "$role seed missing never_grant"
  grep -Eq 'unshare_net:[[:space:]]*true' "$f" \
    || fail "$role seed must set network.unshare_net: true"
  grep -Fq '169.254.169.254' "$f" || fail "$role seed must block IMDS"
done
pass "policy seeds: profile/backend/never_grant/network baseline"

# Contributor .env deny (required offline smoke signal)
grep -Fq '/home/hermes/.hermes/.env' "$CONTRIB" \
  || fail "contributor never_grant must include /home/hermes/.hermes/.env"
grep -Eq '\.env' "$CONTRIB" || fail "contributor never_grant must mention .env"
grep -Eq 'path_prefixes_only:[[:space:]]*true' "$CONTRIB" \
  || fail "contributor must set path_prefixes_only: true"
grep -Eq 'expected:[[:space:]]*false' "$CONTRIB" \
  || fail "contributor shell.expected must be false"
pass "contributor stricter: .env deny + path_prefixes_only + shell not expected"

# Admin grants + shell expected
grep -Fq '/opt/company-brain' "$ADMIN" || fail "admin must grant /opt/company-brain"
grep -Eq 'expected:[[:space:]]*true' "$ADMIN" || fail "admin shell.expected must be true"
grep -Fq '/var/lib/company-brain/omnibox/workspaces/admin' "$ADMIN" \
  || fail "admin must grant admin workspace path"
pass "admin grants vault + workspace; shell expected"

# --- no secrets in omnibox repo paths ---
secret_hits=0
while IFS= read -r -d '' f; do
  if grep -Eiq '(api[_-]?key[[:space:]]*[:=]|secret_key[[:space:]]*[:=]|password[[:space:]]*[:=]|BEGIN (RSA |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16})' "$f"; then
    echo "FAIL: secret-like material in $f" >&2
    secret_hits=1
  fi
done < <(find "$OMNIBOX_DIR" -type f \( -name '*.yaml' -o -name '*.sh' -o -name '*.md' \) -print0 2>/dev/null)
[ "$secret_hits" -eq 0 ] || fail "secrets detected under scripts/omnibox/"
# Ensure script itself must not embed live credentials
if grep -Eiq '(AKIA[0-9A-Z]{16}|BEGIN (RSA |OPENSSH )?PRIVATE KEY)' "$ENSURE"; then
  fail "ensure-omnibox.sh contains secret-like material"
fi
pass "no secrets in scripts/omnibox/ or ensure-omnibox.sh"

# --- wrapper CLI / env contract ---
grep -q -- '--profile' "$WRAPPER" || fail "wrapper missing --profile"
grep -q 'OMNIBOX_WRAPPER' "$WRAPPER" || fail "wrapper must document OMNIBOX_WRAPPER"
grep -q 'bwrap_inrepo\|bubblewrap\|bwrap' "$WRAPPER" || fail "wrapper must reference bwrap backend"
grep -q '/usr/local/sbin/run-under-omnibox' "$WRAPPER" \
  || fail "wrapper must document install path /usr/local/sbin/run-under-omnibox"
grep -Eiq 'omnigent server|Mode B' "$WRAPPER" && {
  # Must not *require* Omnigent server; mention as non-goal is OK
  grep -Eiq 'Does NOT require Omnigent|not require Omnigent|no Omnigent' "$WRAPPER" \
    || fail "wrapper must not require Omnigent server"
}
pass "wrapper CLI + OMNIBOX_WRAPPER install contract"

# --- README mapping ---
grep -q 'admin.yaml' "$README" || fail "README missing admin.yaml mapping"
grep -q 'contributor.yaml' "$README" || fail "README missing contributor.yaml mapping"
grep -q '/usr/local/sbin/run-under-omnibox' "$README" \
  || fail "README missing host wrapper install path"
pass "README maps profiles + install targets"

# --- tool choice locked (spike) ---
grep -Eq 'bwrap_inrepo' "$SPIKE" || fail "spike runbook missing bwrap_inrepo tool lock"
pass "spike tool choice bwrap_inrepo present"

# --- ensure --dry-run (no root mutations) ---
out="$(bash "$ENSURE" --dry-run 2>&1)" || fail "ensure-omnibox --dry-run failed: $out"
echo "$out" | grep -q 'Policy seeds OK' \
  || fail "dry-run missing seed validation OK"
echo "$out" | grep -q 'DRY-RUN: would install' \
  || fail "dry-run missing install plan lines"
echo "$out" | grep -q '/etc/company-brain/omnibox' \
  || fail "dry-run missing policy dest /etc/company-brain/omnibox"
echo "$out" | grep -q '/usr/local/sbin/run-under-omnibox' \
  || fail "dry-run missing wrapper dest"
echo "$out" | grep -q '/var/lib/company-brain/omnibox' \
  || fail "dry-run missing workspace root"
echo "$out" | grep -q 'DRY-RUN: would mkdir' \
  || fail "dry-run missing workspace mkdir plan"
# Must not have performed live package install when dry-run
echo "$out" | grep -Eq 'Installed bubblewrap:|Installed policies →|Installed wrapper →' \
  && fail "dry-run appears to have performed live install"
pass "ensure-omnibox.sh --dry-run (seeds + layout; no live mutations)"

# --- ensure --dry-run --require ---
out_req="$(bash "$ENSURE" --dry-run --require 2>&1)" \
  || fail "ensure-omnibox --dry-run --require failed: $out_req"
echo "$out_req" | grep -q 'Policy seeds OK' \
  || fail "--require dry-run missing seed OK"
pass "ensure-omnibox.sh --dry-run --require succeeds with seeds present"

# --- ENABLE_OMNIBOX=0 path (skip install, still validates when dry-run shows layout) ---
out_off="$(ENABLE_OMNIBOX=0 bash "$ENSURE" --dry-run 2>&1)" \
  || fail "ENABLE_OMNIBOX=0 --dry-run failed: $out_off"
echo "$out_off" | grep -q 'Policy seeds OK' \
  || fail "ENABLE_OMNIBOX=0 dry-run must still validate seeds"
pass "ENABLE_OMNIBOX=0 --dry-run still validates seeds"

# --- fail closed if seeds missing ---
TMP="$(mktemp -d "${TMPDIR:-/tmp}/cb-omnibox-smoke.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

empty_seeds="$TMP/empty-omnibox"
mkdir -p "$empty_seeds"
# No yaml seeds — must fail
if bash "$ENSURE" --dry-run --seed-dir "$empty_seeds" --require >/dev/null 2>&1; then
  fail "expected ensure --dry-run --require to fail when seeds missing"
fi
pass "ensure fails closed when seeds missing (--seed-dir empty)"

# Rename-style: seed dir with only README, no policies
partial="$TMP/partial-omnibox"
mkdir -p "$partial"
echo '# no policies' >"$partial/README.md"
if out_miss="$(bash "$ENSURE" --dry-run --seed-dir "$partial" 2>&1)"; then
  fail "expected ensure to fail when admin/contributor yaml missing; got: $out_miss"
fi
echo "$out_miss" | grep -Eqi 'Missing policy seed|Seed validation failed|Missing wrapper' \
  || fail "missing-seed error message unclear: $out_miss"
pass "ensure fails closed when policy yaml seeds absent"

# Smoke itself must fail if primary seeds vanish (simulate via OMNIBOX_DIR override pattern)
# Direct check: missing file detection path used at top of this script
if [ ! -f "$ADMIN" ]; then
  fail "admin seed disappeared mid-smoke"
fi
# Explicit secondary check matching acceptance: temp-hide would break smoke entry checks
hidden_probe="$TMP/hide-probe"
mkdir -p "$hidden_probe"
cp "$CONTRIB" "$hidden_probe/contributor.yaml"
# Only contributor present — admin missing
if bash "$ENSURE" --dry-run --seed-dir "$hidden_probe" 2>/dev/null; then
  fail "expected fail when admin.yaml missing"
fi
pass "ensure fails closed if admin seed missing (contributor alone insufficient)"

# --- wrapper help / unknown profile (no bwrap needed for CLI parse) ---
if bash "$WRAPPER" --help >/dev/null 2>&1; then
  pass "wrapper --help exits 0"
else
  fail "wrapper --help failed"
fi
if bash "$WRAPPER" --profile not-a-role -- true >/dev/null 2>&1; then
  fail "wrapper must reject unknown profile"
fi
pass "wrapper rejects unknown profile"

# Unknown profile path needs -- before command per CLI
if bash "$WRAPPER" --profile bogon -- /bin/true >/dev/null 2>&1; then
  fail "wrapper must reject profile bogon"
fi
pass "wrapper rejects profile bogon"

# --- phase 4: bootstrap flag + systemd env (cbd-o9s.10); no CI workflow edits here ---
BOOT="$ROOT/scripts/bootstrap-host.sh"
UNIT="$ROOT/modules/company-brain-ec2/systemd/hermes-gateway.service"
DROPIN="$ROOT/modules/company-brain-ec2/systemd/hermes-gateway.service.d/omnibox.conf"
EC2_VARS="$ROOT/modules/company-brain-ec2/variables.tf"
TENANT_EX="$ROOT/templates/tenant/terraform.tfvars.example"
USER_DATA="$ROOT/modules/company-brain-ec2/user_data.sh.tftpl"

[ -f "$BOOT" ] || fail "missing bootstrap-host.sh"
grep -q 'ensure_omnibox_mode_a' "$BOOT" || fail "bootstrap must call ensure_omnibox_mode_a when enabled"
grep -q 'ENABLE_OMNIBOX' "$BOOT" || fail "bootstrap must honor ENABLE_OMNIBOX"
# Gateway product must stay Hermes — never Omnigent server ExecStart
grep -Eq 'ExecStart=.*/hermes gateway' "$UNIT" \
  || fail "hermes-gateway.service ExecStart must remain hermes gateway binary family"
if grep -Eiq 'ExecStart=.*omnigent' "$UNIT" "$DROPIN" 2>/dev/null; then
  fail "Omnigent must not replace hermes-gateway ExecStart"
fi
[ -f "$DROPIN" ] || fail "missing omnibox systemd drop-in: $DROPIN"
grep -q 'OMNIBOX_ENABLED' "$DROPIN" || fail "drop-in missing OMNIBOX_ENABLED"
grep -q 'OMNIBOX_CONFIG_DIR' "$DROPIN" || fail "drop-in missing OMNIBOX_CONFIG_DIR"
grep -q 'OMNIBOX_WRAPPER' "$DROPIN" || fail "drop-in missing OMNIBOX_WRAPPER"
grep -q 'EnvironmentFile=-/etc/company-brain/omnibox.env' "$DROPIN" \
  || fail "drop-in must EnvironmentFile omnibox.env"
# enable_omnibox default false
grep -A12 'variable "enable_omnibox"' "$EC2_VARS" | grep -Eq 'default[[:space:]]*=[[:space:]]*false' \
  || fail "enable_omnibox must default false in company-brain-ec2"
grep -Eq 'enable_omnibox[[:space:]]*=[[:space:]]*false' "$TENANT_EX" \
  || fail "tenant terraform.tfvars.example must set enable_omnibox = false"
grep -q 'enable_omnibox' "$USER_DATA" || fail "user_data must wire enable_omnibox → pins/env"
grep -q 'OMNIBOX_ENABLED' "$USER_DATA" || fail "user_data must seed OMNIBOX_ENABLED"
pass "phase 4: enable_omnibox default false; systemd OMNIBOX_*; ExecStart stays hermes; bootstrap hooks ensure"

# Offline: ENABLE_OMNIBOX=0 path through bootstrap function (lib-only source)
out_boot_off="$(
  BOOTSTRAP_HOST_LIB_ONLY=1 bash -c '
    set -euo pipefail
    # shellcheck source=/dev/null
    source "'"$BOOT"'"
    ENABLE_OMNIBOX=0
    ensure_omnibox_mode_a
  ' 2>&1
)" || fail "ensure_omnibox_mode_a with ENABLE_OMNIBOX=0 failed: $out_boot_off"
echo "$out_boot_off" | grep -Eqi 'skipped|default false' \
  || fail "ENABLE_OMNIBOX=0 should log skip: $out_boot_off"
pass "bootstrap ensure_omnibox_mode_a skips when ENABLE_OMNIBOX=0"

# Flag true discovers monorepo ensure script (dry-run via PATH override of ensure by running real ensure dry-run is heavy;
# here: ENABLE_OMNIBOX=1 with ENSURE_OMNIBOX_SCRIPT pointing at ensure + force non-root dry path is complex.
# Assert call site + script discovery string only when script present.
grep -q 'ensure-omnibox' "$BOOT" || fail "bootstrap must reference ensure-omnibox"
pass "bootstrap references ensure-omnibox for flag-true path"

# --- phase 5: Hermes hook contract + argv builder (cbd-o9s.11); no product binary ---
HOOK_DOC="$ROOT/references/omnibox-mode-a-hermes-hook.md"
HOST_TOOLS="$OMNIBOX_DIR/host-impacting-tools.json"
ARGV_BUILDER="$OMNIBOX_DIR/build-shell-exec-argv.py"

[ -f "$HOOK_DOC" ] || fail "missing Hermes hook contract: $HOOK_DOC"
grep -q 'OMNIBOX_ENABLED' "$HOOK_DOC" || fail "hook contract must document OMNIBOX_ENABLED"
grep -q 'run-under-omnibox' "$HOOK_DOC" || fail "hook contract must reference run-under-omnibox"
# lp-uxy.6: HL product wrap landed (cbd-o9s.17); residual honesty = default OFF + LA gap + shared kernel
grep -Eqi 'hermes-lanyard|cbd-o9s\.17|product wrap' "$HOOK_DOC" \
  || fail "hook contract must document hermes-lanyard product wrap status"
grep -Eqi 'residual|default OFF|OMNIBOX_ENABLED=0' "$HOOK_DOC" \
  || fail "hook contract must state residual / default-off honestly"
grep -q 'shell_exec' "$HOOK_DOC" || fail "hook contract must cover shell_exec"
grep -Eqi 'vault' "$HOOK_DOC" || fail "hook contract must cover vault-only tools skip"
pass "phase 5: hermes hook contract present with residual honesty"

[ -f "$HOST_TOOLS" ] || fail "missing $HOST_TOOLS"
grep -Eq '"shell_exec"' "$HOST_TOOLS" || fail "host-impacting registry must list shell_exec"
grep -Eq '"vault_read"' "$HOST_TOOLS" || fail "host-impacting registry must list vault_only vault_read"
pass "host-impacting-tools.json lists shell_exec + vault_only"

[ -f "$ARGV_BUILDER" ] || fail "missing $ARGV_BUILDER"
python3 -m py_compile "$ARGV_BUILDER" || fail "build-shell-exec-argv.py compile failed"
python3 "$ARGV_BUILDER" --self-test || fail "build-shell-exec-argv --self-test failed"

# Explicit offline fixture: contributor session → --profile contributor in argv
contrib_json="$(
  python3 "$ARGV_BUILDER" --stdin-json <<'JSON'
{
  "omnibox_enabled": true,
  "wrapper": "/usr/local/sbin/run-under-omnibox",
  "tool": "shell_exec",
  "session": {"profile": "contributor", "path_prefixes": ["/Projects/Legal"]},
  "command": ["cat", "note.md"]
}
JSON
)" || fail "contributor argv build failed: $contrib_json"
echo "$contrib_json" | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert d.get("wrap") is True, d
assert d.get("error") is None, d
argv=d["argv"]
assert "--profile" in argv and argv[argv.index("--profile")+1]=="contributor", argv
assert "--path-prefix" in argv and "/Projects/Legal" in argv, argv
assert argv[0]=="/usr/local/sbin/run-under-omnibox", argv
' || fail "contributor session must produce wrapper argv with --profile contributor: $contrib_json"
pass "contributor session → run-under-omnibox --profile contributor"

# Hook only when OMNIBOX_ENABLED
off_json="$(
  python3 "$ARGV_BUILDER" --stdin-json <<'JSON'
{
  "omnibox_enabled": false,
  "wrapper": "/usr/local/sbin/run-under-omnibox",
  "tool": "shell_exec",
  "session": {"profile": "admin"},
  "command": ["id"]
}
JSON
)" || fail "disabled argv build failed"
echo "$off_json" | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert d.get("wrap") is False and d.get("argv")==["id"], d
' || fail "OMNIBOX_ENABLED=0 must not wrap: $off_json"
pass "hook only when OMNIBOX_ENABLED (disabled = passthrough)"

# Vault-only skip
vault_json="$(
  python3 "$ARGV_BUILDER" --stdin-json <<'JSON'
{
  "omnibox_enabled": true,
  "wrapper": "/usr/local/sbin/run-under-omnibox",
  "tool": "vault_read",
  "session": {"profile": "admin"},
  "command": ["unused"]
}
JSON
)" || fail "vault argv build failed"
echo "$vault_json" | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert d.get("wrap") is False, d
assert d.get("reason")=="vault_or_non_host_tool", d
' || fail "vault_read must not wrap: $vault_json"
pass "vault-only tools skip Omnibox"

# Drop-in exposes argv builder env for product hook
grep -q 'OMNIBOX_ARGV_BUILDER' "$DROPIN" || fail "drop-in missing OMNIBOX_ARGV_BUILDER"
grep -q 'omnibox-build-shell-exec-argv' "$DROPIN" \
  || fail "drop-in must point OMNIBOX_ARGV_BUILDER at omnibox-build-shell-exec-argv"
# ensure dry-run mentions hook install
echo "$out" | grep -q 'host-impacting-tools.json\|argv helper\|OMNIBOX_ARGV_BUILDER\|build-shell-exec' \
  || fail "ensure dry-run should plan hook registry/argv builder install"
pass "phase 5: argv builder self-test + systemd OMNIBOX_ARGV_BUILDER + ensure dry-run"

echo
echo "All Omnibox Mode A smoke checks passed."
