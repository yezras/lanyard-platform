#!/usr/bin/env bash
# Offline smoke: modules/platform-vpc two-AZ public/private foundation + private egress contract.
# No AWS credentials, no terraform apply.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOD="$ROOT/modules/platform-vpc"

err() { echo "[smoke-platform-vpc] ERROR: $*" >&2; }
log() { echo "[smoke-platform-vpc] $*"; }
fail() { err "$*"; exit 1; }

[ -d "$MOD" ] || fail "module missing: $MOD"

require_file() {
  local f="$1"
  [ -f "$f" ] || fail "required file missing: $f"
}

for f in versions.tf variables.tf main.tf outputs.tf README.md INDEX.md terraform.tfvars.example; do
  require_file "$MOD/$f"
done

# Private tier must hardcode map_public_ip_on_launch = false
grep -Eq 'map_public_ip_on_launch[[:space:]]*=[[:space:]]*false' "$MOD/main.tf" \
  || fail "main.tf must hardcode map_public_ip_on_launch = false on private subnets"

# Variable rejects private public-IP assignment
grep -Eq 'variable[[:space:]]+"private_map_public_ip_on_launch"' "$MOD/variables.tf" \
  || fail "variables.tf missing private_map_public_ip_on_launch"
grep -Eq 'var\.private_map_public_ip_on_launch[[:space:]]*==[[:space:]]*false' "$MOD/variables.tf" \
  || fail "private_map_public_ip_on_launch must validate == false"

# Must not set private map_public_ip_on_launch = true in .tf (except validation/error docs)
if grep -REn 'map_public_ip_on_launch[[:space:]]*=[[:space:]]*true' "$MOD" --include='*.tf' 2>/dev/null \
  | grep -Ev 'public|validation|error_message|#' \
  | grep -Eiq 'private'; then
  fail "private subnets must not set map_public_ip_on_launch = true"
fi

# Public subnets present with map_public_ip true
grep -Eq 'resource[[:space:]]+"aws_subnet"[[:space:]]+"public"' "$MOD/main.tf" \
  || fail "main.tf missing aws_subnet.public"
grep -Eq 'resource[[:space:]]+"aws_subnet"[[:space:]]+"private"' "$MOD/main.tf" \
  || fail "main.tf missing aws_subnet.private"

# Topology: ≥2 AZs / public / private
grep -Eq 'length\(var\.availability_zones\)[[:space:]]*>=[[:space:]]*2' "$MOD/variables.tf" \
  || fail "availability_zones must require at least 2"
grep -Eq 'length\(var\.public_subnet_cidrs\)[[:space:]]*>=[[:space:]]*2' "$MOD/variables.tf" \
  || fail "public_subnet_cidrs must require at least 2"
grep -Eq 'length\(var\.private_subnet_cidrs\)[[:space:]]*>=[[:space:]]*2' "$MOD/variables.tf" \
  || fail "private_subnet_cidrs must require at least 2"

# NAT and/or endpoint egress for ECR, Logs, Secrets Manager, SSM, S3
for needle in enable_nat_gateway enable_s3_gateway_endpoint enable_ecr_endpoints \
  enable_logs_endpoint enable_secretsmanager_endpoint enable_ssm_endpoints; do
  grep -Eq "variable[[:space:]]+\"${needle}\"" "$MOD/variables.tf" \
    || fail "variables.tf missing ${needle}"
done

grep -Eq 'aws_vpc_endpoint' "$MOD/main.tf" || fail "main.tf must define VPC endpoints"
grep -Eq 'ecr\.api|ecr\.dkr' "$MOD/main.tf" || fail "main.tf must create ECR interface endpoints"
grep -Eq '\.logs"' "$MOD/main.tf" || grep -Eq 'com\.amazonaws\..*\.logs' "$MOD/main.tf" \
  || fail "main.tf must create CloudWatch Logs endpoint"
grep -Eq 'secretsmanager' "$MOD/main.tf" || fail "main.tf must create Secrets Manager endpoint"
grep -Eq 'ssmmessages|ec2messages' "$MOD/main.tf" || fail "main.tf must create SSM family endpoints"
grep -Eq 'vpc_endpoint_type[[:space:]]*=[[:space:]]*"Gateway"' "$MOD/main.tf" \
  || fail "main.tf must create S3 gateway endpoint"

# Checks present
for phrase in acknowledge_not_auto_applied private_subnets_reject_public_ip private_subnet_resources_no_public_ip private_egress_path two_az_topology; do
  grep -Fq "check \"${phrase}\"" "$MOD/main.tf" \
    || fail "main.tf missing check \"${phrase}\""
done

# Required outputs
for out in vpc_id public_subnet_ids private_subnet_ids vpc_endpoints_security_group_id \
  s3_gateway_endpoint_id ecr_api_endpoint_id logs_endpoint_id secretsmanager_endpoint_id \
  ssm_endpoint_ids vpc_endpoint_ids module_status; do
  grep -Eq "output[[:space:]]+\"${out}\"" "$MOD/outputs.tf" \
    || fail "outputs.tf missing output \"${out}\""
done

grep -Eq 'infra_ready_not_auto_applied' "$MOD/outputs.tf" \
  || fail "outputs must set module_status to infra_ready_not_auto_applied"

# Example tfvars: lab CIDRs only + honesty gate
require_file "$MOD/terraform.tfvars.example"
grep -Eq 'acknowledge_not_auto_applied[[:space:]]*=[[:space:]]*true' "$MOD/terraform.tfvars.example" \
  || fail "example must set acknowledge_not_auto_applied = true"
grep -Eq '10\.[0-9]+\.[0-9]+\.[0-9]+/' "$MOD/terraform.tfvars.example" \
  || fail "example must use RFC1918 lab CIDRs (e.g. 10.0.0.0/16 style)"
grep -Eqi 'account_id[[:space:]]*=[[:space:]]*"[0-9]{12}"' "$MOD/terraform.tfvars.example" \
  && fail "example must not invent live 12-digit account IDs"

# Docs honesty
grep -Eqi 'infra_ready|not auto-applied|not auto applied' "$MOD/README.md" \
  || fail "README must state infra_ready / not auto-applied"

log "OK: platform-vpc two-AZ public/private + private egress contract smoke passed"
exit 0
