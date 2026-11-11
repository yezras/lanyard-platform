#!/usr/bin/env bash
# Offline smoke: lp-oop.38.2 tools runner bind + 38.1 harness image + 37.4 pin/runbook.
# No AWS apply, no ecs update-service, no Docker pull, no network.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MONO="$(cd "$ROOT/.." && pwd)"
LAB="$ROOT/dev/mocklab-short-stack-harness"
RUNBOOK="$ROOT/references/runbooks/mocklab-replace-echo-harness-la.md"
PLAN="$MONO/docs/plans/0015-short-stack/replace-echo-harness-la.md"
PIN="$MONO/artifacts/mocklab/short-stack/la-harness.pins.yaml"
RESULT="$MONO/artifacts/mocklab/short-stack/la-harness-cutover/RESULT.md"
STATUS="$MONO/artifacts/mocklab/short-stack/la-harness-cutover/pr-242-status.json"
README="$MONO/artifacts/mocklab/short-stack/README.md"
TESTING="$MONO/docs/plans/0015-short-stack/testing.md"
ISSUE_MAP="$MONO/docs/plans/0015-short-stack/issue-map.md"
TURN="$MONO/portal/packages/shared/src/harness/turn.ts"
BUILD="$ROOT/scripts/build-la-harness-image.sh"
START="$LAB/start-la-harness.mjs"
MERGE_MCP="$LAB/merge-lab-echo-mcp.mjs"
MERGE_MCP_TEST="$LAB/merge-lab-echo-mcp.test.mjs"
ENSURE="$LAB/ensure-subagents-config.mjs"
ENSURE_TEST="$LAB/ensure-subagents-config.test.mjs"
SEED_CONFIG="$LAB/config.yaml"
DOCKERFILE="$LAB/Dockerfile"
TD="$LAB/task-definition.example.json"
GUEST_SMOKE="$ROOT/daytona/agent-gateway/smoke-no-lanyard-agent-tree.sh"
GUEST_DF="$ROOT/daytona/agent-gateway/Dockerfile"
PIN_SHA="2477b22ec4d33161a6ff122cef6b01fe268d98de"
PIN_SHA_SHORT="2477b22"
FILE_TOOLS_SHA="ad0ef5a03737e004d516c3fe2a22840c73510d6c"
STATUS_SHA="fb70865bf8c74a6eb980095fa404e5b7e9327f13"
STATUS_SHA_SHORT="fb70865"
LIVE_TAG="la-52f5e4d"

err() { echo "[smoke-mocklab-replace-echo-harness-la] ERROR: $*" >&2; }
log() { echo "[smoke-mocklab-replace-echo-harness-la] $*"; }
fail() { err "$*"; exit 1; }
pass() { log "OK: $*"; }

require_file() {
  local f="$1"
  [[ -f "$f" ]] || fail "required file missing: $f"
}

for f in \
  "$RUNBOOK" "$PLAN" "$PIN" "$RESULT" "$STATUS" "$README" "$TESTING" \
  "$ISSUE_MAP" "$TURN" "$BUILD" "$START" "$MERGE_MCP" "$MERGE_MCP_TEST" \
  "$ENSURE" "$ENSURE_TEST" "$SEED_CONFIG" \
  "$DOCKERFILE" "$TD" "$GUEST_SMOKE" "$GUEST_DF"
do
  require_file "$f"
done
pass "pin + runbook + image recipe + evidence present"

bash -n "$BUILD" || fail "build-la-harness-image.sh failed bash -n"
bash -n "$0" || fail "smoke script failed bash -n"
bash "$BUILD" --check || fail "build --check failed"
node --test "$MERGE_MCP_TEST" || fail "merge-lab-echo-mcp tests failed"
grep -Fq 'BACKEND_HOME=/var/lib/lanyard-backend' "$DOCKERFILE" \
  || fail "Dockerfile must default BACKEND_HOME for lab_echo merge"
grep -Fq 'ensureLabEchoMcpConfig' "$START" \
  || fail "start wrapper must merge lab_echo into BACKEND_HOME"
grep -Fq 'ensureVaultFsMcpConfig' "$START" || fail "start wrapper must merge vault_fs into BACKEND_HOME"
grep -Fq 'merge-vault-fs-mcp.mjs' "$DOCKERFILE" || fail "Dockerfile must COPY vault_fs merge"
[[ -f "$LAB/merge-vault-fs-mcp.mjs" ]] || fail "missing merge-vault-fs-mcp.mjs"
node --test "$LAB/merge-vault-fs-mcp.test.mjs" || fail "vault_fs merge tests failed"
python3 - "$START" <<'PY' || fail "start wrapper must merge lab_echo and vault_fs before tools factory"
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text()
lab = text.find("ensureLabEchoMcpConfig")
vault = text.find("ensureVaultFsMcpConfig")
factory = text.find("toolsTurnRunnerFactory(mod)")
if lab < 0 or vault < 0 or factory < 0 or lab > factory or vault > factory:
    raise SystemExit(f"MCP merge must run before toolsTurnRunnerFactory (lab={lab} vault={vault} factory={factory})")
PY
pass "bash -n + build --check + lab_echo + vault_fs merge tests"

# --- Pin / evidence: PR 243 MERGED image pin, live :3 still echo ---
for pat in \
  'lp-oop\.38\.1' \
  'lp-oop\.37\.4' \
  '52f5e4d' \
  'ad0ef5a' \
  '2477b22' \
  'live-cutover-blocked' \
  'lanyard-platform-staging-harness' \
  'la-52f5e4d' \
  'createHarnessTurnServer' \
  'createEnvLiteLlmTurnRunner' \
  'x-harness-service-token' \
  'tenant_id' \
  'user_id' \
  'instance_id' \
  'agent_core_required: false' \
  'apply_to_live: false'
do
  grep -Eq "$pat" "$PIN" || fail "pin missing /$pat/"
done
grep -Eq 'pr_state: MERGED' "$PIN" || fail "pin must record PR 242 MERGED"
grep -Eq 'revision: 3' "$PIN" || fail "pin must record live revision 3"
grep -Fq "$PIN_SHA" "$PIN" || fail "pin must target spawn SHA $PIN_SHA"
grep -Fq "$FILE_TOOLS_SHA" "$PIN" || fail "pin must keep previous file/bash SHA $FILE_TOOLS_SHA"
grep -Fq "la-${PIN_SHA_SHORT}" "$PIN" || fail "pin must name target tag la-${PIN_SHA_SHORT}"
pass "pin names live :3 / la-52f5e4d + blocked real-reply"

python3 - "$STATUS" "$STATUS_SHA" "$STATUS_SHA_SHORT" <<'PY'
import json, re, sys
from pathlib import Path
p = Path(sys.argv[1])
sha = sys.argv[2]
short = sys.argv[3]
data = json.loads(p.read_text())
if data.get("bead_id") != "lp-oop.37.4":
    raise SystemExit("bead_id")
if data.get("result") != "BLOCKED":
    raise SystemExit("result")
if data.get("live_cutover") != "blocked":
    raise SystemExit("live_cutover")
if data.get("apply_to_live") is not False:
    raise SystemExit("apply_to_live")
if data.get("terraform_apply") is not False:
    raise SystemExit("terraform_apply")
if data.get("ecs_update_service") is not False:
    raise SystemExit("ecs_update_service")
if data.get("ecr_push") is not False:
    raise SystemExit("ecr_push")
if data.get("agent_core_required_on_guest") is not False:
    raise SystemExit("guest agent-core")
live = data.get("live_now") or {}
if live.get("revision") != 3 or live.get("ecr_tag") != "la-52f5e4d":
    raise SystemExit("live :3 / la-52f5e4d")
if live.get("kind") != "createHarnessTurnServer":
    raise SystemExit("live kind")
if "echo:" not in str(live.get("reply_shape") or ""):
    raise SystemExit("live reply still echo")
la = data.get("lanyard_agent") or {}
if la.get("pr") != 244 or la.get("pr_state") != "MERGED":
    raise SystemExit("pr 244 state")
if la.get("git_commit") != sha:
    raise SystemExit("sha")
if short not in str(la.get("git_commit") or "") and la.get("git_commit_short") != short:
    raise SystemExit("short sha")
if la.get("on_origin_main") is not True:
    raise SystemExit("on main")
fields = data.get("turn_request_fields") or []
for key in ("tenant_id", "user_id", "instance_id"):
    if key not in fields:
        raise SystemExit(f"missing {key}")
checks = data.get("checks") or {}
if checks.get("live.echo_replaced") is not False:
    raise SystemExit("must not claim echo replaced")
if checks.get("live.real_la_reply") is not False:
    raise SystemExit("must not claim real LA reply")
if checks.get("guest.no_agent_core_required") is not True:
    raise SystemExit("guest")
if checks.get("start_wrapper.looks_for_env_runner_factory") is not True:
    raise SystemExit("factory check")
blob = json.dumps(data)
if re.search(r"AKIA[0-9A-Z]{16}", blob):
    raise SystemExit("aws key")
if re.search(r"arn:aws:secretsmanager:[a-z0-9-]+:[0-9]{12}:", blob):
    raise SystemExit("live secret arn")
print("status json ok")
PY
pass "pr-242-status.json: BLOCKED + MERGED 244/fb70865 + live :3/la-52f5e4d + no secrets"

grep -Eq 'BLOCKED' "$RESULT" || fail "RESULT.md must say BLOCKED"
grep -Eq 'la-52f5e4d' "$RESULT" || fail "RESULT.md must name live tag la-52f5e4d"
grep -Eq 'createHarnessTurnServer' "$RESULT" || fail "RESULT.md must name createHarnessTurnServer"
grep -Eq 'tenant_id' "$RESULT" || fail "RESULT.md must keep tenant_id on the turn"
grep -Eq 'no agent-core tree required' "$RESULT" || fail "RESULT.md must keep guest free of agent-core"
grep -Eq 'echo:' "$RESULT" || fail "RESULT.md must say live reply is still echo"
pass "RESULT.md honesty"

# --- Runbook / plan ---
for pat in \
  'lp-oop\.37\.4' \
  'createHarnessTurnServer' \
  'createEnvLiteLlmTurnRunner' \
  'lanyard-platform-staging-portal-cp' \
  'x-harness-service-token' \
  'tenant_id' \
  'user_id' \
  'instance_id' \
  'BLOCKED' \
  'la-52f5e4d' \
  '52f5e4d' \
  'Does \*\*not\*\* apply Terraform|does \*\*not\*\* apply Terraform' \
  'does \*\*not\*\* `ecs update-service`' \
  'LITELLM_BASE_URL' \
  'LITELLM_API_KEY' \
  'LITELLM_MASTER_KEY' \
  'HARNESS_MODEL' \
  'LANYARD_DEFAULT_MODEL'
do
  grep -Eq "$pat" "$RUNBOOK" || fail "runbook missing /$pat/"
done
pass "runbook names existing cluster + blocked real-reply"

if grep -Eiq 'terraform apply|ecs update-service' "$RUNBOOK" "$PLAN" "$BUILD"; then
  grep -Eq 'does \*\*not\*\* apply Terraform|Does NOT terraform apply|does \*\*not\*\* `ecs update-service`|Does NOT ecs update-service' "$RUNBOOK" "$BUILD" \
    || fail "docs mention apply/update-service without a do-not"
fi
if grep -Eq '^[[:space:]]*aws ecs update-service' "$BUILD" "$0"; then
  fail "default scripts must not invoke aws ecs update-service"
fi
pass "docs do not instruct a live apply from this bead"

# --- Image recipe: LA runner, not guest snapshot ---
grep -Eq 'createHarnessTurnServer' "$START" "$DOCKERFILE" || fail "start/Dockerfile must call createHarnessTurnServer"
grep -Eq 'HARNESS_PORT' "$DOCKERFILE" || fail "Dockerfile must bind 8080"
# Slim image: adapters-portal harness subtree + providers (not package-root).
grep -Fq 'HARNESS_MODULE=/opt/lanyard-agent/packages/adapters-portal/dist/harness/index.js' "$DOCKERFILE" \
  || fail "Dockerfile HARNESS_MODULE must default to dist/harness/index.js"
if grep -Eq 'HARNESS_MODULE=/opt/lanyard-agent/packages/adapters-portal/dist/index\.js' "$DOCKERFILE"; then
  fail "Dockerfile must not default HARNESS_MODULE to package-root dist/index.js"
fi
grep -Fq '/opt/lanyard-agent/packages/adapters-portal/dist/harness/index.js' "$START" \
  || fail "start wrapper must prefer dist/harness/index.js"
grep -Eq 'isPackageRootIndex' "$START" \
  || fail "start wrapper must remap package-root dist/index.js to harness subtree"
grep -Eq 'createEnvLiteLlmTurnRunner' "$START" \
  || fail "start wrapper must look for createEnvLiteLlmTurnRunner"
grep -Eq 'createEnvToolsTurnRunner' "$START" \
  || fail "start wrapper must look for createEnvToolsTurnRunner"
grep -Fq "$PIN_SHA_SHORT" "$START" \
  || fail "start wrapper must name spawn pin $PIN_SHA_SHORT"
grep -Fq 'spawn_schemas=' "$START" \
  || fail "start wrapper must log spawn_schemas=present|missing"
grep -Fq 'toolsFactory(process.env, { backendHome })' "$START" \
  || fail "start wrapper must pass backendHome into the tools factory"
grep -Fq 'HARNESS_REQUIRE_SPAWN' "$START" "$DOCKERFILE" \
  || fail "image/start must fail boot when spawn schemas are required and missing"
grep -Fq 'HARNESS_REQUIRE_MEMORY' "$START" "$DOCKERFILE" \
  || fail "image/start must fail boot when memory_read is required and missing"
grep -Fq 'memory_read=present' "$START" \
  || fail "start wrapper must log memory_read=present|missing"
grep -Fq 'createEnvHarnessSettingsLoader(loaderEnv)' "$START" \
  || fail "start wrapper must bind BACKEND_HOME into the settings loader"
grep -Eq 'createAgentCoreTurnRunner' "$START" \
  || fail "start wrapper must look for createAgentCoreTurnRunner"
grep -Eq 'createToolsTurnRunner' "$START" \
  || fail "start wrapper must bind createToolsTurnRunner for tools-lab"
grep -Eq 'scheduled_task' "$START" \
  || fail "start wrapper must document scheduled_task create bind (lp-oop.38.16)"
grep -Eq 'CONTROL_PLANE_URL' "$START" "$TD" \
  || fail "start wrapper / task-def example must name CONTROL_PLANE_URL for vault cron create"
grep -Eq 'No guest ticker|no guest ticker' "$START" \
  || fail "start wrapper must refuse a guest ticker for scheduled_task"
if grep -Eq 'SCHEDULE_EVALUATOR_ENABLED=true' "$START" "$TD" "$LAB/docker-compose.yml"; then
  fail "must not enable SCHEDULE_EVALUATOR_ENABLED in harness start/task-def/compose"
fi
grep -Eq 'runnerKind = "tools"' "$START" \
  || fail "start wrapper must bind runnerKind=tools"
grep -Fq 'runnerKind = "tools-lab"' "$START" \
  || fail "start wrapper must bind runnerKind=tools-lab when LiteLLM is missing"
grep -Eq 'runner=\$\{runnerKind\}|runner=litellm\|echo|runner=tools' "$START" \
  || fail "start wrapper must log runner=tools|tools-lab|litellm|echo"
# Harness image MUST COPY agent-core (Fargate tools runner import).
grep -Fq 'COPY packages/agent-core/package.json' "$DOCKERFILE" \
  || fail "harness Dockerfile must COPY packages/agent-core/package.json"
grep -Fq 'COPY packages/agent-core/dist' "$DOCKERFILE" \
  || fail "harness Dockerfile must COPY packages/agent-core/dist"
grep -Eq 'ln -s /opt/lanyard-agent/packages/agent-core node_modules/@lanyard-agent/agent-core' "$DOCKERFILE" \
  || fail "harness Dockerfile must symlink agent-core for @lanyard-agent/agent-core"
for pkg in config logging memory session; do
  grep -Fq "COPY packages/${pkg}/package.json" "$DOCKERFILE" \
    || fail "harness Dockerfile must COPY packages/${pkg}/package.json"
  grep -Fq "COPY packages/${pkg}/dist" "$DOCKERFILE" \
    || fail "harness Dockerfile must COPY packages/${pkg}/dist"
done
grep -Fq 'COPY node_modules/.pnpm' "$DOCKERFILE" \
  || fail "harness Dockerfile must COPY production node_modules/.pnpm from operator checkout"
grep -Eqi 'Do not npm install on boot|do not npm/pnpm install on boot' "$DOCKERFILE" \
  || fail "harness Dockerfile must refuse npm install on boot"
grep -Eqi 'Do NOT COPY this tree onto the Daytona|Daytona guest snapshot' "$DOCKERFILE" \
  || fail "harness Dockerfile must still forbid copying agent-core onto Daytona"
grep -Fq 'ENV BACKEND_HOME=/var/lib/lanyard-backend' "$DOCKERFILE" \
  || fail "harness Dockerfile must set BACKEND_HOME kitchen-sink home"
grep -Fq 'COPY --from=vaultseed' "$DOCKERFILE" \
  || fail "harness Dockerfile must COPY vault seed into BACKEND_HOME"
# Guest snapshot must still not COPY agent-core / lanyard-agent tree.
if grep -Ei '^[[:space:]]*COPY ' "$GUEST_DF" | grep -Eiq 'agent-core|[[:space:]/]lanyard-agent(/|$)|packages/lanyard-agent'; then
  fail "guest Dockerfile must not COPY agent-core / lanyard-agent tree"
fi
grep -Fq 'COPY packages/providers/package.json' "$DOCKERFILE" \
  || fail "Dockerfile must COPY packages/providers/package.json"
grep -Fq 'COPY packages/providers/dist' "$DOCKERFILE" \
  || fail "Dockerfile must COPY packages/providers/dist"
grep -Fq 'node_modules/@lanyard-agent' "$DOCKERFILE" \
  || fail "Dockerfile must create node_modules/@lanyard-agent"
grep -Eq 'ln -s /opt/lanyard-agent/packages/providers node_modules/@lanyard-agent/providers' "$DOCKERFILE" \
  || fail "Dockerfile must symlink providers for @lanyard-agent/providers"
grep -Eq 'LiteLLM HTTP client' "$DOCKERFILE" \
  || fail "Dockerfile must comment that providers is the LiteLLM HTTP client"
python3 - "$DOCKERFILE" <<'PY'
from pathlib import Path
import sys
lines = Path(sys.argv[1]).read_text().splitlines()
def first(pred):
    for i, line in enumerate(lines):
        if pred(line):
            return i
    return -1
copy_providers = first(lambda l: l.startswith("COPY packages/providers/"))
copy_agent_core = first(lambda l: l.startswith("COPY packages/agent-core/"))
copy_pnpm = first(lambda l: "COPY node_modules/.pnpm" in l)
link_providers = first(lambda l: "node_modules/@lanyard-agent/providers" in l and "ln -s" in l)
link_agent_core = first(lambda l: "node_modules/@lanyard-agent/agent-core" in l and "ln -s" in l)
user_node = first(lambda l: l.strip() == "USER node")
missing = [n for n, v in (
    ("providers COPY", copy_providers),
    ("agent-core COPY", copy_agent_core),
    ("pnpm store COPY", copy_pnpm),
    ("providers symlink", link_providers),
    ("agent-core symlink", link_agent_core),
    ("USER node", user_node),
) if v < 0]
if missing:
    raise SystemExit("missing: " + ", ".join(missing))
if not all(v < user_node for v in (copy_providers, copy_agent_core, copy_pnpm, link_providers, link_agent_core)):
    raise SystemExit("workspace COPY + symlink must be before USER node")
print("providers + agent-core resolve order ok")
PY
grep -Eq 'harness/index' "$DOCKERFILE" \
  || fail "Dockerfile must say runner is loaded from harness/index exports"
node --check "$START" || fail "start-la-harness.mjs failed node --check"
node --check "$ENSURE" || fail "ensure-subagents-config.mjs failed node --check"
grep -Fq 'ensure-subagents-config.mjs' "$START" \
  || fail "start wrapper must import ensure-subagents-config.mjs"
grep -Fq 'ensureHarnessSubagentsConfig' "$START" \
  || fail "start wrapper must call ensureHarnessSubagentsConfig before tools factory"
python3 - "$START" <<'PY'
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text()
ensure_at = text.find("await ensureHarnessSubagentsConfig")
tools_at = text.find("const toolsFactory = toolsTurnRunnerFactory(mod)")
if ensure_at < 0 or tools_at < 0:
    raise SystemExit("missing seed or tools factory call")
if ensure_at > tools_at:
    raise SystemExit("subagents seed must run before toolsTurnRunnerFactory")
print("seed-before-factory ok")
PY
grep -Fq 'ENV BACKEND_HOME=/var/lib/lanyard-agent' "$DOCKERFILE" \
  || fail "Dockerfile must set BACKEND_HOME=/var/lib/lanyard-agent"
grep -Fq 'COPY --from=platform --chown=node:node config.yaml' "$DOCKERFILE" \
  || fail "Dockerfile must COPY MockLab v1 config.yaml into BACKEND_HOME"
grep -Fq 'ensure-subagents-config.mjs' "$DOCKERFILE" \
  || fail "Dockerfile must COPY ensure-subagents-config.mjs next to the start wrapper"
grep -Fq '"BACKEND_HOME"' "$TD" \
  || fail "task-definition.example.json must name BACKEND_HOME"
grep -Eq 'subagents:|enabled: true' "$SEED_CONFIG" \
  || fail "image config.yaml must enable subagents"
node --test "$ENSURE_TEST" || fail "ensure-subagents-config.test.mjs failed"
pass "entrypoint is dist/harness/index.js (not package-root)"
pass "harness COPY agent-core + workspace packages + pnpm store"
pass "guest Dockerfile does not COPY agent-core / lanyard-agent tree"
grep -Eq 'Not a Daytona snapshot|not a Daytona snapshot' "$DOCKERFILE" || fail "Dockerfile must refuse guest bake"
grep -Eq 'Does NOT docker push|Does NOT terraform apply' "$BUILD" || fail "build script must refuse push/apply"
if grep -Eiq 'XAI_API_KEY|DAYTONA_API_KEY|GATEWAY_RELAY_SECRET' "$DOCKERFILE"; then
  fail "image must not inject provider / Daytona / relay secrets"
fi
if grep -Eq '"environment"' "$TD"; then
  python3 - "$TD" <<'PY' || fail "task environment[] must not hold provider/Daytona/relay plaintext"
import json, sys
from pathlib import Path
td = json.loads(Path(sys.argv[1]).read_text())
env = {r["name"] for r in td["containerDefinitions"][0].get("environment") or []}
bad = {"XAI_API_KEY", "DAYTONA_API_KEY", "GATEWAY_RELAY_SECRET"} & env
if bad:
    raise SystemExit(",".join(sorted(bad)))
print("no plaintext provider/daytona/relay env")
PY
fi
if grep -Eq 'lanyard-platform-staging-cp-task' "$TD"; then
  fail "example must not reuse the CP task role"
fi
for name in LITELLM_BASE_URL LITELLM_API_KEY LITELLM_MASTER_KEY HARNESS_MODEL LANYARD_DEFAULT_MODEL; do
  grep -Fq "\"$name\"" "$TD" || fail "task-definition.example.json must name $name"
done
grep -Fq 'https://REPLACE-litellm-base' "$TD" || fail "task-def LITELLM_BASE_URL must be a REPLACE placeholder"
pass "image recipe is LA runner on :8080, not guest"

# --- Start wrapper binds optional env runner factory (no secrets) ---
python3 - "$START" <<'PY'
import os, signal, subprocess, sys, tempfile, time
from pathlib import Path

start = Path(sys.argv[1])
tmp = Path(tempfile.mkdtemp(prefix="la-harness-smoke-"))

def write_mod(name, body):
    path = tmp / name
    path.write_text(body)
    return path

echo_mod = write_mod(
    "echo-mod.mjs",
    "export function createHarnessTurnServer(opts) {\n"
    "  if (opts.runner) throw new Error('echo path must not pass runner');\n"
    "  return { boundPort: 18080, async start() {}, async stop() {} };\n"
    "}\n",
)
lite_mod = write_mod(
    "lite-mod.mjs",
    "export function createEnvLiteLlmTurnRunner() {\n"
    "  return { run: async () => {} };\n"
    "}\n"
    "export function createHarnessTurnServer(opts) {\n"
    "  if (!opts.runner || typeof opts.runner.run !== 'function') {\n"
    "    throw new Error('expected runner');\n"
    "  }\n"
    "  return { boundPort: 18081, async start() {}, async stop() {} };\n"
    "}\n",
)
null_mod = write_mod(
    "null-mod.mjs",
    "export function createEnvLiteLlmTurnRunner() { return null; }\n"
    "export function createHarnessTurnServer(opts) {\n"
    "  if (opts.runner) throw new Error('null factory must not pass runner');\n"
    "  return { boundPort: 18082, async start() {}, async stop() {} };\n"
    "}\n",
)
tools_mod = write_mod(
    "tools-mod.mjs",
    "export function createEnvToolsTurnRunner() {\n"
    "  return { run: async () => {} };\n"
    "}\n"
    "export function createHarnessTurnServer(opts) {\n"
    "  if (!opts.runner || typeof opts.runner.run !== 'function') {\n"
    "    throw new Error('expected tools runner');\n"
    "  }\n"
    "  return { boundPort: 18083, async start() {}, async stop() {} };\n"
    "}\n",
)
agent_core_mod = write_mod(
    "agent-core-mod.mjs",
    "export function createAgentCoreTurnRunner() {\n"
    "  return { run: async () => {} };\n"
    "}\n"
    "export function createHarnessTurnServer(opts) {\n"
    "  if (!opts.runner || typeof opts.runner.run !== 'function') {\n"
    "    throw new Error('expected agent-core runner');\n"
    "  }\n"
    "  return { boundPort: 18084, async start() {}, async stop() {} };\n"
    "}\n",
)
regex_tools_mod = write_mod(
    "regex-tools-mod.mjs",
    "export function createFooToolsTurnRunner() {\n"
    "  return { run: async () => {} };\n"
    "}\n"
    "export function createHarnessTurnServer(opts) {\n"
    "  if (!opts.runner || typeof opts.runner.run !== 'function') {\n"
    "    throw new Error('expected regex tools runner');\n"
    "  }\n"
    "  return { boundPort: 18085, async start() {}, async stop() {} };\n"
    "}\n",
)
prefer_tools_mod = write_mod(
    "prefer-tools-mod.mjs",
    "export function createEnvToolsTurnRunner() {\n"
    "  return { run: async () => {} };\n"
    "}\n"
    "export function createEnvLiteLlmTurnRunner() {\n"
    "  throw new Error('litellm must not run when tools factory returns { run }');\n"
    "}\n"
    "export function createHarnessTurnServer(opts) {\n"
    "  if (!opts.runner || typeof opts.runner.run !== 'function') {\n"
    "    throw new Error('expected preferred tools runner');\n"
    "  }\n"
    "  return { boundPort: 18086, async start() {}, async stop() {} };\n"
    "}\n",
)
tools_null_lite_mod = write_mod(
    "tools-null-lite-mod.mjs",
    "export function createEnvToolsTurnRunner() { return null; }\n"
    "export function createEnvLiteLlmTurnRunner() {\n"
    "  return { run: async () => {} };\n"
    "}\n"
    "export function createHarnessTurnServer(opts) {\n"
    "  if (!opts.runner || typeof opts.runner.run !== 'function') {\n"
    "    throw new Error('expected litellm fallback');\n"
    "  }\n"
    "  return { boundPort: 18087, async start() {}, async stop() {} };\n"
    "}\n",
)
tools_throw_lite_mod = write_mod(
    "tools-throw-lite-mod.mjs",
    "export function createEnvToolsTurnRunner() { throw new Error('tools env missing'); }\n"
    "export function createEnvLiteLlmTurnRunner() {\n"
    "  return { run: async () => {} };\n"
    "}\n"
    "export function createHarnessTurnServer(opts) {\n"
    "  if (!opts.runner || typeof opts.runner.run !== 'function') {\n"
    "    throw new Error('expected litellm after tools throw');\n"
    "  }\n"
    "  return { boundPort: 18088, async start() {}, async stop() {} };\n"
    "}\n",
)
no_tools_mod = write_mod(
    "no-tools-mod.mjs",
    "export function createNoToolsTurnRunner() {\n"
    "  return { run: async () => {} };\n"
    "}\n"
    "export function createHarnessTurnServer(opts) {\n"
    "  if (opts.runner) throw new Error('no-tools factory must not bind as tools');\n"
    "  return { boundPort: 18089, async start() {}, async stop() {} };\n"
    "}\n",
)
tools_lab_mod = write_mod(
    "tools-lab-mod.mjs",
    "export function createEnvToolsTurnRunner() { return null; }\n"
    "export function createEnvLiteLlmTurnRunner() { return null; }\n"
    "export function createToolsTurnRunner(opts) {\n"
    "  if (!opts || typeof opts.complete !== 'function') throw new Error('lab complete required');\n"
    "  if (!opts.vaultSession) throw new Error('lab vaultSession required');\n"
    "  return { run: async () => {} };\n"
    "}\n"
    "export class FakeToolboxProcessSession {\n"
    "  constructor() {}\n"
    "}\n"
    "export function fakeVaultMcpJsonRpcHandler() { return () => ({}); }\n"
    "export function createHarnessTurnServer(opts) {\n"
    "  if (!opts.runner || typeof opts.runner.run !== 'function') {\n"
    "    throw new Error('expected tools-lab runner');\n"
    "  }\n"
    "  return { boundPort: 18090, async start() {}, async stop() {} };\n"
    "}\n",
)

def run_case(module, expect_runner, extra_env=None, home=None, expect_exit=None):
    env = os.environ.copy()
    env.pop("HARNESS_REQUIRE_SPAWN", None)
    env.pop("HARNESS_REQUIRE_MEMORY", None)
    seed_home = Path(home) if home else Path(tempfile.mkdtemp(prefix="harness-backend-"))
    env.update({
        "HARNESS_MODULE": str(module),
        "HARNESS_HOST": "127.0.0.1",
        "HARNESS_PORT": "0",
        "HARNESS_SERVICE_TOKEN": "dev-smoke-token",
        "BACKEND_HOME": str(seed_home),
    })
    if extra_env:
        env.update(extra_env)
    proc = subprocess.Popen(
        ["node", str(start)],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    time.sleep(0.4)
    if proc.poll() is None:
        proc.send_signal(signal.SIGTERM)
    try:
        out, err = proc.communicate(timeout=3)
    except subprocess.TimeoutExpired:
        proc.kill()
        out, err = proc.communicate(timeout=2)
    blob = (out or "") + (err or "")
    if "dev-smoke-token" in blob:
        raise SystemExit("start wrapper logged the service token")
    if "LITELLM_API_KEY" in blob or "HARNESS_SERVICE_TOKEN=" in blob:
        raise SystemExit("start wrapper logged a secret name assignment")
    if expect_exit is not None:
        if proc.returncode != expect_exit:
            raise SystemExit(f"expected exit {expect_exit}, got {proc.returncode}: {blob!r}")
        return blob, seed_home
    if f"runner={expect_runner}" not in blob:
        raise SystemExit(f"expected runner={expect_runner} in logs, got: {blob!r}")
    if expect_runner == "tools" and ("runner=echo" in blob or "runner=litellm" in blob):
        raise SystemExit(f"tools bind must not also log echo/litellm: {blob!r}")
    if "kind=createHarnessTurnServer" not in blob:
        raise SystemExit(f"missing kind=createHarnessTurnServer: {blob!r}")
    if proc.returncode not in (0, -signal.SIGTERM, 143):
        raise SystemExit(f"wrapper exit {proc.returncode}: {blob!r}")
    return blob, seed_home

run_case(echo_mod, "echo")
run_case(lite_mod, "litellm")
run_case(null_mod, "echo")
run_case(tools_mod, "tools")
run_case(agent_core_mod, "tools")
run_case(regex_tools_mod, "tools")
run_case(prefer_tools_mod, "tools")
run_case(tools_null_lite_mod, "litellm")
run_case(tools_throw_lite_mod, "litellm")
run_case(no_tools_mod, "echo")
run_case(tools_lab_mod, "tools-lab")

blob, home = run_case(tools_mod, "tools")
cfg = home / "config.yaml"
if not cfg.is_file():
    raise SystemExit("missing seeded config.yaml")
text = cfg.read_text()
if "subagents:" not in text or "enabled: true" not in text:
    raise SystemExit(f"seed missing subagents.enabled: {text!r}")
if "subagents=enabled" not in blob:
    raise SystemExit(f"missing subagents=enabled log: {blob!r}")
if "subagents_seed=mocklab-v1" not in blob:
    raise SystemExit(f"missing subagents_seed=mocklab-v1: {blob!r}")

off = Path(tempfile.mkdtemp(prefix="harness-backend-off-"))
(off / "config.yaml").write_text("subagents:\n  enabled: false\n")
blob, _home = run_case(tools_mod, "tools", home=off)
if "subagents=disabled" not in blob:
    raise SystemExit(f"must respect enabled:false: {blob!r}")
off_cfg = (off / "config.yaml").read_text()
if "subagents:\n  enabled: false" not in off_cfg:
    raise SystemExit("must not clobber enabled:false")
if "spawn_schemas=missing" not in blob:
    raise SystemExit(f"file/bash-only module must log spawn_schemas=missing: {blob!r}")

spawn_mod = write_mod(
    "spawn-mod.mjs",
    "export const SPAWN_SUBAGENT_TOOL_NAME = 'spawn_subagent';\n"
    "export function createEnvToolsTurnRunner(env, options) {\n"
    "  if (!options || !options.backendHome) {\n"
    "    throw new Error('expected backendHome');\n"
    "  }\n"
    "  if (String(env.BACKEND_HOME || '') !== String(options.backendHome)) {\n"
    "    throw new Error('backendHome must match env');\n"
    "  }\n"
    "  return { run: async () => {} };\n"
    "}\n"
    "export function createHarnessTurnServer(opts) {\n"
    "  if (!opts.runner || typeof opts.runner.run !== 'function') {\n"
    "    throw new Error('expected tools runner');\n"
    "  }\n"
    "  if (!opts.backendHome) throw new Error('server must receive backendHome');\n"
    "  return { boundPort: 18090, async start() {}, async stop() {} };\n"
    "}\n",
)
blob, home = run_case(spawn_mod, "tools")
if "spawn_schemas=present" not in blob:
    raise SystemExit(f"missing spawn_schemas=present: {blob!r}")
if "spawn_tool=spawn_subagent" not in blob:
    raise SystemExit(f"missing spawn_tool=spawn_subagent: {blob!r}")
if "spawn_schemas=missing" in blob:
    raise SystemExit(f"present schemas must not log missing: {blob!r}")
if "subagents=enabled" not in blob:
    raise SystemExit(f"spawn module still needs config seed: {blob!r}")
if f"BACKEND_HOME={home}" not in blob:
    raise SystemExit(f"missing BACKEND_HOME log: {blob!r}")

blob, _home = run_case(
    tools_mod,
    None,
    extra_env={"HARNESS_REQUIRE_SPAWN": "1"},
    expect_exit=1,
)
if "spawn_schemas=missing" not in blob:
    raise SystemExit(f"require-spawn must refuse file/bash-only: {blob!r}")

blob, _home = run_case(
    spawn_mod,
    None,
    extra_env={"HARNESS_REQUIRE_MEMORY": "1"},
    expect_exit=1,
)
if "memory_read=missing" not in blob:
    raise SystemExit(f"require-memory must refuse spawn-only: {blob!r}")

memory_mod = write_mod(
    "memory-mod.mjs",
    "export const SPAWN_SUBAGENT_TOOL_NAME = 'spawn_subagent';\n"
    "export const MEMORY_READ_TOOL_NAME = 'memory_read';\n"
    "export function createEnvToolsTurnRunner(env, options) {\n"
    "  if (!options || !options.backendHome) {\n"
    "    throw new Error('expected backendHome');\n"
    "  }\n"
    "  return { run: async () => {} };\n"
    "}\n"
    "export function createHarnessTurnServer(opts) {\n"
    "  if (!opts.runner || typeof opts.runner.run !== 'function') {\n"
    "    throw new Error('expected tools runner');\n"
    "  }\n"
    "  return { boundPort: 18091, async start() {}, async stop() {} };\n"
    "}\n",
)
blob, _home = run_case(
    memory_mod,
    "tools",
    extra_env={"HARNESS_REQUIRE_SPAWN": "1", "HARNESS_REQUIRE_MEMORY": "1"},
)
if "memory_read=present" not in blob:
    raise SystemExit(f"missing memory_read=present: {blob!r}")
if "spawn_schemas=present" not in blob:
    raise SystemExit(f"memory module must keep spawn_schemas=present: {blob!r}")
print("start wrapper factory bind + subagents seed ok")

home = tmp / "backend-home"
home.mkdir()
server = tmp / "lab_echo_server.py"
server.write_text("# fixture\n")
(home / "config.yaml").write_text("workflow:\n  enabled: true\n")
env = os.environ.copy()
env.update({
    "HARNESS_MODULE": str(echo_mod),
    "HARNESS_HOST": "127.0.0.1",
    "HARNESS_PORT": "0",
    "HARNESS_SERVICE_TOKEN": "dev-smoke-token",
    "BACKEND_HOME": str(home),
    "LANYARD_LAB_MCP_SERVER": str(server),
})
proc = subprocess.Popen(
    ["node", str(start)],
    env=env,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
)
time.sleep(0.4)
if proc.poll() is None:
    proc.send_signal(signal.SIGTERM)
try:
    out, err = proc.communicate(timeout=3)
except subprocess.TimeoutExpired:
    proc.kill()
    out, err = proc.communicate(timeout=2)
blob = (out or "") + (err or "")
cfg = (home / "config.yaml").read_text()
if "mcp=lab_echo" not in blob:
    raise SystemExit(f"expected mcp=lab_echo merge log, got: {blob!r}")
if "mcp=vault_fs" not in blob:
    raise SystemExit(f"expected mcp=vault_fs merge log, got: {blob!r}")
if "lab_echo:" not in cfg:
    raise SystemExit("BACKEND_HOME/config.yaml missing lab_echo after start")
if "vault_fs:" not in cfg:
    raise SystemExit("BACKEND_HOME/config.yaml missing vault_fs after start")
# lab_echo is harness-local stdio; vault path belongs on vault_fs only.
echo_only = cfg.split("lab_echo:", 1)[1]
if "vault_fs:" in echo_only:
    echo_only = echo_only.split("vault_fs:", 1)[0]
if "/mnt/vault" in echo_only:
    raise SystemExit("lab_echo merge must not touch /mnt/vault")
if "/mnt/vault" not in cfg or "requires_vault: true" not in cfg:
    raise SystemExit("vault_fs merge must bind cwd /mnt/vault")
print("start wrapper factory bind ok")
print("start wrapper lab_echo + vault_fs BACKEND_HOME merge ok")
PY
pass "start wrapper looks for env runner factory (tools|litellm|echo, no secrets)"

# --- Turn request fields stay on the contract ---
python3 - "$TURN" <<'PY'
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text()
for key in ("tenant_id", "user_id", "instance_id", "thread_id", "message"):
    if f'"{key}"' not in text:
        raise SystemExit(key)
if "sandbox_id?" not in text and 'sandbox_id?:' not in text:
    raise SystemExit("optional sandbox_id")
print("turn keys ok")
PY
pass "TurnRequest still has tenant_id/user_id/instance_id (+ optional sandbox_id)"

RESOLVE="$MONO/portal/packages/bff/src/chat-instance-resolve.ts"
CREATE_ENV="$MONO/portal/packages/control-plane/src/short-stack-create-env.ts"
require_file "$RESOLVE"
require_file "$CREATE_ENV"
grep -Fq 'sandbox_create_profile: "tool_only"' "$RESOLVE" \
  || fail "harness ensure-online-by-user must stay tool_only"
grep -Eq 'listShortStackDeniedCreateEnvKeys|SHORT_STACK_DENIED' "$CREATE_ENV" \
  || fail "short-stack-create-env denylist must remain"
grep -Fq 'isMcpSecretCreateEnvKey' "$CREATE_ENV" \
  || fail "create-env must deny MCP secrets"
pass "guest create env remains tool_only denylist"

# --- Guest snapshot not required ---
[[ -x "$GUEST_SMOKE" || -f "$GUEST_SMOKE" ]] || fail "guest smoke missing"
grep -Eq 'agent_core_required: false|no agent-core tree requirement' "$PIN" "$PLAN" \
  || fail "must say guest has no agent-core requirement"
grep -Eq 'lp-oop\.37\.4' "$README" "$TESTING" "$ISSUE_MAP" \
  || fail "README/testing/issue-map must list lp-oop.37.4"
pass "guest path + landing-zone links"

# No secret material
if grep -Eiq 'HARNESS_SERVICE_TOKEN=[A-Za-z0-9/+]{20,}|AKIA[0-9A-Z]{16}' \
  "$RUNBOOK" "$PLAN" "$PIN" "$RESULT" "$STATUS"; then
  fail "docs appear to contain secret material"
fi
if grep -Eiq 'arn:aws:secretsmanager:[a-z0-9-]+:[0-9]{12}:' "$RUNBOOK" "$PIN" "$TD"; then
  fail "docs must not embed a live account-id secret ARN"
fi
pass "no obvious secret material"

echo "smoke-mocklab-replace-echo-harness-la: PASS"
