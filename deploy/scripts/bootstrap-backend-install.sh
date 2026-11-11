#!/usr/bin/env bash
# Reference: generic backend artifact install (lp-k7g.7.4).
#
# Generalizes the Hermes install block from company-brain-deploy
# scripts/bootstrap-host.sh:
#   download → SHA-256 verify (+ optional attestation) → extract →
#   /opt/company-brain-backend/versions/<version>/ → current symlink →
#   .seed/provenance.json
#
# Design: docs/architecture/deploy-bootstrap-backend-install.md
# Provenance schema: deploy/schemas/backend-install-provenance.schema.json
#
# Pins (primary BACKEND_*; temporary HERMES_* / RELAY_CONTRACT_MAJOR fallback):
#   BACKEND_ARTIFACT_URL / VERSION / SHA256 / KIND
#   BACKEND_CONTRACT_RUNTIME_LAYOUT / RELAY / BRAIN_RPC
#   BACKEND_INSTALL_ROOT (default /opt/company-brain-backend)
#
# Lib-only (source helpers without running install):
#   BOOTSTRAP_BACKEND_INSTALL_LIB_ONLY=1 source deploy/scripts/bootstrap-backend-install.sh
#
# Idempotency: if versions/<ver>/.seed/provenance.json matches pins, skip
# re-download/extract; always ensure current → versions/<ver>.
# Force refresh: BACKEND_INSTALL_FORCE=1
#
# Keep size-sensitive if later base64gzip-injected into user_data.
set -euo pipefail

# ---------------------------------------------------------------------------
# Pin resolution (BACKEND_* primary; legacy HERMES_* accept-only)
# ---------------------------------------------------------------------------

if [ -f /etc/company-brain/artifact-pins.env ]; then
  # shellcheck disable=SC1091
  set -a
  # shellcheck source=/dev/null
  source /etc/company-brain/artifact-pins.env
  set +a
fi

# Primary pins (new contract)
BACKEND_ARTIFACT_URL="${BACKEND_ARTIFACT_URL:-}"
BACKEND_ARTIFACT_VERSION="${BACKEND_ARTIFACT_VERSION:-}"
BACKEND_ARTIFACT_SHA256="${BACKEND_ARTIFACT_SHA256:-}"
BACKEND_ARTIFACT_KIND="${BACKEND_ARTIFACT_KIND:-hermes_lanyard}"
BACKEND_ARTIFACT_SIGNATURE_B64="${BACKEND_ARTIFACT_SIGNATURE_B64:-}"
BACKEND_CONTRACT_RUNTIME_LAYOUT="${BACKEND_CONTRACT_RUNTIME_LAYOUT:-1}"
BACKEND_CONTRACT_RELAY="${BACKEND_CONTRACT_RELAY:-}"
BACKEND_CONTRACT_BRAIN_RPC="${BACKEND_CONTRACT_BRAIN_RPC:-1}"
BACKEND_INSTALL_ROOT="${BACKEND_INSTALL_ROOT:-}"
BACKEND_INSTALL_PATH="${BACKEND_INSTALL_PATH:-}"
BACKEND_INSTALL_LAYOUT="${BACKEND_INSTALL_LAYOUT:-versioned}"
BACKEND_INSTALL_FORCE="${BACKEND_INSTALL_FORCE:-0}"
BACKEND_ENTRYPOINT="${BACKEND_ENTRYPOINT:-bin/company-brain-backend}"
# Target platform label for native runtime wheels (lp-2md.3). Canonical:
# linux-x86_64 | linux-aarch64 (linux-arm64 accepted as alias).
BACKEND_ARTIFACT_ARCH="${BACKEND_ARTIFACT_ARCH:-}"
# Emergency only: allow unlabeled legacy tarballs (default fail-closed).
BACKEND_ALLOW_MISSING_ARCH="${BACKEND_ALLOW_MISSING_ARCH:-0}"

# Temporary legacy aliases (lp-k7g.7.3 dual-write; remove after cutover)
if [ -z "$BACKEND_ARTIFACT_URL" ] || [ "$BACKEND_ARTIFACT_URL" = "UNCONFIGURED" ]; then
  BACKEND_ARTIFACT_URL="${HERMES_ARTIFACT_URL:-UNCONFIGURED}"
fi
if [ -z "$BACKEND_ARTIFACT_VERSION" ] || [ "$BACKEND_ARTIFACT_VERSION" = "UNCONFIGURED" ]; then
  BACKEND_ARTIFACT_VERSION="${HERMES_ARTIFACT_VERSION:-UNCONFIGURED}"
fi
if [ -z "$BACKEND_ARTIFACT_SHA256" ] || [ "$BACKEND_ARTIFACT_SHA256" = "UNCONFIGURED" ]; then
  BACKEND_ARTIFACT_SHA256="${HERMES_ARTIFACT_SHA256:-UNCONFIGURED}"
fi
if [ -z "$BACKEND_ARTIFACT_SIGNATURE_B64" ]; then
  BACKEND_ARTIFACT_SIGNATURE_B64="${HERMES_ARTIFACT_SIGNATURE_B64:-}"
fi
if [ -z "$BACKEND_ARTIFACT_ARCH" ] || [ "$BACKEND_ARTIFACT_ARCH" = "UNCONFIGURED" ]; then
  BACKEND_ARTIFACT_ARCH="${HERMES_ARTIFACT_ARCH:-}"
fi
if [ -z "${BACKEND_ALLOW_MISSING_ARCH:-}" ] || [ "$BACKEND_ALLOW_MISSING_ARCH" = "0" ]; then
  if [ "${HERMES_ALLOW_MISSING_ARCH:-0}" = "1" ]; then
    BACKEND_ALLOW_MISSING_ARCH=1
  fi
fi
if [ -z "$BACKEND_CONTRACT_RELAY" ] || [ "$BACKEND_CONTRACT_RELAY" = "UNCONFIGURED" ]; then
  BACKEND_CONTRACT_RELAY="${RELAY_CONTRACT_MAJOR:-1}"
fi
if [ -z "$BACKEND_INSTALL_ROOT" ]; then
  # Prefer explicit root; else map install_path if it looks like the versioned root;
  # else default. Flat HERMES_INSTALL_PATH does not become the versioned root.
  if [ -n "${BACKEND_INSTALL_PATH:-}" ] && [[ "$BACKEND_INSTALL_PATH" == */company-brain-backend ]]; then
    BACKEND_INSTALL_ROOT="$BACKEND_INSTALL_PATH"
  elif [ -n "${HERMES_INSTALL_PATH:-}" ] && [[ "$HERMES_INSTALL_PATH" == */company-brain-backend ]]; then
    BACKEND_INSTALL_ROOT="$HERMES_INSTALL_PATH"
  else
    BACKEND_INSTALL_ROOT="/opt/company-brain-backend"
  fi
fi

DOWNLOAD_DIR="${DOWNLOAD_DIR:-/var/tmp/company-brain-artifacts}"
ARTIFACT_SIGNING_PUBKEY="${ARTIFACT_SIGNING_PUBKEY:-}"
ARTIFACT_SIGNING_PUBKEY_B64="${ARTIFACT_SIGNING_PUBKEY_B64:-}"
ARTIFACT_SIGNING_PUBKEY_FILE="${ARTIFACT_SIGNING_PUBKEY_FILE:-}"
ARTIFACT_SIGNING_IDENTITY="${ARTIFACT_SIGNING_IDENTITY:-}"
REQUIRE_ARTIFACT_ATTESTATION="${REQUIRE_ARTIFACT_ATTESTATION:-0}"

BACKEND_ATTESTATION_STATUS="skipped"
ARTIFACT_SIGNING_PUBKEY_FINGERPRINT=""
_ATTESTATION_PUBKEY_PATH=""
_ATTESTATION_PUBKEY_TMP=""

usage() {
  cat <<EOF
Usage: $0 [options]

Generic backend install (versioned layout under BACKEND_INSTALL_ROOT).

Required pins (env, artifact-pins.env, or flags):
  --url URL                 BACKEND_ARTIFACT_URL
  --version VER             BACKEND_ARTIFACT_VERSION
  --sha256 HEX              BACKEND_ARTIFACT_SHA256
  --kind KIND               BACKEND_ARTIFACT_KIND (default: hermes_lanyard)

Optional:
  --contract-runtime N      BACKEND_CONTRACT_RUNTIME_LAYOUT (default: 1)
  --contract-relay N        BACKEND_CONTRACT_RELAY (default: 1)
  --contract-brain-rpc N    BACKEND_CONTRACT_BRAIN_RPC (default: 1)
  --install-root PATH       BACKEND_INSTALL_ROOT (default: /opt/company-brain-backend)
  --force                   Re-download/extract even when provenance matches
  -h, --help

Order is always: download → verify → extract → versions/<ver> → current → provenance.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --url) BACKEND_ARTIFACT_URL="$2"; shift 2 ;;
    --version) BACKEND_ARTIFACT_VERSION="$2"; shift 2 ;;
    --sha256) BACKEND_ARTIFACT_SHA256="$2"; shift 2 ;;
    --kind) BACKEND_ARTIFACT_KIND="$2"; shift 2 ;;
    --contract-runtime) BACKEND_CONTRACT_RUNTIME_LAYOUT="$2"; shift 2 ;;
    --contract-relay) BACKEND_CONTRACT_RELAY="$2"; shift 2 ;;
    --contract-brain-rpc) BACKEND_CONTRACT_BRAIN_RPC="$2"; shift 2 ;;
    --install-root) BACKEND_INSTALL_ROOT="$2"; shift 2 ;;
    --force) BACKEND_INSTALL_FORCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

log() { echo "[bootstrap-backend-install] $*"; }
err() { echo "[bootstrap-backend-install] ERROR: $*" >&2; }

is_unconfigured() {
  local v="${1:-}"
  [ -z "$v" ] || [ "$v" = "UNCONFIGURED" ] || [ "$v" = "REPLACE_ME" ]
}

require_pin() {
  local name="$1" value="$2"
  if is_unconfigured "$value"; then
    err "Artifact pin '$name' is unconfigured or empty."
    err "Set BACKEND_* (or temporary HERMES_* fallback) via env, artifact-pins.env, or flags."
    exit 2
  fi
}

is_forbidden_version_ref() {
  local v
  v="$(echo "${1:-}" | tr '[:upper:]' '[:lower:]')"
  case "$v" in
    main|master|head|develop|development|trunk|latest|origin/*|refs/*)
      return 0
      ;;
  esac
  return 1
}

is_git_remote_url() {
  local url="${1:-}"
  case "$url" in
    git://*|git@*|ssh://git@*) return 0 ;;
  esac
  if echo "$url" | grep -Eq '\.git($|[?#/])'; then return 0; fi
  if echo "$url" | grep -Eqi '(github\.com|gitlab\.com)/[^/]+/[^/]+/(tree|blob|raw)/'; then
    return 0
  fi
  return 1
}

is_insecure_artifact_url() {
  local url="${1:-}"
  case "$url" in
    http://*|ws://*|wss://*|ftp://*|file://*) return 0 ;;
  esac
  return 1
}

require_artifact_url() {
  local name="$1" url="$2"
  require_pin "$name" "$url"
  if is_git_remote_url "$url"; then
    err "Artifact pin '$name' looks like a git remote or source-tree URL, not a release object."
    exit 2
  fi
  if is_insecure_artifact_url "$url"; then
    err "Artifact pin '$name' uses an insecure or non-artifact URL scheme (need s3:// or https://)."
    exit 2
  fi
  case "$url" in
    s3://*|https://*) ;;
    *)
      err "Artifact pin '$name' must be s3:// or https:// (got: $url)"
      exit 2
      ;;
  esac
}

require_artifact_version() {
  local name="$1" version="$2"
  require_pin "$name" "$version"
  if is_forbidden_version_ref "$version"; then
    err "Artifact pin '$name' must not be a live git branch/mutable ref (got: $version)."
    exit 2
  fi
  # Directory safety: version must be a single path segment
  case "$version" in
    */*|*..*|*\\*)
      err "Artifact version must be a single path segment (got: $version)"
      exit 2
      ;;
  esac
}

normalize_sha() {
  echo "$1" | tr 'A-F' 'a-f' | sed 's/^sha256://'
}

url_path_basename() {
  local ref="$1"
  ref="${ref%%#*}"
  ref="${ref%%\?*}"
  ref="${ref%/}"
  echo "${ref##*/}"
}

archive_format_from_ref() {
  local ref="$1" base
  base="$(url_path_basename "$ref")"
  case "$base" in
    *.tar.gz|*.tgz) echo "tar.gz" ;;
    *.tar) echo "tar" ;;
    *.zip) echo "zip" ;;
    *) echo "" ;;
  esac
}

archive_format_from_magic() {
  local file="$1" hdr
  if [ ! -f "$file" ] || [ ! -r "$file" ]; then
    echo ""
    return 0
  fi
  hdr="$(od -An -tx1 -N4 "$file" 2>/dev/null | tr -d ' \n')"
  case "$hdr" in
    1f8b*) echo "tar.gz"; return 0 ;;
    504b0304|504b0506|504b0708) echo "zip"; return 0 ;;
  esac
  if [ "$(dd if="$file" bs=1 skip=257 count=5 2>/dev/null)" = "ustar" ]; then
    echo "tar"
    return 0
  fi
  echo ""
}

resolve_archive_format() {
  local file="$1" source_url="${2:-}" fmt=""
  if [ -n "$source_url" ]; then
    fmt="$(archive_format_from_ref "$source_url")"
  fi
  if [ -z "$fmt" ]; then
    fmt="$(archive_format_from_ref "$file")"
  fi
  if [ -z "$fmt" ]; then
    fmt="$(archive_format_from_magic "$file")"
  fi
  if [ -z "$fmt" ]; then
    err "Unsupported or unrecognized archive format: $file"
    exit 2
  fi
  echo "$fmt"
}

github_auth_token() {
  if [ -n "${GITHUB_TOKEN:-}" ]; then printf '%s' "$GITHUB_TOKEN"; return 0; fi
  if [ -n "${GH_TOKEN:-}" ]; then printf '%s' "$GH_TOKEN"; return 0; fi
  return 1
}

is_github_release_download_url() {
  echo "${1:-}" | grep -Eqi '^https://github\.com/[^/]+/[^/]+/releases/download/[^/]+/.+'
}

is_github_api_asset_url() {
  echo "${1:-}" | grep -Eqi '^https://api\.github\.com/repos/[^/]+/[^/]+/releases/assets/[0-9]+'
}

download_github_release_asset() {
  local url="$1" dest="$2" token api owner repo tag name
  if ! token="$(github_auth_token)"; then
    err "Private GitHub download requires GITHUB_TOKEN or GH_TOKEN (env only; never commit)."
    exit 3
  fi
  command -v curl >/dev/null 2>&1 || { err "curl required for private GitHub downloads"; exit 3; }
  if is_github_api_asset_url "$url"; then
    api="$url"
  elif is_github_release_download_url "$url"; then
    owner="$(echo "$url" | sed -E 's|^https://github\.com/([^/]+)/.*|\1|')"
    repo="$(echo "$url" | sed -E 's|^https://github\.com/[^/]+/([^/]+)/.*|\1|')"
    tag="$(echo "$url" | sed -E 's|^https://github\.com/[^/]+/[^/]+/releases/download/([^/]+)/.*|\1|')"
    name="$(echo "$url" | sed -E 's|^https://github\.com/[^/]+/[^/]+/releases/download/[^/]+/||; s|[?#].*||')"
    log "Resolving private GitHub release asset via API"
    api="$(
      curl -fsSL --retry 3 \
        -H "Authorization: Bearer ${token}" \
        -H "Accept: application/vnd.github+json" \
        "https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}" \
      | NAME="$name" python3 -c 'import json,os,sys
d=json.load(sys.stdin); n=os.environ["NAME"]
for a in d.get("assets") or []:
  if a.get("name")==n and a.get("url"):
    print(a["url"]); raise SystemExit(0)
raise SystemExit(1)'
    )" || { err "Failed to resolve GitHub asset ${owner}/${repo}@${tag} name=${name}"; exit 3; }
  else
    err "Not a GitHub release asset URL: $url"; exit 2
  fi
  curl -fsSL --retry 3 -L \
    -H "Authorization: Bearer ${token}" \
    -H "Accept: application/octet-stream" \
    -o "$dest" "$api"
}

# Download must complete before any verify/extract caller proceeds.
download_artifact() {
  local url="$1" dest="$2"
  log "Downloading $url → $dest"
  if is_insecure_artifact_url "$url"; then
    err "Refusing download over insecure scheme: $url"
    exit 2
  fi
  case "$url" in
    s3://*)
      if ! command -v aws >/dev/null 2>&1; then
        err "aws CLI required for s3:// artifact URLs."
        exit 3
      fi
      aws s3 cp "$url" "$dest"
      ;;
    https://*)
      if is_github_api_asset_url "$url" || { is_github_release_download_url "$url" && github_auth_token >/dev/null 2>&1; }; then
        download_github_release_asset "$url" "$dest"
      elif command -v curl >/dev/null 2>&1; then
        curl -fsSL --retry 3 -o "$dest" "$url" || exit 3
      elif command -v wget >/dev/null 2>&1; then
        wget -q -O "$dest" "$url" || exit 3
      else
        err "curl or wget required for https:// artifact URLs."
        exit 3
      fi
      ;;
    *)
      err "Unsupported artifact URL scheme: $url (use s3:// or https://)"
      exit 2
      ;;
  esac
}

# Verify digest of the archive bytes before extraction.
verify_sha256() {
  local file="$1" expected="$2" label="$3"
  local actual
  actual="$(sha256sum "$file" | awk '{print $1}')"
  if [ "$actual" != "$expected" ]; then
    err "SHA-256 mismatch for $label"
    err "  expected: $expected"
    err "  actual:   $actual"
    err "  file:     $file"
    exit 4
  fi
  log "SHA-256 OK for $label ($actual)"
}

has_sig_pin() {
  local v="${1:-}"
  [ -n "$v" ] && ! is_unconfigured "$v"
}

resolve_signing_pubkey_file() {
  local material=""
  if [ -n "${_ATTESTATION_PUBKEY_PATH:-}" ] && [ -f "$_ATTESTATION_PUBKEY_PATH" ]; then
    return 0
  fi
  _ATTESTATION_PUBKEY_PATH=""
  if [ -n "${ARTIFACT_SIGNING_PUBKEY_FILE:-}" ] && [ -f "$ARTIFACT_SIGNING_PUBKEY_FILE" ]; then
    _ATTESTATION_PUBKEY_PATH="$ARTIFACT_SIGNING_PUBKEY_FILE"
    return 0
  fi
  if [ -n "${ARTIFACT_SIGNING_PUBKEY_B64:-}" ] && ! is_unconfigured "$ARTIFACT_SIGNING_PUBKEY_B64"; then
    material="$(printf '%s' "$ARTIFACT_SIGNING_PUBKEY_B64" | tr -d '[:space:]' | base64 -d 2>/dev/null || true)"
    if [ -z "$material" ]; then
      err "ARTIFACT_SIGNING_PUBKEY_B64 could not be base64-decoded."
      exit 6
    fi
  elif [ -n "${ARTIFACT_SIGNING_PUBKEY:-}" ] && ! is_unconfigured "$ARTIFACT_SIGNING_PUBKEY"; then
    if [ -f "$ARTIFACT_SIGNING_PUBKEY" ]; then
      _ATTESTATION_PUBKEY_PATH="$ARTIFACT_SIGNING_PUBKEY"
      return 0
    fi
    material="$ARTIFACT_SIGNING_PUBKEY"
  else
    return 1
  fi
  if ! echo "$material" | grep -q 'BEGIN.*PUBLIC KEY'; then
    err "Signing public key must be PEM (BEGIN PUBLIC KEY) or a path to a PEM file."
    exit 6
  fi
  _ATTESTATION_PUBKEY_TMP="$(mktemp "${TMPDIR:-/tmp}/cb-backend-pubkey.XXXXXX")"
  printf '%s\n' "$material" >"$_ATTESTATION_PUBKEY_TMP"
  _ATTESTATION_PUBKEY_PATH="$_ATTESTATION_PUBKEY_TMP"
  return 0
}

cleanup_attestation_tmp() {
  if [ -n "${_ATTESTATION_PUBKEY_TMP:-}" ] && [ -f "$_ATTESTATION_PUBKEY_TMP" ]; then
    rm -f "$_ATTESTATION_PUBKEY_TMP"
  fi
  _ATTESTATION_PUBKEY_TMP=""
}

signing_pubkey_fingerprint() {
  local pub="$1"
  command -v openssl >/dev/null 2>&1 || { echo ""; return 1; }
  openssl pkey -pubin -in "$pub" -outform DER 2>/dev/null | sha256sum | awk '{print $1}'
}

verify_ed25519_signature() {
  local file="$1" sig_b64="$2" pubkey_file="$3" label="$4"
  local sig_file out rc=0
  command -v openssl >/dev/null 2>&1 || { err "openssl required for attestation ($label)"; exit 3; }
  sig_file="$(mktemp "${TMPDIR:-/tmp}/cb-backend-sig.XXXXXX")"
  if ! printf '%s' "$sig_b64" | tr -d '[:space:]' | base64 -d >"$sig_file" 2>/dev/null; then
    rm -f "$sig_file"
    err "Artifact signature for $label is not valid base64."
    exit 6
  fi
  out="$(openssl pkeyutl -verify -pubin -inkey "$pubkey_file" -sigfile "$sig_file" -rawin -in "$file" 2>&1)" || rc=$?
  rm -f "$sig_file"
  if [ "$rc" -ne 0 ] || ! echo "$out" | grep -qi 'Signature Verified Successfully'; then
    err "Ed25519 signature verification FAILED for $label (fail-closed)."
    exit 6
  fi
  log "Ed25519 signature OK for $label"
}

ATTESTATION_LAST_STATUS="skipped"
verify_artifact_attestation() {
  local file="$1" sig_b64="$2" label="$3"
  local require="${REQUIRE_ARTIFACT_ATTESTATION:-0}" has_sig=0
  ATTESTATION_LAST_STATUS="skipped"
  if has_sig_pin "$sig_b64"; then has_sig=1; fi
  if [ "$has_sig" = "0" ]; then
    if [ "$require" = "1" ]; then
      err "REQUIRE_ARTIFACT_ATTESTATION=1 but signature pin is missing for $label."
      exit 6
    fi
    log "Attestation skipped for $label (SHA-256 only)"
    return 0
  fi
  if ! resolve_signing_pubkey_file; then
    err "Signature pin set for $label but no signing public key configured."
    exit 6
  fi
  if [ -z "${ARTIFACT_SIGNING_PUBKEY_FINGERPRINT:-}" ]; then
    ARTIFACT_SIGNING_PUBKEY_FINGERPRINT="$(signing_pubkey_fingerprint "$_ATTESTATION_PUBKEY_PATH" || true)"
  fi
  verify_ed25519_signature "$file" "$sig_b64" "$_ATTESTATION_PUBKEY_PATH" "$label"
  ATTESTATION_LAST_STATUS="verified"
}

# ---------------------------------------------------------------------------
# Arch fail-closed (lp-2md.3): host uname vs artifact TARGET_ARCH / pin / URL
# ---------------------------------------------------------------------------

# Map uname -m / aliases → canonical cpu token (x86_64 | aarch64).
normalize_cpu_arch() {
  case "$(echo "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    x86_64|amd64|x64|x86-64) echo "x86_64" ;;
    aarch64|arm64|arm-64) echo "aarch64" ;;
    *) return 1 ;;
  esac
}

# Normalize to os-cpu form (e.g. linux-x86_64). Accepts linux-arm64 → linux-aarch64.
normalize_target_arch() {
  local raw os cpu
  raw="$(echo "${1:-}" | tr '[:upper:]' '[:lower:]')"
  [ -n "$raw" ] || return 1
  case "$raw" in
    linux/*|linux-*|linux_*|darwin/*|darwin-*|darwin_*)
      os="$(printf '%s' "$raw" | sed -E 's/^([a-z]+)[/_-].*/\1/')"
      cpu="$(printf '%s' "$raw" | sed -E 's/^[a-z]+[/_-]//')"
      cpu="$(normalize_cpu_arch "$cpu")" || return 1
      echo "${os}-${cpu}"
      ;;
    *)
      cpu="$(normalize_cpu_arch "$raw")" || return 1
      echo "linux-${cpu}"
      ;;
  esac
}

detect_host_target_arch() {
  local os cpu
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  case "$os" in
    linux|darwin) ;;
    *)
      err "Unsupported host OS from uname -s: $(uname -s)"
      return 1
      ;;
  esac
  cpu="$(normalize_cpu_arch "$(uname -m)")" || {
    err "Unsupported host arch from uname -m: $(uname -m) (need x86_64 or aarch64/arm64)"
    return 1
  }
  echo "${os}-${cpu}"
}

# Read TARGET_ARCH from extracted/flattened tree (file or .seed/build.env).
read_target_arch_from_tree() {
  local root="$1" val=""
  [ -n "$root" ] && [ -d "$root" ] || return 1
  if [ -f "$root/TARGET_ARCH" ]; then
    val="$(tr -d '[:space:]' <"$root/TARGET_ARCH" 2>/dev/null || true)"
  fi
  if [ -z "$val" ] && [ -f "$root/.seed/build.env" ]; then
    val="$(
      grep -E '^TARGET_ARCH=' "$root/.seed/build.env" 2>/dev/null \
        | head -1 | cut -d= -f2- | tr -d '[:space:]' || true
    )"
  fi
  [ -n "$val" ] || return 1
  normalize_target_arch "$val"
}

# Infer arch from S3/URL path segment …/linux-x86_64/… or …/linux-arm64/….
infer_target_arch_from_url() {
  local url="${1:-}" m
  [ -n "$url" ] || return 1
  m="$(
    echo "$url" \
      | grep -Eo '/linux[-_](x86_64|amd64|aarch64|arm64)/' \
      | head -1 \
      | tr -d '/' \
      || true
  )"
  [ -n "$m" ] || return 1
  normalize_target_arch "$m"
}

# Resolve artifact TARGET_ARCH: pin > in-tree meta > URL path.
# Sets RESOLVED_ARTIFACT_TARGET_ARCH. Returns 0 if resolved, 1 if missing.
resolve_artifact_target_arch() {
  local pin_arch="${1:-}" tree_root="${2:-}" url="${3:-}"
  local pin_n="" tree_n="" url_n=""
  RESOLVED_ARTIFACT_TARGET_ARCH=""

  if [ -n "$pin_arch" ] && ! is_unconfigured "$pin_arch"; then
    pin_n="$(normalize_target_arch "$pin_arch")" || {
      err "Invalid artifact arch pin '${pin_arch}' (use linux-x86_64 or linux-aarch64)."
      exit 2
    }
  fi
  if [ -n "$tree_root" ]; then
    tree_n="$(read_target_arch_from_tree "$tree_root" 2>/dev/null || true)"
  fi
  if [ -n "$url" ]; then
    url_n="$(infer_target_arch_from_url "$url" 2>/dev/null || true)"
  fi

  # Prefer pin, then tree, then URL; require agreement when multiple present.
  if [ -n "$pin_n" ] && [ -n "$tree_n" ] && [ "$pin_n" != "$tree_n" ]; then
    err "Artifact arch pin (${pin_n}) disagrees with in-tree TARGET_ARCH (${tree_n})."
    exit 5
  fi
  if [ -n "$pin_n" ] && [ -n "$url_n" ] && [ "$pin_n" != "$url_n" ]; then
    err "Artifact arch pin (${pin_n}) disagrees with URL path arch (${url_n})."
    exit 5
  fi
  if [ -n "$tree_n" ] && [ -n "$url_n" ] && [ "$tree_n" != "$url_n" ]; then
    err "In-tree TARGET_ARCH (${tree_n}) disagrees with URL path arch (${url_n})."
    exit 5
  fi

  if [ -n "$pin_n" ]; then
    RESOLVED_ARTIFACT_TARGET_ARCH="$pin_n"
    return 0
  fi
  if [ -n "$tree_n" ]; then
    RESOLVED_ARTIFACT_TARGET_ARCH="$tree_n"
    return 0
  fi
  if [ -n "$url_n" ]; then
    RESOLVED_ARTIFACT_TARGET_ARCH="$url_n"
    return 0
  fi
  return 1
}

# Fail closed before install/start when host uname -m ≠ artifact target arch.
# Exit 5 on mismatch or missing meta (unless allow_missing=1).
require_host_arch_match() {
  local label="$1"
  local pin_arch="${2:-}"
  local tree_root="${3:-}"
  local url="${4:-}"
  local allow_missing="${5:-0}"
  local host_arch

  host_arch="$(detect_host_target_arch)" || exit 2

  if ! resolve_artifact_target_arch "$pin_arch" "$tree_root" "$url"; then
    if [ "$allow_missing" = "1" ]; then
      log "WARN: no TARGET_ARCH for $label (pin/tree/URL); continuing (ALLOW_MISSING_ARCH=1)"
      return 0
    fi
    err "Arch metadata missing for $label — refuse install (fail closed)."
    err "  Host: uname -m=$(uname -m) → ${host_arch}"
    err "  Need: in-tree TARGET_ARCH (or .seed/build.env), pin BACKEND_ARTIFACT_ARCH / HERMES_ARTIFACT_ARCH,"
    err "        or arch-labeled URL path (…/linux-x86_64/… or …/linux-aarch64/…)."
    err "  Related incident: aarch64 wheels on x86_64 mocklab broke portal chat (ModuleNotFoundError pydantic_core)."
    err "  Pin an arch-matched runtime (default linux-x86_64) or set BACKEND_ALLOW_MISSING_ARCH=1 only for emergency legacy."
    exit 5
  fi

  if [ "$RESOLVED_ARTIFACT_TARGET_ARCH" != "$host_arch" ]; then
    err "Architecture mismatch for $label — refuse install/start (fail closed)."
    err "  Host:     uname -m=$(uname -m) → ${host_arch}"
    err "  Artifact: TARGET_ARCH=${RESOLVED_ARTIFACT_TARGET_ARCH}"
    err "  Do not start hermes-gateway with a wrong-arch runtime (native wheels will fail at import)."
    err "  Fix: pin linux-x86_64 for x86_64 EC2 (e.g. t3.*) or linux-aarch64 for arm64/Graviton."
    exit 5
  fi
  log "Arch OK for $label: host=${host_arch} artifact=${RESOLVED_ARTIFACT_TARGET_ARCH}"
}

# Extract only after download + verify have succeeded.
extract_archive() {
  local archive="$1" dest="$2" source_url="${3:-}" fmt
  mkdir -p "$dest"
  fmt="$(resolve_archive_format "$archive" "$source_url")"
  log "Extracting ($fmt) $archive → $dest"
  case "$fmt" in
    tar.gz) tar -xzf "$archive" -C "$dest" ;;
    tar) tar -xf "$archive" -C "$dest" ;;
    zip)
      command -v unzip >/dev/null 2>&1 || { err "unzip required for zip artifacts"; exit 3; }
      unzip -q "$archive" -d "$dest"
      ;;
    *) err "Unsupported archive format kind: $fmt"; exit 2 ;;
  esac
}

flatten_extract() {
  local dest="$1" top tmp_parent
  local -a entries children staged
  if [ -z "$dest" ] || [ "$dest" = "/" ]; then
    err "Refusing to flatten unsafe destination: ${dest:-<empty>}"
    exit 2
  fi
  shopt -s dotglob nullglob
  entries=("$dest"/*)
  if [ "${#entries[@]}" = "1" ] && [ -d "${entries[0]}" ]; then
    top="${entries[0]}"
    tmp_parent="$(mktemp -d "${dest:?}/.flatten.XXXXXX")"
    children=("$top"/*)
    if [ "${#children[@]}" -gt 0 ]; then
      mv -- "${children[@]}" "$tmp_parent/"
    fi
    rm -rf -- "${top:?}"
    staged=("$tmp_parent"/*)
    if [ "${#staged[@]}" -gt 0 ]; then
      mv -- "${staged[@]}" "$dest/"
    fi
    rmdir -- "$tmp_parent"
  fi
  shopt -u dotglob nullglob
}

_cb_maybe_sudo() {
  if [ "$(id -u)" = "0" ]; then
    "$@"
    return $?
  fi
  if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    sudo -n "$@"
    return $?
  fi
  return 1
}

# Return 0 if install steps need elevated privileges.
_install_need_sudo() {
  local root="${BACKEND_INSTALL_ROOT:-/opt/company-brain-backend}" p
  if [ "$(id -u)" = "0" ]; then
    return 1
  fi
  p="$root"
  while [ ! -e "$p" ]; do
    p="$(dirname "$p")"
    if [ "$p" = "/" ]; then
      break
    fi
  done
  if [ -w "$p" ]; then
    return 1
  fi
  return 0
}

run_as_install() {
  # Use sudo only when BACKEND_INSTALL_ROOT is not creatable/writable as self
  # (production /opt/...). Offline smoke under $TMP runs without sudo.
  if _install_need_sudo; then
    if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
      sudo -n "$@"
      return $?
    fi
    if command -v sudo >/dev/null 2>&1; then
      sudo "$@"
      return $?
    fi
    err "Cannot write under ${BACKEND_INSTALL_ROOT:-} (need root or sudo)"
    return 1
  fi
  "$@"
}

# Compare existing provenance to requested pins (idempotent fast path).
provenance_matches_pins() {
  local path="$1"
  [ -f "$path" ] || return 1
  BACKEND_KIND_EXPECT="$BACKEND_ARTIFACT_KIND" \
  BACKEND_VER_EXPECT="$BACKEND_ARTIFACT_VERSION" \
  BACKEND_URL_EXPECT="$BACKEND_ARTIFACT_URL" \
  BACKEND_SHA_EXPECT="$BACKEND_ARTIFACT_SHA256" \
  BACKEND_RL_EXPECT="$BACKEND_CONTRACT_RUNTIME_LAYOUT" \
  BACKEND_RELAY_EXPECT="$BACKEND_CONTRACT_RELAY" \
  BACKEND_RPC_EXPECT="$BACKEND_CONTRACT_BRAIN_RPC" \
  python3 - "$path" <<'PY'
import json, os, sys
path = sys.argv[1]
try:
    d = json.load(open(path, encoding="utf-8"))
except Exception:
    sys.exit(1)
def s(x):
    return str(x).strip()
checks = [
    (s(d.get("kind")), os.environ["BACKEND_KIND_EXPECT"]),
    (s(d.get("version")), os.environ["BACKEND_VER_EXPECT"]),
    (s(d.get("url")), os.environ["BACKEND_URL_EXPECT"]),
    (s(d.get("sha256")).lower().replace("sha256:", "", 1), os.environ["BACKEND_SHA_EXPECT"]),
]
c = d.get("contract") or {}
checks += [
    (s(c.get("runtime_layout")), s(os.environ["BACKEND_RL_EXPECT"])),
    (s(c.get("relay")), s(os.environ["BACKEND_RELAY_EXPECT"])),
    (s(c.get("brain_rpc")), s(os.environ["BACKEND_RPC_EXPECT"])),
]
sys.exit(0 if all(a == b for a, b in checks) else 1)
PY
}

write_provenance_json() {
  local dest_dir="$1"
  local prov_dir="$dest_dir/.seed"
  local prov_file="$prov_dir/provenance.json"
  local installed_at current_abs

  installed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  current_abs="${BACKEND_INSTALL_ROOT}/current"

  run_as_install mkdir -p "$prov_dir"

  # shellcheck disable=SC2016
  BACKEND_KIND="$BACKEND_ARTIFACT_KIND" \
  BACKEND_VER="$BACKEND_ARTIFACT_VERSION" \
  BACKEND_URL="$BACKEND_ARTIFACT_URL" \
  BACKEND_SHA="$BACKEND_ARTIFACT_SHA256" \
  BACKEND_RL="$BACKEND_CONTRACT_RUNTIME_LAYOUT" \
  BACKEND_RELAY="$BACKEND_CONTRACT_RELAY" \
  BACKEND_RPC="$BACKEND_CONTRACT_BRAIN_RPC" \
  BACKEND_ROOT="$BACKEND_INSTALL_ROOT" \
  BACKEND_PATH="$dest_dir" \
  BACKEND_LAYOUT="$BACKEND_INSTALL_LAYOUT" \
  BACKEND_CURRENT="$current_abs" \
  BACKEND_ATTEST="$BACKEND_ATTESTATION_STATUS" \
  BACKEND_ATTEST_ALG="ed25519" \
  BACKEND_PUB_FP="${ARTIFACT_SIGNING_PUBKEY_FINGERPRINT:-}" \
  BACKEND_SIGN_ID="${ARTIFACT_SIGNING_IDENTITY:-}" \
  BACKEND_ENTRY="$BACKEND_ENTRYPOINT" \
  BACKEND_INSTALLED_AT="$installed_at" \
  python3 - <<'PY' | run_as_install tee "$prov_file" >/dev/null
import json, os
doc = {
    "schema_version": 1,
    "kind": os.environ["BACKEND_KIND"],
    "version": os.environ["BACKEND_VER"],
    "url": os.environ["BACKEND_URL"],
    "sha256": os.environ["BACKEND_SHA"],
    "contract": {
        "runtime_layout": int(os.environ["BACKEND_RL"]),
        "relay": int(os.environ["BACKEND_RELAY"]),
        "brain_rpc": int(os.environ["BACKEND_RPC"]),
    },
    "installed_at": os.environ["BACKEND_INSTALLED_AT"],
    "install_root": os.environ["BACKEND_ROOT"],
    "install_path": os.environ["BACKEND_PATH"],
    "layout": os.environ["BACKEND_LAYOUT"],
    "current_symlink": os.environ["BACKEND_CURRENT"],
    "attestation_status": os.environ["BACKEND_ATTEST"],
    "attestation_alg": os.environ["BACKEND_ATTEST_ALG"],
    "signing_pubkey_sha256": os.environ.get("BACKEND_PUB_FP") or "",
    "signing_identity": os.environ.get("BACKEND_SIGN_ID") or "",
    "entrypoint": os.environ.get("BACKEND_ENTRY") or "bin/company-brain-backend",
    "bootstrap": "artifact",
}
print(json.dumps(doc, indent=2, sort_keys=False))
print()  # trailing newline
PY
  log "Wrote provenance $prov_file"
}

# Point current at versions/<version> using a relative symlink target.
ensure_current_symlink() {
  local root="$1" version="$2"
  local current="$root/current"
  local target="versions/${version}"
  run_as_install mkdir -p "$root/versions"
  # Atomic-ish replace: ln -sfn is the host contract for selection.
  if [ -L "$current" ] || [ -e "$current" ]; then
    run_as_install ln -sfn "$target" "$current"
  else
    run_as_install ln -sfn "$target" "$current"
  fi
  log "current → $target ($current)"
  # Resolve check (best-effort)
  if [ -d "$root/$target" ]; then
    log "Active backend path: $root/$target"
  fi
}

# Full install path: verify-before-extract is enforced here.
install_backend_versioned() {
  local root version url sha kind archive stage version_dir prov

  root="$BACKEND_INSTALL_ROOT"
  version="$BACKEND_ARTIFACT_VERSION"
  url="$BACKEND_ARTIFACT_URL"
  sha="$BACKEND_ARTIFACT_SHA256"
  kind="$BACKEND_ARTIFACT_KIND"
  version_dir="${root}/versions/${version}"
  prov="${version_dir}/.seed/provenance.json"
  archive="${DOWNLOAD_DIR}/backend-${version}.artifact"

  log "=== Backend install (versioned) kind=$kind version=$version → $root ==="

  if [ "$BACKEND_INSTALL_LAYOUT" != "versioned" ]; then
    err "Only BACKEND_INSTALL_LAYOUT=versioned is implemented in this reference script (got: $BACKEND_INSTALL_LAYOUT)."
    err "Flat layout remains temporary migration mode; see design doc."
    exit 2
  fi

  run_as_install mkdir -p "$root/versions"
  mkdir -p "$DOWNLOAD_DIR"
  chmod 700 "$DOWNLOAD_DIR" 2>/dev/null || true

  if [ "$BACKEND_INSTALL_FORCE" != "1" ] && provenance_matches_pins "$prov"; then
    log "Provenance matches pins for $version — skip download/extract (idempotent)"
    # Still fail closed if this host cannot run the already-extracted tree.
    require_host_arch_match "backend@${version}" "${BACKEND_ARTIFACT_ARCH:-}" "$version_dir" "$url" \
      "${BACKEND_ALLOW_MISSING_ARCH:-0}"
    ensure_current_symlink "$root" "$version"
    log "Done backend install (fast path)."
    return 0
  fi

  # Early arch gate when pin or URL already declares platform (before download).
  if [ -n "${BACKEND_ARTIFACT_ARCH:-}" ] && ! is_unconfigured "${BACKEND_ARTIFACT_ARCH:-}"; then
    require_host_arch_match "backend@${version}" "$BACKEND_ARTIFACT_ARCH" "" "$url" \
      "${BACKEND_ALLOW_MISSING_ARCH:-0}"
  elif infer_target_arch_from_url "$url" >/dev/null 2>&1; then
    require_host_arch_match "backend@${version}" "" "" "$url" \
      "${BACKEND_ALLOW_MISSING_ARCH:-0}"
  fi

  # --- verify-before-extract boundary ---
  download_artifact "$url" "$archive"
  verify_sha256 "$archive" "$sha" "backend@${version}"
  verify_artifact_attestation "$archive" "$BACKEND_ARTIFACT_SIGNATURE_B64" "backend@${version}"
  BACKEND_ATTESTATION_STATUS="$ATTESTATION_LAST_STATUS"
  # --- extraction only after successful verify ---

  stage="$(mktemp -d "${DOWNLOAD_DIR}/backend-stage.XXXXXX")"
  extract_archive "$archive" "$stage" "$url"
  flatten_extract "$stage"

  # Fail closed on arch mismatch before materializing install tree / starting gateway.
  require_host_arch_match "backend@${version}" "${BACKEND_ARTIFACT_ARCH:-}" "$stage" "$url" \
    "${BACKEND_ALLOW_MISSING_ARCH:-0}"

  run_as_install mkdir -p "$version_dir"
  if command -v rsync >/dev/null 2>&1; then
    run_as_install rsync -a --delete --exclude '.seed' "$stage"/ "$version_dir"/
  else
    # Fallback without rsync: wipe tree carefully then copy
    log "WARN: rsync not found; using rm+cp fallback"
    run_as_install find "$version_dir" -mindepth 1 -maxdepth 1 ! -name '.seed' -exec rm -rf {} +
    run_as_install cp -a "$stage"/. "$version_dir"/
  fi
  rm -rf "$stage"

  write_provenance_json "$version_dir"
  ensure_current_symlink "$root" "$version"

  if [ -d "${version_dir}/bin" ]; then
    log "bin/ present under $version_dir"
  else
    log "WARN: no bin/ under $version_dir — check artifact layout / entrypoint"
  fi

  log "Done backend install (versioned)."
}

# ---------------------------------------------------------------------------
# Lib-only early exit
# ---------------------------------------------------------------------------
if [ "${BOOTSTRAP_BACKEND_INSTALL_LIB_ONLY:-0}" = "1" ]; then
  if [ "${BASH_SOURCE[0]}" != "$0" ]; then
    return 0
  fi
  exit 0
fi

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
require_artifact_url "BACKEND_ARTIFACT_URL" "$BACKEND_ARTIFACT_URL"
require_artifact_version "BACKEND_ARTIFACT_VERSION" "$BACKEND_ARTIFACT_VERSION"
require_pin "BACKEND_ARTIFACT_SHA256" "$BACKEND_ARTIFACT_SHA256"
require_pin "BACKEND_ARTIFACT_KIND" "$BACKEND_ARTIFACT_KIND"
require_pin "BACKEND_CONTRACT_RUNTIME_LAYOUT" "$BACKEND_CONTRACT_RUNTIME_LAYOUT"
require_pin "BACKEND_CONTRACT_RELAY" "$BACKEND_CONTRACT_RELAY"
require_pin "BACKEND_CONTRACT_BRAIN_RPC" "$BACKEND_CONTRACT_BRAIN_RPC"

case "$BACKEND_ARTIFACT_KIND" in
  hermes_upstream|hermes_lanyard|lanyard_agent) ;;
  *)
    err "BACKEND_ARTIFACT_KIND must be hermes_upstream|hermes_lanyard|lanyard_agent (got: $BACKEND_ARTIFACT_KIND)"
    exit 2
    ;;
esac

for n in BACKEND_CONTRACT_RUNTIME_LAYOUT BACKEND_CONTRACT_RELAY BACKEND_CONTRACT_BRAIN_RPC; do
  eval "v=\$$n"
  if ! echo "$v" | grep -Eq '^[0-9]+$' || [ "$v" -lt 1 ]; then
    err "$n must be an integer >= 1 (got: $v)"
    exit 2
  fi
done

BACKEND_ARTIFACT_SHA256="$(normalize_sha "$BACKEND_ARTIFACT_SHA256")"
if ! echo "$BACKEND_ARTIFACT_SHA256" | grep -Eq '^[a-f0-9]{64}$'; then
  err "BACKEND_ARTIFACT_SHA256 must be a 64-char hex digest (got: $BACKEND_ARTIFACT_SHA256)"
  exit 2
fi

if [ -z "$BACKEND_INSTALL_ROOT" ] || [ "$BACKEND_INSTALL_ROOT" = "/" ]; then
  err "BACKEND_INSTALL_ROOT is unsafe or empty: ${BACKEND_INSTALL_ROOT:-<empty>}"
  exit 2
fi

trap cleanup_attestation_tmp EXIT
install_backend_versioned
