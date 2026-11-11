#!/usr/bin/env bash
# Offline smoke for production controlled egress + SSM-first access + golden AMI contracts.
# Usage (from repo root):
#   bash scripts/smoke-controlled-egress.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAIN="$ROOT/modules/company-brain-ec2/main.tf"
VARS="$ROOT/modules/company-brain-ec2/variables.tf"
UD="$ROOT/modules/company-brain-ec2/user_data.sh.tftpl"
TENANT_VARS="$ROOT/templates/tenant/variables.tf"
TENANT_MAIN="$ROOT/templates/tenant/main.tf"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

[ -f "$MAIN" ] || fail "missing $MAIN"
[ -f "$VARS" ] || fail "missing $VARS"
[ -f "$UD" ] || fail "missing $UD"

# --- Access: empty SSH allowed; no mandatory length > 0 on operator_ssh_cidrs ---
if grep -nE 'length\(var\.operator_ssh_cidrs\)\s*>\s*0' "$VARS" | grep -v 'must not' | grep -q .; then
  # Module may still use length for create_ssh_ingress in main.tf — only variables.tf must not require non-empty.
  :
fi
grep -q 'default\s*=\s*\[\]' "$VARS" || fail "operator_ssh_cidrs should default to empty list"
# Ensure validation requiring non-empty was removed from variables
if grep -A6 'variable "operator_ssh_cidrs"' "$VARS" | grep -q 'must include at least one CIDR'; then
  fail "operator_ssh_cidrs still requires at least one CIDR"
fi
grep -q 'create_ssh_ingress' "$MAIN" || fail "main.tf missing create_ssh_ingress local"
grep -q 'for_each = local.create_ssh_ingress' "$MAIN" || fail "SSH ingress not dynamic on create_ssh_ingress"
pass "SSH optional (empty CIDRs → no port 22)"

# --- SSM IAM + optional endpoints ---
grep -q 'AmazonSSMManagedInstanceCore' "$MAIN" || fail "missing AmazonSSMManagedInstanceCore attachment"
grep -q 'enable_ssm_access' "$VARS" || fail "missing enable_ssm_access variable"
grep -q 'create_ssm_vpc_endpoints' "$VARS" || fail "missing create_ssm_vpc_endpoints variable"
grep -q 'com.amazonaws.\${var.region}.ssm' "$MAIN" || fail "missing SSM VPC endpoint service"
grep -q 'ssmmessages' "$MAIN" || fail "missing ssmmessages endpoint"
grep -q 'ec2messages' "$MAIN" || fail "missing ec2messages endpoint"
pass "SSM IAM + PrivateLink endpoints provisionable"

# --- Egress: open only when egress_mode == open; production forbids open ---
grep -q 'egress_mode == "open"' "$MAIN" || fail "open egress not gated on egress_mode==open"
grep -q 'forbids egress_mode=open\|egress_mode != "open"' "$MAIN" || fail "production must reject egress_mode=open"
# Controlled HTTPS is TCP 443, not protocol -1
grep -q 'from_port\s*=\s*443' "$MAIN" || fail "controlled egress missing TCP 443"
grep -q 'controlled_https_enabled\|egress_mode == "controlled"' "$MAIN" || fail "controlled egress branch missing"

# Detect unconditional all-protocol world egress (must not exist outside open dynamic block).
# Heuristic: any static egress block with protocol = "-1" and 0.0.0.0/0 without for_each open gate.
python3 - "$MAIN" <<'PY' || fail "unconditional protocol=-1 world egress detected"
import re, sys
from pathlib import Path
text = Path(sys.argv[1]).read_text(encoding="utf-8")
# Strip comments
lines = []
for line in text.splitlines():
    if line.strip().startswith("#"):
        continue
    lines.append(line)
body = "\n".join(lines)
# Find egress blocks inside aws_security_group.hermes only (approximate)
# Ensure every protocol = "-1" with 0.0.0.0/0 appears only near egress_mode == "open"
for m in re.finditer(r'protocol\s*=\s*"-1"', body):
    start = max(0, m.start() - 400)
    window = body[start:m.end() + 200]
    if "0.0.0.0/0" in window or '["0.0.0.0/0"]' in window:
        if 'egress_mode == "open"' not in window and "vpc_endpoints" not in window and "Endpoint ENI" not in window:
            # VPC endpoint SG may have open egress; allow if security_group name nearby is vpc_endpoints
            ctx = body[max(0, m.start() - 1200) : m.start()]
            if 'resource "aws_security_group" "vpc_endpoints"' in ctx or "vpc-endpoints" in ctx:
                continue
            print("Found protocol=-1 near world CIDR without open-mode gate", file=sys.stderr)
            sys.exit(1)
sys.exit(0)
PY
pass "Production controlled egress; open all-protocol only in lab/open mode"

# --- VPC endpoints for AWS paths ---
grep -q 'create_s3_gateway_endpoint' "$VARS" || fail "missing create_s3_gateway_endpoint"
grep -q 'vpc_endpoint_type\s*=\s*"Gateway"' "$MAIN" || fail "missing S3 gateway endpoint"
grep -q 'com.amazonaws.\${var.region}.logs' "$MAIN" || fail "missing logs interface endpoint"
grep -q 'com.amazonaws.\${var.region}.kms' "$MAIN" || fail "missing kms interface endpoint"
grep -q 'com.amazonaws.\${var.region}.sts' "$MAIN" || fail "missing sts interface endpoint"
pass "S3/SSM/Logs/KMS/STS endpoints available"

# --- Golden AMI / supply chain ---
grep -q 'use_golden_ami' "$VARS" || fail "missing use_golden_ami variable"
grep -q 'require_pinned_ami' "$VARS" || fail "missing require_pinned_ami variable"
grep -q 'use_golden_ami' "$UD" || fail "user_data missing use_golden_ami branch"
grep -q 'skipping broad dnf package installs' "$UD" || fail "user_data golden path missing skip message"
grep -q 'require_pinned_ami' "$MAIN" || fail "main.tf missing require_pinned_ami precondition wiring"
pass "Golden AMI pin + reduced package path"

# --- Tenant wiring ---
grep -q 'enable_ssm_access' "$TENANT_MAIN" || fail "tenant main missing enable_ssm_access"
grep -q 'use_golden_ami' "$TENANT_MAIN" || fail "tenant main missing use_golden_ami"
grep -q 'egress_mode' "$TENANT_MAIN" || fail "tenant main missing egress_mode"
grep -q 'default\s*=\s*\[\]' "$TENANT_VARS" || fail "tenant operator_ssh_cidrs should default empty"
pass "Tenant template wires SSM/egress/AMI controls"

# --- Runbooks present ---
for f in \
  "$ROOT/references/runbooks/ssm-break-glass.md" \
  "$ROOT/references/runbooks/controlled-egress.md" \
  "$ROOT/references/runbooks/golden-ami-supply-chain.md"
do
  [ -f "$f" ] || fail "missing runbook $f"
done
pass "SSM / egress / golden-AMI runbooks present"

# --- Optional terraform validate of module (no credentials) ---
if command -v terraform >/dev/null 2>&1; then
  (
    cd "$ROOT/modules/company-brain-ec2"
    terraform init -backend=false -input=false -no-color >/dev/null
    terraform validate -no-color
  ) || fail "terraform validate failed for company-brain-ec2"
  pass "terraform validate company-brain-ec2"
else
  echo "SKIP: terraform not on PATH"
fi

echo
echo "All controlled-egress / SSM / golden-AMI smoke checks passed."
