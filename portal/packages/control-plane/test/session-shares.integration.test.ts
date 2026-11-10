import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { ControlPlaneStore } from "../src/store.js";
import { createTestStore } from "./pg-test-store.js";

type JsonBody = Record<string, unknown>;

async function jsonRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: JsonBody }> {
  const response = await app.request(path, init);
  const body = (await response.json()) as JsonBody;
  return { status: response.status, body };
}

describe("control-plane session shares", () => {
  let store: ControlPlaneStore;
  let app: ReturnType<typeof createApp>;
  let tenantId = "";
  let otherTenantId = "";
  let ownerId = "";
  let inviteeId = "";

  beforeEach(async () => {
    store = await createTestStore();
    app = createApp(store, { devOpen: true });

    const tenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "share-org", display_name: "Share Org" }),
    });
    tenantId = tenant.body.tenant_id as string;

    const other = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: "foreign-org",
        display_name: "Foreign Org",
      }),
    });
    otherTenantId = other.body.tenant_id as string;

    const owner = await store.registerUser({
      tenant_id: tenantId,
      email: "owner@example.com",
      password: "password123",
    });
    ownerId = owner.user_id;

    const invitee = await store.registerUser({
      tenant_id: tenantId,
      email: "invitee@example.com",
      password: "password123",
    });
    inviteeId = invitee.user_id;

    await store.registerUser({
      tenant_id: otherTenantId,
      email: "foreign@other.test",
      password: "password123",
    });
  });

  afterEach(async () => {
    await store.close();
  });

  it("creates, lists, and revokes share grants", async () => {
    const threadId = crypto.randomUUID();

    const created = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/users/${ownerId}/session-shares`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          thread_id: threadId,
          grantee_email: "invitee@example.com",
          mode: "read",
        }),
      },
    );
    expect(created.status).toBe(201);
    expect(created.body.grantee_user_id).toBe(inviteeId);

    const granteeList = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/users/${inviteeId}/session-shares`,
    );
    expect(granteeList.status).toBe(200);
    expect(granteeList.body.grants).toHaveLength(1);

    const active = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/users/${inviteeId}/threads/${threadId}/session-shares/active`,
    );
    expect(active.status).toBe(200);
    expect(active.body.grant).toBeTruthy();

    const revoked = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/users/${ownerId}/threads/${threadId}/session-shares/${inviteeId}`,
      { method: "DELETE" },
    );
    expect(revoked.status).toBe(200);
    expect(revoked.body.revoked_at).toBeTruthy();

    const afterRevoke = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/users/${inviteeId}/threads/${threadId}/session-shares/active`,
    );
    expect(afterRevoke.status).toBe(200);
    expect(afterRevoke.body.grant).toBeNull();
  });

  it("rejects share create for unknown grantee email with 404", async () => {
    const created = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/users/${ownerId}/session-shares`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          thread_id: crypto.randomUUID(),
          grantee_email: "nobody@not-a-tenant.example",
          mode: "read",
        }),
      },
    );
    expect(created.status).toBe(404);
    expect(String(created.body.error)).toMatch(/Grantee user not found/i);
  });

  it("rejects share create when grantee email exists only on another tenant", async () => {
    const created = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/users/${ownerId}/session-shares`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          thread_id: crypto.randomUUID(),
          grantee_email: "foreign@other.test",
          mode: "read",
        }),
      },
    );
    expect(created.status).toBe(404);
    expect(String(created.body.error)).toMatch(/Grantee user not found/i);
  });
});