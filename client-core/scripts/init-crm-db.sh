#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="$ROOT/Clients/clients_crm.db"
SCHEMA="$ROOT/Clients/schema.sql"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required but was not found on PATH" >&2
  exit 1
fi

if [ -e "$DB" ]; then
  echo "CRM database already exists: $DB"
  exit 0
fi

sqlite3 "$DB" < "$SCHEMA"
echo "Created $DB"

