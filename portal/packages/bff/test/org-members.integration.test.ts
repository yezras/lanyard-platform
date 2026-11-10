import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp as createControlPlaneApp } from "../../control-plane/src/app.js";
import { ControlPlaneStore } from "../../control-plane/src/store.js";
import { createTestStore } from "../../control-plane/test/pg-test-store.js";
import { createApp } from "../src/app.js";
import { ChatThreadStore } from "../src/chat-store.js";
import { ControlPlaneAuthClient } from "../src/control-plane-client.js";
import { RelayClient } from "../src/relay-client.js";
import { SessionStore } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import { cookieHeader, parseSetCookie } from "./test-helpers.js";

type JsonBody = Record<string, unknown>;

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

async function registerAndAssignRole(
  store: ControlPlaneStore,
  bffApp: ReturnType<typeof createApp>,
  tenant: TenantContext,
  email: string,
  cookies: Record<string, string>,
): Promise<{ userId: string; cookies: Record<string, string> }> {
  const register = await jsonRequest(bffApp, "/api/auth/register", {
    method: "POST",
    host: tenant.host,
    cookies,
    csrf: true,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "password123",
    }),
  });
  expect(register.status).toBe(201);

  const userId = register.body.user_id as string;
  const role = await store.createRole({
    tenant_id: tenant.tenant_id,
    name: `role-${email}`,
    hermes_profile: "default",
    path_prefixes: ["/"],
  });
  await store.setUserRoles({
    tenant_id: tenant.tenant_id,
    user_id: userId,
    role_ids: [role.role_id],
  });

  return { userId, cookies: register.cookies };
}

describe("bff org member directory integration", () => {
  let store: ControlPlaneStore;
  let controlPlaneApp: ReturnType<typeof createControlPlaneApp>;
  let bffApp: ReturnType<typeof createApp>;
  let tenantDemo: TenantContext;
  let tenantOther: TenantContext;
  let demoUserACookies: Record<string, string> = {};
  let demoUserBCookies: Record<string, string> = {};
  let otherUserCookies: Record<string, string> = {};
  let demoUserAId = "";
  let demoUserBId = "";
  let otherUserId = "";

  beforeEach(async () => {
    store = await createTestStore();
    controlPlaneApp = createControlPlaneApp(store, { devOpen: true });

    const createdDemo = await store.createTenant({
      slug: "demo",
      display_name: "Demo",
    });
    const createdOther = await store.createTenant({
      slug: "other",
      display_name: "Other",
    });

    tenantDemo = {
      tenant_id: createdDemo.tenant_id,
      tenant_slug: createdDemo.tenant_slug,
      display_name: createdDemo.display_name,
      host: createdDemo.host,
    };
    tenantOther = {
      tenant_id: createdOther.tenant_id,
      tenant_slug: createdOther.tenant_slug,
      display_name: createdOther.display_name,
      host: createdOther.host,
    };

    const authClient = new ControlPlaneAuthClient(
      "http://control-plane.test",
      (input, init) => {
        const url = new URL(input);
        return controlPlaneApp.request(url.pathname + url.search, init);
      },
    );

    bffApp = createApp({
      tenantResolver: {
        async resolveBySlug(slug: string) {
          if (slug === tenantDemo.tenant_slug) return tenantDemo;
          if (slug === tenantOther.tenant_slug) return tenantOther;
          return null;
        },
        async resolveById(id: string) {
          if (id === tenantDemo.tenant_id) return tenantDemo;
          if (id === tenantOther.tenant_id) return tenantOther;
          return null;
        },
      },
      authClient,
      relayClient: new RelayClient("http://relay.test", "unused"),
      chatThreads: new ChatThreadStore(),
      sessions: new SessionStore(),
      config: {
        sessionSecret: "test-session-secret",
        secureCookies: false,
        googleClientId: undefined,
        googleRedirectPath: "/api/auth/google/callback",
        relayUrl: "http://relay.test",
        relayInternalToken: "unused",
      },
    });

    const csrfDemo = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: tenantDemo.host,
    });
    const userA = await registerAndAssignRole(
      store,
      bffApp,
      tenantDemo,
      "alice@demo.test",
      csrfDemo.cookies,
    );
    demoUserAId = userA.userId;
    demoUserACookies = userA.cookies;

    const csrfDemo2 = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: tenantDemo.host,
    });
    const userB = await registerAndAssignRole(
      store,
      bffApp,
      tenantDemo,
      "bob@demo.test",
      csrfDemo2.cookies,
    );
    demoUserBId = userB.userId;
    demoUserBCookies = userB.cookies;

    const csrfOther = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: tenantOther.host,
    });
    const other = await registerAndAssignRole(
      store,
      bffApp,
      tenantOther,
      "carol@other.test",
      csrfOther.cookies,
    );
    otherUserId = other.userId;
    otherUserCookies = other.cookies;
  });

  afterEach(async () => {
    await store.close();
  });

  it("authenticated demo member can list other demo users", async () => {
    const res = await jsonRequest(bffApp, "/api/org/members", {
      host: tenantDemo.host,
      cookies: demoUserACookies,
    });

    expect(res.status).toBe(200);
    expect(res.body.tenant_id).toBe(tenantDemo.tenant_id);

    const members = res.body.members as Array<{
      user_id: string;
      email: string;
    }>;
    expect(members).toHaveLength(1);
    expect(members[0]?.user_id).toBe(demoUserBId);
    expect(members[0]?.email).toBe("bob@demo.test");

    for (const member of members) {
      expect(Object.keys(member).sort()).toEqual(["email", "user_id"]);
      expect(member).not.toHaveProperty("password_hash");
    }
  });

  it("excludes the current user from the directory", async () => {
    const res = await jsonRequest(bffApp, "/api/org/members", {
      host: tenantDemo.host,
      cookies: demoUserACookies,
    });
    expect(res.status).toBe(200);
    const members = res.body.members as Array<{ user_id: string }>;
    expect(members.map((m) => m.user_id)).not.toContain(demoUserAId);
    expect(members.map((m) => m.user_id)).toContain(demoUserBId);
  });

  it("never lists users from another tenant (cross-tenant isolation)", async () => {
    const demoList = await jsonRequest(bffApp, "/api/org/members", {
      host: tenantDemo.host,
      cookies: demoUserACookies,
    });
    const otherList = await jsonRequest(bffApp, "/api/org/members", {
      host: tenantOther.host,
      cookies: otherUserCookies,
    });

    expect(demoList.status).toBe(200);
    expect(otherList.status).toBe(200);

    const demoMembers = demoList.body.members as Array<{
      user_id: string;
      email: string;
    }>;
    const otherMembers = otherList.body.members as Array<{
      user_id: string;
      email: string;
    }>;

    expect(demoMembers.map((m) => m.user_id)).not.toContain(otherUserId);
    expect(demoMembers.every((m) => m.email.endsWith("@demo.test"))).toBe(true);

    // Only carol on other tenant; she is excluded as self → empty list
    expect(otherMembers).toHaveLength(0);
    expect(otherMembers.map((m) => m.user_id)).not.toContain(demoUserAId);
    expect(otherMembers.map((m) => m.user_id)).not.toContain(demoUserBId);
  });

  it("rejects unauthenticated callers", async () => {
    const csrf = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: tenantDemo.host,
    });
    const res = await jsonRequest(bffApp, "/api/org/members", {
      host: tenantDemo.host,
      cookies: csrf.cookies,
    });
    expect(res.status).toBe(401);
  });

  it("supports optional email search filter", async () => {
    // Register a third demo user so search has something distinct
    const csrf = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: tenantDemo.host,
    });
    await registerAndAssignRole(
      store,
      bffApp,
      tenantDemo,
      "zoe@demo.test",
      csrf.cookies,
    );

    const res = await jsonRequest(bffApp, "/api/org/members?q=bob", {
      host: tenantDemo.host,
      cookies: demoUserACookies,
    });
    expect(res.status).toBe(200);
    const members = res.body.members as Array<{ email: string }>;
    expect(members).toHaveLength(1);
    expect(members[0]?.email).toBe("bob@demo.test");
  });
});
