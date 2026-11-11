#!/usr/bin/env bash
# Offline proof: MockLab kitchen-sink config.yaml + trees as harness
# BACKEND_HOME (lp-oop.38.18). Snapshot-shaped inventory is not empty.
# Guest tool-only image still has no lanyard-agent tree.
#
# No AWS. No docker pull. No live GET (OPERATOR HOLD).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MONO="$(cd "$ROOT/.." && pwd)"
SRC="$ROOT/artifacts/mocklab-vault-seed"
CHECK="$ROOT/scripts/check-mocklab-kitchen-sink-config.py"
MATERIALIZE="$ROOT/scripts/materialize-mocklab-harness-backend-home.sh"
GUEST_SMOKE="$ROOT/daytona/agent-gateway/smoke-no-lanyard-agent-tree.sh"
DOCKERFILE="$ROOT/dev/mocklab-short-stack-harness/Dockerfile"
START="$ROOT/dev/mocklab-short-stack-harness/start-la-harness.mjs"
TD="$ROOT/dev/mocklab-short-stack-harness/task-definition.example.json"
COMPOSE="$ROOT/dev/mocklab-short-stack-harness/docker-compose.yml"
PACK="$MONO/portal/packages/control-plane/src/vault-seed.ts"
OVERLAY="$MONO/portal/packages/bff/src/vault-harness-inventory.ts"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

[ -f "$SRC/config.yaml" ] || fail "missing $SRC/config.yaml"
[ -f "$CHECK" ] || fail "missing $CHECK"
[ -f "$MATERIALIZE" ] || fail "missing $MATERIALIZE"
[ -f "$GUEST_SMOKE" ] || fail "missing guest smoke"
[ -f "$PACK" ] || fail "missing vault-seed.ts"

python3 "$CHECK" --config "$SRC/config.yaml" --home "$SRC" \
  || fail "seed pack kitchen-sink inventory failed"
pass "vault seed pack is a non-empty harness snapshot document"

grep -Fq 'MOCKLAB_KITCHEN_SINK_CONFIG_YAML' "$PACK" \
  || fail "CP pack missing MOCKLAB_KITCHEN_SINK_CONFIG_YAML"
grep -Fq 'subagents:' "$PACK" || fail "CP pack missing subagents"
grep -Fq 'mempalace:' "$PACK" || fail "CP pack missing mempalace"
grep -Fq 'relativePath: "config.yaml"' "$PACK" \
  || fail "CP pack missing config.yaml object"
grep -Fq 'Fill missing kitchen-sink' "$PACK" \
  || fail "CP seed must fill missing kitchen-sink files when AGENTS.md exists"
pass "CP mockLabVaultSeedPack includes kitchen-sink config.yaml"
[ -f "$OVERLAY" ] || fail "missing BFF vault harness inventory overlay"
grep -Fq 'overlayVaultInventoryOnSnapshot' "$OVERLAY" \
  || fail "BFF overlay missing overlayVaultInventoryOnSnapshot"
pass "BFF projects vault skills/workflows onto harness snapshot"

grep -Fq 'ENV BACKEND_HOME=/var/lib/lanyard-backend' "$DOCKERFILE" \
  || fail "Dockerfile missing BACKEND_HOME"
grep -Fq 'COPY --from=vaultseed' "$DOCKERFILE" \
  || fail "Dockerfile missing vault seed COPY"
grep -Eqi 'Do NOT COPY this tree onto the Daytona|Daytona guest snapshot' "$DOCKERFILE" \
  || fail "Dockerfile must still forbid copying agent-core onto Daytona"
grep -Fq 'BACKEND_HOME' "$START" || fail "start wrapper must pass BACKEND_HOME"
grep -Fq 'createEnvHarnessSettingsLoader' "$START" \
  || fail "start wrapper must bind settings loader"
grep -Fq 'BACKEND_HOME: backendHome' "$START" \
  || fail "start wrapper must bind resolved BACKEND_HOME into the settings loader (loader wins over options.backendHome)"
grep -Fq '"BACKEND_HOME"' "$TD" || fail "task-definition.example.json missing BACKEND_HOME"
grep -Fq 'BACKEND_HOME' "$COMPOSE" || fail "compose missing BACKEND_HOME"
pass "harness image/lab point BACKEND_HOME at kitchen-sink home"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/harness-backend-home.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT
HOME_DIR="$TMP/backend-home"
bash "$MATERIALIZE" --dest "$HOME_DIR" || fail "materialize failed"
python3 "$CHECK" --home "$HOME_DIR" --json >"$TMP/snapshot.json" \
  || fail "materialized home failed kitchen-sink check"
python3 - "$TMP/snapshot.json" <<'PY' || fail "snapshot JSON empty"
import json, sys
doc = json.load(open(sys.argv[1]))
assert doc.get("source") == "harness", doc
assert doc.get("skills"), doc
assert doc.get("workflows"), doc
assert doc.get("models"), doc
assert doc["flags"]["subagents.enabled"] is True
assert doc["flags"]["mempalace.enabled"] is True
assert doc["flags"]["workflow.enabled"] is True
print("snapshot source=harness skills", len(doc["skills"]), "workflows", len(doc["workflows"]))
PY
pass "materialized BACKEND_HOME snapshot is not an empty fixture"

# Guest still has no lanyard-agent tree (tool-only).
bash "$GUEST_SMOKE" || fail "guest smoke-no-lanyard-agent-tree failed"
pass "guest still has no lanyard-agent tree"

echo "OK: smoke-mocklab-harness-backend-home"
