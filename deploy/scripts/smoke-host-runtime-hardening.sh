#!/usr/bin/env bash
# Offline smoke: host/runtime hardening unit directives + dry-run user path.
# Aligns with company-brain-backend.service (lp-k7g.10.4 / lp-k7g.7.5).
#
# Usage (from deploy/ root):
#   bash scripts/smoke-host-runtime-hardening.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENSURE="$ROOT/scripts/ensure-runtime-hardening.sh"
UNIT="$ROOT/modules/company-brain-ec2/systemd/company-brain-backend.service"
DROPIN="$ROOT/modules/company-brain-ec2/systemd/company-brain-backend.service.d/sandbox.conf"
LEGACY_UNIT="$ROOT/modules/company-brain-ec2/systemd/hermes-gateway.service"
SETUP="$ROOT/modules/company-brain-ec2/setup.sh"
ADMIN_TOOLS="$ROOT/scripts/tool-allowlists/admin.json"
CONTRIB_TOOLS="$ROOT/scripts/tool-allowlists/contributor.json"
RUNBOOK="$ROOT/references/runbooks/host-runtime-hardening.md"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

[ -f "$ENSURE" ] || fail "missing $ENSURE"
[ -f "$UNIT" ] || fail "missing $UNIT"
[ -f "$DROPIN" ] || fail "missing $DROPIN"
[ -f "$SETUP" ] || fail "missing $SETUP"
[ -f "$ADMIN_TOOLS" ] || fail "missing $ADMIN_TOOLS"
[ -f "$CONTRIB_TOOLS" ] || fail "missing $CONTRIB_TOOLS"
[ -f "$RUNBOOK" ] || fail "missing $RUNBOOK"

bash -n "$ENSURE" || fail "bash -n ensure-runtime-hardening.sh"
bash -n "$SETUP" || fail "bash -n setup.sh"
pass "shell syntax ok"

# --- generic unit sandbox directives ---
for d in \
  'User=company-brain' \
  'NoNewPrivileges=true' \
  'ProtectSystem=strict' \
  'ProtectHome=true' \
  'PrivateTmp=true' \
  'RestrictSUIDSGID=true' \
  'ReadWritePaths='
do
  grep -qF "$d" "$UNIT" || fail "unit missing directive: $d"
done
grep -Eq '^User=root' "$UNIT" && fail "unit must not run as root"
grep -q 'ProtectSystem=strict' "$DROPIN" || fail "drop-in missing ProtectSystem"

# Contract entrypoint (lp-k7g.7.5 / lp-k7g.10.4)
grep -Eq '^ExecStart=.*/opt/company-brain-backend/current/bin/company-brain-backend gateway' "$UNIT" \
  || fail "unit ExecStart must be /opt/company-brain-backend/current/bin/company-brain-backend gateway (got: $(grep -E '^ExecStart=' "$UNIT" || true))"
grep -qF 'ExecStart=/opt/company-brain-backend/current/bin/company-brain-backend gateway' "$UNIT" \
  || fail "unit ExecStart must be /opt/company-brain-backend/current/bin/company-brain-backend gateway"
grep -Eq 'BACKEND_INSTALL_PATH=/opt/company-brain-backend/current' "$UNIT" \
  || fail "unit missing BACKEND_INSTALL_PATH=/opt/company-brain-backend/current"
grep -Eq 'BACKEND_HOME=/var/lib/company-brain-backend' "$UNIT" \
  || fail "unit missing BACKEND_HOME=/var/lib/company-brain-backend"

# ReadWritePaths: BACKEND_HOME + vault; install tree must NOT be writable
RWP="$(grep -E '^ReadWritePaths=' "$UNIT" | head -n1)"
echo "$RWP" | grep -qF '/var/lib/company-brain-backend' \
  || fail "ReadWritePaths must include BACKEND_HOME (/var/lib/company-brain-backend)"
echo "$RWP" | grep -qF '/opt/company-brain' \
  || fail "ReadWritePaths must include VAULT_ROOT (/opt/company-brain)"
if echo "$RWP" | grep -qE '/opt/company-brain-backend(/| |$)'; then
  fail "ReadWritePaths must not grant write to install tree /opt/company-brain-backend"
fi
pass "systemd unit + drop-in sandbox directives present"
pass "company-brain-backend ExecStart is /opt/company-brain-backend/current/bin/company-brain-backend gateway"
pass "ReadWritePaths includes BACKEND_HOME + vault; install tree excluded"

# Legacy hermes-gateway unit still present as migration artifact (optional)
if [ -f "$LEGACY_UNIT" ]; then
  pass "legacy hermes-gateway.service present (migration)"
else
  pass "legacy hermes-gateway.service absent (greenfield-only tree)"
fi

# --- tool allowlists align with admin/contributor ---
grep -Eq '"shell_exec"' "$ADMIN_TOOLS" || fail "admin tools missing shell_exec"
grep -Eq '"deny"' "$CONTRIB_TOOLS" || fail "contributor tools missing deny"
for tool in shell_exec system_ops profile_manage gateway_config beads_admin; do
  grep -Eq "\"${tool}\"" "$CONTRIB_TOOLS" || fail "contributor tools should list $tool (deny)"
done
if command -v python3 >/dev/null 2>&1; then
  python3 - "$ADMIN_TOOLS" "$CONTRIB_TOOLS" <<'PY' || exit 1
import json, sys
admin = json.load(open(sys.argv[1]))
contrib = json.load(open(sys.argv[2]))
assert "shell_exec" in admin["tools"]["allow"], "admin allow missing shell_exec"
assert "shell_exec" in contrib["tools"]["deny"], "contributor deny missing shell_exec"
for t in ("shell_exec", "system_ops", "profile_manage", "gateway_config", "beads_admin"):
    assert t not in contrib["tools"]["allow"], f"contributor allow must not include {t}"
print("json tool allowlist structure ok")
PY
else
  pass "python3 missing — skipped JSON structural tool check"
fi
pass "tool allowlists align with admin/contributor profiles"

# --- runbook covers SELinux ---
grep -Eiq 'SELinux|permissive|enforcing' "$RUNBOOK" || fail "runbook missing SELinux guidance"
grep -Eiq 'AL2023|Amazon Linux' "$RUNBOOK" || fail "runbook missing AL2023 notes"
grep -Eiq 'tool allowlist|allowlist' "$RUNBOOK" || fail "runbook missing tool allowlist section"
# Prefer generic paths documented (lp-k7g.10.4)
grep -Eq 'company-brain-backend|BACKEND_HOME' "$RUNBOOK" \
  || fail "runbook should document company-brain-backend / BACKEND_HOME"
pass "runbook documents SELinux + tool allowlists + generic backend paths"

# --- setup.sh wires hardening ---
grep -q 'ensure-runtime-hardening\|runtime.hardening\|RUNTIME_HARDENING' "$SETUP" \
  || fail "setup.sh should invoke runtime hardening"
grep -Eq 'BACKEND_HOME|BACKEND_INSTALL' "$SETUP" \
  || fail "setup.sh should pass BACKEND_HOME / BACKEND_INSTALL_* to hardening"
pass "setup.sh references runtime hardening + backend paths"

# --- ensure script dry-run (user creation path, no root) ---
out="$(bash "$ENSURE" --dry-run 2>&1)" || fail "ensure-runtime-hardening --dry-run failed: $out"
echo "$out" | grep -q 'DRY-RUN: would ensure system user' \
  || fail "dry-run did not mention user creation"
echo "$out" | grep -q 'Unit sandbox directives OK' \
  || fail "dry-run missing unit check"
echo "$out" | grep -q 'Tool allowlist seeds OK' \
  || fail "dry-run missing tool allowlist check"
echo "$out" | grep -q 'would chmod 0600' \
  || fail "dry-run missing secrets 0600"
echo "$out" | grep -Eq 'backend_home=|/var/lib/company-brain-backend' \
  || fail "dry-run should mention BACKEND_HOME"
echo "$out" | grep -Eq 'backend_install|company-brain-backend' \
  || fail "dry-run should mention backend install path"
echo "$out" | grep -q 'would ensure BACKEND_HOME' \
  || fail "dry-run should own BACKEND_HOME"
pass "ensure-runtime-hardening.sh --dry-run (user + unit + allowlists + secrets + backend paths)"

# --- bootstrap mentions runtime user / ownership (if present) ---
BOOT="$ROOT/scripts/bootstrap-host.sh"
if grep -Eq 'RUNTIME_USER|ensure_runtime|runtime.hardening|hermes.*chown|BACKEND_HOME' "$BOOT"; then
  pass "bootstrap-host.sh includes runtime ownership hook"
else
  pass "bootstrap-host.sh leaves hardening to ensure/setup (size budget)"
fi

echo
echo "All host-runtime-hardening smoke checks passed."
