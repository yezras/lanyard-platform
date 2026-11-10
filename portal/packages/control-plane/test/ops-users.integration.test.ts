import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { CONTROL_PLANE_SERVICE_TOKEN_HEADER } from "../src/service-auth.js";
import { ControlPlaneStore } from "../src/store.js";
import { createTestStore } from "./pg-test-store.js";

type JsonBody = Record<string, unknown>;

const SERVICE_TOKEN = "test-cp-service-token";

async function jsonRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: JsonBody }> {
  const response = await app.request(path, init);
  const raw = await response.text();
  const body = JSON.parse(raw || "{}") as JsonBody;
  return { status: response.status, body };
}

function serviceHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set(CONTROL_PLANE_SERVICE_TOKEN_HEADER, SERVICE_TOKEN);
  return headers;
}

describe("ops users and person grants (lp-hdzm.6)", () => {
  let store: ControlPlaneStore;
  let app: ReturnType<typeof createApp>;
  let tenantId = "";

  beforeEach(async () => {
    store = await createTestStore();
    app = createApp(store, { serviceToken: SERVICE_TOKEN });
    const tenant = await store.createTenant({
      slug: "ops-users",
      display_name: "Ops Users",
    });
    tenantId = tenant.tenant_id;
  });

  afterEach(async () => {
    await store.close();
  });

  it("provisions Admin|Member, rejects invited and duplicate email", async () => {
    const created = await jsonRequest(app, `/tenants/${tenantId}/users`, {
      method: "POST",
      headers: serviceHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        display_name: "Ada Admin",
        email: "ada@ops.test",
        role: "tenant_admin",
      }),
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      display_name: "Ada Admin",
      email: "ada@ops.test",
      role: "tenant_admin",
      connectors: [],
      last_active_at: null,
    });
    expect(created.body.role).not.toBe("invited");

    const invited = await jsonRequest(app, `/tenants/${tenantId}/users`, {
      method: "POST",
      headers: serviceHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        display_name: "Invitee",
        email: "invitee@ops.test",
        role: "invited",
      }),
    });
    expect(invited.status).toBe(400);

    const dup = await jsonRequest(app, `/tenants/${tenantId}/users`, {
      method: "POST",
      headers: serviceHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        display_name: "Ada Two",
        email: "ADA@ops.test",
        role: "member",
      }),
    });
    expect(dup.status).toBe(409);

    const listed = await jsonRequest(app, `/tenants/${tenantId}/users`, {
      headers: serviceHeaders(),
    });
    expect(listed.status).toBe(200);
    expect(listed.body.users).toEqual([
      expect.objectContaining({
        email: "ada@ops.test",
        role: "tenant_admin",
      }),
    ]);
    expect(JSON.stringify(listed.body)).not.toContain("invited");
  });

  it("409s removing or demoting the last tenant admin", async () => {
    const admin = await store.provisionOpsTenantUser({
      tenant_id: tenantId,
      display_name: "Only Admin",
      email: "only@ops.test",
      role: "tenant_admin",
    });
    const member = await store.provisionOpsTenantUser({
      tenant_id: tenantId,
      display_name: "Pat Member",
      email: "pat@ops.test",
      role: "member",
    });

    const demote = await jsonRequest(
      app,
      `/tenants/${tenantId}/users/${admin.user_id}`,
      {
        method: "PATCH",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ role: "member" }),
      },
    );
    expect(demote.status).toBe(409);
    expect(String(demote.body.error)).toMatch(/last tenant admin/i);

    const remove = await jsonRequest(
      app,
      `/tenants/${tenantId}/users/${admin.user_id}`,
      {
        method: "DELETE",
        headers: serviceHeaders(),
      },
    );
    expect(remove.status).toBe(409);

    const removeMember = await jsonRequest(
      app,
      `/tenants/${tenantId}/users/${member.user_id}`,
      {
        method: "DELETE",
        headers: serviceHeaders(),
      },
    );
    expect(removeMember.status).toBe(200);
  });

  it("stores person grants as row presence, not role_connector_grants", async () => {
    const user = await store.provisionOpsTenantUser({
      tenant_id: tenantId,
      display_name: "Grant User",
      email: "grant@ops.test",
      role: "member",
    });

    const on = await jsonRequest(
      app,
      `/tenants/${tenantId}/connectors/google/users/${user.user_id}`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ granted: true }),
      },
    );
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({
      tenant_id: tenantId,
      user_id: user.user_id,
      connector_id: "google",
      granted: true,
    });

    const listed = await jsonRequest(
      app,
      `/tenants/${tenantId}/connectors/google/users`,
      { headers: serviceHeaders() },
    );
    expect(listed.status).toBe(200);
    expect(listed.body.users).toEqual([
      expect.objectContaining({
        user_id: user.user_id,
        role_label: "Member",
        granted: true,
      }),
    ]);

    const users = await jsonRequest(app, `/tenants/${tenantId}/users`, {
      headers: serviceHeaders(),
    });
    expect(users.body.users).toEqual([
      expect.objectContaining({
        user_id: user.user_id,
        connectors: ["google"],
      }),
    ]);

    const roleGrants = await store.listRoleConnectorGrants(
      tenantId,
      (
        await store.createRole({
          tenant_id: tenantId,
          name: "unused",
          hermes_profile: "default",
          path_prefixes: ["/"],
        })
      ).role_id,
    );
    expect(roleGrants).toEqual([]);

    const off = await jsonRequest(
      app,
      `/tenants/${tenantId}/connectors/google/users/${user.user_id}`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ granted: false }),
      },
    );
    expect(off.status).toBe(200);
    expect(off.body.granted).toBe(false);

    const after = await jsonRequest(
      app,
      `/tenants/${tenantId}/connectors/google/users`,
      { headers: serviceHeaders() },
    );
    expect(after.body.users).toEqual([
      expect.objectContaining({ user_id: user.user_id, granted: false }),
    ]);
  });

  it("keeps connector-user and tenant-user grant views on one table", async () => {
    const user = await store.provisionOpsTenantUser({
      tenant_id: tenantId,
      display_name: "Sync User",
      email: "sync@ops.test",
      role: "member",
    });

    const on = await jsonRequest(
      app,
      `/tenants/${tenantId}/connectors/hubspot/users/${user.user_id}`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ granted: true }),
      },
    );
    expect(on.status).toBe(200);

    const connectorView = await jsonRequest(
      app,
      `/tenants/${tenantId}/connectors/hubspot/users`,
      { headers: serviceHeaders() },
    );
    const userView = await jsonRequest(app, `/tenants/${tenantId}/users`, {
      headers: serviceHeaders(),
    });
    expect(connectorView.body.users).toEqual([
      expect.objectContaining({ user_id: user.user_id, granted: true }),
    ]);
    expect(userView.body.users).toEqual([
      expect.objectContaining({
        user_id: user.user_id,
        connectors: ["hubspot"],
      }),
    ]);
  });

  it("refuses member subset writes on first-class connectors", async () => {
    const get = await jsonRequest(
      app,
      `/tenants/${tenantId}/connectors/google/member-subset`,
      { headers: serviceHeaders() },
    );
    expect(get.status).toBe(200);
    expect(get.body).toMatchObject({
      connector_id: "google",
      kind: "grant_only",
      tools: [],
      allowed_tools: [],
    });

    const put = await jsonRequest(
      app,
      `/tenants/${tenantId}/connectors/google/member-subset`,
      {
        method: "PUT",
        headers: serviceHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ allowed_tools: ["gws"] }),
      },
    );
    expect(put.status).toBe(400);
    expect(String(put.body.error)).toMatch(/grant on\/off only/i);
  });
});
