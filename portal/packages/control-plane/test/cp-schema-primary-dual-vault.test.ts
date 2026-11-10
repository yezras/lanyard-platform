/**
 * lp-zoh.2 / plan 0010 — CP schema for tenant primary + dual vault prefixes.
 *
 * Offline source-text checks on the migration (pattern:
 * runtime-kind-fields.test.ts). DB behavior lives in
 * gateway-instance-primary-vault.integration.test.ts.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrateSrc = readFileSync(
  join(__dirname, "../src/migrate.ts"),
  "utf8",
);

describe("gateway_instances primary + dual vault prefix columns (lp-zoh.2)", () => {
  it("greenfield CREATE TABLE includes is_primary and dual vault prefixes", () => {
    expect(migrateSrc).toContain("is_primary BOOLEAN NOT NULL DEFAULT FALSE");
    expect(migrateSrc).toContain("s3_shared_vault_prefix TEXT");
    expect(migrateSrc).toContain("s3_personal_vault_prefix TEXT");
  });

  it("ensureOptionalColumns upgrades existing gateway_instances tables", () => {
    expect(migrateSrc).toContain(
      "ALTER TABLE gateway_instances ADD COLUMN is_primary BOOLEAN NOT NULL DEFAULT FALSE",
    );
    expect(migrateSrc).toContain(
      "ALTER TABLE gateway_instances ADD COLUMN s3_shared_vault_prefix TEXT",
    );
    expect(migrateSrc).toContain(
      "ALTER TABLE gateway_instances ADD COLUMN s3_personal_vault_prefix TEXT",
    );
  });

  it("creates the one-primary-per-tenant unique partial index", () => {
    expect(migrateSrc).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_gateway_instances_tenant_primary\s+ON gateway_instances\(tenant_id\)\s+WHERE revoked_at IS NULL AND scope = 'tenant' AND is_primary/,
    );
  });

  it("backfill of exactly one primary per tenant precedes the unique index", () => {
    const backfillIdx = migrateSrc.indexOf("SET is_primary = TRUE");
    const ensureColumnsIdx = migrateSrc.indexOf("await ensureOptionalColumns");
    const uniqueIndexIdx = migrateSrc.indexOf(
      "idx_gateway_instances_tenant_primary",
    );
    expect(backfillIdx).toBeGreaterThan(-1);
    // Backfill needs the column to exist on legacy DBs, and must run before
    // CREATE UNIQUE INDEX or existing duplicate-primary rows would break it.
    expect(backfillIdx).toBeGreaterThan(ensureColumnsIdx);
    expect(uniqueIndexIdx).toBeGreaterThan(backfillIdx);
  });

  it("backfill targets active tenant-scope rows only (latest wins)", () => {
    expect(migrateSrc).toMatch(
      /UPDATE gateway_instances\s+SET is_primary = TRUE\s+WHERE COALESCE\(scope, 'tenant'\) = 'tenant'\s+AND revoked_at IS NULL/,
    );
  });
});
