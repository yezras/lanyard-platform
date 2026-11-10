import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp as createControlPlaneApp } from "../../control-plane/src/app.js";
import { ControlPlaneStore } from "../../control-plane/src/store.js";
import { createTestStore } from "../../control-plane/test/pg-test-store.js";
import { createApp } from "../src/app.js";
import { ControlPlaneAuthClient } from "../src/control-plane-client.js";
import { SessionStore } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import {
  cookieHeader,
  createTestBindings,
  parseSetCookie,
} from "./test-helpers.js";

type JsonBody = Record<string, unknown>;

const alphaTenant: TenantContext = {
  tenant_id: "",
  tenant_slug: "alpha",
  display_name: "Alpha",
  host: "alpha.withlanyard.com",
};

const betaTenant: TenantContext = {
  tenant_id: "",
  tenant_slug: "beta",
  display_name: "Beta",
  host: "beta.withlanyard.com",
};

const demoTenant: TenantContext = {
  tenant_id: "",
  tenant_slug: "demo",
  display_name: "Demo",
  host: "demo.localhost",
};

let demoMemberRoleId = "";

async function jsonRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  init: RequestInit & {
    host?: string;
    cookies?: Record<string, string>;
    csrf?: boolean;
  } = {},
): Promise<{
  status: number;
  body: JsonBody;
  cookies: Record<string, string>;
}> {
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
  const body = (await response.json()) as JsonBody;
  const cookies = {
    ...init.cookies,
    ...parseSetCookie(response.headers.get("set-cookie")),
  };

  return { status: response.status, body, cookies };
}

describe("bff auth integration", () => {
  let store: ControlPlaneStore;
  let controlPlaneApp: ReturnType<typeof createControlPlaneApp>;
  let bffApp: ReturnType<typeof createApp>;
  let sessions: SessionStore;

  beforeEach(async () => {
    store = await createTestStore();
    controlPlaneApp = createControlPlaneApp(store, { devOpen: true });
    sessions = new SessionStore();

    const authClient = new ControlPlaneAuthClient(
      "http://control-plane.test",
      (input, init) => {
        const url = new URL(input);
        return controlPlaneApp.request(url.pathname + url.search, init);
      },
    );

    const tenantA = await controlPlaneApp.request("/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "alpha", display_name: "Alpha" }),
    });
    const tenantB = await controlPlaneApp.request("/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "beta", display_name: "Beta" }),
    });

    alphaTenant.tenant_id = ((await tenantA.json()) as JsonBody).tenant_id as string;
    betaTenant.tenant_id = ((await tenantB.json()) as JsonBody).tenant_id as string;

    const tenantDemo = await controlPlaneApp.request("/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "demo", display_name: "Demo" }),
    });
    demoTenant.tenant_id = ((await tenantDemo.json()) as JsonBody).tenant_id as string;

    const memberRole = await controlPlaneApp.request(
      `/tenants/${demoTenant.tenant_id}/roles`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "member",
          hermes_profile: "default",
          path_prefixes: ["/"],
        }),
      },
    );
    demoMemberRoleId = ((await memberRole.json()) as JsonBody).role_id as string;

    bffApp = createApp(
      createTestBindings(
        { alpha: alphaTenant, beta: betaTenant, demo: demoTenant },
        { authClient, sessions },
      ),
    );
  });

  afterEach(async () => {
    await store.close();
    await sessions.clear();
  });

  it("registers and logs in with tenant-bound session cookie", async () => {
    const csrf = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: "alpha.withlanyard.com",
    });
    expect(csrf.status).toBe(200);

    const register = await jsonRequest(bffApp, "/api/auth/register", {
      method: "POST",
      host: "alpha.withlanyard.com",
      cookies: csrf.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "alice@alpha.example",
        password: "password123",
      }),
    });

    expect(register.status).toBe(201);
    expect(register.body.tenant_id).toBe(alphaTenant.tenant_id);
    expect(register.cookies.lanyard_session).toBeTruthy();

    const me = await jsonRequest(bffApp, "/api/auth/me", {
      host: "alpha.withlanyard.com",
      cookies: register.cookies,
    });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe("alice@alpha.example");
  });

  it("invalidates tenant A session when host switches to tenant B", async () => {
    const csrf = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: "alpha.withlanyard.com",
    });

    const register = await jsonRequest(bffApp, "/api/auth/register", {
      method: "POST",
      host: "alpha.withlanyard.com",
      cookies: csrf.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "bob@alpha.example",
        password: "password123",
      }),
    });

    expect(register.status).toBe(201);

    const crossTenant = await jsonRequest(bffApp, "/api/auth/me", {
      host: "beta.withlanyard.com",
      cookies: register.cookies,
    });

    expect(crossTenant.status).toBe(401);
    expect(crossTenant.body.error).toBe("Not authenticated");
  });

  it("supports Google stub sign-in in local dev mode", async () => {
    const localDevApp = createApp(
      createTestBindings(
        { alpha: alphaTenant, beta: betaTenant, demo: demoTenant },
        {
          authClient: new ControlPlaneAuthClient(
            "http://control-plane.test",
            (input, init) => {
              const url = new URL(input);
              return controlPlaneApp.request(url.pathname + url.search, init);
            },
          ),
          sessions,
          devTenantSlug: "demo",
        },
      ),
    );

    const csrf = await jsonRequest(localDevApp, "/api/auth/csrf", {
      host: "demo.localhost",
    });

    const google = await jsonRequest(localDevApp, "/api/auth/google/stub", {
      method: "POST",
      host: "demo.localhost",
      cookies: csrf.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        google_sub: "google-user-123",
        email: "carol@demo.example",
      }),
    });

    expect(google.status).toBe(200);
    expect(google.body.tenant_id).toBe(demoTenant.tenant_id);
    expect(google.body.provider).toBe("google");
  });

  it("rejects Google stub outside local dev mode", async () => {
    const csrf = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: "beta.withlanyard.com",
    });

    const google = await jsonRequest(bffApp, "/api/auth/google/stub", {
      method: "POST",
      host: "beta.withlanyard.com",
      cookies: csrf.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        google_sub: "google-user-123",
        email: "carol@beta.example",
      }),
    });

    expect(google.status).toBe(404);
  });

  it("auto-assigns demo member role on register in local dev", async () => {
    const localDevApp = createApp(
      createTestBindings(
        { alpha: alphaTenant, beta: betaTenant, demo: demoTenant },
        {
          authClient: new ControlPlaneAuthClient(
            "http://control-plane.test",
            (input, init) => {
              const url = new URL(input);
              return controlPlaneApp.request(url.pathname + url.search, init);
            },
          ),
          sessions,
          devTenantSlug: "demo",
          demoMemberRoleId,
        },
      ),
    );

    const csrf = await jsonRequest(localDevApp, "/api/auth/csrf", {
      host: "demo.localhost",
    });

    const register = await jsonRequest(localDevApp, "/api/auth/register", {
      method: "POST",
      host: "demo.localhost",
      cookies: csrf.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "eve@demo.example",
        password: "password123",
      }),
    });

    expect(register.status).toBe(201);

    const rbacResponse = await controlPlaneApp.request(
      `/internal/tenants/${demoTenant.tenant_id}/users/${register.body.user_id}/rbac`,
    );
    const rbac = (await rbacResponse.json()) as JsonBody;
    expect(rbac.rbac).toMatchObject({
      hermes_profile: "default",
      role_names: ["member"],
    });
  });

  it("rejects mutations without CSRF token", async () => {
    const csrf = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: "alpha.withlanyard.com",
    });

    const register = await jsonRequest(bffApp, "/api/auth/register", {
      method: "POST",
      host: "alpha.withlanyard.com",
      cookies: csrf.cookies,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "dave@alpha.example",
        password: "password123",
      }),
    });

    expect(register.status).toBe(403);
    expect(register.body.error).toContain("CSRF");
  });
});
