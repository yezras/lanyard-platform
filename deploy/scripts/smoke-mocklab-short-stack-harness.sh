#!/usr/bin/env bash
# Offline smoke: MockLab short-stack harness runbook + lab compose (lp-oop.30).
# No AWS apply, no ecs update-service, no Docker pull, no network.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MONO="$(cd "$ROOT/.." && pwd)"
LAB="$ROOT/dev/mocklab-short-stack-harness"
RUNBOOK="$ROOT/references/runbooks/mocklab-short-stack-harness.md"
PLAN="$MONO/docs/plans/0015-short-stack/mocklab-harness-deploy.md"

err() { echo "[smoke-mocklab-short-stack-harness] ERROR: $*" >&2; }
log() { echo "[smoke-mocklab-short-stack-harness] $*"; }
fail() { err "$*"; exit 1; }
pass() { log "OK: $*"; }

require_file() {
  local f="$1"
  [ -f "$f" ] || fail "required file missing: $f"
}

require_dir() {
  local d="$1"
  [ -d "$d" ] || fail "required directory missing: $d"
}

require_dir "$LAB"
for f in docker-compose.yml .env.example README.md run-lab-harness.sh task-definition.example.json start-la-harness.mjs merge-lab-echo-mcp.mjs merge-vault-fs-mcp.mjs; do
  require_file "$LAB/$f"
done
require_file "$RUNBOOK"
require_file "$PLAN"
pass "runbook + plan note + lab tree present"

# --- Runbook: existing cluster, no new product, guest default ---
for pat in \
  'lanyard-platform-staging-portal-cp' \
  'lp-oop\.30' \
  'No new AWS product|no new AWS product' \
  'CHAT_DELIVERY' \
  'HARNESS_URL' \
  'HARNESS_SERVICE_TOKEN' \
  'createHarnessTurnServer' \
  'desiredCount=1|desired count \*\*1\*\*|Desired count \*\*1\*\*' \
  'internal' \
  'relay'
do
  grep -Eq "$pat" "$RUNBOOK" || fail "runbook missing /$pat/"
done
pass "runbook names existing CP cluster + dual-run default"

if grep -Eiq 'terraform apply|ecs update-service --desired-count' "$RUNBOOK"; then
  grep -Eq 'Do \*\*not\*\* run `terraform apply`|does \*\*not\*\* apply Terraform|does \*\*not\*\* `ecs update-service`' "$RUNBOOK" \
    || fail "runbook mentions apply/update-service without a do-not"
fi
pass "runbook does not instruct a stack apply"

# Forbidden new products must be named as forbidden, not as create-this
for product in OpenSearch Lambda; do
  if grep -Eq "create.*${product}|new ${product}" "$RUNBOOK"; then
    grep -Eiq "Do not create|Do \*\*not\*\* add|Forbidden|not add ${product}" "$RUNBOOK" \
      || fail "runbook must forbid new $product, not introduce it"
  fi
done
grep -Eq 'OpenSearch' "$RUNBOOK" || fail "runbook must explicitly forbid OpenSearch"
grep -Eq 'Valkey|Redis' "$RUNBOOK" || fail "runbook must explicitly forbid extra Redis/Valkey"
grep -Eq 'Lambda' "$RUNBOOK" || fail "runbook must explicitly forbid Lambda"
grep -Eq 'new ECS cluster|Do not create.*cluster' "$RUNBOOK" || fail "runbook must forbid a new ECS cluster"
pass "runbook forbids new AWS products"

# Guest path stays default
if grep -Eq 'CHAT_DELIVERY=harness' "$RUNBOOK"; then
  grep -Eq 'Do not set a global BFF `CHAT_DELIVERY=harness`|Leave `CHAT_DELIVERY` unset' "$RUNBOOK" \
    || fail "runbook must not flip global CHAT_DELIVERY=harness"
fi
pass "guest/relay default preserved"

# No secret material
if grep -Eiq 'HARNESS_SERVICE_TOKEN=[A-Za-z0-9/+]{20,}|AKIA[0-9A-Z]{16}|GATEWAY_RELAY_SECRET=[^P]' "$RUNBOOK" "$PLAN" "$LAB/README.md" "$LAB/.env.example"; then
  fail "docs appear to contain secret material"
fi
if grep -Eiq 'arn:aws:secretsmanager:[a-z0-9-]+:[0-9]{12}:' "$RUNBOOK" "$LAB/task-definition.example.json"; then
  fail "docs must not embed a live account-id secret ARN"
fi
pass "no obvious secret material"

# --- Compose invariants ---
COMPOSE="$LAB/docker-compose.yml"
ENVEX="$LAB/.env.example"
grep -Eq 'lp-oop\.30' "$COMPOSE" || fail "compose must label bead lp-oop.30"
grep -Eq 'mocklab-short-stack-harness' "$COMPOSE" || fail "compose must name topology mocklab-short-stack-harness"
grep -Eq 'profiles:.*harness|profiles: \["harness"\]' "$COMPOSE" || fail "compose harness service must be optional (profile harness)"
grep -Eq 'HARNESS_HOST_BIND:-127.0.0.1|127.0.0.1:.*8080' "$COMPOSE" || fail "compose must default to loopback publish"
grep -Eq 'HARNESS_SERVICE_TOKEN' "$COMPOSE" || fail "compose must pass HARNESS_SERVICE_TOKEN"
grep -Eq 'BACKEND_HOME' "$COMPOSE" || fail "compose must pass BACKEND_HOME kitchen-sink home"
grep -Fq 'ensureLabEchoMcpConfig' "$LAB/start-la-harness.mjs" \
  || fail "start wrapper must merge lab_echo into BACKEND_HOME"
if grep -Eiq 'production[[:space:]]*:[[:space:]]*"?true"?' "$COMPOSE"; then
  fail "compose must not set production=true"
fi
grep -Eq 'lanyard.production: "false"' "$COMPOSE" || fail "compose must label production=false"
pass "compose profile/loopback/lab labels"

grep -Eq 'placeholder-harness-service-token|not-for-production|not for production' "$ENVEX" \
  || fail ".env.example must be clearly lab-only"
if grep -Eiq 'arn:aws:secretsmanager|AKIA[0-9A-Z]{16}' "$ENVEX"; then
  fail ".env.example must not contain production SM ARNs or cloud access keys"
fi
pass ".env.example is lab-only"

# --- Example task def: existing family shape, digest pin, no CP task role ---
TD="$LAB/task-definition.example.json"
grep -Eq 'lanyard-platform-staging-harness' "$TD" || fail "example task family must be lanyard-platform-staging-harness"
grep -Eq 'sha256:REPLACE_64_HEX_DIGEST|@sha256:' "$TD" || fail "example image must be digest-shaped"
grep -Eq 'lanyard-platform-staging-portal-cp' "$TD" || fail "example must name existing CP cluster"
if grep -Eq 'lanyard-platform-staging-cp-task' "$TD"; then
  fail "example must not reuse the CP task role (Daytona/model keys)"
fi
python3 - "$TD" <<'PY' || fail "example task secrets[] vs plaintext env check failed"
import json, sys
from pathlib import Path
td = json.loads(Path(sys.argv[1]).read_text())
c = td["containerDefinitions"][0]
env = {r["name"] for r in c.get("environment") or []}
secrets = c.get("secrets") or []
vfs = [r.get("valueFrom") or "" for r in secrets]
plain_forbidden = {"XAI_API_KEY", "GATEWAY_RELAY_SECRET", "DAYTONA_API_KEY", "LITELLM_API_KEY"}
if plain_forbidden & env:
    raise SystemExit("plaintext env must not hold " + ",".join(sorted(plain_forbidden & env)))
for name in (
    "lanyard/staging/portal/harness-litellm",
    "lanyard/staging/portal/daytona",
    "lanyard/staging/portal/harness-service-token",
):
    if not any(name in vf for vf in vfs):
        raise SystemExit("secrets[] missing " + name)
print("task secrets valueFrom ok")
PY
pass "example task def is private Fargate + digest + SM secrets + no CP role"

# --- Wrapper ---
bash -n "$LAB/run-lab-harness.sh" || fail "run-lab-harness.sh failed bash -n"
grep -Eq 'createHarnessTurnServer' "$LAB/run-lab-harness.sh" || fail "wrapper must start createHarnessTurnServer"
grep -Fq 'ensureVaultFsMcpConfig' "$LAB/start-la-harness.mjs" || fail "start wrapper missing vault_fs BACKEND_HOME merge"
grep -Fq 'ensureLabEchoMcpConfig' "$LAB/start-la-harness.mjs" || fail "start wrapper missing lab_echo BACKEND_HOME merge"
python3 - "$LAB/start-la-harness.mjs" <<'PY' || fail "start wrapper must merge lab_echo and vault_fs before tools factory"
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text()
lab = text.find("ensureLabEchoMcpConfig")
vault = text.find("ensureVaultFsMcpConfig")
factory = text.find("toolsTurnRunnerFactory(mod)")
if lab < 0 or vault < 0 or factory < 0 or lab > factory or vault > factory:
    raise SystemExit(f"MCP merge must run before toolsTurnRunnerFactory (lab={lab} vault={vault} factory={factory})")
PY
grep -Eq 'BACKEND_HOME' "$LAB/run-lab-harness.sh" || fail "wrapper must materialize BACKEND_HOME"
grep -Eq 'start-la-harness.mjs' "$LAB/run-lab-harness.sh" || fail "wrapper must exec start-la-harness.mjs"
pass "lab wrapper syntax + LA entry + vault_fs/lab_echo merge"

# --- Plan note ---
grep -Eq 'lp-oop\.30' "$PLAN" || fail "plan note missing bead id"
grep -Eq 'lanyard-platform-staging-portal-cp' "$PLAN" || fail "plan note must name existing cluster"
pass "plan note present"

echo "smoke-mocklab-short-stack-harness: PASS"
