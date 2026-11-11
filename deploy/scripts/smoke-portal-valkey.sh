#!/usr/bin/env bash
# Offline smoke: modules/portal-valkey fail-closed private posture + REDIS_URL secrets.
# No AWS credentials, no terraform apply.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOD="$ROOT/modules/portal-valkey"

err() { echo "[smoke-portal-valkey] ERROR: $*" >&2; }
log() { echo "[smoke-portal-valkey] $*"; }
fail() { err "$*"; exit 1; }

[ -d "$MOD" ] || fail "module missing: $MOD"

require_file() {
  local f="$1"
  [ -f "$f" ] || fail "required file missing: $f"
}

for f in versions.tf variables.tf main.tf outputs.tf README.md INDEX.md terraform.tfvars.example; do
  require_file "$MOD/$f"
done

# Hardcoded TLS + at-rest encryption on the replication group
grep -Eq 'transit_encryption_enabled[[:space:]]*=[[:space:]]*true' "$MOD/main.tf" \
  || fail "main.tf must hardcode transit_encryption_enabled = true"
grep -Eq 'at_rest_encryption_enabled[[:space:]]*=[[:space:]]*true' "$MOD/main.tf" \
  || fail "main.tf must hardcode at_rest_encryption_enabled = true"
grep -Eq 'transit_encryption_mode[[:space:]]*=[[:space:]]*"required"' "$MOD/main.tf" \
  || fail "main.tf must set transit_encryption_mode = required"

# Variable rejects non-TLS / non-encrypted storage
grep -Eq 'variable[[:space:]]+"transit_encryption_enabled"' "$MOD/variables.tf" \
  || fail "variables.tf missing transit_encryption_enabled"
grep -Eq 'var\.transit_encryption_enabled[[:space:]]*==[[:space:]]*true' "$MOD/variables.tf" \
  || fail "transit_encryption_enabled must validate == true"
grep -Eq 'variable[[:space:]]+"at_rest_encryption_enabled"' "$MOD/variables.tf" \
  || fail "variables.tf missing at_rest_encryption_enabled"
grep -Eq 'var\.at_rest_encryption_enabled[[:space:]]*==[[:space:]]*true' "$MOD/variables.tf" \
  || fail "at_rest_encryption_enabled must validate == true"

# Private subnets + no world-open CIDR
grep -Eq 'length\(var\.subnet_ids\)[[:space:]]*>=[[:space:]]*2' "$MOD/variables.tf" \
  || fail "subnet_ids must require at least 2 subnets"
grep -Eq '0\.0\.0\.0/0' "$MOD/variables.tf" \
  || fail "variables.tf must reject 0.0.0.0/0 for allowed_cidr_blocks"
grep -Eq 'allowed_security_group_ids' "$MOD/variables.tf" \
  || fail "variables.tf must parameterize allowed_security_group_ids (BFF/relay SGs)"

# Must use ElastiCache replication group (Valkey preferred)
grep -Eq 'aws_elasticache_replication_group' "$MOD/main.tf" \
  || fail "main.tf must define aws_elasticache_replication_group"
grep -Eq 'engine[[:space:]]*=[[:space:]]*var\.engine|"valkey"' "$MOD/main.tf" "$MOD/variables.tf" \
  || fail "module must support valkey engine"
grep -Eq 'auth_token' "$MOD/main.tf" \
  || fail "main.tf must configure auth_token from generated secret"

# Secrets Manager REDIS_URL contract — never plaintext auth output
grep -Eq 'REDIS_URL' "$MOD/main.tf" "$MOD/outputs.tf" \
  || fail "module must document/store REDIS_URL"
grep -Eq 'aws_secretsmanager_secret' "$MOD/main.tf" \
  || fail "module must use Secrets Manager for the REDIS_URL payload"
grep -Eq 'redis_url_secret_arn' "$MOD/outputs.tf" \
  || fail "outputs must include redis_url_secret_arn"
grep -Eq 'primary_endpoint_address' "$MOD/outputs.tf" \
  || fail "outputs must include primary_endpoint_address for ECS wiring"
grep -Eq 'ecs_secret_injection' "$MOD/outputs.tf" \
  || fail "outputs must include ecs_secret_injection contract"

# No auth token / password variables accepted from callers
if grep -Eq 'variable[[:space:]]+"(auth_token|password|redis_password|redis_auth_token)"' "$MOD/variables.tf"; then
  fail "module must not accept auth_token/password via variables (generate + Secrets Manager only)"
fi

# Outputs must not expose sensitive auth as non-secret-named values
if grep -Eq 'output[[:space:]]+"(auth_token|redis_password|redis_url)"' "$MOD/outputs.tf"; then
  # redis_url_shape / redis_url_secret_* are OK; bare redis_url or auth_token are not
  fail "outputs must not expose bare auth_token/redis_password/redis_url (use secret ARN + shape)"
fi
grep -Eq 'random_password' "$MOD/main.tf" \
  || fail "main.tf must generate auth token via random_password"

# Availability / backup / maintenance / metrics parameterized
for needle in snapshot_retention_limit snapshot_window maintenance_window \
  multi_az_enabled automatic_failover_enabled create_cloudwatch_alarms \
  num_cache_clusters node_type; do
  grep -Eq "variable[[:space:]]+\"${needle}\"" "$MOD/variables.tf" \
    || fail "variables.tf missing parameterized setting: $needle"
done

# Example tfvars: placeholders only, no auth token fields
require_file "$MOD/terraform.tfvars.example"
if grep -Eqi '(auth_token|password)[[:space:]]*=' "$MOD/terraform.tfvars.example"; then
  fail "terraform.tfvars.example must not set auth_token= or password="
fi
grep -Eq 'acknowledge_not_auto_applied[[:space:]]*=[[:space:]]*true' "$MOD/terraform.tfvars.example" \
  || fail "example must set acknowledge_not_auto_applied = true"
grep -Eq 'vpc-00000000000000000|subnet-0000000000000000' "$MOD/terraform.tfvars.example" \
  || fail "example must use obvious placeholder VPC/subnet shapes (not live IDs)"

# Checks present
for phrase in acknowledge_not_auto_applied require_tls require_at_rest_encryption \
  require_private_ingress_sources subnets_are_private; do
  grep -Fq "check \"$phrase\"" "$MOD/main.tf" \
    || fail "main.tf missing check \"$phrase\""
done

# Honesty: infra_ready, not production certified
grep -Eqi 'infra_ready' "$MOD/README.md" "$MOD/outputs.tf" \
  || fail "module must label readiness infra_ready"
grep -Eqi 'not production certified|not_production_certified|production certified' "$MOD/README.md" \
  || fail "README must state not production certified"
# Residual enable path + dual-BFF deferral honesty (lp-t7q.8)
G5_RUNBOOK="$ROOT/references/runbooks/portal-valkey-g5-enable.md"
require_file "$G5_RUNBOOK"
grep -Eqi 'enable path|enable_portal_valkey' "$G5_RUNBOOK" \
  || fail "G5 enable runbook must document enable path"
grep -Eqi 'defer|deferred' "$G5_RUNBOOK" \
  || fail "G5 enable runbook must defer dual-BFF live proof with reason (or document proof)"
grep -Eqi 'not production cert|infra_ready' "$G5_RUNBOOK" \
  || fail "G5 enable runbook must state module is not production certification alone"
grep -Eq 'portal-valkey-g5-enable' "$MOD/README.md" \
  || fail "portal-valkey README must link portal-valkey-g5-enable residual runbook"
grep -Eq 'portal-valkey-g5-enable|lp-t7q\.8|dual-BFF' \
  "$ROOT/references/readiness-matrix.md" \
  || fail "readiness-matrix must reference G5 residual / dual-BFF honesty"

# README must document staging cost vs HA
grep -Eqi 'staging.*cost|cost path|single.node|num_cache_clusters[[:space:]]*=[[:space:]]*1' "$MOD/README.md" \
  || fail "README must document staging cost vs HA topology"

# Consumer wiring: BFF + relay secrets map from redis_url_secret_arn (not platform-staging root)
grep -Eq 'portal-bff-service|portal_bff' "$MOD/README.md" \
  || fail "README must document BFF consumer of REDIS_URL"
grep -Eq 'portal-relay-service|portal_relay' "$MOD/README.md" \
  || fail "README must document relay consumer of REDIS_URL"
grep -Eq 'redis_url_secret_arn.*REDIS_URL|REDIS_URL.*redis_url_secret_arn|value_from.*redis_url_secret_arn' \
  "$MOD/README.md" \
  || fail "README must show secrets value_from = redis_url_secret_arn pattern"
grep -Eq 'platform-staging' "$MOD/README.md" \
  || fail "README must clarify platform-staging does not auto-compose Valkey"

# Peer modules document the same contract
BFF="$ROOT/modules/portal-bff-service"
RELAY="$ROOT/modules/portal-relay-service"
for peer in "$BFF" "$RELAY"; do
  [ -d "$peer" ] || fail "peer module missing: $peer"
  grep -Eq 'redis_url_secret_arn|portal_valkey' "$peer/README.md" "$peer/terraform.tfvars.example" \
    || fail "$(basename "$peer") must document Valkey redis_url_secret_arn wiring"
done

# Runbook composition path
require_file "$ROOT/references/runbooks/portal-compute-staging-apply.md"
grep -Eq 'portal-valkey|redis_url_secret_arn' \
  "$ROOT/references/runbooks/portal-compute-staging-apply.md" \
  || fail "portal-compute-staging-apply must include Valkey → BFF/relay REDIS_URL wiring"

log "OK: portal-valkey private posture + TLS + Secrets Manager REDIS_URL + consumer wiring smoke passed"
exit 0
