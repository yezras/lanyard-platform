#!/usr/bin/env bash
# Render Omnibox Mode A runtime egress allowlist (cbd-o9s.12 / phase 6).
#
# Merges:
#   1) Static processor hosts (scripts/omnibox/processor-hosts.static.list)
#   2) Tenant model / extra hosts (env or CLI — from private tfvars on host)
#
# Writes host-generated fragment under:
#   /etc/company-brain/omnibox/runtime/egress.yaml   (default on host)
#
# Never embeds API keys, tokens, or query strings. Metadata + private ranges
# are always listed under network.block and rejected if supplied as allow hosts.
#
# Usage (from repo or installed tree):
#   bash scripts/omnibox/render-egress-allowlist.sh --dry-run
#   bash scripts/omnibox/render-egress-allowlist.sh \
#     --processor-ids model-anthropic,lanyard-portal-relay \
#     --model-host api.anthropic.com \
#     --relay-host relay.example.com \
#     --output-dir /tmp/omnibox-runtime-dry
#
# Env (optional; tenant inject / operator):
#   APPROVED_PROCESSOR_IDS   comma-separated catalog IDs
#   OMNIBOX_MODEL_HOSTS      comma-separated hostnames
#   OMNIBOX_EXTRA_HOSTS      comma-separated hostnames
#   OMNIBOX_RELAY_HOST       relay FQDN only (no URL, no path, no query)
#   RELAY_WSS_URL            optional; hostname extracted, query stripped
#   OMNIBOX_EGRESS_OUTPUT_DIR  default /etc/company-brain/omnibox/runtime
#
# See: references/approved-data-processors.md, phase-6-egress-render.md
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
STATIC_LIST="${OMNIBOX_PROCESSOR_HOSTS_LIST:-$SCRIPT_DIR/processor-hosts.static.list}"
OUTPUT_DIR="${OMNIBOX_EGRESS_OUTPUT_DIR:-/etc/company-brain/omnibox/runtime}"
DRY_RUN=0
OUTPUT_FILE_NAME="egress.yaml"

# Always blocked — mirrored into runtime output; never allowlisted.
# Keep in sync with scripts/omnibox/{admin,contributor}.yaml network.block.
ALWAYS_BLOCK=(
  "169.254.169.254/32" # IMDS
  "169.254.0.0/16"     # link-local
  "10.0.0.0/8"         # private
  "172.16.0.0/12"      # private
  "192.168.0.0/16"     # private
  "127.0.0.0/8"        # loopback
  "::1/128"
  "fc00::/7"           # unique local
)

# Accumulated allow entries as lines: host|processor_id|source
ALLOW_LINES=()
PROCESSOR_IDS_CSV="${APPROVED_PROCESSOR_IDS:-}"
MODEL_HOSTS_CSV="${OMNIBOX_MODEL_HOSTS:-}"
EXTRA_HOSTS_CSV="${OMNIBOX_EXTRA_HOSTS:-}"
RELAY_HOST="${OMNIBOX_RELAY_HOST:-}"
RELAY_WSS_URL="${RELAY_WSS_URL:-}"
HOSTS_FILE=""
QUIET=0

log() { [ "$QUIET" -eq 1 ] || echo "[render-egress-allowlist] $*" >&2; }
err() { echo "[render-egress-allowlist] ERROR: $*" >&2; }

usage() {
  cat <<EOF
Usage: $0 [options]

  --dry-run                 Write to stdout only (no filesystem output)
  --output-dir PATH         Runtime dir (default: $OUTPUT_DIR)
  --static-list PATH        Static processor host list
  --processor-ids CSV       Catalog IDs to include from static list
  --model-host HOST         Tenant model hostname (repeatable)
  --extra-host HOST         Additional approved hostname (repeatable)
  --relay-host HOST         Portal relay FQDN (no URL/query)
  --hosts-file PATH         Extra hosts file (one host per line, or id host)
  --quiet                   Less stderr chatter
  -h, --help                This help

Dry-run example (no secrets, no /etc write):
  $0 --dry-run --processor-ids model-anthropic --model-host api.anthropic.com
EOF
}

# --- validation helpers -------------------------------------------------------

# Reject strings that look like secrets accidentally passed as "hosts".
looks_like_secret() {
  local s="$1"
  case "$s" in
    sk-*|rk-*|AKIA*|ASIA*|ghp_*|gho_*|xox[baprs]-*|Bearer\ *|Basic\ *) return 0 ;;
  esac
  # key=value or long base64-ish tokens with = are not hostnames
  if [[ "$s" == *'='* ]] && [[ "$s" != *'.'* ]]; then
    return 0
  fi
  if [[ ${#s} -gt 80 ]]; then
    return 0
  fi
  return 1
}

# True if string is an IPv4 address (loose).
is_ipv4() {
  local ip="$1"
  [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

# True if IPv4 falls in blocked/private/metadata ranges.
ipv4_is_blocked() {
  local ip="$1"
  local o1 o2
  o1="${ip%%.*}"
  local rest="${ip#*.}"
  o2="${rest%%.*}"
  case "$o1" in
    10) return 0 ;;
    127) return 0 ;;
    169)
      [ "$o2" = "254" ] && return 0
      ;;
    172)
      if [ "$o2" -ge 16 ] 2>/dev/null && [ "$o2" -le 31 ] 2>/dev/null; then
        return 0
      fi
      ;;
    192)
      [ "$o2" = "168" ] && return 0
      ;;
    0) return 0 ;;
  esac
  return 1
}

# Normalize hostname: strip scheme, path, port, query, userinfo, trailing dots.
normalize_host() {
  local raw="$1"
  local h="$raw"
  # Strip URL schemes
  h="${h#wss://}"
  h="${h#ws://}"
  h="${h#https://}"
  h="${h#http://}"
  # Drop userinfo
  if [[ "$h" == *'@'* ]]; then
    h="${h##*@}"
  fi
  # Drop path / query / fragment
  h="${h%%/*}"
  h="${h%%\?*}"
  h="${h%%#*}"
  # Drop port
  if [[ "$h" == \[*\]* ]]; then
    # IPv6 literal — reject for allowlist simplicity
    echo ""
    return 0
  fi
  if [[ "$h" == *:* ]]; then
    h="${h%%:*}"
  fi
  # Lowercase, trim trailing dots and whitespace
  h="$(printf '%s' "$h" | tr '[:upper:]' '[:lower:]' | sed 's/\.$//' | tr -d '[:space:]')"
  printf '%s' "$h"
}

validate_allow_host() {
  local host="$1"
  if [ -z "$host" ]; then
    err "empty hostname"
    return 1
  fi
  if looks_like_secret "$host"; then
    err "refusing secret-like value as hostname (not logged)"
    return 1
  fi
  # No spaces, no slashes, no query remnants
  if [[ "$host" == *"/"* ]] || [[ "$host" == *"?"* ]] || [[ "$host" == *" "* ]]; then
    err "hostname must not contain path/query/space: $host"
    return 1
  fi
  # Block bare metadata hostnames and blocked IPs
  case "$host" in
    169.254.169.254|metadata|metadata.google.internal)
      err "refusing metadata host in allowlist: $host"
      return 1
      ;;
    localhost|localhost.localdomain)
      err "refusing loopback host in allowlist: $host"
      return 1
      ;;
  esac
  if is_ipv4 "$host"; then
    if ipv4_is_blocked "$host"; then
      err "refusing private/metadata IP in allowlist: $host"
      return 1
    fi
  fi
  # Basic FQDN / hostname shape (letters, digits, dots, hyphens)
  if ! [[ "$host" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]]; then
    err "invalid hostname shape: $host"
    return 1
  fi
  # example.com stays usable for docs; blocking is wrapper's default-deny job.
  # We intentionally do NOT auto-allow example.com from static list.
  return 0
}

allow_add() {
  local host="$1"
  local processor_id="${2:-tenant}"
  local source="${3:-cli}"
  local n
  n="$(normalize_host "$host")"
  if [ -z "$n" ]; then
    err "could not normalize host from input (empty after strip)"
    return 1
  fi
  validate_allow_host "$n" || return 1
  # Dedupe by host
  local line existing_host
  for line in "${ALLOW_LINES[@]+"${ALLOW_LINES[@]}"}"; do
    existing_host="${line%%|*}"
    if [ "$existing_host" = "$n" ]; then
      return 0
    fi
  done
  ALLOW_LINES+=("${n}|${processor_id}|${source}")
}

# --- input loaders ------------------------------------------------------------

load_static_for_ids() {
  local ids_csv="$1"
  if [ ! -f "$STATIC_LIST" ]; then
    err "static list missing: $STATIC_LIST"
    return 1
  fi
  # If no IDs requested, include nothing from static (tenant must pass hosts or IDs).
  # Empty IDs + no other hosts → allowlist empty (default deny still correct).
  if [ -z "$ids_csv" ]; then
    return 0
  fi
  local want
  declare -A want_map=()
  local IFS=','
  # shellcheck disable=SC2086
  set -- $ids_csv
  for want in "$@"; do
    want="$(printf '%s' "$want" | tr -d '[:space:]')"
    [ -n "$want" ] || continue
    want_map["$want"]=1
  done

  local id host
  while IFS= read -r line || [ -n "$line" ]; do
    # strip comments
    line="${line%%#*}"
    line="$(printf '%s' "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [ -n "$line" ] || continue
    id="${line%%[[:space:]]*}"
    host="${line#"$id"}"
    host="$(printf '%s' "$host" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [ -n "$id" ] && [ -n "$host" ] || continue
    if [ -n "${want_map[$id]+x}" ]; then
      allow_add "$host" "$id" "static" || return 1
    fi
  done <"$STATIC_LIST"
}

add_csv_hosts() {
  local csv="$1"
  local processor_id="$2"
  local source="$3"
  [ -n "$csv" ] || return 0
  local h
  local IFS=','
  # shellcheck disable=SC2086
  set -- $csv
  for h in "$@"; do
    h="$(printf '%s' "$h" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [ -n "$h" ] || continue
    allow_add "$h" "$processor_id" "$source" || return 1
  done
}

load_hosts_file() {
  local path="$1"
  [ -n "$path" ] || return 0
  [ -f "$path" ] || { err "hosts file not found: $path"; return 1; }
  local line id host
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"
    line="$(printf '%s' "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [ -n "$line" ] || continue
    # One field → host only; two fields → id host
    if [[ "$line" == *" "* ]] || [[ "$line" == *$'\t'* ]]; then
      id="${line%%[[:space:]]*}"
      host="${line#"$id"}"
      host="$(printf '%s' "$host" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      allow_add "$host" "$id" "hosts-file" || return 1
    else
      allow_add "$line" "tenant" "hosts-file" || return 1
    fi
  done <"$path"
}

extract_relay_from_url() {
  local url="$1"
  [ -n "$url" ] || return 0
  local h
  h="$(normalize_host "$url")"
  [ -n "$h" ] || return 0
  # normalize_host already dropped query; still refuse secret-like
  allow_add "$h" "lanyard-portal-relay" "relay_wss_url" || return 1
}

# --- emit ---------------------------------------------------------------------

yaml_quote() {
  # Hostnames are safe unquoted; use plain form.
  printf '%s' "$1"
}

emit_yaml() {
  local generated_at
  generated_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "unknown")"
  cat <<EOF
# Generated by scripts/omnibox/render-egress-allowlist.sh — DO NOT commit live secrets.
# Host-generated runtime fragment for run-under-omnibox (phase 2+ merges this).
# schema: OmniboxEgressAllowlist v1
# generated_at: ${generated_at}
schema_version: 1
source: omnibox-egress-render
backend: bwrap_inrepo
network:
  default: deny
  # Always blocked: IMDS, link-local, RFC1918, loopback, ULA.
  # Wrapper must enforce these even if an allow entry conflicts.
  block:
EOF
  local b
  for b in "${ALWAYS_BLOCK[@]}"; do
    printf '    - %s\n' "$(yaml_quote "$b")"
  done

  cat <<EOF
  # Allowlisted HTTPS destinations (port 443). Empty ⇒ default deny (phase 0–2 posture).
  allowlist:
EOF
  if [ "${#ALLOW_LINES[@]}" -eq 0 ]; then
    printf '    []\n'
  else
    local line host pid source
    for line in "${ALLOW_LINES[@]}"; do
      host="${line%%|*}"
      rest="${line#*|}"
      pid="${rest%%|*}"
      source="${rest#*|}"
      printf '    - host: %s\n' "$(yaml_quote "$host")"
      printf '      ports: [443]\n'
      printf '      processor_id: %s\n' "$(yaml_quote "$pid")"
      printf '      source: %s\n' "$(yaml_quote "$source")"
    done
  fi

  cat <<EOF
notes: >
  Metadata (169.254.169.254) and private ranges remain blocked.
  Real API keys stay outside the Omnibox (credential inject / gateway EnvironmentFile).
  Consumer: run-under-omnibox merges this file with policy network.allowlist.
  Catalog: references/approved-data-processors.md
EOF
}

# --- CLI ----------------------------------------------------------------------

MODEL_HOST_ARGS=()
EXTRA_HOST_ARGS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --quiet) QUIET=1; shift ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --static-list) STATIC_LIST="$2"; shift 2 ;;
    --processor-ids) PROCESSOR_IDS_CSV="$2"; shift 2 ;;
    --model-host) MODEL_HOST_ARGS+=("$2"); shift 2 ;;
    --extra-host) EXTRA_HOST_ARGS+=("$2"); shift 2 ;;
    --relay-host) RELAY_HOST="$2"; shift 2 ;;
    --hosts-file) HOSTS_FILE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *)
      err "unknown arg: $1"
      usage
      exit 2
      ;;
  esac
done

# Load inputs
load_static_for_ids "$PROCESSOR_IDS_CSV"
add_csv_hosts "$MODEL_HOSTS_CSV" "model" "env:OMNIBOX_MODEL_HOSTS"
add_csv_hosts "$EXTRA_HOSTS_CSV" "tenant" "env:OMNIBOX_EXTRA_HOSTS"

for h in "${MODEL_HOST_ARGS[@]+"${MODEL_HOST_ARGS[@]}"}"; do
  allow_add "$h" "model" "cli:model-host"
done
for h in "${EXTRA_HOST_ARGS[@]+"${EXTRA_HOST_ARGS[@]}"}"; do
  allow_add "$h" "tenant" "cli:extra-host"
done

if [ -n "$RELAY_HOST" ]; then
  allow_add "$RELAY_HOST" "lanyard-portal-relay" "cli:relay-host"
fi
if [ -n "$RELAY_WSS_URL" ]; then
  extract_relay_from_url "$RELAY_WSS_URL"
fi
load_hosts_file "$HOSTS_FILE"

if [ "$DRY_RUN" -eq 1 ]; then
  log "dry-run: emitting allowlist to stdout (no write to $OUTPUT_DIR)"
  emit_yaml
  log "allowlist_entries=${#ALLOW_LINES[@]} block_entries=${#ALWAYS_BLOCK[@]}"
  exit 0
fi

# Host write path
if [ ! -d "$OUTPUT_DIR" ]; then
  if mkdir -p "$OUTPUT_DIR" 2>/dev/null; then
    log "created $OUTPUT_DIR"
  else
    err "cannot create output dir $OUTPUT_DIR (try --dry-run or --output-dir under a writable path)"
    exit 1
  fi
fi

OUT_PATH="${OUTPUT_DIR%/}/$OUTPUT_FILE_NAME"
TMP_PATH="${OUT_PATH}.tmp.$$"
emit_yaml >"$TMP_PATH"
# Restrictive mode: no group/world write
chmod 0644 "$TMP_PATH" 2>/dev/null || true
mv -f "$TMP_PATH" "$OUT_PATH"
log "wrote $OUT_PATH (${#ALLOW_LINES[@]} allow entries; ${#ALWAYS_BLOCK[@]} always-block)"
# Also stamp a small provenance file (no secrets)
PROV="${OUTPUT_DIR%/}/egress.provenance"
{
  echo "generated_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)"
  echo "script=render-egress-allowlist.sh"
  echo "allow_count=${#ALLOW_LINES[@]}"
  echo "static_list=$STATIC_LIST"
  echo "processor_ids=${PROCESSOR_IDS_CSV:-}"
} >"$PROV"
chmod 0644 "$PROV" 2>/dev/null || true
log "wrote $PROV"
exit 0
