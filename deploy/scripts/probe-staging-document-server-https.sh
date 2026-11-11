#!/usr/bin/env bash
# Live probe: staging Document Server HTTP/HTTPS health + api.js (lp-zuh.12.2 / lp-zuh.12.9).
# No AWS apply. No JWT / session secrets. Prints JSON summary to stdout.
#
# Usage:
#   bash deploy/scripts/probe-staging-document-server-https.sh
#   bash deploy/scripts/probe-staging-document-server-https.sh --host d3sqcebajd6ueb.cloudfront.net --scheme https
#   bash deploy/scripts/probe-staging-document-server-https.sh --host docs.staging.example.com --scheme https
#   bash deploy/scripts/probe-staging-document-server-https.sh --host <alb-dns> --out artifacts/.../logs/curl-probe.json
set -euo pipefail

# Default: CloudFront HTTPS edge (lp-zuh.12.9). Override with --host / DS_HOST for ALB or custom docs.
HOST="${DS_HOST:-d3sqcebajd6ueb.cloudfront.net}"
SCHEME=""
OUT=""
TIMEOUT_HTTP="${TIMEOUT_HTTP:-15}"
TIMEOUT_HTTPS="${TIMEOUT_HTTPS:-15}"
BEAD="${PROBE_BEAD:-lp-zuh.12.9}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --scheme) SCHEME="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    -h|--help)
      sed -n '1,12p' "$0"
      exit 0
      ;;
    *)
      echo "unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

probe() {
  local url="$1"
  local timeout="$2"
  local code
  code="$(curl -skS -o /dev/null -w '%{http_code}' --max-time "$timeout" "$url" 2>/dev/null || true)"
  if [[ ! "$code" =~ ^[0-9]+$ ]]; then
    code="000"
  fi
  # curl sometimes returns empty on hard fail
  [[ -n "$code" ]] || code="000"
  printf '%s' "$code"
}

probe_api_meta() {
  local url="$1"
  local timeout="$2"
  local meta
  meta="$(curl -skS -o /dev/null -w '%{http_code}|%{size_download}|%{content_type}' --max-time "$timeout" "$url" 2>/dev/null || true)"
  if [[ -z "$meta" || "$meta" != *"|"* ]]; then
    meta="000|0|"
  fi
  printf '%s' "$meta"
}

HTTP_HEALTH="$(probe "http://${HOST}/healthcheck" "$TIMEOUT_HTTP")"
HTTP_API_META="$(probe_api_meta "http://${HOST}/web-apps/apps/api/documents/api.js" "$TIMEOUT_HTTP")"
IFS='|' read -r HTTP_API_CODE HTTP_API_BYTES HTTP_API_CTYPE <<< "$HTTP_API_META"

HTTPS_HEALTH="$(probe "https://${HOST}/healthcheck" "$TIMEOUT_HTTPS")"
HTTPS_API_META="$(probe_api_meta "https://${HOST}/web-apps/apps/api/documents/api.js" "$TIMEOUT_HTTPS")"
IFS='|' read -r HTTPS_API_CODE HTTPS_API_BYTES HTTPS_API_CTYPE <<< "$HTTPS_API_META"

SCHEME_EFFECTIVE="${SCHEME:-}"
if [[ -z "$SCHEME_EFFECTIVE" ]]; then
  if [[ "$HTTPS_HEALTH" == "200" && "$HTTPS_API_CODE" == "200" ]]; then
    SCHEME_EFFECTIVE="https"
  elif [[ "$HTTP_HEALTH" == "200" && "$HTTP_API_CODE" == "200" ]]; then
    SCHEME_EFFECTIVE="http"
  else
    SCHEME_EFFECTIVE="none"
  fi
fi

HTTPS_OK=false
if [[ "$HTTPS_HEALTH" == "200" && "$HTTPS_API_CODE" == "200" ]]; then
  HTTPS_OK=true
fi
HTTP_OK=false
if [[ "$HTTP_HEALTH" == "200" && "$HTTP_API_CODE" == "200" ]]; then
  HTTP_OK=true
fi

if $HTTPS_OK; then
  VERDICT="HTTPS_GO"
  EDITOR_BLOCKER=""
elif $HTTP_OK; then
  VERDICT="HTTP_GO_HTTPS_BLOCKED"
  EDITOR_BLOCKER="https_required — SPA rejects non-loopback http Document Server origins"
else
  VERDICT="DS_UNREACHABLE"
  EDITOR_BLOCKER="Document Server health/api.js not reachable"
fi

# shellcheck disable=SC2016
python3 - "$HOST" "$HTTP_HEALTH" "$HTTP_API_CODE" "$HTTP_API_BYTES" "$HTTP_API_CTYPE" \
  "$HTTPS_HEALTH" "$HTTPS_API_CODE" "$HTTPS_API_BYTES" "$HTTPS_API_CTYPE" \
  "$SCHEME_EFFECTIVE" "$VERDICT" "$EDITOR_BLOCKER" "$HTTPS_OK" "$OUT" "$BEAD" <<'PY'
import json, sys, datetime
(
  host, http_h, http_a, http_b, http_ct,
  https_h, https_a, https_b, https_ct,
  scheme, verdict, blocker, https_ok, out, bead,
) = sys.argv[1:]

def i(x):
  try:
    return int(x)
  except Exception:
    return 0

report = {
  "probed_at_utc": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "bead": bead,
  "ds_host": host,
  "preferred_scheme": scheme,
  "http": {
    "healthcheck_status": i(http_h),
    "api_js_status": i(http_a),
    "api_js_bytes": i(http_b),
    "api_js_content_type": http_ct,
  },
  "https": {
    "healthcheck_status": i(https_h),
    "api_js_status": i(https_a),
    "api_js_bytes": i(https_b),
    "api_js_content_type": https_ct,
    # bash exports true/false lowercase
    "ok": https_ok.lower() in ("true", "1", "yes"),
  },
  "verdict": verdict,
  "editor_go_claimed": False,
  "editor_blocker": blocker or None,
  "bff_allowlist_note": (
    "BFF_OFFICE_DOCUMENT_SERVER_HOSTS is hostname-only (no scheme). "
    "On HTTPS cutover, compose injects <cf-domain|public-hostname>,<alb-dns>."
  ),
  "secrets": "none — probe does not read JWT/session values",
}
text = json.dumps(report, indent=2) + "\n"
sys.stdout.write(text)
if out:
  open(out, "w", encoding="utf-8").write(text)
PY

# Non-zero exit when caller demanded https and it failed
if [[ "${SCHEME}" == "https" ]] && ! $HTTPS_OK; then
  echo "[probe-staging-document-server-https] HTTPS required but not healthy" >&2
  exit 1
fi
