#!/usr/bin/env bash
# Offline smoke: templates/tenant wiring to account-factory + customer-account-access.
# No AWS credentials, no terraform apply, no network.
#
# Validates:
#   - Template layout + provider assume_role dynamic block
#   - deploy_role_* / ExternalId / state_backend_* / artifact_cross_account_mode vars
#   - Track B ExternalId fail-closed check; production role account match check
#   - Outputs: access_wiring_summary, state_backend_hints, artifact_cross_account_notes
#   - backend.tf.example + providers.tf.example Track A/B content
#   - tfvars.example placeholder-safe; no employee-vault
#   - Runbook cross-links for Track A/B onboarding wiring
#   - dedicated_kms → ebs_kms fallback
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TPL="$ROOT/templates/tenant"
AF="$ROOT/modules/account-factory"
CAA="$ROOT/modules/customer-account-access"
AF_RB="$ROOT/references/runbooks/account-factory.md"
TB_RB="$ROOT/references/runbooks/track-b-customer-account-access.md"
E2E_RB="$ROOT/references/runbooks/track-a-b-e2e.md"
ISO_RB="$ROOT/references/runbooks/tenant-isolation.md"

err() { echo "[smoke-tenant-template-wiring] ERROR: $*" >&2; }
log() { echo "[smoke-tenant-template-wiring] $*"; }
fail() { err "$*"; exit 1; }
pass() { log "OK: $*"; }

[ -d "$TPL" ] || fail "template directory missing: $TPL"

need_file() {
  [ -f "$1" ] || fail "missing required file: $1"
}

for f in versions.tf variables.tf main.tf outputs.tf INDEX.md terraform.tfvars.example backend.tf.example providers.tf.example; do
  need_file "$TPL/$f"
done
need_file "$AF_RB"
need_file "$TB_RB"
need_file "$E2E_RB"
need_file "$ISO_RB"
[ -d "$AF" ] || fail "account-factory module missing"
[ -d "$CAA" ] || fail "customer-account-access module missing"

# --- 1. Provider assume_role wiring ---
grep -Eq 'dynamic[[:space:]]+"assume_role"' "$TPL/versions.tf" \
  || fail "versions.tf must use dynamic assume_role for optional deploy role"
grep -Eq 'local\.use_deploy_role' "$TPL/versions.tf" "$TPL/main.tf" \
  || fail "use_deploy_role local must drive assume_role"
grep -Eq 'var\.deploy_role_arn' "$TPL/versions.tf" \
  || fail "provider assume_role must reference deploy_role_arn"
grep -Eq 'external_id' "$TPL/versions.tf" \
  || fail "provider assume_role must support external_id"
grep -Eq 'session_name|deploy_role_session_name' "$TPL/versions.tf" \
  || fail "provider assume_role must set session_name"
pass "provider dynamic assume_role + ExternalId + session name"

# --- 2. Variables contract ---
for v in deploy_role_arn deploy_role_external_id deploy_role_session_name \
  deploy_role_session_duration_seconds enable_deploy_role_session_tags \
  deploy_role_external_id_parameter_name state_backend_bucket \
  state_backend_dynamodb_table state_backend_key artifact_cross_account_mode; do
  grep -Eq "variable[[:space:]]+\"$v\"" "$TPL/variables.tf" \
    || fail "variables.tf missing variable \"$v\""
done
grep -Eq 'sensitive[[:space:]]*=[[:space:]]*true' "$TPL/variables.tf" \
  || fail "deploy_role_external_id (or other secrets) must be sensitive"
# ExternalId variable specifically sensitive
awk '/variable[[:space:]]+"deploy_role_external_id"/,/^}/' "$TPL/variables.tf" \
  | grep -Eq 'sensitive[[:space:]]*=[[:space:]]*true' \
  || fail "deploy_role_external_id must be sensitive = true"
grep -Eq 'platform_bucket_grant|customer_mirror|https_pins|same_account' "$TPL/variables.tf" \
  || fail "artifact_cross_account_mode must document approved modes"
pass "deploy-role / backend / artifact-mode variables"

# --- 3. Fail-closed checks ---
grep -Eq 'track_b_deploy_role_requires_external_id' "$TPL/main.tf" \
  || fail "main.tf must check Track B ExternalId when assume-role is set"
grep -Eq 'production_deploy_role_account_matches' "$TPL/main.tf" \
  || fail "main.tf must check deploy_role_arn account matches aws_account_id"
grep -Eq 'ebs_kms_key_id_effective|coalesce\(var\.ebs_kms_key_id, var\.dedicated_kms_key_arn\)' "$TPL/main.tf" \
  || fail "main.tf must fall back dedicated_kms_key_arn → ebs_kms_key_id"
pass "Track B ExternalId check + role/account match + KMS fallback"

# --- 4. Outputs ---
for out in access_wiring_summary state_backend_hints artifact_cross_account_notes \
  deploy_role_arn deploy_role_external_id_parameter_name isolation_summary; do
  grep -Eq "output[[:space:]]+\"$out\"" "$TPL/outputs.tf" \
    || fail "outputs.tf missing output \"$out\""
done
grep -Eq 'account-factory|customer-account-access' "$TPL/outputs.tf" \
  || fail "access_wiring_summary must reference both Track A and Track B modules"
grep -Eq 'platform_artifact_bucket_policy|INSTANCE_ROLE|cross-account' "$TPL/outputs.tf" \
  || fail "artifact_cross_account_notes must document platform bucket grant path"
# Must not output raw ExternalId value as a convenience non-sensitive output
if grep -Eq 'output[[:space:]]+"deploy_role_external_id"' "$TPL/outputs.tf"; then
  awk '/output[[:space:]]+"deploy_role_external_id"/,/^}/' "$TPL/outputs.tf" \
    | grep -Eq 'sensitive[[:space:]]*=[[:space:]]*true' \
    || fail "if deploy_role_external_id is output, it must be sensitive"
fi
pass "wiring / backend / artifact outputs (no bare ExternalId)"

# --- 5. Examples: backend + providers + tfvars ---
grep -Eq 'Track A|account-factory|state_backend_config' "$TPL/backend.tf.example" \
  || fail "backend.tf.example must document Track A / account-factory state"
grep -Eq 'Track B|customer' "$TPL/backend.tf.example" \
  || fail "backend.tf.example must document Track B customer-owned state"
grep -Eq 'encrypt[[:space:]]*=[[:space:]]*true|encrypt = true' "$TPL/backend.tf.example" \
  || fail "backend.tf.example must require encrypt = true"
grep -Eq 'aws\.tenant|aws\.customer|assume_role' "$TPL/providers.tf.example" \
  || fail "providers.tf.example must show dual-alias assume_role pattern"
grep -Eq 'deploy_role_arn|Track A|Track B' "$TPL/terraform.tfvars.example" \
  || fail "terraform.tfvars.example must document Track A/B wiring"
grep -Eq 'external_id|ExternalId' "$TPL/terraform.tfvars.example" \
  || fail "tfvars.example must mention ExternalId for Track B"
# Uncommented deploy_role_external_id must not look like a live secret
while read -r line; do
  echo "$line" | grep -Eq '^\s*#' && continue
  if echo "$line" | grep -Eq 'deploy_role_external_id[[:space:]]*='; then
    if ! echo "$line" | grep -Eq 'null|REPLACE|UNCONFIGURED|example|changeme'; then
      fail "uncommented deploy_role_external_id looks non-placeholder: $line"
    fi
  fi
  if echo "$line" | grep -Eq 'deploy_role_arn[[:space:]]*='; then
    if echo "$line" | grep -Eq 'arn:aws:iam::[0-9]{12}:' \
      && ! echo "$line" | grep -Eq '000000000000|111122223333|444455556666|REPLACE|EXAMPLE'; then
      fail "uncommented deploy_role_arn looks non-placeholder: $line"
    fi
  fi
done < "$TPL/terraform.tfvars.example"
pass "backend/providers/tfvars examples placeholder-safe"

# --- 6. INDEX + docs honesty ---
grep -Eq 'account-factory|customer-account-access|deploy_role' "$TPL/INDEX.md" \
  || fail "templates/tenant/INDEX.md must document Track A/B wiring"
grep -Eq 'infra_ready|not auto-applied|No static' "$TPL/INDEX.md" \
  || fail "INDEX.md must stay honest about infra_ready / no static keys"
pass "template INDEX wiring docs"

# --- 6b. Daytona skip guard (lp-4nf / plan §4.11) ---
grep -Eq 'variable[[:space:]]+"runtime_kind"' "$TPL/variables.tf" \
  || fail "templates/tenant must declare runtime_kind variable"
grep -Eq 'daytona_forbids_company_brain_ec2_template' "$TPL/main.tf" \
  || fail "templates/tenant must fail closed when runtime_kind=daytona"
grep -Eq 'runtime_kind.*daytona|daytona.*fail' "$TPL/INDEX.md" \
  || fail "templates/tenant/INDEX.md must document daytona skip / fail-closed"
grep -Eq 'runtime_kind' "$TPL/terraform.tfvars.example" \
  || fail "terraform.tfvars.example must document runtime_kind"
pass "daytona forbids company-brain-ec2 template (lp-4nf)"

# --- 7. Module outputs still exist (contract consumers) ---
grep -Eq 'output[[:space:]]+"deploy_role_arn"' "$AF/outputs.tf" \
  || fail "account-factory must still output deploy_role_arn"
grep -Eq 'output[[:space:]]+"state_backend_config_template"' "$AF/outputs.tf" \
  || fail "account-factory must still output state_backend_config_template"
grep -Eq 'output[[:space:]]+"tenant_template_wiring"' "$AF/outputs.tf" \
  || fail "account-factory must still output tenant_template_wiring"
grep -Eq 'output[[:space:]]+"role_arn"' "$CAA/outputs.tf" \
  || fail "customer-account-access must still output role_arn"
grep -Eq 'output[[:space:]]+"external_id_parameter_name"' "$CAA/outputs.tf" \
  || fail "customer-account-access must still output external_id_parameter_name"
grep -Eq 'output[[:space:]]+"platform_artifact_bucket_policy_statement_json"' "$CAA/outputs.tf" \
  || fail "customer-account-access must still output platform_artifact_bucket_policy_statement_json"
pass "upstream Track A/B module outputs present"

# --- 8. Runbook wiring sections ---
grep -Eq 'templates/tenant|deploy_role|backend' "$AF_RB" \
  || fail "account-factory runbook must cover tenant template consume"
grep -Eq 'templates/tenant|deploy_role_arn|ExternalId|backend' "$TB_RB" \
  || fail "Track B runbook must cover tenant template wiring"
grep -Eq 'account-factory|customer-account-access|deploy_role' "$E2E_RB" \
  || fail "track-a-b-e2e must reference factory/access modules and deploy role"
grep -Eq 'account-factory|customer-account-access|deploy_role|ExternalId' "$ISO_RB" \
  || fail "tenant-isolation runbook must mention Track A/B wiring"
pass "runbooks document tenant template wiring"

# --- 9. No employee-vault / no static keys feature ---
if grep -REn --include='*.tf' 'resource[[:space:]]+"aws_iam_access_key"|resource[[:space:]]+"aws_iam_user"' "$TPL" 2>/dev/null | grep -q .; then
  fail "tenant template must not create aws_iam_user or aws_iam_access_key"
fi
if grep -RIn --include='*.tf' 'employee-vault\|employee_vault' "$TPL" 2>/dev/null | grep -q .; then
  fail "tenant template .tf must not reference employee-vault"
fi
grep -Eqi 'no static|never.*access keys|AssumeRole only|sts:AssumeRole' "$TPL/outputs.tf" "$TPL/INDEX.md" \
  || fail "template must document no static access keys"
pass "no static keys; no employee-vault in .tf"

# --- 10. Repo indexes mention smoke (soft when present) ---
if [ -f "$ROOT/index.yaml" ]; then
  grep -Eq 'smoke-tenant-template-wiring|tenant-template-wiring' "$ROOT/index.yaml" \
    || fail "index.yaml must list smoke-tenant-template-wiring"
fi
if [ -f "$ROOT/INDEX.md" ]; then
  grep -Eq 'smoke-tenant-template-wiring|tenant template wiring|deploy_role' "$ROOT/INDEX.md" \
    || fail "INDEX.md must mention tenant template wiring / smoke"
fi
pass "root indexes list tenant wiring smoke"

log "OK: tenant-template-wiring smoke passed"
exit 0

# lp-4nf: hard gate must be variable validation (not warn-only check alone)
if ! grep -q 'var.runtime_kind == "ec2"' deploy/templates/tenant/variables.tf; then
  echo "FAIL: variables.tf must hard-require runtime_kind == ec2 (lp-4nf)" >&2
  exit 1
fi

