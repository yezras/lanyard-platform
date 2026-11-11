#!/usr/bin/env bash
# Offline smoke: modules/portal-waf (CloudFront us-east-1 + regional ALB WebACLs).
# No AWS credentials, no terraform apply.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOD="$ROOT/modules/portal-waf"

err() { echo "[smoke-portal-waf] ERROR: $*" >&2; }
log() { echo "[smoke-portal-waf] $*"; }
fail() { err "$*"; exit 1; }
pass() { log "OK: $*"; }

require_file() {
  local f="$1"
  [ -f "$f" ] || fail "required file missing: $f"
}

require_dir() {
  local d="$1"
  [ -d "$d" ] || fail "required directory missing: $d"
}

require_dir "$MOD"
for f in versions.tf variables.tf main.tf outputs.tf README.md INDEX.md terraform.tfvars.example; do
  require_file "$MOD/$f"
done
pass "module file set present"

# --- Provider alias for CloudFront-scope WAF in us-east-1 ---
grep -Eq 'configuration_aliases[[:space:]]*=[[:space:]]*\[aws\.us_east_1\]' "$MOD/versions.tf" \
  || fail "portal-waf versions.tf must declare configuration_aliases = [aws.us_east_1]"
grep -Eq 'provider[[:space:]]*=[[:space:]]*aws\.us_east_1' "$MOD/main.tf" \
  || fail "portal-waf must use provider = aws.us_east_1 for CLOUDFRONT WebACL"
grep -Eq 'scope[[:space:]]*=[[:space:]]*"CLOUDFRONT"' "$MOD/main.tf" \
  || fail "portal-waf must declare CLOUDFRONT scope WebACL"
grep -Eq 'scope[[:space:]]*=[[:space:]]*"REGIONAL"' "$MOD/main.tf" \
  || fail "portal-waf must declare REGIONAL scope WebACL"
pass "us-east-1 CLOUDFRONT + REGIONAL scopes"

# --- WebACL resources ---
grep -Eq 'resource[[:space:]]+"aws_wafv2_web_acl"[[:space:]]+"cloudfront"' "$MOD/main.tf" \
  || fail "portal-waf must declare aws_wafv2_web_acl.cloudfront"
grep -Eq 'resource[[:space:]]+"aws_wafv2_web_acl"[[:space:]]+"regional"' "$MOD/main.tf" \
  || fail "portal-waf must declare aws_wafv2_web_acl.regional"
grep -Eq 'resource[[:space:]]+"aws_wafv2_web_acl_association"[[:space:]]+"alb"' "$MOD/main.tf" \
  || fail "portal-waf must declare aws_wafv2_web_acl_association.alb"
pass "WebACL + ALB association resources"

# --- AWS Managed Rules baseline ---
grep -Eq 'AWSManagedRulesCommonRuleSet' "$MOD/main.tf" \
  || fail "portal-waf must include AWSManagedRulesCommonRuleSet"
grep -Eq 'AWSManagedRulesKnownBadInputsRuleSet' "$MOD/main.tf" \
  || fail "portal-waf must include AWSManagedRulesKnownBadInputsRuleSet"
grep -Eq 'rate_based_statement' "$MOD/main.tf" \
  || fail "portal-waf must support optional rate-based rule"
grep -Eq 'variable[[:space:]]+"enable_common_rule_set"' "$MOD/variables.tf" \
  || fail "portal-waf missing enable_common_rule_set"
grep -Eq 'variable[[:space:]]+"enable_known_bad_inputs"' "$MOD/variables.tf" \
  || fail "portal-waf missing enable_known_bad_inputs"
grep -Eq 'variable[[:space:]]+"enable_rate_based_rule"' "$MOD/variables.tf" \
  || fail "portal-waf missing enable_rate_based_rule"
grep -Eq 'variable[[:space:]]+"rate_limit"' "$MOD/variables.tf" \
  || fail "portal-waf missing rate_limit"
pass "managed rules + rate-based knobs"

# --- Enable / association flags ---
grep -Eq 'variable[[:space:]]+"enable_cloudfront_web_acl"' "$MOD/variables.tf" \
  || fail "portal-waf missing enable_cloudfront_web_acl"
grep -Eq 'variable[[:space:]]+"enable_regional_web_acl"' "$MOD/variables.tf" \
  || fail "portal-waf missing enable_regional_web_acl"
grep -Eq 'variable[[:space:]]+"associate_alb_arns"' "$MOD/variables.tf" \
  || fail "portal-waf missing associate_alb_arns"
grep -Eq 'acknowledge_not_auto_applied' "$MOD/variables.tf" \
  || fail "portal-waf missing acknowledge_not_auto_applied"
grep -Eq 'acknowledge_not_auto_applied[[:space:]]*=[[:space:]]*true' "$MOD/terraform.tfvars.example" \
  || fail "tfvars.example must set acknowledge_not_auto_applied = true"
# associate_alb_arns default empty for offline / ACL-only first apply
awk '/variable "associate_alb_arns"/,/^}/' "$MOD/variables.tf" | grep -Eq 'default[[:space:]]*=[[:space:]]*\[\]' \
  || fail "associate_alb_arns must default to []"
pass "optional association + honesty gate"

# --- Outputs ---
for o in cloudfront_web_acl_arn regional_web_acl_arn associated_alb_arns waf_posture consumer_wiring; do
  grep -Eq "output[[:space:]]+\"${o}\"" "$MOD/outputs.tf" \
    || fail "portal-waf must export $o"
done
grep -Eq 'control-plane|never' "$MOD/outputs.tf" "$MOD/README.md" \
  || fail "portal-waf must document never attaching to control-plane ALB"
pass "outputs + control-plane exclusion documented"

# --- Static edge accepts web_acl_id ---
STATIC_VARS="$ROOT/modules/portal-static-edge/variables.tf"
STATIC_MAIN="$ROOT/modules/portal-static-edge/main.tf"
grep -Eq 'variable[[:space:]]+"web_acl_id"' "$STATIC_VARS" \
  || fail "portal-static-edge must accept web_acl_id for CloudFront WAF attach"
grep -Eq 'web_acl_id' "$STATIC_MAIN" \
  || fail "portal-static-edge distribution must set web_acl_id"
pass "portal-static-edge web_acl_id wiring"

# --- platform-staging optional wire ---
STAGING="$ROOT/environments/platform-staging"
if [ -d "$STAGING" ]; then
  grep -Eq 'enable_portal_waf' "$STAGING/variables.tf" \
    || fail "platform-staging must declare enable_portal_waf"
  grep -Eq 'module[[:space:]]+"portal_waf"' "$STAGING/main.tf" \
    || fail "platform-staging must compose module.portal_waf"
  grep -Eq 'source[[:space:]]*=[[:space:]]*"\.\./\.\./modules/portal-waf"' "$STAGING/main.tf" \
    || fail "platform-staging must use relative source ../../modules/portal-waf"
  grep -Eq 'aws\.us_east_1' "$STAGING/versions.tf" "$STAGING/main.tf" \
    || fail "platform-staging must declare/pass aws.us_east_1 for CloudFront WAF"
  grep -Eq 'enable_portal_waf[[:space:]]*=[[:space:]]*false' "$STAGING/terraform.tfvars.example" \
    || fail "platform-staging example must default enable_portal_waf = false (commented or explicit)"
  # Never associate control plane
  if grep -Eq 'portal_control_plane\[0\]\.alb_arn' "$STAGING/main.tf"; then
    # only fail if used as WAF association input
    if awk '/module "portal_waf"/,/^}/' "$STAGING/main.tf" | grep -Eq 'portal_control_plane'; then
      fail "platform-staging must not associate portal-waf with control-plane ALB"
    fi
  fi
  grep -Eq 'web_acl_id' "$STAGING/main.tf" \
    || fail "platform-staging must pass web_acl_id into static edge when WAF enabled"
  pass "platform-staging optional WAF composition"
fi

# --- terraform validate via temporary wrapper (configuration_aliases need a parent) ---
if command -v terraform >/dev/null 2>&1; then
  log "Running terraform validate via dual-provider wrapper root"
  wrap="$(mktemp -d "${TMPDIR:-/tmp}/portal-waf-validate.XXXXXX")"
  cleanup_wrap() { rm -rf "$wrap"; }
  trap cleanup_wrap EXIT
  cat >"$wrap/main.tf" <<EOF
terraform {
  required_version = ">= 1.7.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

module "under_test" {
  source = "$MOD"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  name_prefix = "lanyard-portal-staging"
  environment = "staging"

  enable_cloudfront_web_acl = true
  enable_regional_web_acl   = true
  enable_common_rule_set    = true
  enable_known_bad_inputs   = true
  enable_rate_based_rule    = true
  rate_limit                = 2000

  # ACL-only offline validate (no live ALB associations)
  associate_alb_arns = []

  acknowledge_not_auto_applied = true
}
EOF
  (
    cd "$wrap"
    terraform init -backend=false -input=false -no-color >/dev/null
    terraform validate -no-color
  ) || fail "terraform validate failed for modules/portal-waf (wrapper)"
  cleanup_wrap
  trap - EXIT
  pass "terraform validate"
else
  log "terraform not installed; skipping validate (CI runs it)"
fi

log "All portal-waf checks passed"
echo "PASS: portal-waf"
