#!/usr/bin/env bash
set -euo pipefail

INSTALL_URL="https://raw.githubusercontent.com/Dicklesworthstone/franken_ocr/main/install.sh"
# Pin for reproducible customer workers; bump intentionally when upgrading franken_ocr.
FOCR_VERSION="${FOCR_VERSION:-v0.4.0}"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to install focr" >&2
  exit 1
fi

export VERSION="$FOCR_VERSION"
curl -fsSL "$INSTALL_URL" | bash -s -- --verify

if ! command -v focr >/dev/null 2>&1; then
  echo "focr install finished but focr is not on PATH" >&2
  exit 1
fi

focr --version
echo "Next: focr pull   # download Unlimited-OCR weights once (~3.9 GB)"
