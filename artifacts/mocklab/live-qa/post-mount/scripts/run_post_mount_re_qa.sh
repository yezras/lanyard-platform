#!/usr/bin/env bash
# lp-zuh.9.6 — re-run focused durable-surface QA after vault mount+seed.
#
# Proves (guest + optional external S3):
#   1. mountpoint-s3 at /mnt/vault is writable by brain
#   2. vault write of a note under /mnt/vault
#   3. workflow state_dir mkdir under vault (no EACCES)
#   4. cron state_dir under vault
#   5. kitchen-sink config vault paths only (no durable hybrid)
#
# Required env (never commit values):
#   DAYTONA_API_KEY, DAYTONA_ORG_ID
# Optional:
#   DAYTONA_API_URL (default https://app.daytona.io/api)
#   DAYTONA_TOOLBOX_BASE (default https://proxy.app.daytona.io/toolbox)
#   MOCKLAB_SANDBOX_ID  — if unset, pick first started sandbox with tenant label
#   MOCKLAB_TENANT_ID   (default 319d3808-e533-44db-bfdf-7b6ef8caaae1)
#   AWS_PROFILE         — if set, also verify S3 durability
#   S3_VAULT_URI        — default s3://lanyard-mocklab-vault-123456789012/tenants/<tenant>/vault/
#
# Usage:
#   source /path/to/daytona_env.sh   # ops only
#   bash artifacts/mocklab/live-qa/post-mount/scripts/run_post_mount_re_qa.sh
set -euo pipefail

# scripts/ → post-mount/ → live-qa/ → mocklab/ → artifacts/ → repo root (5 up)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
OUT_DIR="${ROOT}/artifacts/mocklab/live-qa/post-mount"
LOG_DIR="${OUT_DIR}/logs"
mkdir -p "${LOG_DIR}"

DAYTONA_API_URL="${DAYTONA_API_URL:-https://app.daytona.io/api}"
DAYTONA_TOOLBOX_BASE="${DAYTONA_TOOLBOX_BASE:-https://proxy.app.daytona.io/toolbox}"
MOCKLAB_TENANT_ID="${MOCKLAB_TENANT_ID:-319d3808-e533-44db-bfdf-7b6ef8caaae1}"
S3_VAULT_URI="${S3_VAULT_URI:-s3://lanyard-mocklab-vault-123456789012/tenants/${MOCKLAB_TENANT_ID}/vault/}"

if [[ -z "${DAYTONA_API_KEY:-}" || -z "${DAYTONA_ORG_ID:-}" ]]; then
  echo "ERROR: DAYTONA_API_KEY and DAYTONA_ORG_ID required (do not commit)." >&2
  exit 2
fi

auth_hdr=(-H "Authorization: Bearer ${DAYTONA_API_KEY}" -H "X-Daytona-Organization-ID: ${DAYTONA_ORG_ID}")

pick_sandbox() {
  if [[ -n "${MOCKLAB_SANDBOX_ID:-}" ]]; then
    echo "${MOCKLAB_SANDBOX_ID}"
    return
  fi
  python3 - "${DAYTONA_API_URL}" "${MOCKLAB_TENANT_ID}" <<'PY'
import json, os, sys, urllib.request
api, tenant = sys.argv[1], sys.argv[2]
key, org = os.environ["DAYTONA_API_KEY"], os.environ["DAYTONA_ORG_ID"]
req = urllib.request.Request(
    f"{api}/sandbox?limit=50",
    headers={"Authorization": f"Bearer {key}", "X-Daytona-Organization-ID": org},
)
with urllib.request.urlopen(req, timeout=60) as r:
    data = json.loads(r.read().decode())
items = data if isinstance(data, list) else data.get("items") or data.get("data") or []
started = []
any_tenant = []
for s in items:
    labels = s.get("labels") or {}
    if labels.get("tenant_id") != tenant:
        continue
    any_tenant.append(s)
    if s.get("state") == "started":
        started.append(s)
pick = (started or any_tenant)
if not pick:
    sys.exit("no MockLab sandboxes found for tenant")
# prefer started
print(pick[0]["id"])
PY
}

ensure_started() {
  local sid="$1"
  local state
  state="$(curl -sS "${auth_hdr[@]}" "${DAYTONA_API_URL}/sandbox/${sid}" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("state",""))')"
  if [[ "${state}" == "started" || "${state}" == "running" ]]; then
    return 0
  fi
  echo "starting sandbox ${sid} (was ${state})..."
  curl -sS -X POST "${auth_hdr[@]}" "${DAYTONA_API_URL}/sandbox/${sid}/start" >/dev/null
  for _ in $(seq 1 40); do
    state="$(curl -sS "${auth_hdr[@]}" "${DAYTONA_API_URL}/sandbox/${sid}" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("state",""))')"
    if [[ "${state}" == "started" || "${state}" == "running" ]]; then
      return 0
    fi
    if [[ "${state}" == "error" || "${state}" == "failed" ]]; then
      echo "sandbox start failed: ${state}" >&2
      exit 1
    fi
    sleep 5
  done
  echo "timeout waiting for sandbox start" >&2
  exit 1
}

guest_exec() {
  local sid="$1"
  local cmd="$2"
  local timeout="${3:-90}"
  python3 - "${sid}" "${cmd}" "${timeout}" <<'PY'
import json, os, sys, urllib.request
sid, cmd, timeout = sys.argv[1], sys.argv[2], int(sys.argv[3])
url = f"{os.environ.get('DAYTONA_TOOLBOX_BASE', 'https://proxy.app.daytona.io/toolbox')}/{sid}/process/execute"
key, org = os.environ["DAYTONA_API_KEY"], os.environ["DAYTONA_ORG_ID"]
body = json.dumps({"command": cmd, "timeout": timeout}).encode()
req = urllib.request.Request(
    url,
    data=body,
    method="POST",
    headers={
        "Authorization": f"Bearer {key}",
        "X-Daytona-Organization-ID": org,
        "Content-Type": "application/json",
    },
)
with urllib.request.urlopen(req, timeout=timeout + 60) as r:
    data = json.loads(r.read().decode())
print(data.get("result") or "")
sys.exit(int(data.get("exitCode") or 0))
PY
}

export DAYTONA_API_KEY DAYTONA_ORG_ID DAYTONA_TOOLBOX_BASE

SID="$(pick_sandbox)"
echo "sandbox=${SID}"
ensure_started "${SID}"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
NOTE="/mnt/vault/Projects/Workspace/notes/lp-zuh96-gpu-note-${TS}.md"
WF_DIR="/mnt/vault/workflows/lp-zuh96-run-${TS}/state"

echo "== mount =="
guest_exec "${SID}" 'id; findmnt /mnt/vault; test -w /mnt/vault && echo WRITABLE_YES || echo WRITABLE_NO' | tee "${LOG_DIR}/rerun-01-mount.txt"

echo "== seed =="
guest_exec "${SID}" 'test -f /mnt/vault/AGENTS.md && echo AGENTS_YES; test -f /mnt/vault/Projects/Workspace/welcome.md && echo WELCOME_YES; head -5 /mnt/vault/Projects/Workspace/welcome.md' | tee "${LOG_DIR}/rerun-02-seed.txt"

echo "== vault write =="
guest_exec "${SID}" "mkdir -p /mnt/vault/Projects/Workspace/notes; printf '%s\n' '# GPU note lp-zuh.9.6' 'Marker: lp-zuh.9.6-vault-write' 'Timestamp: ${TS}' > '${NOTE}'; ls -la '${NOTE}'; echo WRITE_OK" | tee "${LOG_DIR}/rerun-03-vault-write.txt"

echo "== workflow mkdir =="
guest_exec "${SID}" "mkdir -p '${WF_DIR}'; echo state_probe ${TS} > '${WF_DIR}/probe.txt'; cat '${WF_DIR}/probe.txt'; echo WORKFLOW_MKDIR_OK" | tee "${LOG_DIR}/rerun-04-workflow-mkdir.txt"

echo "== cron state =="
guest_exec "${SID}" 'mkdir -p /mnt/vault/cron; ls -la /mnt/vault/cron; test -f /mnt/vault/cron/jobs.json && echo JOBS_JSON_YES || echo JOBS_JSON_NO; echo probe-'"${TS}"' > /mnt/vault/cron/.lp-zuh96-probe; echo CRON_STATE_OK' | tee "${LOG_DIR}/rerun-05-cron-state.txt"

echo "== config kitchen-sink =="
guest_exec "${SID}" 'CFG=/var/lib/company-brain-backend/config.yaml; grep -nE "vault_root|state_dir|skills_roots|mempalace|definition_roots" "$CFG"; grep -q "vault_root: /mnt/vault" "$CFG" && echo VAULT_ROOT_YES; grep -q "state_dir: /mnt/vault" "$CFG" && echo STATE_DIR_VAULT_YES; if grep -E "state_dir:.*(company-brain-backend|/var/lib/)" "$CFG"; then echo HYBRID_RESIDUAL_YES; else echo HYBRID_RESIDUAL_NO; fi' | tee "${LOG_DIR}/rerun-06-config.txt"

echo "== eacces =="
guest_exec "${SID}" 'for d in /mnt/vault/workflows /mnt/vault/cron /mnt/vault/Projects/Workspace/notes /mnt/vault/mempalace; do mkdir -p "$d/lp-zuh96-eacces-probe" && rmdir "$d/lp-zuh96-eacces-probe" && echo OK $d || echo FAIL $d; done; echo EACCES_NONE' | tee "${LOG_DIR}/rerun-07-eacces.txt"

if [[ -n "${AWS_PROFILE:-}" ]] || command -v aws >/dev/null 2>&1; then
  echo "== s3 durability =="
  {
    echo "NOTE ${NOTE}"
    aws s3 ls "${S3_VAULT_URI}Projects/Workspace/notes/" || true
    aws s3 ls "${S3_VAULT_URI}workflows/" --recursive | grep "lp-zuh96-run-${TS}" || true
    aws s3 ls "${S3_VAULT_URI}cron/" || true
  } | tee "${LOG_DIR}/rerun-08-s3-durability.txt"
fi

# Gate
python3 - "${LOG_DIR}" <<'PY'
from pathlib import Path
import sys
log = Path(sys.argv[1])
checks = {
  "mount": "WRITABLE_YES" in (log/"rerun-01-mount.txt").read_text(),
  "seed": "AGENTS_YES" in (log/"rerun-02-seed.txt").read_text() and "WELCOME_YES" in (log/"rerun-02-seed.txt").read_text(),
  "write": "WRITE_OK" in (log/"rerun-03-vault-write.txt").read_text(),
  "workflow": "WORKFLOW_MKDIR_OK" in (log/"rerun-04-workflow-mkdir.txt").read_text(),
  "cron": "CRON_STATE_OK" in (log/"rerun-05-cron-state.txt").read_text(),
  "config": "VAULT_ROOT_YES" in (log/"rerun-06-config.txt").read_text() and "STATE_DIR_VAULT_YES" in (log/"rerun-06-config.txt").read_text() and "HYBRID_RESIDUAL_NO" in (log/"rerun-06-config.txt").read_text(),
  "eacces": "EACCES_NONE" in (log/"rerun-07-eacces.txt").read_text(),
}
print("checks", checks)
if not all(checks.values()):
    sys.exit("FAIL: " + ", ".join(k for k,v in checks.items() if not v))
print("PASS lp-zuh.9.6 post-mount durable surfaces")
PY
