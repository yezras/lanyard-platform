#!/usr/bin/env node
/**
 * G4.2 one-shot: copy control-plane data from a legacy SQLite file into Postgres.
 *
 * - Never prints connection URLs or row payloads (hashes/salts stay out of logs).
 * - Idempotent inserts (ON CONFLICT DO NOTHING on primary keys).
 * - Applies greenfield CREATE IF NOT EXISTS (aligned with G4.1 migrateControlPlaneSchema).
 *
 * Usage:
 *   node scripts/migrate-sqlite-to-postgres.mjs --sqlite ./control-plane.db --dry-run
 *   node scripts/migrate-sqlite-to-postgres.mjs --sqlite ./control-plane.db --database-url "$CONTROL_PLANE_DATABASE_URL"
 *   node scripts/migrate-sqlite-to-postgres.mjs --sqlite ./control-plane.db --verify-only
 *
 * Env fallbacks: CONTROL_PLANE_DB_PATH / SQLITE_PATH, CONTROL_PLANE_DATABASE_URL / DATABASE_URL
 */

import { DatabaseSync } from "node:sqlite";
import { accessSync, constants } from "node:fs";
import { resolve } from "node:path";

/** @typedef {{ name: string, columns: string[], required?: boolean }} TableSpec */

/** FK-safe order. projects handled in parent-before-child waves. */
const TABLES = /** @type {TableSpec[]} */ ([
  {
    name: "tenants",
    columns: [
      "tenant_id",
      "tenant_slug",
      "display_name",
      "created_at",
      "interaction_export_enabled",
      "retention_mode",
      "relay_tier",
      "dedicated_relay_wss_url",
    ],
  },
  {
    name: "users",
    columns: [
      "user_id",
      "tenant_id",
      "email",
      "password_hash",
      "password_salt",
      "google_sub",
      "created_at",
    ],
  },
  {
    name: "gateway_instances",
    columns: [
      "instance_id",
      "tenant_id",
      "secret_hash",
      "secret_salt",
      "previous_secret_hash",
      "previous_secret_salt",
      "previous_secret_expires_at",
      "created_at",
      "revoked_at",
    ],
  },
  {
    name: "audit_log",
    columns: [
      "audit_id",
      "tenant_id",
      "action",
      "actor",
      "metadata_json",
      "created_at",
    ],
  },
  {
    name: "roles",
    columns: [
      "role_id",
      "tenant_id",
      "name",
      "hermes_profile",
      "created_at",
    ],
  },
  {
    name: "role_path_prefixes",
    columns: ["role_id", "path_prefix"],
  },
  {
    name: "user_roles",
    columns: ["user_id", "role_id"],
  },
  {
    name: "projects",
    columns: [
      "project_id",
      "tenant_id",
      "parent_project_id",
      "name",
      "vault_path",
      "created_at",
      "updated_at",
    ],
  },
  {
    name: "session_share_grants",
    columns: [
      "grant_id",
      "tenant_id",
      "thread_id",
      "owner_user_id",
      "grantee_user_id",
      "mode",
      "created_at",
      "revoked_at",
    ],
  },
]);

// Keep aligned with packages/control-plane/src/migrate.ts (cbd-mta.3.1).
// One-shot data copy only needs tables/indexes; triggers are applied by the
// control-plane process via migrateControlPlaneSchema on startup.
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tenants (
  tenant_id TEXT PRIMARY KEY,
  tenant_slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  interaction_export_enabled INTEGER NOT NULL DEFAULT 0,
  retention_mode TEXT NOT NULL DEFAULT 'none'
    CHECK (retention_mode IN ('none', 'metadata_only', 'interaction_export')),
  relay_tier TEXT NOT NULL DEFAULT 'shared'
    CHECK (relay_tier IN ('shared', 'dedicated')),
  dedicated_relay_wss_url TEXT
);

CREATE TABLE IF NOT EXISTS gateway_instances (
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

CREATE INDEX IF NOT EXISTS idx_gateway_instances_tenant
  ON gateway_instances(tenant_id);

CREATE INDEX IF NOT EXISTS idx_gateway_instances_tenant_active
  ON gateway_instances(tenant_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_log (
  audit_id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(tenant_id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  actor TEXT,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant
  ON audit_log(tenant_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_created
  ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
  email TEXT NOT NULL,
  password_hash TEXT,
  password_salt TEXT,
  google_sub TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id, email)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_google_sub
  ON users(tenant_id, google_sub)
  WHERE google_sub IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_tenant
  ON users(tenant_id);

CREATE TABLE IF NOT EXISTS roles (
  role_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
  name TEXT NOT NULL,
  hermes_profile TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id, name)
);

CREATE TABLE IF NOT EXISTS role_path_prefixes (
  role_id TEXT NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
  path_prefix TEXT NOT NULL,
  PRIMARY KEY (role_id, path_prefix)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_roles_tenant ON roles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);

CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
  parent_project_id TEXT REFERENCES projects(project_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  vault_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_projects_parent ON projects(parent_project_id);
CREATE INDEX IF NOT EXISTS idx_projects_tenant_path ON projects(tenant_id, vault_path);

CREATE TABLE IF NOT EXISTS session_share_grants (
  grant_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
  thread_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(user_id),
  grantee_user_id TEXT NOT NULL REFERENCES users(user_id),
  mode TEXT NOT NULL
    CHECK (mode IN ('read', 'collaborate')),
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_session_share_grants_tenant
  ON session_share_grants(tenant_id);

CREATE INDEX IF NOT EXISTS idx_session_share_grants_grantee
  ON session_share_grants(tenant_id, grantee_user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_session_share_grants_thread
  ON session_share_grants(tenant_id, thread_id)
  WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_share_grants_active
  ON session_share_grants(tenant_id, thread_id, grantee_user_id)
  WHERE revoked_at IS NULL;
`;

const DEFAULTS = {
  interaction_export_enabled: 0,
  retention_mode: "none",
  relay_tier: "shared",
  dedicated_relay_wss_url: null,
  previous_secret_hash: null,
  previous_secret_salt: null,
  previous_secret_expires_at: null,
  password_hash: null,
  password_salt: null,
  google_sub: null,
  parent_project_id: null,
  revoked_at: null,
  actor: null,
  tenant_id: null,
};

function usage(exitCode = 0) {
  const text = `migrate-sqlite-to-postgres.mjs (G4.2)

Copy control-plane rows from a legacy SQLite file into Postgres.

Options:
  --sqlite <path>         Source SQLite file (or CONTROL_PLANE_DB_PATH / SQLITE_PATH)
  --database-url <url>    Target Postgres URL (or CONTROL_PLANE_DATABASE_URL / DATABASE_URL)
  --dry-run               Print source table counts only; no Postgres writes
  --verify-only           Compare source vs target counts; exit 1 on mismatch
  --help                  Show this help

Notes:
  - Does not log URLs or row payloads.
  - Inserts use ON CONFLICT DO NOTHING (idempotent by primary key).
  - See docs/control-plane-db-migration.md
`;
  console.log(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const out = {
    sqlite: process.env.CONTROL_PLANE_DB_PATH || process.env.SQLITE_PATH || "",
    databaseUrl:
      process.env.CONTROL_PLANE_DATABASE_URL || process.env.DATABASE_URL || "",
    dryRun: false,
    verifyOnly: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") usage(0);
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--verify-only") out.verifyOnly = true;
    else if (a === "--sqlite") out.sqlite = argv[++i] || "";
    else if (a === "--database-url") out.databaseUrl = argv[++i] || "";
    else {
      console.error(`Unknown argument: ${a}`);
      usage(2);
    }
  }
  return out;
}

function assertSqlitePath(path) {
  if (!path) {
    console.error(
      "Missing source SQLite path. Pass --sqlite or set CONTROL_PLANE_DB_PATH.",
    );
    process.exit(2);
  }
  const resolved = resolve(path);
  try {
    accessSync(resolved, constants.R_OK);
  } catch {
    console.error(`SQLite file not readable: ${resolved}`);
    process.exit(2);
  }
  return resolved;
}

function redactUrl(_url) {
  return "<redacted-postgres-url>";
}

function tableExists(db, name) {
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`,
    )
    .get(name);
  return Boolean(row);
}

function sqliteColumns(db, table) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return new Set(rows.map((r) => r.name));
}

function normalizeRow(table, columns, raw) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const col of columns) {
    if (Object.prototype.hasOwnProperty.call(raw, col) && raw[col] !== undefined) {
      out[col] = raw[col];
    } else if (Object.prototype.hasOwnProperty.call(DEFAULTS, col)) {
      out[col] = DEFAULTS[col];
    } else {
      out[col] = null;
    }
  }
  // INTEGER flags may arrive as boolean from some drivers
  if (
    "interaction_export_enabled" in out &&
    typeof out.interaction_export_enabled === "boolean"
  ) {
    out.interaction_export_enabled = out.interaction_export_enabled ? 1 : 0;
  }
  return out;
}

function readTable(db, table) {
  if (!tableExists(db, table.name)) {
    return [];
  }
  const present = sqliteColumns(db, table.name);
  const selectCols = table.columns.filter((c) => present.has(c));
  if (selectCols.length === 0) return [];
  const rows = db
    .prepare(`SELECT ${selectCols.join(", ")} FROM ${table.name}`)
    .all();
  return rows.map((raw) => normalizeRow(table.name, table.columns, raw));
}

function countSqlite(db, tableName) {
  if (!tableExists(db, tableName)) return 0;
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${tableName}`).get();
  return Number(row?.c ?? 0);
}

/**
 * Insert projects parents-before-children to satisfy self-FK.
 * @param {Array<Record<string, unknown>>} rows
 */
function orderProjects(rows) {
  const byId = new Map(rows.map((r) => [r.project_id, r]));
  const remaining = new Set(byId.keys());
  const ordered = [];
  let guard = 0;
  while (remaining.size > 0 && guard < rows.length + 2) {
    guard++;
    let progress = false;
    for (const id of [...remaining]) {
      const row = byId.get(id);
      const parent = row?.parent_project_id;
      if (parent == null || parent === "" || !remaining.has(parent)) {
        // parent already ordered or null / external missing
        if (
          parent == null ||
          parent === "" ||
          ordered.some((o) => o.project_id === parent) ||
          !byId.has(parent)
        ) {
          ordered.push(row);
          remaining.delete(id);
          progress = true;
        }
      }
    }
    if (!progress) {
      // cycle or orphan: append rest and let Postgres reject if needed
      for (const id of remaining) ordered.push(byId.get(id));
      break;
    }
  }
  return ordered;
}

async function loadPg() {
  try {
    return await import("pg");
  } catch (err) {
    console.error(
      "Cannot import 'pg'. From monorepo root run: pnpm install\n" +
        "(root devDependency pg, or G4.1 control-plane dependency).",
    );
    console.error(String(err?.message || err));
    process.exit(2);
  }
}

async function withPg(databaseUrl, fn) {
  const pg = await loadPg();
  const { Pool } = pg.default ?? pg;
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("SELECT 1");
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

async function applySchema(pool) {
  await pool.query(SCHEMA_SQL);
}

async function countPg(pool, tableName) {
  const res = await pool.query(`SELECT COUNT(*)::int AS c FROM ${tableName}`);
  return Number(res.rows[0]?.c ?? 0);
}

/**
 * @param {import('pg').Pool} pool
 * @param {TableSpec} table
 * @param {Array<Record<string, unknown>>} rows
 */
async function insertRows(pool, table, rows) {
  if (rows.length === 0) return { inserted: 0, skipped: 0 };
  const cols = table.columns;
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const sql = `INSERT INTO ${table.name} (${cols.join(", ")}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
  let inserted = 0;
  let skipped = 0;
  for (const row of rows) {
    const values = cols.map((c) => row[c] ?? null);
    const result = await pool.query(sql, values);
    if ((result.rowCount ?? 0) > 0) inserted += 1;
    else skipped += 1;
  }
  return { inserted, skipped };
}

function printCounts(title, counts) {
  console.log(title);
  const width = Math.max(...Object.keys(counts).map((k) => k.length), 6);
  for (const [name, n] of Object.entries(counts)) {
    console.log(`  ${name.padEnd(width)}  ${n}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sqlitePath = assertSqlitePath(args.sqlite);

  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    const integrity = sqlite.prepare("PRAGMA integrity_check").get();
    const ok =
      integrity &&
      (integrity.integrity_check === "ok" ||
        Object.values(integrity)[0] === "ok");
    if (!ok) {
      console.error("SQLite integrity_check failed; aborting.");
      process.exit(1);
    }

    /** @type {Record<string, number>} */
    const sourceCounts = {};
    /** @type {Record<string, Array<Record<string, unknown>>>} */
    const data = {};
    for (const table of TABLES) {
      sourceCounts[table.name] = countSqlite(sqlite, table.name);
      data[table.name] = readTable(sqlite, table);
      if (table.name === "projects") {
        data[table.name] = orderProjects(data[table.name]);
      }
    }

    printCounts("Source SQLite row counts:", sourceCounts);
    console.log(`Source file: ${sqlitePath}`);
    console.log(`integrity_check: ok`);

    if (args.dryRun) {
      console.log("Dry-run complete (no Postgres connection).");
      return;
    }

    if (!args.databaseUrl) {
      console.error(
        "Missing Postgres URL. Pass --database-url or set CONTROL_PLANE_DATABASE_URL.",
      );
      process.exit(2);
    }

    // Never log the raw URL.
    console.log(`Target: ${redactUrl(args.databaseUrl)}`);

    await withPg(args.databaseUrl, async (pool) => {
      if (args.verifyOnly) {
        /** @type {Record<string, number>} */
        const targetCounts = {};
        let mismatch = false;
        for (const table of TABLES) {
          try {
            targetCounts[table.name] = await countPg(pool, table.name);
          } catch {
            targetCounts[table.name] = -1;
            mismatch = true;
          }
          if (targetCounts[table.name] !== sourceCounts[table.name]) {
            mismatch = true;
          }
        }
        printCounts("Target Postgres row counts:", targetCounts);
        if (mismatch) {
          console.error("VERIFY FAILED: source and target counts differ.");
          process.exit(1);
        }
        console.log("VERIFY OK: counts match.");
        return;
      }

      await applySchema(pool);
      console.log("Schema ensured (CREATE IF NOT EXISTS).");

      for (const table of TABLES) {
        const rows = data[table.name];
        const { inserted, skipped } = await insertRows(pool, table, rows);
        console.log(
          `  ${table.name}: inserted=${inserted} skipped_existing=${skipped} source=${rows.length}`,
        );
      }

      /** @type {Record<string, number>} */
      const targetCounts = {};
      let mismatch = false;
      for (const table of TABLES) {
        targetCounts[table.name] = await countPg(pool, table.name);
        // After idempotent insert, target should be >= source if target had extras,
        // and exactly source if target was empty or only had the same PKs.
        if (targetCounts[table.name] < sourceCounts[table.name]) {
          mismatch = true;
        }
      }
      printCounts("Target Postgres row counts (after migrate):", targetCounts);
      if (mismatch) {
        console.error(
          "MIGRATE WARNING: target has fewer rows than source for at least one table.",
        );
        process.exit(1);
      }
      console.log("Migrate complete.");
    });
  } finally {
    sqlite.close();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err?.message || err);
  process.exit(1);
});
