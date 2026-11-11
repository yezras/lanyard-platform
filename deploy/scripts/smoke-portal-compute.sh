#!/usr/bin/env bash
# Offline smoke: G8 Portal compute modules (static edge + BFF + relay + private CP).
# No AWS credentials, no terraform apply.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

err() { echo "[smoke-portal-compute] ERROR: $*" >&2; }
log() { echo "[smoke-portal-compute] $*"; }
fail() { err "$*"; exit 1; }

require_file() {
  local f="$1"
  [ -f "$f" ] || fail "required file missing: $f"
}

require_dir() {
  local d="$1"
  [ -d "$d" ] || fail "required directory missing: $d"
}

STATIC="$ROOT/modules/portal-static-edge"
BFF="$ROOT/modules/portal-bff-service"
RELAY="$ROOT/modules/portal-relay-service"
CP="$ROOT/modules/portal-control-plane-service"

for d in "$STATIC" "$BFF" "$RELAY" "$CP"; do
  require_dir "$d"
  for f in versions.tf variables.tf main.tf outputs.tf README.md INDEX.md terraform.tfvars.example; do
    require_file "$d/$f"
  done
done

# --- Static edge: private origin + OAC ---
grep -Eq 'aws_cloudfront_origin_access_control' "$STATIC/main.tf" \
  || fail "portal-static-edge must use CloudFront OAC"
grep -Eq 'block_public_acls[[:space:]]*=[[:space:]]*true' "$STATIC/main.tf" \
  || fail "portal-static-edge must block public ACLs"
grep -Eq 'block_public_policy[[:space:]]*=[[:space:]]*true' "$STATIC/main.tf" \
  || fail "portal-static-edge must block public bucket policy"
grep -Eq 'restrict_public_buckets[[:space:]]*=[[:space:]]*true' "$STATIC/main.tf" \
  || fail "portal-static-edge must restrict public buckets"
grep -Eq 'aws:SecureTransport' "$STATIC/main.tf" \
  || fail "portal-static-edge must deny non-TLS S3 access"
grep -Eq 'acknowledge_not_auto_applied' "$STATIC/variables.tf" \
  || fail "portal-static-edge missing acknowledge_not_auto_applied"
grep -Eq 'static_web_artifact_url|static_web_artifact_version|static_web_artifact_sha256' "$STATIC/variables.tf" \
  || fail "portal-static-edge must accept static web pin fields"
grep -Eq 'acknowledge_not_auto_applied[[:space:]]*=[[:space:]]*true' "$STATIC/terraform.tfvars.example" \
  || fail "static-edge example must set acknowledge_not_auto_applied = true"

# --- Static edge: BFF API ordered behaviors (path-first /*/api/* + bare /api/*) ---
# Dual ordered_cache_behavior when bff_origin_enabled (lp-b87.1):
#   1) api_path_pattern (default /*/api/*) — /<tenant_slug>/api/*
#   2) bare_api_path_pattern (default /api/*) — apex public discovery
grep -Eq 'variable[[:space:]]+"bff_origin_domain_name"' "$STATIC/variables.tf" \
  || fail "portal-static-edge missing optional bff_origin_domain_name"
grep -Eq 'variable[[:space:]]+"api_path_pattern"' "$STATIC/variables.tf" \
  || fail "portal-static-edge missing api_path_pattern"
grep -Eq 'default[[:space:]]*=[[:space:]]*"/\*/api/\*"' "$STATIC/variables.tf" \
  || fail "portal-static-edge api_path_pattern default must be /*/api/*"
grep -Eq 'variable[[:space:]]+"bare_api_path_pattern"' "$STATIC/variables.tf" \
  || fail "portal-static-edge missing bare_api_path_pattern (apex /api/* → BFF)"
grep -Eq 'default[[:space:]]*=[[:space:]]*"/api/\*"' "$STATIC/variables.tf" \
  || fail "portal-static-edge bare_api_path_pattern default must be /api/*"
grep -Eq 'path_pattern[[:space:]]*=[[:space:]]*var\.api_path_pattern' "$STATIC/main.tf" \
  || fail "portal-static-edge must emit ordered_cache_behavior for var.api_path_pattern"
grep -Eq 'path_pattern[[:space:]]*=[[:space:]]*var\.bare_api_path_pattern' "$STATIC/main.tf" \
  || fail "portal-static-edge must emit ordered_cache_behavior for var.bare_api_path_pattern"
# Both API behaviors must appear as distinct dynamic ordered_cache_behavior blocks
api_bff_target_count="$(
  grep -c 'target_origin_id[[:space:]]*=[[:space:]]*local\.bff_origin_id' "$STATIC/main.tf" || true
)"
[ "${api_bff_target_count}" -ge 2 ] \
  || fail "portal-static-edge must target local.bff_origin_id from both path-first and bare API behaviors (found ${api_bff_target_count})"
grep -Eq 'bff_origin_enabled' "$STATIC/main.tf" \
  || fail "portal-static-edge must gate BFF origin on bff_origin_enabled"
grep -Eq 'custom_origin_config' "$STATIC/main.tf" \
  || fail "portal-static-edge must define BFF custom_origin_config"
grep -Eq 'origin_protocol_policy' "$STATIC/main.tf" \
  || fail "portal-static-edge BFF origin must set origin_protocol_policy"
# API ordered_cache_behavior must target BFF origin id, not S3
if ! grep -Eq 'target_origin_id[[:space:]]*=[[:space:]]*local\.bff_origin_id' "$STATIC/main.tf"; then
  fail "portal-static-edge API ordered_cache_behavior must target local.bff_origin_id (BFF), not S3"
fi
# Ensure API behavior blocks are not hard-wired to S3 origin id
api_behavior_block="$(
  awk '/for_each = local.bff_origin_enabled/,/^  }$/' "$STATIC/main.tf" || true
)"
echo "$api_behavior_block" | grep -Eq 'target_origin_id[[:space:]]*=[[:space:]]*local\.bff_origin_id' \
  || fail "portal-static-edge BFF ordered_cache_behavior block must set target_origin_id = local.bff_origin_id"
echo "$api_behavior_block" | grep -Eq 'portal-static-s3' \
  && fail "portal-static-edge API ordered_cache_behavior must not target portal-static-s3"
echo "$api_behavior_block" | grep -Eq 'path_pattern[[:space:]]*=[[:space:]]*var\.api_path_pattern' \
  || fail "portal-static-edge BFF dynamic blocks must include path-first api_path_pattern"
echo "$api_behavior_block" | grep -Eq 'path_pattern[[:space:]]*=[[:space:]]*var\.bare_api_path_pattern' \
  || fail "portal-static-edge BFF dynamic blocks must include bare_api_path_pattern"
# Caching disabled (managed CachingDisabled UUID or variable default)
grep -Eq '4135ea2d-6df8-44a3-9df3-4b5a84be39ad|api_cache_policy_id' "$STATIC/main.tf" "$STATIC/variables.tf" \
  || fail "portal-static-edge API behavior must use CachingDisabled (managed policy or api_cache_policy_id)"
grep -Eq 'default[[:space:]]*=[[:space:]]*"4135ea2d-6df8-44a3-9df3-4b5a84be39ad"' "$STATIC/variables.tf" \
  || fail "portal-static-edge api_cache_policy_id default must be CachingDisabled UUID"
# Methods: POST + OPTIONS required for API + CORS preflight
grep -Eq '"POST"' "$STATIC/main.tf" \
  || fail "portal-static-edge API behavior must allow POST"
grep -Eq '"OPTIONS"' "$STATIC/main.tf" \
  || fail "portal-static-edge API behavior must allow OPTIONS"
grep -Eq 'allowed_methods.*=.*\["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"\]|allowed_methods[[:space:]]*=[[:space:]]*\["DELETE"' "$STATIC/main.tf" \
  || fail "portal-static-edge API allowed_methods must include full mutating set + OPTIONS"
# Session cookies / auth headers via origin request policy (AllViewerExceptHostHeader)
grep -Eq '33f36d7e-f396-46d9-90e0-52428a34d9dc|api_origin_request_policy_id' "$STATIC/main.tf" "$STATIC/variables.tf" \
  || fail "portal-static-edge API behavior must forward viewer cookies/headers (origin request policy)"
grep -Eq 'default[[:space:]]*=[[:space:]]*"33f36d7e-f396-46d9-90e0-52428a34d9dc"' "$STATIC/variables.tf" \
  || fail "portal-static-edge api_origin_request_policy_id default must be AllViewerExceptHostHeader UUID"
# Static assets + SPA default still on S3
grep -Eq 'path_pattern[[:space:]]*=[[:space:]]*"/assets/\*"' "$STATIC/main.tf" \
  || fail "portal-static-edge must keep /assets/* static cache behavior"
grep -Eq 'target_origin_id[[:space:]]*=[[:space:]]*local\.s3_origin_id' "$STATIC/main.tf" \
  || fail "portal-static-edge default/static behaviors must target S3 origin"
# Ops SPA /admin* on S3 (lp-2qs.3). Must not steal /api/admin/* (that is bare /api/* → BFF).
grep -Eq 'path_pattern[[:space:]]*=[[:space:]]*"/admin\*"' "$STATIC/main.tf" \
  || fail "portal-static-edge must declare ordered_cache_behavior /admin* for ops SPA"
grep -Eq 'path_pattern[[:space:]]*=[[:space:]]*"/_platform' "$STATIC/main.tf" \
  && fail "portal-static-edge must not add /_platform CloudFront behavior (vault prefix only)"
admin_behavior_block="$(
  grep -A 30 'path_pattern[[:space:]]*=[[:space:]]*"/admin\*"' "$STATIC/main.tf" || true
)"
echo "$admin_behavior_block" | grep -Eq 'target_origin_id[[:space:]]*=[[:space:]]*local\.s3_origin_id' \
  || fail "portal-static-edge /admin* must target S3 (SPA tarball), not BFF"
echo "$admin_behavior_block" | grep -Eq 'local\.bff_origin_id|portal-bff' \
  && fail "portal-static-edge /admin* must not target BFF origin"
grep -Eq 'ops_console_entry|/admin\*' "$STATIC/outputs.tf" \
  || fail "portal-static-edge outputs must surface /admin* ops SPA routing"
# Example stays optional (empty BFF) so validate works without live ALB
grep -Eq 'bff_origin_domain_name[[:space:]]*=[[:space:]]*""' "$STATIC/terraform.tfvars.example" \
  || fail "static-edge example must leave bff_origin_domain_name empty by default"
grep -Eq 'bff_api_routing|bff_api_origin' "$STATIC/outputs.tf" \
  || fail "portal-static-edge must output bff_api_routing status"
grep -Eq 'bare_api_path_pattern' "$STATIC/outputs.tf" \
  || fail "portal-static-edge outputs must surface bare_api_path_pattern for dual API routing"
# Origin protocol: https-only default; http-only allowed for TLS-less pilot ALBs
grep -Eq 'https-only' "$STATIC/variables.tf" \
  || fail "portal-static-edge must document https-only BFF origin protocol"
grep -Eq 'http-only' "$STATIC/variables.tf" \
  || fail "portal-static-edge must document http-only option for TLS-less BFF ALBs"

# --- BFF: digest pin + public ALB + /health + desired_count=1 gate ---
grep -Eq 'image_digest' "$BFF/variables.tf" || fail "portal-bff-service missing image_digest"
grep -Eq 'sha256:\[a-f0-9\]\{64\}|sha256:\[a-f0-9\]\{64\}' "$BFF/variables.tf" \
  || grep -Eq 'sha256:' "$BFF/variables.tf" \
  || fail "portal-bff-service must validate sha256 digest format"
grep -Eq 'health_check_path' "$BFF/variables.tf" || fail "portal-bff-service missing health_check_path"
grep -Eq 'path[[:space:]]*=[[:space:]]*var\.health_check_path|path\s*=\s*var.health_check_path' "$BFF/main.tf" \
  || fail "portal-bff-service target group must use health_check_path"
grep -Eq 'internal[[:space:]]*=[[:space:]]*false' "$BFF/main.tf" \
  || fail "portal-bff-service ALB should be internet-facing (public edge)"
grep -Eq 'acknowledge_g5_scale_beyond_one' "$BFF/variables.tf" \
  || fail "portal-bff-service missing G5 scale gate"
grep -Eq 'desired_count_g5_gate|acknowledge_g5_scale_beyond_one' "$BFF/main.tf" \
  || fail "portal-bff-service must gate desired_count > 1 on G5"
# Literal Terraform interpolation string in source (not shell expansion).
# shellcheck disable=SC2016
if ! grep -Fq '@${var.image_digest}' "$BFF/main.tf"; then
  fail "portal-bff-service must pin image as repository@digest"
fi
# G1.3: BFF .tf must not couple control-plane naming to public ALB patterns
if grep -Eiq 'control[-_]?plane' "$BFF/main.tf" "$BFF/outputs.tf" "$BFF/variables.tf"; then
  fail "portal-bff-service .tf must not mention control-plane (avoid public-ALB G1.3 false patterns; keep CP in its own module)"
fi

# --- Relay: digest + /health + G6 gate ---
grep -Eq 'image_digest' "$RELAY/variables.tf" || fail "portal-relay-service missing image_digest"
grep -Eq 'health_check_path' "$RELAY/variables.tf" || fail "portal-relay-service missing health_check_path"
grep -Eq 'acknowledge_g6_scale_beyond_one' "$RELAY/variables.tf" \
  || fail "portal-relay-service missing G6 scale gate"
grep -Eq 'desired_count_g6_gate|acknowledge_g6_scale_beyond_one' "$RELAY/main.tf" \
  || fail "portal-relay-service must gate desired_count > 1 on G6"
if grep -Eiq 'control[-_]?plane' "$RELAY/main.tf" "$RELAY/outputs.tf" "$RELAY/variables.tf"; then
  fail "portal-relay-service .tf must not mention control-plane (keep public edge separate from private CP module)"
fi

# --- Control plane: internal ALB only ---
grep -Eq 'internal[[:space:]]*=[[:space:]]*true' "$CP/main.tf" \
  || fail "portal-control-plane-service must hardcode internal = true"
grep -Eq 'var\.internal[[:space:]]*==[[:space:]]*true' "$CP/variables.tf" \
  || fail "portal-control-plane-service must validate internal == true"
if grep -REn 'internal[[:space:]]*=[[:space:]]*false' "$CP" --include='*.tf' 2>/dev/null | grep -Ev 'validation|error_message|#' | grep -q .; then
  fail "portal-control-plane-service must not set internal = false"
fi
grep -Eq 'assign_public_ip[[:space:]]*=[[:space:]]*false' "$CP/main.tf" \
  || fail "portal-control-plane-service tasks must set assign_public_ip = false"
grep -Eq '0\.0\.0\.0/0' "$CP/variables.tf" \
  || fail "portal-control-plane-service must reject 0.0.0.0/0 ingress CIDRs"
grep -Eq 'image_digest' "$CP/variables.tf" || fail "portal-control-plane-service missing image_digest"
grep -Eq 'health_check_path' "$CP/variables.tf" || fail "portal-control-plane-service missing health_check_path"
grep -Eq 'path[[:space:]]*=[[:space:]]*var\.health_check_path' "$CP/main.tf" \
  || fail "portal-control-plane-service TG must use health_check_path"
grep -Eq 'acknowledge_not_auto_applied[[:space:]]*=[[:space:]]*true' "$CP/terraform.tfvars.example" \
  || fail "control-plane example must set acknowledge_not_auto_applied = true"
grep -Eq 'vpc-00000000000000000|subnet-0000000000000000' "$CP/terraform.tfvars.example" \
  || fail "control-plane example must use obvious placeholder VPC/subnet shapes"

# --- Generic SM/SSM secrets injection (all three ECS services) ---
# Contract: map(object({ value_from, optional kms_key_arn })) → ECS secrets + scoped exec IAM.
# Paths covered: SM ARN, SSM ARN, no-secret (default empty), denied wildcard IAM.
for mod in "$BFF" "$RELAY" "$CP"; do
  mod_name="$(basename "$mod")"
  grep -Eq 'variable[[:space:]]+"secrets"' "$mod/variables.tf" \
    || fail "$mod_name missing variable \"secrets\""
  grep -Eq 'value_from' "$mod/variables.tf" \
    || fail "$mod_name secrets object must include value_from"
  grep -Eq 'kms_key_arn' "$mod/variables.tf" \
    || fail "$mod_name secrets object must include optional kms_key_arn"
  # ECS renders secrets (valueFrom), not plaintext secret values in the secrets block
  grep -Eq 'valueFrom' "$mod/main.tf" \
    || fail "$mod_name must render ECS secrets with valueFrom"
  grep -Eq 'secrets_list|effective_secrets' "$mod/main.tf" \
    || fail "$mod_name must build secrets_list / effective_secrets for task definition"
  # IAM: scoped GetSecretValue / GetParameters / kms:Decrypt
  grep -Eq 'secretsmanager:GetSecretValue' "$mod/main.tf" \
    || fail "$mod_name execution role must grant secretsmanager:GetSecretValue for declared SM ARNs"
  grep -Eq 'ssm:GetParameters' "$mod/main.tf" \
    || fail "$mod_name execution role must grant ssm:GetParameters for declared SSM ARNs"
  grep -Eq 'kms:Decrypt' "$mod/main.tf" \
    || fail "$mod_name execution role must grant kms:Decrypt for declared KMS keys"
  # Denied ARN path: never Resource="*" on secrets IAM (scoped to declared lists only)
  if grep -nE 'secretsmanager:GetSecretValue|ssm:GetParameters|ssm:GetParameter' "$mod/main.tf" | grep -q 'Resource[[:space:]]*=[[:space:]]*"\*"'; then
    fail "$mod_name must not grant secrets/SSM with Resource=\"*\" (declared ARNs only)"
  fi
  # No-secret path: policy only when has_secrets; empty secrets default
  grep -Eq 'count[[:space:]]*=[[:space:]]*local\.has_secrets' "$mod/main.tf" \
    || fail "$mod_name execution_secrets policy must be gated on local.has_secrets (no-secret path)"
  if [ "$mod_name" = "portal-bff-service" ]; then
    grep -Eq 'variable[[:space:]]+"execution_extra_secret_arns"' "$mod/variables.tf" \
      || fail "$mod_name missing execution_extra_secret_arns (IAM-only GetSecretValue; lp-oop.38.20)"
    grep -Eq 'execution_extra_sm_arns' "$mod/main.tf" \
      || fail "$mod_name must union execution_extra_secret_arns into secretsmanager_arns"
    grep -Eq 'execution_extra_secret_arns' "$mod/README.md" \
      || fail "$mod_name README must document execution_extra_secret_arns"
  fi
  grep -Eq 'default[[:space:]]*=[[:space:]]*\{\}' "$mod/variables.tf" \
    || fail "$mod_name secrets variable should default to {} (no-secret path)"
  # Production/staging reject known plaintext secret names in environment_variables
  grep -Eq 'production_rejects_plaintext_secrets' "$mod/main.tf" \
    || fail "$mod_name must check production_rejects_plaintext_secrets"
  grep -Eq 'is_production_like|production-like|prod-like' "$mod/main.tf" \
    || fail "$mod_name must treat production-like environment labels as fail-closed for plaintext secrets"
  grep -Eq '"staging"' "$mod/main.tf" \
    || fail "$mod_name production_like_environments must include staging (platform-staging label)"
  # Outputs: secret names only — never dump secret values
  grep -Eq 'output[[:space:]]+"secret_names"' "$mod/outputs.tf" \
    || fail "$mod_name must output secret_names (names only)"
  if grep -Eq 'output[[:space:]]+"(secret_value|secret_values|plaintext)' "$mod/outputs.tf"; then
    fail "$mod_name must not output secret values"
  fi
  # Examples document SM + SSM shapes (commented placeholders only)
  grep -Eq 'value_from' "$mod/terraform.tfvars.example" \
    || fail "$mod_name terraform.tfvars.example must document secrets value_from"
  grep -Eq 'secretsmanager:' "$mod/terraform.tfvars.example" \
    || fail "$mod_name example must show Secrets Manager ARN shape"
  grep -Eq 'ssm:.*parameter' "$mod/terraform.tfvars.example" \
    || fail "$mod_name example must show SSM parameter ARN shape"
done

# --- OIDC client secret fail-closed (cbd-mta.3.2) — BFF + control plane ---
for mod in "$BFF" "$CP"; do
  mod_name="$(basename "$mod")"
  grep -Eq '"GOOGLE_CLIENT_SECRET"' "$mod/main.tf" \
    || fail "$mod_name must list GOOGLE_CLIENT_SECRET in known plaintext secret names"
  grep -Eq 'oidc_client_secret_never_plain_env' "$mod/main.tf" \
    || fail "$mod_name must check oidc_client_secret_never_plain_env (always reject plain OIDC secrets)"
  grep -Eq 'GOOGLE_CLIENT_SECRET' "$mod/terraform.tfvars.example" \
    || fail "$mod_name example must document GOOGLE_CLIENT_SECRET via secrets map"
  grep -Eq 'GOOGLE_CLIENT_SECRET' "$mod/README.md" \
    || fail "$mod_name README must document GOOGLE_CLIENT_SECRET secrets-map wiring"
done
# Path-first callback / logout URL documentation (BFF edge + staging checklist)
grep -Eq 'auth/google/callback|Authorized redirect' "$BFF/README.md" "$BFF/terraform.tfvars.example" \
  || fail "portal-bff-service must document Google callback / Authorized redirect URI shapes"
grep -Eq 'path-first|app\.withlanyard\.com|tenant_slug' "$BFF/README.md" \
  || fail "portal-bff-service must document path-first OIDC callback hosts"
grep -Eq 'auth/logout|logout' "$BFF/README.md" \
  || fail "portal-bff-service must document app logout route"
grep -Eq 'membership|user_roles|google_sub' "$CP/README.md" \
  || fail "portal-control-plane-service must document membership claims live in CP DB"
# Staging root examples wire optional OIDC secrets maps
grep -Eq 'GOOGLE_CLIENT_SECRET|bff_secrets' \
  "$ROOT/environments/platform-staging/terraform.tfvars.example" \
  || fail "platform-staging example must document optional OIDC bff_secrets"
grep -Eq 'control_plane_secrets|GOOGLE_CLIENT_SECRET' \
  "$ROOT/environments/platform-staging/terraform.tfvars.example" \
  || fail "platform-staging example must document optional control_plane_secrets for OIDC"
# Honesty: G1 stays blocked; no live OIDC proof claim from wiring
grep -Eq 'G1\.4|not.*OIDC.*ready|does \*\*not\*\* flip' \
  "$ROOT/references/runbooks/staging-secrets-checklist.md" \
  "$ROOT/references/runbooks/portal-compute-staging-apply.md" \
  || fail "runbooks must not claim live OIDC proof ready from deploy wiring alone"
if ! grep -Eq '\*\*G1\*\*.*\*\*blocked\*\*|G1.*\*\*blocked\*\*' "$ROOT/references/readiness-matrix.md"; then
  fail "readiness-matrix must keep G1 blocked until live staging OIDC/CP proof"
fi

# CP: legacy database_url_secret_arn → CONTROL_PLANE_DATABASE_URL + DATABASE_URL (SM contract)
grep -Eq 'variable[[:space:]]+"database_url_secret_arn"' "$CP/variables.tf" \
  || fail "portal-control-plane-service must keep database_url_secret_arn (G4.3 compatibility)"
grep -Eq 'variable[[:space:]]+"database_url_secret_format"' "$CP/variables.tf" \
  || fail "portal-control-plane-service must expose database_url_secret_format (json_keys vs plain)"
grep -Eq 'json_keys' "$CP/variables.tf" "$CP/main.tf" \
  || fail "portal-control-plane-service must default database_url_secret_format to json_keys (control-plane-rds)"
grep -Eq 'legacy_database_secret|database_url_secret_arn' "$CP/main.tf" \
  || fail "portal-control-plane-service must merge database_url_secret_arn into effective secrets"
# JSON-key valueFrom form (not bare ARN) for both product env names — bare ARN of a JSON
# secret injects the whole blob and leaves SQLite residual on older CP images.
grep -Eq ':CONTROL_PLANE_DATABASE_URL::' "$CP/main.tf" \
  || fail "portal-control-plane-service must use ECS JSON-key valueFrom …:CONTROL_PLANE_DATABASE_URL::"
grep -Eq ':DATABASE_URL::' "$CP/main.tf" \
  || fail "portal-control-plane-service must twin-inject DATABASE_URL via …:DATABASE_URL:: JSON key"
# Both env names present in legacy inject map
grep -Eq 'CONTROL_PLANE_DATABASE_URL[[:space:]]*=' "$CP/main.tf" \
  || fail "portal-control-plane-service must still inject CONTROL_PLANE_DATABASE_URL"
grep -Eq 'DATABASE_URL[[:space:]]*=' "$CP/main.tf" \
  || fail "portal-control-plane-service must inject DATABASE_URL alongside CONTROL_PLANE_DATABASE_URL"
# Docs warn about bare ARN / JSON key mismatch
grep -Eq 'JSON key|json_keys|bare ARN|whole JSON' "$CP/README.md" "$CP/terraform.tfvars.example" \
  || fail "portal-control-plane-service docs must explain JSON-key vs plain secret valueFrom"
# Public CP still rejected (G1) — reaffirm after DB wiring edits
grep -Eq 'var\.internal[[:space:]]*==[[:space:]]*true' "$CP/variables.tf" \
  || fail "portal-control-plane-service must validate internal == true"
grep -Eq 'internal[[:space:]]*=[[:space:]]*true' "$CP/main.tf" \
  || fail "portal-control-plane-service ALB must hardcode internal = true"

# --- Valkey / REDIS_URL wiring (G5 BFF sessions + G6 relay bus) ---
# Production-like plaintext reject for REDIS_URL; inject only via secrets map + redis_url_secret_arn.
for mod in "$BFF" "$RELAY"; do
  mod_name="$(basename "$mod")"
  grep -Eq '"REDIS_URL"' "$mod/main.tf" \
    || fail "$mod_name must list REDIS_URL in known_plaintext_secret_names (reject plain env)"
  grep -Eq 'portal_valkey|redis_url_secret_arn' "$mod/terraform.tfvars.example" "$mod/README.md" \
    || fail "$mod_name must document portal_valkey / redis_url_secret_arn REDIS_URL wiring"
  grep -Eq 'REDIS_URL' "$mod/terraform.tfvars.example" \
    || fail "$mod_name example must show REDIS_URL secrets entry"
  # Never output secret values / bare redis_url
  if grep -Eq 'output[[:space:]]+"(redis_url|REDIS_URL)"' "$mod/outputs.tf"; then
    fail "$mod_name must not output redis_url / REDIS_URL values"
  fi
done
# BFF: session TTLs + backend flags documented
grep -Eq 'SESSION_TTL|session TTL|7d|604800' "$BFF/README.md" "$BFF/terraform.tfvars.example" \
  || fail "portal-bff-service must document session TTLs for redis-backed sessions"
grep -Eq 'BFF_SESSION_BACKEND' "$BFF/README.md" "$BFF/terraform.tfvars.example" \
  || fail "portal-bff-service must document BFF_SESSION_BACKEND"
# Relay: bus / jti / leases + single-node default
grep -Eq 'owner lease|jti|revocation|RELAY_CLUSTER_MODE' "$RELAY/README.md" \
  || fail "portal-relay-service must document bus/jti/lease/revocation and RELAY_CLUSTER_MODE"
grep -Eq 'fail closed|fail-closed|outage' "$BFF/README.md" "$RELAY/README.md" \
  || fail "BFF/relay READMEs must document store outage fail-closed posture"
# G5/G6 desired_count gates remain fail-closed
grep -Eq 'desired_count_g5_gate' "$BFF/main.tf" \
  || fail "portal-bff-service must keep desired_count_g5_gate"
grep -Eq 'desired_count_g6_gate' "$RELAY/main.tf" \
  || fail "portal-relay-service must keep desired_count_g6_gate"

# --- Runbook + readiness honesty surfaces ---
require_file "$ROOT/references/runbooks/portal-compute-staging-apply.md"
grep -Eqi 'rollback|pin|ordered|acknowledge_not_auto_applied|production-security' \
  "$ROOT/references/runbooks/portal-compute-staging-apply.md" \
  || fail "staging apply runbook must cover order, pins, rollback, security honesty"
grep -Eq 'portal-valkey|redis_url_secret_arn' \
  "$ROOT/references/runbooks/portal-compute-staging-apply.md" \
  || fail "staging apply runbook must wire portal-valkey / redis_url_secret_arn for BFF/relay"

require_file "$ROOT/references/runbooks/staging-secrets-checklist.md"
grep -Eq 'value_from|secrets map|portal-bff-service' \
  "$ROOT/references/runbooks/staging-secrets-checklist.md" \
  || fail "staging-secrets-checklist must document Portal ECS secrets map contract"
grep -Eq 'portal-valkey|redis_url_secret_arn' \
  "$ROOT/references/runbooks/staging-secrets-checklist.md" \
  || fail "staging-secrets-checklist must document portal-valkey REDIS_URL wiring"
grep -Eq 'SESSION_TTL_SECONDS|604800' \
  "$ROOT/references/runbooks/staging-secrets-checklist.md" \
  || fail "staging-secrets-checklist must document session TTLs"
grep -Eq 'GOOGLE_CLIENT_SECRET|auth/google/callback|SESSION_SECRET' \
  "$ROOT/references/runbooks/staging-secrets-checklist.md" \
  || fail "staging-secrets-checklist must document OIDC secret names + callback URL shapes"
grep -Eq 'OIDC|path-first|callback' \
  "$ROOT/references/runbooks/portal-compute-staging-apply.md" \
  || fail "portal-compute-staging-apply must cover OIDC secrets / path-first callbacks"

# Readiness: G5/G6 stay blocked (wiring alone is not ready)
require_file "$ROOT/references/readiness-matrix.md"
if ! grep -Eq '\*\*G5\*\*.*\*\*blocked\*\*|G5.*\*\*blocked\*\*' "$ROOT/references/readiness-matrix.md"; then
  fail "readiness-matrix must keep G5 blocked until product multi-instance + staging proof"
fi
if ! grep -Eq '\*\*G6\*\*.*\*\*blocked\*\*|G6.*\*\*blocked\*\*' "$ROOT/references/readiness-matrix.md"; then
  fail "readiness-matrix must keep G6 blocked until product bus + staging proof"
fi
grep -Eq 'portal-valkey' "$ROOT/references/readiness-matrix.md" \
  || fail "readiness-matrix must mention portal-valkey for shared-state deploy path"

log "OK: portal compute modules private-CP + digest + health + secrets-injection + Valkey REDIS_URL wiring + honesty smoke passed"
exit 0
