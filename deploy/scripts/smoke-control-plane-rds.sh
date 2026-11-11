#!/usr/bin/env bash
# Offline smoke: modules/control-plane-rds fail-closed private posture.
# No AWS credentials, no terraform apply.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOD="$ROOT/modules/control-plane-rds"

err() { echo "[smoke-control-plane-rds] ERROR: $*" >&2; }
log() { echo "[smoke-control-plane-rds] $*"; }
fail() { err "$*"; exit 1; }

[ -d "$MOD" ] || fail "module missing: $MOD"

require_file() {
  local f="$1"
  [ -f "$f" ] || fail "required file missing: $f"
}

for f in versions.tf variables.tf main.tf outputs.tf README.md INDEX.md terraform.tfvars.example; do
  require_file "$MOD/$f"
done

# Hardcoded private posture on the instance resource
grep -Eq 'publicly_accessible[[:space:]]*=[[:space:]]*false' "$MOD/main.tf" \
  || fail "main.tf must hardcode publicly_accessible = false"

# Must not offer a true public path
if grep -REn 'publicly_accessible[[:space:]]*=[[:space:]]*true' "$MOD" --include='*.tf' 2>/dev/null | grep -vq 'validation\|error_message\|#'; then
  fail "module .tf must not set publicly_accessible = true"
fi

grep -Eq 'storage_encrypted[[:space:]]*=[[:space:]]*true' "$MOD/main.tf" \
  || fail "main.tf must set storage_encrypted = true"

# Variable rejects public + requires private subnets
grep -Eq 'variable[[:space:]]+"publicly_accessible"' "$MOD/variables.tf" \
  || fail "variables.tf missing publicly_accessible"
grep -Eq 'var\.publicly_accessible[[:space:]]*==[[:space:]]*false' "$MOD/variables.tf" \
  || fail "publicly_accessible must validate == false"

grep -Eq 'length\(var\.subnet_ids\)[[:space:]]*>=[[:space:]]*2' "$MOD/variables.tf" \
  || fail "subnet_ids must require at least 2 subnets"

grep -Eq '0\.0\.0\.0/0' "$MOD/variables.tf" \
  || fail "variables.tf must reject 0.0.0.0/0 for allowed_cidr_blocks"

# Secrets Manager URL contract (product G4.1)
# JSON payload must expose CONTROL_PLANE_DATABASE_URL and DATABASE_URL (and usually url)
# so ECS can inject either product env key via valueFrom …:KEY:: form.
grep -Eq 'CONTROL_PLANE_DATABASE_URL' "$MOD/main.tf" "$MOD/outputs.tf" \
  || fail "module must document/store CONTROL_PLANE_DATABASE_URL"
grep -Eq 'DATABASE_URL' "$MOD/main.tf" "$MOD/outputs.tf" \
  || fail "module must store/document DATABASE_URL key alongside CONTROL_PLANE_DATABASE_URL"
grep -Eq 'aws_secretsmanager_secret' "$MOD/main.tf" \
  || fail "module must use Secrets Manager for the database URL payload"
grep -Eq 'control_plane_database_url_secret_arn' "$MOD/outputs.tf" \
  || fail "outputs must include control_plane_database_url_secret_arn"
# Secret version is JSON (jsonencode) — not a bare string URL — matching CP json_keys format
grep -Eq 'jsonencode' "$MOD/main.tf" \
  || fail "control-plane-rds secret_string must be jsonencode (JSON keys for ECS valueFrom)"
# Explicit keys in secret payload
grep -Eq 'CONTROL_PLANE_DATABASE_URL[[:space:]]*=' "$MOD/main.tf" \
  || fail "secret payload must set CONTROL_PLANE_DATABASE_URL key"
grep -Eq 'DATABASE_URL[[:space:]]*=' "$MOD/main.tf" \
  || fail "secret payload must set DATABASE_URL key"
grep -Eq 'url[[:space:]]*=' "$MOD/main.tf" \
  || fail "secret payload must set url key (operator / alternate consumers)"
# RDS force_ssl=1 rejects plain TCP — product URL must request TLS
grep -Eq 'sslmode=require' "$MOD/main.tf" \
  || fail "database_url must include sslmode=require (matches rds.force_ssl=1)"
grep -Eq 'uselibpqcompat=true' "$MOD/main.tf" \
  || fail "database_url must include uselibpqcompat=true (node-pg require≠verify-full)"
grep -Eq 'rds\.force_ssl' "$MOD/main.tf" \
  || fail "parameter group must set rds.force_ssl"
# Env contract documents preferred keys + JSON keys for CP wiring
grep -Eq 'preferred_env_keys|secret_json_keys' "$MOD/outputs.tf" \
  || fail "outputs must document preferred_env_keys / secret_json_keys for CP consumers"

# No password variables accepted from callers
if grep -Eq 'variable[[:space:]]+"(master_password|password|db_password)"' "$MOD/variables.tf"; then
  fail "module must not accept master_password/password via variables (generate + Secrets Manager only)"
fi

# Example tfvars: placeholders only, no password fields
require_file "$MOD/terraform.tfvars.example"
grep -Eqi 'password[[:space:]]*=' "$MOD/terraform.tfvars.example" \
  && fail "terraform.tfvars.example must not set password="
grep -Eq 'acknowledge_not_auto_applied[[:space:]]*=[[:space:]]*true' "$MOD/terraform.tfvars.example" \
  || fail "example must set acknowledge_not_auto_applied = true"
grep -Eq 'vpc-00000000000000000|subnet-0000000000000000' "$MOD/terraform.tfvars.example" \
  || fail "example must use obvious placeholder VPC/subnet shapes (not live IDs)"

# Checks present
for phrase in reject_public_rds subnets_are_private require_private_ingress_sources acknowledge_not_auto_applied; do
  grep -Eq "check \"$phrase\"|check \"$phrase\"" "$MOD/main.tf" \
    || grep -Fq "check \"$phrase\"" "$MOD/main.tf" \
    || fail "main.tf missing check \"$phrase\""
done

log "OK: control-plane-rds private posture + secrets contract smoke passed"
exit 0
