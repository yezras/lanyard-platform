#!/usr/bin/env bash
# Offline smoke: modules/account-factory Lanyard-hosted account-per-tenant contract.
# No AWS credentials, no terraform apply, no Organizations mutation, no network.
#
# Validates:
#   - Module layout + honesty gates (not auto-applied; live org API locked false)
#   - Account request interface (OU, email, environment_class sandbox|production-client)
#   - SCP JSON templates parse + required deny actions
#   - Baseline resources encoded (KMS, state backend, logs, backup, budget, roles)
#   - Outputs: account_id, deploy_role_arn, state backend template, KMS, decommission checklist
#   - No static key resources; no employee-vault dependency
#   - Runbook + cross-links present
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOD="$ROOT/modules/account-factory"
RUNBOOK="$ROOT/references/runbooks/account-factory.md"
SCP_DIR="$MOD/scp"

err() { echo "[smoke-account-factory] ERROR: $*" >&2; }
log() { echo "[smoke-account-factory] $*"; }
fail() { err "$*"; exit 1; }
pass() { log "OK: $*"; }

[ -d "$MOD" ] || fail "module directory missing: $MOD"

need_file() {
  [ -f "$1" ] || fail "missing required file: $1"
}

for f in versions.tf variables.tf main.tf outputs.tf README.md INDEX.md terraform.tfvars.example; do
  need_file "$MOD/$f"
done
need_file "$RUNBOOK"
need_file "$MOD/templates/aft-account-request.example.json"

# --- 1. Honesty gates ---
grep -Eq 'variable[[:space:]]+"acknowledge_not_auto_applied"' "$MOD/variables.tf" \
  || fail "variables.tf must declare acknowledge_not_auto_applied"
grep -Eq 'var\.acknowledge_not_auto_applied[[:space:]]*==[[:space:]]*true' "$MOD/variables.tf" \
  || fail "acknowledge_not_auto_applied must validate == true"
grep -Fq 'acknowledge_not_auto_applied' "$MOD/main.tf" \
  || fail "main.tf must reference acknowledge_not_auto_applied (check block)"
grep -Eq 'acknowledge_not_auto_applied[[:space:]]*=[[:space:]]*true' "$MOD/terraform.tfvars.example" \
  || fail "example must set acknowledge_not_auto_applied = true"

grep -Eq 'variable[[:space:]]+"enable_live_organizations_api"' "$MOD/variables.tf" \
  || fail "variables.tf must declare enable_live_organizations_api"
grep -Eq 'enable_live_organizations_api[[:space:]]*==[[:space:]]*false' "$MOD/variables.tf" \
  || fail "enable_live_organizations_api must validate == false (locked)"
grep -Eq 'enable_live_organizations_api[[:space:]]*=[[:space:]]*false' "$MOD/terraform.tfvars.example" \
  || fail "example must set enable_live_organizations_api = false"

# Must not create Organizations / account factory resources
if grep -REn --include='*.tf' \
  'resource[[:space:]]+"aws_organizations_|resource[[:space:]]+"aws_controltower_|resource[[:space:]]+"aws_ssoadmin_' \
  "$MOD" 2>/dev/null | grep -q .; then
  fail "module must not create Organizations/Control Tower/SSO Admin resources (contract only for org layer)"
fi
pass "honesty gates: not auto-applied; live org API locked; no org resources"

# --- 2. Account request interface ---
for v in tenant_slug project_name environment_class account_name account_email target_ou_path account_id; do
  grep -Eq "variable[[:space:]]+\"$v\"" "$MOD/variables.tf" \
    || fail "variables.tf missing variable \"$v\""
done
grep -Eq 'sandbox|production-client' "$MOD/variables.tf" \
  || fail "environment_class must allow sandbox and production-client"
grep -Eq 'account_request_contract' "$MOD/main.tf" "$MOD/outputs.tf" \
  || fail "account_request_contract must be produced"
grep -Eq 'target_ou_path' "$MOD/outputs.tf" \
  || fail "outputs must expose target_ou_path"
pass "account request interface (OU, class, email, contract)"

# --- 3. SCP templates ---
[ -d "$SCP_DIR" ] || fail "scp/ directory missing"
SCP_FILES=(
  deny-leave-organization.json
  deny-root-create-access-keys.json
  deny-public-s3-acls.json
  protect-security-services.json
)
for f in "${SCP_FILES[@]}"; do
  need_file "$SCP_DIR/$f"
  python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$SCP_DIR/$f" \
    || fail "SCP JSON invalid: $f"
done
grep -Fq 'organizations:LeaveOrganization' "$SCP_DIR/deny-leave-organization.json" \
  || fail "deny-leave-organization must deny LeaveOrganization"
grep -Fq 'iam:CreateAccessKey' "$SCP_DIR/deny-root-create-access-keys.json" \
  || fail "deny-root-create-access-keys must mention CreateAccessKey"
grep -Eq 'cloudtrail:StopLogging|guardduty:DeleteDetector' "$SCP_DIR/protect-security-services.json" \
  || fail "protect-security-services must protect trail/GuardDuty"
pass "SCP templates parse + required denies"

# --- 4. Baseline resource contracts (when create_account_baseline) ---
for r in aws_kms_key aws_s3_bucket aws_dynamodb_table aws_cloudwatch_log_group aws_backup_vault aws_budgets_budget aws_iam_role; do
  grep -Eq "resource[[:space:]]+\"$r\"" "$MOD/main.tf" \
    || fail "main.tf must define resource \"$r\" for baseline"
done
grep -Eq 'create_account_baseline' "$MOD/variables.tf" "$MOD/main.tf" \
  || fail "create_account_baseline toggle required"
grep -Eq 'block_public_acls|public_access_block' "$MOD/main.tf" \
  || fail "state bucket must block public access"
grep -Eq 'aws:SecureTransport|DenyInsecureTransport' "$MOD/main.tf" \
  || fail "state bucket must deny insecure transport"
grep -Eq 'enable_key_rotation' "$MOD/main.tf" \
  || fail "KMS key rotation should be enabled"
pass "baseline resources: KMS, state, logs, backup, budget, IAM"

# --- 5. Deploy / break-glass roles: no static keys ---
if grep -REn --include='*.tf' 'resource[[:space:]]+"aws_iam_access_key"|resource[[:space:]]+"aws_iam_user"' "$MOD" 2>/dev/null | grep -q .; then
  fail "module must not create aws_iam_user or aws_iam_access_key"
fi
grep -Eq 'iam:CreateAccessKey' "$MOD/main.tf" \
  || fail "deploy/break-glass policies must deny iam:CreateAccessKey"
grep -Eq 'iam:CreateUser' "$MOD/main.tf" \
  || fail "deploy/break-glass policies must deny iam:CreateUser"
grep -Eq 'sts:AssumeRole' "$MOD/main.tf" \
  || fail "roles must use sts:AssumeRole trust"
grep -Eq 'break_glass|break-glass' "$MOD/main.tf" "$MOD/variables.tf" \
  || fail "break-glass role support required"
grep -Eq 'require_mfa_break_glass|MultiFactorAuthPresent' "$MOD/main.tf" "$MOD/variables.tf" \
  || fail "break-glass MFA condition support required"
pass "deploy + break-glass AssumeRole; no long-lived keys"

# --- 6. Outputs contract ---
for out in account_id deploy_role_arn kms_key_arn state_backend_config_template \
  account_request_contract scp_template_files decommission_quarantine_checklist \
  module_status control_tower_aft_integration_summary terraform_provider_assume_role_hcl \
  tenant_template_wiring; do
  grep -Eq "output[[:space:]]+\"$out\"" "$MOD/outputs.tf" \
    || fail "outputs.tf missing output \"$out\""
done
grep -Eq 'infra_ready' "$MOD/outputs.tf" "$MOD/README.md" \
  || fail "module_status / README must say infra_ready"
grep -Eq 'backend \"s3\"|backend "s3"' "$MOD/outputs.tf" \
  || fail "state_backend_config_template must include S3 backend"
pass "outputs: account/deploy/KMS/backend/request/decommission"

# --- 7. Example tfvars safety ---
EX="$MOD/terraform.tfvars.example"
grep -Eq 'create_account_baseline[[:space:]]*=[[:space:]]*false' "$EX" \
  || fail "example should default create_account_baseline = false (contract-safe)"
grep -Eqi 'never commit|private|not auto-applied|NOT auto-applied' "$EX" \
  || fail "example should warn never commit / not auto-applied"
# Reject live-looking non-placeholder accounts in uncommented lines
while read -r line; do
  echo "$line" | grep -Eq '^\s*#' && continue
  if echo "$line" | grep -Eq 'arn:aws:iam::[0-9]{12}:' && ! echo "$line" | grep -Eq '000000000000|REPLACE|EXAMPLE|LANYARD'; then
    fail "terraform.tfvars.example appears to embed a non-placeholder account id: $line"
  fi
done < "$EX"
pass "example tfvars placeholder-safe / contract-default"

# --- 8. Hosting track + employee-vault ---
grep -Eq 'lanyard_hosted' "$MOD/main.tf" "$MOD/outputs.tf" "$MOD/README.md" \
  || fail "module should label hosting track lanyard_hosted"
if grep -RIn --include='*.tf' 'employee-vault\|employee_vault\|module.*vault' "$MOD" 2>/dev/null; then
  fail "module .tf must not reference employee-vault"
fi
grep -Eqi 'employee-vault|No employee-vault|employee-vault dependency' "$MOD/README.md" \
  || fail "README should explicitly disclaim employee-vault dependency"
pass "hosting_track lanyard_hosted; no employee-vault"

# --- 9. Decommission / quarantine + CT/AFT docs ---
grep -Eqi 'quarantine|decommission' "$MOD/outputs.tf" "$RUNBOOK" \
  || fail "decommission/quarantine must be documented"
grep -Eqi 'Control Tower|AFT|Account Factory' "$MOD/README.md" "$RUNBOOK" \
  || fail "Control Tower / AFT integration must be documented"
grep -Eqi 'SSO|permission set|break-glass|break glass' "$RUNBOOK" \
  || fail "SSO / break-glass live test steps must be in runbook"
pass "decommission + CT/AFT + SSO docs"

# --- 10. Cross-links in repo indexes (soft when files exist) ---
if [ -f "$ROOT/references/tenant-isolation-decision.md" ]; then
  grep -Eq 'account-factory|account factory' "$ROOT/references/tenant-isolation-decision.md" \
    || fail "tenant-isolation-decision.md must cross-link account-factory"
fi
if [ -f "$ROOT/references/migration-phases.md" ]; then
  grep -Eq 'account-factory|account factory' "$ROOT/references/migration-phases.md" \
    || fail "migration-phases.md must cross-link account-factory"
fi
pass "decision/migration cross-links"

# --- 11. AFT example template ---
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); assert 'target_ou_path' in d and 'tenant_slug' in d" \
  "$MOD/templates/aft-account-request.example.json" \
  || fail "aft-account-request.example.json must include target_ou_path and tenant_slug"
pass "AFT request example JSON"

log "OK: account-factory smoke passed"
exit 0
