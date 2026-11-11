#!/usr/bin/env bash
# Company Brain host bootstrap: pin download/verify (SHA-256 + optional Ed25519), Hermes then client-core seed.
# Dual path: s3:// (instance role) | private GitHub HTTPS (GITHUB_TOKEN/GH_TOKEN, never commit) | plain https.
# No git clone. Injected base64gzip into EC2 user_data — keep this file size-sensitive.
set -euo pipefail

if [ -f /etc/company-brain/artifact-pins.env ]; then
  # shellcheck disable=SC1091
  set -a
  # shellcheck source=/dev/null
  source /etc/company-brain/artifact-pins.env
  set +a
fi

CLIENT_CORE_ARTIFACT_URL="${CLIENT_CORE_ARTIFACT_URL:-UNCONFIGURED}"
CLIENT_CORE_ARTIFACT_VERSION="${CLIENT_CORE_ARTIFACT_VERSION:-UNCONFIGURED}"
CLIENT_CORE_ARTIFACT_SHA256="${CLIENT_CORE_ARTIFACT_SHA256:-UNCONFIGURED}"
CLIENT_CORE_ARTIFACT_SIGNATURE_B64="${CLIENT_CORE_ARTIFACT_SIGNATURE_B64:-}"
HERMES_ARTIFACT_URL="${HERMES_ARTIFACT_URL:-UNCONFIGURED}"
HERMES_ARTIFACT_VERSION="${HERMES_ARTIFACT_VERSION:-UNCONFIGURED}"
HERMES_ARTIFACT_SHA256="${HERMES_ARTIFACT_SHA256:-UNCONFIGURED}"
HERMES_ARTIFACT_SIGNATURE_B64="${HERMES_ARTIFACT_SIGNATURE_B64:-}"
# Target platform for Hermes runtime wheels (lp-2md.3). linux-x86_64|linux-aarch64.
HERMES_ARTIFACT_ARCH="${HERMES_ARTIFACT_ARCH:-${BACKEND_ARTIFACT_ARCH:-}}"
# Emergency only: allow unlabeled legacy tarballs (default fail-closed).
HERMES_ALLOW_MISSING_ARCH="${HERMES_ALLOW_MISSING_ARCH:-${BACKEND_ALLOW_MISSING_ARCH:-0}}"
ARTIFACT_SIGNING_PUBKEY="${ARTIFACT_SIGNING_PUBKEY:-}"
ARTIFACT_SIGNING_PUBKEY_B64="${ARTIFACT_SIGNING_PUBKEY_B64:-}"
ARTIFACT_SIGNING_PUBKEY_FILE="${ARTIFACT_SIGNING_PUBKEY_FILE:-}"
ARTIFACT_SIGNING_IDENTITY="${ARTIFACT_SIGNING_IDENTITY:-}"
REQUIRE_ARTIFACT_ATTESTATION="${REQUIRE_ARTIFACT_ATTESTATION:-0}"
RELAY_CONTRACT_MAJOR="${RELAY_CONTRACT_MAJOR:-1}"
VAULT_ROOT="${VAULT_ROOT:-/opt/company-brain}"
HERMES_INSTALL_PATH="${HERMES_INSTALL_PATH:-/opt/hermes-lanyard}"
PACKS="${PACKS:-}"
HERMES_HOME="${HERMES_HOME:-${HOME:-/home/ec2-user}/.hermes}"
DOWNLOAD_DIR="${DOWNLOAD_DIR:-/var/tmp/company-brain-artifacts}"

HERMES_ATTESTATION_STATUS="skipped"
CLIENT_CORE_ATTESTATION_STATUS="skipped"
ARTIFACT_SIGNING_PUBKEY_FINGERPRINT=""
_ATTESTATION_PUBKEY_PATH=""
_ATTESTATION_PUBKEY_TMP=""

usage() {
  cat <<EOF
Usage: $0 [options]

Artifact contract (required; fail if UNCONFIGURED/empty):
  --client-core-url URL
  --client-core-version VER
  --client-core-sha256 HEX
  --hermes-url URL
  --hermes-version VER
  --hermes-sha256 HEX
  --relay-contract-major N

Optional Ed25519 attestation (openssl; on top of required SHA-256):
  env CLIENT_CORE_ARTIFACT_SIGNATURE_B64 / HERMES_ARTIFACT_SIGNATURE_B64
  env ARTIFACT_SIGNING_PUBKEY_B64 | ARTIFACT_SIGNING_PUBKEY_FILE | ARTIFACT_SIGNING_PUBKEY
  env ARTIFACT_SIGNING_IDENTITY   (label recorded in provenance)
  env REQUIRE_ARTIFACT_ATTESTATION=1  (fail-closed if signature/pubkey missing)

Paths:
  --vault-root PATH          (default: /opt/company-brain)
  --hermes-install-path PATH (default: /opt/hermes-lanyard)
  --packs a,b                optional client-core packs after seed

Environment variables of the same names are also accepted.
Pins may be pre-seeded in /etc/company-brain/artifact-pins.env by user_data.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --client-core-url) CLIENT_CORE_ARTIFACT_URL="$2"; shift 2 ;;
    --client-core-version) CLIENT_CORE_ARTIFACT_VERSION="$2"; shift 2 ;;
    --client-core-sha256) CLIENT_CORE_ARTIFACT_SHA256="$2"; shift 2 ;;
    --hermes-url) HERMES_ARTIFACT_URL="$2"; shift 2 ;;
    --hermes-version) HERMES_ARTIFACT_VERSION="$2"; shift 2 ;;
    --hermes-sha256) HERMES_ARTIFACT_SHA256="$2"; shift 2 ;;
    --relay-contract-major) RELAY_CONTRACT_MAJOR="$2"; shift 2 ;;
    --vault-root) VAULT_ROOT="$2"; shift 2 ;;
    --hermes-install-path) HERMES_INSTALL_PATH="$2"; shift 2 ;;
    --packs) PACKS="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

log() { echo "[bootstrap-host] $*"; }
err() { echo "[bootstrap-host] ERROR: $*" >&2; }

is_unconfigured() {
  local v="${1:-}"
  [ -z "$v" ] || [ "$v" = "UNCONFIGURED" ] || [ "$v" = "REPLACE_ME" ]
}

require_pin() {
  local name="$1" value="$2"
  if is_unconfigured "$value"; then
    err "Artifact pin '$name' is unconfigured or empty."
    err "Set it via environment, /etc/company-brain/artifact-pins.env, or CLI flags."
    err "See artifacts/README.md in company-brain-deploy."
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
    git://*|git@*|ssh://git@*)
      return 0
      ;;
  esac
  if echo "$url" | grep -Eq '\.git($|[?#/])'; then
    return 0
  fi
  if echo "$url" | grep -Eqi '(github\.com|gitlab\.com)/[^/]+/[^/]+/(tree|blob|raw)/'; then
    return 0
  fi
  return 1
}

is_insecure_artifact_url() {
  local url="${1:-}"
  case "$url" in
    http://*|ws://*|wss://*|ftp://*|file://*)
      return 0
      ;;
  esac
  return 1
}

require_artifact_url() {
  local name="$1" url="$2"
  require_pin "$name" "$url"
  if is_git_remote_url "$url"; then
    err "Artifact pin '$name' looks like a git remote or source-tree URL, not a release object."
    err "  value: $url"
    err "Use an immutable s3:// or https:// artifact object (see artifacts/README.md)."
    exit 2
  fi
  if is_insecure_artifact_url "$url"; then
    err "Artifact pin '$name' uses an insecure or non-artifact URL scheme."
    err "  value: $url"
    err "Allowed schemes: s3:// or https:// only (http://, ws://, and other schemes are rejected)."
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
    err "Pin an immutable release version (e.g. v0.1.0), never main/master/HEAD/latest."
    exit 2
  fi
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
  local ref="$1"
  local base
  base="$(url_path_basename "$ref")"
  case "$base" in
    *.tar.gz|*.tgz) echo "tar.gz" ;;
    *.tar) echo "tar" ;;
    *.zip) echo "zip" ;;
    *) echo "" ;;
  esac
}

archive_format_from_magic() {
  local file="$1"
  local hdr
  if [ ! -f "$file" ] || [ ! -r "$file" ]; then
    echo ""
    return 0
  fi
  hdr="$(od -An -tx1 -N4 "$file" 2>/dev/null | tr -d ' \n')"
  case "$hdr" in
    1f8b*)
      echo "tar.gz"
      return 0
      ;;
    504b0304|504b0506|504b0708)
      echo "zip"
      return 0
      ;;
  esac
  if [ "$(dd if="$file" bs=1 skip=257 count=5 2>/dev/null)" = "ustar" ]; then
    echo "tar"
    return 0
  fi
  echo ""
}

resolve_archive_format() {
  local file="$1"
  local source_url="${2:-}"
  local fmt=""

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
    err "  source_url: ${source_url:-n/a}"
    err "Supported: .tar.gz / .tgz / .tar / .zip (from URL path or content magic)."
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
# Private GH assets need API + token (browser /releases/download often 404). Never log token.
download_github_release_asset() {
  local url="$1" dest="$2" token api owner repo tag name
  if ! token="$(github_auth_token)"; then
    err "Private GitHub download requires GITHUB_TOKEN or GH_TOKEN (env only; never commit)."
    err "Prefer s3:// pins + instance role when the platform bucket has the object."
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

download_artifact() {
  local url="$1" dest="$2"
  log "Downloading $url → $dest"
  if is_insecure_artifact_url "$url"; then
    err "Refusing download over insecure scheme: $url"
    err "Allowed: s3:// or https:// only."
    exit 2
  fi
  case "$url" in
    s3://*)
      if ! command -v aws >/dev/null 2>&1; then
        err "aws CLI required for s3:// artifact URLs (install awscli; instance role supplies credentials)."
        exit 3
      fi
      aws s3 cp "$url" "$dest"
      ;;
    https://*)
      if is_github_api_asset_url "$url" || { is_github_release_download_url "$url" && github_auth_token >/dev/null 2>&1; }; then
        download_github_release_asset "$url" "$dest"
      elif command -v curl >/dev/null 2>&1; then
        if ! curl -fsSL --retry 3 -o "$dest" "$url"; then
          if is_github_release_download_url "$url"; then
            err "GitHub release download failed (private repos need GITHUB_TOKEN/GH_TOKEN; never commit tokens)."
          fi
          exit 3
        fi
      elif command -v wget >/dev/null 2>&1; then
        if ! wget -q -O "$dest" "$url"; then
          if is_github_release_download_url "$url"; then
            err "GitHub release download failed (private repos need GITHUB_TOKEN/GH_TOKEN; never commit tokens)."
          fi
          exit 3
        fi
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

  _ATTESTATION_PUBKEY_TMP="$(mktemp "${TMPDIR:-/tmp}/cb-artifact-pubkey.XXXXXX")"
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
  if ! command -v openssl >/dev/null 2>&1; then
    echo ""
    return 1
  fi
  openssl pkey -pubin -in "$pub" -outform DER 2>/dev/null | sha256sum | awk '{print $1}'
}

verify_ed25519_signature() {
  local file="$1" sig_b64="$2" pubkey_file="$3" label="$4"
  local sig_file out rc

  if ! command -v openssl >/dev/null 2>&1; then
    err "openssl is required to verify artifact attestation for $label."
    exit 3
  fi

  if [ ! -f "$file" ]; then
    err "Artifact file missing for attestation: $file ($label)"
    exit 6
  fi
  if [ ! -f "$pubkey_file" ]; then
    err "Signing public key file missing for $label: $pubkey_file"
    exit 6
  fi

  sig_file="$(mktemp "${TMPDIR:-/tmp}/cb-artifact-sig.XXXXXX")"
  if ! printf '%s' "$sig_b64" | tr -d '[:space:]' | base64 -d >"$sig_file" 2>/dev/null; then
    rm -f "$sig_file"
    err "Artifact signature for $label is not valid base64."
    exit 6
  fi
  if [ ! -s "$sig_file" ]; then
    rm -f "$sig_file"
    err "Artifact signature for $label decoded to empty bytes."
    exit 6
  fi

  out="$(openssl pkeyutl -verify -pubin -inkey "$pubkey_file" -sigfile "$sig_file" -rawin -in "$file" 2>&1)" || rc=$?
  rc="${rc:-0}"
  rm -f "$sig_file"

  if [ "$rc" -ne 0 ] || ! echo "$out" | grep -qi 'Signature Verified Successfully'; then
    err "Ed25519 signature verification FAILED for $label (fail-closed)."
    err "  file: $file"
    err "  openssl: ${out:-exit $rc}"
    err "  Ensure *ARTIFACT_SIGNATURE_B64 matches the publisher signature over the exact artifact bytes."
    exit 6
  fi
  log "Ed25519 signature OK for $label"
}

ATTESTATION_LAST_STATUS="skipped"
verify_artifact_attestation() {
  local file="$1" sig_b64="$2" label="$3"
  local require="${REQUIRE_ARTIFACT_ATTESTATION:-0}"
  local has_sig=0
  ATTESTATION_LAST_STATUS="skipped"

  if has_sig_pin "$sig_b64"; then
    has_sig=1
  fi

  if [ "$has_sig" = "0" ]; then
    if [ "$require" = "1" ]; then
      err "REQUIRE_ARTIFACT_ATTESTATION=1 but signature pin is missing for $label."
      err "Set HERMES_ARTIFACT_SIGNATURE_B64 / CLIENT_CORE_ARTIFACT_SIGNATURE_B64 (base64 Ed25519 sig)."
      err "See artifacts/README.md (Signed attestation)."
      exit 6
    fi
    log "Attestation skipped for $label (no signature pin; lab mode — SHA-256 only)"
    ATTESTATION_LAST_STATUS="skipped"
    return 0
  fi

  if ! resolve_signing_pubkey_file; then
    err "Signature pin set for $label but no signing public key configured."
    err "Set ARTIFACT_SIGNING_PUBKEY_B64, ARTIFACT_SIGNING_PUBKEY_FILE, or ARTIFACT_SIGNING_PUBKEY."
    exit 6
  fi

  if [ -z "${ARTIFACT_SIGNING_PUBKEY_FINGERPRINT:-}" ]; then
    ARTIFACT_SIGNING_PUBKEY_FINGERPRINT="$(signing_pubkey_fingerprint "$_ATTESTATION_PUBKEY_PATH" || true)"
    if [ -z "$ARTIFACT_SIGNING_PUBKEY_FINGERPRINT" ]; then
      err "Could not fingerprint signing public key (openssl pkey)."
      exit 6
    fi
  fi

  verify_ed25519_signature "$file" "$sig_b64" "$_ATTESTATION_PUBKEY_PATH" "$label"
  log "Attestation identity fingerprint sha256:$ARTIFACT_SIGNING_PUBKEY_FINGERPRINT${ARTIFACT_SIGNING_IDENTITY:+ ($ARTIFACT_SIGNING_IDENTITY)}"
  ATTESTATION_LAST_STATUS="verified"
}

require_attestation_config_if_needed() {
  local require="${REQUIRE_ARTIFACT_ATTESTATION:-0}"
  if [ "$require" != "1" ]; then
    return 0
  fi
  if ! resolve_signing_pubkey_file; then
    err "REQUIRE_ARTIFACT_ATTESTATION=1 requires a signing public key."
    err "Set ARTIFACT_SIGNING_PUBKEY_B64 (base64 of PEM) or ARTIFACT_SIGNING_PUBKEY_FILE."
    exit 6
  fi
  ARTIFACT_SIGNING_PUBKEY_FINGERPRINT="$(signing_pubkey_fingerprint "$_ATTESTATION_PUBKEY_PATH" || true)"
  if [ -z "$ARTIFACT_SIGNING_PUBKEY_FINGERPRINT" ]; then
    err "REQUIRE_ARTIFACT_ATTESTATION=1: could not fingerprint signing public key."
    exit 6
  fi
  log "Artifact attestation required; pubkey fingerprint sha256:$ARTIFACT_SIGNING_PUBKEY_FINGERPRINT"
}

extract_archive() {
  local archive="$1" dest="$2" source_url="${3:-}"
  local fmt
  mkdir -p "$dest"
  fmt="$(resolve_archive_format "$archive" "$source_url")"
  log "Extracting ($fmt) $archive → $dest"
  case "$fmt" in
    tar.gz)
      tar -xzf "$archive" -C "$dest"
      ;;
    tar)
      tar -xf "$archive" -C "$dest"
      ;;
    zip)
      if ! command -v unzip >/dev/null 2>&1; then
        err "unzip required to extract zip artifacts."
        exit 3
      fi
      unzip -q "$archive" -d "$dest"
      ;;
    *)
      err "Unsupported archive format kind: $fmt (use .tar.gz / .tgz / .tar / .zip)"
      exit 2
      ;;
  esac
}

# lp-2md.3 arch fail-closed (compact: user_data size budget). pin > tree > URL.
require_hermes_host_arch_match() {
  local stage="$1" url="${2:-}" pin="${3:-}" allow="${4:-0}" hm ha ar="" t=""
  hm="$(uname -m)"
  case "$hm" in x86_64|amd64) ha=linux-x86_64 ;; aarch64|arm64) ha=linux-aarch64 ;;
    *) err "Unsupported host arch uname -m=$hm"; exit 5 ;; esac
  case "$(echo "${pin:-}" | tr '[:upper:]' '[:lower:]')" in
    ""|unconfigured|replace_me) ;;
    linux-x86_64|linux_x86_64|linux/x86_64|x86_64|amd64) ar=linux-x86_64 ;;
    linux-aarch64|linux_aarch64|linux-arm64|linux_arm64|aarch64|arm64) ar=linux-aarch64 ;;
    *) err "Invalid HERMES_ARTIFACT_ARCH=$pin (use linux-x86_64|linux-aarch64)"; exit 2 ;;
  esac
  if [ -z "$ar" ] && [ -n "$stage" ] && [ -d "$stage" ]; then
    [ -f "$stage/TARGET_ARCH" ] && t="$(tr -d '[:space:]' <"$stage/TARGET_ARCH" || true)"
    [ -z "$t" ] && [ -f "$stage/.seed/build.env" ] && \
      t="$(grep -m1 '^TARGET_ARCH=' "$stage/.seed/build.env" 2>/dev/null | cut -d= -f2- | tr -d '[:space:]' || true)"
    case "$(echo "$t" | tr '[:upper:]' '[:lower:]')" in
      linux-x86_64|linux_x86_64|x86_64|amd64) ar=linux-x86_64 ;;
      linux-aarch64|linux-arm64|aarch64|arm64) ar=linux-aarch64 ;;
    esac
  fi
  if [ -z "$ar" ]; then
    case "$url" in
      */linux-x86_64/*|*/linux_x86_64/*) ar=linux-x86_64 ;;
      */linux-aarch64/*|*/linux-arm64/*|*/linux_arm64/*) ar=linux-aarch64 ;;
    esac
  fi
  if [ -z "$ar" ]; then
    [ "$allow" = "1" ] && { log "WARN: no TARGET_ARCH (HERMES_ALLOW_MISSING_ARCH=1)"; return 0; }
    err "Hermes missing TARGET_ARCH (host=$ha). Pin arch-labeled runtime or HERMES_ARTIFACT_ARCH. Do not start hermes-gateway."
    exit 5
  fi
  if [ "$ar" != "$ha" ]; then
    err "Arch mismatch hermes: host=$ha artifact=$ar — refuse install; do not start hermes-gateway."
    exit 5
  fi
  log "Arch OK hermes: $ha"
}

flatten_extract() {
  local dest="$1"
  local top tmp_parent
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

HERMES_ADMIN_ONLY_CAPABILITIES="profile_manage system_ops shell_exec gateway_config beads_admin vault_full"

write_hermes_profile_seed() {
  local dest="$1" name="$2" role="$3"
  local caps_json path_prefixes_json description workdir

  case "$role" in
    admin)
      description="Full vault and ops capabilities for tenant administrators"
      workdir=""
      path_prefixes_json='["/"]'
      caps_json='["vault_full","vault_read","vault_write","chat","profile_manage","system_ops","shell_exec","gateway_config","beads_admin"]'
      ;;
    contributor)
      description="Day-to-day authoring within allowed path prefixes (no ops elevation)"
      workdir=""
      path_prefixes_json='[]'
      caps_json='["vault_read","vault_write","chat"]'
      ;;
    *)
      err "Unknown Hermes profile role: $role"
      return 1
      ;;
  esac

  cat >"$dest" <<EOF
{
  "name": "${name}",
  "role": "${role}",
  "description": "${description}",
  "workdir": "${workdir}",
  "path_prefixes": ${path_prefixes_json},
  "capabilities": ${caps_json},
  "enforced_by": "company-brain-bootstrap",
  "schema_version": 1
}
EOF
}

verify_contributor_not_elevated() {
  local file="$1"
  local cap
  [ -f "$file" ] || { err "Missing contributor profile seed: $file"; return 1; }
  for cap in $HERMES_ADMIN_ONLY_CAPABILITIES; do
    if grep -Eq "\"${cap}\"" "$file"; then
      err "Contributor profile elevation blocked: capability '$cap' must not appear in $file"
      return 1
    fi
  done
  grep -Eq '"vault_read"' "$file" || { err "Contributor profile missing vault_read in $file"; return 1; }
  grep -Eq '"vault_write"' "$file" || { err "Contributor profile missing vault_write in $file"; return 1; }
  grep -Eq '"chat"' "$file" || { err "Contributor profile missing chat in $file"; return 1; }
  return 0
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

ensure_hermes_profiles() {
  local hermes_home="${1:-$HERMES_HOME}"
  local require_flag="${REQUIRE_HERMES_PROFILES:-0}"
  local profiles_dir system_dir admin_f contrib_f
  local wrote=0

  profiles_dir="${hermes_home}/profiles"
  system_dir="/etc/company-brain/hermes-profiles"

  if ! mkdir -p "$profiles_dir" 2>/dev/null; then
    _cb_maybe_sudo mkdir -p "$profiles_dir" || true
    _cb_maybe_sudo chown "$(id -u):$(id -g)" "$profiles_dir" || true
  fi
  if [ ! -d "$profiles_dir" ]; then
    err "Cannot create Hermes profiles directory: $profiles_dir"
    if [ "$require_flag" = "1" ]; then
      err "REQUIRE_HERMES_PROFILES=1 — refusing to continue without profile seeds."
      exit 5
    fi
    log "WARN: Hermes profiles not written (non-fatal unless REQUIRE_HERMES_PROFILES=1)"
    return 0
  fi

  admin_f="${profiles_dir}/admin.json"
  contrib_f="${profiles_dir}/contributor.json"
  write_hermes_profile_seed "$admin_f" "admin" "admin"
  write_hermes_profile_seed "$contrib_f" "contributor" "contributor"
  wrote=1

  if ! verify_contributor_not_elevated "$contrib_f"; then
    err "RBAC seed validation failed — contributor must not hold admin-only capabilities."
    exit 5
  fi
  if ! grep -Eq '"profile_manage"|"system_ops"|"vault_full"' "$admin_f"; then
    err "Admin profile seed missing admin-only capabilities: $admin_f"
    exit 5
  fi

  if mkdir -p "$system_dir" 2>/dev/null || _cb_maybe_sudo mkdir -p "$system_dir"; then
    if [ -w "$system_dir" ] 2>/dev/null; then
      cp -f "$admin_f" "$contrib_f" "$system_dir/" 2>/dev/null || true
    else
      _cb_maybe_sudo cp -f "$admin_f" "$contrib_f" "$system_dir/" || true
    fi
  fi

  if command -v hermes >/dev/null 2>&1; then
    log "Hermes CLI present — profile seeds written under $profiles_dir"
  fi

  if [ "$wrote" = "1" ]; then
    log "Hermes profiles enforced: admin + contributor under $profiles_dir"
    log "  admin capabilities include vault_full/ops; contributor is authoring-only (elevation blocked)"
  fi
}

# Omnibox Mode A (cbd-o9s.10): ENABLE_OMNIBOX=1 → ensure-omnibox. ExecStart stays Hermes.
ensure_omnibox_mode_a() {
  local e="${ENABLE_OMNIBOX:-${OMNIBOX_ENABLED:-0}}" s="" c h
  case "$e" in 1|true|TRUE|yes|YES) ;; *)
    log "Omnibox skipped (ENABLE_OMNIBOX=$e; enable_omnibox default false)"; return 0 ;;
  esac
  log "=== Omnibox Mode A after profiles (ensure-omnibox) ==="
  h=""
  _omnibox_script_dir="$(dirname "${BASH_SOURCE[0]:-$0}")"
  if h_try="$(cd "$_omnibox_script_dir" 2>/dev/null && pwd)"; then
    h="$h_try"
  fi
  unset _omnibox_script_dir h_try
  for c in "${ENSURE_OMNIBOX_SCRIPT:-}" /usr/local/sbin/company-brain-ensure-omnibox \
    "${COMPANY_BRAIN_DEPLOY_ROOT:-}/scripts/ensure-omnibox.sh" \
    "$h/ensure-omnibox.sh" "$h/../scripts/ensure-omnibox.sh"; do
    [ -n "$c" ] && [ -f "$c" ] && s="$c" && break
  done
  if [ -z "$s" ]; then
    log "WARN: ENABLE_OMNIBOX=1 but ensure-omnibox.sh missing (sudo ENABLE_OMNIBOX=1 bash scripts/ensure-omnibox.sh)"
    [ "${OMNIBOX_REQUIRED:-0}" = "1" ] && { err "OMNIBOX_REQUIRED=1; ensure-omnibox missing"; exit 6; }
    return 0
  fi
  export ENABLE_OMNIBOX=1 OMNIBOX_ENABLED=1
  export OMNIBOX_CONFIG_DIR="${OMNIBOX_CONFIG_DIR:-/etc/company-brain/omnibox}"
  export OMNIBOX_WRAPPER="${OMNIBOX_WRAPPER:-/usr/local/sbin/run-under-omnibox}"
  export OMNIBOX_POLICY_DST="${OMNIBOX_POLICY_DST:-$OMNIBOX_CONFIG_DIR}"
  export OMNIBOX_WRAPPER_DST="${OMNIBOX_WRAPPER_DST:-$OMNIBOX_WRAPPER}"
  local r=(); [ "${OMNIBOX_REQUIRED:-0}" = "1" ] && r=(--require)
  log "Running ensure-omnibox: $s"
  if [ "$(id -u)" = "0" ]; then
    bash "$s" "${r[@]}" || { err "ensure-omnibox failed"; [ "${OMNIBOX_REQUIRED:-0}" = "1" ] && exit 6; return 0; }
  elif command -v sudo >/dev/null 2>&1; then
    sudo env ENABLE_OMNIBOX=1 OMNIBOX_ENABLED=1 OMNIBOX_CONFIG_DIR="$OMNIBOX_CONFIG_DIR" \
      OMNIBOX_WRAPPER="$OMNIBOX_WRAPPER" OMNIBOX_POLICY_DST="$OMNIBOX_POLICY_DST" \
      OMNIBOX_WRAPPER_DST="$OMNIBOX_WRAPPER_DST" bash "$s" "${r[@]}" \
      || { err "ensure-omnibox failed"; [ "${OMNIBOX_REQUIRED:-0}" = "1" ] && exit 6; return 0; }
  else
    log "WARN: root required: sudo ENABLE_OMNIBOX=1 bash $s"
    [ "${OMNIBOX_REQUIRED:-0}" = "1" ] && exit 6; return 0
  fi
  # EnvironmentFile only; drop-in already has OMNIBOX_ARGV_BUILDER default
  printf 'OMNIBOX_ENABLED=1\nOMNIBOX_CONFIG_DIR=%s\nOMNIBOX_WRAPPER=%s\n' \
    "$OMNIBOX_CONFIG_DIR" "$OMNIBOX_WRAPPER" \
    | _cb_maybe_sudo tee /etc/company-brain/omnibox.env >/dev/null 2>&1 || true
  log "Omnibox ensure complete (wrapper=$OMNIBOX_WRAPPER)"
}

if [ "${BOOTSTRAP_HOST_LIB_ONLY:-0}" = "1" ]; then
  if [ "${BASH_SOURCE[0]}" != "$0" ]; then
    return 0
  fi
  exit 0
fi

require_artifact_url "CLIENT_CORE_ARTIFACT_URL" "$CLIENT_CORE_ARTIFACT_URL"
require_artifact_version "CLIENT_CORE_ARTIFACT_VERSION" "$CLIENT_CORE_ARTIFACT_VERSION"
require_pin "CLIENT_CORE_ARTIFACT_SHA256" "$CLIENT_CORE_ARTIFACT_SHA256"
require_artifact_url "HERMES_ARTIFACT_URL" "$HERMES_ARTIFACT_URL"
require_artifact_version "HERMES_ARTIFACT_VERSION" "$HERMES_ARTIFACT_VERSION"
require_pin "HERMES_ARTIFACT_SHA256" "$HERMES_ARTIFACT_SHA256"
require_pin "RELAY_CONTRACT_MAJOR" "$RELAY_CONTRACT_MAJOR"

if ! echo "$RELAY_CONTRACT_MAJOR" | grep -Eq '^[0-9]+$'; then
  err "RELAY_CONTRACT_MAJOR must be a non-negative integer (got: $RELAY_CONTRACT_MAJOR)"
  exit 2
fi

CLIENT_CORE_ARTIFACT_SHA256="$(normalize_sha "$CLIENT_CORE_ARTIFACT_SHA256")"
HERMES_ARTIFACT_SHA256="$(normalize_sha "$HERMES_ARTIFACT_SHA256")"

if ! echo "$CLIENT_CORE_ARTIFACT_SHA256" | grep -Eq '^[a-f0-9]{64}$'; then
  err "CLIENT_CORE_ARTIFACT_SHA256 must be a 64-char hex digest (got: $CLIENT_CORE_ARTIFACT_SHA256)"
  exit 2
fi
if ! echo "$HERMES_ARTIFACT_SHA256" | grep -Eq '^[a-f0-9]{64}$'; then
  err "HERMES_ARTIFACT_SHA256 must be a 64-char hex digest (got: $HERMES_ARTIFACT_SHA256)"
  exit 2
fi

trap cleanup_attestation_tmp EXIT
require_attestation_config_if_needed

mkdir -p "$DOWNLOAD_DIR"
chmod 700 "$DOWNLOAD_DIR"

HERMES_ARCHIVE="$DOWNLOAD_DIR/hermes-${HERMES_ARTIFACT_VERSION}.artifact"
CLIENT_CORE_ARCHIVE="$DOWNLOAD_DIR/client-core-${CLIENT_CORE_ARTIFACT_VERSION}.artifact"

log "=== Hermes install (first) → $HERMES_INSTALL_PATH ==="
download_artifact "$HERMES_ARTIFACT_URL" "$HERMES_ARCHIVE"
verify_sha256 "$HERMES_ARCHIVE" "$HERMES_ARTIFACT_SHA256" "hermes@$HERMES_ARTIFACT_VERSION"
verify_artifact_attestation "$HERMES_ARCHIVE" "$HERMES_ARTIFACT_SIGNATURE_B64" "hermes@$HERMES_ARTIFACT_VERSION"
HERMES_ATTESTATION_STATUS="$ATTESTATION_LAST_STATUS"

if [ -d "$HERMES_INSTALL_PATH" ] && [ -n "$(ls -A "$HERMES_INSTALL_PATH" 2>/dev/null || true)" ]; then
  log "Hermes path already populated — re-extracting over install (idempotent refresh)"
fi
sudo mkdir -p "$HERMES_INSTALL_PATH"
HERMES_STAGE="$(mktemp -d "$DOWNLOAD_DIR/hermes-stage.XXXXXX")"
extract_archive "$HERMES_ARCHIVE" "$HERMES_STAGE" "$HERMES_ARTIFACT_URL"
flatten_extract "$HERMES_STAGE"
# lp-2md.3: fail closed before rsync / hermes-gateway start
require_hermes_host_arch_match "$HERMES_STAGE" "$HERMES_ARTIFACT_URL" \
  "${HERMES_ARTIFACT_ARCH:-}" "${HERMES_ALLOW_MISSING_ARCH:-0}"
sudo rsync -a --delete "$HERMES_STAGE"/ "$HERMES_INSTALL_PATH"/
rm -rf "$HERMES_STAGE"
# Pack root often 0700; hermes unit needs path traverse (else 203/EXEC).
sudo chmod 755 "$HERMES_INSTALL_PATH" 2>/dev/null || true

if [ -d "$HERMES_INSTALL_PATH/bin" ]; then
  export PATH="$HERMES_INSTALL_PATH/bin:$PATH"
fi
if [ -x "$HERMES_INSTALL_PATH/bin/hermes" ] && [ ! -e /usr/local/bin/hermes ]; then
  sudo ln -sfn "$HERMES_INSTALL_PATH/bin/hermes" /usr/local/bin/hermes || true
fi

if command -v hermes >/dev/null 2>&1; then
  log "Hermes on PATH: $(command -v hermes) ($(hermes --version 2>/dev/null || echo version-unknown))"
else
  log "WARN: hermes binary not on PATH after extract — check layout under $HERMES_INSTALL_PATH"
fi

mkdir -p "$HERMES_INSTALL_PATH/.seed" 2>/dev/null || sudo mkdir -p "$HERMES_INSTALL_PATH/.seed"
{
  echo "version=$HERMES_ARTIFACT_VERSION"
  echo "url=$HERMES_ARTIFACT_URL"
  echo "sha256=$HERMES_ARTIFACT_SHA256"
  echo "relay_contract_major=$RELAY_CONTRACT_MAJOR"
  echo "attestation_status=$HERMES_ATTESTATION_STATUS"
  echo "attestation_alg=ed25519"
  echo "signing_pubkey_sha256=${ARTIFACT_SIGNING_PUBKEY_FINGERPRINT:-}"
  echo "signing_identity=${ARTIFACT_SIGNING_IDENTITY:-}"
  date -u +%Y-%m-%dT%H:%M:%SZ | sed 's/^/installed_at=/'
} | sudo tee "$HERMES_INSTALL_PATH/.seed/provenance.env" >/dev/null

log "=== client-core seed → $VAULT_ROOT ==="
if [ ! -d "$VAULT_ROOT" ]; then
  sudo mkdir -p "$VAULT_ROOT"
  sudo chown "$(id -u):$(id -g)" "$VAULT_ROOT" || true
fi

if [ -f "$VAULT_ROOT/AGENTS.md" ]; then
  log "Vault already has AGENTS.md — skipping client-core extract (preserve live vault)"
else
  download_artifact "$CLIENT_CORE_ARTIFACT_URL" "$CLIENT_CORE_ARCHIVE"
  verify_sha256 "$CLIENT_CORE_ARCHIVE" "$CLIENT_CORE_ARTIFACT_SHA256" "client-core@$CLIENT_CORE_ARTIFACT_VERSION"
  verify_artifact_attestation "$CLIENT_CORE_ARCHIVE" "$CLIENT_CORE_ARTIFACT_SIGNATURE_B64" "client-core@$CLIENT_CORE_ARTIFACT_VERSION"
  CLIENT_CORE_ATTESTATION_STATUS="$ATTESTATION_LAST_STATUS"

  CLIENT_STAGE="$(mktemp -d "$DOWNLOAD_DIR/client-core-stage.XXXXXX")"
  extract_archive "$CLIENT_CORE_ARCHIVE" "$CLIENT_STAGE" "$CLIENT_CORE_ARTIFACT_URL"
  flatten_extract "$CLIENT_STAGE"
  rsync -a --exclude .git "$CLIENT_STAGE"/ "$VAULT_ROOT"/
  rm -rf "$CLIENT_STAGE"

  mkdir -p "$VAULT_ROOT/.seed"
  {
    echo "client_core_version=$CLIENT_CORE_ARTIFACT_VERSION"
    echo "client_core_url=$CLIENT_CORE_ARTIFACT_URL"
    echo "client_core_sha256=$CLIENT_CORE_ARTIFACT_SHA256"
    echo "client_core_attestation_status=$CLIENT_CORE_ATTESTATION_STATUS"
    echo "hermes_version=$HERMES_ARTIFACT_VERSION"
    echo "hermes_url=$HERMES_ARTIFACT_URL"
    echo "hermes_sha256=$HERMES_ARTIFACT_SHA256"
    echo "hermes_attestation_status=$HERMES_ATTESTATION_STATUS"
    echo "attestation_alg=ed25519"
    echo "signing_pubkey_sha256=${ARTIFACT_SIGNING_PUBKEY_FINGERPRINT:-}"
    echo "signing_identity=${ARTIFACT_SIGNING_IDENTITY:-}"
    echo "relay_contract_major=$RELAY_CONTRACT_MAJOR"
    echo "bootstrap=artifact"
    date -u +%Y-%m-%dT%H:%M:%SZ | sed 's/^/seeded_at=/'
  } > "$VAULT_ROOT/.seed/provenance.env"
  echo "$CLIENT_CORE_ARTIFACT_VERSION" > "$VAULT_ROOT/.seed/client-core-version"
  echo "$HERMES_ARTIFACT_VERSION" > "$VAULT_ROOT/.seed/hermes-version"
  echo "$RELAY_CONTRACT_MAJOR" > "$VAULT_ROOT/.seed/relay-contract-major"
  date -u +%Y-%m-%dT%H:%M:%SZ > "$VAULT_ROOT/.seed/seeded-at"
  log "Seeded client-core $CLIENT_CORE_ARTIFACT_VERSION into $VAULT_ROOT"
fi

if [ -x "$VAULT_ROOT/scripts/setup-local.sh" ]; then
  log "Running setup-local.sh"
  "$VAULT_ROOT/scripts/setup-local.sh" || log "WARN: setup-local.sh non-zero (optional tools may be missing)"
fi

if [ -n "$PACKS" ] && [ -x "$VAULT_ROOT/scripts/enable-pack.sh" ]; then
  IFS=',' read -ra PL <<< "$PACKS"
  for p in "${PL[@]}"; do
    p="$(echo "$p" | xargs)"
    [ -z "$p" ] && continue
    log "Enabling pack: $p"
    "$VAULT_ROOT/scripts/enable-pack.sh" "$p" || log "WARN: pack $p failed"
  done
fi

log "=== Hermes RBAC profiles (admin + contributor) → $HERMES_HOME/profiles ==="
ensure_hermes_profiles "$HERMES_HOME"

# After profiles; Mode A only when ENABLE_OMNIBOX=1 (enable_omnibox default false).
ensure_omnibox_mode_a

log "Initialize Beads git-free: bd init --stealth (in vault) if not present."
log "Merge GATEWAY_RELAY_* from Terraform module output into $HERMES_HOME/.env then restart gateway."
log "Portal: https://app.withlanyard.com/<tenant_slug>"
log "Done bootstrap-host (artifact contract)."
