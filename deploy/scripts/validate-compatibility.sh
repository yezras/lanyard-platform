#!/usr/bin/env bash
# Deterministic offline validation of a compatibility pin manifest.
# No network, no AWS credentials, no terraform apply.
#
# Usage:
#   bash scripts/validate-compatibility.sh [path/to/pins.yaml]
# Default: compatibility/pins.example.yaml
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="${1:-$ROOT/compatibility/pins.example.yaml}"
SCHEMA="$ROOT/compatibility/schema.json"

err() { echo "[validate-compatibility] ERROR: $*" >&2; }
log() { echo "[validate-compatibility] $*"; }
fail() { err "$*"; exit 1; }

if [ ! -f "$MANIFEST" ]; then
  fail "manifest not found: $MANIFEST"
fi
if [ ! -f "$SCHEMA" ]; then
  fail "schema not found: $SCHEMA"
fi

# --- optional structural check with python (stdlib only) ---
# Prefer PyYAML if present; otherwise a minimal line-oriented subset check.
has_pyyaml=0
if command -v python3 >/dev/null 2>&1; then
  if python3 -c 'import yaml' 2>/dev/null; then
    has_pyyaml=1
  fi
fi

FORBIDDEN_VERSIONS='^(main|master|head|develop|development|trunk|latest)$'

is_forbidden_version() {
  local v
  v="$(echo "${1:-}" | tr '[:upper:]' '[:lower:]')"
  echo "$v" | grep -Eq "$FORBIDDEN_VERSIONS"
}

is_git_remote_url() {
  local url="${1:-}"
  case "$url" in
    git://*|git@*|ssh://git@*) return 0 ;;
  esac
  echo "$url" | grep -Eq '\.git($|[?#/])' && return 0
  echo "$url" | grep -Eqi '(github\.com|gitlab\.com)/[^/]+/[^/]+/(tree|blob|raw)/' && return 0
  return 1
}

normalize_sha() {
  echo "$1" | tr 'A-F' 'a-f' | sed 's/^sha256://'
}

check_sha256() {
  local label="$1" raw="$2"
  local hex
  hex="$(normalize_sha "$raw")"
  echo "$hex" | grep -Eq '^[a-f0-9]{64}$' || fail "$label sha256 must be 64 hex chars (got: $raw)"
}

check_digest() {
  local label="$1" d="$2"
  echo "$d" | grep -Eq '^sha256:[a-f0-9]{64}$' || fail "$label digest must match sha256:<64hex> (got: $d)"
}

check_url() {
  local label="$1" url="$2"
  [ -n "$url" ] || fail "$label url is empty"
  is_git_remote_url "$url" && fail "$label url looks like a git remote/source tree (got: $url)"
  case "$url" in
    http://*|ws://*|wss://*|ftp://*|file://*)
      fail "$label url uses insecure/non-artifact scheme (got: $url); allow only s3:// or https://"
      ;;
    s3://*|https://*) ;;
    *) fail "$label url must be s3:// or https:// (got: $url)" ;;
  esac
}

check_version() {
  local label="$1" ver="$2"
  [ -n "$ver" ] || fail "$label version is empty"
  is_forbidden_version "$ver" && fail "$label version must not be a live git ref (got: $ver)"
  # placeholder tokens still fail closed for operator pin files, but the
  # documented example uses *-example versions which are allowed.
  case "$ver" in
    UNCONFIGURED|REPLACE_ME) fail "$label version is unconfigured placeholder" ;;
  esac
}

if [ "$has_pyyaml" = "1" ]; then
  log "Parsing YAML with PyYAML: $MANIFEST"
  # shellcheck disable=SC2016
  EVAL_OUT="$(MANIFEST="$MANIFEST" SCHEMA="$SCHEMA" python3 - <<'PY'
import os, re, sys
import yaml

manifest_path = os.environ["MANIFEST"]
with open(manifest_path, "r", encoding="utf-8") as f:
    data = yaml.safe_load(f)

if not isinstance(data, dict):
    print("FAIL:root:manifest must be a mapping")
    sys.exit(2)

errors = []

def need(path, cond, msg):
    if not cond:
        errors.append(f"{path}: {msg}")

need("schema_version", data.get("schema_version") == 1, "must be integer 1")

portal = data.get("portal") or {}
images = (portal.get("images") or {}) if isinstance(portal, dict) else {}
need("portal.images", isinstance(images, dict) and len(images) >= 1, "need at least one image pin")

for name, img in images.items():
    if not isinstance(img, dict):
        errors.append(f"portal.images.{name}: must be mapping")
        continue
    repo = img.get("repository") or ""
    digest = img.get("digest") or ""
    need(f"portal.images.{name}.repository", isinstance(repo, str) and len(repo) > 0, "required")
    need(
        f"portal.images.{name}.digest",
        isinstance(digest, str) and re.fullmatch(r"sha256:[a-f0-9]{64}", digest or ""),
        "must be sha256:<64hex>",
    )

# Optional static web pin (portal.web) — same field contract as hermes/client_core.
web = (portal.get("web") if isinstance(portal, dict) else None)
if web is not None:
    if not isinstance(web, dict):
        errors.append("portal.web: must be mapping")
    else:
        for field in ("version", "sha256", "url"):
            need(f"portal.web.{field}", field in web and str(web.get(field, "")).strip() != "", "required")

for key in ("hermes", "client_core"):
    block = data.get(key) or {}
    if not isinstance(block, dict):
        errors.append(f"{key}: must be mapping")
        continue
    for field in ("version", "sha256", "url"):
        need(f"{key}.{field}", field in block and str(block.get(field, "")).strip() != "", "required")

rc = data.get("relay_contract") or {}
need("relay_contract.major", isinstance(rc, dict) and isinstance(rc.get("major"), int) and rc.get("major") >= 0,
     "must be non-negative integer")

# Emit shell-friendly KEY=value for deeper checks
def emit(k, v):
    print(f"OK_FIELD:{k}={v}")

if errors:
    for e in errors:
        print(f"FAIL:{e}")
    sys.exit(2)

emit("schema_version", data["schema_version"])
for name, img in images.items():
    emit(f"portal.images.{name}.repository", img["repository"])
    emit(f"portal.images.{name}.digest", img["digest"])
if isinstance(web, dict):
    emit("portal.web.version", web["version"])
    emit("portal.web.sha256", web["sha256"])
    emit("portal.web.url", web["url"])
emit("hermes.version", data["hermes"]["version"])
emit("hermes.sha256", data["hermes"]["sha256"])
emit("hermes.url", data["hermes"]["url"])
emit("client_core.version", data["client_core"]["version"])
emit("client_core.sha256", data["client_core"]["sha256"])
emit("client_core.url", data["client_core"]["url"])
emit("relay_contract.major", data["relay_contract"]["major"])
print("PARSE_OK")
PY
)" || true

  if ! echo "$EVAL_OUT" | grep -q '^PARSE_OK$'; then
    echo "$EVAL_OUT" | grep '^FAIL:' >&2 || true
    fail "YAML structural validation failed for $MANIFEST"
  fi

  # Field-level policy checks (branch names, git URLs, sha formats)
  while IFS= read -r line; do
    case "$line" in
      OK_FIELD:hermes.version=*)
        check_version "hermes" "${line#OK_FIELD:hermes.version=}"
        ;;
      OK_FIELD:client_core.version=*)
        check_version "client_core" "${line#OK_FIELD:client_core.version=}"
        ;;
      OK_FIELD:portal.web.version=*)
        check_version "portal.web" "${line#OK_FIELD:portal.web.version=}"
        ;;
      OK_FIELD:hermes.sha256=*)
        check_sha256 "hermes" "${line#OK_FIELD:hermes.sha256=}"
        ;;
      OK_FIELD:client_core.sha256=*)
        check_sha256 "client_core" "${line#OK_FIELD:client_core.sha256=}"
        ;;
      OK_FIELD:portal.web.sha256=*)
        check_sha256 "portal.web" "${line#OK_FIELD:portal.web.sha256=}"
        ;;
      OK_FIELD:hermes.url=*)
        check_url "hermes" "${line#OK_FIELD:hermes.url=}"
        ;;
      OK_FIELD:client_core.url=*)
        check_url "client_core" "${line#OK_FIELD:client_core.url=}"
        ;;
      OK_FIELD:portal.web.url=*)
        check_url "portal.web" "${line#OK_FIELD:portal.web.url=}"
        ;;
      OK_FIELD:portal.images.*.digest=*|OK_FIELD:portal.images.*)
        if echo "$line" | grep -q '\.digest='; then
          dig="${line#*=}"
          name="${line#OK_FIELD:}"
          name="${name%%=*}"
          check_digest "$name" "$dig"
        fi
        ;;
      OK_FIELD:relay_contract.major=*)
        maj="${line#OK_FIELD:relay_contract.major=}"
        echo "$maj" | grep -Eq '^[0-9]+$' || fail "relay_contract.major must be integer (got: $maj)"
        ;;
    esac
  done <<< "$EVAL_OUT"

else
  log "PyYAML not available — using line-oriented fallback parser"
  # Fallback: require key presence and run policy checks on grepped values.
  # Works for the checked-in example format (flat-ish YAML).
  need_key() {
    grep -Eq "^[[:space:]]*$1:[[:space:]]*" "$MANIFEST" || fail "missing key: $1"
  }
  need_key "schema_version"
  need_key "portal"
  need_key "images"
  need_key "hermes"
  need_key "client_core"
  need_key "relay_contract"
  need_key "major"

  grep -E 'digest:[[:space:]]*"?sha256:' "$MANIFEST" >/dev/null || fail "no portal image digests found"
  while IFS= read -r dig; do
    dig="$(echo "$dig" | sed -E 's/.*"?(sha256:[a-f0-9]{64})"?.*/\1/')"
    check_digest "portal.images" "$dig"
  done < <(grep -E 'digest:[[:space:]]*' "$MANIFEST" | sed -E 's/.*digest:[[:space:]]*"?([^"#]+)"?.*/\1/' | tr -d ' ')

  # hermes / client_core blocks: extract version, sha256, url under each section
  extract_block_field() {
    local block="$1" field="$2"
    awk -v blk="$block" -v fld="$field" '
      $0 ~ "^"blk":" {inblk=1; next}
      inblk && /^[a-z_]+:/ && $0 !~ "^[[:space:]]" {inblk=0}
      inblk && $0 ~ "^[[:space:]]+"fld":" {
        sub(/^[^:]+:[[:space:]]*/, "");
        gsub(/["'\''"]/, "");
        gsub(/[[:space:]]+#.*$/, "");
        gsub(/[[:space:]]+$/, "");
        print; exit
      }
    ' "$MANIFEST"
  }

  for block in hermes client_core; do
    ver="$(extract_block_field "$block" version)"
    sha="$(extract_block_field "$block" sha256)"
    url="$(extract_block_field "$block" url)"
    check_version "$block" "$ver"
    check_sha256 "$block" "$sha"
    check_url "$block" "$url"
  done

  maj="$(extract_block_field relay_contract major)"
  echo "$maj" | grep -Eq '^[0-9]+$' || fail "relay_contract.major must be integer (got: ${maj:-empty})"
fi

# Negative self-check: forbidden version helper
is_forbidden_version "main" || fail "internal: main should be forbidden"
is_forbidden_version "v0.1.0" && fail "internal: v0.1.0 should be allowed"

# Negative self-check: insecure artifact URL schemes must be rejected
if ( check_url "selfcheck" "http://example.invalid/a.tar.gz" ) >/dev/null 2>&1; then
  fail "internal: http:// artifact URL should be rejected"
fi
if ( check_url "selfcheck" "ws://example.invalid/a" ) >/dev/null 2>&1; then
  fail "internal: ws:// artifact URL should be rejected"
fi
# Secure schemes must pass the scheme gate (git-remote checks still apply separately)
check_url "selfcheck-https" "https://example.invalid/releases/a.tar.gz"
check_url "selfcheck-s3" "s3://example-bucket/releases/a.tar.gz"

log "Schema reference: $SCHEMA"
log "Manifest OK: $MANIFEST"
echo "PASS: compatibility pins valid"
