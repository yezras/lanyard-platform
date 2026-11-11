#!/usr/bin/env bash
# Company Brain default OCR → <stem>.parse.md (franken_ocr)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIN_TEXT_CHARS="${FOCR_MIN_TEXT_CHARS:-400}"
FORCE_OCR=0

usage() {
  cat >&2 <<'EOF'
Usage: focr.sh [--force-ocr] <document-path>

Writes <document-stem>.parse.md beside the source using the Second Brain
routing ladder (pdftotext for digital PDFs, focr for scans/images).

Requires: focr on PATH (install via infra/focr/install-focr.sh && focr pull).
EOF
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force-ocr)
      FORCE_OCR=1
      shift
      ;;
    -h|--help)
      usage
      ;;
    *)
      break
      ;;
  esac
done

[[ $# -eq 1 ]] || usage

SOURCE="$1"
if [[ ! -f "$SOURCE" ]]; then
  echo "focr.sh: not a file: $SOURCE" >&2
  exit 1
fi

dir="$(dirname "$SOURCE")"
base="$(basename "$SOURCE")"
stem="${base%.*}"
ext="${base##*.}"
ext_lower="$(printf '%s' "$ext" | tr '[:upper:]' '[:lower:]')"
out="${dir}/${stem}.parse.md"

pdftotext_extract() {
  if command -v pdftotext >/dev/null 2>&1; then
    pdftotext -layout "$1" - 2>/dev/null || true
  fi
}

write_parse_md() {
  local header="# Parse: ${base}"
  {
    printf '%s\n\n' "$header"
    cat
  } >"$out"
  echo "$out"
}

case "$ext_lower" in
  md|txt)
    write_parse_md <"$SOURCE"
    exit 0
    ;;
  pdf)
    if [[ "$FORCE_OCR" -eq 0 ]]; then
      text="$(pdftotext_extract "$SOURCE")"
      if [[ "${#text}" -ge "$MIN_TEXT_CHARS" ]]; then
        write_parse_md <<<"$text"
        exit 0
      fi
    fi
    if ! command -v focr >/dev/null 2>&1; then
      echo "focr.sh: scanned PDF needs focr; install via infra/focr/install-focr.sh" >&2
      exit 1
    fi
    focr ocr "$SOURCE" -o "$out"
    echo "$out"
    exit 0
    ;;
  png|jpg|jpeg|webp|tif|tiff|gif|bmp)
    if ! command -v focr >/dev/null 2>&1; then
      echo "focr.sh: image OCR needs focr; install via infra/focr/install-focr.sh" >&2
      exit 1
    fi
    focr ocr "$SOURCE" -o "$out"
    echo "$out"
    exit 0
    ;;
  docx|doc|xlsx|xls|pptx|ppt)
    echo "focr.sh: Office formats are not handled by focr; see SecondBrain/document-parsing.md for escalation" >&2
    exit 1
    ;;
  *)
    echo "focr.sh: unsupported extension .$ext_lower" >&2
    exit 1
    ;;
esac