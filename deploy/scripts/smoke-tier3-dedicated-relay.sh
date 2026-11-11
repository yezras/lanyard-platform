#!/usr/bin/env bash
# Offline smoke: Tier 3 dedicated relay (compose portal-relay-service + optional DNS/WAF).
# No AWS credentials, no terraform apply.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOD="$ROOT/modules/tier3-dedicated-relay"
RELAY="$ROOT/modules/portal-relay-service"

err() { echo "[smoke-tier3-dedicated-relay] ERROR: $*" >&2; }
log() { echo "[smoke-tier3-dedicated-relay] $*"; }
fail() { err "$*"; exit 1; }

require_file() {
  local f="$1"
  [ -f "$f" ] || fail "required file missing: $f"
}

require_dir() {
  local d="$1"
  [ -d "$d" ] || fail "required directory missing: $d"
}

require_dir "$MOD"
require_dir "$RELAY"

for f in versions.tf variables.tf main.tf outputs.tf README.md INDEX.md terraform.tfvars.example; do
  require_file "$MOD/$f"
done

# --- Must compose portal-relay-service (not sketch-only zero resources) ---
grep -Eq 'source[[:space:]]*=[[:space:]]*"\\.\\./portal-relay-service"' "$MOD/main.tf" \
  || fail "tier3-dedicated-relay must compose ../portal-relay-service"
grep -Eq 'module[[:space:]]+"relay"' "$MOD/main.tf" \
  || fail "tier3-dedicated-relay must define module \"relay\""

# --- Digest pin + private tasks + public ALB (via composed module + passthrough vars) ---
grep -Eq 'variable[[:space:]]+"image_digest"' "$MOD/variables.tf" \
  || fail "tier3-dedicated-relay missing image_digest"
grep -Eq 'sha256:\\[a-f0-9\\]\\{64\\}' "$MOD/variables.tf" \
  || fail "tier3-dedicated-relay must validate sha256 digest format"
grep -Eq 'variable[[:space:]]+"private_subnet_ids"' "$MOD/variables.tf" \
  || fail "tier3-dedicated-relay missing private_subnet_ids"
grep -Eq 'variable[[:space:]]+"public_subnet_ids"' "$MOD/variables.tf" \
  || fail "tier3-dedicated-relay missing public_subnet_ids"
grep -Eq 'assign_public_ip' "$MOD/variables.tf" \
  || fail "tier3-dedicated-relay missing assign_public_ip (default false for private tasks)"
# Prefer private tasks default
if grep -A6 'variable "assign_public_ip"' "$MOD/variables.tf" | grep -Eq 'default[[:space:]]*=[[:space:]]*true'; then
  fail "tier3-dedicated-relay assign_public_ip must default false (private tasks)"
fi

# G6 scale gate passthrough
grep -Eq 'acknowledge_g6_scale_beyond_one' "$MOD/variables.tf" "$MOD/main.tf" \
  || fail "tier3-dedicated-relay must pass G6 scale gate to portal-relay-service"

# Secrets map passthrough
grep -Eq 'variable[[:space:]]+"secrets"' "$MOD/variables.tf" \
  || fail "tier3-dedicated-relay missing secrets map"
grep -Eq 'secrets[[:space:]]*=[[:space:]]*var\\.secrets' "$MOD/main.tf" \
  || fail "tier3-dedicated-relay must pass secrets to composed relay module"

# --- Optional DNS + WAF hooks ---
grep -Eq 'aws_route53_record' "$MOD/main.tf" \
  || fail "tier3-dedicated-relay must support optional Route53 alias"
grep -Eq 'variable[[:space:]]+"create_dns_record"' "$MOD/variables.tf" \
  || fail "tier3-dedicated-relay missing create_dns_record"
grep -Eq 'variable[[:space:]]+"route53_zone_id"' "$MOD/variables.tf" \
  || fail "tier3-dedicated-relay missing route53_zone_id"
grep -Eq 'aws_wafv2_web_acl_association' "$MOD/main.tf" \
  || fail "tier3-dedicated-relay must support optional WAFv2 association"
grep -Eq 'variable[[:space:]]+"web_acl_arn"' "$MOD/variables.tf" \
  || fail "tier3-dedicated-relay missing web_acl_arn"

# --- Per-tenant hostname / WSS contract ---
grep -Eq 'relay_wss_url|wss://' "$MOD/main.tf" "$MOD/outputs.tf" \
  || fail "tier3-dedicated-relay must emit relay_wss_url (wss://)"
grep -Eq 'output[[:space:]]+"relay_wss_url"' "$MOD/outputs.tf" \
  || fail "tier3-dedicated-relay missing relay_wss_url output"
grep -Eq 'output[[:space:]]+"relay_hostname"' "$MOD/outputs.tf" \
  || fail "tier3-dedicated-relay missing relay_hostname output"
# Reject insecure client schemes in hostname override validation
grep -Eq 'wss\\?://|ws://' "$MOD/variables.tf" \
  || fail "tier3-dedicated-relay must reject ws:// schemes on hostname override"

# --- Honesty: infra_ready, not production claim ---
grep -Eq 'acknowledge_not_auto_applied' "$MOD/variables.tf" "$MOD/main.tf" \
  || fail "tier3-dedicated-relay missing acknowledge_not_auto_applied"
grep -Eq 'claim_production_ready' "$MOD/variables.tf" "$MOD/main.tf" \
  || fail "tier3-dedicated-relay missing claim_production_ready (must stay false)"
grep -Eq 'module_status.*=.*"infra_ready"|status[[:space:]]*=[[:space:]]*"infra_ready"' "$MOD/main.tf" \
  || fail "tier3-dedicated-relay local module_status must be infra_ready"
grep -Eq 'production_ready.*=[[:space:]]*false' "$MOD/main.tf" \
  || fail "tier3-dedicated-relay production_ready must be false"
grep -Eq 'creates_aws_resources.*=[[:space:]]*true' "$MOD/main.tf" \
  || fail "tier3-dedicated-relay creates_aws_resources must be true"
# claim_production_ready validation rejects true
grep -A12 'variable "claim_production_ready"' "$MOD/variables.tf" | grep -Eq 'condition.*=.*false|== false' \
  || fail "tier3-dedicated-relay claim_production_ready must validate == false"

# Example honesty + placeholder-safe
grep -Eq 'acknowledge_not_auto_applied[[:space:]]*=[[:space:]]*true' "$MOD/terraform.tfvars.example" \
  || fail "tier3 example must set acknowledge_not_auto_applied = true"
grep -Eq 'image_digest[[:space:]]*=' "$MOD/terraform.tfvars.example" \
  || fail "tier3 example must set image_digest"
# No live-looking secrets
if grep -Eiq 'password|secret_key|AKIA[0-9A-Z]{16}' "$MOD/terraform.tfvars.example"; then
  fail "tier3 terraform.tfvars.example must not contain live-looking secrets"
fi

# README honesty
grep -Eqi 'infra_ready' "$MOD/README.md" \
  || fail "tier3 README must state infra_ready"
grep -Eqi 'not production|not auto-applied|staging proof' "$MOD/README.md" \
  || fail "tier3 README must state not production-certified / not auto-applied"

# Must not still claim sketch-only zero resources as current status
if grep -Eqi 'zero AWS resources|sketch only \\(zero' "$MOD/README.md"; then
  # Allow historical mention only if clearly past tense / superseded
  if ! grep -Eqi 'infra_ready' "$MOD/README.md"; then
    fail "tier3 README still claims sketch-only without infra_ready status"
  fi
fi

# --- index.yaml product gate ---
if [ -f "$ROOT/index.yaml" ]; then
  grep -Eq 'tier3_dedicated_relay:[[:space:]]*infra_ready' "$ROOT/index.yaml" \
    || fail "index.yaml product_gates.tier3_dedicated_relay must be infra_ready*"
fi

# --- terraform validate when terraform is available ---
if command -v terraform >/dev/null 2>&1; then
  log "terraform init/validate (backend=false)"
  (
    cd "$MOD"
    terraform init -backend=false -input=false -no-color >/tmp/tier3-tf-init.log 2>&1 \
      || { cat /tmp/tier3-tf-init.log; fail "terraform init failed for tier3-dedicated-relay"; }
    terraform validate -no-color >/tmp/tier3-tf-validate.log 2>&1 \
      || { cat /tmp/tier3-tf-validate.log; fail "terraform validate failed for tier3-dedicated-relay"; }
  )
  log "terraform validate ok"
else
  log "terraform not installed; skipping validate (CI will run it)"
fi

log "PASS: tier3-dedicated-relay offline smoke"
