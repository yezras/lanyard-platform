/**
 * lp-hdzm.24 — Class C CP KMS store keyed (tenant, connector, surface).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";

import { createApp } from "../src/app.js";
import {
  applyClassCHarnessHttp,
  assertClassCNotInProviderWakeEnv,
  assertClassCNotOnGuestFs,
  buildClassCHttpAttach,
} from "../src/class-c-attach.js";
import { createInMemoryGuestConnectorStore } from "../src/connector-user-sandbox.js";
import type { ConnectorId } from "../src/connectors.js";
import { fingerprintSecretValue } from "../src/daytona-env-redact.js";
import { resolveDatabaseUrl, toPgPlaceholders } from "../src/db.js";
import { CONTROL_PLANE_SERVICE_TOKEN_HEADER } from "../src/service-auth.js";
import { ControlPlaneStore } from "../src/store.js";
import { createTestStoreWithSchema } from "./pg-test-store.js";

type JsonBody = Record<string, unknown>;

const SERVICE_TOKEN = "test-cp-service-token";
const PLAIN = "sk_test_class_c_live_value";

async function jsonRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: JsonBody; raw: string }> {
  const response = await app.request(path, init);
  const raw = await response.text();
  let body: JsonBody = {};
  try {
    body = JSON.parse(raw) as JsonBody;
  } catch {
    body = { raw };
  }
  return { status: response.status, body, raw };
}

function serviceHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set(CONTROL_PLANE_SERVICE_TOKEN_HEADER, SERVICE_TOKEN);
  return headers;
}

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

async function seedRegistryConnector(
  schema: string,
  id: string,
  domain: string,
  label: string,
): Promise<void> {
  await withSchemaClient(schema, async (query) => {
    await query(
      `INSERT INTO canonical_connectors
         (id, domain, label, archived, seeded, snapshot, created_at)
       VALUES (?, ?, ?, 0, 0, '{}'::jsonb, ?)`,
      [id, domain, label, new Date().toISOString()],
    );
  });
}

describe("control-plane Class C secrets (lp-hdzm.24)", () => {
  let store: ControlPlaneStore;
  let schema = "";
  let app: ReturnType<typeof createApp>;
  let tenantId = "";

  beforeEach(async () => {
    const created = await createTestStoreWithSchema();
    store = created.store;
    schema = created.schema;
    app = createApp(store, { serviceToken: SERVICE_TOKEN });
    const tenant = await store.createTenant({
      slug: "class-c-tenant",
      display_name: "Class C Tenant",
    });
    tenantId = tenant.tenant_id;
    await seedRegistryConnector(schema, "stripe", "stripe.com", "Stripe");
  });

  afterEach(async () => {
    await store.close();
  });

  it("lists absent surfaces for a registry connector", async () => {
    const res = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/connectors/stripe/class-c-secrets`,
      { headers: serviceHeaders() },
    );
    expect(res.status).toBe(200);
    expect(res.body.connector_id).toBe("stripe");
    const surfaces = res.body.surfaces as Array<{
      surface_id: string;
      present: boolean;
      fingerprint: string | null;
    }>;
    expect(surfaces.map((row) => row.surface_id)).toEqual(["mcp", "api", "cli"]);
    expect(surfaces.every((row) => row.present === false)).toBe(true);
    expect(res.raw).not.toContain(PLAIN);
  });

  it("stores KMS ciphertext keyed by tenant, connector, surface", async () => {
    const put = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/connectors/stripe/class-c-secrets/api`,
      {
        method: "PUT",
        headers: serviceHeaders({
          "content-type": "application/json",
          "x-lanyard-actor": "ops@example.com",
        }),
        body: JSON.stringify({ value: PLAIN, auth_kind: "bearer" }),
      },
    );
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({
      tenant_id: tenantId,
      connector_id: "stripe",
      surface_id: "api",
      present: true,
      fingerprint: fingerprintSecretValue(PLAIN),
    });
    expect(put.raw).not.toContain(PLAIN);

    const row = await withSchemaClient(schema, async (query) => {
      const result = await query(
        `SELECT secrets_ciphertext, fingerprint
         FROM tenant_connector_class_c_secrets
         WHERE tenant_id = ? AND connector_id = ? AND surface_id = ?`,
        [tenantId, "stripe", "api"],
      );
      return result.rows[0] as
        | { secrets_ciphertext: string; fingerprint: string }
        | undefined;
    });
    expect(row?.fingerprint).toBe(fingerprintSecretValue(PLAIN));
    expect(row?.secrets_ciphertext).toBeTruthy();
    expect(row?.secrets_ciphertext).not.toContain(PLAIN);
    expect(row?.secrets_ciphertext).toMatch(/encrypted_data_key|"ct"/);

    const audit = await store.listAuditEntries(tenantId);
    const entry = audit.find((e) => e.action === "tenant.class_c_secret_upserted");
    expect(entry?.actor).toBe("ops@example.com");
    expect(entry?.metadata).toEqual({
      connector_id: "stripe",
      surface_id: "api",
      auth_kind: "bearer",
    });
    expect(JSON.stringify(entry)).not.toContain(PLAIN);
  });

  it("attaches Authorization for the harness and leaves the guest fs empty", async () => {
    await store.upsertClassCSecret({
      tenant_id: tenantId,
      connector_id: "stripe" as ConnectorId,
      surface_id: "api",
      payload: { auth_kind: "bearer", value: PLAIN },
      actor: "ops@example.com",
    });

    const attachRes = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/connectors/stripe/class-c-secrets/api/attach`,
      { headers: serviceHeaders() },
    );
    expect(attachRes.status).toBe(200);
    expect(attachRes.body.headers).toEqual({
      Authorization: `Bearer ${PLAIN}`,
    });

    const attach = buildClassCHttpAttach({
      tenant_id: tenantId,
      connector_id: "stripe" as ConnectorId,
      surface_id: "api",
      payload: await store.getClassCSecretPayload(
        tenantId,
        "stripe" as ConnectorId,
        "api",
      ),
    });
    expect(attach.headers.Authorization).toBe(`Bearer ${PLAIN}`);

    const guest = createInMemoryGuestConnectorStore();
    const applied = await applyClassCHarnessHttp({
      attach,
      request: { url: "https://api.stripe.com/v1/account" },
      fetch: async (req) => {
        expect(req.headers?.Authorization).toBe(`Bearer ${PLAIN}`);
        return { status: 200, headers: {}, body: "{}" };
      },
      guest,
      sandbox_id: "sbx-stripe",
    });
    expect(applied.logged.headers?.Authorization).toBe("[REDACTED]");
    expect(JSON.stringify(applied.logged)).not.toContain(PLAIN);
    expect(guest.listFiles("sbx-stripe")).toEqual([]);
    expect(guest.printenv("sbx-stripe")).toEqual({});
    assertClassCNotOnGuestFs(guest, "sbx-stripe", attach);
    assertClassCNotInProviderWakeEnv(attach, {
      STRIPE_SECRET_KEY: PLAIN,
      OPENAI_API_KEY: "sk-openai",
    });
  });

  it("refuses first-class connectors and graphql surfaces", async () => {
    const google = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/connectors/google/class-c-secrets/api`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ value: PLAIN }),
      },
    );
    expect(google.status).toBe(400);
    expect(google.raw).toMatch(/Class A|first-class|google/i);
    expect(google.raw).not.toContain(PLAIN);

    const graphql = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/connectors/stripe/class-c-secrets/graphql`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ value: PLAIN }),
      },
    );
    expect(graphql.status).toBe(400);
    expect(graphql.raw).toMatch(/surface/i);
  });

  it("rotates and deletes a surface slot", async () => {
    await store.upsertClassCSecret({
      tenant_id: tenantId,
      connector_id: "stripe" as ConnectorId,
      surface_id: "mcp",
      payload: { auth_kind: "api_key", value: PLAIN },
    });
    const rotated = "sk_test_rotated_class_c";
    const put = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/connectors/stripe/class-c-secrets/mcp`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ value: rotated, auth_kind: "api_key" }),
      },
    );
    expect(put.status).toBe(200);
    expect(put.body.fingerprint).toBe(fingerprintSecretValue(rotated));
    expect(put.raw).not.toContain(rotated);
    expect(put.raw).not.toContain(PLAIN);

    const del = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/connectors/stripe/class-c-secrets/mcp`,
      { method: "DELETE", headers: serviceHeaders() },
    );
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ ok: true, deleted: true });

    const missing = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/connectors/stripe/class-c-secrets/mcp/attach`,
      { headers: serviceHeaders() },
    );
    expect(missing.status).toBe(404);
  });
});
