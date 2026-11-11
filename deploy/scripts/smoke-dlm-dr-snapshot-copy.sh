#!/usr/bin/env bash
# Offline smoke: opt-in DLM cross-region / DR-account snapshot copy (cbd-mta.7.4).
# No AWS credentials, no terraform apply, no network.
#
# Validates:
#   - Fail-closed defaults (enable_cross_region_copy / enable_dr_account_share = false;
#     destination_region / dr_account_id = null)
#   - DLM policy uses dynamic cross_region_copy_rule + share_rule
#   - Cross-region copies always encrypted=true
#   - Production path still encrypts EBS + snapshot BPA defaults on
#   - No live 12-digit account IDs in committed examples
#   - Runbook documents RPO/RTO implications
#   - Tenant template wires flags; outputs expose non-secret summary
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EC2="$ROOT/modules/company-brain-ec2"
EC2_MAIN="$EC2/main.tf"
EC2_VARS="$EC2/variables.tf"
EC2_OUT="$EC2/outputs.tf"
EC2_EX="$EC2/terraform.tfvars.example"
TENANT_MAIN="$ROOT/templates/tenant/main.tf"
TENANT_VARS="$ROOT/templates/tenant/variables.tf"
TENANT_OUT="$ROOT/templates/tenant/outputs.tf"
TENANT_EX="$ROOT/templates/tenant/terraform.tfvars.example"
RUNBOOK="$ROOT/references/runbooks/dlm-restore-drill.md"
ISOLATION="$ROOT/references/tenant-isolation-decision.md"

err() { echo "[smoke-dlm-dr-snapshot-copy] ERROR: $*" >&2; }
log() { echo "[smoke-dlm-dr-snapshot-copy] $*"; }
fail() { err "$*"; exit 1; }
pass() { log "OK: $*"; }

need_file() { [ -f "$1" ] || fail "missing required file: $1"; }

for f in "$EC2_MAIN" "$EC2_VARS" "$EC2_OUT" "$EC2_EX" \
  "$TENANT_MAIN" "$TENANT_VARS" "$TENANT_OUT" "$TENANT_EX" \
  "$RUNBOOK" "$ISOLATION"; do
  need_file "$f"
done

# --- 1. Variables present with fail-closed defaults ---
for var in enable_cross_region_copy destination_region enable_dr_account_share dr_account_id; do
  grep -Eq "variable[[:space:]]+\"${var}\"" "$EC2_VARS" \
    || fail "company-brain-ec2 variables.tf missing $var"
done

default_false() {
  local var="$1" file="$2"
  if ! grep -A12 "variable \"${var}\"" "$file" | grep -Eq 'default[[:space:]]*=[[:space:]]*false'; then
    fail "${var} must default false in $(basename "$file")"
  fi
}

default_null() {
  local var="$1" file="$2"
  if ! grep -A12 "variable \"${var}\"" "$file" | grep -Eq 'default[[:space:]]*=[[:space:]]*null'; then
    fail "${var} must default null in $(basename "$file")"
  fi
}

default_false enable_cross_region_copy "$EC2_VARS"
default_false enable_dr_account_share "$EC2_VARS"
default_null destination_region "$EC2_VARS"
default_null dr_account_id "$EC2_VARS"
default_false enable_cross_region_copy "$TENANT_VARS"
default_false enable_dr_account_share "$TENANT_VARS"
default_null destination_region "$TENANT_VARS"
default_null dr_account_id "$TENANT_VARS"
pass "fail-closed defaults (false/null) on module + tenant template"

# --- 2. DLM dynamic blocks + encryption ---
grep -Eq 'aws_dlm_lifecycle_policy' "$EC2_MAIN" || fail "DLM lifecycle policy missing"
grep -Eq 'dynamic[[:space:]]+"cross_region_copy_rule"' "$EC2_MAIN" \
  || fail "cross_region_copy_rule dynamic block missing"
grep -Eq 'dynamic[[:space:]]+"share_rule"' "$EC2_MAIN" \
  || fail "share_rule dynamic block missing"
grep -Eq 'enable_cross_region_copy' "$EC2_MAIN" || fail "main.tf must gate on enable_cross_region_copy"
grep -Eq 'enable_dr_account_share' "$EC2_MAIN" || fail "main.tf must gate on enable_dr_account_share"
grep -Eq 'encrypted[[:space:]]*=[[:space:]]*true' "$EC2_MAIN" \
  || fail "cross-region copy rule must set encrypted=true"
# Ensure cross_region_copy_rule content encrypts (not only root volume)
python3 - "$EC2_MAIN" <<'PY' || fail "cross_region_copy_rule must set encrypted=true"
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
# Find dynamic cross_region_copy_rule block and require encrypted = true inside
m = re.search(
    r'dynamic\s+"cross_region_copy_rule"\s*\{.*?content\s*\{(.*?)\}',
    text,
    re.S,
)
if not m:
    raise SystemExit("cross_region_copy_rule content block not found")
body = m.group(1)
if not re.search(r'encrypted\s*=\s*true', body):
    raise SystemExit("encrypted = true missing inside cross_region_copy_rule")
print("encrypted=true present in cross_region_copy_rule")
PY
pass "DLM dynamic cross_region_copy_rule + share_rule; copy encrypted=true"

# --- 3. Check blocks / fail-closed gates ---
grep -Eq 'check[[:space:]]+"dlm_cross_region_copy_requires_destination"' "$EC2_MAIN" \
  || fail "missing check dlm_cross_region_copy_requires_destination"
grep -Eq 'check[[:space:]]+"dlm_dr_account_share_requires_account_id"' "$EC2_MAIN" \
  || fail "missing check dlm_dr_account_share_requires_account_id"
grep -Eq 'check[[:space:]]+"dlm_dr_features_require_enable_dlm"' "$EC2_MAIN" \
  || fail "missing check dlm_dr_features_require_enable_dlm"
pass "Terraform check blocks for opt-in gates"

# --- 4. Primary encryption + BPA still production defaults ---
grep -Eq 'encrypted[[:space:]]*=[[:space:]]*true' "$EC2_MAIN" || fail "EBS encrypted=true missing"
if ! grep -A10 'variable "enable_ebs_snapshot_block_public_access"' "$EC2_VARS" | grep -Eq 'default[[:space:]]*=[[:space:]]*true'; then
  fail "enable_ebs_snapshot_block_public_access must default true"
fi
if ! grep -A8 'variable "ebs_snapshot_block_public_access_state"' "$EC2_VARS" | grep -Eq 'default[[:space:]]*=[[:space:]]*"block-all-sharing"'; then
  fail "ebs_snapshot_block_public_access_state must default block-all-sharing"
fi
pass "primary EBS encryption + snapshot BPA defaults still on"

# --- 5. Outputs + tenant wiring ---
grep -Eq 'output[[:space:]]+"snapshot_dr_copy_summary"' "$EC2_OUT" \
  || fail "module output snapshot_dr_copy_summary missing"
grep -Eq 'enable_cross_region_copy' "$TENANT_MAIN" || fail "tenant main.tf must pass enable_cross_region_copy"
grep -Eq 'enable_dr_account_share' "$TENANT_MAIN" || fail "tenant main.tf must pass enable_dr_account_share"
grep -Eq 'output[[:space:]]+"snapshot_dr_copy_summary"' "$TENANT_OUT" \
  || fail "tenant output snapshot_dr_copy_summary missing"
pass "outputs + tenant template wiring"

# --- 6. Examples: defaults off; no live-looking account IDs outside placeholders ---
grep -Eq 'enable_cross_region_copy[[:space:]]*=[[:space:]]*false' "$EC2_EX" \
  || fail "module example must set enable_cross_region_copy = false"
grep -Eq 'enable_dr_account_share[[:space:]]*=[[:space:]]*false' "$EC2_EX" \
  || fail "module example must set enable_dr_account_share = false"
grep -Eq 'enable_cross_region_copy[[:space:]]*=[[:space:]]*false' "$TENANT_EX" \
  || fail "tenant example must set enable_cross_region_copy = false"
grep -Eq 'enable_dr_account_share[[:space:]]*=[[:space:]]*false' "$TENANT_EX" \
  || fail "tenant example must set enable_dr_account_share = false"

# Flag any uncommented 12-digit account assignment that is not all zeros (placeholder).
python3 - "$EC2_EX" "$TENANT_EX" <<'PY' || fail "live-looking account id in example tfvars"
import re, sys
bad = []
for path in sys.argv[1:]:
    for i, line in enumerate(open(path, encoding="utf-8"), 1):
        stripped = line.strip()
        if stripped.startswith("#"):
            continue
        # allow only 000000000000 as placeholder if ever uncommented
        for m in re.finditer(r'dr_account_id\s*=\s*"([0-9]{12})"', stripped):
            if m.group(1) != "000000000000":
                bad.append(f"{path}:{i}: {stripped}")
        for m in re.finditer(r'arn:aws:kms:[a-z0-9-]+:([0-9]{12}):', stripped):
            if m.group(1) != "000000000000":
                bad.append(f"{path}:{i}: non-placeholder account in ARN")
if bad:
    print("\n".join(bad))
    raise SystemExit(1)
print("no live account ids in active example lines")
PY
pass "examples fail-closed; no live account IDs"

# --- 7. Runbook RPO/RTO + isolation policy ---
grep -Eiq 'enable_cross_region_copy|cross.region' "$RUNBOOK" \
  || fail "dlm-restore-drill.md must document cross-region copy"
grep -Eiq 'enable_dr_account_share|dr_account' "$RUNBOOK" \
  || fail "dlm-restore-drill.md must document DR account share"
grep -Eiq 'RPO|RTO' "$RUNBOOK" || fail "dlm-restore-drill.md must discuss RPO/RTO"
grep -Eiq '24 hour|24 h|RPO.*24' "$RUNBOOK" || fail "runbook must keep default RPO 24h language"
grep -Eiq 'cbd-mta\.7\.4|cross_region_copy_rule|share_rule' "$ISOLATION" \
  || fail "tenant-isolation-decision.md must reference opt-in DLM implementation"
pass "runbook RPO/RTO + isolation decision updated"

# --- 8. Optional terraform validate (when terraform available) ---
if command -v terraform >/dev/null 2>&1; then
  (
    cd "$EC2"
    terraform init -backend=false -input=false >/dev/null
    terraform validate
  ) || fail "terraform validate failed for modules/company-brain-ec2"
  pass "terraform validate company-brain-ec2"
else
  log "SKIP: terraform not installed (CI should still run validate in matrix jobs)"
fi

log "ALL CHECKS PASSED"
