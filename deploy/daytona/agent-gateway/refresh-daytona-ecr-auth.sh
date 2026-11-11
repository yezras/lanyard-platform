#!/usr/bin/env bash
# Refresh stored Daytona org ECR registry credentials (12h expiring AWS tokens).
#
# Bead: lp-j2wq
# Runbook: docs/plans/0008-daytona-agent-sandboxes/agent-snapshot-bump-runbook.md
#
# The Daytona org stores registry entries named aws-ecr-us-east-1 whose passwords
# are AWS ECR tokens that expire after 12h. Expired tokens fail snapshot creation
# with: denied: Your authorization token has expired
# This script mints a fresh token and PATCHes every entry whose URL matches the
# target ECR host. Duplicate entries (same URL, different ids) are expected
# inventory and are all refreshed, never deleted.
#
# Auth inputs:
#   DAYTONA_API_KEY + DAYTONA_ORG_ID from env, or loaded from Secrets Manager
#     with --from-sm (secret name lanyard/staging/portal/daytona).
#   AWS credentials for `aws ecr get-login-password`.
#
# Usage:
#   bash deploy/daytona/agent-gateway/refresh-daytona-ecr-auth.sh --from-sm          # dry-run (default)
#   bash deploy/daytona/agent-gateway/refresh-daytona-ecr-auth.sh --from-sm --apply  # live PATCH
#
# Options:
#   --apply            perform live PATCHes (default is dry-run: no PATCH sent)
#   --from-sm          load DAYTONA_API_KEY / DAYTONA_ORG_ID from Secrets Manager
#   --secret-name NAME default: lanyard/staging/portal/daytona
#   --region REGION    AWS region for ECR token mint (default: us-east-1)
#   --ecr-host HOST    ECR host to match (default: 123456789012.dkr.ecr.us-east-1.amazonaws.com)
#   --api-base URL     default: https://app.daytona.io/api
#   -h|--help          show this help
#
# Exit codes:
#   0 success (or dry-run)
#   2 usage error
#   3 missing auth
#   4 no matching registry entries found
#   5 API / AWS error

set -euo pipefail

API_BASE="${DAYTONA_API_BASE:-https://app.daytona.io/api}"
SECRET_NAME="lanyard/staging/portal/daytona"
REGION="us-east-1"
ECR_HOST="123456789012.dkr.ecr.us-east-1.amazonaws.com"
FROM_SM=0
APPLY=0

usage() {
  sed -n '2,34p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --from-sm) FROM_SM=1; shift ;;
    --secret-name) SECRET_NAME="${2:-}"; shift 2 ;;
    --region) REGION="${2:-}"; shift 2 ;;
    --ecr-host) ECR_HOST="${2:-}"; shift 2 ;;
    --api-base) API_BASE="${2:-}"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "error: unknown arg: $1" >&2; usage ;;
  esac
done

if [[ -z "${DAYTONA_API_KEY:-}" || -z "${DAYTONA_ORG_ID:-}" ]]; then
  if [[ "${FROM_SM}" -eq 1 ]]; then
    # Values are eval'd into env only; never printed. Secret payload stays local.
    eval "$(python3 - "${SECRET_NAME}" <<'PY'
import json, shlex, subprocess, sys
raw = subprocess.run(
    ["aws", "secretsmanager", "get-secret-value", "--secret-id", sys.argv[1],
     "--query", "SecretString", "--output", "text"],
    check=True, capture_output=True, text=True).stdout.strip()
d = json.loads(raw)
print(f"DAYTONA_API_KEY={shlex.quote(d['DAYTONA_API_KEY'])}")
print(f"DAYTONA_ORG_ID={shlex.quote(d['DAYTONA_ORG_ID'])}")
PY
)"
  else
    echo "error: DAYTONA_API_KEY / DAYTONA_ORG_ID not set; use --from-sm or export them" >&2
    exit 3
  fi
fi

echo "[info] minting fresh ECR token for host ${ECR_HOST} (region ${REGION})"
ECR_PASSWORD="$(aws ecr get-login-password --region "${REGION}")"

LIST_JSON="$(curl -fsS \
  -H "Authorization: Bearer ${DAYTONA_API_KEY}" \
  -H "X-Daytona-Organization-ID: ${DAYTONA_ORG_ID}" \
  "${API_BASE}/docker-registry")"

MATCHED="$(python3 - "${ECR_HOST}" "${LIST_JSON}" <<'PY'
import json, sys
host, raw = sys.argv[1], sys.argv[2]
entries = json.loads(raw)
if isinstance(entries, dict):
    entries = entries.get("items") or entries.get("data") or []
for e in entries:
    url = str(e.get("url") or "")
    if host in url:
        print("\t".join([
            str(e.get("id") or ""),
            str(e.get("name") or ""),
            url,
            str(e.get("username") or ""),
            str(e.get("project") or ""),
        ]))
PY
)"

if [[ -z "${MATCHED}" ]]; then
  echo "error: no docker-registry entries match host ${ECR_HOST}" >&2
  exit 4
fi

RC=0
COUNT=0
while IFS=$'\t' read -r id name url username project; do
  COUNT=$((COUNT + 1))
  if [[ "${APPLY}" -eq 1 ]]; then
    BODY="$(python3 -c 'import json, sys; print(json.dumps({
        "name": sys.argv[1], "url": sys.argv[2], "username": sys.argv[3],
        "password": sys.stdin.read().rstrip("\n"), "project": sys.argv[4]}))' \
      "${name}" "${url}" "${username}" "${project}" <<<"${ECR_PASSWORD}")"
    if curl -fsS -o /dev/null -X PATCH \
      -H "Authorization: Bearer ${DAYTONA_API_KEY}" \
      -H "X-Daytona-Organization-ID: ${DAYTONA_ORG_ID}" \
      -H "Content-Type: application/json" \
      -d "${BODY}" "${API_BASE}/docker-registry/${id}"; then
      echo "[ok] PATCHed id=${id} name=${name}"
    else
      echo "[fail] PATCH id=${id} name=${name}" >&2
      RC=5
    fi
  else
    echo "[dry-run] would PATCH id=${id} name=${name} url=${url} username=${username}"
  fi
done <<<"${MATCHED}"

PLURAL="entries"
[[ "${COUNT}" -eq 1 ]] && PLURAL="entry"
if [[ "${APPLY}" -eq 1 ]]; then
  echo "[done] refreshed ${COUNT} registry ${PLURAL} for ${ECR_HOST}"
else
  echo "[dry-run] matched ${COUNT} ${PLURAL}; re-run with --apply to refresh"
fi
exit "${RC}"
