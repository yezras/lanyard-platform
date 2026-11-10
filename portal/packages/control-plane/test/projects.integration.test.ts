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

describe("control-plane projects", () => {
  let store: ControlPlaneStore;
  let app: ReturnType<typeof createApp>;
  let tenantId: string;
  let userId: string;
  let roleId: string;

  beforeEach(async () => {
    store = await createTestStore();
    app = createApp(store, { devOpen: true });

    const tenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "projects", display_name: "Projects" }),
    });
    tenantId = tenant.body.tenant_id as string;

    const user = await store.registerUser({
      tenant_id: tenantId,
      email: "pm@example.com",
      password: "password123",
    });
    userId = user.user_id;

    const role = await store.createRole({
      tenant_id: tenantId,
      name: "team-a",
      hermes_profile: "team-a",
      path_prefixes: ["/Projects/A"],
    });
    roleId = role.role_id;
    await store.setUserRoles({
      tenant_id: tenantId,
      user_id: userId,
      role_ids: [roleId],
    });
  });

  afterEach(async () => {
    await store.close();
  });

  it("creates project and subproject with ACL-validated vault paths", async () => {
    const project = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/users/${userId}/projects`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Alpha",
          vault_path: "/Projects/A",
        }),
      },
    );
    expect(project.status).toBe(201);
    expect(project.body.vault_path).toBe("/Projects/A");

    const subproject = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/users/${userId}/projects`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Alpha Sprint",
          vault_path: "/Projects/A/sprint-1",
          parent_project_id: project.body.project_id,
        }),
      },
    );
    expect(subproject.status).toBe(201);
    expect(subproject.body.parent_project_id).toBe(project.body.project_id);

    const denied = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/users/${userId}/projects`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Forbidden",
          vault_path: "/Projects/B",
        }),
      },
    );
    expect(denied.status).toBe(403);
  });

  it("lists, updates, and deletes projects visible to user ACL", async () => {
    const created = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/users/${userId}/projects`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Alpha",
          vault_path: "/Projects/A",
        }),
      },
    );
    const projectId = created.body.project_id as string;

    const listed = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/users/${userId}/projects`,
    );
    expect(listed.status).toBe(200);
    expect((listed.body.projects as JsonBody[]).length).toBe(1);

    const updated = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/users/${userId}/projects/${projectId}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Alpha Renamed" }),
      },
    );
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe("Alpha Renamed");

    const deleted = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/users/${userId}/projects/${projectId}`,
      { method: "DELETE" },
    );
    expect(deleted.status).toBe(200);

    const afterDelete = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/users/${userId}/projects`,
    );
    expect((afterDelete.body.projects as JsonBody[]).length).toBe(0);
  });
});