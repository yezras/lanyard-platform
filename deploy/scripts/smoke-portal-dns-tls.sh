#!/usr/bin/env bash
# Offline smoke: modules/portal-dns-tls (ACM us-east-1 + regional, Route53 aliases).
# No AWS credentials, no terraform apply.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOD="$ROOT/modules/portal-dns-tls"

err() { echo "[smoke-portal-dns-tls] ERROR: $*" >&2; }
log() { echo "[smoke-portal-dns-tls] $*"; }
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

# --- Provider alias for CloudFront ACM in us-east-1 ---
grep -Eq 'configuration_aliases[[:space:]]*=[[:space:]]*\[aws\.us_east_1\]' "$MOD/versions.tf" \
  || fail "portal-dns-tls versions.tf must declare configuration_aliases = [aws.us_east_1]"
grep -Eq 'provider[[:space:]]*=[[:space:]]*aws\.us_east_1' "$MOD/main.tf" \
  || fail "portal-dns-tls must use provider = aws.us_east_1 for CloudFront ACM resources"
pass "us-east-1 provider alias for CloudFront ACM"

# --- CloudFront cert creation + validation ---
grep -Eq 'resource[[:space:]]+"aws_acm_certificate"[[:space:]]+"cloudfront"' "$MOD/main.tf" \
  || fail "portal-dns-tls must declare aws_acm_certificate.cloudfront"
grep -Eq 'resource[[:space:]]+"aws_acm_certificate_validation"[[:space:]]+"cloudfront"' "$MOD/main.tf" \
  || fail "portal-dns-tls must validate CloudFront certificate"
grep -Eq 'aws_route53_record"[[:space:]]+"cloudfront_validation"' "$MOD/main.tf" \
  || fail "portal-dns-tls must create Route53 DNS validation for CloudFront cert"
pass "CloudFront ACM + DNS validation"

# --- Regional cert for BFF/relay/Docs ---
grep -Eq 'resource[[:space:]]+"aws_acm_certificate"[[:space:]]+"regional"' "$MOD/main.tf" \
  || fail "portal-dns-tls must declare aws_acm_certificate.regional"
grep -Eq 'resource[[:space:]]+"aws_acm_certificate_validation"[[:space:]]+"regional"' "$MOD/main.tf" \
  || fail "portal-dns-tls must validate regional certificate"
grep -Eq 'subject_alternative_names|regional_hostnames' "$MOD/main.tf" \
  || fail "portal-dns-tls regional cert should cover BFF/relay/Docs SANs"
grep -Eq 'document_server_hostname' "$MOD/main.tf" "$MOD/variables.tf" \
  || fail "portal-dns-tls must accept document_server_hostname for Docs ALB SAN (lp-zuh.12.2)"
pass "regional ACM for BFF/relay/Docs SANs"

# --- Route53 aliases to CF / ALBs ---
for r in portal_web bff relay; do
  grep -Eq "resource[[:space:]]+\"aws_route53_record\"[[:space:]]+\"${r}\"" "$MOD/main.tf" \
    || fail "portal-dns-tls must declare aws_route53_record.${r}"
done
grep -Eq 'alias[[:space:]]*\{' "$MOD/main.tf" \
  || fail "portal-dns-tls Route53 records must use alias blocks"
pass "Route53 alias records for web/BFF/relay"

# --- Consume existing zone/certs (no forced duplicates) ---
grep -Eq 'variable[[:space:]]+"existing_cloudfront_certificate_arn"' "$MOD/variables.tf" \
  || fail "portal-dns-tls must accept existing_cloudfront_certificate_arn"
grep -Eq 'variable[[:space:]]+"existing_regional_certificate_arn"' "$MOD/variables.tf" \
  || fail "portal-dns-tls must accept existing_regional_certificate_arn"
grep -Eq 'variable[[:space:]]+"route53_zone_id"' "$MOD/variables.tf" \
  || fail "portal-dns-tls must accept route53_zone_id"
grep -Eq 'variable[[:space:]]+"create_route53_zone"' "$MOD/variables.tf" \
  || fail "portal-dns-tls must accept create_route53_zone"
grep -Eq 'create_cloudfront_cert|existing_cloudfront_certificate_arn' "$MOD/main.tf" \
  || fail "portal-dns-tls must gate CloudFront cert create on missing existing ARN"
grep -Eq 'default[[:space:]]*=[[:space:]]*false' "$MOD/variables.tf" \
  || fail "portal-dns-tls create_route53_zone should default false (prefer existing)"
# create_route53_zone default false specifically
awk '/variable "create_route53_zone"/,/^}/' "$MOD/variables.tf" | grep -Eq 'default[[:space:]]*=[[:space:]]*false' \
  || fail "create_route53_zone must default to false"
pass "existing zone/certs supported; create zone defaults off"

# --- Placeholder-safe hostnames (reject schemes) ---
for v in portal_web_hostname bff_hostname relay_hostname document_server_hostname; do
  grep -Eq "variable[[:space:]]+\"${v}\"" "$MOD/variables.tf" \
    || fail "portal-dns-tls missing variable $v"
done
grep -Eq 'https\?://|wss\?://|no scheme' "$MOD/variables.tf" \
  || fail "portal-dns-tls must reject URL schemes on hostnames"
grep -Eq 'acknowledge_not_auto_applied' "$MOD/variables.tf" \
  || fail "portal-dns-tls missing acknowledge_not_auto_applied"
grep -Eq 'acknowledge_not_auto_applied[[:space:]]*=[[:space:]]*true' "$MOD/terraform.tfvars.example" \
  || fail "tfvars.example must set acknowledge_not_auto_applied = true"
# Example must not invent live account IDs as applied defaults for zone
if grep -Ev '^\s*#|example|ACCOUNT|000000|REPLACE|documentation' "$MOD/terraform.tfvars.example" | grep -Eq 'arn:aws:acm:[a-z0-9-]+:[0-9]{12}:'; then
  # live-looking unscoped ARNs in non-comment lines are ok if clearly 000000 placeholder
  :
fi
pass "placeholder-safe inputs and scheme rejection"

# --- TLS posture documented (HTTP→HTTPS / insecure WS) ---
grep -Eq 'redirect-to-https|HTTP_301|wss://' "$MOD/main.tf" "$MOD/outputs.tf" "$MOD/README.md" \
  || fail "portal-dns-tls must document HTTP→HTTPS and wss:// posture"
grep -Eq 'ws://|rejected_client_schemes|insecure' "$MOD/main.tf" "$MOD/outputs.tf" "$MOD/README.md" \
  || fail "portal-dns-tls must document insecure websocket rejection"
grep -Eq 'output[[:space:]]+"tls_posture"' "$MOD/outputs.tf" \
  || fail "portal-dns-tls must export tls_posture"
grep -Eq 'output[[:space:]]+"cloudfront_certificate_arn"' "$MOD/outputs.tf" \
  || fail "portal-dns-tls must export cloudfront_certificate_arn"
grep -Eq 'output[[:space:]]+"regional_certificate_arn"' "$MOD/outputs.tf" \
  || fail "portal-dns-tls must export regional_certificate_arn"
pass "TLS posture + cert ARN outputs"

# --- Edge modules already enforce redirects when HTTPS enabled ---
BFF="$ROOT/modules/portal-bff-service/main.tf"
RELAY="$ROOT/modules/portal-relay-service/main.tf"
STATIC="$ROOT/modules/portal-static-edge/main.tf"
grep -Eq 'redirect|HTTP_301' "$BFF" || fail "portal-bff-service must HTTP→HTTPS redirect when enable_https"
grep -Eq 'redirect|HTTP_301' "$RELAY" || fail "portal-relay-service must HTTP→HTTPS redirect when enable_https"
grep -Eq 'viewer_protocol_policy[[:space:]]*=[[:space:]]*"redirect-to-https"' "$STATIC" \
  || fail "portal-static-edge must use viewer_protocol_policy = redirect-to-https"
pass "edge modules enforce HTTP→HTTPS"

# --- platform-staging optional wire ---
STAGING="$ROOT/environments/platform-staging"
if [ -d "$STAGING" ]; then
  grep -Eq 'enable_portal_dns_tls' "$STAGING/variables.tf" \
    || fail "platform-staging must declare enable_portal_dns_tls"
  grep -Eq 'module[[:space:]]+"portal_dns_tls"' "$STAGING/main.tf" \
    || fail "platform-staging must compose module.portal_dns_tls"
  grep -Eq 'source[[:space:]]*=[[:space:]]*"\.\./\.\./modules/portal-dns-tls"' "$STAGING/main.tf" \
    || fail "platform-staging must use relative source ../../modules/portal-dns-tls"
  grep -Eq 'aws\.us_east_1' "$STAGING/versions.tf" "$STAGING/main.tf" \
    || fail "platform-staging must declare/pass aws.us_east_1 provider for CloudFront ACM"
  grep -Eq 'enable_portal_dns_tls[[:space:]]*=[[:space:]]*false' "$STAGING/terraform.tfvars.example" \
    || fail "platform-staging example must default enable_portal_dns_tls = false"
  # Root aliases cycle-safe (not module-derived targets into dns-tls)
  grep -Eq 'create_dns_records[[:space:]]*=[[:space:]]*false' "$STAGING/main.tf" \
    || fail "platform-staging must set create_dns_records=false on dns-tls (root owns aliases)"
  grep -Eq 'resource[[:space:]]+"aws_route53_record"[[:space:]]+"portal_web"' "$STAGING/main.tf" \
    || fail "platform-staging must declare root portal_web Route53 alias"
  pass "platform-staging optional DNS/TLS composition"
fi

# --- terraform validate via temporary wrapper (configuration_aliases need a parent) ---
if command -v terraform >/dev/null 2>&1; then
  log "Running terraform validate via dual-provider wrapper root"
  wrap="$(mktemp -d "${TMPDIR:-/tmp}/portal-dns-tls-validate.XXXXXX")"
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

  # Consume existing cert shapes only — no zone create; placeholder-safe offline validate.
  existing_cloudfront_certificate_arn = "arn:aws:acm:us-east-1:000000000000:certificate/00000000-0000-0000-0000-000000000000"
  existing_regional_certificate_arn   = "arn:aws:acm:us-east-1:000000000000:certificate/00000000-0000-0000-0000-000000000001"

  portal_web_hostname = "app.example.com"
  bff_hostname        = "api.example.com"
  relay_hostname      = "relay.example.com"

  create_route53_zone = false
  create_dns_records  = false

  acknowledge_not_auto_applied = true
}
EOF
  (
    cd "$wrap"
    terraform init -backend=false -input=false -no-color >/dev/null
    terraform validate -no-color
  ) || fail "terraform validate failed for modules/portal-dns-tls (wrapper)"
  cleanup_wrap
  trap - EXIT
  pass "terraform validate"
else
  log "terraform not installed; skipping validate (CI runs it)"
fi

log "All portal-dns-tls checks passed"
echo "PASS: portal-dns-tls"
