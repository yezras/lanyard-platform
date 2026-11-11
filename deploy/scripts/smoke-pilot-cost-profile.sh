#!/usr/bin/env bash
# Offline smoke: environments/platform-staging pilot cost-profile defaults.
# Greps variables.tf (and light example/docs honesty) so Multi-AZ medium RDS
# or enable-by-default Valkey/WAF/DNS-TLS cannot silently regress.
# No AWS credentials, no terraform apply.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGING="$ROOT/environments/platform-staging"
VARS="$STAGING/variables.tf"
EX="$STAGING/terraform.tfvars.example"
IDX="$STAGING/INDEX.md"
RUNBOOK="$ROOT/references/runbooks/platform-staging-compose.md"

err() { echo "[smoke-pilot-cost-profile] ERROR: $*" >&2; }
log() { echo "[smoke-pilot-cost-profile] $*"; }
fail() { err "$*"; exit 1; }
pass() { log "OK: $*"; }

require_file() {
  local f="$1"
  [ -f "$f" ] || fail "required file missing: $f"
}

# Extract the block for variable "NAME" through its closing brace at column 0.
var_block() {
  local name="$1"
  awk -v n="$name" '
    $0 ~ "variable[[:space:]]+\"" n "\"" { grab=1 }
    grab { print }
    grab && /^}/ { exit }
  ' "$VARS"
}

# Assert variable default equals an exact value (bool/number/string after =).
# Usage: require_default NAME EXPECTED_REGEX (matched on the default line)
require_default() {
  local name="$1"
  local expect_re="$2"
  local block
  block="$(var_block "$name")"
  [ -n "$block" ] || fail "variables.tf missing variable \"$name\""
  echo "$block" | grep -Eq "default[[:space:]]*=[[:space:]]*${expect_re}" \
    || fail "variable \"$name\" must default to ${expect_re} (pilot cost profile); got: $(echo "$block" | grep -E 'default[[:space:]]*=' | head -1 || echo '(no default line)')"
}

require_file "$VARS"
require_file "$EX"
require_file "$IDX"
require_file "$RUNBOOK"

# --- Optional layers: default off ---
require_default "enable_portal_valkey" "false"
require_default "enable_portal_waf" "false"
require_default "enable_portal_dns_tls" "false"
pass "optional layers default off (valkey / waf / dns-tls)"

# --- RDS pilot size (metadata-only CP; chat/vault on client EBS) ---
require_default "rds_multi_az" "false"
require_default "rds_allocated_storage" "20"

# Class must be micro or small (t3/t4g); reject medium+ as compose default
rds_class_block="$(var_block "rds_instance_class")"
[ -n "$rds_class_block" ] || fail "variables.tf missing variable \"rds_instance_class\""
rds_class_line="$(echo "$rds_class_block" | grep -E 'default[[:space:]]*=' | head -1 || true)"
[ -n "$rds_class_line" ] || fail "rds_instance_class must declare a default"
if ! echo "$rds_class_line" | grep -Eq 'default[[:space:]]*=[[:space:]]*"(db\.t[34]g\.(micro|small))"'; then
  fail "rds_instance_class default must be db.t3g/t4g micro or small (pilot); got: $rds_class_line"
fi
# Explicit regression: medium (or larger) must not be the compose default
if echo "$rds_class_line" | grep -Eq 'db\.t[0-9]g\.(medium|large|xlarge|2xlarge)'; then
  fail "rds_instance_class default must not regress to medium+ (pilot cost profile)"
fi
pass "RDS pilot defaults (single-AZ, storage 20, class micro|small)"

# --- Valkey-if-enabled staging cost path ---
require_default "valkey_num_cache_clusters" "1"
require_default "valkey_multi_az_enabled" "false"
require_default "valkey_automatic_failover_enabled" "false"
pass "Valkey enable-path defaults (1 node, multi-AZ/failover off)"

# --- Example + INDEX + runbook document pilot cost + HA re-enable ---
grep -Eq 'rds_multi_az' "$EX" \
  || fail "terraform.tfvars.example must document rds_multi_az"
grep -Eq 'db\.t[34]g\.(micro|small)' "$EX" \
  || fail "terraform.tfvars.example must show pilot RDS class (t3g/t4g micro|small)"
grep -Eiq 'HA re-enable|prod-like|rds_multi_az[[:space:]]*=[[:space:]]*true' "$EX" \
  || fail "terraform.tfvars.example must document HA re-enable path"
grep -Eiq 'valkey_num_cache_clusters|staging cost path|single-node' "$EX" \
  || fail "terraform.tfvars.example must document Valkey staging cost path"
grep -Eiq 'pilot|cost path|cost profile' "$IDX" \
  || fail "environments/platform-staging/INDEX.md must document pilot cost profile"
grep -Eiq 'HA re-enable|rds_multi_az[[:space:]]*=[[:space:]]*true|db\.t4g\.medium' "$IDX" "$RUNBOOK" \
  || fail "INDEX/runbook must document HA re-enable path for RDS"
grep -Eiq 'pilot|cost' "$RUNBOOK" \
  || fail "platform-staging-compose runbook must mention pilot cost defaults"
pass "examples/docs cover pilot cost profile and HA re-enable"

# --- Root indexes mention this smoke when present ---
ROOT_INDEX="$ROOT/INDEX.md"
if [ -f "$ROOT_INDEX" ]; then
  grep -Eq 'smoke-pilot-cost-profile' "$ROOT_INDEX" \
    || fail "root INDEX.md must list scripts/smoke-pilot-cost-profile.sh"
fi
if [ -f "$ROOT/index.yaml" ]; then
  grep -Eq 'smoke-pilot-cost-profile' "$ROOT/index.yaml" \
    || fail "index.yaml must map smoke-pilot-cost-profile"
fi
pass "indexes list pilot cost-profile smoke"

log "All pilot cost-profile checks passed"
echo "PASS: pilot cost profile"
exit 0
