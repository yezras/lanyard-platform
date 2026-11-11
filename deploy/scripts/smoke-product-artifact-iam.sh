#!/usr/bin/env bash
# Offline guardrails for modules/product-artifact-infra IAM trust + S3 Object Lock +
# bucket policy hardening (TLS-only / optional VPCE) + prefix scope.
# No AWS credentials, no terraform apply, no network.
#
# Validates HCL/docs contracts:
#   - No aws_iam_openid_connect_provider resource (must use existing ARN input)
#   - Default OIDC trust subjects are release tags for the three product repos
#   - S3 write policies scope to hermes/, client-core/, and portal-web/ prefixes
#   - Portal publisher default includes s3_write_prefix_keys portal_web
#   - s3:GetBucketLocation is bucket-scoped without s3:prefix; ListBucket stays prefix-conditioned
#   - S3 Object Lock enabled at create with default retention (not versioning-only)
#   - Bucket policy denies non-TLS (aws:SecureTransport=false); optional VPCE pattern present
#   - ECR GetAuthorizationToken uses Resource "*"
#   - ECR repositories set image_tag_mutability = IMMUTABLE
#   - Portal services include web, bff, relay, control-plane
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOD="$ROOT/modules/product-artifact-infra"

err() { echo "[smoke-product-artifact-iam] ERROR: $*" >&2; }
log() { echo "[smoke-product-artifact-iam] $*"; }
fail() { err "$*"; exit 1; }
pass() { log "OK: $*"; }

[ -d "$MOD" ] || fail "module directory missing: $MOD"

need_file() {
  [ -f "$1" ] || fail "missing required file: $1"
}

need_file "$MOD/variables.tf"
need_file "$MOD/iam_oidc.tf"
need_file "$MOD/ecr.tf"
need_file "$MOD/s3.tf"
need_file "$MOD/main.tf"
need_file "$MOD/README.md"

# --- 1. Must not create OIDC provider ---
if grep -RIn --include='*.tf' 'resource[[:space:]]\+"aws_iam_openid_connect_provider"' "$MOD" >/dev/null 2>&1; then
  fail "module must not create aws_iam_openid_connect_provider (require existing ARN input)"
fi
pass "no OIDC provider resource created"

if ! grep -Eq 'github_oidc_provider_arn' "$MOD/variables.tf"; then
  fail "variables.tf must declare github_oidc_provider_arn"
fi
if ! grep -Eq 'enable_oidc_publishers' "$MOD/variables.tf"; then
  fail "variables.tf must declare enable_oidc_publishers"
fi
pass "OIDC provider ARN is an input (existing provider contract)"

# --- 2. Default trust subjects: release tags for three product repos ---
for repo in Portal hermes-lanyard client-core; do
  if ! grep -Eq "repo:.*$repo:ref:refs/tags/\\*" "$MOD/variables.tf" \
    && ! grep -Eq "repository[[:space:]]*=[[:space:]]*\"$repo\"" "$MOD/variables.tf"; then
    fail "publisher default must reference repository $repo"
  fi
done
pass "publisher_repos defaults include Portal, hermes-lanyard, client-core"

# Default subjects construction must use refs/tags/* when subjects list empty
if ! grep -Eq 'ref:refs/tags/\*' "$MOD/main.tf"; then
  fail "main.tf must default OIDC subjects to ref:refs/tags/*"
fi
# Must not default trust to main/master branch pushes
if grep -REn --include='*.tf' 'ref:refs/heads/(main|master)' "$MOD" >/dev/null 2>&1; then
  fail "module .tf files must not default OIDC trust to refs/heads/main or master"
fi
pass "default OIDC trust is release tags only (not main/master heads)"

# --- 3. S3 prefix scope + GetBucketLocation split ---
if ! grep -Eq 'hermes/' "$MOD/variables.tf"; then
  fail "default hermes prefix hermes/ missing from variables.tf"
fi
if ! grep -Eq 'client-core/' "$MOD/variables.tf"; then
  fail "default client-core prefix client-core/ missing from variables.tf"
fi
if ! grep -Eq 'portal-web/' "$MOD/variables.tf"; then
  fail "default portal-web prefix portal-web/ missing from variables.tf"
fi
if ! grep -Eq 'portal_web' "$MOD/variables.tf"; then
  fail "artifact_prefixes / s3_write_prefix_keys must include portal_web key"
fi
if ! grep -Eq 'portal_web' "$MOD/main.tf"; then
  fail "main.tf must resolve portal_web in prefix_by_key / locals"
fi
if ! grep -Eq 'portal_web' "$MOD/outputs.tf"; then
  fail "outputs.tf must expose portal_web prefix / URL template"
fi
if ! grep -Eq 's3_write_prefix_keys' "$MOD/variables.tf"; then
  fail "publisher_repos must support s3_write_prefix_keys"
fi
# Portal publisher default must include portal_web S3 write (in addition to ECR push)
portal_default_block="$(awk '/portal[[:space:]]*=[[:space:]]*\{/,/^[[:space:]]*\}[[:space:]]*$/' "$MOD/variables.tf" | head -n 40)"
echo "$portal_default_block" | grep -Eq 's3_write_prefix_keys[[:space:]]*=[[:space:]]*\[[[:space:]]*"portal_web"[[:space:]]*\]' \
  || fail "publisher_repos.portal default must set s3_write_prefix_keys = [\"portal_web\"]"
echo "$portal_default_block" | grep -Eq 'ecr_push_services' \
  || fail "publisher_repos.portal default must retain ecr_push_services"
# Validation allow-list must include portal_web
if ! grep -Eq 'contains\(\["hermes", "client_core", "portal_web"\]' "$MOD/variables.tf" \
  && ! grep -Eq 'contains\(\["hermes","client_core","portal_web"\]' "$MOD/variables.tf"; then
  # Tolerate whitespace variations around list entries
  if ! awk '/s3_write_prefix_keys entries must be/,/error_message/' "$MOD/variables.tf" | grep -Eq 'portal_web'; then
    # Fall back: validation condition must mention portal_web near hermes/client_core
    if ! grep -Eq 'portal_web' "$MOD/variables.tf" || ! grep -Eq 's3_write_prefix_keys entries must be hermes' "$MOD/variables.tf"; then
      fail "s3_write_prefix_keys validation must allow hermes, client_core, or portal_web"
    fi
  fi
fi
# Policy resources must be prefix-scoped (${bucket}/prefix*)
if ! grep -Eq '\$\{aws_s3_bucket\.artifacts\.arn\}/\$\{p\}\*' "$MOD/iam_oidc.tf" \
  && ! grep -Eq 'aws_s3_bucket\.artifacts\.arn\}/.+\*' "$MOD/iam_oidc.tf"; then
  # Accept either for_each prefix pattern used in module
  if ! grep -Eq 'Resource.*=.*aws_s3_bucket\.artifacts\.arn' "$MOD/iam_oidc.tf"; then
    fail "S3 publisher policy must reference artifact bucket ARN"
  fi
fi
if ! grep -Eq 's3:PutObject' "$MOD/iam_oidc.tf"; then
  fail "S3 publisher policy must allow s3:PutObject under scoped prefix"
fi
if ! grep -Eq 's3:prefix' "$MOD/iam_oidc.tf"; then
  fail "S3 ListBucket must be conditioned on s3:prefix"
fi
if ! grep -Eq 's3:GetBucketLocation' "$MOD/iam_oidc.tf"; then
  fail "S3 publisher policy must allow s3:GetBucketLocation"
fi
# GetBucketLocation must not share an Action array with ListBucket (prefix condition
# does not apply to GetBucketLocation and can deny it).
if grep -Eq 'Action[[:space:]]*=[[:space:]]*\[.*s3:ListBucket.*s3:GetBucketLocation|Action[[:space:]]*=[[:space:]]*\[.*s3:GetBucketLocation.*s3:ListBucket' "$MOD/iam_oidc.tf"; then
  fail "s3:GetBucketLocation must be its own statement, not combined with ListBucket under s3:prefix"
fi
if ! grep -Eq 'Sid[[:space:]]*=[[:space:]]*"GetBucketLocation"' "$MOD/iam_oidc.tf"; then
  fail "S3 publisher policy must have a dedicated GetBucketLocation statement"
fi
if ! grep -Eq 's3:ListBucketVersions' "$MOD/iam_oidc.tf"; then
  fail "S3 publisher policy must allow s3:ListBucketVersions under product prefixes"
fi
# Docs: portal-web contract present
if ! grep -Eq 'portal-web/' "$MOD/README.md"; then
  fail "README must document portal-web/ S3 prefix"
fi
if ! grep -Eq 'portal-web/' "$ROOT/references/product-artifact-release-contract.md"; then
  fail "product-artifact-release-contract.md must document portal-web/ prefix"
fi
pass "S3 write scoped to hermes/, client-core/, portal-web/; Portal publisher gets portal_web; GetBucketLocation unconditioned; ListBucket prefix-conditioned"

# --- 4. ECR auth token + scoped push ---
if ! grep -Eq 'ecr:GetAuthorizationToken' "$MOD/iam_oidc.tf"; then
  fail "ECR policy must include ecr:GetAuthorizationToken"
fi
# GetAuthorizationToken must allow Resource "*"
auth_block="$(awk '/ecr:GetAuthorizationToken/,/Resource/' "$MOD/iam_oidc.tf" | head -n 20)"
echo "$auth_block" | grep -Eq '"\*"' || fail "ecr:GetAuthorizationToken must use Resource \"*\""
pass "ecr:GetAuthorizationToken uses Resource \"*\""

if ! grep -Eq 'ecr:PutImage' "$MOD/iam_oidc.tf"; then
  fail "ECR push policy must include ecr:PutImage"
fi
if ! grep -Eq 'aws_ecr_repository\.portal' "$MOD/iam_oidc.tf"; then
  fail "ECR push Resource must be scoped to aws_ecr_repository.portal ARNs"
fi
pass "ECR push scoped to portal service repositories"

# --- 5. Immutable ECR tags ---
if ! grep -Eq 'image_tag_mutability[[:space:]]*=[[:space:]]*"IMMUTABLE"' "$MOD/ecr.tf"; then
  fail "ECR repositories must set image_tag_mutability = \"IMMUTABLE\""
fi
pass "ECR image_tag_mutability is IMMUTABLE"

# --- 6. Portal services set ---
for svc in web bff relay control-plane; do
  if ! grep -Eq "\"$svc\"" "$MOD/variables.tf"; then
    fail "default portal_services must include $svc"
  fi
done
pass "default portal_services includes web, bff, relay, control-plane"

# --- 7. Public access block + versioning + Object Lock on S3 ---
for needle in block_public_acls block_public_policy ignore_public_acls restrict_public_buckets; do
  grep -Eq "$needle" "$MOD/s3.tf" || fail "s3.tf missing public access control: $needle"
done
grep -Eq 'status[[:space:]]*=[[:space:]]*"Enabled"' "$MOD/s3.tf" || fail "S3 versioning must be Enabled"
# Object Lock is the real immutability contract (versioning alone still allows same-key overwrite as a new current version).
if ! grep -Eq 'object_lock_enabled[[:space:]]*=[[:space:]]*true' "$MOD/s3.tf"; then
  fail "artifact bucket must set object_lock_enabled = true at creation"
fi
if ! grep -Eq 'resource[[:space:]]+"aws_s3_bucket_object_lock_configuration"' "$MOD/s3.tf"; then
  fail "s3.tf must declare aws_s3_bucket_object_lock_configuration with default retention"
fi
if ! grep -Eq 'default_retention' "$MOD/s3.tf"; then
  fail "object lock configuration must set default_retention"
fi
if ! grep -Eq 's3_object_lock_default_retention_mode' "$MOD/variables.tf"; then
  fail "variables.tf must declare s3_object_lock_default_retention_mode"
fi
if ! grep -Eq 's3_object_lock_default_retention_days' "$MOD/variables.tf"; then
  fail "variables.tf must declare s3_object_lock_default_retention_days"
fi
# Safe defaults: GOVERNANCE + positive days; force_destroy false for real envs
if ! grep -Eq 'default[[:space:]]*=[[:space:]]*"GOVERNANCE"' "$MOD/variables.tf"; then
  fail "s3_object_lock_default_retention_mode safe default must be GOVERNANCE"
fi
if ! grep -Eq 's3_object_lock_default_retention_days' "$MOD/variables.tf" \
  || ! awk '/variable "s3_object_lock_default_retention_days"/,/^}/' "$MOD/variables.tf" | grep -Eq 'default[[:space:]]*=[[:space:]]*90'; then
  fail "s3_object_lock_default_retention_days safe default must be 90"
fi
if ! awk '/variable "s3_force_destroy"/,/^}/' "$MOD/variables.tf" | grep -Eq 'default[[:space:]]*=[[:space:]]*false'; then
  fail "s3_force_destroy default must be false for real environments"
fi
# Outputs expose lock contract
grep -Eq 'artifact_bucket_object_lock_enabled' "$MOD/outputs.tf" \
  || fail "outputs.tf must expose artifact_bucket_object_lock_enabled"
grep -Eq 'artifact_bucket_object_lock_default_retention' "$MOD/outputs.tf" \
  || fail "outputs.tf must expose artifact_bucket_object_lock_default_retention"
pass "S3 public access blocked, versioning enabled, Object Lock + default retention present"

# --- 7b. Bucket policy: TLS-only deny + optional VPCE restriction ---
if ! grep -Eq 'resource[[:space:]]+"aws_s3_bucket_policy"' "$MOD/s3.tf"; then
  fail "s3.tf must declare aws_s3_bucket_policy for TLS / VPCE hardening"
fi
if ! grep -Eq 'DenyInsecureTransport' "$MOD/s3.tf"; then
  fail "bucket policy must include DenyInsecureTransport sid"
fi
if ! grep -Eq 'aws:SecureTransport' "$MOD/s3.tf"; then
  fail "bucket policy must condition on aws:SecureTransport"
fi
# SecureTransport deny must be Bool false (reject plain HTTP)
if ! grep -Eq 'aws:SecureTransport' "$MOD/s3.tf"; then
  fail "missing aws:SecureTransport condition"
fi
# Ensure the false value appears near SecureTransport (static contract)
if ! awk '/SecureTransport/,/}/' "$MOD/s3.tf" | grep -Eq '"false"|false'; then
  # jsonencode style: "aws:SecureTransport" = "false"
  grep -Eq 'SecureTransport.*=.*"false"|SecureTransport.*"false"' "$MOD/s3.tf" \
    || fail "SecureTransport deny must set value false (reject non-TLS)"
fi
if ! grep -Eq 's3_vpc_endpoint_ids' "$MOD/variables.tf"; then
  fail "variables.tf must declare s3_vpc_endpoint_ids for optional VPCE restriction"
fi
if ! grep -Eq 's3_vpc_endpoint_exempt_principal_arns' "$MOD/variables.tf"; then
  fail "variables.tf must declare s3_vpc_endpoint_exempt_principal_arns"
fi
if ! grep -Eq 'DenyRequestsOutsideAllowedVPCEndpoints' "$MOD/s3.tf"; then
  fail "s3.tf must implement optional DenyRequestsOutsideAllowedVPCEndpoints statement"
fi
if ! grep -Eq 'aws:SourceVpce' "$MOD/s3.tf"; then
  fail "VPCE restriction must condition on aws:SourceVpce"
fi
# Default VPCE list must be empty (opt-in advanced mode)
if ! awk '/variable "s3_vpc_endpoint_ids"/,/^}/' "$MOD/variables.tf" | grep -Eq 'default[[:space:]]*=[[:space:]]*\[\]'; then
  fail "s3_vpc_endpoint_ids default must be [] (opt-in)"
fi
# KMS guidance: variable + check + README section
if ! grep -Eq 's3_kms_key_id' "$MOD/variables.tf"; then
  fail "variables.tf must declare s3_kms_key_id"
fi
if ! grep -Eq 'kms_key_recommended_when_sse_kms|kms_key_required_when_sse_kms' "$MOD/main.tf"; then
  fail "main.tf must check/require s3_kms_key_id when s3_sse_algorithm is aws:kms"
fi
if ! grep -Eq 'KMS key policy|aws:SecureTransport|VPC endpoint' "$MOD/README.md"; then
  fail "README must document TLS-only, optional VPCE, and KMS key policy guidance"
fi
# Outputs expose TLS / VPCE contract
grep -Eq 'artifact_bucket_tls_only' "$MOD/outputs.tf" \
  || fail "outputs.tf must expose artifact_bucket_tls_only"
grep -Eq 'artifact_bucket_vpc_endpoint_restriction' "$MOD/outputs.tf" \
  || fail "outputs.tf must expose artifact_bucket_vpc_endpoint_restriction"
pass "S3 bucket policy TLS-only deny + optional VPCE pattern + KMS guidance present"

# --- 8. Check blocks for fail-closed OIDC ---
grep -Eq 'oidc_provider_required_when_enabled' "$MOD/main.tf" || fail "missing check oidc_provider_required_when_enabled"
pass "check block requires OIDC provider ARN when publishers enabled"

# --- 9. Platform staging consumes relative module source + explicit Object Lock ---
STAGING="$ROOT/environments/platform-staging/main.tf"
need_file "$STAGING"
grep -Eq 'source[[:space:]]*=[[:space:]]*"\.\./\.\./modules/product-artifact-infra"' "$STAGING" \
  || fail "platform-staging must use relative source ../../modules/product-artifact-infra"
if grep -Eq 'ref=main|ref=master' "$STAGING"; then
  fail "platform-staging must not float on ref=main/master"
fi
# platform-staging must pass Object Lock retention explicitly (not only module defaults)
for needle in s3_object_lock_default_retention_mode s3_object_lock_default_retention_days s3_force_destroy; do
  grep -Eq "$needle" "$STAGING" || fail "platform-staging main.tf must set $needle explicitly"
  grep -Eq "$needle" "$ROOT/environments/platform-staging/variables.tf" \
    || fail "platform-staging variables.tf must declare $needle"
done
grep -Eq 'artifact_bucket_object_lock_enabled' "$ROOT/environments/platform-staging/outputs.tf" \
  || fail "platform-staging must expose artifact_bucket_object_lock_enabled"
pass "platform-staging uses relative module source and explicit Object Lock inputs"

# --- 10. backend.tf and live tfvars must not be committed examples as live ---
if [ -f "$ROOT/environments/platform-staging/backend.tf" ]; then
  fail "environments/platform-staging/backend.tf must not be committed (use backend.tf.example)"
fi
if [ -f "$ROOT/environments/platform-staging/terraform.tfvars" ]; then
  fail "environments/platform-staging/terraform.tfvars must not be committed (use .example)"
fi
pass "no live backend.tf or terraform.tfvars in platform-staging"

# --- 11. Negative: ensure least-privilege comments / no s3:* on bucket root without prefix ---
if grep -Eq 'Action[[:space:]]*=[[:space:]]*"s3:\*"' "$MOD/iam_oidc.tf"; then
  fail "S3 publisher policy must not grant s3:*"
fi
if grep -Eq 'Action[[:space:]]*=[[:space:]]*"\*"' "$MOD/iam_oidc.tf"; then
  fail "IAM publisher policies must not grant Action \"*\""
fi
pass "no wildcard Action s3:* or * in publisher policies"

log "All offline IAM trust/prefix guardrails passed"
echo "PASS: product-artifact-infra IAM contracts"
