#!/usr/bin/env bash
# Offline smoke: modules/customer-account-access Track B trust / least-privilege contracts.
# No AWS credentials, no terraform apply, no network.
#
# Validates:
#   - Module layout + honesty gate
#   - ExternalId required in trust; no CreateAccessKey / CreateUser allow path for keys
#   - Session controls (max duration, optional tags)
#   - Artifact hermes/ + client-core/ scope; GetBucketLocation split from ListBucket
#   - Cross-tenant / long-lived-key denies
#   - Outputs: role ARN, external ID parameter name (not secret value), assume templates
#   - Example tfvars placeholders only; docs + runbook present
#   - No employee-vault dependency
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOD="$ROOT/modules/customer-account-access"
RUNBOOK="$ROOT/references/runbooks/track-b-customer-account-access.md"

err() { echo "[smoke-customer-account-access] ERROR: $*" >&2; }
log() { echo "[smoke-customer-account-access] $*"; }
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

# --- 1. Honesty gate ---
grep -Eq 'variable[[:space:]]+"acknowledge_not_auto_applied"' "$MOD/variables.tf" \
  || fail "variables.tf must declare acknowledge_not_auto_applied"
grep -Eq 'var\.acknowledge_not_auto_applied[[:space:]]*==[[:space:]]*true' "$MOD/variables.tf" \
  || fail "acknowledge_not_auto_applied must validate == true"
grep -Fq 'acknowledge_not_auto_applied' "$MOD/main.tf" \
  || fail "main.tf must reference acknowledge_not_auto_applied (check block)"
grep -Eq 'acknowledge_not_auto_applied[[:space:]]*=[[:space:]]*true' "$MOD/terraform.tfvars.example" \
  || fail "example must set acknowledge_not_auto_applied = true"
pass "honesty gate acknowledge_not_auto_applied"

# --- 2. ExternalId required in trust ---
grep -Eq 'sts:ExternalId' "$MOD/main.tf" \
  || fail "trust policy must condition on sts:ExternalId"
grep -Eq 'variable[[:space:]]+"external_id"' "$MOD/variables.tf" \
  || fail "variables.tf must declare external_id"
grep -Eq 'sensitive[[:space:]]*=[[:space:]]*true' "$MOD/variables.tf" \
  || fail "external_id must be sensitive = true"
# Reject trivial placeholders in validation
grep -Eq 'changeme|REPLACE|placeholder|example' "$MOD/variables.tf" \
  || fail "external_id validation should reject trivial placeholders"
pass "ExternalId required + sensitive + placeholder rejection"

# --- 3. Trust principals + no long-lived keys as a feature ---
grep -Eq 'lanyard_principal_arns' "$MOD/variables.tf" "$MOD/main.tf" \
  || fail "module must take lanyard_principal_arns for trust"
if grep -REn --include='*.tf' 'aws_iam_access_key|aws_iam_user[[:space:]]' "$MOD" 2>/dev/null | grep -v 'CreateUser\|CreateAccessKey\|Deny'; then
  # Allow Deny action strings mentioning CreateUser/CreateAccessKey only
  if grep -REn --include='*.tf' 'resource[[:space:]]+"aws_iam_access_key"|resource[[:space:]]+"aws_iam_user"' "$MOD" 2>/dev/null; then
    fail "module must not create aws_iam_user or aws_iam_access_key resources"
  fi
fi
if grep -REn --include='*.tf' 'resource[[:space:]]+"aws_iam_access_key"' "$MOD" 2>/dev/null; then
  fail "module must not create aws_iam_access_key"
fi
if grep -REn --include='*.tf' 'resource[[:space:]]+"aws_iam_user"' "$MOD" 2>/dev/null; then
  fail "module must not create aws_iam_user"
fi
grep -Eq 'iam:CreateAccessKey' "$MOD/main.tf" \
  || fail "main.tf must explicitly deny iam:CreateAccessKey"
grep -Eq 'iam:CreateUser' "$MOD/main.tf" \
  || fail "main.tf must explicitly deny iam:CreateUser"
pass "no long-lived key resources; CreateUser/AccessKey denied"

# --- 4. Session controls ---
grep -Eq 'max_session_duration' "$MOD/main.tf" "$MOD/variables.tf" \
  || fail "max_session_duration must be configurable on the role"
grep -Eq 'sts:TagSession|enable_session_tags' "$MOD/main.tf" \
  || fail "session tags / TagSession support required"
grep -Eq 'TenantSlug|tenant_slug' "$MOD/main.tf" \
  || fail "session tag TenantSlug / tenant_slug wiring missing"
pass "session duration + optional session tags"

# --- 5. Least privilege deploy surface + artifact prefixes ---
grep -Eq 'dlm:' "$MOD/main.tf" || fail "deploy policy should cover DLM"
grep -Eq 'ec2:' "$MOD/main.tf" || fail "deploy policy should cover EC2"
grep -Eq 'ssm:GetParameter|ssm:PutParameter' "$MOD/main.tf" \
  || fail "deploy policy should cover scoped SSM"
grep -Eq 'secretsmanager:GetSecretValue' "$MOD/main.tf" \
  || fail "deploy policy should cover scoped Secrets Manager"
grep -Eq 'hermes/' "$MOD/main.tf" "$MOD/variables.tf" \
  || fail "artifact defaults must include hermes/"
grep -Eq 'client-core/' "$MOD/main.tf" "$MOD/variables.tf" \
  || fail "artifact defaults must include client-core/"
grep -Eq 'ArtifactGetBucketLocation|GetBucketLocation' "$MOD/main.tf" \
  || fail "GetBucketLocation must be split from prefix-conditioned ListBucket"
# ListBucket statement should not bundle GetBucketLocation with s3:prefix in one block
python3 - "$MOD/main.tf" <<'PY' || fail "GetBucketLocation must not share s3:prefix condition with ListBucket"
import re, sys
from pathlib import Path
text = Path(sys.argv[1]).read_text()
# crude: if GetBucketLocation appears in same statement block as StringLike s3:prefix, fail
blocks = re.split(r"statement\s*\{", text)
for b in blocks:
    if "GetBucketLocation" in b or "s3:GetBucketLocation" in b:
        if "s3:prefix" in b and "StringLike" in b:
            # Allow if only ListBucket in that block without GetBucketLocation actions together
            if re.search(r'actions\s*=\s*\[[^\]]*(GetBucketLocation|s3:GetBucketLocation)[^\]]*ListBucket', b, re.S):
                sys.exit(1)
            if "GetBucketLocation" in b and "ListBucket" in b and "s3:prefix" in b:
                # same statement with both actions + prefix is the anti-pattern
                acts = re.search(r"actions\s*=\s*\[(.*?)\]", b, re.S)
                if acts and "GetBucketLocation" in acts.group(1) and "ListBucket" in acts.group(1):
                    sys.exit(1)
sys.exit(0)
PY
pass "deploy surface + hermes/client-core artifact scope + GetBucketLocation split"

# --- 6. Cross-tenant denies ---
grep -Eq 'DenyCreateLongLivedCredentials|DenyIamOutsideTenantPrefix|enable_cross_tenant_denies' "$MOD/main.tf" \
  || fail "explicit cross-tenant / long-lived deny statements required"
grep -Eq 'not_resources|DenySsmOutsideTenantPrefix|DenySecretsOutsideTenantPrefix' "$MOD/main.tf" \
  || fail "SSM/Secrets outside tenant prefix must be denied"
grep -Eq 'sts:AssumeRole' "$MOD/main.tf" \
  || fail "must mention sts:AssumeRole (trust allow + deny chaining)"
pass "cross-tenant and role-chaining denies"

# --- 7. Outputs contract ---
for out in role_arn external_id_parameter_name assume_role_cli_template terraform_provider_assume_role_hcl \
  platform_artifact_bucket_policy_statement_json rotate_revoke_offboard_summary module_status; do
  grep -Eq "output[[:space:]]+\"$out\"" "$MOD/outputs.tf" \
    || fail "outputs.tf missing output \"$out\""
done
# Must not output the raw external_id secret value as a non-sensitive convenience
if grep -Eq 'output[[:space:]]+"external_id"' "$MOD/outputs.tf"; then
  # If present, must be sensitive
  awk '/output[[:space:]]+"external_id"/,/^}/' "$MOD/outputs.tf" | grep -Eq 'sensitive[[:space:]]*=[[:space:]]*true' \
    || fail "if external_id is output, it must be sensitive = true (prefer parameter name only)"
fi
grep -Eq 'external_id_parameter_name' "$MOD/outputs.tf" \
  || fail "must output external_id_parameter_name (name not value)"
grep -Eq 'infra_ready' "$MOD/outputs.tf" "$MOD/README.md" \
  || fail "module_status / README must say infra_ready"
pass "outputs: role ARN, parameter name, assume templates, rotate/revoke"

# --- 8. Example tfvars safety ---
EX="$MOD/terraform.tfvars.example"
grep -Eq '000000000000|LANYARD_ACCOUNT|placeholder|example' "$EX" \
  || fail "example principal ARNs should be obvious placeholders (zeros or docs)"
# No real-looking 12-digit non-zero-only accounts claimed as production
if grep -EOq 'arn:aws:iam::(?!000000000000)[0-9]{12}:' "$EX" 2>/dev/null; then
  # allow if commented REPLACE guidance only — soft: fail on bare live-looking IDs without REPLACE/EXAMPLE
  while read -r line; do
    echo "$line" | grep -Eq '^\s*#' && continue
    if echo "$line" | grep -Eq 'arn:aws:iam::[0-9]{12}:' && ! echo "$line" | grep -Eq '000000000000|REPLACE|EXAMPLE'; then
      fail "terraform.tfvars.example appears to embed a non-placeholder account id: $line"
    fi
  done < "$EX"
fi
grep -Eqi 'never commit|private|not auto-applied|NOT auto-applied' "$EX" \
  || fail "example should warn never commit / not auto-applied"
pass "example tfvars placeholder-safe"

# --- 9. Provider alias + state separation documented ---
grep -Eq 'assume_role|provider \"aws\"' "$MOD/outputs.tf" "$MOD/README.md" "$RUNBOOK" \
  || fail "provider assume_role wiring must be documented"
grep -Eqi 'state|backend' "$MOD/README.md" "$RUNBOOK" \
  || fail "state/backend separation must be documented"
grep -Eqi 'rotate|revoke|offboard' "$MOD/README.md" "$RUNBOOK" "$MOD/outputs.tf" \
  || fail "rotate/revoke/offboard must be documented"
pass "provider alias, state separation, rotate/revoke/offboard documented"

# --- 10. No employee-vault dependency ---
if grep -RIn --include='*.tf' --include='*.md' --include='*.example' \
  -e 'employee-vault' -e 'employee_vault' -e '/home/operator/Lanyard' "$MOD" 2>/dev/null \
  | grep -v 'no employee-vault\|No employee-vault\|must not\|never'; then
  # Allow explicit "no employee-vault" mentions
  :
fi
if grep -RIn --include='*.tf' 'employee-vault\|employee_vault\|module.*vault' "$MOD" 2>/dev/null; then
  fail "module .tf must not reference employee-vault"
fi
grep -Eqi 'employee-vault|No employee-vault' "$MOD/README.md" \
  || fail "README should explicitly disclaim employee-vault dependency"
pass "no employee-vault dependency"

# --- 11. Hosting track labeling ---
grep -Eq 'customer_account' "$MOD/main.tf" "$MOD/outputs.tf" "$MOD/README.md" \
  || fail "module should label hosting track customer_account"
pass "hosting_track customer_account labeled"

# --- 12. Permissions boundary option ---
grep -Eq 'permissions_boundary|create_permissions_boundary' "$MOD/main.tf" "$MOD/variables.tf" \
  || fail "permissions boundary support required"
pass "permissions boundary support"

log "OK: customer-account-access Track B smoke passed"
exit 0
