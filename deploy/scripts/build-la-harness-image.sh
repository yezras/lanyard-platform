#!/usr/bin/env bash
# Local-only LA harness image (lp-oop.38.1).
#
# Builds lanyard/harness:la-<pin-sha> from LANYARD_AGENT_ROOT at the pin SHA.
# Does NOT docker push. Does NOT terraform apply. Does NOT ecs update-service.
# Does NOT print secret values. Does NOT bake agent-core onto Daytona.
#
# Usage:
#   bash deploy/scripts/build-la-harness-image.sh --check   # default: syntax + pin
#   LANYARD_AGENT_ROOT=/path/to/lanyard-agent \
#     bash deploy/scripts/build-la-harness-image.sh --build
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MONO="$(cd "$ROOT/.." && pwd)"
LAB="$ROOT/dev/mocklab-short-stack-harness"
PIN="$MONO/artifacts/mocklab/short-stack/la-harness.pins.yaml"
SUBAGENTS_DOC="$MONO/docs/plans/0015-short-stack/la-harness-subagents.md"
DOCKERFILE="$LAB/Dockerfile"
START="$LAB/start-la-harness.mjs"
MERGE_MCP="$LAB/merge-lab-echo-mcp.mjs"
MERGE_VAULT_FS="$LAB/merge-vault-fs-mcp.mjs"
VAULT_FS_SERVER="$ROOT/artifacts/mocklab-vault-seed/mcp/vault_fs_server.py"
# lp-oop.38.15: bake workflow bind (LA PR 259 / main 4a5a0fe) stacked on
# memory c41aca0 + spawn 2477b22.
SPAWN_SHA="2477b22ec4d33161a6ff122cef6b01fe268d98de"
SPAWN_SHA_SHORT="2477b22"
MEMORY_SHA="c41aca03268446ed13299572250ec7709e6eb342"
MEMORY_SHA_SHORT="c41aca0"
PIN_SHA="4a5a0fef17d8381d50175e280b9fd58d48437507"
PIN_SHA_SHORT="4a5a0fe"
IMAGE_TAG="lanyard/harness:la-${PIN_SHA_SHORT}"
PLATFORM="${PLATFORM:-linux/amd64}"

MODE="check"
for arg in "$@"; do
  case "$arg" in
    --check) MODE="check" ;;
    --build) MODE="build" ;;
    -h|--help)
      sed -n '2,16p' "$0"
      exit 0
      ;;
    *)
      echo "[build-la-harness-image] ERROR: unknown arg: $arg" >&2
      exit 2
      ;;
  esac
done

err() { echo "[build-la-harness-image] ERROR: $*" >&2; }
log() { echo "[build-la-harness-image] $*"; }
fail() { err "$*"; exit 1; }

[[ -f "$PIN" ]] || fail "missing pin $PIN"
[[ -f "$SUBAGENTS_DOC" ]] || fail "missing $SUBAGENTS_DOC"
[[ -f "$DOCKERFILE" ]] || fail "missing Dockerfile $DOCKERFILE"
[[ -f "$START" ]] || fail "missing start wrapper $START"
[[ -f "$MERGE_MCP" ]] || fail "missing lab_echo merge $MERGE_MCP"
[[ -f "$MERGE_VAULT_FS" ]] || fail "missing vault_fs merge $MERGE_VAULT_FS"
[[ -f "$VAULT_FS_SERVER" ]] || fail "missing vault stdio MCP $VAULT_FS_SERVER"
bash -n "$0" || fail "self bash -n"
grep -Fq "$MEMORY_SHA" "$PIN" || fail "pin yaml missing memory SHA $MEMORY_SHA"
grep -Fq "$SPAWN_SHA" "$PIN" || fail "pin yaml missing spawn SHA $SPAWN_SHA"
grep -Fq "$SPAWN_SHA" "$SUBAGENTS_DOC" || fail "subagents doc missing spawn SHA $SPAWN_SHA"
grep -Fq "$MEMORY_SHA_SHORT" "$START" || fail "start wrapper missing memory pin $MEMORY_SHA_SHORT"
grep -Fq "$SPAWN_SHA_SHORT" "$START" || fail "start wrapper missing spawn pin $SPAWN_SHA_SHORT"
grep -Fq "$PIN_SHA_SHORT" "$START" || fail "start wrapper missing workflow pin $PIN_SHA_SHORT"
grep -Fq 'HARNESS_REQUIRE_SPAWN' "$START" "$DOCKERFILE" \
  || fail "image must fail-boot when spawn schemas are missing"
grep -Fq 'HARNESS_REQUIRE_MEMORY' "$START" "$DOCKERFILE" \
  || fail "image must fail-boot when memory_read is missing"
grep -Fq 'COPY packages/agent-core/dist' "$DOCKERFILE" \
  || fail "Dockerfile must COPY agent-core onto the Fargate harness"
grep -Fq 'COPY packages/memory/dist' "$DOCKERFILE" \
  || fail "Dockerfile must COPY packages/memory (MemoryClient spawn, not a host CLI)"
grep -Fq 'COPY packages/workflow/dist' "$DOCKERFILE" \
  || fail "Dockerfile must COPY packages/workflow (runWorkflow on Fargate, not guest)"
if grep -Eiq 'usr/local/bin/mempalace|pip install.*mempalace|apt-get install.*mempalace' "$DOCKERFILE"; then
  fail "harness image must not bake the mempalace CLI (palace stays on the sandbox)"
fi
grep -Eqi 'Do NOT COPY this tree onto the Daytona|Daytona guest snapshot' "$DOCKERFILE" \
  || fail "Dockerfile must still forbid copying agent-core onto Daytona"
grep -Fq 'lab-mcp' "$DOCKERFILE" \
  || fail "Dockerfile must COPY lab_echo onto the Fargate harness (stdio MCP)"
grep -Fq 'merge-lab-echo-mcp.mjs' "$DOCKERFILE" \
  || fail "Dockerfile must COPY merge-lab-echo-mcp.mjs onto the Fargate harness"
grep -Fq 'merge-vault-fs-mcp.mjs' "$DOCKERFILE" \
  || fail "Dockerfile must COPY vault_fs merge onto the Fargate harness"
grep -Fq 'BACKEND_HOME=/var/lib/lanyard-backend' "$DOCKERFILE" \
  || fail "Dockerfile must default BACKEND_HOME so lab_echo/vault_fs can merge into config.yaml"
grep -Fq 'ensureLabEchoMcpConfig' "$START" \
  || fail "start wrapper must merge lab_echo into BACKEND_HOME/config.yaml"
grep -Fq 'ensureVaultFsMcpConfig' "$START" \
  || fail "start wrapper must merge vault_fs into BACKEND_HOME/config.yaml"
python3 - "$START" <<'PY' || fail "start wrapper must merge lab_echo and vault_fs before tools factory"
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text()
lab = text.find("ensureLabEchoMcpConfig")
vault = text.find("ensureVaultFsMcpConfig")
factory = text.find("toolsTurnRunnerFactory(mod)")
if lab < 0 or vault < 0 or factory < 0:
    raise SystemExit(f"missing merge/factory (lab={lab} vault={vault} factory={factory})")
if lab > factory or vault > factory:
    raise SystemExit(f"MCP merge must run before toolsTurnRunnerFactory (lab={lab} vault={vault} factory={factory})")
PY
LABMCP="$ROOT/daytona/agent-gateway/lab-mcp"
FRAGMENT="$ROOT/daytona/agent-gateway/kitchen-sink-mcp.fragment.yaml"
[[ -f "$LABMCP/lab_echo_server.py" ]] || fail "missing $LABMCP/lab_echo_server.py"
[[ -f "$FRAGMENT" ]] || fail "missing $FRAGMENT"
node --check "$MERGE_MCP" || fail "merge-lab-echo-mcp.mjs failed node --check"
node --check "$MERGE_VAULT_FS" || fail "merge-vault-fs-mcp.mjs failed node --check"
node "$MERGE_MCP" --assert-fragment "$FRAGMENT" \
  || fail "kitchen-sink MCP fragment must match harness lab_echo block"
VAULT_SEED="$ROOT/artifacts/mocklab-vault-seed"
[[ -f "$VAULT_SEED/config.yaml" ]] || fail "missing kitchen-sink $VAULT_SEED/config.yaml"
[[ -d "$VAULT_SEED/skills" ]] || fail "missing $VAULT_SEED/skills"
[[ -d "$VAULT_SEED/workflows" ]] || fail "missing $VAULT_SEED/workflows"
grep -Fq 'ENV BACKEND_HOME=/var/lib/lanyard-backend' "$DOCKERFILE" \
  || fail "Dockerfile must set BACKEND_HOME to kitchen-sink home"
grep -Fq 'COPY --from=vaultseed' "$DOCKERFILE" \
  || fail "Dockerfile must COPY kitchen-sink vault seed into BACKEND_HOME"

if grep -Eiq 'docker push|ecs update-service|terraform apply' "$0"; then
  grep -Eq 'Does NOT docker push|Does NOT terraform apply|Does NOT ecs update-service' "$0" \
    || fail "script mentions apply/push without a do-not"
fi

log "pin SHA=$PIN_SHA short=$PIN_SHA_SHORT image=$IMAGE_TAG mode=$MODE"
log "stacked on spawn $SPAWN_SHA_SHORT (LA PR 253). HARNESS_REQUIRE_SPAWN=1 refuses file/bash-only dist."

if [[ "$MODE" == "check" ]]; then
  log "check-only (no docker build, no push)"
  exit 0
fi

AGENT_ROOT="${LANYARD_AGENT_ROOT:-}"
[[ -n "$AGENT_ROOT" ]] || fail "set LANYARD_AGENT_ROOT to a lanyard-agent checkout"
[[ -d "$AGENT_ROOT" ]] || fail "LANYARD_AGENT_ROOT is not a directory: $AGENT_ROOT"

if [[ -d "$AGENT_ROOT/.git" ]] || [[ -f "$AGENT_ROOT/.git" ]]; then
  got="$(git -C "$AGENT_ROOT" rev-parse HEAD)"
  if [[ "$got" != "$PIN_SHA" && "$got" != "$PIN_SHA_SHORT"* ]]; then
    fail "LANYARD_AGENT_ROOT HEAD $got != pin $PIN_SHA (checkout PR 252 SHA $PIN_SHA_SHORT stacked on $SPAWN_SHA_SHORT)"
  fi
fi

DIST="$AGENT_ROOT/packages/adapters-portal/dist/harness/index.js"
[[ -f "$DIST" ]] || fail "build @lanyard-agent/adapters-portal first (missing $DIST)"
if ! grep -Eq 'SPAWN_SUBAGENT_TOOL_NAME|spawn_subagent' "$DIST"; then
  fail "LA dist missing spawn_subagent (need PR 252 SHA $PIN_SHA_SHORT stacked on $SPAWN_SHA_SHORT, not file/bash-only ad0ef5a)"
fi
if ! grep -Eq 'MEMORY_READ_TOOL_NAME|memory_read' "$DIST"; then
  fail "LA dist missing memory_read (need PR 252 SHA $PIN_SHA_SHORT; live $SPAWN_SHA_SHORT is spawn-only)"
fi
if ! grep -Eq 'HARNESS_WORKFLOW_TOOL|workflow.enabled' "$DIST"; then
  fail "LA dist missing workflow bind (need PR 259 SHA $PIN_SHA_SHORT)"
fi
PROVIDERS_DIST="$AGENT_ROOT/packages/providers/dist/index.js"
[[ -f "$PROVIDERS_DIST" ]] || fail "build @lanyard-agent/providers first (missing $PROVIDERS_DIST)"
AGENT_CORE_DIST="$AGENT_ROOT/packages/agent-core/dist/index.js"
[[ -f "$AGENT_CORE_DIST" ]] || fail "build @lanyard-agent/agent-core first (missing $AGENT_CORE_DIST)"

# Stage a context. LA .dockerignore excludes dist + node_modules; this recipe
# needs both. Do not npm install on boot — copy the operator production store.
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/la-harness-ctx.XXXXXX")"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

copy_tree() {
  local src="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  if cp -al "$src" "$dest" 2>/dev/null; then
    return 0
  fi
  cp -a "$src" "$dest"
}

for pkg in adapters-portal agent-core config logging memory providers session workflow; do
  [[ -f "$AGENT_ROOT/packages/$pkg/package.json" ]] || fail "missing packages/$pkg/package.json"
  [[ -d "$AGENT_ROOT/packages/$pkg/dist" ]] || fail "missing packages/$pkg/dist (build at pin SHA)"
  mkdir -p "$STAGE/packages/$pkg"
  cp "$AGENT_ROOT/packages/$pkg/package.json" "$STAGE/packages/$pkg/package.json"
  copy_tree "$AGENT_ROOT/packages/$pkg/dist" "$STAGE/packages/$pkg/dist"
done
[[ -d "$AGENT_ROOT/packages/adapters-portal/fixtures" ]] \
  || fail "missing packages/adapters-portal/fixtures"
copy_tree "$AGENT_ROOT/packages/adapters-portal/fixtures" \
  "$STAGE/packages/adapters-portal/fixtures"

[[ -d "$AGENT_ROOT/node_modules/.pnpm" ]] \
  || fail "missing production node_modules/.pnpm (pnpm install in LANYARD_AGENT_ROOT; do not npm install on boot)"
mkdir -p "$STAGE/node_modules"
copy_tree "$AGENT_ROOT/node_modules/.pnpm" "$STAGE/node_modules/.pnpm"
for pkg in agent-core config session adapters-portal; do
  [[ -d "$AGENT_ROOT/packages/$pkg/node_modules" ]] \
    || fail "missing packages/$pkg/node_modules (pnpm install in LANYARD_AGENT_ROOT)"
  copy_tree "$AGENT_ROOT/packages/$pkg/node_modules" "$STAGE/packages/$pkg/node_modules"
done

command -v docker >/dev/null 2>&1 || fail "docker not on PATH (check-only does not need it)"

log "docker build platform=$PLATFORM (no push; staged context, no Daytona COPY)"

DOCKER_BUILDKIT=1 docker build \
  --platform "$PLATFORM" \
  -f "$DOCKERFILE" \
  --build-context "platform=$LAB" \
  --build-context "labmcp=$LABMCP" \
  --build-context "vaultseed=$VAULT_SEED" \
  -t "$IMAGE_TAG" \
  "$STAGE"

log "built $IMAGE_TAG"
log "not pushed. not registered. operator must roll la-${PIN_SHA_SHORT} for spawn_subagent"
