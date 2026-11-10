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

describe("bff session sharing integration", () => {
  let store: ControlPlaneStore;
  let controlPlaneApp: ReturnType<typeof createControlPlaneApp>;
  let bffApp: ReturnType<typeof createApp>;
  let tenant: TenantContext;
  let otherTenant: TenantContext;
  let ownerCookies: Record<string, string> = {};
  let inviteeCookies: Record<string, string> = {};
  let outsiderCookies: Record<string, string> = {};
  let ownerUserId = "";
  let inviteeUserId = "";

  beforeEach(async () => {
    store = await createTestStore();
    controlPlaneApp = createControlPlaneApp(store, { devOpen: true });

    const createdTenant = await store.createTenant({
      slug: "sharing",
      display_name: "Sharing",
    });
    const createdOther = await store.createTenant({
      slug: "other-org",
      display_name: "Other Org",
    });

    tenant = {
      tenant_id: createdTenant.tenant_id,
      tenant_slug: createdTenant.tenant_slug,
      display_name: createdTenant.display_name,
      host: createdTenant.host,
    };
    otherTenant = {
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
          if (slug === tenant.tenant_slug) return tenant;
          if (slug === otherTenant.tenant_slug) return otherTenant;
          return null;
        },
        async resolveById(id: string) {
          if (id === tenant.tenant_id) return tenant;
          if (id === otherTenant.tenant_id) return otherTenant;
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

    const csrf = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: tenant.host,
    });

    const owner = await registerAndAssignRole(
      store,
      bffApp,
      tenant,
      "owner@example.com",
      csrf.cookies,
    );
    ownerCookies = owner.cookies;
    ownerUserId = owner.userId;

    const invitee = await registerAndAssignRole(
      store,
      bffApp,
      tenant,
      "invitee@example.com",
      csrf.cookies,
    );
    inviteeCookies = invitee.cookies;
    inviteeUserId = invitee.userId;

    const outsider = await registerAndAssignRole(
      store,
      bffApp,
      tenant,
      "outsider@example.com",
      csrf.cookies,
    );
    outsiderCookies = outsider.cookies;

    // User who only exists on another tenant (for cross-org share isolation).
    const csrfOther = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: otherTenant.host,
    });
    await registerAndAssignRole(
      store,
      bffApp,
      otherTenant,
      "foreign@other-org.test",
      csrfOther.cookies,
    );
  });

  afterEach(async () => {
    await store.close();
  });

  async function createOwnerThread(title: string): Promise<string> {
    const threadRes = await jsonRequest(bffApp, "/api/chat/threads", {
      method: "POST",
      host: tenant.host,
      cookies: ownerCookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
    expect(threadRes.status).toBe(201);
    return threadRes.body.thread_id as string;
  }

  it("shares thread within tenant, lists for invitee, denies outsider, revokes access", async () => {
    const threadId = await createOwnerThread("Shared planning");

    const shareRes = await jsonRequest(
      bffApp,
      `/api/chat/threads/${threadId}/shares`,
      {
        method: "POST",
        host: tenant.host,
        cookies: ownerCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grantee_email: "invitee@example.com",
          mode: "read",
        }),
      },
    );
    expect(shareRes.status).toBe(201);
    expect(shareRes.body.grantee_user_id).toBe(inviteeUserId);
    expect(shareRes.body.owner_user_id).toBe(ownerUserId);

    const inviteeList = await jsonRequest(bffApp, "/api/chat/threads", {
      host: tenant.host,
      cookies: inviteeCookies,
    });
    expect(inviteeList.status).toBe(200);
    const inviteeThreads = inviteeList.body.threads as Array<{
      thread_id: string;
      access: string;
      title: string;
    }>;
    expect(inviteeThreads).toHaveLength(1);
    expect(inviteeThreads[0]?.thread_id).toBe(threadId);
    expect(inviteeThreads[0]?.access).toBe("read");
    expect(inviteeThreads[0]?.title).toBe("Shared planning");

    // Same-tenant outsider never receives unshared (or non-granted) threads.
    const outsiderList = await jsonRequest(bffApp, "/api/chat/threads", {
      host: tenant.host,
      cookies: outsiderCookies,
    });
    expect(outsiderList.status).toBe(200);
    expect(outsiderList.body.threads).toEqual([]);

    const outsiderEvents = await bffApp.request(
      `/api/chat/threads/${threadId}/events`,
      {
        headers: {
          host: tenant.host,
          cookie: cookieHeader(outsiderCookies),
        },
      },
    );
    expect(outsiderEvents.status).toBe(404);

    const readOnlySend = await jsonRequest(
      bffApp,
      `/api/chat/threads/${threadId}/messages`,
      {
        method: "POST",
        host: tenant.host,
        cookies: inviteeCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "should be blocked" }),
      },
    );
    expect(readOnlySend.status).toBe(403);

    const revokeRes = await jsonRequest(
      bffApp,
      `/api/chat/threads/${threadId}/shares/${inviteeUserId}`,
      {
        method: "DELETE",
        host: tenant.host,
        cookies: ownerCookies,
        csrf: true,
      },
    );
    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.revoked_at).toBeTruthy();

    const inviteeListAfterRevoke = await jsonRequest(bffApp, "/api/chat/threads", {
      host: tenant.host,
      cookies: inviteeCookies,
    });
    expect(inviteeListAfterRevoke.status).toBe(200);
    expect(inviteeListAfterRevoke.body.threads).toEqual([]);

    const inviteeEventsAfterRevoke = await bffApp.request(
      `/api/chat/threads/${threadId}/events`,
      {
        headers: {
          host: tenant.host,
          cookie: cookieHeader(inviteeCookies),
        },
      },
    );
    expect(inviteeEventsAfterRevoke.status).toBe(404);
  });

  it("rejects share create for unknown grantee email (non-tenant) with 4xx", async () => {
    const threadId = await createOwnerThread("No such user share");

    const shareRes = await jsonRequest(
      bffApp,
      `/api/chat/threads/${threadId}/shares`,
      {
        method: "POST",
        host: tenant.host,
        cookies: ownerCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grantee_email: "nobody@not-a-tenant.example",
          mode: "read",
        }),
      },
    );
    expect(shareRes.status).toBeGreaterThanOrEqual(400);
    expect(shareRes.status).toBeLessThan(500);
    expect(shareRes.status).toBe(404);
    expect(String(shareRes.body.error ?? shareRes.body.message ?? "")).toMatch(
      /grantee|not found/i,
    );
  });

  it("rejects share create for email that only exists on another tenant", async () => {
    const threadId = await createOwnerThread("Cross-org share attempt");

    const shareRes = await jsonRequest(
      bffApp,
      `/api/chat/threads/${threadId}/shares`,
      {
        method: "POST",
        host: tenant.host,
        cookies: ownerCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grantee_email: "foreign@other-org.test",
          mode: "read",
        }),
      },
    );
    // Grantee lookup is tenant-scoped; foreign email is treated as not found.
    expect(shareRes.status).toBe(404);

    // Confirm no grant leaked into the foreign user's thread list either.
    const foreignCsrf = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: otherTenant.host,
    });
    const foreignLogin = await jsonRequest(bffApp, "/api/auth/login", {
      method: "POST",
      host: otherTenant.host,
      cookies: foreignCsrf.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "foreign@other-org.test",
        password: "password123",
      }),
    });
    expect(foreignLogin.status).toBe(200);

    const foreignList = await jsonRequest(bffApp, "/api/chat/threads", {
      host: otherTenant.host,
      cookies: foreignLogin.cookies,
    });
    expect(foreignList.status).toBe(200);
    expect(foreignList.body.threads).toEqual([]);
  });

  it("allows collaborate mode invitee to post messages", async () => {
    await store.provisionInstance({ tenant_id: tenant.tenant_id });

    const threadId = await createOwnerThread("Collab thread");

    const shareRes = await jsonRequest(
      bffApp,
      `/api/chat/threads/${threadId}/shares`,
      {
        method: "POST",
        host: tenant.host,
        cookies: ownerCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grantee_email: "invitee@example.com",
          mode: "collaborate",
        }),
      },
    );
    expect(shareRes.status).toBe(201);

    const messageRes = await jsonRequest(
      bffApp,
      `/api/chat/threads/${threadId}/messages`,
      {
        method: "POST",
        host: tenant.host,
        cookies: inviteeCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "collaborator message" }),
      },
    );
    expect(messageRes.status).not.toBe(403);
    expect(messageRes.status).not.toBe(404);
  });
});