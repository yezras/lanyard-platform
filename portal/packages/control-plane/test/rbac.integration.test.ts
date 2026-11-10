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

describe("control-plane RBAC", () => {
  let store: ControlPlaneStore;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    store = await createTestStore();
    app = createApp(store, { devOpen: true });
  });

  afterEach(async () => {
    await store.close();
  });

  it("creates roles with path prefixes and resolves user RBAC", async () => {
    const tenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "rbac", display_name: "RBAC Tenant" }),
    });
    const tenantId = tenant.body.tenant_id as string;

    const user = await store.registerUser({
      tenant_id: tenantId,
      email: "alice@example.com",
      password: "password123",
    });

    const role = await jsonRequest(app, `/tenants/${tenantId}/roles`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "team-a",
        hermes_profile: "team-a-profile",
        path_prefixes: ["/Projects/A"],
      }),
    });
    expect(role.status).toBe(201);

    const roleId = role.body.role_id as string;
    const assigned = await jsonRequest(
      app,
      `/tenants/${tenantId}/users/${user.user_id}/roles`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role_ids: [roleId] }),
      },
    );
    expect(assigned.status).toBe(200);
    expect(assigned.body.hermes_profile).toBe("team-a-profile");
    expect(assigned.body.allowed_path_prefixes).toEqual(["/Projects/A"]);

    const internal = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/users/${user.user_id}/rbac`,
    );
    expect(internal.status).toBe(200);
    expect((internal.body.rbac as JsonBody).hermes_profile).toBe(
      "team-a-profile",
    );
  });
});