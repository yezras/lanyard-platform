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

describe("bff GET /api/chat/threads/:threadId/shares", () => {
  let store: ControlPlaneStore;
  let bffApp: ReturnType<typeof createApp>;
  let tenant: TenantContext;
  let ownerCookies: Record<string, string> = {};
  let inviteeCookies: Record<string, string> = {};
  let ownerUserId = "";
  let inviteeUserId = "";

  beforeEach(async () => {
    store = await createTestStore();
    const controlPlaneApp = createControlPlaneApp(store, { devOpen: true });

    const createdTenant = await store.createTenant({
      slug: "share-list",
      display_name: "Share List",
    });

    tenant = {
      tenant_id: createdTenant.tenant_id,
      tenant_slug: createdTenant.tenant_slug,
      display_name: createdTenant.display_name,
      host: createdTenant.host,
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
          return slug === tenant.tenant_slug ? tenant : null;
        },
        async resolveById(id: string) {
          return id === tenant.tenant_id ? tenant : null;
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
  });

  afterEach(async () => {
    await store.close();
  });

  it("lists active grants for the thread owner", async () => {
    const threadRes = await jsonRequest(bffApp, "/api/chat/threads", {
      method: "POST",
      host: tenant.host,
      cookies: ownerCookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Listed shares" }),
    });
    expect(threadRes.status).toBe(201);
    const threadId = threadRes.body.thread_id as string;

    const emptyList = await jsonRequest(
      bffApp,
      `/api/chat/threads/${threadId}/shares`,
      {
        host: tenant.host,
        cookies: ownerCookies,
      },
    );
    expect(emptyList.status).toBe(200);
    expect(emptyList.body.thread_id).toBe(threadId);
    expect(emptyList.body.owner_user_id).toBe(ownerUserId);
    expect(emptyList.body.grants).toEqual([]);

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

    const listRes = await jsonRequest(
      bffApp,
      `/api/chat/threads/${threadId}/shares`,
      {
        host: tenant.host,
        cookies: ownerCookies,
      },
    );
    expect(listRes.status).toBe(200);
    const grants = listRes.body.grants as Array<{
      grantee_user_id: string;
      mode: string;
      revoked_at: string | null;
    }>;
    expect(grants).toHaveLength(1);
    expect(grants[0]?.grantee_user_id).toBe(inviteeUserId);
    expect(grants[0]?.mode).toBe("read");
    expect(grants[0]?.revoked_at).toBeNull();
  });

  it("returns 404 when invitee lists owner-only shares route", async () => {
    const threadRes = await jsonRequest(bffApp, "/api/chat/threads", {
      method: "POST",
      host: tenant.host,
      cookies: ownerCookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Private list" }),
    });
    const threadId = threadRes.body.thread_id as string;

    await jsonRequest(bffApp, `/api/chat/threads/${threadId}/shares`, {
      method: "POST",
      host: tenant.host,
      cookies: ownerCookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grantee_email: "invitee@example.com",
        mode: "collaborate",
      }),
    });

    const inviteeList = await jsonRequest(
      bffApp,
      `/api/chat/threads/${threadId}/shares`,
      {
        host: tenant.host,
        cookies: inviteeCookies,
      },
    );
    expect(inviteeList.status).toBe(404);
  });

  it("omits revoked grants from the list after DELETE", async () => {
    const threadRes = await jsonRequest(bffApp, "/api/chat/threads", {
      method: "POST",
      host: tenant.host,
      cookies: ownerCookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Revoke then list" }),
    });
    const threadId = threadRes.body.thread_id as string;

    await jsonRequest(bffApp, `/api/chat/threads/${threadId}/shares`, {
      method: "POST",
      host: tenant.host,
      cookies: ownerCookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grantee_email: "invitee@example.com",
        mode: "read",
      }),
    });

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

    const listRes = await jsonRequest(
      bffApp,
      `/api/chat/threads/${threadId}/shares`,
      {
        host: tenant.host,
        cookies: ownerCookies,
      },
    );
    expect(listRes.status).toBe(200);
    expect(listRes.body.grants).toEqual([]);
  });
});
