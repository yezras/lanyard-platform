#!/usr/bin/env bash
# Offline policy-as-code security gates for company-brain-deploy (no AWS).
# Fail-closed static checks on Terraform modules, tenant template, and bootstrap.
#
# Usage (from repo root):
#   bash scripts/policy-as-code-security.sh
#
# Exit 0 = all gates pass. Exit 1 = regression detected.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EC2_MAIN="$ROOT/modules/company-brain-ec2/main.tf"
EC2_VARS="$ROOT/modules/company-brain-ec2/variables.tf"
RELAY_MAIN="$ROOT/modules/customer-gateway-relay/main.tf"
RELAY_VARS="$ROOT/modules/customer-gateway-relay/variables.tf"
TENANT_MAIN="$ROOT/templates/tenant/main.tf"
TENANT_VARS="$ROOT/templates/tenant/variables.tf"
S3_TF="$ROOT/modules/product-artifact-infra/s3.tf"
TIER3_MOD="$ROOT/modules/tier3-dedicated-relay"
BOOT="$ROOT/scripts/bootstrap-host.sh"
COMPAT="$ROOT/scripts/validate-compatibility.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }
require_file() { [ -f "$1" ] || fail "missing required file: $1"; }

echo "==> policy-as-code-security (offline)"
echo "    root=$ROOT"

require_file "$EC2_MAIN"
require_file "$EC2_VARS"
require_file "$RELAY_MAIN"
require_file "$RELAY_VARS"
require_file "$TENANT_MAIN"
require_file "$TENANT_VARS"
require_file "$S3_TF"
require_file "$BOOT"

# ---------------------------------------------------------------------------
# 1. Production path: associate_public_ip forced false; network_mode production
#    requires vpc_id + subnet_id
# ---------------------------------------------------------------------------
grep -Eq 'associate_public_ip\s*=\s*var\.network_mode\s*==\s*"production"\s*\?\s*false' "$EC2_MAIN" \
  || fail "production must force associate_public_ip=false via local"
grep -Eq 'network_mode\s*!=\s*"production"\s*\|\|\s*\(var\.vpc_id' "$EC2_MAIN" \
  || grep -Eq 'network_mode == "production".*vpc_id|vpc_id != null' "$EC2_MAIN" \
  || fail "production must require vpc_id (precondition missing)"
grep -Fq 'network_mode=production requires explicit vpc_id' "$EC2_MAIN" \
  || fail "vpc_id production precondition message missing"
grep -Fq 'network_mode=production requires explicit subnet_id' "$EC2_MAIN" \
  || fail "subnet_id production precondition message missing"
grep -Eq 'variable\s+"network_mode"' "$EC2_VARS" || fail "EC2 module missing network_mode variable"
# Tenant template wires the production defaults
grep -Eq 'network_mode\s*=\s*var\.network_mode' "$TENANT_MAIN" || fail "tenant main missing network_mode wiring"
grep -Eq 'associate_public_ip\s*=\s*var\.associate_public_ip' "$TENANT_MAIN" \
  || fail "tenant main missing associate_public_ip wiring"
if grep -A8 'variable "network_mode"' "$TENANT_VARS" | grep -Eq 'default\s*=\s*"production"'; then
  pass "tenant network_mode defaults to production"
else
  fail "tenant network_mode should default to production"
fi
if grep -A6 'variable "associate_public_ip"' "$TENANT_VARS" | grep -Eq 'default\s*=\s*false'; then
  pass "tenant associate_public_ip defaults to false"
else
  fail "tenant associate_public_ip should default to false"
fi
pass "production path forces no public IP; requires vpc_id + subnet_id"

# ---------------------------------------------------------------------------
# 2. No protocol=-1 + 0.0.0.0/0 egress in production/controlled path
#    (reuse smoke-controlled-egress heuristic; also require open gate)
# ---------------------------------------------------------------------------
grep -Eq 'egress_mode\s*==\s*"open"' "$EC2_MAIN" \
  || fail "open egress must be gated on egress_mode==open"
grep -Eq 'forbids egress_mode=open|egress_mode != "open"|network_mode=production forbids egress_mode=open' "$EC2_MAIN" \
  || fail "production must reject egress_mode=open"
grep -Eq 'from_port\s*=\s*443' "$EC2_MAIN" || fail "controlled egress missing TCP 443"
python3 - "$EC2_MAIN" <<'PY' || fail "unconditional protocol=-1 world egress detected"
import re, sys
from pathlib import Path
text = Path(sys.argv[1]).read_text(encoding="utf-8")
lines = [ln for ln in text.splitlines() if not ln.strip().startswith("#")]
body = "\n".join(lines)
for m in re.finditer(r'protocol\s*=\s*"-1"', body):
    start = max(0, m.start() - 400)
    window = body[start:m.end() + 200]
    if "0.0.0.0/0" in window or '["0.0.0.0/0"]' in window:
        if 'egress_mode == "open"' not in window and "vpc_endpoints" not in window and "Endpoint ENI" not in window:
            ctx = body[max(0, m.start() - 1200) : m.start()]
            if 'resource "aws_security_group" "vpc_endpoints"' in ctx or "vpc-endpoints" in ctx:
                continue
            print("Found protocol=-1 near world CIDR without open-mode gate", file=sys.stderr)
            sys.exit(1)
sys.exit(0)
PY
pass "no unconditional protocol=-1 world egress outside open/lab path"

# ---------------------------------------------------------------------------
# 3. operator_ssh_cidrs may be empty; no hard requirement of non-empty
# ---------------------------------------------------------------------------
grep -Eq 'default\s*=\s*\[\]' "$EC2_VARS" || fail "operator_ssh_cidrs should default to empty list (EC2)"
if grep -A10 'variable "operator_ssh_cidrs"' "$EC2_VARS" | grep -q 'must include at least one CIDR'; then
  fail "operator_ssh_cidrs still requires at least one CIDR"
fi
grep -Eq 'create_ssh_ingress' "$EC2_MAIN" || fail "main.tf missing create_ssh_ingress local"
grep -Eq 'for_each\s*=\s*local\.create_ssh_ingress' "$EC2_MAIN" \
  || fail "SSH ingress not dynamic on create_ssh_ingress"
# Reject 0.0.0.0/0 still enforced
grep -Fq '0.0.0.0/0' "$EC2_VARS" || fail "operator_ssh_cidrs must reject 0.0.0.0/0"
grep -A8 'variable "operator_ssh_cidrs"' "$EC2_VARS" | grep -Fq '0.0.0.0/0' \
  || fail "operator_ssh_cidrs validation missing 0.0.0.0/0 deny"
pass "SSH optional (empty CIDRs); 0.0.0.0/0 still rejected"

# ---------------------------------------------------------------------------
# 4. Reject http:// and ws:// validations present (artifacts + relay)
# ---------------------------------------------------------------------------
grep -Eq 'http://|insecure' "$BOOT" || fail "bootstrap should document/reject http://"
# Terraform artifact URL validations
for f in "$EC2_VARS" "$TENANT_VARS"; do
  if grep -Eq 'client_core_artifact_url|hermes_artifact_url' "$f"; then
    grep -Eq 'https://|s3://' "$f" || fail "$f missing secure artifact scheme guidance"
  fi
done
# Relay WSS: only https/wss
grep -Eq 'relay_wss_url must start with https:// or wss://' "$RELAY_VARS" \
  || fail "relay module missing https/wss validation message"
grep -Eq 'http:// and ws:// are rejected' "$RELAY_VARS" \
  || fail "relay module must reject http:// and ws://"
grep -Eq 'http:// and ws:// are rejected' "$TENANT_VARS" \
  || fail "tenant relay_wss_url must reject http:// and ws://"
# Bootstrap + compatibility helpers exist
grep -Eq 'is_insecure_artifact_url|require_artifact_url' "$BOOT" \
  || fail "bootstrap missing insecure artifact URL helpers"
grep -Eq 'http://|ws://|insecure' "$COMPAT" \
  || fail "validate-compatibility should reject insecure schemes"
pass "http:// and ws:// rejected for artifacts and relay URLs"

# ---------------------------------------------------------------------------
# 5. IMDSv2 hop_limit=1
# ---------------------------------------------------------------------------
grep -Eq 'http_tokens\s*=\s*"required"' "$EC2_MAIN" || fail "IMDSv2 http_tokens=required missing"
grep -Eq 'http_put_response_hop_limit\s*=\s*1' "$EC2_MAIN" \
  || fail "IMDSv2 hop_limit must be 1"
pass "IMDSv2 required with hop_limit=1"

# ---------------------------------------------------------------------------
# 6. S3 SecureTransport deny present
# ---------------------------------------------------------------------------
grep -Eq 'aws:SecureTransport' "$S3_TF" || fail "product-artifact S3 missing SecureTransport condition"
grep -Eq 'SecureTransport.*=.*"false"|SecureTransport.*"false"' "$S3_TF" \
  || fail "SecureTransport deny must set value false (reject non-TLS)"
for needle in block_public_acls block_public_policy ignore_public_acls restrict_public_buckets; do
  grep -Eq "$needle" "$S3_TF" || fail "S3 public access block missing: $needle"
done
pass "S3 SecureTransport deny + public access block present"

# ---------------------------------------------------------------------------
# 7. Secrets not required as plaintext in production (relay_secret_source defaults)
# ---------------------------------------------------------------------------
# Defaults: deployment_mode=production, relay_secret_source=ssm
if grep -A12 'variable "deployment_mode"' "$RELAY_VARS" | grep -Eq 'default\s*=\s*"production"'; then
  :
else
  fail "customer-gateway-relay deployment_mode should default to production"
fi
if grep -A12 'variable "relay_secret_source"' "$RELAY_VARS" | grep -Eq 'default\s*=\s*"ssm"'; then
  :
else
  fail "relay_secret_source should default to ssm (not plaintext inline)"
fi
grep -Eq 'production_rejects_inline_secret|rejects relay_secret_source=inline' "$RELAY_MAIN" \
  || fail "production must reject inline relay secrets"
grep -Eq 'production_no_inline_secret_in_tf|forbids setting relay_instance_secret' "$RELAY_MAIN" \
  || fail "production must forbid relay_instance_secret in Terraform"
# Tenant defaults match
if grep -A8 'variable "relay_secret_source"' "$TENANT_VARS" | grep -Eq 'default\s*=\s*"ssm"'; then
  :
else
  fail "tenant relay_secret_source should default to ssm"
fi
if grep -A8 'variable "deployment_mode"' "$TENANT_VARS" | grep -Eq 'default\s*=\s*"production"'; then
  :
else
  fail "tenant deployment_mode should default to production"
fi
pass "production relay secrets default to SSM/SM; plaintext not required"

# ---------------------------------------------------------------------------
# 8. Tier 3 dedicated relay — infra_ready (compose portal-relay; not production claim)
# ---------------------------------------------------------------------------
if [ ! -d "$TIER3_MOD" ]; then
  fail "modules/tier3-dedicated-relay missing"
fi
# Must compose portal-relay-service (real ALB/ECS) rather than remain sketch-only.
grep -Eq 'source[[:space:]]*=[[:space:]]*"\.\./portal-relay-service"' "$TIER3_MOD/main.tf" \
  || fail "tier3-dedicated-relay must compose ../portal-relay-service"
# Honesty: not auto-applied; production claim hard-false; digest pin present.
for phrase in acknowledge_not_auto_applied claim_production_ready image_digest; do
  grep -RFq "$phrase" "$TIER3_MOD" --include='*.tf' \
    || fail "tier3-dedicated-relay missing honesty/pin var: $phrase"
done
# claim_production_ready must reject true
grep -A12 'variable "claim_production_ready"' "$TIER3_MOD/variables.tf" | grep -Eq '== false|condition.*=.*false' \
  || fail "tier3-dedicated-relay claim_production_ready must validate false"
# Optional DNS/WAF hooks present
grep -Eq 'aws_route53_record|create_dns_record' "$TIER3_MOD/main.tf" "$TIER3_MOD/variables.tf" \
  || fail "tier3-dedicated-relay missing optional DNS hooks"
grep -Eq 'aws_wafv2_web_acl_association|web_acl_arn' "$TIER3_MOD/main.tf" "$TIER3_MOD/variables.tf" \
  || fail "tier3-dedicated-relay missing optional WAF hooks"
# Private tasks default (no public IP on Fargate by default)
if grep -A6 'variable "assign_public_ip"' "$TIER3_MOD/variables.tf" | grep -Eq 'default[[:space:]]*=[[:space:]]*true'; then
  fail "tier3-dedicated-relay assign_public_ip must default false"
fi
# Must not reintroduce sketch-only acknowledge gate as required path
if grep -Eq 'variable[[:space:]]+"acknowledge_sketch_only"' "$TIER3_MOD/variables.tf" 2>/dev/null; then
  fail "tier3-dedicated-relay must not require acknowledge_sketch_only after infra_ready promotion"
fi
if [ -f "$ROOT/index.yaml" ]; then
  grep -Eq 'tier3_dedicated_relay:[[:space:]]*infra_ready' "$ROOT/index.yaml" \
    || fail "index.yaml product_gates.tier3_dedicated_relay must be infra_ready*"
fi
pass "Tier 3 dedicated relay infra_ready (compose + honesty gates; not production claim)"

# ---------------------------------------------------------------------------
# 9. Snapshot BPA / encryption flags present
# ---------------------------------------------------------------------------
grep -Eq 'encrypted\s*=\s*true' "$EC2_MAIN" || fail "root EBS must set encrypted=true"
grep -Eq 'aws_ebs_snapshot_block_public_access' "$EC2_MAIN" \
  || fail "EBS snapshot block public access resource missing"
grep -Eq 'variable\s+"enable_ebs_snapshot_block_public_access"' "$EC2_VARS" \
  || fail "enable_ebs_snapshot_block_public_access variable missing"
grep -Eq 'variable\s+"ebs_snapshot_block_public_access_state"' "$EC2_VARS" \
  || fail "ebs_snapshot_block_public_access_state variable missing"
# Defaults: BPA on, block-all-sharing
if grep -A10 'variable "enable_ebs_snapshot_block_public_access"' "$EC2_VARS" | grep -Eq 'default\s*=\s*true'; then
  :
else
  fail "enable_ebs_snapshot_block_public_access should default true"
fi
if grep -A8 'variable "ebs_snapshot_block_public_access_state"' "$EC2_VARS" | grep -Eq 'default\s*=\s*"block-all-sharing"'; then
  :
else
  fail "ebs_snapshot_block_public_access_state should default block-all-sharing"
fi
grep -Eq 'aws_dlm_lifecycle_policy' "$EC2_MAIN" || fail "DLM snapshot policy resource missing"
# Opt-in DR copy/share fail-closed (cbd-mta.7.4)
for var in enable_cross_region_copy destination_region enable_dr_account_share dr_account_id; do
  grep -Eq "variable[[:space:]]+\"${var}\"" "$EC2_VARS" \
    || fail "company-brain-ec2 missing DR snapshot variable: $var"
done
if grep -A12 'variable "enable_cross_region_copy"' "$EC2_VARS" | grep -Eq 'default[[:space:]]*=[[:space:]]*false'; then
  :
else
  fail "enable_cross_region_copy must default false"
fi
if grep -A12 'variable "enable_dr_account_share"' "$EC2_VARS" | grep -Eq 'default[[:space:]]*=[[:space:]]*false'; then
  :
else
  fail "enable_dr_account_share must default false"
fi
if grep -A12 'variable "destination_region"' "$EC2_VARS" | grep -Eq 'default[[:space:]]*=[[:space:]]*null'; then
  :
else
  fail "destination_region must default null"
fi
if grep -A12 'variable "dr_account_id"' "$EC2_VARS" | grep -Eq 'default[[:space:]]*=[[:space:]]*null'; then
  :
else
  fail "dr_account_id must default null"
fi
grep -Eq 'dynamic[[:space:]]+"cross_region_copy_rule"' "$EC2_MAIN" \
  || fail "DLM cross_region_copy_rule dynamic block missing"
grep -Eq 'dynamic[[:space:]]+"share_rule"' "$EC2_MAIN" \
  || fail "DLM share_rule dynamic block missing"
pass "EBS encryption + snapshot BPA + DLM present (DR copy defaults off)"

# ---------------------------------------------------------------------------
# Cross-check: controlled-egress smoke still present for deeper coverage
# ---------------------------------------------------------------------------
[ -f "$ROOT/scripts/smoke-controlled-egress.sh" ] \
  || fail "smoke-controlled-egress.sh missing (policy suite depends on it)"
pass "smoke-controlled-egress.sh present for extended egress/SSM/AMI coverage"

if [ -f "$ROOT/scripts/smoke-dlm-dr-snapshot-copy.sh" ]; then
  bash "$ROOT/scripts/smoke-dlm-dr-snapshot-copy.sh" >/dev/null \
    || fail "smoke-dlm-dr-snapshot-copy.sh failed"
  pass "smoke-dlm-dr-snapshot-copy.sh (opt-in DR copy fail-closed)"
else
  fail "smoke-dlm-dr-snapshot-copy.sh missing"
fi

# ---------------------------------------------------------------------------
# 10. G1.3 — Control plane must never attach to a public ALB
#     Doctrine + docs honesty always. When Portal compute modules appear,
#     fail closed on public listeners / public subnet CP attachment patterns.
# ---------------------------------------------------------------------------
require_file "$ROOT/INDEX.md"
require_file "$ROOT/index.yaml"
require_file "$ROOT/references/readiness-matrix.md"
require_file "$ROOT/references/migration-phases.md"

# Topology doctrine must stay explicit in committed operator surfaces
grep -Eqi 'control plane.*(private|never).*public ALB|must not attach directly to a public ALB|never directly on a public ALB|never sit on a public ALB' \
  "$ROOT/INDEX.md" "$ROOT/references/readiness-matrix.md" "$ROOT/references/migration-phases.md" \
  || fail "docs must state control plane is private-only / never on a public ALB (G1)"

# Machine map: G1 remains an honest product gate key (blocked until product clears it)
grep -Eq 'g1_control_plane_security:' "$ROOT/index.yaml" \
  || fail "index.yaml missing portal_topology_gates.g1_control_plane_security"
# Forbidden: claiming production Portal CP security ready via index while G1 product work incomplete
if grep -Eq 'g1_control_plane_security:[[:space:]]*ready' "$ROOT/index.yaml"; then
  fail "index.yaml must not mark g1_control_plane_security ready without product G1 evidence"
fi

# Scan future / present Portal compute modules for public control-plane ALB patterns
# Paths that may later hold Portal edge/API/CP/relay compute (G8+).
PORTAL_TF_ROOTS=()
for d in \
  "$ROOT/modules/portal-control-plane" \
  "$ROOT/modules/portal-compute" \
  "$ROOT/modules/portal-api" \
  "$ROOT/modules/portal-alb" \
  "$ROOT/modules/portal-edge" \
  "$ROOT/environments/platform-staging"
do
  [ -d "$d" ] && PORTAL_TF_ROOTS+=("$d")
done
# Any modules/portal-* tree
while IFS= read -r -d '' d; do
  PORTAL_TF_ROOTS+=("$d")
done < <(find "$ROOT/modules" -maxdepth 1 -type d -name 'portal-*' -print0 2>/dev/null || true)

# Heuristic: .tf files that mention control-plane + public ALB / internet-facing LB must fail
python3 - "$ROOT" "${PORTAL_TF_ROOTS[@]}" <<'PY' || fail "public control-plane ALB pattern detected (G1.3)"
import re, sys
from pathlib import Path

root = Path(sys.argv[1])
roots = [Path(p) for p in sys.argv[2:] if p]
# Always include repo-wide modules + environments for accidental public CP wiring
for extra in (root / "modules", root / "environments", root / "templates"):
    if extra.is_dir() and extra not in roots:
        roots.append(extra)

# Patterns that indicate a public-facing load balancer attached to control-plane
public_lb_needles = [
    re.compile(r'internal\s*=\s*false', re.I),
    re.compile(r'load_balancer_type\s*=\s*"application"', re.I),
]
cp_needles = re.compile(r'control[-_]?plane|controlplane', re.I)
# Explicit forbidden combinations in a single file window
bad_combo = re.compile(
    r'(control[-_]?plane|controlplane).{0,400}(internal\s*=\s*false|publicly_accessible\s*=\s*true)'
    r'|(internal\s*=\s*false|publicly_accessible\s*=\s*true).{0,400}(control[-_]?plane|controlplane)',
    re.I | re.S,
)
# scheme http listener + control-plane target (weak but useful)
http_public = re.compile(
    r'control[-_]?plane.{0,300}(protocol\s*=\s*"HTTP"|port\s*=\s*80)|'
    r'(protocol\s*=\s*"HTTP"|port\s*=\s*80).{0,300}control[-_]?plane',
    re.I | re.S,
)

errors = []
for base in roots:
    for tf in base.rglob("*.tf"):
        # Skip examples that are pure documentation strings only if they assert the ban
        text = tf.read_text(encoding="utf-8")
        # Strip pure comment lines for combo search but keep strings
        if bad_combo.search(text):
            # Allow comments that forbid the pattern
            stripped_lines = []
            for ln in text.splitlines():
                s = ln.strip()
                if s.startswith("#") or s.startswith("//"):
                    continue
                stripped_lines.append(ln)
            body = "\n".join(stripped_lines)
            if bad_combo.search(body):
                errors.append(f"{tf.relative_to(root)}: control-plane near internal=false/publicly_accessible=true")
        if cp_needles.search(text) and re.search(r'aws_lb\b|aws_alb\b', text):
            body_lines = [ln for ln in text.splitlines() if not ln.strip().startswith("#")]
            body = "\n".join(body_lines)
            if re.search(r'internal\s*=\s*false', body):
                errors.append(f"{tf.relative_to(root)}: aws_lb/aws_alb with internal=false near control-plane references")

if errors:
    for e in errors:
        print(e, file=sys.stderr)
    sys.exit(1)
sys.exit(0)
PY
pass "G1.3: private control-plane doctrine enforced; no public CP ALB patterns in Terraform"

# ---------------------------------------------------------------------------
# 11. G4.3 — Control-plane RDS private-only when module is present
# ---------------------------------------------------------------------------
RDS_MOD="$ROOT/modules/control-plane-rds"
if [ -d "$RDS_MOD" ]; then
  require_file "$RDS_MOD/main.tf"
  require_file "$RDS_MOD/variables.tf"
  require_file "$RDS_MOD/outputs.tf"
  grep -Eq 'publicly_accessible[[:space:]]*=[[:space:]]*false' "$RDS_MOD/main.tf" \
    || fail "control-plane-rds must hardcode publicly_accessible = false"
  grep -Eq 'storage_encrypted[[:space:]]*=[[:space:]]*true' "$RDS_MOD/main.tf" \
    || fail "control-plane-rds must set storage_encrypted = true"
  grep -Eq 'var\.publicly_accessible[[:space:]]*==[[:space:]]*false' "$RDS_MOD/variables.tf" \
    || fail "control-plane-rds must reject publicly_accessible=true via variable validation"
  grep -Eq '0\.0\.0\.0/0' "$RDS_MOD/variables.tf" \
    || fail "control-plane-rds must reject 0.0.0.0/0 CIDRs for DB ingress"
  grep -Eq 'aws_secretsmanager_secret' "$RDS_MOD/main.tf" \
    || fail "control-plane-rds must store CONTROL_PLANE_DATABASE_URL in Secrets Manager"
  grep -Eq 'control_plane_database_url_secret_arn' "$RDS_MOD/outputs.tf" \
    || fail "control-plane-rds must output control_plane_database_url_secret_arn (not raw password docs)"
  if grep -REn 'publicly_accessible[[:space:]]*=[[:space:]]*true' "$RDS_MOD" --include='*.tf' 2>/dev/null | grep -Ev 'validation|error_message|#' | grep -q .; then
    fail "control-plane-rds must not set publicly_accessible = true"
  fi
  [ -f "$ROOT/scripts/smoke-control-plane-rds.sh" ] \
    || fail "scripts/smoke-control-plane-rds.sh required when control-plane-rds module exists"
  pass "G4.3: control-plane-rds private encrypted Secrets Manager posture present"
else
  pass "G4.3: control-plane-rds module not present (still gated)"
fi

# ---------------------------------------------------------------------------
# 12. G8 — Portal compute modules (static edge + digest services + private CP)
# ---------------------------------------------------------------------------
STATIC_MOD="$ROOT/modules/portal-static-edge"
BFF_MOD="$ROOT/modules/portal-bff-service"
RELAY_MOD="$ROOT/modules/portal-relay-service"
CP_SVC_MOD="$ROOT/modules/portal-control-plane-service"

if [ -d "$STATIC_MOD" ] || [ -d "$BFF_MOD" ] || [ -d "$RELAY_MOD" ] || [ -d "$CP_SVC_MOD" ]; then
  # If any G8 module exists, require the full set + smoke
  for d in "$STATIC_MOD" "$BFF_MOD" "$RELAY_MOD" "$CP_SVC_MOD"; do
    [ -d "$d" ] || fail "G8 partial modules: missing $d (expect static-edge + bff + relay + control-plane-service)"
  done
  [ -f "$ROOT/scripts/smoke-portal-compute.sh" ] \
    || fail "scripts/smoke-portal-compute.sh required when portal compute modules exist"
  [ -f "$ROOT/references/runbooks/portal-compute-staging-apply.md" ] \
    || fail "references/runbooks/portal-compute-staging-apply.md required when portal compute modules exist"

  # Static edge: private S3 + OAC
  grep -Eq 'aws_cloudfront_origin_access_control' "$STATIC_MOD/main.tf" \
    || fail "portal-static-edge must use CloudFront OAC"
  for needle in block_public_acls block_public_policy ignore_public_acls restrict_public_buckets; do
    grep -Eq "$needle" "$STATIC_MOD/main.tf" || fail "portal-static-edge public access block missing: $needle"
  done
  grep -Eq 'aws:SecureTransport' "$STATIC_MOD/main.tf" \
    || fail "portal-static-edge must deny non-TLS S3 access"

  # BFF/relay: digest pins + health checks
  for mod in "$BFF_MOD" "$RELAY_MOD"; do
    grep -Eq 'variable[[:space:]]+"image_digest"' "$mod/variables.tf" \
      || fail "$mod missing image_digest variable"
    grep -Eq 'sha256:' "$mod/variables.tf" \
      || fail "$mod must validate sha256 digest pins"
    grep -Eq 'health_check_path' "$mod/variables.tf" "$mod/main.tf" \
      || fail "$mod must wire health_check_path"
    # Public edge modules must not mention control-plane in .tf (G1.3 scanner safety)
    if grep -Eiq 'control[-_]?plane' "$mod/main.tf" "$mod/variables.tf" "$mod/outputs.tf" 2>/dev/null; then
      fail "$mod .tf must not mention control-plane (keep public ALB separate from private CP module)"
    fi
  done
  grep -Eq 'acknowledge_g5_scale_beyond_one' "$BFF_MOD/variables.tf" \
    || fail "portal-bff-service missing G5 scale gate"
  grep -Eq 'acknowledge_g6_scale_beyond_one' "$RELAY_MOD/variables.tf" \
    || fail "portal-relay-service missing G6 scale gate"
  # G5/G6: REDIS_URL never plaintext; wire via secrets map from portal-valkey
  for mod in "$BFF_MOD" "$RELAY_MOD"; do
    grep -Eq '"REDIS_URL"' "$mod/main.tf" \
      || fail "$(basename "$mod") must reject REDIS_URL in plain environment_variables"
    grep -Eq 'redis_url_secret_arn|portal_valkey' "$mod/README.md" "$mod/terraform.tfvars.example" \
      || fail "$(basename "$mod") must document Valkey redis_url_secret_arn → secrets.REDIS_URL"
    if grep -Eq 'output[[:space:]]+"(redis_url|REDIS_URL)"' "$mod/outputs.tf"; then
      fail "$(basename "$mod") must not output REDIS_URL values"
    fi
  done

  # Control-plane service: internal ALB only
  grep -Eq 'internal[[:space:]]*=[[:space:]]*true' "$CP_SVC_MOD/main.tf" \
    || fail "portal-control-plane-service must hardcode internal = true"
  grep -Eq 'var\.internal[[:space:]]*==[[:space:]]*true' "$CP_SVC_MOD/variables.tf" \
    || fail "portal-control-plane-service must reject internal=false via variable validation"
  if grep -REn 'internal[[:space:]]*=[[:space:]]*false' "$CP_SVC_MOD" --include='*.tf' 2>/dev/null | grep -Ev 'validation|error_message|#' | grep -q .; then
    fail "portal-control-plane-service must not set internal = false"
  fi
  grep -Eq 'assign_public_ip[[:space:]]*=[[:space:]]*false' "$CP_SVC_MOD/main.tf" \
    || fail "portal-control-plane-service must set assign_public_ip = false"
  grep -Eq '0\.0\.0\.0/0' "$CP_SVC_MOD/variables.tf" \
    || fail "portal-control-plane-service must reject 0.0.0.0/0 ingress CIDRs"

  # ECS secrets injection: generic map, scoped IAM, production plaintext reject, no secret values in outputs
  for mod in "$BFF_MOD" "$RELAY_MOD" "$CP_SVC_MOD"; do
    grep -Eq 'variable[[:space:]]+"secrets"' "$mod/variables.tf" \
      || fail "$(basename "$mod") missing generic secrets map variable"
    grep -Eq 'value_from' "$mod/variables.tf" "$mod/main.tf" \
      || fail "$(basename "$mod") secrets contract must use value_from"
    grep -Eq 'valueFrom' "$mod/main.tf" \
      || fail "$(basename "$mod") must render ECS task secrets with valueFrom (not plaintext values)"
    grep -Eq 'secretsmanager:GetSecretValue' "$mod/main.tf" \
      || fail "$(basename "$mod") must grant secretsmanager:GetSecretValue for declared ARNs"
    grep -Eq 'ssm:GetParameters' "$mod/main.tf" \
      || fail "$(basename "$mod") must grant ssm:GetParameters for declared ARNs"
    grep -Eq 'production_rejects_plaintext_secrets' "$mod/main.tf" \
      || fail "$(basename "$mod") must reject known plaintext secrets in production-like environments"
    # Denied ARN path: no wildcard secrets resources
    if grep -E 'Resource[[:space:]]*=' "$mod/main.tf" | grep -E 'secretsmanager|ssm:Get' >/dev/null 2>&1; then
      :
    fi
    if awk '/secretsmanager:GetSecretValue|ssm:GetParameters/{flag=1} flag && /Resource/{print; flag=0}' "$mod/main.tf" \
      | grep -q '"\*"'; then
      fail "$(basename "$mod") secrets IAM must not use Resource=\"*\""
    fi
    grep -Eq 'output[[:space:]]+"secret_names"' "$mod/outputs.tf" \
      || fail "$(basename "$mod") must output secret_names only (no secret values)"
  done
  grep -Eq 'database_url_secret_arn' "$CP_SVC_MOD/variables.tf" \
    || fail "portal-control-plane-service must keep database_url_secret_arn for G4.3 CONTROL_PLANE_DATABASE_URL path"
  grep -Eq 'CONTROL_PLANE_DATABASE_URL' "$CP_SVC_MOD/main.tf" \
    || fail "portal-control-plane-service must inject CONTROL_PLANE_DATABASE_URL"
  # JSON-key valueFrom for both product env names (bare ARN of JSON secret is wrong)
  grep -Eq ':CONTROL_PLANE_DATABASE_URL::' "$CP_SVC_MOD/main.tf" \
    || fail "portal-control-plane-service must use ECS JSON-key form …:CONTROL_PLANE_DATABASE_URL::"
  grep -Eq ':DATABASE_URL::' "$CP_SVC_MOD/main.tf" \
    || fail "portal-control-plane-service must twin-inject DATABASE_URL via …:DATABASE_URL::"

  # Readiness must not claim G8 production-ready from modules alone
  if grep -Eq '\*\*G8\*\*.*\*\*ready\*\*|G8.*Portal compute.*\*\*ready\*\*' "$ROOT/references/readiness-matrix.md"; then
    # allow infra_ready language only
    if ! grep -Eq '\*\*G8\*\*.*\*\*infra_ready\*\*|G8.*\*\*infra_ready\*\*' "$ROOT/references/readiness-matrix.md"; then
      fail "readiness-matrix must not mark G8 **ready** without staging evidence (use infra_ready)"
    fi
  fi

  pass "G8: portal compute modules present with private CP, digest pins, secrets injection, health checks, staging runbook"
else
  pass "G8: portal compute modules not present (still gated)"
fi

# ---------------------------------------------------------------------------
# 13. Platform VPC foundation (two-AZ public/private + private egress)
# ---------------------------------------------------------------------------
PLATFORM_VPC_MOD="$ROOT/modules/platform-vpc"
if [ -d "$PLATFORM_VPC_MOD" ]; then
  require_file "$PLATFORM_VPC_MOD/main.tf"
  require_file "$PLATFORM_VPC_MOD/variables.tf"
  require_file "$PLATFORM_VPC_MOD/outputs.tf"
  grep -Eq 'map_public_ip_on_launch[[:space:]]*=[[:space:]]*false' "$PLATFORM_VPC_MOD/main.tf" \
    || fail "platform-vpc must hardcode map_public_ip_on_launch = false on private subnets"
  grep -Eq 'var\.private_map_public_ip_on_launch[[:space:]]*==[[:space:]]*false' "$PLATFORM_VPC_MOD/variables.tf" \
    || fail "platform-vpc must reject private_map_public_ip_on_launch=true via variable validation"
  grep -Eq 'length\(var\.public_subnet_cidrs\)[[:space:]]*>=[[:space:]]*2' "$PLATFORM_VPC_MOD/variables.tf" \
    || fail "platform-vpc must require ≥2 public subnet CIDRs"
  grep -Eq 'length\(var\.private_subnet_cidrs\)[[:space:]]*>=[[:space:]]*2' "$PLATFORM_VPC_MOD/variables.tf" \
    || fail "platform-vpc must require ≥2 private subnet CIDRs"
  grep -Eq 'enable_nat_gateway|enable_ecr_endpoints' "$PLATFORM_VPC_MOD/variables.tf" \
    || fail "platform-vpc must expose NAT and/or VPC endpoint egress controls"
  for svc in ecr secretsmanager logs ssm; do
    grep -Eq "$svc" "$PLATFORM_VPC_MOD/main.tf" \
      || fail "platform-vpc main.tf must reference endpoint service path for ${svc}"
  done
  grep -Eq 'vpc_endpoint_type[[:space:]]*=[[:space:]]*"Gateway"' "$PLATFORM_VPC_MOD/main.tf" \
    || fail "platform-vpc must implement S3 gateway endpoint"
  for out in vpc_id public_subnet_ids private_subnet_ids vpc_endpoints_security_group_id; do
    grep -Eq "output[[:space:]]+\"${out}\"" "$PLATFORM_VPC_MOD/outputs.tf" \
      || fail "platform-vpc outputs missing ${out}"
  done
  grep -Eq 'infra_ready_not_auto_applied' "$PLATFORM_VPC_MOD/outputs.tf" \
    || fail "platform-vpc must label module_status infra_ready_not_auto_applied"
  [ -f "$ROOT/scripts/smoke-platform-vpc.sh" ] \
    || fail "scripts/smoke-platform-vpc.sh required when platform-vpc module exists"
  pass "platform-vpc: two-AZ public/private + private egress foundation present"
else
  pass "platform-vpc module not present (optional until Portal compute foundation)"
fi

# ---------------------------------------------------------------------------
# 14. Portal Valkey/Redis shared state — private TLS + Secrets Manager when present
# ---------------------------------------------------------------------------
VALKEY_MOD="$ROOT/modules/portal-valkey"
if [ -d "$VALKEY_MOD" ]; then
  require_file "$VALKEY_MOD/main.tf"
  require_file "$VALKEY_MOD/variables.tf"
  require_file "$VALKEY_MOD/outputs.tf"
  grep -Eq 'transit_encryption_enabled[[:space:]]*=[[:space:]]*true' "$VALKEY_MOD/main.tf" \
    || fail "portal-valkey must hardcode transit_encryption_enabled = true"
  grep -Eq 'at_rest_encryption_enabled[[:space:]]*=[[:space:]]*true' "$VALKEY_MOD/main.tf" \
    || fail "portal-valkey must hardcode at_rest_encryption_enabled = true"
  grep -Eq 'var\.transit_encryption_enabled[[:space:]]*==[[:space:]]*true' "$VALKEY_MOD/variables.tf" \
    || fail "portal-valkey must reject transit_encryption_enabled=false via variable validation"
  grep -Eq 'var\.at_rest_encryption_enabled[[:space:]]*==[[:space:]]*true' "$VALKEY_MOD/variables.tf" \
    || fail "portal-valkey must reject at_rest_encryption_enabled=false via variable validation"
  grep -Eq '0\.0\.0\.0/0' "$VALKEY_MOD/variables.tf" \
    || fail "portal-valkey must reject 0.0.0.0/0 CIDRs for cache ingress"
  grep -Eq 'aws_secretsmanager_secret' "$VALKEY_MOD/main.tf" \
    || fail "portal-valkey must store REDIS_URL in Secrets Manager"
  grep -Eq 'redis_url_secret_arn' "$VALKEY_MOD/outputs.tf" \
    || fail "portal-valkey must output redis_url_secret_arn (not raw auth token)"
  grep -Eq 'aws_elasticache_replication_group' "$VALKEY_MOD/main.tf" \
    || fail "portal-valkey must define aws_elasticache_replication_group"
  if grep -Eq 'variable[[:space:]]+"(auth_token|password|redis_password)"' "$VALKEY_MOD/variables.tf"; then
    fail "portal-valkey must not accept auth tokens via variables"
  fi
  [ -f "$ROOT/scripts/smoke-portal-valkey.sh" ] \
    || fail "scripts/smoke-portal-valkey.sh required when portal-valkey module exists"
  # Consumer wiring contract (BFF/relay) when G8 modules exist
  if [ -d "$ROOT/modules/portal-bff-service" ] && [ -d "$ROOT/modules/portal-relay-service" ]; then
    for mod in "$ROOT/modules/portal-bff-service" "$ROOT/modules/portal-relay-service"; do
      grep -Eq 'redis_url_secret_arn|portal_valkey' "$mod/README.md" \
        || fail "$(basename "$mod") must document consumption of portal-valkey redis_url_secret_arn"
    done
    grep -Eq 'portal-valkey|redis_url_secret_arn' \
      "$ROOT/references/runbooks/portal-compute-staging-apply.md" \
      || fail "portal-compute-staging-apply must wire Valkey REDIS_URL into BFF/relay"
    # Honesty: G5/G6 remain blocked
    if ! grep -Eq '\*\*G5\*\*.*\*\*blocked\*\*' "$ROOT/references/readiness-matrix.md"; then
      fail "readiness-matrix must keep G5 **blocked** (Valkey wiring alone is not ready)"
    fi
    if ! grep -Eq '\*\*G6\*\*.*\*\*blocked\*\*' "$ROOT/references/readiness-matrix.md"; then
      fail "readiness-matrix must keep G6 **blocked** (Valkey wiring alone is not ready)"
    fi
  fi
  pass "Portal Valkey: private TLS encrypted Secrets Manager REDIS_URL + BFF/relay wiring posture present"
else
  pass "Portal Valkey: module not present (still gated)"
fi


# ---------------------------------------------------------------------------
# Track B — customer-account-access (assume-role, no long-lived keys)
# ---------------------------------------------------------------------------
TRACKB_MOD="$ROOT/modules/customer-account-access"
if [ -d "$TRACKB_MOD" ]; then
  require_file "$TRACKB_MOD/main.tf"
  require_file "$TRACKB_MOD/variables.tf"
  require_file "$ROOT/scripts/smoke-customer-account-access.sh"
  require_file "$ROOT/references/runbooks/track-b-customer-account-access.md"
  grep -Eq 'sts:ExternalId' "$TRACKB_MOD/main.tf" \
    || fail "customer-account-access trust must require sts:ExternalId"
  if grep -REn --include='*.tf' 'resource[[:space:]]+"aws_iam_access_key"|resource[[:space:]]+"aws_iam_user"' "$TRACKB_MOD" 2>/dev/null | grep -q .; then
    fail "customer-account-access must not create IAM users or access keys"
  fi
  grep -Eq 'iam:CreateAccessKey' "$TRACKB_MOD/main.tf" \
    || fail "customer-account-access must deny iam:CreateAccessKey"
  grep -Eq 'acknowledge_not_auto_applied' "$TRACKB_MOD/variables.tf" \
    || fail "customer-account-access missing acknowledge_not_auto_applied honesty gate"
  grep -Eq 'hermes/|client-core/' "$TRACKB_MOD/main.tf" \
    || fail "customer-account-access must scope artifact reads to hermes/ + client-core/"
  pass "Track B: customer-account-access ExternalId + no long-lived keys + smoke/runbook"
else
  pass "Track B: customer-account-access module not present"
fi

# ---------------------------------------------------------------------------
# Track A — account-factory (lanyard_hosted account-per-tenant contract)
# ---------------------------------------------------------------------------
AF_MOD="$ROOT/modules/account-factory"
if [ -d "$AF_MOD" ]; then
  require_file "$AF_MOD/main.tf"
  require_file "$AF_MOD/variables.tf"
  require_file "$ROOT/scripts/smoke-account-factory.sh"
  require_file "$ROOT/references/runbooks/account-factory.md"
  grep -Eq 'acknowledge_not_auto_applied' "$AF_MOD/variables.tf" \
    || fail "account-factory missing acknowledge_not_auto_applied honesty gate"
  grep -Eq 'enable_live_organizations_api' "$AF_MOD/variables.tf" \
    || fail "account-factory missing enable_live_organizations_api lock"
  grep -Eq 'enable_live_organizations_api[[:space:]]*==[[:space:]]*false' "$AF_MOD/variables.tf" \
    || fail "account-factory must lock enable_live_organizations_api == false"
  if grep -REn --include='*.tf' 'resource[[:space:]]+"aws_organizations_|resource[[:space:]]+"aws_controltower_' "$AF_MOD" 2>/dev/null | grep -q .; then
    fail "account-factory must not create Organizations/Control Tower resources"
  fi
  if grep -REn --include='*.tf' 'resource[[:space:]]+"aws_iam_access_key"|resource[[:space:]]+"aws_iam_user"' "$AF_MOD" 2>/dev/null | grep -q .; then
    fail "account-factory must not create IAM users or access keys"
  fi
  grep -Eq 'iam:CreateAccessKey' "$AF_MOD/main.tf" \
    || fail "account-factory must deny iam:CreateAccessKey on deploy/break-glass roles"
  [ -f "$AF_MOD/scp/deny-leave-organization.json" ] \
    || fail "account-factory missing SCP template deny-leave-organization.json"
  grep -Eq 'organizations:LeaveOrganization' "$AF_MOD/scp/deny-leave-organization.json" \
    || fail "deny-leave-organization SCP must deny LeaveOrganization"
  grep -Eq 'deploy_role_arn|account_request_contract' "$AF_MOD/outputs.tf" \
    || fail "account-factory outputs must include deploy_role_arn and account_request_contract"
  pass "Track A: account-factory contract + SCP templates + no org API / no long-lived keys"
else
  pass "Track A: account-factory module not present"
fi

echo
echo "All policy-as-code security gates passed."
exit 0
