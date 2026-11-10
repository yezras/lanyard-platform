/**
 * Schema migration plan as executable SQL stubs for control-plane Postgres.
 *
 * Real apply path after Portal import: packages/control-plane/src/migrate.ts
 * (migrateControlPlaneSchema + ensureOptionalColumns).
 *
 * These statements are idempotent (ADD COLUMN / backfill with WHERE NULL).
 * They do **not** drop hermes_* columns — that is a later cutover step.
 * Removal criteria: @lanyard/hermes-compat (lp-k7g.8.7); execute in phase 8.
 */

/** Ordered migration steps for documentation and offline validation. */
export type MigrationStep = {
  id: string;
  phase: "add_columns" | "backfill" | "constraints" | "cutover_later";
  description: string;
  sql: string;
};

/**
 * Full migration plan for control-plane backend fields.
 *
 * Current production schema (source of truth pre-import):
 * - tenant_deployments.hermes_version TEXT
 * - roles.hermes_profile TEXT NOT NULL
 * - UserRbac.hermes_profile derived from first assigned role
 *
 * Target:
 * - tenant_deployments.backend_kind TEXT
 * - tenant_deployments.backend_version TEXT  (alias of hermes_version)
 * - tenant_deployments.backend_capabilities TEXT  (JSON snapshot)
 * - roles.backend_profile TEXT  (alias of hermes_profile)
 * - API dual-emits preferred + hermes_* aliases
 */
export const CONTROL_PLANE_BACKEND_FIELD_MIGRATION: readonly MigrationStep[] = [
  {
    id: "td.backend_kind",
    phase: "add_columns",
    description:
      "Add backend_kind on tenant_deployments (artifact product family).",
    sql: `ALTER TABLE tenant_deployments ADD COLUMN IF NOT EXISTS backend_kind TEXT`,
  },
  {
    id: "td.backend_version",
    phase: "add_columns",
    description:
      "Add preferred backend_version alongside legacy hermes_version.",
    sql: `ALTER TABLE tenant_deployments ADD COLUMN IF NOT EXISTS backend_version TEXT`,
  },
  {
    id: "td.backend_capabilities",
    phase: "add_columns",
    description:
      "Add backend_capabilities JSON text snapshot (not live Brain RPC).",
    sql: `ALTER TABLE tenant_deployments ADD COLUMN IF NOT EXISTS backend_capabilities TEXT`,
  },
  {
    id: "roles.backend_profile",
    phase: "add_columns",
    description:
      "Add preferred backend_profile alongside legacy hermes_profile.",
    sql: `ALTER TABLE roles ADD COLUMN IF NOT EXISTS backend_profile TEXT`,
  },
  {
    id: "td.backfill_backend_version",
    phase: "backfill",
    description:
      "Copy hermes_version → backend_version where preferred is still null.",
    sql: `UPDATE tenant_deployments
SET backend_version = hermes_version
WHERE backend_version IS NULL AND hermes_version IS NOT NULL`,
  },
  {
    id: "td.backfill_hermes_version",
    phase: "backfill",
    description:
      "Copy backend_version → hermes_version where only preferred was written.",
    sql: `UPDATE tenant_deployments
SET hermes_version = backend_version
WHERE hermes_version IS NULL AND backend_version IS NOT NULL`,
  },
  {
    id: "roles.backfill_backend_profile",
    phase: "backfill",
    description:
      "Copy hermes_profile → backend_profile for existing roles.",
    sql: `UPDATE roles
SET backend_profile = hermes_profile
WHERE backend_profile IS NULL AND hermes_profile IS NOT NULL`,
  },
  {
    id: "roles.backfill_hermes_profile",
    phase: "backfill",
    description:
      "Copy backend_profile → hermes_profile if only preferred was written.",
    sql: `UPDATE roles
SET hermes_profile = backend_profile
WHERE (hermes_profile IS NULL OR hermes_profile = '')
  AND backend_profile IS NOT NULL`,
  },
  {
    id: "td.backend_kind_check",
    phase: "constraints",
    description:
      "Optional CHECK for known backend_kind values (null allowed).",
    sql: `ALTER TABLE tenant_deployments
ADD CONSTRAINT tenant_deployments_backend_kind_check
CHECK (
  backend_kind IS NULL OR backend_kind IN (
    'hermes_upstream', 'hermes_lanyard', 'lanyard_agent'
  )
)`,
  },
  {
    id: "cutover.drop_hermes_version",
    phase: "cutover_later",
    description:
      "DO NOT RUN in lp-k7g.8.2. Drop hermes_version only after all clients use backend_version (lp-k7g.8.7 / phase 8).",
    sql: `-- DEFERRED: ALTER TABLE tenant_deployments DROP COLUMN hermes_version;`,
  },
  {
    id: "cutover.drop_hermes_profile",
    phase: "cutover_later",
    description:
      "DO NOT RUN in lp-k7g.8.2. Drop hermes_profile only after dual-emit window ends.",
    sql: `-- DEFERRED: ALTER TABLE roles DROP COLUMN hermes_profile;`,
  },
] as const;

/** SQL statements safe to run now (add columns + backfill). */
export function migrationSqlForApply(): string[] {
  return CONTROL_PLANE_BACKEND_FIELD_MIGRATION.filter(
    (step) =>
      step.phase === "add_columns" ||
      step.phase === "backfill" ||
      step.phase === "constraints",
  ).map((step) => step.sql);
}

/**
 * ensureOptionalColumns-style statements matching control-plane migrate.ts
 * patterns (try/catch duplicate_column). Postgres 9.1+ / IF NOT EXISTS where
 * supported; callers may strip IF NOT EXISTS and rely on 42701 handling.
 */
export const ENSURE_OPTIONAL_COLUMN_STATEMENTS: readonly string[] = [
  `ALTER TABLE tenant_deployments ADD COLUMN backend_kind TEXT`,
  `ALTER TABLE tenant_deployments ADD COLUMN backend_version TEXT`,
  `ALTER TABLE tenant_deployments ADD COLUMN backend_capabilities TEXT`,
  `ALTER TABLE roles ADD COLUMN backend_profile TEXT`,
];

/**
 * Greenfield CREATE TABLE fragments for tenant_deployments and roles.
 * Reference only — merge into migrateControlPlaneSchema CREATE blocks after
 * Portal import.
 */
export const GREENFIELD_TENANT_DEPLOYMENTS_BACKEND_COLUMNS = `
      client_core_version TEXT,
      backend_kind TEXT,
      backend_version TEXT,
      backend_capabilities TEXT,
      -- Temporary alias of backend_version (migration window)
      hermes_version TEXT,
`.trim();

export const GREENFIELD_ROLES_BACKEND_COLUMNS = `
      name TEXT NOT NULL,
      backend_profile TEXT NOT NULL,
      -- Temporary alias of backend_profile (migration window)
      hermes_profile TEXT NOT NULL,
`.trim();

/**
 * Human-readable field map for docs and issue close evidence.
 */
export const FIELD_MIGRATION_MAP = [
  {
    table: "tenant_deployments",
    preferred: "backend_kind",
    legacy: null,
    notes: "New column; no hermes_* alias. Values: hermes_upstream | hermes_lanyard | lanyard_agent.",
  },
  {
    table: "tenant_deployments",
    preferred: "backend_version",
    legacy: "hermes_version",
    notes: "Dual-read coalesce; dual-write both columns; API dual-emits both.",
  },
  {
    table: "tenant_deployments",
    preferred: "backend_capabilities",
    legacy: null,
    notes: "New JSON TEXT snapshot of capability descriptor; live discovery remains Brain RPC.",
  },
  {
    table: "roles",
    preferred: "backend_profile",
    legacy: "hermes_profile",
    notes: "Dual-read/write; UserRbac and Brain RPC subject use backend_profile preferred.",
  },
] as const;
