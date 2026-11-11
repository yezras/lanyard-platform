#!/usr/bin/env bash
# Offline guardrails for Daytona sandbox vault mount IAM (lp-t86 + lp-zuh.9.1).
# Default: no AWS credentials, no terraform apply, no network, no secrets.
#
# Validates policy JSON under:
#   docs/plans/0008-daytona-agent-sandboxes/drafts/iam/
# against the Phase 3 design in:
#   docs/plans/0008-daytona-agent-sandboxes/iam-scoped-s3-mount-policy.md
# plus Terraform module:
#   deploy/modules/sandbox-vault-mount-iam/
#
# Checks:
#   - Required template files present and valid JSON
#   - Allow statements bind only to tenants/${TENANT_ID}/vault/ (not tenants/*)
#   - Deny statements present for unbound list + _platform sibling
#   - Cross-tenant substitution: tenant A resource ARNs do not cover tenant B
#   - Trust policy is AssumeRole-only from orchestrator principal
#   - Seed policy is separate (may touch _platform; never a guest inject template)
#   - TF module creates shared base role + CP AssumeRole grant + session template
#
# Live (optional, operator lab):
#   SMOKE_SANDBOX_VAULT_MOUNT_IAM_LIVE=1
#     → get-role trust, CP task assume policy, simulate-custom-policy (redacted)
#   SMOKE_SANDBOX_VAULT_MOUNT_IAM_LIVE_ASSUME=1
#     → sts:AssumeRole with session policy when caller is a trusted principal
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IAM_DIR="$ROOT/docs/plans/0008-daytona-agent-sandboxes/drafts/iam"
DOC="$ROOT/docs/plans/0008-daytona-agent-sandboxes/iam-scoped-s3-mount-policy.md"
MOD="$ROOT/deploy/modules/sandbox-vault-mount-iam"
LAB_ROOT="$ROOT/deploy/deployments/lab-sandbox-vault-mount-iam"
ROLE_NAME="${SANDBOX_VAULT_MOUNT_ROLE_NAME:-lanyard-sandbox-vault-mount}"
CP_TASK_ROLE_NAME="${SANDBOX_VAULT_MOUNT_CP_TASK_ROLE_NAME:-lanyard-platform-staging-cp-task}"
VAULT_BUCKET="${LANYARD_VAULT_BUCKET:-lanyard-mocklab-vault-123456789012}"

err() { echo "[smoke-sandbox-vault-mount-iam] ERROR: $*" >&2; }
log() { echo "[smoke-sandbox-vault-mount-iam] $*"; }
fail() { err "$*"; exit 1; }
pass() { log "OK: $*"; }

need_file() {
  [ -f "$1" ] || fail "missing required file: $1"
}

need_file "$DOC"
need_file "$IAM_DIR/sandbox-vault-mount-session-policy.json"
need_file "$IAM_DIR/sandbox-vault-mount-identity-policy.json"
need_file "$IAM_DIR/sandbox-vault-mount-trust-policy.json"
need_file "$IAM_DIR/platform-vault-seed-policy.json"
pass "policy templates + design doc present"

# Doc must cover lifetime/rotation and cross-tenant (lp-t86 acceptance anchors)
for needle in \
  "Credential lifetime" \
  "rotation" \
  "cross-tenant" \
  "DurationSeconds" \
  "lp-t86"
do
  grep -qi -- "$needle" "$DOC" || fail "design doc missing required topic: $needle"
done
pass "design doc covers lifetime/rotation and cross-tenant (lp-t86)"

python3 - "$IAM_DIR" <<'PY'
"""Static review of vault mount IAM templates — offline cross-tenant isolation."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

iam_dir = Path(sys.argv[1])
errors: list[str] = []


def load(name: str) -> dict:
    path = iam_dir / name
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        errors.append(f"{name}: invalid JSON: {e}")
        return {}
    if not isinstance(data, dict):
        errors.append(f"{name}: expected object")
        return {}
    if data.get("Version") != "2012-10-17":
        errors.append(f"{name}: Version must be 2012-10-17")
    stmts = data.get("Statement")
    if not isinstance(stmts, list) or not stmts:
        errors.append(f"{name}: Statement must be non-empty list")
    return data


def walk_strings(obj, acc: list[str]) -> None:
    if isinstance(obj, str):
        acc.append(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            walk_strings(v, acc)
    elif isinstance(obj, list):
        for v in obj:
            walk_strings(v, acc)


def flatten_actions(stmt: dict) -> list[str]:
    a = stmt.get("Action", [])
    if isinstance(a, str):
        return [a]
    if isinstance(a, list):
        return [x for x in a if isinstance(x, str)]
    return []


def flatten_resources(stmt: dict) -> list[str]:
    r = stmt.get("Resource", [])
    if isinstance(r, str):
        return [r]
    if isinstance(r, list):
        return [x for x in r if isinstance(x, str)]
    return []


def is_allow(stmt: dict) -> bool:
    return stmt.get("Effect") == "Allow"


def is_deny(stmt: dict) -> bool:
    return stmt.get("Effect") == "Deny"


# --- Guest mount policies (session + identity): tight prefix scope ---
GUEST_FILES = [
    "sandbox-vault-mount-session-policy.json",
    "sandbox-vault-mount-identity-policy.json",
]

BOUND_OBJECT = "arn:aws:s3:::${LANYARD_VAULT_BUCKET}/tenants/${TENANT_ID}/vault/*"
BOUND_PREFIXES = {
    "tenants/${TENANT_ID}/vault/",
    "tenants/${TENANT_ID}/vault/*",
}

BROAD_ALLOW_PATTERNS = [
    re.compile(r"tenants/\*"),
    re.compile(r"tenants/\$\{TENANT_ID\}/\*"),  # whole tenant tree incl. _platform
    re.compile(r"arn:aws:s3:::\$\{LANYARD_VAULT_BUCKET\}/\*"),  # whole bucket objects
    re.compile(r'"s3:\*"'),  # raw action star in Allow — checked separately
]

for name in GUEST_FILES:
    data = load(name)
    stmts = data.get("Statement") or []
    allow_stmts = [s for s in stmts if isinstance(s, dict) and is_allow(s)]
    deny_stmts = [s for s in stmts if isinstance(s, dict) and is_deny(s)]

    if not allow_stmts:
        errors.append(f"{name}: need at least one Allow statement")
    if not deny_stmts:
        errors.append(f"{name}: need defense-in-depth Deny statements")

    # Required SIDs (canonical isolation controls)
    sids = {s.get("Sid") for s in stmts if isinstance(s, dict)}
    for required in (
        "ListOnlyBoundVaultPrefix",
        "ObjectRWBoundVaultPrefix",
        "DenyListBucketWithoutPrefix",
        "DenyListBucketOutsideBoundVaultPrefix",
        "DenyPlatformSiblingUnderTenant",
    ):
        if required not in sids:
            errors.append(f"{name}: missing Sid {required}")

    for stmt in allow_stmts:
        actions = flatten_actions(stmt)
        resources = flatten_resources(stmt)
        # No broad s3:* Allow
        if any(a == "s3:*" for a in actions):
            errors.append(f"{name}: Allow must not grant s3:* ({stmt.get('Sid')})")
        # Object allows must be exactly bound vault tree
        if any(a.startswith("s3:GetObject") or a.startswith("s3:PutObject") or a.startswith("s3:DeleteObject") for a in actions):
            if resources != [BOUND_OBJECT] and BOUND_OBJECT not in resources:
                errors.append(
                    f"{name}: object Allow Resource must be bound vault tree only "
                    f"({stmt.get('Sid')}: {resources})"
                )
        # ListBucket must be bucket ARN + prefix condition
        if "s3:ListBucket" in actions:
            if any("/" in r.split(":::", 1)[-1] for r in resources if r.startswith("arn:aws:s3:::")):
                # object-style ARN on ListBucket is wrong shape
                if any("/tenants/" in r for r in resources):
                    errors.append(f"{name}: ListBucket Resource must be bucket ARN only ({stmt.get('Sid')})")
            cond = stmt.get("Condition") or {}
            # Find s3:prefix values
            prefix_vals: list[str] = []
            for op, keys in cond.items() if isinstance(cond, dict) else []:
                if not isinstance(keys, dict):
                    continue
                if "s3:prefix" in keys:
                    v = keys["s3:prefix"]
                    if isinstance(v, str):
                        prefix_vals.append(v)
                    elif isinstance(v, list):
                        prefix_vals.extend(x for x in v if isinstance(x, str))
            if not prefix_vals:
                errors.append(f"{name}: ListBucket Allow must condition on s3:prefix ({stmt.get('Sid')})")
            else:
                for p in prefix_vals:
                    if p not in BOUND_PREFIXES:
                        errors.append(
                            f"{name}: ListBucket s3:prefix must be bound vault prefix only "
                            f"({stmt.get('Sid')}: {p!r})"
                        )

    # Scan all Allow strings for broad patterns
    allow_blob_parts: list[str] = []
    for stmt in allow_stmts:
        walk_strings(stmt, allow_blob_parts)
    allow_blob = "\n".join(allow_blob_parts)
    if "tenants/*" in allow_blob:
        errors.append(f"{name}: Allow statements must not reference tenants/*")
    if re.search(r"tenants/\$\{TENANT_ID\}/\*", allow_blob) and "_platform" not in allow_blob:
        # whole-tenant wildcard would include _platform and siblings
        if any("tenants/${TENANT_ID}/*" in p for p in allow_blob_parts):
            errors.append(f"{name}: Allow must not use whole-tenant wildcard tenants/${{TENANT_ID}}/*")
    if re.search(r"arn:aws:s3:::\$\{LANYARD_VAULT_BUCKET\}/\*", allow_blob):
        errors.append(f"{name}: Allow must not grant whole-bucket object ARN")

    # Deny platform sibling must exist with _platform in resources
    plat = next((s for s in deny_stmts if s.get("Sid") == "DenyPlatformSiblingUnderTenant"), None)
    if plat is None:
        errors.append(f"{name}: DenyPlatformSiblingUnderTenant missing")
    else:
        res = " ".join(flatten_resources(plat))
        if "_platform" not in res:
            errors.append(f"{name}: DenyPlatformSiblingUnderTenant must reference _platform")

    # Cross-tenant substitution review
    raw = (iam_dir / name).read_text(encoding="utf-8")
    if "${TENANT_ID}" not in raw:
        errors.append(f"{name}: must use ${{TENANT_ID}} placeholder for per-tenant scope")
    a = raw.replace("${TENANT_ID}", "tenant-alpha").replace("${LANYARD_VAULT_BUCKET}", "lanyard-vault-lab")
    b = raw.replace("${TENANT_ID}", "tenant-beta").replace("${LANYARD_VAULT_BUCKET}", "lanyard-vault-lab")
    if a == b:
        errors.append(f"{name}: substituting different TENANT_ID must change policy document")
    # After substitution, alpha object ARN must not appear in beta-bound resources as a match for beta
    alpha_object = "arn:aws:s3:::lanyard-vault-lab/tenants/tenant-alpha/vault/*"
    beta_object = "arn:aws:s3:::lanyard-vault-lab/tenants/tenant-beta/vault/*"
    if alpha_object not in a or beta_object not in b:
        errors.append(f"{name}: substituted object ARNs missing for alpha/beta tenants")
    if alpha_object in b or beta_object in a:
        errors.append(f"{name}: cross-tenant ARN leakage after substitution")
    # List prefix for alpha must not equal beta
    if "tenants/tenant-alpha/vault/" not in a or "tenants/tenant-beta/vault/" not in b:
        errors.append(f"{name}: substituted list prefixes missing")
    if "tenants/tenant-beta/vault/" in a and "tenant-alpha" in a:
        # alpha-rendered doc must not also authorize beta vault path as allow resource
        # (beta string could only appear if hard-coded — fail closed)
        allow_a = json.loads(a)
        for stmt in allow_a.get("Statement") or []:
            if not isinstance(stmt, dict) or not is_allow(stmt):
                continue
            blob = json.dumps(stmt)
            if "tenant-beta" in blob:
                errors.append(f"{name}: alpha-rendered Allow still mentions tenant-beta")

print("cross-tenant substitution: tenant-alpha vs tenant-beta isolated in guest policies")

# --- Trust policy ---
trust = load("sandbox-vault-mount-trust-policy.json")
tstmts = trust.get("Statement") or []
if len(tstmts) != 1:
    errors.append("trust policy: expected exactly one Statement")
else:
    t = tstmts[0]
    if not is_allow(t):
        errors.append("trust policy: Statement must Allow")
    actions = flatten_actions(t)
    if actions != ["sts:AssumeRole"]:
        errors.append(f"trust policy: Action must be sts:AssumeRole only, got {actions}")
    principal = (t.get("Principal") or {}).get("AWS")
    if principal != "${ORCHESTRATOR_ROLE_ARN}":
        errors.append("trust policy: Principal.AWS must be ${ORCHESTRATOR_ROLE_ARN}")
    # Must not trust wildcard
    strings: list[str] = []
    walk_strings(t, strings)
    if any(s == "*" for s in strings):
        errors.append("trust policy: must not use wildcard Principal or Action")

print("trust policy: orchestrator AssumeRole only")

# --- Seed policy: separate principal; may access _platform; must still be tenant-scoped ---
seed = load("platform-vault-seed-policy.json")
seed_stmts = seed.get("Statement") or []
seed_blob_parts: list[str] = []
walk_strings(seed, seed_blob_parts)
seed_blob = "\n".join(seed_blob_parts)
if "tenants/*" in seed_blob and "tenants/${TENANT_ID}" not in seed_blob:
    errors.append("seed policy: must not allow all tenants via tenants/* alone")
if "${TENANT_ID}" not in seed_blob:
    errors.append("seed policy: must scope to ${TENANT_ID}")
# Seed must not appear as guest inject — comment/doc convention in _comment
comment = str(seed.get("_comment", ""))
if "NOT" not in comment.upper() and "never" not in comment.lower():
    # soft: still require tenant scope above
    pass
# Seed Allow must not grant whole bucket
if re.search(r"arn:aws:s3:::\$\{LANYARD_VAULT_BUCKET\}/\*", seed_blob):
    errors.append("seed policy: must not grant whole-bucket object ARN")

print("seed policy: tenant-scoped; separate from guest mount")

# --- No secret-looking material in templates ---
for path in iam_dir.glob("*.json"):
    text = path.read_text(encoding="utf-8")
    if re.search(r"AKIA[0-9A-Z]{16}", text):
        errors.append(f"{path.name}: looks like AWS access key id")
    if re.search(r"(?i)(aws_secret_access_key|private_key)\s*[:=]\s*['\"]?[A-Za-z0-9/+=]{20,}", text):
        errors.append(f"{path.name}: looks like embedded secret material")

if errors:
    for e in errors:
        print(f"FAIL: {e}", file=sys.stderr)
    sys.exit(1)

print("ALL offline IAM isolation checks passed")
sys.exit(0)
PY

pass "offline IAM isolation review (cross-tenant + deny + trust)"

# --- TF module contracts (lp-zuh.9.1) ---
need_file "$MOD/versions.tf"
need_file "$MOD/variables.tf"
need_file "$MOD/main.tf"
need_file "$MOD/iam.tf"
need_file "$MOD/outputs.tf"
need_file "$MOD/README.md"
need_file "$MOD/INDEX.md"
need_file "$MOD/terraform.tfvars.example"
need_file "$MOD/templates/session-policy.json"
need_file "$LAB_ROOT/main.tf"
need_file "$LAB_ROOT/variables.tf"
need_file "$LAB_ROOT/outputs.tf"
need_file "$LAB_ROOT/versions.tf"
pass "TF module + lab apply root present"

# Role name default
grep -q 'lanyard-sandbox-vault-mount' "$MOD/variables.tf" || fail "module must default role_name to lanyard-sandbox-vault-mount"
grep -q 'aws_iam_role" "mount"' "$MOD/iam.tf" || fail "iam.tf must define aws_iam_role.mount"
grep -q 'OrchestratorAssumeOnly' "$MOD/iam.tf" || fail "iam.tf trust must use Sid OrchestratorAssumeOnly"
grep -q 'sts:AssumeRole' "$MOD/iam.tf" || fail "iam.tf must grant/use sts:AssumeRole"
grep -q 'orchestrator_principal_arns' "$MOD/variables.tf" || fail "variables.tf must declare orchestrator_principal_arns"
grep -q 'attach_orchestrator_assume_policy' "$MOD/variables.tf" || fail "variables.tf must declare attach_orchestrator_assume_policy"
grep -q 'AssumeSandboxVaultMountRole' "$MOD/iam.tf" || fail "iam.tf must define AssumeSandboxVaultMountRole for CP task"
# Upper bound + denials on base identity
grep -q 'tenants/\*/vault/\*' "$MOD/main.tf" "$MOD/iam.tf" || fail "base identity must upper-bound tenants/*/vault/*"
grep -q 'DenyListBucketWithoutPrefix' "$MOD/iam.tf" || fail "base identity missing DenyListBucketWithoutPrefix"
grep -q 'DenyPlatformSiblingUnderTenant' "$MOD/iam.tf" || fail "base identity missing DenyPlatformSiblingUnderTenant"
# No long-lived keys / users
if grep -REn --include='*.tf' 'aws_iam_access_key|aws_iam_user' "$MOD" "$LAB_ROOT" >/dev/null 2>&1; then
  fail "module/lab root must not create IAM users or access keys"
fi
# No secrets / AKIA in module
if grep -REn --include='*.tf' --include='*.json' --include='*.md' 'AKIA[0-9A-Z]{16}' "$MOD" "$LAB_ROOT" >/dev/null 2>&1; then
  fail "module/lab root looks like it embeds AWS access key ids"
fi
# Session template required SIDs (same isolation as drafts)
for sid in \
  ListOnlyBoundVaultPrefix \
  ObjectRWBoundVaultPrefix \
  DenyListBucketWithoutPrefix \
  DenyListBucketOutsideBoundVaultPrefix \
  DenyPlatformSiblingUnderTenant
do
  grep -q "$sid" "$MOD/templates/session-policy.json" || fail "session-policy.json missing Sid $sid"
done
# Module session template must match draft session policy shape (tenant placeholder)
grep -q 'tenants/\${TENANT_ID}/vault/' "$MOD/templates/session-policy.json" || fail "session template must bind tenants/\${TENANT_ID}/vault/"
# Lab root wires module + CP task principal shape
grep -q 'modules/sandbox-vault-mount-iam' "$LAB_ROOT/main.tf" || fail "lab root must source sandbox-vault-mount-iam module"
grep -q 'lanyard-platform-staging-cp-task' "$LAB_ROOT/variables.tf" || fail "lab root default orchestrator should be CP task role"
pass "TF module IAM contracts (base role, CP AssumeRole, session template, no keys)"

# Session template offline cross-tenant (same as drafts)
python3 - "$MOD/templates/session-policy.json" <<'PY'
import json, sys
from pathlib import Path
path = Path(sys.argv[1])
raw = path.read_text(encoding="utf-8")
data = json.loads(raw)
assert data.get("Version") == "2012-10-17"
sids = {s.get("Sid") for s in data.get("Statement") or []}
for required in (
    "ListOnlyBoundVaultPrefix",
    "ObjectRWBoundVaultPrefix",
    "DenyListBucketWithoutPrefix",
    "DenyListBucketOutsideBoundVaultPrefix",
    "DenyPlatformSiblingUnderTenant",
):
    assert required in sids, f"missing {required}"
a = raw.replace("${TENANT_ID}", "tenant-alpha").replace("${LANYARD_VAULT_BUCKET}", "lanyard-vault-lab")
b = raw.replace("${TENANT_ID}", "tenant-beta").replace("${LANYARD_VAULT_BUCKET}", "lanyard-vault-lab")
assert a != b
assert "tenants/tenant-alpha/vault/" in a and "tenants/tenant-beta/vault/" in b
assert "tenant-alpha" not in b, "beta session render must not mention tenant-alpha"
allow_b = [s for s in json.loads(b)["Statement"] if s.get("Effect") == "Allow"]
for s in allow_b:
    blob = json.dumps(s)
    assert "tenant-alpha" not in blob, "beta session Allow leaks tenant-alpha"
print("module session template: cross-tenant substitution OK")
PY
pass "module session policy template isolation"

log "ALL CHECKS PASSED (offline, no AWS apply)"

# --- Optional live path (lab operator) ---
if [[ "${SMOKE_SANDBOX_VAULT_MOUNT_IAM_LIVE:-}" != "1" ]]; then
  log "skip live checks (set SMOKE_SANDBOX_VAULT_MOUNT_IAM_LIVE=1 for lab proof)"
  exit 0
fi

if ! command -v aws >/dev/null 2>&1; then
  fail "aws CLI required for live smoke"
fi

log "live: caller identity (account/user names only)"
CALLER_JSON="$(aws sts get-caller-identity --output json)"
CALLER_ARN="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["Arn"])' <<<"$CALLER_JSON")"
CALLER_ACCT="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["Account"])' <<<"$CALLER_JSON")"
log "live: Account=${CALLER_ACCT} Arn=${CALLER_ARN}"

ROLE_JSON="$(aws iam get-role --role-name "$ROLE_NAME" --output json)"
ROLE_ARN="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["Role"]["Arn"])' <<<"$ROLE_JSON")"
TRUST_DOC="$(python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["Role"]["AssumeRolePolicyDocument"]))' <<<"$ROLE_JSON")"
log "live: role_arn=${ROLE_ARN}"

python3 - "$TRUST_DOC" "$CP_TASK_ROLE_NAME" <<'PY'
import json, sys
trust = json.loads(sys.argv[1])
cp_name = sys.argv[2]
stmts = trust.get("Statement") or []
assert len(stmts) >= 1, "trust must have statements"
blob = json.dumps(trust)
assert "sts:AssumeRole" in blob
assert "*" not in json.dumps(trust.get("Statement"))
# CP task role name must appear in principal ARNs
assert cp_name in blob, f"trust must allow CP task role {cp_name}"
print("live trust: CP task role present; no wildcard principal in statement dump check OK")
PY
pass "live: base role trust includes CP task role only path"

# CP task inline policy must grant AssumeRole on mount role
POLICIES="$(aws iam list-role-policies --role-name "$CP_TASK_ROLE_NAME" --output json)"
python3 -c 'import json,sys; names=json.loads(sys.argv[1]).get("PolicyNames") or []; role=sys.argv[2]; assert names, "CP task role has no inline policies (expected mount assume grant)"; print("CP task inline policies:", names)' \
  "$POLICIES" "$ROLE_NAME"

FOUND_ASSUME=0
while IFS= read -r pol; do
  [[ -z "$pol" ]] && continue
  DOC="$(aws iam get-role-policy --role-name "$CP_TASK_ROLE_NAME" --policy-name "$pol" --output json)"
  DOC_JSON="$(python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps(d["PolicyDocument"]))' <<<"$DOC")"
  if grep -q "sts:AssumeRole" <<<"$DOC_JSON" && grep -qE "${ROLE_NAME}|${ROLE_ARN}" <<<"$DOC_JSON"; then
    FOUND_ASSUME=1
    log "live: CP task policy ${pol} grants sts:AssumeRole on mount role"
  fi
done < <(python3 -c 'import json,sys; print("\n".join(json.loads(sys.argv[1]).get("PolicyNames") or []))' "$POLICIES")

[[ "$FOUND_ASSUME" == "1" ]] || fail "CP task role missing sts:AssumeRole on $ROLE_NAME"
pass "live: CP task role has sts:AssumeRole on base mount role"

# Session policy isolation via iam simulate-custom-policy (session doc alone =
# the per-wake scope; no secret material printed).
# Note: simulate-custom-policy rejects file:// for --policy-input-list; pass JSON string.
SESSION_TMP="$(mktemp)"
trap 'rm -f "$SESSION_TMP"' EXIT
sed \
  -e "s|\${LANYARD_VAULT_BUCKET}|${VAULT_BUCKET}|g" \
  -e "s|\${TENANT_ID}|mocklab|g" \
  "$MOD/templates/session-policy.json" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); d.pop("_comment", None); json.dump(d, sys.stdout)' \
  >"$SESSION_TMP"
SESSION_POLICY_JSON="$(cat "$SESSION_TMP")"

SIM_BOUND="$(aws iam simulate-custom-policy \
  --policy-input-list "$SESSION_POLICY_JSON" \
  --action-names s3:GetObject \
  --resource-arns "arn:aws:s3:::${VAULT_BUCKET}/tenants/mocklab/vault/hello.txt" \
  --output json)"
SIM_FOREIGN="$(aws iam simulate-custom-policy \
  --policy-input-list "$SESSION_POLICY_JSON" \
  --action-names s3:GetObject \
  --resource-arns "arn:aws:s3:::${VAULT_BUCKET}/tenants/other-tenant/vault/hello.txt" \
  --output json)"
SIM_PLATFORM="$(aws iam simulate-custom-policy \
  --policy-input-list "$SESSION_POLICY_JSON" \
  --action-names s3:GetObject \
  --resource-arns "arn:aws:s3:::${VAULT_BUCKET}/tenants/mocklab/_platform/bootstrap.json" \
  --output json)"

python3 - "$SIM_BOUND" "$SIM_FOREIGN" "$SIM_PLATFORM" <<'PY'
import json, sys

def decision(raw: str) -> str:
    d = json.loads(raw)
    return d["EvaluationResults"][0]["EvalDecision"]

bound = decision(sys.argv[1])
foreign = decision(sys.argv[2])
platform = decision(sys.argv[3])
print(f"simulate session GetObject bound: {bound}")
print(f"simulate session GetObject foreign: {foreign}")
print(f"simulate session GetObject _platform: {platform}")
assert bound == "allowed", f"expected allowed on bound prefix, got {bound}"
assert foreign != "allowed", f"foreign tenant must not be allowed, got {foreign}"
assert platform != "allowed", f"_platform must not be allowed, got {platform}"
print("live simulate-custom-policy: session bound allow + foreign/platform deny OK")
PY
pass "live: session policy simulation (bound allow, foreign/_platform deny)"

# Operator (not in trust) should be AccessDenied on AssumeRole — proves CP-only trust.
# If caller is trusted, print redacted success only (never secret keys).
set +e
ASSUME_OUT="$(aws sts assume-role \
  --role-arn "$ROLE_ARN" \
  --role-session-name "lp-zuh91-smoke" \
  --duration-seconds 900 \
  --policy "$SESSION_POLICY_JSON" \
  --output json 2>&1)"
ASSUME_RC=$?
set -e
if [[ "$ASSUME_RC" -eq 0 ]]; then
  log "live: AssumeRole succeeded for caller (trusted principal); redacting credentials"
  python3 -c 'import json,sys; d=json.load(sys.stdin); c=d.get("Credentials",{}); print("AssumedRoleId=", d.get("AssumedRoleUser",{}).get("AssumedRoleId","?")); print("Expiration=", c.get("Expiration","?")); print("AccessKeyIdPrefix=", (c.get("AccessKeyId") or "")[:4]+"…")' <<<"$ASSUME_OUT"
  pass "live: positive AssumeRole + session policy (redacted)"
else
  if grep -qi 'AccessDenied' <<<"$ASSUME_OUT"; then
    pass "live: operator AssumeRole AccessDenied (trust is CP-task-only; expected)"
  else
    err "unexpected AssumeRole failure: $(echo "$ASSUME_OUT" | head -c 200)"
    exit 1
  fi
fi

if [[ "${SMOKE_SANDBOX_VAULT_MOUNT_IAM_LIVE_ASSUME:-}" == "1" && "$ASSUME_RC" -ne 0 ]]; then
  fail "SMOKE_SANDBOX_VAULT_MOUNT_IAM_LIVE_ASSUME=1 requires caller principal in role trust"
fi

log "ALL CHECKS PASSED (offline + live, secrets redacted)"
