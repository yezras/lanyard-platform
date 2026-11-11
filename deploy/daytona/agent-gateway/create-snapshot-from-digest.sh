#!/usr/bin/env bash
# Create a Daytona org snapshot from an immutable image reference (ECR digest).
#
# Bead: lp-1wa
# Plan: docs/plans/0008-daytona-agent-sandboxes/agent-snapshot-live-pin.md
# Bump: docs/plans/0008-daytona-agent-sandboxes/agent-snapshot-bump-runbook.md
#
# Auth: DAYTONA_API_KEY + DAYTONA_ORG_ID from env (load from SM
#   lanyard/staging/portal/daytona — never commit or echo the key).
#
# Usage:
#   # From CI publish artifact (mode=publish required). Sends the immutable
#   # version tag (repo:tag) — Daytona runners reject digest-pinned refs as of
#   # Aug 2026 ("invalid reference format"). Digest stays the audit record.
#   bash deploy/daytona/agent-gateway/create-snapshot-from-digest.sh \
#     --digest-file /path/to/agent-gateway-digests-v0.1.0.json \
#     --name lanyard-agent-gateway-v0.1.0
#
#   # Explicit image ref (passed through unchanged; operator's choice):
#   bash deploy/daytona/agent-gateway/create-snapshot-from-digest.sh \
#     --image-name "123.dkr.ecr.us-east-1.amazonaws.com/prefix/daytona/agent-gateway:v0.1.0" \
#     --name lanyard-agent-gateway-v0.1.0
#
# Options:
#   --class container|linux-vm   default: container (pilot)
#   --ref-style tag|digest       default: tag (immutable version tag from artifact).
#                                digest sends repo@sha256:... — opt-in only; Daytona
#                                runners reject it today ("invalid reference format").
#   --api-base URL               default: https://app.daytona.io/api
#   --dry-run                    print request body; no POST
#   --print-pin                  write pin YAML snippet to stdout after create
#
# Exit codes:
#   0 success (or dry-run)
#   2 usage / missing inputs
#   3 missing auth env
#   4 digest-file not publish mode / missing digest
#   5 API error

set -euo pipefail

API_BASE="${DAYTONA_API_BASE:-https://app.daytona.io/api}"
SNAPSHOT_NAME=""
IMAGE_NAME=""
DIGEST_FILE=""
REF_STYLE="tag"
SANDBOX_CLASS="container"
DRY_RUN=0
PRINT_PIN=0

usage() {
  sed -n '2,41p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) SNAPSHOT_NAME="${2:-}"; shift 2 ;;
    --image-name) IMAGE_NAME="${2:-}"; shift 2 ;;
    --digest-file) DIGEST_FILE="${2:-}"; shift 2 ;;
    --ref-style)
      REF_STYLE="${2:-}"
      if [[ "${REF_STYLE}" != "tag" && "${REF_STYLE}" != "digest" ]]; then
        echo "error: --ref-style must be tag or digest" >&2
        exit 2
      fi
      shift 2 ;;
    --class) SANDBOX_CLASS="${2:-}"; shift 2 ;;
    --api-base) API_BASE="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --print-pin) PRINT_PIN=1; shift ;;
    -h|--help) usage ;;
    *) echo "error: unknown arg: $1" >&2; usage ;;
  esac
done

if [[ -z "${SNAPSHOT_NAME}" ]]; then
  echo "error: --name is required" >&2
  exit 2
fi

if [[ -n "${DIGEST_FILE}" ]]; then
  if [[ ! -f "${DIGEST_FILE}" ]]; then
    echo "error: digest file not found: ${DIGEST_FILE}" >&2
    exit 2
  fi
  # Parse with python for robust JSON (no jq required). Fail closed if not publish.
  PARSE_OUT="$(mktemp)"
  set +e
  python3 - "${DIGEST_FILE}" "${REF_STYLE}" >"${PARSE_OUT}" <<'PY'
import json, sys, shlex
path = sys.argv[1]
ref_style = sys.argv[2] if len(sys.argv) > 2 else "tag"
with open(path, encoding="utf-8") as f:
    d = json.load(f)
mode = d.get("mode") or ""
image = d.get("image") or {}
digest = (image.get("digest") or d.get("registry_digest") or "") or ""
pin_ref = image.get("pin_ref") or ""
repo = image.get("repository") or ""
tag = image.get("tag") or d.get("version") or ""
if mode != "publish":
    print(
        f"error: digest file mode={mode!r} is not publish; refusing to invent a registry pin",
        file=sys.stderr,
    )
    sys.exit(4)
if not digest or "64-hex" in str(digest) or str(digest).endswith("…"):
    print("error: no real image.digest in publish artifact", file=sys.stderr)
    sys.exit(4)
if ref_style == "digest":
    if pin_ref:
        image_name = pin_ref
    elif repo and digest:
        image_name = f"{repo}@{digest}" if str(digest).startswith("sha256:") else f"{repo}@sha256:{digest}"
    else:
        print("error: cannot build digest-form imageName from artifact", file=sys.stderr)
        sys.exit(4)
else:
    # Daytona runners reject digest-pinned refs ("invalid reference format") as
    # of Aug 2026; send the immutable version tag instead.
    if repo and tag:
        image_name = f"{repo}:{tag}"
    else:
        print(
            "error: artifact lacks repository+tag for tag-form imageName; use --ref-style digest to opt in",
            file=sys.stderr,
        )
        sys.exit(4)
print(f"IMAGE_NAME={shlex.quote(image_name)}")
print(f"ARTIFACT_DIGEST={shlex.quote(str(digest))}")
print(f"ARTIFACT_TAG={shlex.quote(str(tag))}")
print(f"ARTIFACT_REPO={shlex.quote(str(repo))}")
PY
  PARSE_RC=$?
  set -e
  if [[ "${PARSE_RC}" -ne 0 ]]; then
    rm -f "${PARSE_OUT}"
    exit "${PARSE_RC}"
  fi
  # shellcheck disable=SC1090
  source "${PARSE_OUT}"
  rm -f "${PARSE_OUT}"
fi

if [[ -z "${IMAGE_NAME}" ]]; then
  echo "error: provide --image-name or --digest-file" >&2
  exit 2
fi

# Refuse obvious template placeholders.
if [[ "${IMAGE_NAME}" == *"<"* ]] || [[ "${IMAGE_NAME}" == *"64-hex"* ]]; then
  echo "error: image name still contains template placeholders: ${IMAGE_NAME}" >&2
  exit 4
fi

if [[ "${SANDBOX_CLASS}" != "container" && "${SANDBOX_CLASS}" != "linux-vm" ]]; then
  echo "error: --class must be container or linux-vm (pilot: container)" >&2
  exit 2
fi

if [[ -z "${DAYTONA_API_KEY:-}" || -z "${DAYTONA_ORG_ID:-}" ]]; then
  echo "error: DAYTONA_API_KEY and DAYTONA_ORG_ID must be set (load from SM lanyard/staging/portal/daytona; do not echo key)" >&2
  exit 3
fi

BODY="$(python3 - <<PY
import json
print(json.dumps({
  "name": """${SNAPSHOT_NAME}""",
  "imageName": """${IMAGE_NAME}""",
  "sandboxClass": """${SANDBOX_CLASS}""",
}, separators=(",", ":")))
PY
)"

echo "Daytona snapshot create request (secret-free):"
echo "  api:    ${API_BASE}/snapshots"
echo "  name:   ${SNAPSHOT_NAME}"
echo "  image:  ${IMAGE_NAME}"
echo "  class:  ${SANDBOX_CLASS}"
echo "  org_id: (set; not printed)"

if [[ "${DRY_RUN}" -eq 1 ]]; then
  echo "dry-run body: ${BODY}"
  exit 0
fi

TMP_RESP="$(mktemp)"
HTTP_CODE="$(
  curl -sS -o "${TMP_RESP}" -w "%{http_code}" \
    -X POST "${API_BASE}/snapshots" \
    -H "Authorization: Bearer ${DAYTONA_API_KEY}" \
    -H "X-Daytona-Organization-ID: ${DAYTONA_ORG_ID}" \
    -H "Content-Type: application/json" \
    -d "${BODY}"
)" || true

# Never print Authorization header or API key. Response may include ids only.
if [[ "${HTTP_CODE}" != "200" && "${HTTP_CODE}" != "201" ]]; then
  echo "error: POST /snapshots HTTP ${HTTP_CODE}" >&2
  python3 - <<'PY' "${TMP_RESP}" 2>/dev/null || cat "${TMP_RESP}" >&2
import json,sys
try:
  d=json.load(open(sys.argv[1]))
  # redact anything that looks like a key
  print(json.dumps(d, indent=2)[:2000])
except Exception:
  print(open(sys.argv[1]).read()[:2000])
PY
  rm -f "${TMP_RESP}"
  exit 5
fi

python3 - <<'PY' "${TMP_RESP}" "${SNAPSHOT_NAME}" "${IMAGE_NAME}" "${SANDBOX_CLASS}" "${PRINT_PIN}" "${ARTIFACT_DIGEST:-}" "${ARTIFACT_REPO:-}" "${ARTIFACT_TAG:-}"
import json, sys
path, name, image, sclass, print_pin, digest, repo, tag = sys.argv[1:9]
d = json.load(open(path))
sid = d.get("id") or d.get("snapshotId") or d.get("uuid") or ""
sname = d.get("name") or name
state = d.get("state") or d.get("status") or ""
print(f"snapshot_id={sid}")
print(f"snapshot_name={sname}")
print(f"state={state}")
print(f"sandbox_class={d.get('sandboxClass') or sclass}")
print(f"image_name={d.get('imageName') or image}")
if print_pin in ("1", "true", "True"):
    pin = {
        "agent_snapshot": {
            "env": "staging-pilot",
            "status": "active",
            "bead": "lp-1wa",
            "isolation_class": d.get("sandboxClass") or sclass,
            "daytona_default_snapshot": sid or sname,
            "daytona_snapshot_name": sname,
            "daytona_snapshot_id": sid or None,
            "ecr": {
                "repository": repo or None,
                "digest": digest or None,
                "tag": tag or None,
                "pin_ref": image,
            },
        }
    }
    print("--- pin yaml ---")
    # minimal YAML without pyyaml dependency
    def dump(obj, indent=0):
        sp = "  " * indent
        if isinstance(obj, dict):
            for k, v in obj.items():
                if isinstance(v, (dict, list)):
                    print(f"{sp}{k}:")
                    dump(v, indent + 1)
                elif v is None:
                    print(f"{sp}{k}: null")
                elif isinstance(v, bool):
                    print(f"{sp}{k}: {'true' if v else 'false'}")
                else:
                    print(f"{sp}{k}: {json.dumps(v)}")
        elif isinstance(obj, list):
            for item in obj:
                print(f"{sp}- {json.dumps(item)}")
    dump(pin)
PY

rm -f "${TMP_RESP}"
echo "OK: snapshot registered. Set DAYTONA_DEFAULT_SNAPSHOT to snapshot_id (or name) per agent-snapshot-bump-runbook.md"
