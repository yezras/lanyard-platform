#!/usr/bin/env bash
set -euo pipefail

if ! command -v go >/dev/null 2>&1; then
  echo "go is required but was not found on PATH" >&2
  exit 1
fi

go install -tags sqlite_fts5 github.com/openclaw/wacli/cmd/wacli@latest

if ! command -v wacli >/dev/null 2>&1; then
  GOPATH="$(go env GOPATH)"
  echo "wacli installed to ${GOPATH}/bin, but that directory is not on PATH" >&2
  exit 1
fi

wacli version
