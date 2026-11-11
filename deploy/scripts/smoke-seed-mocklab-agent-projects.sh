#!/usr/bin/env bash
# Offline smoke for MockLab agent projects.db seed (lp-zuh.10.7).
# No AWS, no network, no secrets.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SEED_SH="${ROOT}/deploy/scripts/seed-mocklab-agent-projects.sh"
SEED_PY="${ROOT}/deploy/daytona/agent-gateway/seed-default-projects.py"
PACK_JSON="${ROOT}/deploy/artifacts/mocklab-vault-seed/.seed/default-projects.json"

pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

[[ -f "$SEED_SH" ]] || fail "missing $SEED_SH"
[[ -f "$SEED_PY" ]] || fail "missing $SEED_PY"
[[ -f "$PACK_JSON" ]] || fail "missing default-projects.json pack"
command -v python3 >/dev/null 2>&1 || fail "python3 required"
bash -n "$SEED_SH" || fail "bash -n seed-mocklab-agent-projects.sh"
python3 -m py_compile "$SEED_PY" || fail "py_compile seed-default-projects.py"
pass "syntax OK (shell + python)"

# default-projects.json contract
python3 - "$PACK_JSON" <<'PY' || fail "default-projects.json invalid"
import json, sys
p = json.load(open(sys.argv[1]))
projs = p.get("projects") or []
assert projs, "empty projects"
pp = projs[0].get("primary_path") or ""
assert pp.startswith("/mnt/vault/"), f"primary_path not under /mnt/vault: {pp}"
assert projs[0].get("slug") == "workspace" or "Workspace" in (projs[0].get("name") or "")
print("pack primary_path OK:", pp)
PY
pass "pack default-projects.json primary_path under /mnt/vault"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/smoke-mocklab-projects.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

VAULT="$TMP/vault"
HOME_RT="$TMP/backend-home"
PRIMARY="$VAULT/Projects/Workspace"
mkdir -p "$PRIMARY" "$VAULT/.seed" "$HOME_RT"
# Local JSON with tmp vault paths so smoke never touches real /mnt/vault
python3 - "$PACK_JSON" "$VAULT/.seed/default-projects.json" "$PRIMARY" <<'PY'
import json, sys
src, dst, primary = sys.argv[1], sys.argv[2], sys.argv[3]
doc = json.load(open(src))
for p in doc.get("projects") or []:
    p["primary_path"] = primary
    folders = p.get("folders") or []
    if folders and isinstance(folders[0], dict):
        folders[0]["path"] = primary
    p["folders"] = folders or [{"path": primary, "label": None, "is_primary": True}]
json.dump(doc, open(dst, "w"), indent=2)
print("wrote local default-projects →", primary)
PY
echo "welcome" >"$PRIMARY/welcome.md"

# --- create seed ---
BACKEND_HOME="$HOME_RT" VAULT_ROOT="$VAULT" \
  bash "$SEED_SH" --from-json "$VAULT/.seed/default-projects.json" \
  >"$TMP/out1.json" 2>"$TMP/err1.txt" || {
  cat "$TMP/err1.txt" >&2
  fail "seed create failed"
}
python3 - "$TMP/out1.json" "$PRIMARY" <<'PY' || fail "seed create output invalid"
import json, sys
d = json.load(open(sys.argv[1]))
want = sys.argv[2]
assert d.get("result") == "ok", d
projs = d.get("projects") or []
assert len(projs) >= 1, d
pp = projs[0].get("primary_path") or ""
assert pp == want, (pp, want)
assert "Projects/Workspace" in pp, pp
assert (d.get("actions") or {}).get("workspace") in ("created", "ok", "updated"), d
print("create:", projs[0])
PY
[[ -f "$HOME_RT/projects.db" ]] || fail "projects.db not created"
[[ -d "$PRIMARY" ]] || fail "primary dir missing"
pass "created Workspace in projects.db"

# --- idempotent re-run ---
BACKEND_HOME="$HOME_RT" VAULT_ROOT="$VAULT" \
  bash "$SEED_SH" --from-json "$VAULT/.seed/default-projects.json" \
  >"$TMP/out2.json" 2>"$TMP/err2.txt" || {
  cat "$TMP/err2.txt" >&2
  fail "idempotent re-run failed"
}
python3 - "$TMP/out2.json" <<'PY' || fail "idempotent re-run invalid"
import json, sys
d = json.load(open(sys.argv[1]))
assert d.get("result") == "ok", d
assert (d.get("actions") or {}).get("workspace") == "ok", d
assert len(d.get("projects") or []) >= 1
print("idempotent ok")
PY
pass "idempotent re-run (ok)"

# --- update wrong primary_path ---
python3 - "$HOME_RT" <<'PY' || fail "could not plant wrong path"
import sqlite3, sys
home = sys.argv[1]
db = f"{home}/projects.db"
wrong = f"{home}/workspace"
c = sqlite3.connect(db)
c.execute("UPDATE projects SET primary_path = ? WHERE slug = ?", (wrong, "workspace"))
c.execute("DELETE FROM project_folders")
c.execute(
  "INSERT INTO project_folders (project_id, path, label, is_primary, added_at) "
  "SELECT id, ?, NULL, 1, 0 FROM projects WHERE slug = 'workspace'",
  (wrong,),
)
c.commit()
c.close()
print("planted wrong path", wrong)
PY

BACKEND_HOME="$HOME_RT" VAULT_ROOT="$VAULT" \
  bash "$SEED_SH" --from-json "$VAULT/.seed/default-projects.json" \
  >"$TMP/out3.json" 2>"$TMP/err3.txt" || {
  cat "$TMP/err3.txt" >&2
  fail "update wrong path failed"
}
python3 - "$TMP/out3.json" "$PRIMARY" <<'PY' || fail "update wrong path invalid"
import json, sys
d = json.load(open(sys.argv[1]))
want = sys.argv[2]
assert d.get("result") == "ok", d
assert (d.get("actions") or {}).get("workspace") == "updated", d
pp = (d.get("projects") or [{}])[0].get("primary_path") or ""
assert pp == want, (pp, want)
print("updated primary_path:", pp)
PY
pass "repairs wrong primary_path to vault Workspace"

# --- list-only ---
BACKEND_HOME="$HOME_RT" bash "$SEED_SH" --list-only \
  >"$TMP/list.json" 2>"$TMP/err_list.txt" || {
  cat "$TMP/err_list.txt" >&2
  fail "list-only failed"
}
python3 - "$TMP/list.json" <<'PY' || fail "list-only invalid"
import json, sys
d = json.load(open(sys.argv[1]))
assert len(d.get("projects") or []) >= 1
assert d["projects"][0].get("slug") == "workspace"
print("list-only:", d["projects"][0]["primary_path"])
PY
pass "list-only"

# --- dry-run on empty home ---
HOME2="$TMP/backend-home-2"
mkdir -p "$HOME2"
BACKEND_HOME="$HOME2" VAULT_ROOT="$VAULT" \
  bash "$SEED_SH" --dry-run --from-json "$VAULT/.seed/default-projects.json" \
  >"$TMP/dry.json" 2>"$TMP/err_dry.txt" || {
  cat "$TMP/err_dry.txt" >&2
  fail "dry-run failed"
}
[[ ! -f "$HOME2/projects.db" ]] || fail "dry-run must not create projects.db"
pass "dry-run does not write"

# --- entrypoint references ensure_default_projects ---
ENTRY="${ROOT}/deploy/daytona/agent-gateway/entrypoint.sh"
grep -q 'ensure_default_projects' "$ENTRY" \
  || fail "entrypoint missing ensure_default_projects"
grep -q 'seed-default-projects.py' "$ENTRY" \
  || fail "entrypoint does not invoke seed-default-projects.py"
pass "entrypoint wires ensure_default_projects"

# --- Dockerfile copies seed script ---
DF="${ROOT}/deploy/daytona/agent-gateway/Dockerfile"
grep -q 'seed-default-projects.py' "$DF" \
  || fail "Dockerfile must COPY seed-default-projects.py"
pass "Dockerfile copies seed-default-projects.py"

echo
echo "All smoke-seed-mocklab-agent-projects checks passed."
