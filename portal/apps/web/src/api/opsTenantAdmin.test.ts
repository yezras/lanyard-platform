import { afterEach, describe, expect, it, vi } from "vitest";

import { resetOpsCsrfToken } from "./opsApi.js";
import {
  createOpsTenantUser,
  fetchOpsConnectorUsers,
  fetchOpsMemberSubset,
  fetchOpsTenantHome,
  fetchOpsTenantUsers,
  parseOpsMemberSubset,
  parseOpsTenantHome,
  putOpsConnectorUserGrant,
  putOpsMemberSubset,
} from "./opsTenantAdmin.js";

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("parseOpsTenantHome", () => {
  it("parses users_provisioned and activity", () => {
    expect(
      parseOpsTenantHome({
        tenant_id: "t1",
        users_provisioned: 3,
        activity: [
          {
            activity_id: "a1",
            message: "Jack Rubin connected Slack",
            created_at: "2026-08-24T10:00:00Z",
          },
        ],
      }),
    ).toEqual({
      tenant_id: "t1",
      users_provisioned: 3,
      activity: [
        {
          activity_id: "a1",
          message: "Jack Rubin connected Slack",
          created_at: "2026-08-24T10:00:00Z",
        },
      ],
    });
  });

  it("throws on malformed payloads (fail closed)", () => {
    expect(() => parseOpsTenantHome({ tenant_id: "t1" })).toThrow();
    expect(() =>
      parseOpsTenantHome({ tenant_id: "t1", users_provisioned: -1, activity: [] }),
    ).toThrow();
    expect(() =>
      parseOpsTenantHome({
        tenant_id: "t1",
        users_provisioned: 1,
        activity: [{ activity_id: "a1" }],
      }),
    ).toThrow();
  });
});

describe("opsTenantAdmin clients", () => {
  afterEach(() => {
    resetOpsCsrfToken();
    vi.restoreAllMocks();
  });

  it("fetches tenant users from the BFF admin prefix", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        ok({
          tenant_id: "t1",
          users: [
            {
              user_id: "u1",
              display_name: "Jack Rubin",
              email: "operator@example.com",
              role: "tenant_admin",
              connectors: ["google", "hubspot"],
              last_active_at: "2026-08-24T10:00:00Z",
            },
          ],
        }),
      );
    try {
      const users = await fetchOpsTenantUsers("t1");
      expect(users).toHaveLength(1);
      expect(users[0]?.role).toBe("tenant_admin");
      const path = new URL(String(fetchMock.mock.calls[0]?.[0]), "http://x")
        .pathname;
      expect(path).toBe("/api/admin/tenants/t1/users");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("rejects invited as a tenant user role", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ok({
        users: [
          {
            user_id: "u1",
            display_name: "Invited Person",
            email: "invited@ops.test",
            role: "invited",
            connectors: [],
            last_active_at: null,
          },
        ],
      }),
    );
    await expect(fetchOpsTenantUsers("t1")).rejects.toThrow("Malformed tenant users");
  });

  it("surfaces home 501 and rejects invited roles", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: "Tenant home activity is not implemented yet" }),
        { status: 501 },
      ),
    );
    await expect(fetchOpsTenantHome("t1")).rejects.toThrow("not implemented");
    await expect(
      fetchOpsTenantUsers("t1"),
    ).rejects.toThrow();
  });

  it("POSTs a user and PUTs person grants with ops CSRF", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://x").pathname;
      if (path === "/api/admin/auth/csrf") {
        return Response.json({ csrf_token: "ops-csrf" });
      }
      if (path === "/api/admin/tenants/t1/users" && init?.method === "POST") {
        expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("ops-csrf");
        expect(JSON.parse(String(init.body))).toEqual({
          display_name: "Ada Admin",
          email: "ada@ops.test",
          role: "tenant_admin",
        });
        return ok({
          user_id: "u1",
          display_name: "Ada Admin",
          email: "ada@ops.test",
          role: "tenant_admin",
          connectors: [],
          last_active_at: null,
        });
      }
      if (path.endsWith("/users/u1") && init?.method === "PUT") {
        expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("ops-csrf");
        return ok({
          tenant_id: "t1",
          connector_id: "hubspot",
          user_id: "u1",
          granted: false,
        });
      }
      return ok({
        tenant_id: "t1",
        connector_id: "hubspot",
        users: [
          {
            user_id: "u1",
            display_name: "Jack Rubin",
            email: "operator@example.com",
            role_label: "Tenant admin",
            granted: true,
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const created = await createOpsTenantUser({
      tenantId: "t1",
      displayName: "Ada Admin",
      email: "ada@ops.test",
      role: "tenant_admin",
    });
    expect(created.role).toBe("tenant_admin");

    const users = await fetchOpsConnectorUsers({
      tenantId: "t1",
      connectorId: "hubspot",
    });
    expect(users[0]?.granted).toBe(true);

    await putOpsConnectorUserGrant({
      tenantId: "t1",
      connectorId: "hubspot",
      userId: "u1",
      granted: false,
    });
  });

  it("PUTs member subset with ops CSRF", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://x").pathname;
      if (path === "/api/admin/auth/csrf") {
        return Response.json({ csrf_token: "ops-csrf" });
      }
      expect(path).toBe("/api/admin/tenants/t1/connectors/stripe/member-subset");
      if (init?.method === "PUT") {
        expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("ops-csrf");
        expect(JSON.parse(String(init.body))).toEqual({
          allowed_tools: ["GetCustomers"],
        });
      }
      return ok({
        tenant_id: "t1",
        connector_id: "stripe",
        kind: "allowlist",
        tools: [{ name: "GetCustomers", group: "read" }],
        allowed_tools: ["GetCustomers"],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const loaded = await fetchOpsMemberSubset({
        tenantId: "t1",
        connectorId: "stripe",
      });
      expect(loaded.kind).toBe("allowlist");
      const saved = await putOpsMemberSubset({
        tenantId: "t1",
        connectorId: "stripe",
        allowedTools: ["GetCustomers"],
      });
      expect(saved.allowed_tools).toEqual(["GetCustomers"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("parseOpsMemberSubset", () => {
  it("throws on malformed payloads", () => {
    expect(() => parseOpsMemberSubset({})).toThrow();
    expect(() =>
      parseOpsMemberSubset({
        tenant_id: "t1",
        connector_id: "stripe",
        kind: "allowlist",
      }),
    ).toThrow();
  });
});
