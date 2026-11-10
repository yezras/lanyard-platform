import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { ControlPlaneStore } from "../src/store.js";
import {
  PORTAL_ROLE_HEADER,
  TENANT_ID_HEADER,
} from "../src/tenant-authz.js";
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

function tenantHeaders(
  tenantId: string,
  role?: "admin" | "contributor" | "member",
  extra?: HeadersInit,
): Headers {
  const headers = new Headers(extra);
  headers.set(TENANT_ID_HEADER, tenantId);
  if (role) {
    headers.set(PORTAL_ROLE_HEADER, role);
  }
  if (!headers.has("content-type") && extra) {
    // leave content-type from extra when present
  }
  return headers;
}

describe("control-plane tenant-scoped authz (G1a.1 / G1a.2)", () => {
  let store: ControlPlaneStore;
  let app: ReturnType<typeof createApp>;
  let tenantAId: string;
  let tenantBId: string;
  let userAId: string;
  let userBId: string;
  let roleAId: string;
  let instanceAId: string;
  let projectAId: string;

  beforeEach(async () => {
    store = await createTestStore();
    app = createApp(store, { devOpen: true });

    const tenantA = await store.createTenant({
      slug: "alpha",
      display_name: "Alpha",
    });
    const tenantB = await store.createTenant({
      slug: "beta",
      display_name: "Beta",
    });
    tenantAId = tenantA.tenant_id;
    tenantBId = tenantB.tenant_id;

    const userA = await store.registerUser({
      tenant_id: tenantAId,
      email: "alice@alpha.test",
      password: "password123",
    });
    const userB = await store.registerUser({
      tenant_id: tenantBId,
      email: "bob@beta.test",
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
    await store.setUserRoles({
      tenant_id: tenantAId,
      user_id: userAId,
      role_ids: [roleAId],
    });

    const roleB = await store.createRole({
      tenant_id: tenantBId,
      name: "contributor",
      hermes_profile: "contributor",
      path_prefixes: ["/Projects"],
    });
    await store.setUserRoles({
      tenant_id: tenantBId,
      user_id: userBId,
      role_ids: [roleB.role_id],
    });

    const instanceA = await store.provisionInstance({ tenant_id: tenantAId });
    instanceAId = instanceA.instance_id;

    const projectA = await store.createProject({
      tenant_id: tenantAId,
      user_id: userAId,
      name: "Alpha Project",
      vault_path: "/Projects/A",
    });
    projectAId = projectA.project_id;
  });

  afterEach(async () => {
    await store.close();
  });

  describe("cross-tenant isolation", () => {
    it("returns 404 when rotating an instance owned by another tenant", async () => {
      const res = await jsonRequest(
        app,
        `/tenants/${tenantBId}/instances/${instanceAId}/rotate`,
        {
          method: "POST",
          headers: tenantHeaders(tenantBId, "admin", {
            "content-type": "application/json",
          }),
          body: JSON.stringify({}),
        },
      );
      expect(res.status).toBe(404);
    });

    it("returns 404 when revoking an instance under the wrong tenant", async () => {
      const res = await jsonRequest(
        app,
        `/tenants/${tenantBId}/instances/${instanceAId}/revoke`,
        {
          method: "POST",
          headers: tenantHeaders(tenantBId, "admin"),
        },
      );
      expect(res.status).toBe(404);
    });

    it("does not assign roles using a role_id from another tenant", async () => {
      const res = await jsonRequest(
        app,
        `/tenants/${tenantBId}/users/${userBId}/roles`,
        {
          method: "PUT",
          headers: tenantHeaders(tenantBId, "admin", {
            "content-type": "application/json",
          }),
          body: JSON.stringify({ role_ids: [roleAId] }),
        },
      );
      expect(res.status).toBe(404);
      expect(String(res.body.error)).toMatch(/Role not found/i);
    });

    it("does not resolve RBAC for a user belonging to another tenant", async () => {
      const res = await jsonRequest(
        app,
        `/internal/tenants/${tenantBId}/users/${userAId}/rbac`,
        { headers: tenantHeaders(tenantBId, "contributor") },
      );
      expect(res.status).toBe(200);
      expect(res.body.rbac).toBeNull();
    });

    it("does not load a project owned by another tenant", async () => {
      const res = await jsonRequest(
        app,
        `/internal/tenants/${tenantBId}/users/${userBId}/projects/${projectAId}`,
        { headers: tenantHeaders(tenantBId, "contributor") },
      );
      expect(res.status).toBe(404);
    });

    it("rejects creating a project as a foreign user under tenant path", async () => {
      const res = await jsonRequest(
        app,
        `/internal/tenants/${tenantBId}/users/${userAId}/projects`,
        {
          method: "POST",
          headers: tenantHeaders(tenantBId, "contributor", {
            "content-type": "application/json",
          }),
          body: JSON.stringify({
            name: "Leak",
            vault_path: "/Projects",
          }),
        },
      );
      // userA is not in tenant B → no RBAC → 403 vault ACL
      expect(res.status).toBe(403);
    });

    it("rejects session share to a grantee email that only exists on another tenant", async () => {
      const res = await jsonRequest(
        app,
        `/internal/tenants/${tenantAId}/users/${userAId}/session-shares`,
        {
          method: "POST",
          headers: tenantHeaders(tenantAId, "admin", {
            "content-type": "application/json",
          }),
          body: JSON.stringify({
            thread_id: "33333333-3333-4333-8333-333333333333",
            grantee_email: "bob@beta.test",
            mode: "read",
          }),
        },
      );
      expect(res.status).toBe(404);
    });

    it("rejects mismatched x-lanyard-tenant-id header with 403", async () => {
      const res = await jsonRequest(app, `/tenants/${tenantAId}`, {
        headers: { [TENANT_ID_HEADER]: tenantBId },
      });
      expect(res.status).toBe(403);
      expect(String(res.body.error)).toMatch(/Cross-tenant/i);
    });

    it("allows matching tenant header for legitimate reads", async () => {
      const res = await jsonRequest(app, `/tenants/${tenantAId}`, {
        headers: tenantHeaders(tenantAId, "admin"),
      });
      expect(res.status).toBe(200);
      expect(res.body.tenant_id).toBe(tenantAId);
      expect(res.body.tenant_slug).toBe("alpha");
    });

    it("lists only the calling tenant's gateway instances", async () => {
      await store.provisionInstance({ tenant_id: tenantBId });

      const listA = await jsonRequest(
        app,
        `/tenants/${tenantAId}/gateway-instances`,
        { headers: tenantHeaders(tenantAId, "admin") },
      );
      expect(listA.status).toBe(200);
      const instancesA = listA.body.instances as Array<{ instance_id: string }>;
      expect(instancesA.map((i) => i.instance_id)).toEqual([instanceAId]);

      const listB = await jsonRequest(
        app,
        `/tenants/${tenantBId}/gateway-instances`,
        { headers: tenantHeaders(tenantBId, "admin") },
      );
      expect(listB.status).toBe(200);
      const instancesB = listB.body.instances as Array<{ instance_id: string }>;
      expect(instancesB).toHaveLength(1);
      expect(instancesB[0]!.instance_id).not.toBe(instanceAId);
    });

    it("deprovision of tenant B does not revoke tenant A instances", async () => {
      await jsonRequest(app, `/tenants/${tenantBId}/deprovision`, {
        method: "POST",
        headers: tenantHeaders(tenantBId, "admin"),
      });

      const listA = await jsonRequest(
        app,
        `/tenants/${tenantAId}/gateway-instances`,
      );
      expect(listA.status).toBe(200);
      expect(
        (listA.body.instances as Array<{ instance_id: string }>).map(
          (i) => i.instance_id,
        ),
      ).toEqual([instanceAId]);
    });
  });

  describe("admin / contributor portal roles (G1a.2)", () => {
    it("allows admin to create roles and assign them", async () => {
      const created = await jsonRequest(app, `/tenants/${tenantAId}/roles`, {
        method: "POST",
        headers: tenantHeaders(tenantAId, "admin", {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          name: "ops-extra",
          hermes_profile: "admin",
          path_prefixes: ["/Ops"],
        }),
      });
      expect(created.status).toBe(201);

      const assigned = await jsonRequest(
        app,
        `/tenants/${tenantAId}/users/${userAId}/roles`,
        {
          method: "PUT",
          headers: tenantHeaders(tenantAId, "admin", {
            "content-type": "application/json",
          }),
          body: JSON.stringify({
            role_ids: [roleAId, created.body.role_id],
          }),
        },
      );
      expect(assigned.status).toBe(200);
      expect(assigned.body.role_names).toEqual(
        expect.arrayContaining(["admin", "ops-extra"]),
      );
    });

    it("blocks contributor from creating roles (no elevation)", async () => {
      const res = await jsonRequest(app, `/tenants/${tenantBId}/roles`, {
        method: "POST",
        headers: tenantHeaders(tenantBId, "contributor", {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          name: "elevated-admin",
          hermes_profile: "admin",
          path_prefixes: ["/"],
        }),
      });
      expect(res.status).toBe(403);
      expect(String(res.body.error)).toMatch(/roles\.manage/);
    });

    it("blocks contributor from assigning roles to themselves", async () => {
      const res = await jsonRequest(
        app,
        `/tenants/${tenantBId}/users/${userBId}/roles`,
        {
          method: "PUT",
          headers: tenantHeaders(tenantBId, "contributor", {
            "content-type": "application/json",
          }),
          body: JSON.stringify({ role_ids: [roleAId] }),
        },
      );
      expect(res.status).toBe(403);
      expect(String(res.body.error)).toMatch(/roles\.manage/);
    });

    it("blocks contributor from provisioning gateway instances", async () => {
      const res = await jsonRequest(
        app,
        `/tenants/${tenantBId}/instances/provision`,
        {
          method: "POST",
          headers: tenantHeaders(tenantBId, "contributor"),
        },
      );
      expect(res.status).toBe(403);
      expect(String(res.body.error)).toMatch(/instances\.manage/);
    });

    it("blocks contributor from deprovisioning a tenant", async () => {
      const res = await jsonRequest(app, `/tenants/${tenantBId}/deprovision`, {
        method: "POST",
        headers: tenantHeaders(tenantBId, "contributor"),
      });
      expect(res.status).toBe(403);
    });

    it("allows contributor to read roles and own RBAC", async () => {
      const roles = await jsonRequest(app, `/tenants/${tenantBId}/roles`, {
        headers: tenantHeaders(tenantBId, "contributor"),
      });
      expect(roles.status).toBe(200);
      expect((roles.body.roles as unknown[]).length).toBeGreaterThan(0);

      const rbac = await jsonRequest(
        app,
        `/internal/tenants/${tenantBId}/users/${userBId}/rbac`,
        { headers: tenantHeaders(tenantBId, "contributor") },
      );
      expect(rbac.status).toBe(200);
      expect((rbac.body.rbac as JsonBody).hermes_profile).toBe("contributor");
    });

    it("allows contributor to manage projects within their vault prefixes", async () => {
      const created = await jsonRequest(
        app,
        `/internal/tenants/${tenantBId}/users/${userBId}/projects`,
        {
          method: "POST",
          headers: tenantHeaders(tenantBId, "contributor", {
            "content-type": "application/json",
          }),
          body: JSON.stringify({
            name: "Beta Work",
            vault_path: "/Projects/Beta",
          }),
        },
      );
      expect(created.status).toBe(201);
      expect(created.body.vault_path).toBe("/Projects/Beta");

      const denied = await jsonRequest(
        app,
        `/internal/tenants/${tenantBId}/users/${userBId}/projects`,
        {
          method: "POST",
          headers: tenantHeaders(tenantBId, "contributor", {
            "content-type": "application/json",
          }),
          body: JSON.stringify({
            name: "Root",
            vault_path: "/",
          }),
        },
      );
      expect(denied.status).toBe(403);
    });

    it("maps demo member role to contributor permissions", async () => {
      const res = await jsonRequest(app, `/tenants/${tenantBId}/roles`, {
        method: "POST",
        headers: tenantHeaders(tenantBId, "member", {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          name: "should-fail",
          hermes_profile: "admin",
          path_prefixes: ["/"],
        }),
      });
      expect(res.status).toBe(403);
    });

    it("rejects unknown portal role labels", async () => {
      const res = await jsonRequest(app, `/tenants/${tenantAId}/roles`, {
        method: "POST",
        headers: {
          [TENANT_ID_HEADER]: tenantAId,
          [PORTAL_ROLE_HEADER]: "superadmin",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "x",
          hermes_profile: "admin",
          path_prefixes: ["/"],
        }),
      });
      expect(res.status).toBe(403);
      expect(String(res.body.error)).toMatch(/Unknown portal role/i);
    });
  });
});
