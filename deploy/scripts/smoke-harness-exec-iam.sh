#!/usr/bin/env bash
# Offline smoke: harness exec-role GetSecretValue for harness-litellm + daytona
# (lp-oop.38.20). No AWS credentials, no terraform apply, no network, no secrets.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MOD="$ROOT/deploy/modules/harness-exec-iam"
BFF="$ROOT/deploy/modules/portal-bff-service"
STAGING="$ROOT/deploy/environments/platform-staging"
TD="$ROOT/deploy/dev/mocklab-short-stack-harness/task-definition.example.json"
RUNBOOK="$ROOT/deploy/references/runbooks/mocklab-short-stack-harness.md"
CHECKLIST="$ROOT/deploy/references/runbooks/staging-secrets-checklist.md"

err() { echo "[smoke-harness-exec-iam] ERROR: $*" >&2; }
log() { echo "[smoke-harness-exec-iam] $*"; }
fail() { err "$*"; exit 1; }
pass() { log "OK: $*"; }

need_file() {
  [ -f "$1" ] || fail "missing required file: $1"
}

need_file "$MOD/secret-catalog.json"
need_file "$MOD/main.tf"
need_file "$MOD/iam.tf"
need_file "$MOD/variables.tf"
need_file "$MOD/outputs.tf"
need_file "$MOD/README.md"
need_file "$MOD/INDEX.md"
need_file "$MOD/terraform.tfvars.example"
need_file "$TD"
need_file "$RUNBOOK"
need_file "$BFF/variables.tf"
need_file "$BFF/main.tf"
need_file "$STAGING/variables.tf"
need_file "$STAGING/main.tf"
pass "module + task def + runbook present"

python3 - "$MOD" "$BFF" "$STAGING" "$TD" "$RUNBOOK" "$CHECKLIST" <<'PY'
"""Prove exec IAM catalog, task secrets[], and BFF extra ARNs stay aligned."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

mod, bff, staging, td_path, runbook, checklist = map(Path, sys.argv[1:])
errors: list[str] = []

catalog = json.loads((mod / "secret-catalog.json").read_text())
names = catalog.get("secret_names") or []
required = {
    "lanyard/staging/portal/harness-service-token",
    "lanyard/staging/portal/harness-litellm",
    "lanyard/staging/portal/daytona",
}
missing = required - set(names)
if missing:
    errors.append(f"catalog missing {sorted(missing)}")

iam = (mod / "iam.tf").read_text()
main = (mod / "main.tf").read_text()
if "secretsmanager:GetSecretValue" not in iam:
    errors.append("iam.tf must grant secretsmanager:GetSecretValue")
if "local.secret_arn_patterns" not in iam:
    errors.append("iam.tf Resource must be local.secret_arn_patterns")
if re.search(r'Resource\s*=\s*"\*"', iam):
    errors.append("iam.tf must not use Resource=\"*\"")
if 'AmazonECSTaskExecutionRolePolicy' not in iam:
    errors.append("iam.tf must attach AmazonECSTaskExecutionRolePolicy")
if "ecs-tasks.amazonaws.com" not in iam:
    errors.append("iam.tf trust must be ecs-tasks.amazonaws.com")
if "secret:${n}-*" not in main and "secret:${n}-*" not in (mod / "main.tf").read_text():
    if 'secret:${n}-*' not in main:
        errors.append("main.tf must derive SM ARN patterns with -* suffix")
for n in ("harness-litellm", "daytona"):
    if n not in main and n not in (mod / "secret-catalog.json").read_text():
        errors.append(f"module must name {n}")

vars_tf = (mod / "variables.tf").read_text()
if "acknowledge_not_auto_applied" not in vars_tf:
    errors.append("module missing acknowledge_not_auto_applied")
example = (mod / "terraform.tfvars.example").read_text()
if "acknowledge_not_auto_applied = true" not in example:
    errors.append("tfvars.example must set acknowledge_not_auto_applied = true")
if re.search(r"arn:aws:secretsmanager:[a-z0-9-]+:(?!000000000000)[0-9]{12}:", example):
    errors.append("tfvars.example must not embed a live account-id secret ARN")

td = json.loads(td_path.read_text())
container = td["containerDefinitions"][0]
env_names = {row["name"] for row in container.get("environment") or []}
secret_rows = container.get("secrets") or []
value_froms = [row.get("valueFrom") or "" for row in secret_rows]
secret_env = {row.get("name") for row in secret_rows}

plaintext_forbidden = {"LITELLM_API_KEY", "LITELLM_MASTER_KEY", "DAYTONA_API_KEY", "XAI_API_KEY", "GATEWAY_RELAY_SECRET"}
in_env = sorted(plaintext_forbidden & env_names)
if in_env:
    errors.append(f"task environment[] must not hold {in_env}; use secrets[] valueFrom")

for n in required:
    if not any(n in vf for vf in value_froms):
        errors.append(f"task secrets[] must valueFrom SM name {n}")

if "LITELLM_API_KEY" not in secret_env:
    errors.append("task secrets[] must inject LITELLM_API_KEY from harness-litellm")
if "DAYTONA_API_KEY" not in secret_env:
    errors.append("task secrets[] must inject DAYTONA_API_KEY from daytona")
if td.get("executionRoleArn", "").endswith("bff-exec") or "bff-exec" in str(td.get("executionRoleArn")):
    errors.append("example executionRoleArn must be dedicated REPLACE-harness-exec (not bff-exec)")
if "lanyard-platform-staging-cp-task" in json.dumps(td):
    errors.append("example must not reuse the CP task role")
if re.search(r"arn:aws:secretsmanager:[a-z0-9-]+:[0-9]{12}:", json.dumps(td)):
    errors.append("task-definition.example.json must not embed a live account-id secret ARN")

bff_vars = (bff / "variables.tf").read_text()
bff_main = (bff / "main.tf").read_text()
if 'variable "execution_extra_secret_arns"' not in bff_vars:
    errors.append("portal-bff-service must declare execution_extra_secret_arns")
if "execution_extra_sm_arns" not in bff_main:
    errors.append("portal-bff-service must union extra ARNs into secretsmanager_arns")
secrets_list_block = bff_main.split("secrets_list", 1)[-1][:250]
if "local.effective_secrets" not in secrets_list_block:
    errors.append("secrets_list must iterate local.effective_secrets only")
if "execution_extra_secret_arns" in secrets_list_block:
    errors.append("execution_extra_secret_arns must not feed secrets_list")

stg_vars = (staging / "variables.tf").read_text()
stg_main = (staging / "main.tf").read_text()
if 'variable "bff_execution_extra_secret_arns"' not in stg_vars:
    errors.append("platform-staging must declare bff_execution_extra_secret_arns")
if "execution_extra_secret_arns" not in stg_main:
    errors.append("platform-staging must pass execution_extra_secret_arns into portal_bff")

docs = runbook.read_text() + "\n" + checklist.read_text()
for needle in ("lp-oop.38.20", "harness-litellm", "GetSecretValue", "harness-exec"):
    if needle not in docs:
        errors.append(f"runbook/checklist missing {needle}")
if not re.search(
    r"does \*\*not\*\* apply Terraform|Do \*\*not\*\* .*terraform apply|Does not terraform apply",
    docs,
    re.I,
):
    errors.append("docs must refuse terraform apply from this bead")

if errors:
    print("FAIL")
    for e in errors:
        print(f"  {e}")
    raise SystemExit(1)
print("catalog + task secrets[] + BFF extra ARNs aligned")
PY
pass "catalog, task secrets[], BFF extra ARNs, docs aligned"

# Dedicated role, not CP task; no Resource=*
grep -Eq 'REPLACE-harness-exec' "$TD" || fail "example must keep REPLACE-harness-exec"
if grep -Eq 'lanyard-platform-staging-cp-task' "$TD"; then
  fail "example must not reuse the CP task role"
fi
if grep -nE 'secretsmanager:GetSecretValue' "$MOD/iam.tf" | grep -q 'Resource[[:space:]]*=[[:space:]]*"\*"'; then
  fail "harness-exec-iam must not grant GetSecretValue with Resource=\"*\""
fi
grep -Eqi 'not auto-applied|do not terraform apply' "$MOD/README.md" \
  || fail "module README must refuse terraform apply from this bead"
pass "least-privilege exec + no apply from this bead"

echo "smoke-harness-exec-iam: PASS"
