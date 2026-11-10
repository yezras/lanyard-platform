import { describe, expect, it } from "vitest";

import {
  ADA_USER,
  MOCK_LAB,
  STRIPE_HIT,
  createFakeOpsStore,
  handleFakeOpsRequest,
  type FakeOpsRequest,
  type FakeOpsStore,
} from "./fakeOps.js";

function req(
  method: string,
  pathname: string,
  body?: unknown,
  search = "",
): FakeOpsRequest {
  return {
    method,
    pathname,
    search: new URLSearchParams(search),
    body: body ?? null,
  };
}

function call(store: FakeOpsStore, request: FakeOpsRequest) {
  const res = handleFakeOpsRequest(store, request);
  if (!res) {
    throw new Error(`unhandled ${request.method} ${request.pathname}`);
  }
  return res;
}

describe("FakeOps store (lp-hdzm.30)", () => {
  it("superadmin context has no tenant scope", () => {
    const store = createFakeOpsStore("superadmin");
    expect(call(store, req("GET", "/api/admin/context")).body).toEqual({
      role: "superadmin",
    });
    const tenants = call(store, req("GET", "/api/admin/tenants")).body as {
      tenants: Array<{ display_name: string }>;
    };
    expect(tenants.tenants).toEqual([
      expect.objectContaining({
        tenant_slug: "mocklab",
        display_name: "Mock Lab",
      }),
    ]);
  });

  it("tenant_admin context is scoped to Mock Lab and seeds Stripe", () => {
    const store = createFakeOpsStore("tenant_admin");
    expect(call(store, req("GET", "/api/admin/context")).body).toEqual({
      role: "tenant_admin",
      tenant: MOCK_LAB,
    });
    const onboarded = call(
      store,
      req("GET", `/api/admin/tenants/${MOCK_LAB.tenant_id}/connectors`),
    ).body as { connectors: Array<{ connector_id: string; surfaces: string[] }> };
    expect(onboarded.connectors).toEqual([
      expect.objectContaining({ connector_id: "stripe", surfaces: ["mcp"] }),
    ]);
  });

  it("unauth me is 401", () => {
    const store = createFakeOpsStore("unauth");
    const me = call(store, req("GET", "/api/admin/auth/me"));
    expect(me.status).toBe(401);
  });

  it("promotes a catalog domain into canonical", () => {
    const store = createFakeOpsStore();
    const search = call(
      store,
      req("GET", "/api/admin/registry/search", null, "q=stripe"),
    );
    expect(search.body).toEqual({ results: [STRIPE_HIT] });

    const promoted = call(
      store,
      req("POST", "/api/admin/registry/promote", { domain: "stripe.com" }),
    );
    expect(promoted.status).toBe(200);
    expect(promoted.body).toEqual(
      expect.objectContaining({
        id: "stripe",
        domain: "stripe.com",
        label: "Stripe",
        onboarded_tenant_count: 0,
      }),
    );
    const list = call(store, req("GET", "/api/admin/registry/connectors")).body as {
      connectors: Array<{ id: string }>;
    };
    expect(list.connectors.map((row) => row.id)).toEqual(["google", "stripe"]);
  });

  it("onboards a connector with one surface", () => {
    const store = createFakeOpsStore();
    call(store, req("POST", "/api/admin/registry/promote", { domain: "stripe.com" }));
    const put = call(
      store,
      req(
        "PUT",
        `/api/admin/tenants/${MOCK_LAB.tenant_id}/connectors/stripe`,
        { surfaces: ["mcp"] },
      ),
    );
    expect(put.body).toEqual({
      tenant_id: MOCK_LAB.tenant_id,
      connector_id: "stripe",
      enabled: true,
      surfaces: ["mcp"],
    });
  });

  it("adds a user immediately and syncs grants", () => {
    const store = createFakeOpsStore();
    const created = call(
      store,
      req("POST", `/api/admin/tenants/${MOCK_LAB.tenant_id}/users`, {
        display_name: "Mia Member",
        email: "mia@mocklab.test",
        role: "member",
      }),
    );
    expect(created.status).toBe(201);
    const user = created.body as { user_id: string; email: string };
    expect(user.email).toBe("mia@mocklab.test");

    call(
      store,
      req(
        "PUT",
        `/api/admin/tenants/${MOCK_LAB.tenant_id}/connectors/stripe/users/${user.user_id}`,
        { granted: true },
      ),
    );
    const connectorUsers = call(
      store,
      req(
        "GET",
        `/api/admin/tenants/${MOCK_LAB.tenant_id}/connectors/stripe/users`,
      ),
    ).body as { users: Array<{ user_id: string; granted: boolean }> };
    expect(
      connectorUsers.users.find((row) => row.user_id === user.user_id)?.granted,
    ).toBe(true);
    expect(
      store.users.find((row) => row.user_id === user.user_id)?.connectors,
    ).toEqual(["stripe"]);
    expect(store.users.find((row) => row.user_id === ADA_USER.user_id)).toBeTruthy();
  });

  it("records a Class C fingerprint and never keeps the paste value", () => {
    const store = createFakeOpsStore("tenant_admin");
    const secret = "sk_live_fakeops_must_not_persist";
    const put = call(
      store,
      req(
        "PUT",
        `/api/admin/tenants/${MOCK_LAB.tenant_id}/connectors/stripe/class-c-secrets/mcp`,
        { value: secret, auth_kind: "bearer" },
      ),
    );
    expect(put.status).toBe(200);
    const body = put.body as {
      present: boolean;
      fingerprint: string;
      surface_id: string;
    };
    expect(body).toMatchObject({
      present: true,
      surface_id: "mcp",
    });
    expect(body.fingerprint).toMatch(/^sha256:[0-9a-f]+$/);
    expect(JSON.stringify(put.body)).not.toContain(secret);
    expect(JSON.stringify(store)).not.toContain(secret);
    expect(store.classCSecrets).toEqual([
      expect.objectContaining({
        connector_id: "stripe",
        surface_id: "mcp",
        fingerprint: body.fingerprint,
      }),
    ]);

    const listed = call(
      store,
      req(
        "GET",
        `/api/admin/tenants/${MOCK_LAB.tenant_id}/connectors/stripe/class-c-secrets`,
      ),
    );
    expect(JSON.stringify(listed.body)).not.toContain(secret);
    const mcp = (
      listed.body as {
        surfaces: Array<{ surface_id: string; fingerprint: string | null }>;
      }
    ).surfaces.find((row) => row.surface_id === "mcp");
    expect(mcp?.fingerprint).toBe(body.fingerprint);

    const google = call(
      store,
      req(
        "PUT",
        `/api/admin/tenants/${MOCK_LAB.tenant_id}/connectors/google/class-c-secrets/cli`,
        { value: secret },
      ),
    );
    expect(google.status).toBe(400);
    expect(JSON.stringify(google.body)).not.toContain(secret);
  });

  it("does not handle non-admin fetches", () => {
    const store = createFakeOpsStore();
    expect(handleFakeOpsRequest(store, req("GET", "/api/context"))).toBeNull();
  });
});
