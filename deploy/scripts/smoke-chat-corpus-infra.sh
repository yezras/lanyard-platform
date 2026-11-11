#!/usr/bin/env bash
# Offline guardrails for L10 chat corpus infra (lp-gkh.3).
# No AWS credentials, no terraform apply, no network, no secrets.
#
# Validates:
#   - deploy/modules/chat-corpus-infra HCL contracts
#   - docs/plans/0011-tenant-chat-corpus layout + lifecycle + IAM design
#   - IAM draft JSON: writer Put-only, reader Get/List, Deny vault paths
#   - Separate-from-vault doctrine
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MOD="$ROOT/deploy/modules/chat-corpus-infra"
DOC="$ROOT/docs/plans/0011-tenant-chat-corpus/infra-bucket-iam-lifecycle.md"
OVERVIEW="$ROOT/docs/plans/0011-tenant-chat-corpus/overview.md"
IAM_DIR="$ROOT/docs/plans/0011-tenant-chat-corpus/drafts/iam"
S3_DIR="$ROOT/docs/plans/0011-tenant-chat-corpus/drafts/s3"

err() { echo "[smoke-chat-corpus-infra] ERROR: $*" >&2; }
log() { echo "[smoke-chat-corpus-infra] $*"; }
fail() { err "$*"; exit 1; }
pass() { log "OK: $*"; }

need_file() {
  [ -f "$1" ] || fail "missing required file: $1"
}

need_dir() {
  [ -d "$1" ] || fail "missing required directory: $1"
}

need_dir "$MOD"
need_file "$DOC"
need_file "$OVERVIEW"
need_file "$MOD/versions.tf"
need_file "$MOD/variables.tf"
need_file "$MOD/main.tf"
need_file "$MOD/s3.tf"
need_file "$MOD/iam.tf"
need_file "$MOD/outputs.tf"
need_file "$MOD/README.md"
need_file "$MOD/INDEX.md"
need_file "$MOD/terraform.tfvars.example"
need_file "$IAM_DIR/corpus-writer-policy.json"
need_file "$IAM_DIR/corpus-reader-policy.json"
need_file "$S3_DIR/corpus-bucket-policy.json"
pass "module + design docs + IAM/S3 drafts present"

# --- Layout lock ---
for needle in \
  "tenants/{tenant_id}/chat-corpus/v1/" \
  "chat-corpus" \
  "retention" \
  "DenyVault" \
  "lp-gkh.3"
do
  grep -q -- "$needle" "$DOC" || fail "design doc missing required topic/string: $needle"
done
pass "design doc covers layout, retention, vault deny, bead id"

if ! grep -q 'tenants/{tenant_id}/chat-corpus/v1/' "$MOD/variables.tf"; then
  fail "variables.tf must default corpus_prefix_template to tenants/{tenant_id}/chat-corpus/v1/"
fi
if ! grep -q 'tenants/\*/chat-corpus/v1/\*' "$MOD/iam.tf" && ! grep -q 'chat-corpus/v1' "$MOD/iam.tf"; then
  fail "iam.tf must scope object resources to chat-corpus/v1"
fi
pass "prefix layout lock tenants/{tenant_id}/chat-corpus/v1/"

# --- Separate from vault ---
if ! grep -qi 'separate.*vault\|blast.radius\|vault' "$DOC"; then
  fail "design doc must require separate-from-vault / blast radius"
fi
if ! grep -q 'tenants/\*/vault' "$MOD/iam.tf"; then
  fail "iam.tf must Deny tenants/*/vault paths"
fi
if ! grep -q 'DenyVaultPathsBlastRadius' "$MOD/iam.tf"; then
  fail "iam.tf must include DenyVaultPathsBlastRadius sid"
fi
# Must not hard-require the mocklab vault bucket as corpus
if grep -RIn --include='*.tf' 'lanyard-mocklab-vault' "$MOD" >/dev/null 2>&1; then
  fail "module must not target the mocklab vault bucket as corpus storage"
fi
pass "separate-from-vault + Deny vault paths"

# --- Encryption + public access ---
for needle in \
  "aws_s3_bucket_server_side_encryption_configuration" \
  "aws_s3_bucket_public_access_block" \
  "block_public_acls" \
  "restrict_public_buckets" \
  "BucketOwnerEnforced" \
  "DenyInsecureTransport" \
  "aws:SecureTransport"
do
  grep -q -- "$needle" "$MOD/s3.tf" || fail "s3.tf missing required control: $needle"
done
if ! grep -q 'AES256' "$MOD/variables.tf"; then
  fail "variables.tf must allow AES256 SSE-S3 default"
fi
if ! grep -q 'aws:kms' "$MOD/variables.tf"; then
  fail "variables.tf must support aws:kms"
fi
if ! grep -q 'create_kms_key\|s3_kms_key_id' "$MOD/variables.tf"; then
  fail "variables.tf must support KMS key input or create_kms_key"
fi
pass "encryption + public access block + TLS-only"

# --- Lifecycle ---
if ! grep -q 'aws_s3_bucket_lifecycle_configuration' "$MOD/s3.tf"; then
  fail "s3.tf must define lifecycle configuration"
fi
if ! grep -q 'expire-chat-corpus-objects' "$MOD/s3.tf"; then
  fail "s3.tf must include expire-chat-corpus-objects rule"
fi
if ! grep -q 'retention_days' "$MOD/variables.tf"; then
  fail "variables.tf must declare retention_days"
fi
if ! grep -Eq 'default[[:space:]]*=[[:space:]]*90' "$MOD/variables.tf"; then
  # Accept default = 90 near retention_days
  if ! awk '/variable "retention_days"/,/^}/' "$MOD/variables.tf" | grep -Eq 'default[[:space:]]*=[[:space:]]*90'; then
    fail "retention_days default must be 90 (L10)"
  fi
fi
if ! awk '/variable "retention_days"/,/^}/' "$MOD/variables.tf" | grep -q '30'; then
  fail "retention_days validation must enforce L10 floor 30"
fi
for needle in "90 days" "retention" "lifecycle" "Legal hold"
do
  grep -qi -- "$needle" "$DOC" || fail "design doc missing lifecycle topic: $needle"
done
pass "lifecycle TTL from config (default 90, floor 30) documented"

# --- Writer / reader IAM ---
if ! grep -q 's3:PutObject' "$MOD/iam.tf"; then
  fail "iam.tf writer must allow s3:PutObject"
fi
if ! grep -q 's3:GetObject' "$MOD/iam.tf"; then
  fail "iam.tf reader must allow s3:GetObject"
fi
if ! grep -q 'PutCorpusObjectsOnly' "$MOD/iam.tf"; then
  fail "iam.tf missing PutCorpusObjectsOnly"
fi
if ! grep -q 'GetCorpusObjectsOnly' "$MOD/iam.tf"; then
  fail "iam.tf missing GetCorpusObjectsOnly"
fi
# Writer should not grant DeleteObject as Allow
if grep -E 'effect[[:space:]]*=[[:space:]]*"Allow"' -A 20 "$MOD/iam.tf" | grep -q 's3:DeleteObject'; then
  # Check more carefully with python below
  :
fi
pass "writer Put + reader Get present in module"

# --- Draft JSON static review ---
python3 - "$IAM_DIR" "$S3_DIR" <<'PY'
"""Static review of corpus IAM + bucket policy drafts — offline."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

iam_dir = Path(sys.argv[1])
s3_dir = Path(sys.argv[2])
errors: list[str] = []


def load(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        errors.append(f"{path.name}: invalid JSON: {e}")
        return {}
    if not isinstance(data, dict):
        errors.append(f"{path.name}: expected object")
        return {}
    if data.get("Version") != "2012-10-17":
        errors.append(f"{path.name}: Version must be 2012-10-17")
    stmts = data.get("Statement")
    if not isinstance(stmts, list) or not stmts:
        errors.append(f"{path.name}: Statement must be non-empty list")
    return data


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


def walk_strings(obj, acc: list[str]) -> None:
    if isinstance(obj, str):
        acc.append(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            walk_strings(v, acc)
    elif isinstance(obj, list):
        for v in obj:
            walk_strings(v, acc)


CORPUS_OBJECT = "arn:aws:s3:::${LANYARD_CHAT_CORPUS_BUCKET}/tenants/*/chat-corpus/v1/*"
VAULT_MARKERS = ("/vault", "tenants/*/vault")

# --- Writer ---
writer = load(iam_dir / "corpus-writer-policy.json")
w_stmts = [s for s in (writer.get("Statement") or []) if isinstance(s, dict)]
w_sids = {s.get("Sid") for s in w_stmts}
for required in (
    "PutCorpusObjectsOnly",
    "ListCorpusPrefixesOnly",
    "DenyVaultPathsBlastRadius",
    "DenyListVaultPrefixOnCorpusBucket",
):
    if required not in w_sids:
        errors.append(f"writer: missing Sid {required}")

put_allows = [
    s for s in w_stmts
    if s.get("Effect") == "Allow" and "s3:PutObject" in flatten_actions(s)
]
if not put_allows:
    errors.append("writer: no Allow for s3:PutObject")
for s in put_allows:
    res = flatten_resources(s)
    if not any("chat-corpus/v1" in r for r in res):
        errors.append("writer: PutObject must target chat-corpus/v1 resources")
    if any(r.endswith("/*") and "chat-corpus" not in r for r in res):
        # whole-bucket object allow
        if any(re.search(r"arn:aws:s3:::\$\{LANYARD_CHAT_CORPUS_BUCKET\}/\*$", r) for r in res):
            errors.append("writer: PutObject must not allow whole-bucket objects")

# Writer must not Allow GetObject or DeleteObject
for s in w_stmts:
    if s.get("Effect") != "Allow":
        continue
    acts = set(flatten_actions(s))
    if "s3:GetObject" in acts:
        errors.append("writer: must not Allow s3:GetObject")
    if "s3:DeleteObject" in acts:
        errors.append("writer: must not Allow s3:DeleteObject")

# --- Reader ---
reader = load(iam_dir / "corpus-reader-policy.json")
r_stmts = [s for s in (reader.get("Statement") or []) if isinstance(s, dict)]
r_sids = {s.get("Sid") for s in r_stmts}
for required in (
    "GetCorpusObjectsOnly",
    "ListCorpusPrefixesOnly",
    "DenyVaultPathsBlastRadius",
    "DenyListVaultPrefixOnCorpusBucket",
):
    if required not in r_sids:
        errors.append(f"reader: missing Sid {required}")

get_allows = [
    s for s in r_stmts
    if s.get("Effect") == "Allow" and "s3:GetObject" in flatten_actions(s)
]
if not get_allows:
    errors.append("reader: no Allow for s3:GetObject")
for s in get_allows:
    res = flatten_resources(s)
    if not any("chat-corpus/v1" in r for r in res):
        errors.append("reader: GetObject must target chat-corpus/v1 resources")

for s in r_stmts:
    if s.get("Effect") != "Allow":
        continue
    acts = set(flatten_actions(s))
    if "s3:PutObject" in acts:
        errors.append("reader: must not Allow s3:PutObject")
    if "s3:DeleteObject" in acts:
        errors.append("reader: must not Allow s3:DeleteObject")

# Both must Deny vault
for name, stmts in ("writer", w_stmts), ("reader", r_stmts):
    deny_vault = [
        s for s in stmts
        if s.get("Effect") == "Deny"
        and any("vault" in r for r in flatten_resources(s))
    ]
    # Also list-prefix deny
    list_vault_deny = [
        s for s in stmts
        if s.get("Effect") == "Deny"
        and "s3:ListBucket" in flatten_actions(s)
    ]
    if not deny_vault and not list_vault_deny:
        errors.append(f"{name}: missing Deny for vault paths")
    strings: list[str] = []
    walk_strings(stmts, strings)
    joined = "\n".join(strings)
    if "vault" not in joined:
        errors.append(f"{name}: no vault string in policy (Deny wall required)")
    # Must not Allow whole tenants/* tree
    for s in stmts:
        if s.get("Effect") != "Allow":
            continue
        for r in flatten_resources(s):
            if re.search(r"/tenants/\*/\*$", r) or r.endswith("/tenants/*"):
                errors.append(f"{name}: Allow resource too broad: {r}")

# No tenants/* Allow without chat-corpus mid-path for object ARNs
for name, stmts in ("writer", w_stmts), ("reader", r_stmts):
    for s in stmts:
        if s.get("Effect") != "Allow":
            continue
        for r in flatten_resources(s):
            if "arn:aws:s3:::" in r and "/*" in r and "chat-corpus" not in r and r != "arn:aws:s3:::${LANYARD_CHAT_CORPUS_BUCKET}":
                # bucket ARN alone is ok for ListBucket
                if r.rstrip("/").endswith("${LANYARD_CHAT_CORPUS_BUCKET}"):
                    continue
                errors.append(f"{name}: object Allow must include chat-corpus: {r}")

# --- Bucket policy ---
bp = load(s3_dir / "corpus-bucket-policy.json")
bp_stmts = [s for s in (bp.get("Statement") or []) if isinstance(s, dict)]
bp_sids = {s.get("Sid") for s in bp_stmts}
if "DenyInsecureTransport" not in bp_sids:
    errors.append("bucket policy: missing DenyInsecureTransport")
tls_ok = False
for s in bp_stmts:
    if s.get("Sid") == "DenyInsecureTransport":
        cond = s.get("Condition") or {}
        if "SecureTransport" in json.dumps(cond):
            tls_ok = True
if not tls_ok:
    errors.append("bucket policy: DenyInsecureTransport must condition on aws:SecureTransport")

# Forbidden secrets patterns
for path in list(iam_dir.glob("*.json")) + list(s3_dir.glob("*.json")):
    text = path.read_text(encoding="utf-8")
    if re.search(r"AKIA[0-9A-Z]{16}", text):
        errors.append(f"{path.name}: looks like AWS access key material")
    if "BEGIN PRIVATE KEY" in text:
        errors.append(f"{path.name}: private key material forbidden")

if errors:
    for e in errors:
        print(f"ERROR: {e}", file=sys.stderr)
    sys.exit(1)
print("OK: IAM drafts writer/reader + vault deny + bucket TLS policy")
PY
pass "IAM draft JSON static review"

# --- Outputs / contract ---
for needle in \
  "corpus_bucket_id" \
  "writer_role_arn" \
  "reader_role_arn" \
  "retention_days" \
  "deny_vault_resources" \
  "contract_summary" \
  "lifecycle_summary"
do
  grep -q -- "$needle" "$MOD/outputs.tf" || fail "outputs.tf missing $needle"
done
pass "module outputs expose bucket, roles, lifecycle, deny wall"

# --- Overview cross-link ---
if ! grep -q 'infra-bucket-iam-lifecycle\|lp-gkh.3\|chat-corpus-infra' "$OVERVIEW"; then
  # overview may only list bead table — require at least lp-gkh.3 mention
  grep -q 'lp-gkh.3' "$OVERVIEW" || fail "overview.md must reference lp-gkh.3"
fi
pass "plan overview still lists lp-gkh.3"

log "All offline chat-corpus infra checks passed."
