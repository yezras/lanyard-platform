import { afterEach, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";

import { createApp } from "../src/app.js";
import {
  assertPublicConnectorJson,
  CONNECTOR_PUBLIC_FORBIDDEN_KEYS,
} from "../src/connectors.js";
import { CONTROL_PLANE_SERVICE_TOKEN_HEADER } from "../src/service-auth.js";
import { ControlPlaneStore } from "../src/store.js";
import { resolveDatabaseUrl, toPgPlaceholders } from "../src/db.js";
import { createTestStoreWithSchema } from "./pg-test-store.js";

type JsonBody = Record<string, unknown>;

const SERVICE_TOKEN = "test-cp-service-token";
const PLAIN_REFRESH = "google-refresh-token-plain";
const PLAIN_ACCESS = "google-access-token-plain";
const SESSION_B64 = Buffer.from("whatsmeow-session-db").toString("base64");

async function jsonRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: JsonBody; raw: string }> {
  const response = await app.request(path, init);
  const raw = await response.text();
  const body = JSON.parse(raw) as JsonBody;
  return { status: response.status, body, raw };
}

function serviceHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set(CONTROL_PLANE_SERVICE_TOKEN_HEADER, SERVICE_TOKEN);
  return headers;
}

describe("control-plane connectors (lp-xhf4.2)", () => {
  let store: ControlPlaneStore;
  let schema = "";
  let app: ReturnType<typeof createApp>;
  let tenantA = "";
  let tenantB = "";
  let userA = "";
  let userB = "";
  let roleA = "";

  beforeEach(async () => {
    const created = await createTestStoreWithSchema();
    store = created.store;
    schema = created.schema;
    app = createApp(store, {
      serviceToken: SERVICE_TOKEN,
      connectorOauth: {
        revokeOauth: async () => undefined,
        refreshOauth: async () => {
          throw new Error("invalid_grant");
        },
      },
    });

    const a = await store.createTenant({
      slug: "conn-alpha",
      display_name: "Conn Alpha",
    });
    const b = await store.createTenant({
      slug: "conn-beta",
      display_name: "Conn Beta",
    });
    tenantA = a.tenant_id;
    tenantB = b.tenant_id;

    const ua = await store.registerUser({
      tenant_id: tenantA,
      email: "alice@alpha.test",
      password: "password123",
    });
    const ub = await store.registerUser({
      tenant_id: tenantB,
      email: "bob@beta.test",
      password: "password123",
    });
    userA = ua.user_id;
    userB = ub.user_id;

    const role = await store.createRole({
      tenant_id: tenantA,
      name: "contributor",
      hermes_profile: "contributor",
      path_prefixes: ["/"],
    });
    roleA = role.role_id;
    await store.setUserRoles({
      tenant_id: tenantA,
      user_id: userA,
      role_ids: [roleA],
    });
  });

  afterEach(async () => {
    await store.close();
  });

  it("rejects anonymous callers without the service token", async () => {
    const res = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/connector-entitlements`,
    );
    expect(res.status).toBe(401);
  });

  it("upserts entitlements and role grants used by BFF", async () => {
    const entitled = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/connector-entitlements/hubspot`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          enabled: true,
          hubspot_portal_id: "123456",
        }),
      },
    );
    expect(entitled.status).toBe(200);
    expect(entitled.body).toMatchObject({
      tenant_id: tenantA,
      connector_id: "hubspot",
      enabled: true,
      hubspot_portal_id: "123456",
    });
    assertPublicConnectorJson(entitled.body);

    const pinOnGoogle = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/connector-entitlements/google`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          enabled: true,
          hubspot_portal_id: "nope",
        }),
      },
    );
    expect(pinOnGoogle.status).toBe(400);

    const grant = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/roles/${roleA}/connector-grants/google`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ enabled: true }),
      },
    );
    expect(grant.status).toBe(200);
    expect(grant.body).toMatchObject({
      role_id: roleA,
      connector_id: "google",
      enabled: true,
    });

    const listed = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/roles/${roleA}/connector-grants`,
      { headers: serviceHeaders() },
    );
    expect(listed.status).toBe(200);
    expect(listed.body.grants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ connector_id: "google", enabled: true }),
      ]),
    );
  });

  it("round-trips secrets and never returns ciphertext or plaintext on public JSON", async () => {
    const created = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/users/${userA}/connectors/google`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          status: "connected",
          account_label: "alice@alpha.test",
          sticky: { "gmail.read": true, "gmail.draft": true },
          secrets: {
            oauth_access: PLAIN_ACCESS,
            oauth_refresh: PLAIN_REFRESH,
            oauth_expiry: "2026-08-21T00:00:00.000Z",
            oauth_scopes: ["gmail.readonly"],
          },
        }),
      },
    );
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      tenant_id: tenantA,
      user_id: userA,
      connector_id: "google",
      status: "connected",
      account_label: "alice@alpha.test",
      sticky: { "gmail.read": true, "gmail.draft": true },
    });
    assertPublicConnectorJson(created.body);
    for (const key of CONNECTOR_PUBLIC_FORBIDDEN_KEYS) {
      expect(created.body).not.toHaveProperty(key);
    }
    expect(created.raw).not.toContain(PLAIN_ACCESS);
    expect(created.raw).not.toContain(PLAIN_REFRESH);
    expect(created.raw).not.toContain("secrets_ciphertext");

    const listed = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/users/${userA}/connectors`,
      { headers: serviceHeaders() },
    );
    expect(listed.status).toBe(200);
    assertPublicConnectorJson(listed.body);
    expect(listed.raw).not.toContain(PLAIN_ACCESS);
    expect(listed.raw).not.toContain(PLAIN_REFRESH);

    const secrets = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/users/${userA}/connectors/google/secrets`,
      { headers: serviceHeaders() },
    );
    expect(secrets.status).toBe(200);
    expect(secrets.body.secrets).toMatchObject({
      oauth_access: PLAIN_ACCESS,
      oauth_refresh: PLAIN_REFRESH,
      oauth_expiry: "2026-08-21T00:00:00.000Z",
      oauth_scopes: ["gmail.readonly"],
    });

    const pool = new pg.Pool({
      connectionString: resolveDatabaseUrl(),
      options: `-c search_path=${schema},public`,
    });
    try {
      const row = await pool.query(
        toPgPlaceholders(
          `SELECT secrets_ciphertext FROM connector_connections
           WHERE tenant_id = ? AND user_id = ? AND connector_id = ?`,
        ),
        [tenantA, userA, "google"],
      );
      const envelope = row.rows[0]?.secrets_ciphertext as string;
      expect(envelope).toBeTruthy();
      expect(envelope).not.toContain(PLAIN_ACCESS);
      expect(envelope).not.toContain(PLAIN_REFRESH);
      expect(JSON.parse(envelope).alg).toBe("aes-256-gcm");
    } finally {
      await pool.end();
    }
  });

  it("enforces unique (tenant_id, user_id, connector_id) via upsert", async () => {
    const first = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/users/${userA}/connectors/whatsapp`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          status: "pairing",
          account_label: null,
        }),
      },
    );
    const second = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/users/${userA}/connectors/whatsapp`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          status: "connected",
          account_label: "+15551212",
          secrets: { whatsapp_session_db: SESSION_B64 },
        }),
      },
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe("connected");
    expect(second.body.account_label).toBe("+15551212");

    const listed = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/users/${userA}/connectors`,
      { headers: serviceHeaders() },
    );
    const connections = listed.body.connections as JsonBody[];
    expect(connections.filter((c) => c.connector_id === "whatsapp")).toHaveLength(
      1,
    );
    expect(listed.raw).not.toContain(SESSION_B64);

    const secrets = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/users/${userA}/connectors/whatsapp/secrets`,
      { headers: serviceHeaders() },
    );
    expect((secrets.body.secrets as JsonBody).whatsapp_session_db).toBe(
      SESSION_B64,
    );
  });

  it("isolates connection rows across tenants", async () => {
    await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/users/${userA}/connectors/google`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          status: "connected",
          account_label: "alice@alpha.test",
          secrets: { oauth_refresh: PLAIN_REFRESH },
        }),
      },
    );

    const foreignList = await jsonRequest(
      app,
      `/internal/tenants/${tenantB}/users/${userA}/connectors`,
      { headers: serviceHeaders() },
    );
    expect(foreignList.status).toBe(404);

    const crossHeader = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/users/${userA}/connectors`,
      {
        headers: serviceHeaders({ "x-lanyard-tenant-id": tenantB }),
      },
    );
    expect(crossHeader.status).toBe(403);

    const otherUser = await jsonRequest(
      app,
      `/internal/tenants/${tenantB}/users/${userB}/connectors`,
      { headers: serviceHeaders() },
    );
    expect(otherUser.status).toBe(200);
    expect(otherUser.body.connections).toEqual([]);
    expect(otherUser.raw).not.toContain(PLAIN_REFRESH);

    const access = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/users/${userA}/connectors/google/access`,
      { headers: serviceHeaders() },
    );
    expect(access.status).toBe(200);
    expect(access.body.entitled).toBe(false);
    expect(access.body.role_granted).toBe(false);
    expect((access.body.connection as JsonBody).connector_id).toBe("google");
    assertPublicConnectorJson(access.body);
  });

  it("rejects unknown connector ids, every_call sticky, and plaintext in fixtures", async () => {
    const unknown = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/users/${userA}/connectors/outlook`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ status: "connected" }),
      },
    );
    expect(unknown.status).toBe(400);

    const stickySend = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/users/${userA}/connectors/google`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          status: "connected",
          sticky: { "gmail.send": true },
        }),
      },
    );
    expect(stickySend.status).toBe(400);

    const fixture = {
      tenant_id: tenantA,
      user_id: userA,
      connector_id: "google",
      status: "connected",
      account_label: "alice@alpha.test",
      hubspot_portal_id: null,
      sticky: { "gmail.read": true },
    };
    assertPublicConnectorJson(fixture);
    expect(() =>
      assertPublicConnectorJson({ ...fixture, oauth_refresh: PLAIN_REFRESH }),
    ).toThrow(/oauth_refresh/);
  });

  it("hard-deletes connection rows and ciphertext on disconnect", async () => {
    await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/users/${userA}/connectors/google`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          status: "connected",
          secrets: { oauth_refresh: PLAIN_REFRESH },
        }),
      },
    );
    const deleted = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/users/${userA}/connectors/google`,
      { method: "DELETE", headers: serviceHeaders() },
    );
    expect(deleted.status).toBe(200);
    const missing = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/users/${userA}/connectors/google`,
      { headers: serviceHeaders() },
    );
    expect(missing.status).toBe(404);
  });

  it("grant off google does not delete connections (role grants are not ACL)", async () => {
    const revokes: string[] = [];
    app = createApp(store, {
      serviceToken: SERVICE_TOKEN,
      connectorOauth: {
        revokeOauth: async (input) => {
          revokes.push(input.connector_id);
        },
        refreshOauth: async () => {
          throw new Error("not used");
        },
      },
    });
    await store.upsertUserConnectorConnection({
      tenant_id: tenantA,
      user_id: userA,
      connector_id: "google",
      status: "connected",
      secrets: { oauth_refresh: PLAIN_REFRESH, oauth_access: PLAIN_ACCESS },
    });

    const off = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/roles/${roleA}/connector-grants/google`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ enabled: false }),
      },
    );
    expect(off.status).toBe(200);
    expect(off.body.enabled).toBe(false);

    const kept = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/users/${userA}/connectors/google`,
      { headers: serviceHeaders() },
    );
    expect(kept.status).toBe(200);
    expect(kept.body.status).toBe("connected");
    expect(revokes).toEqual([]);
  });

  it("refresh fail keeps the row at needs_reauth and does not delete secrets", async () => {
    app = createApp(store, {
      serviceToken: SERVICE_TOKEN,
      connectorOauth: {
        revokeOauth: async () => undefined,
        refreshOauth: async () => {
          throw new Error("invalid_grant");
        },
      },
    });
    await store.upsertUserConnectorConnection({
      tenant_id: tenantA,
      user_id: userA,
      connector_id: "google",
      status: "connected",
      account_label: "alice@gmail.com",
      secrets: { oauth_refresh: PLAIN_REFRESH, oauth_access: PLAIN_ACCESS },
    });
    const refreshed = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/users/${userA}/connectors/google/refresh`,
      { method: "POST", headers: serviceHeaders() },
    );
    expect(refreshed.status).toBe(200);
    expect(refreshed.body).toMatchObject({
      connector_id: "google",
      status: "needs_reauth",
      wizard: true,
      account_label: "alice@gmail.com",
    });
    assertPublicConnectorJson(refreshed.body);
    expect(refreshed.raw).not.toContain(PLAIN_REFRESH);

    const row = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/users/${userA}/connectors/google`,
      { headers: serviceHeaders() },
    );
    expect(row.status).toBe(200);
    expect(row.body.status).toBe("needs_reauth");
    const secrets = await store.getUserConnectorSecrets(
      tenantA,
      userA,
      "google",
    );
    expect(secrets.oauth_refresh).toBe(PLAIN_REFRESH);
  });

  it("tenant entitlement off deletes matching connector rows", async () => {
    await store.upsertUserConnectorConnection({
      tenant_id: tenantA,
      user_id: userA,
      connector_id: "google",
      status: "connected",
      secrets: { oauth_refresh: PLAIN_REFRESH },
    });
    const off = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/connector-entitlements/google`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ enabled: false }),
      },
    );
    expect(off.status).toBe(200);
    const missing = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/users/${userA}/connectors/google`,
      { headers: serviceHeaders() },
    );
    expect(missing.status).toBe(404);
  });

  it("user removed deletes all their connection rows", async () => {
    await store.upsertUserConnectorConnection({
      tenant_id: tenantA,
      user_id: userA,
      connector_id: "google",
      status: "connected",
      secrets: { oauth_refresh: PLAIN_REFRESH },
    });
    await store.upsertUserConnectorConnection({
      tenant_id: tenantA,
      user_id: userA,
      connector_id: "whatsapp",
      status: "connected",
      secrets: { whatsapp_session_db: SESSION_B64 },
    });
    const removed = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/users/${userA}/connectors`,
      { method: "DELETE", headers: serviceHeaders() },
    );
    expect(removed.status).toBe(200);
    expect((removed.body.deleted as string[]).sort()).toEqual([
      "google",
      "whatsapp",
    ]);
    const google = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/users/${userA}/connectors/google`,
      { headers: serviceHeaders() },
    );
    expect(google.status).toBe(404);
    const wa = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/users/${userA}/connectors/whatsapp`,
      { headers: serviceHeaders() },
    );
    expect(wa.status).toBe(404);
  });

  it("denormalizes hubspot pin onto public connection rows", async () => {
    await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/connector-entitlements/hubspot`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ enabled: true, hubspot_portal_id: "999" }),
      },
    );
    const row = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/users/${userA}/connectors/hubspot`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          status: "connected",
          account_label: "alice@hubspot",
        }),
      },
    );
    expect(row.body.hubspot_portal_id).toBe("999");
    assertPublicConnectorJson(row.body);
  });

  it("lists a cross-tenant catalog with entitlement and status counts", async () => {
    await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/connector-entitlements/google`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ enabled: true }),
      },
    );
    await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/users/${userA}/connectors/google`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          status: "connected",
          account_label: "alice@gmail.com",
          secrets: { oauth_refresh: PLAIN_REFRESH },
        }),
      },
    );
    await jsonRequest(
      app,
      `/internal/tenants/${tenantB}/users/${userB}/connectors/whatsapp`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ status: "pairing" }),
      },
    );

    const catalog = await jsonRequest(app, "/internal/connector-catalog", {
      headers: serviceHeaders(),
    });
    expect(catalog.status).toBe(200);
    assertPublicConnectorJson(catalog.body);
    expect(catalog.raw).not.toContain(PLAIN_REFRESH);
    const tenants = catalog.body.tenants as Array<{
      tenant_id: string;
      tenant_slug: string;
      connectors: Array<{
        connector_id: string;
        enabled: boolean;
        status_counts: {
          connected: number;
          pairing: number;
          needs_reauth: number;
        };
      }>;
    }>;
    const alpha = tenants.find((row) => row.tenant_id === tenantA);
    const beta = tenants.find((row) => row.tenant_id === tenantB);
    expect(alpha?.connectors.find((c) => c.connector_id === "google")).toEqual({
      connector_id: "google",
      enabled: true,
      status_counts: { connected: 1, pairing: 0, needs_reauth: 0 },
    });
    expect(beta?.connectors.find((c) => c.connector_id === "whatsapp")).toEqual({
      connector_id: "whatsapp",
      enabled: false,
      status_counts: { connected: 0, pairing: 1, needs_reauth: 0 },
    });
    expect(catalog.body.totals).toMatchObject({
      google: { connected: 1, entitled_tenants: 1 },
      whatsapp: { pairing: 1, entitled_tenants: 0 },
    });
  });

  it("deletes leftover connection secrets when entitlement is turned off", async () => {
    await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/connector-entitlements/google`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ enabled: true }),
      },
    );
    await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/users/${userA}/connectors/google`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          status: "connected",
          secrets: { oauth_refresh: PLAIN_REFRESH, oauth_access: PLAIN_ACCESS },
        }),
      },
    );

    const off = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/connector-entitlements/google`,
      {
        method: "PUT",
        headers: serviceHeaders({
          "content-type": "application/json",
          "x-lanyard-actor": "ops@lanyard.example",
        }),
        body: JSON.stringify({ enabled: false }),
      },
    );
    expect(off.status).toBe(200);
    expect(off.body.enabled).toBe(false);

    const missing = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/users/${userA}/connectors/google`,
      { headers: serviceHeaders() },
    );
    expect(missing.status).toBe(404);

    const secrets = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/users/${userA}/connectors/google/secrets`,
      { headers: serviceHeaders() },
    );
    expect(secrets.status).toBe(404);

    const audits = await store.listAuditEntries(tenantA);
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "connector.disconnected",
          actor: "ops@lanyard.example",
        }),
      ]),
    );
    const disconnected = audits.find(
      (entry) => entry.action === "connector.disconnected",
    );
    expect(disconnected?.metadata).toMatchObject({
      user_id: userA,
      connector_id: "google",
      reason: "tenant_entitlement_off",
    });
  });
});

describe("connector schema boundary", () => {
  let store: ControlPlaneStore;
  let schema: string;
  let tenantA = "";
  let tenantB = "";
  let userA = "";
  let userB = "";

  beforeEach(async () => {
    const created = await createTestStoreWithSchema();
    store = created.store;
    schema = created.schema;
    const a = await store.createTenant({
      slug: "c-schema-a",
      display_name: "A",
    });
    const b = await store.createTenant({
      slug: "c-schema-b",
      display_name: "B",
    });
    tenantA = a.tenant_id;
    tenantB = b.tenant_id;
    userA = (
      await store.registerUser({
        tenant_id: tenantA,
        email: "a@t.test",
        password: "password123",
      })
    ).user_id;
    userB = (
      await store.registerUser({
        tenant_id: tenantB,
        email: "b@t.test",
        password: "password123",
      })
    ).user_id;
  });

  afterEach(async () => {
    await store.close();
  });

  it("rejects cross-tenant connection inserts at the DB trigger", async () => {
    const pool = new pg.Pool({
      connectionString: resolveDatabaseUrl(),
      options: `-c search_path=${schema},public`,
    });
    try {
      await expect(
        pool.query(
          toPgPlaceholders(
            `INSERT INTO connector_connections
             (connection_id, tenant_id, user_id, connector_id, status, sticky_json, created_at, updated_at)
             VALUES (?, ?, ?, 'google', 'connected', '{}', ?, ?)`,
          ),
          [
            crypto.randomUUID(),
            tenantA,
            userB,
            new Date().toISOString(),
            new Date().toISOString(),
          ],
        ),
      ).rejects.toThrow(/cross-tenant connection denied/i);

      const cols = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'connector_connections'
         ORDER BY column_name`,
      );
      const names = cols.rows.map((r: { column_name: string }) => r.column_name);
      expect(names).toContain("secrets_ciphertext");
      expect(names).not.toContain("oauth_access");
      expect(names).not.toContain("oauth_refresh");
      expect(names).not.toContain("access_token");
      expect(names).not.toContain("refresh_token");
      expect(names).not.toContain("whatsapp_session_db");

      const now = new Date().toISOString();
      await pool.query(
        toPgPlaceholders(
          `INSERT INTO connector_connections
           (connection_id, tenant_id, user_id, connector_id, status, sticky_json, created_at, updated_at)
           VALUES (?, ?, ?, 'google', 'connected', '{}', ?, ?)`,
        ),
        [crypto.randomUUID(), tenantA, userA, now, now],
      );
      await expect(
        pool.query(
          toPgPlaceholders(
            `INSERT INTO connector_connections
             (connection_id, tenant_id, user_id, connector_id, status, sticky_json, created_at, updated_at)
             VALUES (?, ?, ?, 'google', 'pairing', '{}', ?, ?)`,
          ),
          [crypto.randomUUID(), tenantA, userA, now, now],
        ),
      ).rejects.toMatchObject({ code: "23505" });
    } finally {
      await pool.end();
    }
  });

  it("lists granted registry connectors and hides ungranted ones", async () => {
    await store.insertCanonicalConnector({
      id: "slack",
      domain: "slack.com",
      label: "Slack",
      source: "integrations.sh",
      source_entry_id: "integrations.sh:slack.com",
      snapshot: {
        version: 1,
        source: "integrations.sh",
        domain: "slack.com",
        compiled_at: "2026-08-26T00:00:00.000Z",
        runnability: "runnable",
        surfaces: [
          {
            kind: "mcp",
            slug: "mcp",
            label: "MCP",
            runnability: "runnable",
            initialize_url: "https://mcp.slack.com",
            transport: "streamable-http",
            auth_kind: "oauth",
          },
        ],
      },
    });
    await store.insertCanonicalConnector({
      id: "stripe",
      domain: "stripe.com",
      label: "Stripe",
      source: "integrations.sh",
      source_entry_id: "integrations.sh:stripe.com",
      snapshot: {
        version: 1,
        source: "integrations.sh",
        domain: "stripe.com",
        compiled_at: "2026-08-26T00:00:00.000Z",
        runnability: "runnable",
        surfaces: [
          {
            kind: "mcp",
            slug: "mcp",
            label: "MCP",
            runnability: "runnable",
            initialize_url: "https://mcp.stripe.com",
            transport: "streamable-http",
            auth_kind: "bearer",
          },
        ],
      },
    });
    const slackId = await store.parseConnectorId("slack");
    const stripeId = await store.parseConnectorId("stripe");
    await store.upsertTenantConnectorEntitlement({
      tenant_id: tenantA,
      connector_id: slackId,
      enabled: true,
      surfaces: ["mcp"],
    });
    await store.upsertTenantConnectorEntitlement({
      tenant_id: tenantA,
      connector_id: stripeId,
      enabled: true,
      surfaces: ["mcp"],
    });
    await store.upsertTenantConnectorEntitlement({
      tenant_id: tenantA,
      connector_id: "google",
      enabled: true,
    });
    await store.setPersonConnectorGrant({
      tenant_id: tenantA,
      user_id: userA,
      connector_id: "slack",
      granted: true,
    });
    await store.setPersonConnectorGrant({
      tenant_id: tenantA,
      user_id: userA,
      connector_id: "google",
      granted: true,
    });

    const listed = await store.listUserGrantedConnectors(tenantA, userA);
    expect(listed.map((row) => row.connector_id)).toEqual(["google", "slack"]);

    const app = createApp(store, { serviceToken: SERVICE_TOKEN });
    const res = await jsonRequest(
      app,
      `/internal/tenants/${tenantA}/users/${userA}/granted-connectors`,
      { headers: serviceHeaders() },
    );
    expect(res.status).toBe(200);
    assertPublicConnectorJson(res.body);
    const connectors = res.body.connectors as Array<Record<string, unknown>>;
    expect(connectors.map((row) => row.connector_id)).toEqual([
      "google",
      "slack",
    ]);
    expect(connectors.find((row) => row.connector_id === "slack")).toMatchObject({
      connector_id: "slack",
      label: "Slack",
      entitled: true,
      role_granted: true,
      connection: null,
    });
    expect(connectors.some((row) => row.connector_id === "stripe")).toBe(false);
  });
});
