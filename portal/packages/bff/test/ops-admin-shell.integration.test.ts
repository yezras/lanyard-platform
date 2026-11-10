import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { APP_HOST } from "@lanyard/shared";

import { createApp as createControlPlaneApp } from "../../control-plane/src/app.js";
import { ControlPlaneStore } from "../../control-plane/src/store.js";
import { createTestStore } from "../../control-plane/test/pg-test-store.js";
import { createApp } from "../src/app.js";
import { ControlPlaneAuthClient } from "../src/control-plane-client.js";
import { MemoryOperatorDirectory } from "../src/operator-directory.js";
import { MemoryOpsSessionStore } from "../src/ops-session.js";
import { OPS_SESSION_COOKIE } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import {
  cookieHeader,
  createTestBindings,
  parseSetCookie,
} from "./test-helpers.js";

type JsonBody = Record<string, unknown>;

const operator = {
  operatorId: "op-ops@lanyard.example",
  email: "ops@lanyard.example",
};

async function jsonRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  init: RequestInit & {
    host?: string;
    cookies?: Record<string, string>;
    csrf?: boolean;
  } = {},
): Promise<{ status: number; body: JsonBody; cookies: Record<string, string> }> {
  const headers = new Headers(init.headers);
  if (init.host) {
    headers.set("host", init.host);
  }
  if (init.cookies && Object.keys(init.cookies).length > 0) {
    headers.set("cookie", cookieHeader(init.cookies));
  }
  if (init.csrf && init.cookies?.lanyard_csrf) {
    headers.set("x-csrf-token", init.cookies.lanyard_csrf);
  }

  const response = await app.request(path, { ...init, headers });
  const raw = await response.text();
  const body = JSON.parse(raw || "{}") as JsonBody;
  const cookies = {
    ...init.cookies,
    ...parseSetCookie(response.headers.get("set-cookie")),
  };
  return { status: response.status, body, cookies };
}

describe("admin shell context + users/grants (lp-hdzm.6)", () => {
  let store: ControlPlaneStore;
  let bffApp: ReturnType<typeof createApp>;
  let tenant: TenantContext;
  let memberCookies: Record<string, string> = {};

  beforeEach(async () => {
    store = await createTestStore();
    const controlPlaneApp = createControlPlaneApp(store, { devOpen: true });

    const created = await store.createTenant({
      slug: "mocklab",
      display_name: "MockLab",
    });
    tenant = {
      tenant_id: created.tenant_id,
      tenant_slug: created.tenant_slug,
      display_name: created.display_name,
      host: created.host,
    };

    const authClient = new ControlPlaneAuthClient(
      "http://control-plane.test",
      (input, init) => {
        const url = new URL(input);
        return controlPlaneApp.request(url.pathname + url.search, init);
      },
    );

    bffApp = createApp(
      createTestBindings(
        { mocklab: tenant },
        {
          authClient,
          opsSessions: new MemoryOpsSessionStore(),
          operatorDirectory: new MemoryOperatorDirectory([operator]),
          devTenantSlug: "mocklab",
        },
      ),
    );

    const csrf = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: tenant.host,
    });
    const memberReg = await jsonRequest(bffApp, "/api/auth/register", {
      method: "POST",
      host: tenant.host,
      cookies: csrf.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "alice@mocklab.test",
        password: "password123",
      }),
    });
    expect(memberReg.status).toBe(201);
    memberCookies = memberReg.cookies;
  });

  afterEach(async () => {
    memberCookies = {};
    await store.close();
  });

  async function opsLogin(): Promise<Record<string, string>> {
    const csrf = await jsonRequest(bffApp, "/api/admin/auth/csrf", {
      host: APP_HOST,
    });
    const stub = await jsonRequest(bffApp, "/api/admin/auth/google/stub", {
      method: "POST",
      host: APP_HOST,
      cookies: csrf.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: operator.email }),
    });
    expect(stub.status).toBe(200);
    expect(stub.cookies[OPS_SESSION_COOKIE]).toBeTruthy();
    return stub.cookies;
  }

  it("reports the superadmin role an ops session proves", async () => {
    const opsCookies = await opsLogin();
    const res = await jsonRequest(bffApp, "/api/admin/context", {
      host: APP_HOST,
      cookies: opsCookies,
    });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("superadmin");
    expect(res.body.operator_id).toBe(operator.operatorId);
    expect(res.body.tenant).toBeUndefined();
  });

  it("never issues tenant_admin scope from /context", async () => {
    const opsCookies = await opsLogin();
    const res = await jsonRequest(bffApp, "/api/admin/context", {
      host: APP_HOST,
      cookies: opsCookies,
    });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("tenant_admin");
  });

  it("fails closed with 501 on tenant home only", async () => {
    const opsCookies = await opsLogin();

    const home = await jsonRequest(
      bffApp,
      `/api/admin/tenants/${tenant.tenant_id}/home`,
      { host: APP_HOST, cookies: opsCookies },
    );
    expect(home.status).toBe(501);
    expect(home.body.error).toContain("not implemented");
    expect(home.body.users_provisioned).toBeUndefined();
  });

  it("provisions users and person grants through CP", async () => {
    const opsCookies = await opsLogin();

    const created = await jsonRequest(
      bffApp,
      `/api/admin/tenants/${tenant.tenant_id}/users`,
      {
        method: "POST",
        host: APP_HOST,
        cookies: opsCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          display_name: "Ada Admin",
          email: "ada@ops.test",
          role: "tenant_admin",
        }),
      },
    );
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      display_name: "Ada Admin",
      email: "ada@ops.test",
      role: "tenant_admin",
    });
    const userId = String(created.body.user_id);

    const dup = await jsonRequest(
      bffApp,
      `/api/admin/tenants/${tenant.tenant_id}/users`,
      {
        method: "POST",
        host: APP_HOST,
        cookies: opsCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          display_name: "Ada Two",
          email: "ada@ops.test",
          role: "member",
        }),
      },
    );
    expect(dup.status).toBe(409);

    const lastAdmin = await jsonRequest(
      bffApp,
      `/api/admin/tenants/${tenant.tenant_id}/users/${userId}`,
      {
        method: "DELETE",
        host: APP_HOST,
        cookies: opsCookies,
        csrf: true,
      },
    );
    expect(lastAdmin.status).toBe(409);

    const grantPut = await jsonRequest(
      bffApp,
      `/api/admin/tenants/${tenant.tenant_id}/connectors/hubspot/users/${userId}`,
      {
        method: "PUT",
        host: APP_HOST,
        cookies: opsCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ granted: true }),
      },
    );
    expect(grantPut.status).toBe(200);
    expect(grantPut.body).toMatchObject({
      connector_id: "hubspot",
      user_id: userId,
      granted: true,
    });

    const users = await jsonRequest(
      bffApp,
      `/api/admin/tenants/${tenant.tenant_id}/users`,
      { host: APP_HOST, cookies: opsCookies },
    );
    expect(users.status).toBe(200);
    expect(users.body.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user_id: userId,
          role: "tenant_admin",
          connectors: ["hubspot"],
        }),
      ]),
    );
    expect(JSON.stringify(users.body)).not.toContain("invited");

    const grants = await jsonRequest(
      bffApp,
      `/api/admin/tenants/${tenant.tenant_id}/connectors/hubspot/users`,
      { host: APP_HOST, cookies: opsCookies },
    );
    expect(grants.status).toBe(200);
    expect(grants.body.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user_id: userId,
          role_label: "Tenant admin",
          granted: true,
        }),
      ]),
    );

    const firstClassSubset = await jsonRequest(
      bffApp,
      `/api/admin/tenants/${tenant.tenant_id}/connectors/hubspot/member-subset`,
      { host: APP_HOST, cookies: opsCookies },
    );
    expect(firstClassSubset.status).toBe(200);
    expect(firstClassSubset.body.kind).toBe("grant_only");
  });

  it("PUTs member subset on a registry connector and rejects tenant cookies", async () => {
    await store.insertCanonicalConnector({
      id: "stripe",
      domain: "stripe.com",
      label: "Stripe",
      source: "custom",
      snapshot: {
        version: 1,
        source: "custom",
        domain: "stripe.com",
        compiled_at: "2026-08-26T00:00:00.000Z",
        runnability: "runnable",
        surfaces: [
          {
            kind: "openapi",
            slug: "api",
            label: "API",
            runnability: "runnable",
            spec: {
              openapi: "3.0.0",
              info: { title: "Stripe", version: "1" },
              paths: {
                "/v1/customers": {
                  get: {
                    operationId: "GetCustomers",
                    responses: { "200": { description: "ok" } },
                  },
                },
              },
            },
          },
        ],
      },
    });
    const opsCookies = await opsLogin();
    const put = await jsonRequest(
      bffApp,
      `/api/admin/tenants/${tenant.tenant_id}/connectors/stripe/member-subset`,
      {
        method: "PUT",
        host: APP_HOST,
        cookies: opsCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ allowed_tools: ["GetCustomers"] }),
      },
    );
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({
      connector_id: "stripe",
      kind: "allowlist",
      allowed_tools: ["GetCustomers"],
    });

    const denied = await jsonRequest(
      bffApp,
      `/api/admin/tenants/${tenant.tenant_id}/connectors/stripe/member-subset`,
      {
        method: "PUT",
        host: APP_HOST,
        cookies: memberCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ allowed_tools: ["GetCustomers"] }),
      },
    );
    expect(denied.status).toBe(401);
  });

  it("rejects tenant cookies and anonymous callers on the shell routes", async () => {
    const anon = await jsonRequest(bffApp, "/api/admin/context", {
      host: APP_HOST,
    });
    expect(anon.status).toBe(401);

    const tenantCookie = await jsonRequest(bffApp, "/api/admin/context", {
      host: APP_HOST,
      cookies: memberCookies,
    });
    expect(tenantCookie.status).toBe(401);

    const tenantHome = await jsonRequest(
      bffApp,
      `/api/admin/tenants/${tenant.tenant_id}/home`,
      { host: APP_HOST, cookies: memberCookies },
    );
    expect(tenantHome.status).toBe(401);

    const tenantUsers = await jsonRequest(
      bffApp,
      `/api/admin/tenants/${tenant.tenant_id}/users`,
      { host: APP_HOST, cookies: memberCookies },
    );
    expect(tenantUsers.status).toBe(401);

    const tenantPost = await jsonRequest(
      bffApp,
      `/api/admin/tenants/${tenant.tenant_id}/users`,
      {
        method: "POST",
        host: APP_HOST,
        cookies: memberCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          display_name: "Eve",
          email: "eve@ops.test",
          role: "member",
        }),
      },
    );
    expect(tenantPost.status).toBe(401);

    const tenantGrant = await jsonRequest(
      bffApp,
      `/api/admin/tenants/${tenant.tenant_id}/connectors/hubspot/users/u-1`,
      {
        method: "PUT",
        host: APP_HOST,
        cookies: memberCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ granted: true }),
      },
    );
    expect(tenantGrant.status).toBe(401);
  });
});
