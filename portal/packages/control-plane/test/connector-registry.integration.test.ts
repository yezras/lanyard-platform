/**
 * lp-hdzm.4 — canonical connector registry, FK instead of 4-id CHECK,
 * parseConnectorId looks up CP, slack legal after promote.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";

import { createApp } from "../src/app.js";
import {
  FIRST_CLASS_CONNECTOR_IDS,
  InvalidConnectorIdError,
  parseConnectorId,
} from "../src/connectors.js";
import { openDatabase, resolveDatabaseUrl, toPgPlaceholders } from "../src/db.js";
import { migrateControlPlaneSchema } from "../src/migrate.js";
import { CONTROL_PLANE_SERVICE_TOKEN_HEADER } from "../src/service-auth.js";
import { createTestStoreWithSchema } from "./pg-test-store.js";

const SERVICE_TOKEN = "test-cp-service-token";

type ConstraintRow = { def: string; conname: string };

describe("canonical connector registry (lp-hdzm.4)", () => {
  it("seeds first-class ids and google/hubspot aliases; migrate is idempotent", async () => {
    const schema = `cp_reg_${randomUUID().replace(/-/g, "")}`;
    const db = await openDatabase({
      connectionString: resolveDatabaseUrl(),
      schema,
    });
    try {
      await migrateControlPlaneSchema(db);
      await migrateControlPlaneSchema(db);

      const rows = await db.all<{ id: string; seeded: number | boolean }>(
        `SELECT id, seeded FROM canonical_connectors ORDER BY id`,
      );
      expect(rows.map((row) => row.id)).toEqual([
        "github",
        "google",
        "hubspot",
        "whatsapp",
      ]);
      for (const row of rows) {
        expect(Boolean(row.seeded)).toBe(true);
      }

      const aliases = await db.all<{ alias: string; connector_id: string }>(
        `SELECT alias, connector_id FROM canonical_connector_aliases ORDER BY alias`,
      );
      expect(aliases).toEqual(
        expect.arrayContaining([
          { alias: "gmail.com", connector_id: "google" },
          { alias: "google.com", connector_id: "google" },
          { alias: "googleapis.com", connector_id: "google" },
          { alias: "*.google.com", connector_id: "google" },
          { alias: "hubspot.com", connector_id: "hubspot" },
          { alias: "hubapi.com", connector_id: "hubspot" },
          { alias: "*.hubspot.com", connector_id: "hubspot" },
          { alias: "*.hubapi.com", connector_id: "hubspot" },
        ]),
      );
      expect(aliases.filter((row) => row.connector_id === "google").length).toBe(
        4,
      );
      expect(aliases.filter((row) => row.connector_id === "hubspot").length).toBe(
        4,
      );
    } finally {
      await db.close();
    }
  });

  it("drops four-id CHECKs and attaches FKs to canonical_connectors", async () => {
    const schema = `cp_fk_${randomUUID().replace(/-/g, "")}`;
    const db = await openDatabase({
      connectionString: resolveDatabaseUrl(),
      schema,
    });
    try {
      await migrateControlPlaneSchema(db);
      const checks = await db.all<ConstraintRow>(
        `SELECT conname, pg_get_constraintdef(oid) AS def
         FROM pg_constraint
         WHERE contype = 'c'
           AND conrelid IN (
             'tenant_connector_entitlements'::regclass,
             'role_connector_grants'::regclass,
             'connector_connections'::regclass
           )`,
      );
      for (const row of checks) {
        expect(row.def.toLowerCase()).not.toMatch(/connector_id in\s*\(/);
        expect(row.def.toLowerCase()).not.toMatch(/connector_id = any/);
      }

      const fks = await db.all<{ tbl: string; def: string }>(
        `SELECT conrelid::regclass::text AS tbl, pg_get_constraintdef(oid) AS def
         FROM pg_constraint
         WHERE contype = 'f'
           AND conrelid IN (
             'tenant_connector_entitlements'::regclass,
             'role_connector_grants'::regclass,
             'connector_connections'::regclass
           )`,
      );
      const defs = fks.map((row) => row.def).join(" ");
      expect(defs).toMatch(/canonical_connectors/);
      expect(fks.length).toBeGreaterThanOrEqual(3);
    } finally {
      await db.close();
    }
  });

  it("drops a leftover Postgres ANY-form four-id CHECK so stripe can onboard", async () => {
    const schema = `cp_any_${randomUUID().replace(/-/g, "")}`;
    const db = await openDatabase({
      connectionString: resolveDatabaseUrl(),
      schema,
    });
    try {
      await migrateControlPlaneSchema(db);
      await db.exec(
        `ALTER TABLE tenant_connector_entitlements
           ADD CONSTRAINT tenant_connector_entitlements_connector_id_check
           CHECK (connector_id IN ('google', 'hubspot', 'whatsapp', 'github'))`,
      );
      const planted = await db.get<ConstraintRow>(
        `SELECT c.conname, pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c
         JOIN pg_class rel ON rel.oid = c.conrelid
         JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
         WHERE c.conname = 'tenant_connector_entitlements_connector_id_check'
           AND nsp.nspname = current_schema()`,
      );
      expect(planted?.def.toLowerCase()).toMatch(/connector_id = any/);

      await migrateControlPlaneSchema(db);

      const leftover = await db.get<ConstraintRow>(
        `SELECT c.conname, pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c
         JOIN pg_class rel ON rel.oid = c.conrelid
         JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
         WHERE c.conname = 'tenant_connector_entitlements_connector_id_check'
           AND nsp.nspname = current_schema()`,
      );
      expect(leftover).toBeUndefined();

      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO tenants (tenant_id, tenant_slug, display_name, created_at)
         VALUES (?, ?, ?, ?)`,
        ["t-stripe", "stripe-onboard", "Stripe Onboard", now],
      );
      await db.run(
        `INSERT INTO canonical_connectors
           (id, domain, label, archived, seeded, source, snapshot, created_at)
         VALUES (?, ?, ?, 0, 0, 'integrations.sh', '{}'::jsonb, ?)`,
        ["stripe", "stripe.com", "Stripe", now],
      );
      await db.run(
        `INSERT INTO tenant_connector_entitlements
           (tenant_id, connector_id, enabled, hubspot_portal_id, surfaces_json,
            created_at, updated_at)
         VALUES (?, ?, 1, NULL, ?, ?, ?)`,
        ["t-stripe", "stripe", '["mcp"]', now, now],
      );
      const row = await db.get<{ connector_id: string }>(
        `SELECT connector_id FROM tenant_connector_entitlements
         WHERE tenant_id = ? AND connector_id = ?`,
        ["t-stripe", "stripe"],
      );
      expect(row?.connector_id).toBe("stripe");
    } finally {
      await db.close();
    }
  });

  it("parseConnectorId rejects slack until promote, then accepts it", async () => {
    const schema = `cp_parse_${randomUUID().replace(/-/g, "")}`;
    const db = await openDatabase({
      connectionString: resolveDatabaseUrl(),
      schema,
    });
    try {
      await migrateControlPlaneSchema(db);
      await expect(parseConnectorId(db, "slack")).rejects.toBeInstanceOf(
        InvalidConnectorIdError,
      );
      await expect(parseConnectorId(db, "outlook")).rejects.toBeInstanceOf(
        InvalidConnectorIdError,
      );
      await expect(parseConnectorId(db, "")).rejects.toBeInstanceOf(
        InvalidConnectorIdError,
      );

      for (const id of FIRST_CLASS_CONNECTOR_IDS) {
        await expect(parseConnectorId(db, id)).resolves.toBe(id);
      }

      await db.run(
        `INSERT INTO canonical_connectors
           (id, domain, label, archived, seeded, snapshot, created_at)
         VALUES (?, ?, ?, 0, 0, '{}'::jsonb, ?)`,
        ["slack", "slack.com", "Slack", new Date().toISOString()],
      );
      await expect(parseConnectorId(db, "slack")).resolves.toBe("slack");
    } finally {
      await db.close();
    }
  });

  it("FK rejects unpromoted slack; allows entitlement after promote", async () => {
    const schema = `cp_ent_${randomUUID().replace(/-/g, "")}`;
    const db = await openDatabase({
      connectionString: resolveDatabaseUrl(),
      schema,
    });
    try {
      await migrateControlPlaneSchema(db);
      const tenant = await db.get<{ tenant_id: string }>(
        `INSERT INTO tenants (tenant_id, tenant_slug, display_name, created_at)
         VALUES (?, ?, ?, ?)
         RETURNING tenant_id`,
        [
          `t-${randomUUID()}`,
          `slug-${randomUUID().slice(0, 8)}`,
          "Reg",
          new Date().toISOString(),
        ],
      );
      const tenantId = tenant?.tenant_id;
      expect(tenantId).toBeTruthy();

      await expect(
        db.run(
          `INSERT INTO tenant_connector_entitlements
             (tenant_id, connector_id, enabled, created_at, updated_at)
           VALUES (?, 'slack', 1, ?, ?)`,
          [tenantId, new Date().toISOString(), new Date().toISOString()],
        ),
      ).rejects.toThrow(/canonical_connectors|foreign key/i);

      await db.run(
        `INSERT INTO canonical_connectors
           (id, domain, label, archived, seeded, snapshot, created_at)
         VALUES ('slack', 'slack.com', 'Slack', 0, 0, '{}'::jsonb, ?)`,
        [new Date().toISOString()],
      );
      await db.run(
        `INSERT INTO tenant_connector_entitlements
           (tenant_id, connector_id, enabled, created_at, updated_at)
         VALUES (?, 'slack', 1, ?, ?)`,
        [tenantId, new Date().toISOString(), new Date().toISOString()],
      );
      const row = await db.get<{ connector_id: string }>(
        `SELECT connector_id FROM tenant_connector_entitlements
         WHERE tenant_id = ? AND connector_id = 'slack'`,
        [tenantId],
      );
      expect(row?.connector_id).toBe("slack");
    } finally {
      await db.close();
    }
  });
});

describe("role_connector_grants is not SaaS ACL (lp-hdzm.4)", () => {
  let store: Awaited<ReturnType<typeof createTestStoreWithSchema>>["store"];
  let schema = "";
  let app: ReturnType<typeof createApp>;
  let tenantId = "";
  let userId = "";

  beforeEach(async () => {
    const created = await createTestStoreWithSchema();
    store = created.store;
    schema = created.schema;
    app = createApp(store, { serviceToken: SERVICE_TOKEN });
    const tenant = await store.createTenant({
      slug: "acl-alpha",
      display_name: "ACL Alpha",
    });
    tenantId = tenant.tenant_id;
    const user = await store.registerUser({
      tenant_id: tenantId,
      email: "acl@alpha.test",
      password: "password123",
    });
    userId = user.user_id;
  });

  afterEach(async () => {
    await store.close();
  });

  it("entitlement on grants access without a role_connector_grants row", async () => {
    await store.upsertTenantConnectorEntitlement({
      tenant_id: tenantId,
      connector_id: "google",
      enabled: true,
    });
    const access = await store.getUserConnectorAccess(
      tenantId,
      userId,
      "google",
    );
    expect(access.entitled).toBe(true);
    expect(access.role_granted).toBe(true);

    const res = await app.request(
      `/internal/tenants/${tenantId}/users/${userId}/connectors/google/access`,
      {
        headers: { [CONTROL_PLANE_SERVICE_TOKEN_HEADER]: SERVICE_TOKEN },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { role_granted: boolean };
    expect(body.role_granted).toBe(true);
  });

  it("HTTP parseConnectorId accepts slack after promote", async () => {
    const pool = new pg.Pool({
      connectionString: resolveDatabaseUrl(),
      options: `-c search_path=${schema},public`,
    });
    try {
      await pool.query(
        toPgPlaceholders(
          `INSERT INTO canonical_connectors
             (id, domain, label, archived, seeded, snapshot, created_at)
           VALUES (?, ?, ?, 0, 0, '{}'::jsonb, ?)`,
        ),
        ["slack", "slack.com", "Slack", new Date().toISOString()],
      );
    } finally {
      await pool.end();
    }

    const unknown = await app.request(
      `/internal/tenants/${tenantId}/connector-entitlements/outlook`,
      {
        headers: { [CONTROL_PLANE_SERVICE_TOKEN_HEADER]: SERVICE_TOKEN },
      },
    );
    expect(unknown.status).toBe(400);

    const slack = await app.request(
      `/internal/tenants/${tenantId}/connector-entitlements/slack`,
      {
        method: "PUT",
        headers: {
          [CONTROL_PLANE_SERVICE_TOKEN_HEADER]: SERVICE_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify({ enabled: true }),
      },
    );
    expect(slack.status).toBe(200);
    const body = (await slack.json()) as {
      connector_id: string;
      enabled: boolean;
    };
    expect(body.connector_id).toBe("slack");
    expect(body.enabled).toBe(true);
  });
});
