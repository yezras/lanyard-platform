/**
 * lp-zoh.3 / plan 0010 — idempotent ensure-provision APIs (Postgres).
 *
 * Acceptance:
 *   - ensureTenantPrimaryInstance twice → stable instance_id, created
 *     true→false, exactly one primary row
 *   - ensureUserSandboxInstance twice → stable id, dual prefixes exactly
 *     tenants/{tid}/vault/shared/ + tenants/{tid}/users/{uid}/vault/,
 *     is_primary false
 *   - unique-violation retry paths return created:false instead of 500-ing
 *   - listScopedInstanceRecords reflects the scope=user row with real
 *     is_primary after ensure-user
 *
 * Requires CONTROL_PLANE_DATABASE_URL or DATABASE_URL (local docker compose postgres).
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";

import {
  openDatabase,
  resolveDatabaseUrl,
  toPgPlaceholders,
  type SqlClient,
} from "../src/db.js";
import { ControlPlaneStore } from "../src/store.js";
import { createTestStoreWithSchema } from "./pg-test-store.js";

/**
 * SqlClient bound to the store's isolated schema without DROP SCHEMA on close
 * (pattern: gateway-instance-primary-vault.integration.test.ts).
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

describe("ensure-provision APIs (lp-zoh.3, Postgres)", () => {
  let store: ControlPlaneStore;
  let schema: string;
  let tenantId: string;
  let userId: string;

  beforeEach(async () => {
    ({ store, schema } = await createTestStoreWithSchema());
    const tenant = await store.createTenant({
      slug: `ensure-zoh3-${randomUUID().slice(0, 8)}`,
      display_name: "Ensure ZOH3",
    });
    tenantId = tenant.tenant_id;
    const user = await store.registerUser({
      tenant_id: tenantId,
      email: `${randomUUID().slice(0, 8)}@zoh3.test`,
      password: "password123",
    });
    userId = user.user_id;
  });

  afterEach(async () => {
    await store.close();
  });

  it("ensureTenantPrimaryInstance twice returns a stable id and one primary row", async () => {
    const first = await store.ensureTenantPrimaryInstance({ tenant_id: tenantId });
    const second = await store.ensureTenantPrimaryInstance({ tenant_id: tenantId });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.instance_id).toBe(first.instance_id);

    const row = await store.getInstance(first.instance_id);
    expect(row?.scope).toBe("tenant");
    expect(row?.owner_user_id).toBeNull();
    expect(row?.is_primary).toBe(true);
    expect(row?.presence).toBe("offline");
    expect(row?.sandbox_id).toBeNull();
    expect(row?.s3_shared_vault_prefix).toBe(`tenants/${tenantId}/vault/shared/`);
    expect(row?.s3_personal_vault_prefix).toBeNull();

    const primary = await store.getPrimaryActiveInstance(tenantId);
    expect(primary?.instance_id).toBe(first.instance_id);

    await withSchemaSql(schema, async (db) => {
      expect(
        await countInstances(
          db,
          "is_primary AND revoked_at IS NULL AND scope = 'tenant'",
        ),
      ).toBe(1);
    });
  });

  it("tenant-primary unique-violation retry path returns existing row, created:false", async () => {
    const first = await store.ensureTenantPrimaryInstance({ tenant_id: tenantId });

    // Simulate losing a concurrent ensure: the pre-lookup misses (the winner's
    // row is not yet visible), then provisionInstance hits the
    // idx_gateway_instances_tenant_primary violation; ensure must re-fetch
    // and return the winner instead of surfacing the error.
    const lookupSpy = vi
      .spyOn(store, "getPrimaryActiveInstance")
      .mockResolvedValueOnce(null);
    const violation = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "idx_gateway_instances_tenant_primary"',
      ),
      { code: "23505", constraint: "idx_gateway_instances_tenant_primary" },
    );
    const provisionSpy = vi
      .spyOn(store, "provisionInstance")
      .mockRejectedValueOnce(violation);

    try {
      const raced = await store.ensureTenantPrimaryInstance({ tenant_id: tenantId });
      expect(raced.created).toBe(false);
      expect(raced.instance_id).toBe(first.instance_id);
      expect(provisionSpy).toHaveBeenCalledTimes(1);
    } finally {
      lookupSpy.mockRestore();
      provisionSpy.mockRestore();
    }
  });

  it("ensureUserSandboxInstance twice returns a stable id with exact dual prefixes", async () => {
    const first = await store.ensureUserSandboxInstance({
      tenant_id: tenantId,
      owner_user_id: userId,
    });
    const second = await store.ensureUserSandboxInstance({
      tenant_id: tenantId,
      owner_user_id: userId,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.instance_id).toBe(first.instance_id);
    expect(second.scope).toBe("user");
    expect(second.owner_user_id).toBe(userId);
    expect(second.is_primary).toBe(false);
    expect(second.presence).toBe("offline");
    expect(second.sandbox_id).toBeNull();
    expect(second.s3_shared_vault_prefix).toBe(`tenants/${tenantId}/vault/shared/`);
    expect(second.s3_personal_vault_prefix).toBe(
      `tenants/${tenantId}/users/${userId}/vault/`,
    );

    const row = await store.getInstance(first.instance_id);
    expect(row?.scope).toBe("user");
    expect(row?.owner_user_id).toBe(userId);
    expect(row?.is_primary).toBe(false);
    expect(row?.s3_shared_vault_prefix).toBe(`tenants/${tenantId}/vault/shared/`);
    expect(row?.s3_personal_vault_prefix).toBe(
      `tenants/${tenantId}/users/${userId}/vault/`,
    );
  });

  it("duplicate user-instance insert does not 500 — retry branch returns raced row", async () => {
    // Row already exists; force the in-method lookup to miss once so ensure
    // proceeds to INSERT, loses idx_gateway_instances_user_owner, and takes
    // the unique-violation re-fetch branch.
    const existing = await store.provisionInstance({
      tenant_id: tenantId,
      scope: "user",
      owner_user_id: userId,
    });

    const lookupSpy = vi
      .spyOn(store, "getUserSandboxInstance")
      .mockResolvedValueOnce(null);

    try {
      const ensured = await store.ensureUserSandboxInstance({
        tenant_id: tenantId,
        owner_user_id: userId,
      });
      expect(ensured.created).toBe(false);
      expect(ensured.instance_id).toBe(existing.instance_id);
      expect(ensured.owner_user_id).toBe(userId);
      expect(ensured.s3_shared_vault_prefix).toBe(
        `tenants/${tenantId}/vault/shared/`,
      );
      expect(ensured.s3_personal_vault_prefix).toBe(
        `tenants/${tenantId}/users/${userId}/vault/`,
      );
    } finally {
      lookupSpy.mockRestore();
    }

    await withSchemaSql(schema, async (db) => {
      expect(
        await countInstances(
          db,
          "scope = 'user' AND owner_user_id = ? AND revoked_at IS NULL",
          [userId],
        ),
      ).toBe(1);
    });
  });

  it("listScopedInstanceRecords reflects the ensured scope=user row", async () => {
    const primary = await store.ensureTenantPrimaryInstance({ tenant_id: tenantId });
    const userInstance = await store.ensureUserSandboxInstance({
      tenant_id: tenantId,
      owner_user_id: userId,
    });

    const records = await store.listScopedInstanceRecords(tenantId);
    const byId = new Map(records.map((r) => [r.instance_id, r]));

    expect(byId.get(primary.instance_id)?.scope).toBe("tenant");
    expect(byId.get(primary.instance_id)?.is_primary).toBe(true);
    expect(byId.get(userInstance.instance_id)?.scope).toBe("user");
    expect(byId.get(userInstance.instance_id)?.owner_user_id).toBe(userId);
    expect(byId.get(userInstance.instance_id)?.is_primary).toBe(false);
  });
});
