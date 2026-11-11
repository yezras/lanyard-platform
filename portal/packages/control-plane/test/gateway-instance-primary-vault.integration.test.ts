/**
 * lp-zoh.2 / plan 0010 — gateway_instances tenant-primary + dual vault prefixes.
 *
 * Acceptance (Postgres):
 *   - migration applies (columns exist; idempotent re-run)
 *   - backfill marks newest active tenant row as sole primary (legacy DBs)
 *   - unique partial index rejects a second active tenant primary
 *   - provisionInstance demotes prior primaries (latest registered wins)
 *   - duplicate scope=user per (tenant, user) still rejected (regression)
 *   - invalid prefix overrides fail closed with nothing inserted
 *
 * Requires CONTROL_PLANE_DATABASE_URL or DATABASE_URL (local docker compose postgres).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";

import {
  openDatabase,
  resolveDatabaseUrl,
  toPgPlaceholders,
  type SqlClient,
} from "../src/db.js";
import { migrateControlPlaneSchema } from "../src/migrate.js";
import { ControlPlaneStore, InvalidProvisionInputError } from "../src/store.js";
import { createTestStoreWithSchema } from "./pg-test-store.js";

/**
 * SqlClient bound to the store's isolated schema without DROP SCHEMA on close
 * (pattern: schema-boundary.integration.test.ts withSchemaClient).
 */
async function withSchemaSql<T>(
  schema: string,
  fn: (db: SqlClient) => Promise<T>,
): Promise<T> {
  const pool = new pg.Pool({
    connectionString: resolveDatabaseUrl(),
    options: `-c search_path=${schema},public`,
  });
  const db: SqlClient = {
    schema,
    exec: (sql) => pool.query(sql).then(() => undefined),
    run: async (sql, params = []) => {
      const result = await pool.query(toPgPlaceholders(sql), [...params]);
      return { changes: result.rowCount ?? 0 };
    },
    get: async (sql, params = []) => {
      const result = await pool.query(toPgPlaceholders(sql), [...params]);
      return result.rows[0];
    },
    all: async (sql, params = []) => {
      const result = await pool.query(toPgPlaceholders(sql), [...params]);
      return result.rows;
    },
    close: () => pool.end().then(() => undefined),
  };
  try {
    return await fn(db);
  } finally {
    await pool.end();
  }
}

async function countInstances(
  db: SqlClient,
  where = "",
  params: unknown[] = [],
): Promise<number> {
  const row = await db.get<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM gateway_instances${where ? ` WHERE ${where}` : ""}`,
    params,
  );
  return Number(row?.n ?? 0);
}

describe("gateway_instances primary + dual vault prefixes (lp-zoh.2, Postgres)", () => {
  let store: ControlPlaneStore;
  let schema: string;
  let tenantId: string;

  beforeEach(async () => {
    ({ store, schema } = await createTestStoreWithSchema());
    const tenant = await store.createTenant({
      slug: `primary-zoh2-${randomUUID().slice(0, 8)}`,
      display_name: "Primary ZOH2",
    });
    tenantId = tenant.tenant_id;
  });

  afterEach(async () => {
    await store.close();
  });

  it("has is_primary + dual vault prefix columns and re-runs migrate idempotently", async () => {
    await withSchemaSql(schema, async (db) => {
      // Idempotent: full migration applies cleanly a second time.
      await expect(migrateControlPlaneSchema(db)).resolves.toBeUndefined();

      const cols = await db.all<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'gateway_instances'`,
      );
      const names = cols.map((c) => c.column_name);
      expect(names).toEqual(
        expect.arrayContaining([
          "is_primary",
          "s3_shared_vault_prefix",
          "s3_personal_vault_prefix",
        ]),
      );

      const idx = await db.all<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = current_schema()
           AND tablename = 'gateway_instances'`,
      );
      expect(idx.map((i) => i.indexname)).toContain(
        "idx_gateway_instances_tenant_primary",
      );
    });
  });

  it("backfills legacy two-row tenants so only the newest is primary", async () => {
    await withSchemaSql(schema, async (db) => {
      // Legacy-shaped rows: is_primary defaults FALSE (pre-lp-zoh.2 DB).
      await db.run(
        `INSERT INTO gateway_instances
         (instance_id, tenant_id, secret_hash, secret_salt, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        ["inst-old", tenantId, "hash-old", "salt-old", "2026-08-01T00:00:00.000Z"],
      );
      await db.run(
        `INSERT INTO gateway_instances
         (instance_id, tenant_id, secret_hash, secret_salt, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        ["inst-new", tenantId, "hash-new", "salt-new", "2026-08-02T00:00:00.000Z"],
      );

      await migrateControlPlaneSchema(db);

      const primaries = await db.all<{ instance_id: string }>(
        `SELECT instance_id FROM gateway_instances WHERE is_primary`,
      );
      expect(primaries.map((r) => r.instance_id)).toEqual(["inst-new"]);
    });
  });

  it("unique partial index rejects a second active tenant primary", async () => {
    await withSchemaSql(schema, async (db) => {
      await db.run(
        `INSERT INTO gateway_instances
         (instance_id, tenant_id, secret_hash, secret_salt, created_at,
          scope, owner_user_id, is_primary)
         VALUES (?, ?, ?, ?, ?, 'tenant', NULL, TRUE)`,
        [
          "inst-primary",
          tenantId,
          "hash",
          "salt",
          "2026-08-01T00:00:00.000Z",
        ],
      );

      await expect(
        db.run(
          `INSERT INTO gateway_instances
           (instance_id, tenant_id, secret_hash, secret_salt, created_at,
            scope, owner_user_id, is_primary)
           VALUES (?, ?, ?, ?, ?, 'tenant', NULL, TRUE)`,
          [
            "inst-primary-2",
            tenantId,
            "hash",
            "salt",
            "2026-08-02T00:00:00.000Z",
          ],
        ),
      ).rejects.toMatchObject({
        code: "23505",
        constraint: "idx_gateway_instances_tenant_primary",
      });
    });
  });

  it("provisionInstance twice demotes older primary — latest wins, exactly one", async () => {
    const p1 = await store.provisionInstance({ tenant_id: tenantId });
    const p2 = await store.provisionInstance({ tenant_id: tenantId });

    expect(p1.is_primary).toBe(true);
    expect(p2.is_primary).toBe(true);

    const row1 = await store.getInstance(p1.instance_id);
    const row2 = await store.getInstance(p2.instance_id);
    expect(row1?.is_primary).toBe(false);
    expect(row2?.is_primary).toBe(true);

    const primary = await store.getPrimaryActiveInstance(tenantId);
    expect(primary?.instance_id).toBe(p2.instance_id);

    await withSchemaSql(schema, async (db) => {
      expect(
        await countInstances(
          db,
          "is_primary AND revoked_at IS NULL AND scope = 'tenant'",
        ),
      ).toBe(1);
    });
  });

  it("duplicate scope=user instance for same (tenant, user) is still rejected", async () => {
    const user = await store.registerUser({
      tenant_id: tenantId,
      email: "sandbox@zoh2.test",
      password: "password123",
    });

    const first = await store.provisionInstance({
      tenant_id: tenantId,
      scope: "user",
      owner_user_id: user.user_id,
    });
    expect(first.scope).toBe("user");

    await expect(
      store.provisionInstance({
        tenant_id: tenantId,
        scope: "user",
        owner_user_id: user.user_id,
      }),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("invalid prefix overrides fail closed with nothing inserted", async () => {
    const user = await store.registerUser({
      tenant_id: tenantId,
      email: "overrides@zoh2.test",
      password: "password123",
    });
    const uid = user.user_id;
    const otherUid = randomUUID();

    const before = await withSchemaSql(schema, (db) => countInstances(db));

    // Shared override bound to a foreign tenant.
    await expect(
      store.provisionInstance({
        tenant_id: tenantId,
        s3_shared_vault_prefix: "tenants/other-tenant/vault/shared/",
      }),
    ).rejects.toBeInstanceOf(InvalidProvisionInputError);

    // Shared override with legacy shape / missing trailing slash.
    await expect(
      store.provisionInstance({
        tenant_id: tenantId,
        s3_shared_vault_prefix: `tenants/${tenantId}/vault/`,
      }),
    ).rejects.toBeInstanceOf(InvalidProvisionInputError);
    await expect(
      store.provisionInstance({
        tenant_id: tenantId,
        s3_shared_vault_prefix: `tenants/${tenantId}/vault/shared`,
      }),
    ).rejects.toBeInstanceOf(InvalidProvisionInputError);

    // Personal override on tenant scope is rejected outright.
    await expect(
      store.provisionInstance({
        tenant_id: tenantId,
        s3_personal_vault_prefix: `tenants/${tenantId}/users/${uid}/vault/`,
      }),
    ).rejects.toBeInstanceOf(InvalidProvisionInputError);

    // Personal override bound to another user.
    await expect(
      store.provisionInstance({
        tenant_id: tenantId,
        scope: "user",
        owner_user_id: uid,
        s3_personal_vault_prefix: `tenants/${tenantId}/users/${otherUid}/vault/`,
      }),
    ).rejects.toBeInstanceOf(InvalidProvisionInputError);

    // Traversal in a personal override.
    await expect(
      store.provisionInstance({
        tenant_id: tenantId,
        scope: "user",
        owner_user_id: uid,
        s3_personal_vault_prefix: `tenants/${tenantId}/users/../users/x/vault/`,
      }),
    ).rejects.toBeInstanceOf(InvalidProvisionInputError);

    const after = await withSchemaSql(schema, (db) => countInstances(db));
    expect(after).toBe(before);
  });

  it("valid user provision auto-assigns shared + personal prefixes exactly", async () => {
    const user = await store.registerUser({
      tenant_id: tenantId,
      email: "personal@zoh2.test",
      password: "password123",
    });

    const provisioned = await store.provisionInstance({
      tenant_id: tenantId,
      runtime_kind: "daytona",
      scope: "user",
      owner_user_id: user.user_id,
    });

    expect(provisioned.is_primary).toBe(false);
    expect(provisioned.s3_shared_vault_prefix).toBe(
      `tenants/${tenantId}/vault/shared/`,
    );
    expect(provisioned.s3_personal_vault_prefix).toBe(
      `tenants/${tenantId}/users/${user.user_id}/vault/`,
    );

    const row = await store.getInstance(provisioned.instance_id);
    expect(row?.is_primary).toBe(false);
    expect(row?.s3_shared_vault_prefix).toBe(
      `tenants/${tenantId}/vault/shared/`,
    );
    expect(row?.s3_personal_vault_prefix).toBe(
      `tenants/${tenantId}/users/${user.user_id}/vault/`,
    );
  });

  it("valid tenant provision assigns shared prefix only and is_primary=true", async () => {
    const provisioned = await store.provisionInstance({
      tenant_id: tenantId,
      runtime_kind: "daytona",
    });

    expect(provisioned.is_primary).toBe(true);
    expect(provisioned.s3_shared_vault_prefix).toBe(
      `tenants/${tenantId}/vault/shared/`,
    );
    expect(provisioned.s3_personal_vault_prefix).toBeNull();
  });

  it("listScopedInstanceRecords carries real is_primary values", async () => {
    const p1 = await store.provisionInstance({ tenant_id: tenantId });
    const p2 = await store.provisionInstance({ tenant_id: tenantId });
    const user = await store.registerUser({
      tenant_id: tenantId,
      email: "scoped@zoh2.test",
      password: "password123",
    });
    const up = await store.provisionInstance({
      tenant_id: tenantId,
      scope: "user",
      owner_user_id: user.user_id,
    });

    const records = await store.listScopedInstanceRecords(tenantId);
    const byId = new Map(records.map((r) => [r.instance_id, r]));

    expect(byId.get(p1.instance_id)?.is_primary).toBe(false);
    expect(byId.get(p2.instance_id)?.is_primary).toBe(true);
    expect(byId.get(up.instance_id)?.is_primary).toBe(false);
    expect(byId.get(up.instance_id)?.owner_user_id).toBe(user.user_id);
  });
});
