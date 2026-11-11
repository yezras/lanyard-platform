#!/usr/bin/env bash
# Smoke for agent-gateway entrypoint (lp-b7w) + image contract (lp-e9l).
# Also runs lp-oop.22 no-lanyard-agent-tree fixture proof.
# No Docker, no network, no AWS, no Daytona, no ECR.
#
# Usage (from monorepo root or this directory):
#   bash deploy/daytona/agent-gateway/smoke-entrypoint.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTRY="${ROOT}/entrypoint.sh"
FAKE="${ROOT}/fake-gateway.sh"
DOCKERFILE="${ROOT}/Dockerfile"
INSTALL_RT="${ROOT}/install-agent-runtime.sh"
README="${ROOT}/README.md"

FAILED=0
pass() { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1"; FAILED=$((FAILED + 1)); }

echo "==> agent-gateway entrypoint smoke (lp-b7w) + image contract (lp-e9l / lp-zuh.9.3 / lp-zuh.10.2 / lp-vqr0.12)"
echo "    dir: ${ROOT}"
echo

# --- static files present ----------------------------------------------------
[[ -f "${DOCKERFILE}" ]] && pass "Dockerfile present" || fail "Dockerfile missing"
[[ -f "${ENTRY}" ]] && pass "entrypoint.sh present" || fail "entrypoint.sh missing"
[[ -f "${INSTALL_RT}" ]] && pass "install-agent-runtime.sh present" || fail "install-agent-runtime.sh missing"
[[ -f "${ROOT}/install-mount-s3.sh" ]] && pass "install-mount-s3.sh present" || fail "install-mount-s3.sh missing"
[[ -f "${ROOT}/install-mempalace.sh" ]] && pass "install-mempalace.sh present" || fail "install-mempalace.sh missing"
[[ -f "${ROOT}/build-local.sh" ]] && pass "build-local.sh present" || fail "build-local.sh missing"
[[ -f "${README}" ]] && pass "README present" || fail "README missing"
chmod +x "${ENTRY}" "${FAKE}" "${INSTALL_RT}" \
  "${ROOT}/install-mount-s3.sh" "${ROOT}/install-mempalace.sh" \
  "${ROOT}/build-local.sh" 2>/dev/null || true

# --- no package-install in entrypoint (lp-b7w AC) ----------------------------
entry_code="$(grep -vE '^[[:space:]]*(#|$)' "${ENTRY}" || true)"
if echo "${entry_code}" | grep -Eiq \
  'apt-get[[:space:]]+install|pip3?[[:space:]]+install|npm[[:space:]]+install|cargo[[:space:]]+install|yum[[:space:]]+install|apk[[:space:]]+add|curl[[:space:]]+[^|]*\|[[:space:]]*bash'; then
  fail "entrypoint appears to package-install (plan §4.3 anti-pattern)"
else
  pass "entrypoint does not package-install CLIs"
fi

if grep -q 'LANYARD_ENTRY_ALLOW_PACKAGE_INSTALL' "${ENTRY}"; then
  pass "entrypoint forbids LANYARD_ENTRY_ALLOW_PACKAGE_INSTALL"
else
  fail "missing package-install hard fail guard"
fi

# --- product CLI prebake in Dockerfile (build-time, not boot) ----------------
for pkg in git curl jq python3 tini; do
  if grep -Eq "^[[:space:]]*${pkg}[[:space:]]*\\\\?$|^[[:space:]]*${pkg}[[:space:]]*$" "${DOCKERFILE}" \
    || grep -Eq "[[:space:]]${pkg}([[:space:]]|\\\\)" "${DOCKERFILE}"; then
    pass "Dockerfile prebakes ${pkg}"
  else
    fail "Dockerfile missing prebake package: ${pkg}"
  fi
done

if grep -Eq 'apt-get[[:space:]]+install' "${DOCKERFILE}"; then
  pass "Dockerfile installs packages at build time"
else
  fail "Dockerfile has no build-time package install"
fi

# --- mount-s3 prebake + multi-arch (lp-zuh.9.3) ------------------------------
INSTALL_MOUNT="${ROOT}/install-mount-s3.sh"
if grep -Eq 'MOUNT_S3_VERSION=1\.23\.0|mount-s3-1\.23\.0' "${DOCKERFILE}" "${INSTALL_MOUNT}"; then
  pass "mount-s3 version pinned to 1.23.0 (Dockerfile or install script)"
else
  fail "mount-s3 version not pinned to 1.23.0"
fi
if grep -q 'install-mount-s3' "${DOCKERFILE}" && grep -q 'command -v mount-s3' "${DOCKERFILE}" \
  && grep -q 'command -v fusermount' "${DOCKERFILE}"; then
  pass "Dockerfile installs and verifies mount-s3 + fusermount at build time"
else
  fail "Dockerfile missing mount-s3/fusermount build-time install/verify"
fi
if grep -Eq 'linux/arm64' "${DOCKERFILE}" && grep -Eq 'linux/amd64' "${DOCKERFILE}"; then
  pass "Dockerfile documents linux/amd64 + linux/arm64"
else
  fail "Dockerfile missing multi-arch (amd64+arm64) documentation"
fi
if grep -Eq 'arm64|x86_64' "${INSTALL_MOUNT}"; then
  pass "install-mount-s3.sh maps dpkg arch → mount-s3 release arch"
else
  fail "install-mount-s3.sh missing arch mapping"
fi
if grep -Eq 'chown[[:space:]]+brain:brain[[:space:]]+/mnt/vault' "${DOCKERFILE}"; then
  pass "Dockerfile chowns /mnt/vault to brain for empty local fallback"
else
  fail "Dockerfile missing /mnt/vault chown to brain"
fi
# Entrypoint must never install mount-s3 (or any package) on boot.
if echo "${entry_code}" | grep -Eiq 'mount-s3\.deb|install-mount-s3|mountpoint-s3-release|apt-get[[:space:]]+install.*mount'; then
  fail "entrypoint appears to install mount-s3 on boot"
else
  pass "entrypoint does not install mount-s3 on boot"
fi

# --- mempalace CLI prebake (lp-zuh.10.2) -------------------------------------
INSTALL_MP="${ROOT}/install-mempalace.sh"
if grep -Eq 'MEMPALACE_VERSION=3\.7\.0|mempalace==3\.7\.0' "${DOCKERFILE}" "${INSTALL_MP}"; then
  pass "mempalace version pinned to 3.7.0 (Dockerfile or install script)"
else
  fail "mempalace version not pinned to 3.7.0"
fi
if grep -q 'install-mempalace' "${DOCKERFILE}" && grep -q 'command -v mempalace' "${DOCKERFILE}"; then
  pass "Dockerfile installs and verifies mempalace at build time"
else
  fail "Dockerfile missing mempalace build-time install/verify"
fi
if grep -Eq 'pip install|uv tool install|venv' "${INSTALL_MP}" \
  && grep -Eq 'must run as root|image build only' "${INSTALL_MP}"; then
  pass "install-mempalace.sh is build-time only (venv + pinned pip)"
else
  fail "install-mempalace.sh missing build-time install guards"
fi
if grep -Eq 'command-shim|lp-zuh\.11\.4|spawn\(\"command\"' "${INSTALL_MP}" \
  && grep -q 'usr/local/bin/command' "${INSTALL_MP}"; then
  pass "install-mempalace.sh installs Node command -v shim (lp-zuh.11.4)"
else
  fail "install-mempalace.sh missing command-shim for MemPalace which()"
fi
if echo "${entry_code}" | grep -Eiq 'install-mempalace|pip3?[[:space:]]+install[[:space:]].*mempalace|uv[[:space:]]+tool[[:space:]]+install[[:space:]].*mempalace|mempalace=='; then
  fail "entrypoint appears to install mempalace on boot"
else
  pass "entrypoint does not install mempalace on boot"
fi
if echo "${entry_code}" | grep -q 'ensure_mempalace_runtime' \
  && echo "${entry_code}" | grep -q 'MEMPALACE_BIN'; then
  pass "entrypoint ensure_mempalace_runtime sets MEMPALACE_BIN / guest command-shim"
else
  fail "entrypoint missing ensure_mempalace_runtime (lp-zuh.11.4)"
fi
if grep -Eq 'mempalace:|path: /mnt/vault/mempalace|enabled: true' "${ENTRY}"; then
  pass "kitchen-sink seeds mempalace.enabled + path under /mnt/vault"
else
  fail "kitchen-sink missing mempalace enabled/path under vault"
fi
if grep -Eqi 'MemPalace|mempalace' "${README}" && grep -Eqi 'lp-zuh\.10\.2|prebake|PATH' "${README}"; then
  pass "README documents mempalace prebake (lp-zuh.10.2)"
else
  fail "README missing mempalace prebake docs"
fi

if grep -q 'ensure_vault_mount' "${ENTRY}"; then
  pass "entrypoint has ensure_vault_mount (lp-zuh.6)"
else
  fail "entrypoint missing ensure_vault_mount"
fi
if grep -q 'ensure_agent_config' "${ENTRY}" && grep -q 'kitchen-sink' "${ENTRY}"; then
  pass "entrypoint kitchen-sink config seed present (lp-qh2 / lp-zuh.4/5)"
else
  fail "entrypoint missing kitchen-sink config seed (lp-qh2)"
fi
if grep -q 'kitchen-sink' "${README}"; then
  pass "README documents kitchen-sink config seed"
else
  fail "README missing kitchen-sink docs"
fi
# Default projects.db seed under vault primary_path (lp-zuh.10.7)
SEED_PROJ="${ROOT}/seed-default-projects.py"
if [[ -f "${SEED_PROJ}" ]] && grep -q 'lp-zuh.10.7' "${SEED_PROJ}"; then
  pass "seed-default-projects.py present (lp-zuh.10.7)"
else
  fail "missing seed-default-projects.py for lp-zuh.10.7"
fi
if grep -q 'ensure_default_projects' "${ENTRY}" && grep -q 'seed-default-projects.py' "${ENTRY}"; then
  pass "entrypoint ensure_default_projects wires projects.db seed (lp-zuh.10.7)"
else
  fail "entrypoint missing ensure_default_projects / seed-default-projects.py"
fi
if grep -q 'seed-default-projects.py' "${DOCKERFILE}"; then
  pass "Dockerfile COPY seed-default-projects.py"
else
  fail "Dockerfile missing seed-default-projects.py COPY"
fi
if grep -q 'lp-zuh.10.7' "${README}" && grep -q 'Projects/Workspace' "${README}"; then
  pass "README documents default projects primary_path (lp-zuh.10.7)"
else
  fail "README missing lp-zuh.10.7 projects primary_path docs"
fi
# Lab MCP product surface path (lp-zuh.10.6) — binary + fragment + optional seed helper
LAB_MCP="${ROOT}/lab-mcp/lab_echo_server.py"
MCP_FRAG="${ROOT}/kitchen-sink-mcp.fragment.yaml"
if [[ -f "${LAB_MCP}" ]] && grep -q 'lab_echo' "${LAB_MCP}"; then
  pass "lab-only MCP server present (lp-zuh.10.6 lab_echo)"
else
  fail "missing deploy/daytona/agent-gateway/lab-mcp/lab_echo_server.py"
fi
if [[ -f "${MCP_FRAG}" ]] && grep -q 'mcp_servers:' "${MCP_FRAG}" && grep -q 'lab_echo' "${MCP_FRAG}"; then
  pass "kitchen-sink MCP fragment present (lp-zuh.10.6)"
else
  fail "missing kitchen-sink-mcp.fragment.yaml with lab_echo"
fi
if grep -q 'maybe_seed_lab_mcp' "${ENTRY}" && grep -q 'LANYARD_ENTRY_SEED_MCP' "${ENTRY}"; then
  pass "entrypoint optional LANYARD_ENTRY_SEED_MCP merge helper present"
else
  fail "entrypoint missing maybe_seed_lab_mcp / LANYARD_ENTRY_SEED_MCP"
fi
if grep -q 'LANYARD_ENTRY_SEED_MCP' "${README}" && grep -q 'lp-zuh.10.6' "${README}"; then
  pass "README documents lab MCP residual path (lp-zuh.10.6)"
else
  fail "README missing LANYARD_ENTRY_SEED_MCP / lp-zuh.10.6 docs"
fi
if grep -q 'lab-mcp' "${DOCKERFILE}" && grep -q 'kitchen-sink-mcp.fragment.yaml' "${DOCKERFILE}"; then
  pass "Dockerfile prebakes lab-mcp + MCP fragment"
else
  fail "Dockerfile missing lab-mcp / kitchen-sink-mcp.fragment COPY"
fi
# Offline probe: lab_echo tools/list (no secrets, no network)
if command -v python3 >/dev/null 2>&1; then
  set +e
  lab_probe_out="$(
    printf '%s\n' \
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
      '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
      | python3 "${LAB_MCP}" 2>/dev/null
  )"
  lab_probe_rc=$?
  set -e
  if [[ "${lab_probe_rc}" -eq 0 ]] && echo "${lab_probe_out}" | grep -q 'lab_echo'; then
    pass "lab_echo MCP stdio probe tools/list ok"
  else
    fail "lab_echo MCP stdio probe failed"
  fi
else
  fail "python3 required for lab_echo probe"
fi

# --- no secrets baked in Dockerfile ------------------------------------------
if grep -Eiq '^[[:space:]]*(ENV|ARG)[[:space:]].*(GATEWAY_RELAY_SECRET|OPENAI_API_KEY|XAI_API_KEY|DAYTONA_API_KEY|AWS_SECRET_ACCESS_KEY)=' "${DOCKERFILE}"; then
  fail "Dockerfile appears to bake secret env values"
else
  pass "Dockerfile has no baked secret env assignments"
fi

if grep -Eiq '^[[:space:]]*[^#[:space:]].*(docker[[:space:]]+push|aws[[:space:]]+ecr)' "${DOCKERFILE}"; then
  fail "Dockerfile has push/ECR commands"
else
  pass "Dockerfile does not require ECR push"
fi

# --- platform + plan §4.3 + bead citations -----------------------------------
if grep -q 'linux/amd64' "${DOCKERFILE}"; then
  pass "Dockerfile targets linux/amd64"
else
  fail "Dockerfile missing linux/amd64 platform"
fi

if grep -q '4.3' "${DOCKERFILE}" && grep -q '4.3' "${ENTRY}" && grep -q '4.3' "${README}"; then
  pass "Dockerfile + entrypoint + README cite plan §4.3"
else
  fail "missing plan §4.3 citation"
fi

if grep -q 'lp-b7w' "${ENTRY}" && grep -q 'lp-b7w' "${README}"; then
  pass "entrypoint + README reference lp-b7w"
else
  fail "missing lp-b7w bead reference"
fi

if grep -q 'lp-e9l' "${DOCKERFILE}" && grep -q 'lp-e9l' "${README}"; then
  pass "Dockerfile + README reference lp-e9l"
else
  fail "missing lp-e9l bead reference"
fi

if grep -q 'lp-zuh.9.3' "${DOCKERFILE}"; then
  pass "Dockerfile references lp-zuh.9.3 mount bake bead"
else
  fail "Dockerfile missing lp-zuh.9.3 bead reference"
fi

# Shared smoke fixtures
tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT
vault="${tmpdir}/vault"
home="${tmpdir}/backend-home"
mkdir -p "${vault}" "${home}"
touch "${vault}/.vault-ready"

common_env() {
  # Prints env -i args for happy-path gateway env (caller adds extras).
  # Point seed helper at monorepo copy (image path is /usr/local/lib/lanyard/...).
  cat <<EOF
PATH=/usr/bin:/bin
HOME=${home}
VAULT_ROOT=${vault}
BACKEND_HOME=${home}
BACKEND_INSTALL_PATH=${tmpdir}/install
GATEWAY_RELAY_URL=wss://relay.example/ws
GATEWAY_RELAY_ID=inst_offline_smoke
GATEWAY_RELAY_INSTANCE_ID=inst_offline_smoke
GATEWAY_RELAY_SECRET=smoke-not-a-real-secret
LANYARD_ENTRY_VAULT_WAIT_SEC=5
LANYARD_ENTRY_VAULT_READY_FILE=.vault-ready
LANYARD_ENTRY_GATEWAY_BIN=${FAKE}
LANYARD_FAKE_GATEWAY_SLEEP_SEC=0
LANYARD_ENTRY_SEED_PROJECTS_PY=${SEED_PROJ}
EOF
}

run_entry() {
  # Usage: run_entry [extra KEY=VAL ...] -- [entrypoint args...]
  local -a env_pairs=()
  while [[ $# -gt 0 && "$1" != "--" ]]; do
    env_pairs+=("$1")
    shift
  done
  if [[ "${1:-}" == "--" ]]; then shift; fi
  local -a args=("$@")
  if [[ ${#args[@]} -eq 0 ]]; then
    args=(gateway)
  fi

  # shellcheck disable=SC2046
  env -i $(common_env | tr '\n' ' ') "${env_pairs[@]}" bash "${ENTRY}" "${args[@]}"
}

# --- happy path: vault ready + env → gateway runs (lp-b7w) -------------------
set +e
out="$(run_entry 2>&1)"
rc=$?
set -e

if [[ "${rc}" -eq 0 ]] && echo "${out}" | grep -q 'fake-gateway: starting'; then
  pass "happy path: wait vault + env → fake gateway"
else
  fail "happy path failed (rc=${rc})"
  echo "${out}" | sed 's/^/    /'
fi

if echo "${out}" | grep -q 'smoke-not-a-real-secret'; then
  fail "entrypoint logged secret value"
else
  pass "entrypoint does not log secret value"
fi

# Kitchen-sink config seed (lp-qh2 residual still present with this bake)
cfg_file="${home}/config.yaml"
if [[ -f "${cfg_file}" ]] && grep -q 'kitchen-sink\|vault_root' "${cfg_file}" \
  && grep -q 'workflow:' "${cfg_file}" && grep -q 'cron:' "${cfg_file}"; then
  pass "kitchen-sink agent config seeded at BACKEND_HOME/config.yaml (lp-qh2)"
else
  fail "expected kitchen-sink config.yaml seed after happy path"
fi
if echo "${out}" | grep -qi 'seeded kitchen-sink'; then
  pass "entrypoint logged kitchen-sink seed"
else
  fail "entrypoint did not log kitchen-sink seed"
fi
# Default seed must NOT include mcp_servers (LA Zod residual; lp-zuh.10.6)
if [[ -f "${cfg_file}" ]] && ! grep -qE '^[[:space:]]*mcp_servers:' "${cfg_file}"; then
  pass "default kitchen-sink seed omits mcp_servers (strict-LA safe)"
else
  fail "default kitchen-sink seed unexpectedly includes mcp_servers"
fi

# Default projects.db Workspace under vault (lp-zuh.10.7)
proj_db="${home}/projects.db"
want_primary="${vault}/Projects/Workspace"
if [[ -f "${proj_db}" ]]; then
  pass "projects.db created under BACKEND_HOME (lp-zuh.10.7)"
else
  fail "expected projects.db after happy path ensure_default_projects"
fi
if python3 - "${proj_db}" "${want_primary}" <<'PY'
import sqlite3, sys
db, want = sys.argv[1], sys.argv[2]
c = sqlite3.connect(db)
row = c.execute(
    "SELECT slug, primary_path FROM projects WHERE archived = 0 ORDER BY created_at ASC LIMIT 1"
).fetchone()
c.close()
assert row is not None, "no projects"
assert row[0] == "workspace", row
assert row[1] == want, (row[1], want)
print("primary_path OK:", row[1])
PY
then
  pass "projects.db Workspace primary_path under VAULT_ROOT (lp-zuh.10.7)"
else
  fail "projects.db primary_path not vault Workspace"
fi
if echo "${out}" | grep -qi 'default projects seed OK'; then
  pass "entrypoint logged default projects seed"
else
  fail "entrypoint did not log default projects seed"
fi
if [[ -f "${home}/.lanyard-vault-write-state" ]] && grep -qx 'writable' "${home}/.lanyard-vault-write-state"; then
  pass "T8 write-state flag is writable on happy path"
else
  fail "T8 expected BACKEND_HOME/.lanyard-vault-write-state=writable after happy path"
fi

# Optional LANYARD_ENTRY_SEED_MCP=1 merges lab_echo (path proof; LA pin still required live)
mcp_home="${tmpdir}/home-mcp"
mcp_vault="${tmpdir}/vault-mcp"
mkdir -p "${mcp_home}" "${mcp_vault}"
: >"${mcp_vault}/.vault-ready"
export LANYARD_LAB_MCP_SERVER="${LAB_MCP}"
export LANYARD_KITCHEN_SINK_MCP_FRAGMENT="${MCP_FRAG}"
set +e
out_mcp="$(
  env -i \
    PATH="/usr/bin:/bin" \
    HOME="${mcp_home}" \
    VAULT_ROOT="${mcp_vault}" \
    BACKEND_HOME="${mcp_home}" \
    GATEWAY_RELAY_URL="wss://relay.example/ws" \
    GATEWAY_RELAY_ID="inst_offline_smoke" \
    GATEWAY_RELAY_INSTANCE_ID="inst_offline_smoke" \
    GATEWAY_RELAY_SECRET="smoke-not-a-real-secret" \
    LANYARD_ENTRY_VAULT_READY_FILE=".vault-ready" \
    LANYARD_ENTRY_GATEWAY_BIN="${FAKE}" \
    LANYARD_ENTRY_SEED_MCP=1 \
    LANYARD_LAB_MCP_SERVER="${LAB_MCP}" \
    LANYARD_KITCHEN_SINK_MCP_FRAGMENT="${MCP_FRAG}" \
    LANYARD_FAKE_GATEWAY_SLEEP_SEC=0 \
    bash "${ENTRY}" gateway 2>&1
)"
rc_mcp=$?
set -e
mcp_cfg="${mcp_home}/config.yaml"
if [[ "${rc_mcp}" -eq 0 ]] && [[ -f "${mcp_cfg}" ]] \
  && grep -q 'mcp_servers:' "${mcp_cfg}" && grep -q 'lab_echo' "${mcp_cfg}"; then
  pass "LANYARD_ENTRY_SEED_MCP=1 merges lab_echo into config.yaml"
else
  fail "LANYARD_ENTRY_SEED_MCP=1 did not merge lab_echo (rc=${rc_mcp})"
  echo "${out_mcp}" | sed 's/^/    /'
fi
if echo "${out_mcp}" | grep -qi 'merged lab-only mcp_servers'; then
  pass "entrypoint logged lab MCP merge"
else
  fail "entrypoint did not log lab MCP merge under LANYARD_ENTRY_SEED_MCP=1"
fi

# --- Bucket C env file written/refreshed (lp-b7w AC) -------------------------
env_file="${home}/gateway.env"
if [[ -f "${env_file}" ]]; then
  pass "gateway env file written at BACKEND_HOME/gateway.env"
else
  fail "expected gateway env file at ${env_file}"
fi

mode="$(stat -c '%a' "${env_file}" 2>/dev/null || stat -f '%OLp' "${env_file}")"
if [[ "${mode}" == "600" || "${mode}" == "0600" ]]; then
  pass "gateway env file mode 0600"
else
  fail "gateway env file mode not 0600 (got ${mode})"
fi

if grep -q 'GATEWAY_RELAY_SECRET=smoke-not-a-real-secret' "${env_file}" \
  && grep -q "VAULT_ROOT=${vault}" "${env_file}" \
  && grep -q 'GATEWAY_RELAY_INSTANCE_ID=inst_offline_smoke' "${env_file}"; then
  pass "gateway env file contains Bucket C parity keys"
else
  fail "gateway env file missing expected parity keys"
fi

# --- vault timeout (lp-b7w AC) -----------------------------------------------
empty_vault="${tmpdir}/empty-vault"
set +e
out2="$(
  env -i \
    PATH="/usr/bin:/bin" \
    HOME="${home}" \
    VAULT_ROOT="${empty_vault}" \
    BACKEND_HOME="${home}" \
    GATEWAY_RELAY_URL="wss://relay.example/ws" \
    GATEWAY_RELAY_ID="inst_offline_smoke" \
    GATEWAY_RELAY_INSTANCE_ID="inst_offline_smoke" \
    GATEWAY_RELAY_SECRET="smoke-not-a-real-secret" \
    LANYARD_ENTRY_VAULT_WAIT_SEC=2 \
    LANYARD_ENTRY_GATEWAY_BIN="${FAKE}" \
    bash "${ENTRY}" gateway 2>&1
)"
rc2=$?
set -e

if [[ "${rc2}" -ne 0 ]] && echo "${out2}" | grep -qi 'vault not ready'; then
  pass "vault not ready → timeout fail"
else
  fail "expected vault timeout failure (rc=${rc2})"
  echo "${out2}" | sed 's/^/    /'
fi

# Marker file missing under existing vault also fails closed.
vault2="${tmpdir}/vault-no-marker"
mkdir -p "${vault2}"
set +e
out2b="$(
  env -i \
    PATH="/usr/bin:/bin" \
    HOME="${home}" \
    VAULT_ROOT="${vault2}" \
    BACKEND_HOME="${home}" \
    GATEWAY_RELAY_URL="wss://relay.example/ws" \
    GATEWAY_RELAY_ID="inst_offline_smoke" \
    GATEWAY_RELAY_INSTANCE_ID="inst_offline_smoke" \
    GATEWAY_RELAY_SECRET="smoke-not-a-real-secret" \
    LANYARD_ENTRY_VAULT_WAIT_SEC=2 \
    LANYARD_ENTRY_VAULT_READY_FILE=".vault-ready" \
    LANYARD_ENTRY_GATEWAY_BIN="${FAKE}" \
    bash "${ENTRY}" gateway 2>&1
)"
rc2b=$?
set -e

if [[ "${rc2b}" -ne 0 ]] && echo "${out2b}" | grep -qi 'vault not ready'; then
  pass "vault marker missing → timeout fail"
else
  fail "expected marker timeout failure (rc=${rc2b})"
  echo "${out2b}" | sed 's/^/    /'
fi

# --- T8 / lp-vqr0.12: gateway exec is not gated on post-mount writable -------
# Prove: exec is not after a writable die path; default wait is not 1200;
# runtime with POST_MOUNT=1200 + not-writable vault still starts the gateway.

if grep -q 'LANYARD_ENTRY_POST_MOUNT_WRITABLE_SEC:-0' "${ENTRY}" \
  && ! grep -q 'LANYARD_ENTRY_POST_MOUNT_WRITABLE_SEC:-1200' "${ENTRY}" \
  && ! grep -q 'LANYARD_ENTRY_POST_MOUNT_WRITABLE_SEC:-120}' "${ENTRY}"; then
  pass "T8 default POST_MOUNT wait is 0 (not 1200 / not 120)"
else
  fail "T8 default LANYARD_ENTRY_POST_MOUNT_WRITABLE_SEC must be 0, not 1200"
fi

if grep -n 'die "after mount-s3' "${ENTRY}" >/dev/null \
  || grep -n 'die "vault at ${VAULT_ROOT} mounted but not writable"' "${ENTRY}" >/dev/null; then
  fail "T8 still has writable die path before exec"
else
  pass "T8 no die on post-mount / already-mounted not-writable"
fi

if awk '
  /while ! vault_is_writable/ { loop=1 }
  loop && /sleep 1/ { found=1 }
  /start_gateway/ { exec_seen=1 }
  END { exit(found ? 1 : 0) }
' "${ENTRY}"; then
  pass "T8 no foreground sleep loop on vault_is_writable"
else
  fail "T8 still waits (sleep) while vault_is_writable before exec"
fi

if awk '
  /wait_for_vault/ { wait=1 }
  wait && /start_gateway/ { ok=1 }
  END { exit(ok ? 0 : 1) }
' "${ENTRY}"; then
  pass "T8 main exec (start_gateway) follows wait_for_vault, not a writable die"
else
  fail "T8 start_gateway is not after wait_for_vault"
fi

if grep -q 'does not fix lp-puzc' "${ENTRY}"; then
  pass "T8 does not claim lp-puzc fixed"
else
  fail "T8 missing explicit lp-puzc-not-fixed note"
fi

fake_bin="${tmpdir}/t8-bin"
mkdir -p "${fake_bin}"
cat >"${fake_bin}/mount-s3" <<'EOF'
#!/usr/bin/env bash
# Fake mount-s3: succeed, leave target readable but not writable (lp-puzc-shaped).
mp="${@: -1}"
mkdir -p "${mp}"
chmod a-w "${mp}" 2>/dev/null || true
exit 0
EOF
chmod +x "${fake_bin}/mount-s3"

t8_home="${tmpdir}/t8-home"
t8_vault="${tmpdir}/t8-vault"
mkdir -p "${t8_home}"
t8_start="${SECONDS}"
set +e
out_t8="$(
  env -i \
    PATH="${fake_bin}:/usr/bin:/bin" \
    HOME="${t8_home}" \
    VAULT_ROOT="${t8_vault}" \
    BACKEND_HOME="${t8_home}" \
    GATEWAY_RELAY_URL="wss://relay.example/ws" \
    GATEWAY_RELAY_ID="inst_offline_smoke" \
    GATEWAY_RELAY_INSTANCE_ID="inst_offline_smoke" \
    GATEWAY_RELAY_SECRET="smoke-not-a-real-secret" \
    S3_VAULT_PREFIX="tenants/smoke/vault/" \
    LANYARD_VAULT_BUCKET="lanyard-vault-smoke" \
    AWS_ACCESS_KEY_ID="AKIASMOKE" \
    AWS_SECRET_ACCESS_KEY="smoke-secret" \
    AWS_REGION="us-east-1" \
    LANYARD_ENTRY_VAULT_WAIT_SEC=5 \
    LANYARD_ENTRY_POST_MOUNT_WRITABLE_SEC=1200 \
    LANYARD_ENTRY_GATEWAY_BIN="${FAKE}" \
    LANYARD_FAKE_GATEWAY_SLEEP_SEC=0 \
    LANYARD_ENTRY_SEED_PROJECTS_PY="${SEED_PROJ}" \
    bash "${ENTRY}" gateway 2>&1
)"
rc_t8=$?
set -e
t8_elapsed=$((SECONDS - t8_start))
chmod -R u+w "${t8_vault}" 2>/dev/null || true

if [[ "${rc_t8}" -eq 0 ]] \
  && echo "${out_t8}" | grep -q 'fake-gateway: starting' \
  && echo "${out_t8}" | grep -q 'write state=pending' \
  && echo "${out_t8}" | grep -q 'ignored for gateway boot' \
  && echo "${out_t8}" | grep -q 'does not fix lp-puzc' \
  && [[ "${t8_elapsed}" -lt 15 ]]; then
  pass "T8 post-mount not-writable + POST_MOUNT=1200 → gateway in ${t8_elapsed}s (not 1200)"
else
  fail "T8 post-mount path blocked or died (rc=${rc_t8} elapsed=${t8_elapsed}s)"
  echo "${out_t8}" | sed 's/^/    /'
fi

t8_flag="${t8_home}/.lanyard-vault-write-state"
if [[ -f "${t8_flag}" ]] && grep -qx 'pending' "${t8_flag}"; then
  pass "T8 write-state flag is pending (not a dead sandbox)"
else
  fail "T8 expected BACKEND_HOME/.lanyard-vault-write-state=pending"
fi

# Already-mounted but not writable (optional=0 inject): still exec, no die.
cat >"${fake_bin}/findmnt" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "${fake_bin}/findmnt"
t8b_home="${tmpdir}/t8b-home"
t8b_vault="${tmpdir}/t8b-vault"
mkdir -p "${t8b_home}" "${t8b_vault}"
chmod a-w "${t8b_vault}"
t8b_start="${SECONDS}"
set +e
out_t8b="$(
  env -i \
    PATH="${fake_bin}:/usr/bin:/bin" \
    HOME="${t8b_home}" \
    VAULT_ROOT="${t8b_vault}" \
    BACKEND_HOME="${t8b_home}" \
    GATEWAY_RELAY_URL="wss://relay.example/ws" \
    GATEWAY_RELAY_ID="inst_offline_smoke" \
    GATEWAY_RELAY_INSTANCE_ID="inst_offline_smoke" \
    GATEWAY_RELAY_SECRET="smoke-not-a-real-secret" \
    S3_VAULT_PREFIX="tenants/smoke/vault/" \
    LANYARD_VAULT_BUCKET="lanyard-vault-smoke" \
    AWS_ACCESS_KEY_ID="AKIASMOKE" \
    AWS_SECRET_ACCESS_KEY="smoke-secret" \
    LANYARD_ENTRY_VAULT_WAIT_SEC=5 \
    LANYARD_ENTRY_POST_MOUNT_WRITABLE_SEC=1200 \
    LANYARD_ENTRY_GATEWAY_BIN="${FAKE}" \
    LANYARD_FAKE_GATEWAY_SLEEP_SEC=0 \
    LANYARD_ENTRY_SEED_PROJECTS_PY="${SEED_PROJ}" \
    bash "${ENTRY}" gateway 2>&1
)"
rc_t8b=$?
set -e
t8b_elapsed=$((SECONDS - t8b_start))
chmod -R u+w "${t8b_vault}" 2>/dev/null || true

if [[ "${rc_t8b}" -eq 0 ]] \
  && echo "${out_t8b}" | grep -q 'fake-gateway: starting' \
  && echo "${out_t8b}" | grep -q 'write state=pending' \
  && echo "${out_t8b}" | grep -q 'already mounted' \
  && [[ "${t8b_elapsed}" -lt 15 ]]; then
  pass "T8 already-mounted not-writable → gateway in ${t8b_elapsed}s (not die)"
else
  fail "T8 already-mounted path blocked or died (rc=${rc_t8b} elapsed=${t8b_elapsed}s)"
  echo "${out_t8b}" | sed 's/^/    /'
fi

# --- gateway death exits non-zero (lp-b7w AC) --------------------------------
set +e
out_death="$(
  env -i \
    PATH="/usr/bin:/bin" \
    HOME="${home}" \
    VAULT_ROOT="${vault}" \
    BACKEND_HOME="${home}" \
    GATEWAY_RELAY_URL="wss://relay.example/ws" \
    GATEWAY_RELAY_ID="inst_offline_smoke" \
    GATEWAY_RELAY_INSTANCE_ID="inst_offline_smoke" \
    GATEWAY_RELAY_SECRET="smoke-not-a-real-secret" \
    LANYARD_ENTRY_VAULT_WAIT_SEC=5 \
    LANYARD_ENTRY_VAULT_READY_FILE=".vault-ready" \
    LANYARD_ENTRY_GATEWAY_BIN="${FAKE}" \
    LANYARD_FAKE_GATEWAY_SLEEP_SEC=0 \
    LANYARD_FAKE_GATEWAY_EXIT_CODE=42 \
    bash "${ENTRY}" gateway 2>&1
)"
rc_death=$?
set -e

if [[ "${rc_death}" -eq 42 ]] && echo "${out_death}" | grep -q 'fake-gateway: exit 42'; then
  pass "gateway death exits process non-zero (42)"
else
  fail "expected gateway exit 42 propagated (rc=${rc_death})"
  echo "${out_death}" | sed 's/^/    /'
fi

# --- missing required env ----------------------------------------------------
set +e
out3="$(
  env -i \
    PATH="/usr/bin:/bin" \
    HOME="${home}" \
    VAULT_ROOT="${vault}" \
    BACKEND_HOME="${home}" \
    LANYARD_ENTRY_VAULT_WAIT_SEC=5 \
    LANYARD_ENTRY_VAULT_READY_FILE=".vault-ready" \
    LANYARD_ENTRY_GATEWAY_BIN="${FAKE}" \
    bash "${ENTRY}" gateway 2>&1
)"
rc3=$?
set -e

if [[ "${rc3}" -ne 0 ]] && echo "${out3}" | grep -qi 'required env'; then
  pass "missing GATEWAY_RELAY_* → fail closed"
else
  fail "expected missing-env failure (rc=${rc3})"
  echo "${out3}" | sed 's/^/    /'
fi

# --- sandbox_id must not equal instance_id -----------------------------------
set +e
out4="$(
  env -i \
    PATH="/usr/bin:/bin" \
    HOME="${home}" \
    VAULT_ROOT="${vault}" \
    BACKEND_HOME="${home}" \
    GATEWAY_RELAY_URL="wss://relay.example/ws" \
    GATEWAY_RELAY_ID="sandbox_abc" \
    GATEWAY_RELAY_INSTANCE_ID="sandbox_abc" \
    GATEWAY_RELAY_SECRET="smoke-not-a-real-secret" \
    LANYARD_ENTRY_SANDBOX_ID="sandbox_abc" \
    LANYARD_ENTRY_VAULT_WAIT_SEC=5 \
    LANYARD_ENTRY_VAULT_READY_FILE=".vault-ready" \
    LANYARD_ENTRY_GATEWAY_BIN="${FAKE}" \
    bash "${ENTRY}" gateway 2>&1
)"
rc4=$?
set -e

if [[ "${rc4}" -ne 0 ]] && echo "${out4}" | grep -qi 'sandbox_id'; then
  pass "rejects instance_id == sandbox_id"
else
  fail "expected sandbox_id identity rejection (rc=${rc4})"
  echo "${out4}" | sed 's/^/    /'
fi

# --- package-install flag forbidden ------------------------------------------
set +e
out5="$(
  env -i \
    PATH="/usr/bin:/bin" \
    HOME="${home}" \
    VAULT_ROOT="${vault}" \
    BACKEND_HOME="${home}" \
    GATEWAY_RELAY_URL="wss://relay.example/ws" \
    GATEWAY_RELAY_ID="inst_offline_smoke" \
    GATEWAY_RELAY_INSTANCE_ID="inst_offline_smoke" \
    GATEWAY_RELAY_SECRET="smoke-not-a-real-secret" \
    LANYARD_ENTRY_ALLOW_PACKAGE_INSTALL=1 \
    LANYARD_ENTRY_VAULT_WAIT_SEC=5 \
    LANYARD_ENTRY_VAULT_READY_FILE=".vault-ready" \
    LANYARD_ENTRY_GATEWAY_BIN="${FAKE}" \
    bash "${ENTRY}" gateway 2>&1
)"
rc5=$?
set -e

if [[ "${rc5}" -ne 0 ]] && echo "${out5}" | grep -qi 'forbidden\|package'; then
  pass "LANYARD_ENTRY_ALLOW_PACKAGE_INSTALL rejected"
else
  fail "expected package-install flag rejection (rc=${rc5})"
  echo "${out5}" | sed 's/^/    /'
fi

# --- env file skip when LANYARD_ENTRY_ENV_FILE empty -------------------------
home_skip="${tmpdir}/backend-home-skip"
mkdir -p "${home_skip}"
set +e
out6="$(
  env -i \
    PATH="/usr/bin:/bin" \
    HOME="${home_skip}" \
    VAULT_ROOT="${vault}" \
    BACKEND_HOME="${home_skip}" \
    GATEWAY_RELAY_URL="wss://relay.example/ws" \
    GATEWAY_RELAY_ID="inst_offline_smoke" \
    GATEWAY_RELAY_INSTANCE_ID="inst_offline_smoke" \
    GATEWAY_RELAY_SECRET="smoke-not-a-real-secret" \
    LANYARD_ENTRY_VAULT_WAIT_SEC=5 \
    LANYARD_ENTRY_VAULT_READY_FILE=".vault-ready" \
    LANYARD_ENTRY_GATEWAY_BIN="${FAKE}" \
    LANYARD_ENTRY_ENV_FILE= \
    LANYARD_FAKE_GATEWAY_SLEEP_SEC=0 \
    bash "${ENTRY}" gateway 2>&1
)"
rc6=$?
set -e

if [[ "${rc6}" -eq 0 ]] && [[ ! -f "${home_skip}/gateway.env" ]] && echo "${out6}" | grep -qi 'skipping gateway env file'; then
  pass "empty LANYARD_ENTRY_ENV_FILE skips env file write"
else
  fail "expected env file skip (rc=${rc6})"
  echo "${out6}" | sed 's/^/    /'
fi

# --- install-agent-runtime keeps stub when no tarball ------------------------
stage="${tmpdir}/stage"
install_path="${tmpdir}/install-tree"
mkdir -p "${stage}" "${install_path}/bin"
cp "${FAKE}" "${install_path}/bin/company-brain-backend"
chmod +x "${install_path}/bin/company-brain-backend"
bash "${INSTALL_RT}" "" "${stage}" "${install_path}"
if [[ -x "${install_path}/bin/company-brain-backend" ]]; then
  pass "install-agent-runtime keeps stub without tarball"
else
  fail "install-agent-runtime broke stub path"
fi

# --- tool-only Dockerfile target (lp-oop.21 / plan 0015 phase 6) -------------
if grep -Eq '^FROM .+ AS tool-only' "${DOCKERFILE}"; then
  pass "Dockerfile has named target tool-only"
else
  fail "Dockerfile missing AS tool-only target (lp-oop.21)"
fi
if grep -Eq '^FROM .+ AS agent-gateway' "${DOCKERFILE}"; then
  pass "Dockerfile has named target agent-gateway (default last stage)"
else
  fail "Dockerfile missing AS agent-gateway default target"
fi
if grep -Eq '^FROM .+ AS toolbox' "${DOCKERFILE}"; then
  pass "Dockerfile has shared toolbox stage"
else
  fail "Dockerfile missing AS toolbox stage"
fi

tool_only_body="$(awk '
  /^FROM / && /AS tool-only/ {p=1; next}
  /^FROM / {p=0}
  p {print}
' "${DOCKERFILE}")"
if echo "${tool_only_body}" | grep -q 'install-agent-runtime'; then
  fail "tool-only stage still calls install-agent-runtime"
else
  pass "tool-only stage skips install-agent-runtime / AGENT_TARBALL"
fi
if echo "${tool_only_body}" | grep -q 'agent-release'; then
  fail "tool-only stage copies agent-release (would bake tarball layers)"
else
  pass "tool-only stage does not COPY agent-release"
fi
if echo "${tool_only_body}" | grep -q 'lanyard-agent'; then
  pass "tool-only stage asserts no lanyard-agent tree"
else
  fail "tool-only stage missing lanyard-agent absence check"
fi

agent_gw_body="$(awk '
  /^FROM / && /AS agent-gateway/ {p=1; next}
  /^FROM / {p=0}
  p {print}
' "${DOCKERFILE}")"
if echo "${agent_gw_body}" | grep -q 'install-agent-runtime' \
  && echo "${agent_gw_body}" | grep -q 'agent-release'; then
  pass "agent-gateway stage still installs optional AGENT_TARBALL"
else
  fail "agent-gateway stage lost AGENT_TARBALL / agent-release install"
fi

if grep -q 'lp-oop.21' "${DOCKERFILE}" && grep -Eq 'tool-only' "${README}" \
  && grep -Eq 'DAYTONA_DEFAULT_SNAPSHOT|agent_snapshot_id' "${README}"; then
  pass "Dockerfile + README document tool-only recipe and live-pin hold"
else
  fail "missing lp-oop.21 tool-only docs / live-pin hold"
fi

if grep -Eq -- '--tool-only' "${ROOT}/build-local.sh"; then
  pass "build-local.sh exposes --tool-only"
else
  fail "build-local.sh missing --tool-only"
fi

# --- no lanyard-agent tree smoke (lp-oop.22) ---------------------------------
TREE_SMOKE="${ROOT}/smoke-no-lanyard-agent-tree.sh"
if [[ -x "${TREE_SMOKE}" || -f "${TREE_SMOKE}" ]]; then
  pass "smoke-no-lanyard-agent-tree.sh present"
else
  fail "smoke-no-lanyard-agent-tree.sh missing (lp-oop.22)"
fi
if grep -q 'smoke-no-lanyard-agent-tree.sh' "${README}" && grep -q 'lp-oop.22' "${README}"; then
  pass "README documents lp-oop.22 smoke"
else
  fail "README missing lp-oop.22 smoke-no-lanyard-agent-tree.sh"
fi
if grep -q 'smoke-no-lanyard-agent-tree.sh' "${ROOT}/build-local.sh"; then
  pass "build-local.sh --tool-only invokes lp-oop.22 smoke"
else
  fail "build-local.sh does not call smoke-no-lanyard-agent-tree.sh"
fi
if [[ -f "${TREE_SMOKE}" ]]; then
  chmod +x "${TREE_SMOKE}" 2>/dev/null || true
  set +e
  tree_out="$(bash "${TREE_SMOKE}" 2>&1)"
  tree_rc=$?
  set -e
  if [[ "${tree_rc}" -eq 0 ]]; then
    pass "smoke-no-lanyard-agent-tree.sh offline fixture proof"
  else
    fail "smoke-no-lanyard-agent-tree.sh offline proof failed (rc=${tree_rc})"
    echo "${tree_out}" | sed 's/^/    /'
  fi
fi

PIN_FILE="${ROOT}/pins/staging-pilot.pins.yaml"
if [[ -f "${PIN_FILE}" ]] \
  && grep -q 'daytona_default_snapshot:' "${PIN_FILE}" \
  && grep -q 'agent_snapshot_id:' "${PIN_FILE}"; then
  pass "live pin file still present (recipe does not rewrite it)"
else
  fail "staging-pilot.pins.yaml missing live pin keys"
fi

last_from="$(grep -E '^FROM ' "${DOCKERFILE}" | tail -n1 || true)"
if echo "${last_from}" | grep -q 'AS agent-gateway'; then
  pass "default (last) Dockerfile stage is agent-gateway (live recipe)"
else
  fail "default last stage is not agent-gateway (got: ${last_from})"
fi

# Offline: tool-only mode does not require GATEWAY_RELAY_* and does not start gateway.
set +e
out_to="$(
  env -i \
    PATH="/usr/bin:/bin" \
    HOME="${home}" \
    VAULT_ROOT="${vault}" \
    LANYARD_IMAGE_KIND=tool-only \
    LANYARD_ENTRY_VAULT_WAIT_SEC=5 \
    LANYARD_ENTRY_VAULT_READY_FILE=".vault-ready" \
    bash "${ENTRY}" true 2>&1
)"
rc_to=$?
set -e
if [[ "${rc_to}" -eq 0 ]] \
  && echo "${out_to}" | grep -qi 'tool-only guest ready' \
  && ! echo "${out_to}" | grep -q 'fake-gateway: starting'; then
  pass "LANYARD_IMAGE_KIND=tool-only: vault wait + exec args, no gateway"
else
  fail "tool-only entrypoint mode failed (rc=${rc_to})"
  echo "${out_to}" | sed 's/^/    /'
fi

if [[ "${rc_to}" -eq 0 ]] && ! echo "${out_to}" | grep -qi 'required env GATEWAY_RELAY'; then
  pass "tool-only mode does not require GATEWAY_RELAY_*"
else
  fail "tool-only mode required Relay env (rc=${rc_to})"
fi

# --- Dockerfile prebakes Node + pnpm for LA product bake (lp-kng.9) ----------
if grep -Eq 'NODE_VERSION|nodejs.org/dist' "${DOCKERFILE}" \
  && grep -Eq 'corepack prepare pnpm|corepack enable' "${DOCKERFILE}" \
  && grep -Eq 'node --version' "${DOCKERFILE}"; then
  pass "Dockerfile prebakes Node + corepack/pnpm (LA product bake)"
else
  fail "Dockerfile missing Node/pnpm prebake for LA tarball install"
fi

if grep -Eq 'lanyard-agent product|apps/gateway/dist/main.js' "${INSTALL_RT}" \
  && grep -Eq 'layout=lanyard-agent|is_lanyard_agent_product' "${INSTALL_RT}"; then
  pass "install-agent-runtime accepts LA source+dist-v1 layout"
else
  fail "install-agent-runtime missing LA product layout support"
fi

if grep -Eq 'Lanyard Agent|not Hermes|repack-notes' "${README}"; then
  pass "README documents LA product path (not Hermes)"
else
  fail "README missing LA product tarball docs"
fi

if [[ -f "${ROOT}/repack-notes.md" ]]; then
  pass "repack-notes.md present"
else
  fail "repack-notes.md missing"
fi

# --- install-agent-runtime: backend-runtime-v1 layout still works ------------
# Nested top-level dir (real product archives); avoid single-entry `bin/`
# which the unwrap heuristic would mis-promote.
v1_root="${tmpdir}/v1-root/release"
v1_stage="${tmpdir}/v1-stage"
v1_install="${tmpdir}/v1-install"
mkdir -p "${v1_root}/bin" "${v1_stage}"
cat >"${v1_root}/bin/company-brain-backend" <<'EOF'
#!/usr/bin/env bash
echo "company-brain-backend (v1-fixture) 0.0.0-smoke"
EOF
chmod 0755 "${v1_root}/bin/company-brain-backend"
tar -czf "${v1_stage}/backend-v1-smoke.tar.gz" -C "${tmpdir}/v1-root" release
bash "${INSTALL_RT}" "backend-v1-smoke.tar.gz" "${v1_stage}" "${v1_install}"
if [[ -x "${v1_install}/bin/company-brain-backend" ]] \
  && "${v1_install}/bin/company-brain-backend" | grep -q 'v1-fixture'; then
  pass "install-agent-runtime installs backend-runtime-v1 tarball"
else
  fail "backend-runtime-v1 install path broken"
fi

# --- install-agent-runtime: LA product layout wrap (when node+pnpm present) --
if command -v node >/dev/null 2>&1 && command -v pnpm >/dev/null 2>&1; then
  la_src="${tmpdir}/la-src"
  la_stage="${tmpdir}/la-stage"
  la_install="${tmpdir}/la-install"
  mkdir -p "${la_src}/apps/gateway/dist" "${la_stage}"
  printf '%s\n' '0.0.0-smoke-la' >"${la_src}/VERSION"
  cat >"${la_src}/package.json" <<'EOF'
{
  "name": "lanyard-agent-smoke-fixture",
  "private": true,
  "version": "0.0.0-smoke-la"
}
EOF
  # Minimal lockfile so --frozen-lockfile succeeds offline-ish.
  (
    cd "${la_src}"
    pnpm install --lockfile-only >/dev/null 2>&1 || pnpm install --lockfile-only
  )
  cat >"${la_src}/apps/gateway/dist/main.js" <<'EOF'
#!/usr/bin/env node
// Minimal LA gateway stub for install-agent-runtime smoke.
if (process.argv.includes('--version') || process.argv[2] === 'version') {
  process.stdout.write('gateway-main smoke\n');
  process.exit(0);
}
process.stdout.write('gateway-main ready\n');
EOF
  tar -czf "${la_stage}/lanyard-agent-smoke.tar.gz" -C "${la_src}" .
  set +e
  out_la="$(bash "${INSTALL_RT}" "lanyard-agent-smoke.tar.gz" "${la_stage}" "${la_install}" 2>&1)"
  rc_la=$?
  set -e
  if [[ "${rc_la}" -eq 0 ]] \
    && [[ -x "${la_install}/bin/company-brain-backend" ]] \
    && [[ -f "${la_install}/lanyard-agent/apps/gateway/dist/main.js" ]] \
    && "${la_install}/bin/company-brain-backend" version 2>/dev/null | grep -q 'lanyard-agent' \
    && [[ -f "${la_install}/manifest/backend.json" ]] \
    && grep -q 'lanyard_agent' "${la_install}/manifest/backend.json"; then
    pass "install-agent-runtime wraps LA product tarball as company-brain-backend"
  else
    fail "LA product wrap install failed (rc=${rc_la})"
    echo "${out_la}" | sed 's/^/    /' | tail -n 40
  fi
else
  echo "  SKIP  LA product wrap functional (node/pnpm not on host PATH)"
fi

# --- README documents entrypoint contract (lp-b7w AC) ------------------------
if grep -Eq 'vault not ready|VAULT_ROOT|timeout' "${README}" \
  && grep -Eq 'non-zero|foreground|exec' "${README}" \
  && grep -Eq 'no package|install-on-boot|§4.3|4.3' "${README}"; then
  pass "README documents vault wait + gateway foreground + no install-on-boot"
else
  fail "README missing entrypoint contract documentation"
fi
if grep -q 'lp-vqr0.12' "${README}" \
  && grep -q 'LANYARD_ENTRY_POST_MOUNT_WRITABLE_SEC' "${README}" \
  && grep -Eq 'Default is not 1200|not `1200`|not 1200' "${README}" \
  && grep -q 'lp-puzc' "${README}"; then
  pass "README documents T8 post-mount wait is not a boot gate"
else
  fail "README missing lp-vqr0.12 / T8 post-mount writable contract"
fi

echo
if [[ "${FAILED}" -ne 0 ]]; then
  echo "RESULT: ${FAILED} failure(s)"
  exit 1
fi
echo "RESULT: all entrypoint/image contract smoke checks passed (lp-b7w / lp-kng.9 / lp-vqr0.12)"
exit 0
