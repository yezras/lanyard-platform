#!/usr/bin/env bash
# Minimal local smoke test for bootstrap-host archive extraction.
# Reproduces the .artifact download naming bug and proves tar.gz + zip extract.
#
# Usage (from repo root):
#   bash scripts/smoke-bootstrap-extract.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BOOTSTRAP="$ROOT/scripts/bootstrap-host.sh"

if [ ! -f "$BOOTSTRAP" ]; then
  echo "FAIL: missing $BOOTSTRAP" >&2
  exit 1
fi

# shellcheck disable=SC1090
BOOTSTRAP_HOST_LIB_ONLY=1 source "$BOOTSTRAP"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/cb-bootstrap-extract-smoke.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# --- fixtures: harmless payloads ---
mkdir -p "$TMP/src-tgz/payload" "$TMP/src-zip/payload" "$TMP/src-tar"
echo "hello-tgz" > "$TMP/src-tgz/payload/marker-tgz.txt"
echo "hello-zip" > "$TMP/src-zip/payload/marker-zip.txt"
echo "hello-tar" > "$TMP/src-tar/marker-tar.txt"

( cd "$TMP/src-tgz" && tar -czf "$TMP/fixture.tar.gz" payload )
( cd "$TMP/src-zip" && zip -qr "$TMP/fixture.zip" payload )
( cd "$TMP/src-tar" && tar -cf "$TMP/fixture.tar" marker-tar.txt )

# Simulate bootstrap download naming: always ends in .artifact
TGZ_ARTIFACT="$TMP/hermes-v0.0.0-test.artifact"
ZIP_ARTIFACT="$TMP/client-core-v0.0.0-test.artifact"
TAR_ARTIFACT="$TMP/plain-v0.0.0-test.artifact"
cp "$TMP/fixture.tar.gz" "$TGZ_ARTIFACT"
cp "$TMP/fixture.zip" "$ZIP_ARTIFACT"
cp "$TMP/fixture.tar" "$TAR_ARTIFACT"

TGZ_SHA="$(sha256sum "$TGZ_ARTIFACT" | awk '{print $1}')"
ZIP_SHA="$(sha256sum "$ZIP_ARTIFACT" | awk '{print $1}')"
TAR_SHA="$(sha256sum "$TAR_ARTIFACT" | awk '{print $1}')"

# URLs with query strings (presigned) — extension must ignore ?...
TGZ_URL="https://artifacts.example.invalid/releases/hermes-v0.0.0-test.tar.gz?X-Amz-Signature=deadbeef&x=1"
ZIP_URL="s3://example-bucket/client-core/v0.0.0/client-core-v0.0.0-test.zip"
TAR_URL="https://artifacts.example.invalid/plain.tar#frag"

# --- format resolution (URL path wins over .artifact suffix) ---
[ "$(archive_format_from_ref "$TGZ_URL")" = "tar.gz" ] || fail "URL tar.gz detection"
[ "$(archive_format_from_ref "$ZIP_URL")" = "zip" ] || fail "URL zip detection"
[ "$(archive_format_from_ref "$TAR_URL")" = "tar" ] || fail "URL tar detection"
[ "$(archive_format_from_ref "https://x.example/a.tgz")" = "tar.gz" ] || fail "URL tgz detection"
[ -z "$(archive_format_from_ref "$TGZ_ARTIFACT")" ] || fail ".artifact must not imply a format"
pass "URL path format detection (query/fragment ignored)"

# --- magic fallback when URL has no usable extension ---
[ "$(archive_format_from_magic "$TGZ_ARTIFACT")" = "tar.gz" ] || fail "magic gzip/tar.gz"
[ "$(archive_format_from_magic "$ZIP_ARTIFACT")" = "zip" ] || fail "magic zip"
[ "$(archive_format_from_magic "$TAR_ARTIFACT")" = "tar" ] || fail "magic tar"
pass "magic-byte format detection"

# --- checksum then extract (mirrors bootstrap order) ---
verify_sha256 "$TGZ_ARTIFACT" "$TGZ_SHA" "smoke-tgz"
verify_sha256 "$ZIP_ARTIFACT" "$ZIP_SHA" "smoke-zip"
verify_sha256 "$TAR_ARTIFACT" "$TAR_SHA" "smoke-tar"

OUT_TGZ="$TMP/out-tgz"
OUT_ZIP="$TMP/out-zip"
OUT_TAR="$TMP/out-tar"
OUT_MAGIC="$TMP/out-magic"
mkdir -p "$OUT_TGZ" "$OUT_ZIP" "$OUT_TAR" "$OUT_MAGIC"

extract_archive "$TGZ_ARTIFACT" "$OUT_TGZ" "$TGZ_URL"
extract_archive "$ZIP_ARTIFACT" "$OUT_ZIP" "$ZIP_URL"
extract_archive "$TAR_ARTIFACT" "$OUT_TAR" "$TAR_URL"
# No URL: magic-only path (opaque .artifact name)
extract_archive "$TGZ_ARTIFACT" "$OUT_MAGIC" ""

[ -f "$OUT_TGZ/payload/marker-tgz.txt" ] || fail "tar.gz extract missing marker"
[ "$(cat "$OUT_TGZ/payload/marker-tgz.txt")" = "hello-tgz" ] || fail "tar.gz content mismatch"
[ -f "$OUT_ZIP/payload/marker-zip.txt" ] || fail "zip extract missing marker"
[ "$(cat "$OUT_ZIP/payload/marker-zip.txt")" = "hello-zip" ] || fail "zip content mismatch"
[ -f "$OUT_TAR/marker-tar.txt" ] || fail "tar extract missing marker"
[ "$(cat "$OUT_TAR/marker-tar.txt")" = "hello-tar" ] || fail "tar content mismatch"
[ -f "$OUT_MAGIC/payload/marker-tgz.txt" ] || fail "magic-only extract missing marker"
pass "extract tar.gz + zip + tar via .artifact paths"

# --- fail-closed: unknown content must not extract ---
# Helpers use exit (fail-closed); run in subshells so the smoke harness survives.
echo "not-an-archive" > "$TMP/junk.artifact"
if ( resolve_archive_format "$TMP/junk.artifact" "https://example.invalid/no-ext" >/dev/null ); then
  fail "expected fail-closed on unrecognized archive"
fi
pass "fail-closed on unrecognized format"

# --- checksum mismatch still fails before extract would matter ---
if ( verify_sha256 "$TGZ_ARTIFACT" "0000000000000000000000000000000000000000000000000000000000000000" "bad" >/dev/null 2>&1 ); then
  fail "expected SHA-256 mismatch to fail"
fi
pass "checksum verification still fail-closed"

# --- pin safety: never treat live git branches or git remotes as artifacts ---
is_forbidden_version_ref "main" || fail "main must be forbidden version"
is_forbidden_version_ref "master" || fail "master must be forbidden version"
is_forbidden_version_ref "HEAD" || fail "HEAD must be forbidden version"
is_forbidden_version_ref "latest" || fail "latest must be forbidden version"
is_forbidden_version_ref "v0.1.0" && fail "v0.1.0 must be allowed version"
pass "forbidden version ref detection"

is_git_remote_url "git@github.com:org/repo.git" || fail "git@ must be rejected"
is_git_remote_url "https://github.com/org/repo.git" || fail ".git HTTPS remote must be rejected"
is_git_remote_url "https://github.com/org/repo/tree/main/path" || fail "tree/ URL must be rejected"
is_git_remote_url "s3://bucket/hermes/v0.1.0/hermes.tar.gz" && fail "s3 artifact URL must be allowed"
is_git_remote_url "https://artifacts.example.invalid/releases/hermes-v0.1.0.tar.gz" && fail "https artifact URL must be allowed"
is_git_remote_url "https://github.com/LanyardBrain/hermes-lanyard/releases/download/v0.1.0-g7h2/hermes-v0.1.0-g7h2.tar.gz" && fail "GitHub release download URL must be allowed"
is_git_remote_url "https://api.github.com/repos/LanyardBrain/client-core/releases/assets/474833567" && fail "GitHub API asset URL must be allowed"
pass "git remote / source-tree URL rejection"

# Full pin gate (subshell so harness survives exit 2)
if (
  CLIENT_CORE_ARTIFACT_URL="https://github.com/LanyardBrain/client-core.git"
  require_artifact_url "CLIENT_CORE_ARTIFACT_URL" "$CLIENT_CORE_ARTIFACT_URL"
) >/dev/null 2>&1; then
  fail "expected require_artifact_url to reject .git remote"
fi
if (
  require_artifact_version "HERMES_ARTIFACT_VERSION" "main"
) >/dev/null 2>&1; then
  fail "expected require_artifact_version to reject main"
fi
pass "artifact pin helpers fail-closed on git remotes and branch names"

# --- secure schemes only: reject http:// / ws:// for artifacts ---
is_insecure_artifact_url "http://artifacts.example.invalid/x.tar.gz" || fail "http:// must be insecure"
is_insecure_artifact_url "ws://relay.example.invalid/path" || fail "ws:// must be insecure"
is_insecure_artifact_url "https://artifacts.example.invalid/x.tar.gz" && fail "https:// must be secure"
is_insecure_artifact_url "s3://bucket/key.tar.gz" && fail "s3:// must be secure"
pass "insecure scheme detector (http/ws)"

if (
  require_artifact_url "HERMES_ARTIFACT_URL" "http://artifacts.example.invalid/hermes.tar.gz"
) >/dev/null 2>&1; then
  fail "expected require_artifact_url to reject http://"
fi
if (
  require_artifact_url "CLIENT_CORE_ARTIFACT_URL" "ws://evil.example.invalid/core.tar.gz"
) >/dev/null 2>&1; then
  fail "expected require_artifact_url to reject ws://"
fi
if (
  require_artifact_url "HERMES_ARTIFACT_URL" "https://artifacts.example.invalid/hermes-v0.1.0.tar.gz"
) >/dev/null 2>&1; then
  : # ok
else
  fail "expected require_artifact_url to allow https://"
fi
if (
  require_artifact_url "CLIENT_CORE_ARTIFACT_URL" "s3://example-bucket/client-core/v0.1.0/core.tar.gz"
) >/dev/null 2>&1; then
  : # ok
else
  fail "expected require_artifact_url to allow s3://"
fi
if (
  download_artifact "http://artifacts.example.invalid/x.tar.gz" "$TMP/should-not-download" 
) >/dev/null 2>&1; then
  fail "expected download_artifact to refuse http://"
fi
pass "artifact URL helpers reject http:// and ws://; allow https:// and s3://"

# --- private GitHub release helpers (no network; URL classification + token gate) ---
is_github_release_download_url "https://github.com/LanyardBrain/hermes-lanyard/releases/download/v0.1.0-g7h2/hermes-v0.1.0-g7h2.tar.gz" \
  || fail "expected is_github_release_download_url true for browser release URL"
is_github_release_download_url "https://artifacts.example.invalid/hermes.tar.gz" \
  && fail "non-GitHub HTTPS must not match is_github_release_download_url"
is_github_api_asset_url "https://api.github.com/repos/LanyardBrain/client-core/releases/assets/474833567" \
  || fail "expected is_github_api_asset_url true"
is_github_api_asset_url "https://github.com/LanyardBrain/client-core/releases/download/v0.1.0/x.tar.gz" \
  && fail "browser release URL must not match is_github_api_asset_url"
# API asset URL without token must fail closed (subshell)
if (
  unset GITHUB_TOKEN GH_TOKEN
  download_artifact "https://api.github.com/repos/LanyardBrain/client-core/releases/assets/474833567" "$TMP/should-not-gh"
) >/dev/null 2>&1; then
  fail "expected private GitHub API asset download to require GITHUB_TOKEN/GH_TOKEN"
fi
pass "private GitHub release URL helpers + token gate"

# --- flatten single top-level directory ---
FLAT_SRC="$TMP/flat-src"
FLAT_OUT="$TMP/flat-out"
mkdir -p "$FLAT_SRC/top/nested"
echo "nested-ok" > "$FLAT_SRC/top/nested/marker.txt"
echo "top-file" > "$FLAT_SRC/top/root.txt"
( cd "$FLAT_SRC" && tar -czf "$TMP/flat.tar.gz" top )
cp "$TMP/flat.tar.gz" "$TMP/flat.artifact"
mkdir -p "$FLAT_OUT"
extract_archive "$TMP/flat.artifact" "$FLAT_OUT" "https://example.invalid/flat.tar.gz"
flatten_extract "$FLAT_OUT"
[ -f "$FLAT_OUT/nested/marker.txt" ] || fail "flatten missing nested marker"
[ -f "$FLAT_OUT/root.txt" ] || fail "flatten missing root file"
[ ! -d "$FLAT_OUT/top" ] || fail "flatten left top-level dir"
pass "flatten single top-level directory"

echo
echo "All bootstrap extract smoke checks passed."
