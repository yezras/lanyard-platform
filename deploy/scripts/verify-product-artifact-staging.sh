#!/usr/bin/env bash
# Live (optional) post-apply verifier for product-artifact staging landing zones.
#
# Does NOT invent or commit account IDs. Requires operator-supplied env:
#   ARTIFACT_BUCKET              (required) applied bucket name
#   NAME_PREFIX                  (required if EXPECT_OIDC_PUBLISHERS=1 or for full ECR checks)
#   AWS_REGION                   (optional; default us-east-1)
#   EXPECT_OIDC_PUBLISHERS       (optional; 0|1, default 0)
#   GITHUB_OIDC_PROVIDER_ARN     (optional; when set, must match list and be unique GitHub OIDC)
#   GITHUB_ORG                   (optional; default LanyardBrain)
#   SKIP_IAM_SIMULATION          (optional; 0|1, default 0) skip denied-prefix simulate
#   REQUIRE_STAGING_NAME         (optional; 0|1, default 1) require "staging" in bucket + prefix
#
# Safe to run without apply: fails closed if resources missing.
# Offline contract tests remain scripts/smoke-product-artifact-iam.sh (no AWS).
set -euo pipefail

REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
ARTIFACT_BUCKET="${ARTIFACT_BUCKET:-}"
NAME_PREFIX="${NAME_PREFIX:-}"
EXPECT_OIDC_PUBLISHERS="${EXPECT_OIDC_PUBLISHERS:-0}"
GITHUB_OIDC_PROVIDER_ARN="${GITHUB_OIDC_PROVIDER_ARN:-}"
GITHUB_ORG="${GITHUB_ORG:-LanyardBrain}"
SKIP_IAM_SIMULATION="${SKIP_IAM_SIMULATION:-0}"
REQUIRE_STAGING_NAME="${REQUIRE_STAGING_NAME:-1}"

PORTAL_SERVICES=(web bff relay control-plane)

err() { echo "[verify-product-artifact-staging] ERROR: $*" >&2; }
log() { echo "[verify-product-artifact-staging] $*"; }
fail() { err "$*"; exit 1; }
pass() { log "OK: $*"; }
warn() { log "WARN: $*"; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

publisher_role_name() {
  # key -> role name
  case "$1" in
    portal) echo "${NAME_PREFIX}-gha-portal" ;;
    hermes) echo "${NAME_PREFIX}-gha-hermes" ;;
    client_core) echo "${NAME_PREFIX}-gha-client_core" ;;
    *) fail "unknown publisher key: $1" ;;
  esac
}

publisher_repo_name() {
  case "$1" in
    portal) echo "Portal" ;;
    hermes) echo "hermes-lanyard" ;;
    client_core) echo "client-core" ;;
    *) fail "unknown publisher key: $1" ;;
  esac
}

need_cmd aws
need_cmd jq

if [[ -z "$ARTIFACT_BUCKET" ]]; then
  fail "ARTIFACT_BUCKET is required (terraform output -raw artifact_bucket_id)"
fi

if [[ "$REQUIRE_STAGING_NAME" == "1" ]]; then
  echo "$ARTIFACT_BUCKET" | grep -qi 'staging' \
    || fail "ARTIFACT_BUCKET must contain 'staging' when REQUIRE_STAGING_NAME=1 (got: $ARTIFACT_BUCKET)"
fi

if [[ "$EXPECT_OIDC_PUBLISHERS" == "1" && -z "$NAME_PREFIX" ]]; then
  fail "NAME_PREFIX is required when EXPECT_OIDC_PUBLISHERS=1"
fi

if [[ -z "$NAME_PREFIX" ]]; then
  warn "NAME_PREFIX unset — set NAME_PREFIX for full ECR + OIDC publisher verify"
fi

if [[ -n "$NAME_PREFIX" && "$REQUIRE_STAGING_NAME" == "1" ]]; then
  echo "$NAME_PREFIX" | grep -qi 'staging' \
    || fail "NAME_PREFIX must contain 'staging' when REQUIRE_STAGING_NAME=1"
fi

# ---------------------------------------------------------------------------
# 0. Caller identity (operator must confirm platform staging)
# ---------------------------------------------------------------------------
CALLER_JSON="$(aws sts get-caller-identity --output json)"
ACCOUNT_ID="$(echo "$CALLER_JSON" | jq -r '.Account')"
CALLER_ARN="$(echo "$CALLER_JSON" | jq -r '.Arn')"
log "caller Account=$ACCOUNT_ID Arn=$CALLER_ARN"
log "region=$REGION bucket=$ARTIFACT_BUCKET name_prefix=${NAME_PREFIX:-<unset>} expect_oidc=$EXPECT_OIDC_PUBLISHERS"
log "CONFIRM this is the Lanyard platform staging account before treating results as production evidence."
pass "sts get-caller-identity succeeded"

# ---------------------------------------------------------------------------
# 1. S3: versioning, Object Lock, encryption, public block, TLS-only policy
# ---------------------------------------------------------------------------
log "--- S3 bucket contract ---"

if ! aws s3api head-bucket --bucket "$ARTIFACT_BUCKET" --region "$REGION" >/dev/null 2>&1; then
  fail "S3 bucket not found or not accessible: $ARTIFACT_BUCKET (region=$REGION)"
fi

VER_STATUS="$(aws s3api get-bucket-versioning --bucket "$ARTIFACT_BUCKET" --region "$REGION" --output json \
  | jq -r '.Status // empty')"
[[ "$VER_STATUS" == "Enabled" ]] || fail "versioning Status must be Enabled (got: ${VER_STATUS:-none})"
pass "S3 versioning Enabled"

# Object Lock configuration (fails if Object Lock not enabled on bucket)
if ! LOCK_JSON="$(aws s3api get-object-lock-configuration --bucket "$ARTIFACT_BUCKET" --region "$REGION" --output json 2>/dev/null)"; then
  fail "get-object-lock-configuration failed — Object Lock must be enabled at bucket creation"
fi
LOCK_ENABLED="$(echo "$LOCK_JSON" | jq -r '.ObjectLockConfiguration.ObjectLockEnabled // empty')"
[[ "$LOCK_ENABLED" == "Enabled" ]] || fail "ObjectLockEnabled must be Enabled"
LOCK_MODE="$(echo "$LOCK_JSON" | jq -r '.ObjectLockConfiguration.Rule.DefaultRetention.Mode // empty')"
LOCK_DAYS="$(echo "$LOCK_JSON" | jq -r '.ObjectLockConfiguration.Rule.DefaultRetention.Days // empty')"
[[ -n "$LOCK_MODE" && -n "$LOCK_DAYS" ]] || fail "default Object Lock retention mode/days missing"
pass "S3 Object Lock Enabled (default $LOCK_MODE / ${LOCK_DAYS}d)"

ENC_JSON="$(aws s3api get-bucket-encryption --bucket "$ARTIFACT_BUCKET" --region "$REGION" --output json)"
SSE_ALGO="$(echo "$ENC_JSON" | jq -r '.ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm // empty')"
[[ "$SSE_ALGO" == "AES256" || "$SSE_ALGO" == "aws:kms" ]] \
  || fail "SSE algorithm must be AES256 or aws:kms (got: ${SSE_ALGO:-none})"
pass "S3 encryption SSEAlgorithm=$SSE_ALGO"

PAB_JSON="$(aws s3api get-public-access-block --bucket "$ARTIFACT_BUCKET" --region "$REGION" --output json)"
for flag in BlockPublicAcls IgnorePublicAcls BlockPublicPolicy RestrictPublicBuckets; do
  val="$(echo "$PAB_JSON" | jq -r ".PublicAccessBlockConfiguration.$flag")"
  [[ "$val" == "true" ]] || fail "public access block $flag must be true (got: $val)"
done
pass "S3 public access block all four flags true"

POLICY_JSON="$(aws s3api get-bucket-policy --bucket "$ARTIFACT_BUCKET" --region "$REGION" --output json \
  | jq -r '.Policy')"
echo "$POLICY_JSON" | jq -e '
  .Statement
  | map(select(
      (.Effect == "Deny")
      and (
        (.Action == "s3:*")
        or ((.Action | type) == "array" and (any(.; . == "s3:*")))
      )
      and (
        (.Condition.Bool["aws:SecureTransport"] | tostring) == "false"
      )
    ))
  | length > 0
' >/dev/null \
  || fail "bucket policy missing Deny when aws:SecureTransport is false (TLS-only contract)"
pass "S3 TLS-only Deny SecureTransport=false present"

# ---------------------------------------------------------------------------
# 2. ECR: IMMUTABLE + scan on push for portal services
# ---------------------------------------------------------------------------
log "--- ECR repository contract ---"

if [[ -z "$NAME_PREFIX" ]]; then
  warn "skipping named ECR checks (set NAME_PREFIX)"
else
  for svc in "${PORTAL_SERVICES[@]}"; do
    repo_name="${NAME_PREFIX}/portal/${svc}"
    if ! REPO_JSON="$(aws ecr describe-repositories --repository-names "$repo_name" --region "$REGION" --output json 2>/dev/null)"; then
      fail "ECR repository missing: $repo_name"
    fi
    mut="$(echo "$REPO_JSON" | jq -r '.repositories[0].imageTagMutability // empty')"
    [[ "$mut" == "IMMUTABLE" ]] || fail "ECR $repo_name imageTagMutability must be IMMUTABLE (got: $mut)"
    scan="$(echo "$REPO_JSON" | jq -r '.repositories[0].imageScanningConfiguration.scanOnPush // false')"
    [[ "$scan" == "true" ]] || fail "ECR $repo_name scanOnPush must be true"
    pass "ECR $repo_name IMMUTABLE + scanOnPush"
  done
fi

# ---------------------------------------------------------------------------
# 3. OIDC provider reuse / single provider
# ---------------------------------------------------------------------------
log "--- OIDC provider contract ---"

OIDC_LIST_JSON="$(aws iam list-open-id-connect-providers --output json)"
mapfile -t OIDC_ARNS < <(echo "$OIDC_LIST_JSON" | jq -r '.OpenIDConnectProviderList[].Arn // empty')

GITHUB_OIDC_ARNS=()
for arn in "${OIDC_ARNS[@]+"${OIDC_ARNS[@]}"}"; do
  if [[ "$arn" == *":oidc-provider/token.actions.githubusercontent.com" ]]; then
    GITHUB_OIDC_ARNS+=("$arn")
  fi
done

if [[ "${#GITHUB_OIDC_ARNS[@]}" -gt 1 ]]; then
  fail "multiple GitHub OIDC providers found (${#GITHUB_OIDC_ARNS[@]}) — reconcile; never create a second for product-artifact-infra"
fi

if [[ -n "$GITHUB_OIDC_PROVIDER_ARN" ]]; then
  if [[ "${#GITHUB_OIDC_ARNS[@]}" -eq 0 ]]; then
    fail "GITHUB_OIDC_PROVIDER_ARN set but no GitHub OIDC provider exists in account"
  fi
  if [[ "${GITHUB_OIDC_ARNS[0]}" != "$GITHUB_OIDC_PROVIDER_ARN" ]]; then
    fail "GITHUB_OIDC_PROVIDER_ARN does not match account provider (${GITHUB_OIDC_ARNS[0]})"
  fi
  pass "GitHub OIDC provider ARN matches (single provider reused)"
elif [[ "${#GITHUB_OIDC_ARNS[@]}" -eq 1 ]]; then
  pass "exactly one GitHub OIDC provider present (ARN not asserted via env)"
elif [[ "$EXPECT_OIDC_PUBLISHERS" == "1" ]]; then
  fail "EXPECT_OIDC_PUBLISHERS=1 but no GitHub OIDC provider in account"
else
  warn "no GitHub OIDC provider in account (OK if publishers not enabled yet)"
fi

# ---------------------------------------------------------------------------
# 4. Publisher roles: trust subjects + denied-prefix simulation
# ---------------------------------------------------------------------------
if [[ "$EXPECT_OIDC_PUBLISHERS" != "1" ]]; then
  log "EXPECT_OIDC_PUBLISHERS!=1 — skipping publisher role trust and IAM simulation"
  log "ALL CHECKS PASSED (S3/ECR core; OIDC publishers not required this run)"
  exit 0
fi

log "--- OIDC publisher roles ---"

for key in portal hermes client_core; do
  role_name="$(publisher_role_name "$key")"
  repo_name="$(publisher_repo_name "$key")"
  if ! ROLE_JSON="$(aws iam get-role --role-name "$role_name" --output json 2>/dev/null)"; then
    fail "publisher role missing: $role_name"
  fi
  trust="$(echo "$ROLE_JSON" | jq -c '.Role.AssumeRolePolicyDocument')"
  # Flatten StringLike sub claim(s)
  subs="$(echo "$trust" | jq -r '
    .Statement[]?
    | select(
        .Action == "sts:AssumeRoleWithWebIdentity"
        or ((.Action | type) == "array" and (any(.; . == "sts:AssumeRoleWithWebIdentity")))
      )
    | .Condition.StringLike["token.actions.githubusercontent.com:sub"]
    | if type == "array" then .[] else . end
  ' 2>/dev/null || true)"
  expected_sub="repo:${GITHUB_ORG}/${repo_name}:ref:refs/tags/*"
  if ! echo "$subs" | grep -Fqx "$expected_sub"; then
    fail "role $role_name missing trust subject $expected_sub (got: ${subs:-none})"
  fi
  if echo "$subs" | grep -Eq 'ref:refs/heads/(main|master)'; then
    fail "role $role_name must not trust refs/heads/main or master by default"
  fi
  pass "role $role_name trusts $expected_sub only (tags)"
done

if [[ "$SKIP_IAM_SIMULATION" == "1" ]]; then
  warn "SKIP_IAM_SIMULATION=1 — skipping denied-prefix simulation"
  log "ALL CHECKS PASSED (with IAM simulation skipped)"
  exit 0
fi

log "--- Denied-path IAM simulation ---"

simulate_put() {
  local role_arn="$1"
  local object_key="$2"
  aws iam simulate-principal-policy \
    --policy-source-arn "$role_arn" \
    --action-names s3:PutObject \
    --resource-arns "arn:aws:s3:::${ARTIFACT_BUCKET}/${object_key}" \
    --output json
}

role_arn_for() {
  aws iam get-role --role-name "$1" --query 'Role.Arn' --output text
}

decision_is_deny() {
  case "$1" in
    implicitDeny|explicitDeny) return 0 ;;
    *) return 1 ;;
  esac
}

HERMES_ARN="$(role_arn_for "$(publisher_role_name hermes)")"
PORTAL_ARN="$(role_arn_for "$(publisher_role_name portal)")"
CLIENT_ARN="$(role_arn_for "$(publisher_role_name client_core)")"

# Hermes may write hermes/ only
H_OK="$(simulate_put "$HERMES_ARN" "hermes/v0.0.0-verify/probe.tar.gz" | jq -r '.EvaluationResults[0].EvalDecision')"
[[ "$H_OK" == "allowed" ]] || fail "hermes role should allow PutObject under hermes/ (got: $H_OK)"
pass "hermes role allowed on hermes/ prefix"

H_DENY_CC="$(simulate_put "$HERMES_ARN" "client-core/v0.0.0-verify/probe.tar.gz" | jq -r '.EvaluationResults[0].EvalDecision')"
decision_is_deny "$H_DENY_CC" \
  || fail "hermes role must deny PutObject under client-core/ (got: $H_DENY_CC)"
pass "hermes role denied on client-core/ prefix"

H_DENY_PW="$(simulate_put "$HERMES_ARN" "portal-web/v0.0.0-verify/portal-web.tar.gz" | jq -r '.EvaluationResults[0].EvalDecision')"
decision_is_deny "$H_DENY_PW" \
  || fail "hermes role must deny PutObject under portal-web/ (got: $H_DENY_PW)"
pass "hermes role denied on portal-web/ prefix"

# Portal may write portal-web/ only (not hermes/)
P_OK="$(simulate_put "$PORTAL_ARN" "portal-web/v0.0.0-verify/portal-web.tar.gz" | jq -r '.EvaluationResults[0].EvalDecision')"
[[ "$P_OK" == "allowed" ]] || fail "portal role should allow PutObject under portal-web/ (got: $P_OK)"
pass "portal role allowed on portal-web/ prefix"

P_DENY_H="$(simulate_put "$PORTAL_ARN" "hermes/v0.0.0-verify/probe.tar.gz" | jq -r '.EvaluationResults[0].EvalDecision')"
decision_is_deny "$P_DENY_H" \
  || fail "portal role must deny PutObject under hermes/ (got: $P_DENY_H)"
pass "portal role denied on hermes/ prefix"

# client_core may write client-core/ only
C_OK="$(simulate_put "$CLIENT_ARN" "client-core/v0.0.0-verify/probe.tar.gz" | jq -r '.EvaluationResults[0].EvalDecision')"
[[ "$C_OK" == "allowed" ]] || fail "client_core role should allow PutObject under client-core/ (got: $C_OK)"
pass "client_core role allowed on client-core/ prefix"

C_DENY_H="$(simulate_put "$CLIENT_ARN" "hermes/v0.0.0-verify/probe.tar.gz" | jq -r '.EvaluationResults[0].EvalDecision')"
decision_is_deny "$C_DENY_H" \
  || fail "client_core role must deny PutObject under hermes/ (got: $C_DENY_H)"
pass "client_core role denied on hermes/ prefix"

log "ALL CHECKS PASSED (S3 + ECR + OIDC + denied-prefix simulation)"
exit 0
