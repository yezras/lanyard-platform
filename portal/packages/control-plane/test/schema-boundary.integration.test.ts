/**
 * cbd-mta.3.1 — tenant-scoped schema boundary.
 *
 * Proves FKs/triggers reject cross-tenant joins, schema has no vault-body
 * tables, and session-share owner must live in the grant tenant.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";

import { ControlPlaneStore } from "../src/store.js";
import { SessionShareOwnerNotFoundError } from "../src/session-shares.js";
import { openDatabase, resolveDatabaseUrl, toPgPlaceholders } from "../src/db.js";
import { migrateControlPlaneSchema } from "../src/migrate.js";
import { createTestStore } from "./pg-test-store.js";

/** Query the store's isolated schema without DROP SCHEMA on teardown. */
async function withSchemaClient<T>(
  schema: string,
  fn: (query: (sql: string, params?: unknown[]) => Promise<pg.QueryResult>) => Promise<T>,
): Promise<T> {
  const pool = new pg.Pool({
    connectionString: resolveDatabaseUrl(),
    options: `-c search_path=${schema},public`,
  });
  try {
    const query = (sql: string, params: unknown[] = []) =>
      pool.query(toPgPlaceholders(sql), params);
    return await fn(query);
  } finally {
    await pool.end();
  }
}

describe("control-plane schema boundary (cbd-mta.3.1)", () => {
  let store: ControlPlaneStore;
  let schema: string;
  let tenantAId: string;
  let tenantBId: string;
  let userAId: string;
  let userBId: string;
  let roleAId: string;

  beforeEach(async () => {
    schema = `cp_test_${randomUUID().replace(/-/g, "")}`;
    store = await ControlPlaneStore.create({ schema });

    const tenantA = await store.createTenant({
      slug: "schema-alpha",
      display_name: "Schema Alpha",
    });
    const tenantB = await store.createTenant({
      slug: "schema-beta",
      display_name: "Schema Beta",
    });
    tenantAId = tenantA.tenant_id;
    tenantBId = tenantB.tenant_id;

    const userA = await store.registerUser({
      tenant_id: tenantAId,
      email: "owner@alpha.test",
      password: "password123",
    });
    const userB = await store.registerUser({
      tenant_id: tenantBId,
      email: "peer@beta.test",
      password: "password123",
    });
    userAId = userA.user_id;
    userBId = userB.user_id;

    const roleA = await store.createRole({
      tenant_id: tenantAId,
      name: "admin",
      hermes_profile: "admin",
      path_prefixes: ["/"],
    });
    roleAId = roleA.role_id;

    await store.createRole({
      tenant_id: tenantBId,
      name: "contributor",
      hermes_profile: "contributor",
      path_prefixes: ["/Projects"],
    });
  });

  afterEach(async () => {
    await store.close();
  });

  it("rejects cross-tenant role assignment at the store layer", async () => {
    await expect(
      store.setUserRoles({
        tenant_id: tenantBId,
        user_id: userBId,
        role_ids: [roleAId],
      }),
    ).rejects.toMatchObject({ code: "ROLE_NOT_FOUND" });
  });

  it("rejects cross-tenant user_roles insert at the DB trigger", async () => {
    await withSchemaClient(schema, async (query) => {
      await expect(
        query(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`, [
          userBId,
          roleAId,
        ]),
      ).rejects.toThrow(/cross-tenant assignment denied/i);
    });
  });

  it("rejects session-share create when owner is from another tenant", async () => {
    await expect(
      store.createSessionShareGrant({
        tenant_id: tenantBId,
        owner_user_id: userAId,
        thread_id: "thread-1",
        grantee_email: "peer@beta.test",
        mode: "read",
      }),
    ).rejects.toBeInstanceOf(SessionShareOwnerNotFoundError);
  });

  it("stores vault_path metadata only (no file body columns on projects)", async () => {
    await store.setUserRoles({
      tenant_id: tenantAId,
      user_id: userAId,
      role_ids: [roleAId],
    });
    const project = await store.createProject({
      tenant_id: tenantAId,
      user_id: userAId,
      name: "Memo",
      vault_path: "/Projects/Memo",
    });
    expect(project.vault_path).toBe("/Projects/Memo");
    expect(project).not.toHaveProperty("content");
    expect(project).not.toHaveProperty("body");
    expect(project).not.toHaveProperty("file_body");
  });

  it("stores instance secret hashes only (no plaintext secret column)", async () => {
    const provisioned = await store.provisionInstance({ tenant_id: tenantAId });
    expect(provisioned.secret).toBeTruthy();

    await withSchemaClient(schema, async (query) => {
      const result = await query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'gateway_instances'
         ORDER BY column_name`,
      );
      const names = result.rows.map(
        (c: { column_name: string }) => c.column_name,
      );
      expect(names).toContain("secret_hash");
      expect(names).toContain("secret_salt");
      expect(names).not.toContain("secret");
      expect(names).not.toContain("plaintext_secret");
      // lp-nye: dual-run fields are metadata refs only (not vault bodies)
      expect(names).toEqual(
        expect.arrayContaining([
          "runtime_kind",
          "sandbox_id",
          "presence",
          "agent_snapshot_id",
          "s3_vault_prefix",
          "chat_delivery",
        ]),
      );
    });
  });

  it("has no tables that look like vault file body stores", async () => {
    await withSchemaClient(schema, async (query) => {
      const result = await query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = current_schema()
           AND table_type = 'BASE TABLE'
         ORDER BY table_name`,
      );
      const names = result.rows.map((t: { table_name: string }) => t.table_name);
      expect(names).toEqual(
        expect.arrayContaining([
          "tenants",
          "users",
          "roles",
          "role_path_prefixes",
          "user_roles",
          "gateway_instances",
          "projects",
          "session_share_grants",
          "canonical_connectors",
          "canonical_connector_aliases",
          "tenant_connector_entitlements",
          "role_connector_grants",
          "person_connector_grants",
          "connector_member_subsets",
          "connector_connections",
          "tenant_connector_class_c_secrets",
          "audit_log",
        ]),
      );
      for (const forbidden of [
        "vault_files",
        "file_bodies",
        "chat_messages",
        "brain_content",
        "documents",
      ]) {
        expect(names).not.toContain(forbidden);
      }
    });
  });

  it("enforces unique tenant slug and tenant-scoped email", async () => {
    await expect(
      store.createTenant({ slug: "schema-alpha", display_name: "Dup" }),
    ).rejects.toMatchObject({ code: "TENANT_SLUG_CONFLICT" });

    await expect(
      store.registerUser({
        tenant_id: tenantAId,
        email: "owner@alpha.test",
        password: "password123",
      }),
    ).rejects.toMatchObject({ code: "USER_EMAIL_CONFLICT" });

    // Same email in another tenant is allowed (tenant-scoped uniqueness).
    const other = await store.registerUser({
      tenant_id: tenantBId,
      email: "owner@alpha.test",
      password: "password123",
    });
    expect(other.tenant_id).toBe(tenantBId);
  });

  it("rejects cross-tenant person_connector_grants at the trigger", async () => {
    await withSchemaClient(schema, async (query) => {
      await expect(
        query(
          `INSERT INTO person_connector_grants
             (tenant_id, user_id, connector_id, created_at)
           VALUES (?, ?, 'google', ?)`,
          [tenantAId, userBId, new Date().toISOString()],
        ),
      ).rejects.toThrow(/person_connector_grants: cross-tenant/);
    });
  });
});

describe("migrateControlPlaneSchema is idempotent", () => {
  it("applies twice without error on a fresh schema", async () => {
    const schema = `cp_mig_${randomUUID().replace(/-/g, "")}`;
    const db = await openDatabase({
      connectionString: resolveDatabaseUrl(),
      schema,
    });
    try {
      await migrateControlPlaneSchema(db);
      await migrateControlPlaneSchema(db);
      const tenants = await db.get<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM tenants`,
      );
      expect(tenants?.n).toBe("0");
    } finally {
      await db.close();
    }
  });
});
