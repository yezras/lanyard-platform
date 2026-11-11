/**
 * Postgres SQL client for the control plane (G4.1).
 *
 * Replaces better-sqlite3. Cloud and local both use Postgres via
 * CONTROL_PLANE_DATABASE_URL or DATABASE_URL (never commit secrets).
 *
 * SQL may still use `?` placeholders; they are rewritten to `$1…$n` for pg.
 */
import pg from "pg";

const { Pool } = pg;

export type SqlClient = {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly unknown[]): Promise<{ changes: number }>;
  get<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T | undefined>;
  all<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T[]>;
  /** Drop test schema (if any) and end the pool. */
  close(): Promise<void>;
  readonly schema: string | null;
};

export type OpenDatabaseOptions = {
  connectionString: string;
  /** Isolated schema for tests (created on open, dropped on close). */
  schema?: string;
};

/** Convert `?` placeholders to Postgres `$1, $2, …`. */
export function toPgPlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "23505"
  );
}

function quoteIdent(ident: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(ident)) {
    throw new Error(`Invalid SQL identifier: ${ident}`);
  }
  return `"${ident}"`;
}

/**
 * Open a pooled Postgres connection. Optionally isolates into a private schema
 * (used by tests so parallel suites do not share tables).
 */
export async function openDatabase(
  options: OpenDatabaseOptions,
): Promise<SqlClient> {
  const schema = options.schema?.trim() || null;

  if (schema) {
    const bootstrap = new Pool({ connectionString: options.connectionString });
    try {
      await bootstrap.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)}`);
    } finally {
      await bootstrap.end();
    }
  }

  const pool = new Pool({
    connectionString: options.connectionString,
    // schema name is validated as a plain identifier in quoteIdent callers.
    ...(schema ? { options: `-c search_path=${schema},public` } : {}),
  });

  // Fail fast if Postgres is unreachable.
  await pool.query("SELECT 1");

  return {
    schema,
    async exec(sql: string): Promise<void> {
      await pool.query(sql);
    },
    async run(
      sql: string,
      params: readonly unknown[] = [],
    ): Promise<{ changes: number }> {
      const result = await pool.query(toPgPlaceholders(sql), [...params]);
      return { changes: result.rowCount ?? 0 };
    },
    async get<T = Record<string, unknown>>(
      sql: string,
      params: readonly unknown[] = [],
    ): Promise<T | undefined> {
      const result = await pool.query(toPgPlaceholders(sql), [...params]);
      return result.rows[0] as T | undefined;
    },
    async all<T = Record<string, unknown>>(
      sql: string,
      params: readonly unknown[] = [],
    ): Promise<T[]> {
      const result = await pool.query(toPgPlaceholders(sql), [...params]);
      return result.rows as T[];
    },
    async close(): Promise<void> {
      try {
        if (schema) {
          // Use a fresh connection without search_path so DROP works after
          // schema-scoped pool teardown edge cases.
          await pool.query(
            `DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`,
          );
        }
      } finally {
        await pool.end();
      }
    },
  };
}

/**
 * Resolve the Postgres URL from options / env.
 * Prefer CONTROL_PLANE_DATABASE_URL; fall back to DATABASE_URL.
 * Never logs the URL (may contain credentials).
 */
export function resolveDatabaseUrl(explicit?: string): string {
  const url =
    explicit?.trim() ||
    process.env.CONTROL_PLANE_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    "";
  if (!url) {
    throw new Error(
      "Control plane requires CONTROL_PLANE_DATABASE_URL or DATABASE_URL (Postgres). " +
        "CONTROL_PLANE_DB_PATH (SQLite) is no longer supported (G4.1).",
    );
  }
  if (url.startsWith("file:") || url.endsWith(".db") || url === ":memory:") {
    throw new Error(
      "SQLite paths are not supported. Set CONTROL_PLANE_DATABASE_URL to a postgres:// URL (G4.1).",
    );
  }
  return url;
}
