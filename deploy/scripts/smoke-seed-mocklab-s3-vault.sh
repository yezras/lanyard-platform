#!/usr/bin/env bash
# Offline smoke for scripts/seed-mocklab-s3-vault.sh (tmpdir only; no AWS).
#
# Usage (from deploy/):
#   bash scripts/smoke-seed-mocklab-s3-vault.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEED="$ROOT/scripts/seed-mocklab-s3-vault.sh"
SRC="$ROOT/artifacts/mocklab-vault-seed"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

[ -f "$SEED" ] || fail "missing $SEED"
[ -f "$SRC/AGENTS.md" ] || fail "missing seed AGENTS.md"
[ -f "$SRC/Projects/Workspace/welcome.md" ] || fail "missing welcome.md"
[ -f "$SRC/skills/mocklab-research/SKILL.md" ] || fail "missing mocklab-research skill"
[ -f "$SRC/.seed/default-projects.json" ] || fail "missing default-projects.json"
[ -f "$SRC/config.yaml" ] || fail "missing kitchen-sink config.yaml"
[ -f "$SRC/workflows/research-lite.yaml" ] || fail "missing research-lite workflow"

bash -n "$SEED" || fail "bash -n seed-mocklab-s3-vault.sh"
pass "bash -n seed script"

# default-projects primary_path contract
python3 - <<'PY' "$SRC/.seed/default-projects.json" || fail "default-projects.json invalid"
import json, sys
doc = json.load(open(sys.argv[1]))
projs = doc.get("projects") or []
assert projs, "no projects"
pp = projs[0].get("primary_path") or ""
assert pp.startswith("/mnt/vault/"), pp
assert "Workspace" in pp, pp
print("default primary_path OK:", pp)
PY
pass "default-projects.json primary_path under /mnt/vault"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/mocklab-vault-seed-smoke.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

VAULT="$TMP/vault"
mkdir -p "$VAULT"

# employee-vault refusal
if bash "$SEED" --local-vault "$TMP/Lanyard" >/dev/null 2>&1; then
  fail "expected refuse on path ending in /Lanyard"
fi
if bash "$SEED" --local-vault "$TMP/employee-vault" >/dev/null 2>&1; then
  fail "expected refuse on employee-vault path"
fi
pass "refuses employee-vault-like local paths"

# dry-run does not write
EMPTY="$TMP/empty"
mkdir -p "$EMPTY"
bash "$SEED" --local-vault "$EMPTY" --dry-run >/dev/null
if [ -f "$EMPTY/AGENTS.md" ]; then
  fail "dry-run must not write AGENTS.md"
fi
pass "dry-run writes no content"

# first seed
bash "$SEED" --local-vault "$VAULT" >/dev/null
[ -f "$VAULT/AGENTS.md" ] || fail "AGENTS.md missing after seed"
[ -f "$VAULT/Projects/Workspace/welcome.md" ] || fail "welcome.md missing"
[ -f "$VAULT/skills/mocklab-research/SKILL.md" ] || fail "skill missing"
[ -f "$VAULT/skills/note-taking/obsidian/SKILL.md" ] || fail "obsidian skill missing"
[ -f "$VAULT/workflows/README.md" ] || fail "workflows README missing"
[ -f "$VAULT/mcp/vault_fs_server.py" ] || fail "vault_fs MCP missing"
[ -f "$VAULT/workflows/research-lite.yaml" ] || fail "research-lite workflow missing"
[ -f "$VAULT/config.yaml" ] || fail "kitchen-sink config.yaml missing"
[ -f "$VAULT/.seed/provenance.json" ] || fail "provenance missing"
[ -f "$VAULT/.seed/default-projects.json" ] || fail "default-projects missing"
grep -Fq 'mocklab-vault-seed:lp-zuh.9.5' "$VAULT/AGENTS.md" || fail "marker missing in AGENTS.md"
grep -Fq 'seeded read target' "$VAULT/Projects/Workspace/welcome.md" || fail "welcome body missing"
python3 "$ROOT/scripts/check-mocklab-kitchen-sink-config.py" --home "$VAULT" \
  || fail "kitchen-sink config/inventory check failed"
pass "MVP MockLab tree seeded under tmp vault"

# tree non-empty (vault.tree proxy)
count="$(find "$VAULT" -type f | wc -l | tr -d ' ')"
[ "$count" -ge 8 ] || fail "expected >=8 files, got $count"
pass "vault tree non-empty ($count files)"

# idempotent: AGENTS.md gate skips
echo "operator-extra" >"$VAULT/Projects/Workspace/notes/custom.md"
printf 'live edit\n' >"$VAULT/Projects/Workspace/welcome.md"
bash "$SEED" --local-vault "$VAULT" >/dev/null
grep -Fq 'live edit' "$VAULT/Projects/Workspace/welcome.md" || fail "skip should preserve live welcome.md"
[ -f "$VAULT/Projects/Workspace/notes/custom.md" ] || fail "custom file should remain"
pass "idempotent: AGENTS.md gate preserves live vault"

# fill-missing vault stdio MCP even when AGENTS.md skip would omit it
rm -f "$VAULT/mcp/vault_fs_server.py"
bash "$SEED" --local-vault "$VAULT" >/dev/null
[ -f "$VAULT/mcp/vault_fs_server.py" ] || fail "AGENTS.md skip must still fill-missing vault_fs MCP"
grep -Fq 'live edit' "$VAULT/Projects/Workspace/welcome.md" || fail "fill-missing must not overwrite live welcome.md"
if grep -Eiq 'MCP_API_KEY|sk-|Bearer ' "$VAULT/mcp/vault_fs_server.py"; then
  fail "vault_fs_server.py must not contain secret material"
fi
pass "fill-missing restores vault_fs MCP without rewriting live vault"

# offline JSON-RPC probe (no network)
python3 - <<'PY' "$VAULT" "$SRC/mcp/vault_fs_server.py" || fail "vault_fs JSON-RPC probe failed"
import json, os, subprocess, sys
vault, server = sys.argv[1], sys.argv[2]
payload = "\n".join([
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke"}}}',
    '{"jsonrpc":"2.0","method":"notifications/initialized"}',
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}',
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_vault","arguments":{}}}',
    "",
])
env = os.environ.copy()
env["VAULT_ROOT"] = vault
proc = subprocess.run(["python3", server], input=payload, text=True, capture_output=True, env=env, timeout=10)
assert proc.returncode == 0, proc.stderr
msgs = [json.loads(line) for line in proc.stdout.splitlines() if line.startswith("{")]
init = next(m for m in msgs if m.get("id") == 1)
assert init["result"]["serverInfo"]["name"] == "vault_fs"
listed = next(m for m in msgs if m.get("id") == 2)
assert listed["result"]["tools"][0]["name"] == "list_vault"
called = next(m for m in msgs if m.get("id") == 3)
text = called["result"]["content"][0]["text"]
assert "welcome.md" in text, text
assert ".env" not in text
print("vault_fs probe OK")
PY
pass "vault_fs stdio JSON-RPC probe lists /mnt/vault paths"

# fill-missing: AGENTS.md present still installs new kitchen-sink files
rm -f "$VAULT/config.yaml"
bash "$SEED" --local-vault "$VAULT" >/dev/null
[ -f "$VAULT/config.yaml" ] || fail "fill-missing should restore config.yaml"
grep -Fq 'live edit' "$VAULT/Projects/Workspace/welcome.md" || fail "fill-missing must preserve live welcome.md"
python3 "$ROOT/scripts/check-mocklab-kitchen-sink-config.py" --home "$VAULT" \
  || fail "fill-missing kitchen-sink check failed"
pass "fill-missing installs kitchen-sink config.yaml without wiping live files"

# force re-seeds managed files without deleting extras
bash "$SEED" --local-vault "$VAULT" --force >/dev/null
grep -Fq 'seeded read target' "$VAULT/Projects/Workspace/welcome.md" || fail "force should restore welcome.md"
[ -f "$VAULT/Projects/Workspace/notes/custom.md" ] || fail "force must not delete custom files"
pass "force restores seed files; keeps custom siblings"

# refuse bad bucket names (parse only via dry-run path needing aws — use local-only OK)
# S3 URI shape validation without network: dry-run still needs aws for s3 path after gate check.
# Validate refusal by invoking parse path with fake aws missing — skip if no network interest.
if command -v aws >/dev/null 2>&1; then
  if bash "$SEED" --s3-uri "s3://evil-bucket/tenants/x/vault/" --dry-run >/dev/null 2>&1; then
    fail "expected refuse unexpected bucket"
  fi
  pass "refuses unexpected S3 bucket names"
else
  pass "skip S3 bucket name check (no aws CLI)"
fi

echo "OK: smoke-seed-mocklab-s3-vault"
