#!/usr/bin/env bash
# G4.2 local proof: seed a temp SQLite control-plane DB, migrate to Postgres,
# verify counts, optional pg_dump/pg_restore drill on a scratch DB.
#
# Prerequisites:
#   - Node 22+
#   - pnpm install (root devDependency `pg`)
#   - Reachable Postgres (default: local compose lab URL)
#
# Usage (from monorepo root):
#   bash scripts/test-migrate-sqlite-to-postgres.sh
#   CONTROL_PLANE_DATABASE_URL=postgres://… bash scripts/test-migrate-sqlite-to-postgres.sh
#
# Does not print secrets. Lab URL defaults are for local docker only.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DATABASE_URL="${CONTROL_PLANE_DATABASE_URL:-${DATABASE_URL:-postgres://portal:portal@127.0.0.1:5432/portal_cp}}"
SCRATCH_DB="${MIGRATE_TEST_SCRATCH_DB:-portal_cp_g42_scratch}"
WORKDIR="${TMPDIR:-/tmp}/portal-g42-migrate-$$"
SQLITE_PATH="$WORKDIR/control-plane-src.db"
DUMP_PATH="$WORKDIR/post-migrate.dump"
MIGRATE=(node "$ROOT/scripts/migrate-sqlite-to-postgres.mjs")

cleanup() {
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

mkdir -p "$WORKDIR"
export SQLITE_PATH

echo "==> G4.2 migrate proof workdir: $WORKDIR"

echo "==> Check Postgres reachability"
U="$DATABASE_URL" node --input-type=module -e '
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.U });
try {
  await pool.query("SELECT 1");
  console.log("Postgres reachable");
} catch (err) {
  console.error("ERROR: Postgres not reachable. Start lab DB:");
  console.error("  docker compose up -d postgres   # G4.1 compose");
  console.error("  or docker run … postgres:16-alpine with portal/portal/portal_cp");
  process.exit(1);
} finally {
  await pool.end();
}
'

echo "==> Seed synthetic SQLite source"
SQLITE_PATH="$SQLITE_PATH" node --input-type=module <<'SEED'
import { DatabaseSync } from "node:sqlite";

const path = process.env.SQLITE_PATH;
const db = new DatabaseSync(path);
db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE tenants (
    tenant_id TEXT PRIMARY KEY,
    tenant_slug TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    interaction_export_enabled INTEGER NOT NULL DEFAULT 0,
    retention_mode TEXT NOT NULL DEFAULT 'none',
    relay_tier TEXT NOT NULL DEFAULT 'shared',
    dedicated_relay_wss_url TEXT
  );
  CREATE TABLE users (
    user_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
    email TEXT NOT NULL,
    password_hash TEXT,
    password_salt TEXT,
    google_sub TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(tenant_id, email)
  );
  CREATE TABLE gateway_instances (
    instance_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
    secret_hash TEXT NOT NULL,
    secret_salt TEXT NOT NULL,
    previous_secret_hash TEXT,
    previous_secret_salt TEXT,
    previous_secret_expires_at TEXT,
    created_at TEXT NOT NULL,
    revoked_at TEXT
  );
  CREATE TABLE audit_log (
    audit_id TEXT PRIMARY KEY,
    tenant_id TEXT,
    action TEXT NOT NULL,
    actor TEXT,
    metadata_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE roles (
    role_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
    name TEXT NOT NULL,
    hermes_profile TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(tenant_id, name)
  );
  CREATE TABLE role_path_prefixes (
    role_id TEXT NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
    path_prefix TEXT NOT NULL,
    PRIMARY KEY (role_id, path_prefix)
  );
  CREATE TABLE user_roles (
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    role_id TEXT NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
  );
  CREATE TABLE projects (
    project_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
    parent_project_id TEXT REFERENCES projects(project_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    vault_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE session_share_grants (
    grant_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
    thread_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL REFERENCES users(user_id),
    grantee_user_id TEXT NOT NULL REFERENCES users(user_id),
    mode TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT
  );

  INSERT INTO tenants VALUES
    ('t1', 'acme', 'Acme', '2026-01-01T00:00:00.000Z', 0, 'none', 'shared', NULL);
  INSERT INTO users VALUES
    ('u1', 't1', 'owner@example.com', 'ph', 'ps', NULL, '2026-01-01T00:00:00.000Z'),
    ('u2', 't1', 'member@example.com', 'ph2', 'ps2', 'google-sub-2', '2026-01-02T00:00:00.000Z');
  INSERT INTO gateway_instances VALUES
    ('i1', 't1', 'shash', 'ssalt', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', NULL);
  INSERT INTO audit_log VALUES
    ('a1', 't1', 'tenant.created', 'ops', '{}', '2026-01-01T00:00:00.000Z');
  INSERT INTO roles VALUES
    ('r1', 't1', 'admin', 'admin', '2026-01-01T00:00:00.000Z');
  INSERT INTO role_path_prefixes VALUES
    ('r1', '/');
  INSERT INTO user_roles VALUES
    ('u1', 'r1');
  INSERT INTO projects VALUES
    ('p1', 't1', NULL, 'Root', '/vault', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
    ('p2', 't1', 'p1', 'Child', '/vault/child', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
  INSERT INTO session_share_grants VALUES
    ('g1', 't1', 'thread-1', 'u1', 'u2', 'read', '2026-01-03T00:00:00.000Z', NULL);
`);
db.close();
console.log("Seeded SQLite at", path);
SEED

echo "==> Dry-run (counts only)"
"${MIGRATE[@]}" --sqlite "$SQLITE_PATH" --dry-run

echo "==> Prepare scratch database (best-effort)"
CREATE_DB_OK=0
TARGET_URL="$DATABASE_URL"

# Prefer node+pg for admin so we do not require local psql client.
SCRATCH_DB="$SCRATCH_DB" U="$DATABASE_URL" node --input-type=module -e '
import pg from "pg";
const admin = new pg.Pool({ connectionString: process.env.U });
const name = process.env.SCRATCH_DB;
try {
  const exists = await admin.query(
    "SELECT 1 AS ok FROM pg_database WHERE datname = $1",
    [name],
  );
  if (exists.rowCount === 0) {
    // CREATE DATABASE cannot run inside a transaction block.
    await admin.query(`CREATE DATABASE "${name.replace(/"/g, "")}"`);
  }
  console.log("Scratch database ready:", name);
  process.exit(0);
} catch (err) {
  console.error("WARN: scratch DB unavailable:", err.message);
  process.exit(3);
} finally {
  await admin.end();
}
' && CREATE_DB_OK=1 || CREATE_DB_OK=0

if [[ "$CREATE_DB_OK" == "1" ]]; then
  if [[ "$DATABASE_URL" =~ ^(postgres(ql)?://[^/]+)/([^?]+)(.*)$ ]]; then
    TARGET_URL="${BASH_REMATCH[1]}/${SCRATCH_DB}${BASH_REMATCH[4]}"
    echo "Using scratch database: ${SCRATCH_DB}"
  fi
else
  echo "WARN: migrating into default DB (may coexist with other data)."
fi

echo "==> Migrate apply"
"${MIGRATE[@]}" --sqlite "$SQLITE_PATH" --database-url "$TARGET_URL"

echo "==> Verify counts"
"${MIGRATE[@]}" --sqlite "$SQLITE_PATH" --database-url "$TARGET_URL" --verify-only

echo "==> Idempotent re-run"
"${MIGRATE[@]}" --sqlite "$SQLITE_PATH" --database-url "$TARGET_URL"
"${MIGRATE[@]}" --sqlite "$SQLITE_PATH" --database-url "$TARGET_URL" --verify-only

# Optional logical dump/restore drill (needs pg_dump + superuser-ish rights).
if command -v pg_dump >/dev/null 2>&1 && command -v pg_restore >/dev/null 2>&1 && [[ "$CREATE_DB_OK" == "1" ]]; then
  echo "==> Rollback drill: pg_dump → recreate DB → pg_restore → recount"
  pg_dump "$TARGET_URL" --format=custom -f "$DUMP_PATH"
  SCRATCH_DB="$SCRATCH_DB" U="$DATABASE_URL" node --input-type=module -e '
import pg from "pg";
const admin = new pg.Pool({ connectionString: process.env.U });
const name = process.env.SCRATCH_DB.replace(/"/g, "");
try {
  await admin.query(`
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = $1 AND pid <> pg_backend_pid()
  `, [name]);
  await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  await admin.query(`CREATE DATABASE "${name}"`);
  console.log("Recreated scratch DB for restore");
} finally {
  await admin.end();
}
'
  pg_restore --no-owner --no-acl -d "$TARGET_URL" "$DUMP_PATH"
  "${MIGRATE[@]}" --sqlite "$SQLITE_PATH" --database-url "$TARGET_URL" --verify-only
  echo "Rollback drill OK"
else
  echo "SKIP full dump/restore drill (need pg_dump/pg_restore + scratch DB)."
  echo "Counts verify + idempotent re-run still constitute local proof."
fi

echo ""
echo "G4.2 local migrate proof: PASS"
echo "  dry-run + migrate + verify-only + idempotent re-run OK"
