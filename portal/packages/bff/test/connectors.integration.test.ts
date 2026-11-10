import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp as createControlPlaneApp } from "../../control-plane/src/app.js";
import type { GoogleWorkspaceTokenGrant } from "../../control-plane/src/google-workspace-oauth.js";
import { ControlPlaneStore } from "../../control-plane/src/store.js";
import { createTestStore } from "../../control-plane/test/pg-test-store.js";
import { createApp } from "../src/app.js";
import { CONNECTOR_SPA_FORBIDDEN_KEYS } from "../src/connectors.js";
import { ControlPlaneAuthClient } from "../src/control-plane-client.js";
import { OPS_SESSION_COOKIE, verifyOAuthState } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import {
  cookieHeader,
  createTestBindings,
  parseSetCookie,
} from "./test-helpers.js";

type JsonBody = Record<string, unknown>;

const SECRET_REFRESH = "rtok-secret-do-not-leak";

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
  raw: string;
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
  const raw = await response.text();
  const body = JSON.parse(raw) as JsonBody;
  const cookies = {
    ...init.cookies,
    ...parseSetCookie(response.headers.get("set-cookie")),
  };
  return { status: response.status, body, raw, cookies };
}

function assertNoSecrets(raw: string, body: JsonBody): void {
  expect(raw).not.toContain(SECRET_REFRESH);
  expect(raw).not.toContain("atok-secret");
  for (const key of CONNECTOR_SPA_FORBIDDEN_KEYS) {
    expect(body).not.toHaveProperty(key);
    expect(raw.includes(`"${key}"`)).toBe(false);
  }
}

describe("bff connector APIs fail-closed to tenant session (lp-xhf4.3)", () => {
  let store: ControlPlaneStore;
  let bffApp: ReturnType<typeof createApp>;
  let googleGrant: GoogleWorkspaceTokenGrant;
  let tenantDemo: TenantContext;
  let tenantOther: TenantContext;
  let memberCookies: Record<string, string> = {};
  let adminCookies: Record<string, string> = {};
  let otherCookies: Record<string, string> = {};
  let memberUserId = "";
  let adminUserId = "";
  let memberRoleId = "";
  let adminRoleId = "";

  beforeEach(async () => {
    store = await createTestStore();
    googleGrant = {
      access_token: "atok-secret",
      refresh_token: SECRET_REFRESH,
      expiry: "2099-01-01T00:00:00.000Z",
      scopes: [
        "openid",
        "email",
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.compose",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/drive",
      ],
      email: "alice@gmail.com",
    };
    const controlPlaneApp = createControlPlaneApp(store, {
      devOpen: true,
      googleAuth: {
        clientId: "test-google-client-id",
        exchangeWorkspaceCode: async () => googleGrant,
      },
      connectorOauth: {
        revokeOauth: async () => undefined,
        refreshOauth: async () => {
          throw new Error("invalid_grant");
        },
      },
    });

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

    bffApp = createApp(
      createTestBindings(
        {
          demo: tenantDemo,
          other: tenantOther,
        },
        { authClient },
      ),
    );

    const memberRole = await store.createRole({
      tenant_id: tenantDemo.tenant_id,
      name: "member",
      hermes_profile: "contributor",
      path_prefixes: ["/"],
    });
    const adminRole = await store.createRole({
      tenant_id: tenantDemo.tenant_id,
      name: "admin",
      hermes_profile: "admin",
      path_prefixes: ["/"],
    });
    memberRoleId = memberRole.role_id;
    adminRoleId = adminRole.role_id;

    const csrfDemo = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: tenantDemo.host,
    });
    const memberReg = await jsonRequest(bffApp, "/api/auth/register", {
      method: "POST",
      host: tenantDemo.host,
      cookies: csrfDemo.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "alice@demo.test",
        password: "password123",
      }),
    });
    expect(memberReg.status).toBe(201);
    memberUserId = memberReg.body.user_id as string;
    memberCookies = memberReg.cookies;
    await store.setUserRoles({
      tenant_id: tenantDemo.tenant_id,
      user_id: memberUserId,
      role_ids: [memberRoleId],
    });

    const adminCsrf = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: tenantDemo.host,
    });
    const adminReg = await jsonRequest(bffApp, "/api/auth/register", {
      method: "POST",
      host: tenantDemo.host,
      cookies: adminCsrf.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "admin@demo.test",
        password: "password123",
      }),
    });
    expect(adminReg.status).toBe(201);
    adminUserId = adminReg.body.user_id as string;
    adminCookies = adminReg.cookies;
    await store.setUserRoles({
      tenant_id: tenantDemo.tenant_id,
      user_id: adminUserId,
      role_ids: [adminRoleId],
    });

    const csrfOther = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: tenantOther.host,
    });
    const otherReg = await jsonRequest(bffApp, "/api/auth/register", {
      method: "POST",
      host: tenantOther.host,
      cookies: csrfOther.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "bob@other.test",
        password: "password123",
      }),
    });
    expect(otherReg.status).toBe(201);
    otherCookies = otherReg.cookies;

    await store.upsertTenantConnectorEntitlement({
      tenant_id: tenantDemo.tenant_id,
      connector_id: "google",
      enabled: true,
    });
    await store.setPersonConnectorGrant({
      tenant_id: tenantDemo.tenant_id,
      user_id: memberUserId,
      connector_id: "google",
      granted: true,
    });
    await store.upsertRoleConnectorGrant({
      tenant_id: tenantDemo.tenant_id,
      role_id: memberRoleId,
      connector_id: "google",
      enabled: true,
    });
    await store.upsertUserConnectorConnection({
      tenant_id: tenantDemo.tenant_id,
      user_id: memberUserId,
      connector_id: "google",
      status: "connected",
      account_label: "alice@gmail.com",
      sticky: { "gmail.read": true },
      secrets: {
        oauth_refresh: SECRET_REFRESH,
        oauth_access: "atok-secret",
        oauth_expiry: "2026-08-21T01:00:00.000Z",
        oauth_scopes: ["gmail.readonly"],
        whatsapp_session_db: null,
      },
    });
  });

  afterEach(async () => {
    await store.close();
  });

  it("GET /api/connectors returns the current user's status without secrets", async () => {
    const anonymous = await jsonRequest(bffApp, "/api/connectors", {
      host: tenantDemo.host,
    });
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toEqual({ error: "Not authenticated" });

    const res = await jsonRequest(bffApp, "/api/connectors", {
      host: tenantDemo.host,
      cookies: memberCookies,
    });
    expect(res.status).toBe(200);
    assertNoSecrets(res.raw, res.body);
    const connectors = res.body.connectors as Array<Record<string, unknown>>;
    expect(connectors.map((c) => c.connector_id)).toEqual(["google"]);
    expect(connectors[0]).toMatchObject({
      connector_id: "google",
      label: "Google",
      status: "connected",
      account_label: "alice@gmail.com",
      sticky: { "gmail.read": true },
      entitled: true,
      role_granted: true,
    });
    expect(connectors.some((c) => c.connector_id === "hubspot")).toBe(false);
  });

  it("lists a granted registry connector and hides ungranted ones", async () => {
    const slackSnapshot = {
      version: 1 as const,
      source: "integrations.sh" as const,
      domain: "slack.com",
      compiled_at: "2026-08-26T00:00:00.000Z",
      runnability: "runnable" as const,
      surfaces: [
        {
          kind: "mcp" as const,
          slug: "mcp",
          label: "MCP",
          runnability: "runnable" as const,
          initialize_url: "https://mcp.slack.com",
          transport: "streamable-http" as const,
          auth_kind: "oauth",
        },
      ],
    };
    await store.insertCanonicalConnector({
      id: "slack",
      domain: "slack.com",
      label: "Slack",
      source: "integrations.sh",
      source_entry_id: "integrations.sh:slack.com",
      snapshot: slackSnapshot,
    });
    await store.insertCanonicalConnector({
      id: "stripe",
      domain: "stripe.com",
      label: "Stripe",
      source: "integrations.sh",
      source_entry_id: "integrations.sh:stripe.com",
      snapshot: { ...slackSnapshot, domain: "stripe.com" },
    });
    const slackId = await store.parseConnectorId("slack");
    const stripeId = await store.parseConnectorId("stripe");
    await store.upsertTenantConnectorEntitlement({
      tenant_id: tenantDemo.tenant_id,
      connector_id: slackId,
      enabled: true,
      surfaces: ["mcp"],
    });
    await store.upsertTenantConnectorEntitlement({
      tenant_id: tenantDemo.tenant_id,
      connector_id: stripeId,
      enabled: true,
      surfaces: ["mcp"],
    });
    await store.setPersonConnectorGrant({
      tenant_id: tenantDemo.tenant_id,
      user_id: memberUserId,
      connector_id: "slack",
      granted: true,
    });

    const res = await jsonRequest(bffApp, "/api/connectors", {
      host: tenantDemo.host,
      cookies: memberCookies,
    });
    expect(res.status).toBe(200);
    const connectors = res.body.connectors as Array<Record<string, unknown>>;
    expect(connectors.map((c) => c.connector_id)).toEqual(["google", "slack"]);
    expect(connectors.find((c) => c.connector_id === "slack")).toMatchObject({
      connector_id: "slack",
      label: "Slack",
      status: "not_connected",
      entitled: true,
      role_granted: true,
    });
    expect(connectors.some((c) => c.connector_id === "stripe")).toBe(false);
  });

  it("tenant mismatch is unauthenticated, not a 403 leak", async () => {
    const res = await jsonRequest(bffApp, "/api/connectors", {
      host: tenantDemo.host,
      cookies: otherCookies,
    });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
    expect(res.raw).not.toContain(SECRET_REFRESH);
    expect(res.raw).not.toContain("alice@gmail.com");
  });

  it("GET team status is admin-only and hides secrets", async () => {
    const denied = await jsonRequest(bffApp, "/api/connectors/team", {
      host: tenantDemo.host,
      cookies: memberCookies,
    });
    expect(denied.status).toBe(403);

    const res = await jsonRequest(bffApp, "/api/connectors/team", {
      host: tenantDemo.host,
      cookies: adminCookies,
    });
    expect(res.status).toBe(200);
    assertNoSecrets(res.raw, res.body);
    const members = res.body.members as Array<{
      user_id: string;
      email: string;
      connectors: Array<{
        connector_id: string;
        status: string;
        account_label: string | null;
      }>;
    }>;
    expect(members.map((m) => m.user_id).sort()).toEqual(
      [adminUserId, memberUserId].sort(),
    );
    const alice = members.find((m) => m.user_id === memberUserId);
    expect(alice?.email).toBe("alice@demo.test");
    expect(
      alice?.connectors.find((c) => c.connector_id === "google"),
    ).toMatchObject({
      connector_id: "google",
      status: "connected",
      account_label: "alice@gmail.com",
    });
    const grants = res.body.grants as Array<{
      role_id: string;
      connector_id: string;
      enabled: boolean;
    }>;
    expect(
      grants.find(
        (g) => g.role_id === memberRoleId && g.connector_id === "google",
      )?.enabled,
    ).toBe(true);
    expect(res.body.hubspot_portal_id).toBeNull();
  });

  it("PUT role grants requires CSRF and tenant admin", async () => {
    const noCsrf = await jsonRequest(bffApp, "/api/connectors/grants", {
      method: "PUT",
      host: tenantDemo.host,
      cookies: adminCookies,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        role_id: memberRoleId,
        connector_id: "hubspot",
        enabled: true,
      }),
    });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error).toMatch(/CSRF/i);

    const memberDenied = await jsonRequest(bffApp, "/api/connectors/grants", {
      method: "PUT",
      host: tenantDemo.host,
      cookies: memberCookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        role_id: memberRoleId,
        connector_id: "hubspot",
        enabled: true,
      }),
    });
    expect(memberDenied.status).toBe(403);

    const mismatch = await jsonRequest(bffApp, "/api/connectors/grants", {
      method: "PUT",
      host: tenantDemo.host,
      cookies: otherCookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        role_id: memberRoleId,
        connector_id: "hubspot",
        enabled: true,
      }),
    });
    expect(mismatch.status).toBe(401);
    expect(mismatch.body).toEqual({ error: "Not authenticated" });

    const ok = await jsonRequest(bffApp, "/api/connectors/grants", {
      method: "PUT",
      host: tenantDemo.host,
      cookies: adminCookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        role_id: memberRoleId,
        connector_id: "hubspot",
        enabled: true,
      }),
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({
      role_id: memberRoleId,
      connector_id: "hubspot",
      enabled: true,
    });
    assertNoSecrets(ok.raw, ok.body);

    const googleGrant = await jsonRequest(bffApp, "/api/connectors/grants", {
      method: "PUT",
      host: tenantDemo.host,
      cookies: adminCookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        role_id: memberRoleId,
        connector_id: "google",
        enabled: false,
      }),
    });
    expect(googleGrant.status).toBe(200);
    expect(googleGrant.body).toEqual({
      role_id: memberRoleId,
      connector_id: "google",
      enabled: false,
    });

    const whatsappGrant = await jsonRequest(bffApp, "/api/connectors/grants", {
      method: "PUT",
      host: tenantDemo.host,
      cookies: adminCookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        role_id: adminRoleId,
        connector_id: "whatsapp",
        enabled: true,
      }),
    });
    expect(whatsappGrant.status).toBe(200);
    expect(whatsappGrant.body).toEqual({
      role_id: adminRoleId,
      connector_id: "whatsapp",
      enabled: true,
    });
  });

  it("HubSpot pin clear is admin-only, keeps entitlement, never returns secrets", async () => {
    await store.upsertTenantConnectorEntitlement({
      tenant_id: tenantDemo.tenant_id,
      connector_id: "hubspot",
      enabled: true,
      hubspot_portal_id: "123456",
    });

    const memberDenied = await jsonRequest(bffApp, "/api/connectors/hubspot/pin", {
      method: "PUT",
      host: tenantDemo.host,
      cookies: memberCookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hubspot_portal_id: null }),
    });
    expect(memberDenied.status).toBe(403);

    const noCsrf = await jsonRequest(bffApp, "/api/connectors/hubspot/pin", {
      method: "PUT",
      host: tenantDemo.host,
      cookies: adminCookies,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hubspot_portal_id: null }),
    });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error).toMatch(/CSRF/i);

    const setRejected = await jsonRequest(bffApp, "/api/connectors/hubspot/pin", {
      method: "PUT",
      host: tenantDemo.host,
      cookies: adminCookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hubspot_portal_id: "999" }),
    });
    expect(setRejected.status).toBe(400);

    const teamBefore = await jsonRequest(bffApp, "/api/connectors/team", {
      host: tenantDemo.host,
      cookies: adminCookies,
    });
    expect(teamBefore.status).toBe(200);
    expect(teamBefore.body.hubspot_portal_id).toBe("123456");
    assertNoSecrets(teamBefore.raw, teamBefore.body);

    const cleared = await jsonRequest(bffApp, "/api/connectors/hubspot/pin", {
      method: "PUT",
      host: tenantDemo.host,
      cookies: adminCookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hubspot_portal_id: null }),
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toEqual({ hubspot_portal_id: null });
    assertNoSecrets(cleared.raw, cleared.body);

    const teamAfter = await jsonRequest(bffApp, "/api/connectors/team", {
      host: tenantDemo.host,
      cookies: adminCookies,
    });
    expect(teamAfter.body.hubspot_portal_id).toBeNull();
    const entitlement = await store.getTenantConnectorEntitlement(
      tenantDemo.tenant_id,
      "hubspot",
    );
    expect(entitlement?.enabled).toBe(true);
    expect(entitlement?.hubspot_portal_id).toBeNull();
  });

  it("ops cookie cannot start tenant user OAuth", async () => {
    const csrfOnly = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: tenantDemo.host,
    });
    const unauthenticated = await jsonRequest(
      bffApp,
      "/api/connectors/google/oauth/start",
      {
        method: "POST",
        host: tenantDemo.host,
        cookies: csrfOnly.cookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(unauthenticated.status).toBe(401);

    const noCsrf = await jsonRequest(
      bffApp,
      "/api/connectors/google/oauth/start",
      {
        method: "POST",
        host: tenantDemo.host,
        cookies: memberCookies,
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(noCsrf.status).toBe(403);

    const opsOnly = await jsonRequest(
      bffApp,
      "/api/connectors/google/oauth/start",
      {
        method: "POST",
        host: tenantDemo.host,
        cookies: {
          [OPS_SESSION_COOKIE]: "ops-session-not-a-tenant-user",
          lanyard_csrf: memberCookies.lanyard_csrf ?? "csrf",
        },
        csrf: true,
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(opsOnly.status).toBe(401);
    expect(opsOnly.body).toEqual({ error: "Not authenticated" });

    const opsPlusTenant = await jsonRequest(
      bffApp,
      "/api/connectors/google/oauth/start",
      {
        method: "POST",
        host: tenantDemo.host,
        cookies: {
          ...memberCookies,
          [OPS_SESSION_COOKIE]: "ops-session-not-a-tenant-user",
        },
        csrf: true,
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(opsPlusTenant.status).toBe(401);
    expect(opsPlusTenant.body).toEqual({ error: "Not authenticated" });

    const started = await jsonRequest(
      bffApp,
      "/api/connectors/google/oauth/start",
      {
        method: "POST",
        host: tenantDemo.host,
        cookies: memberCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ thread_id: "th-chat-1" }),
      },
    );
    expect(started.status).toBe(200);
    expect(started.body.connector_id).toBe("google");
    const url = String(started.body.url ?? "");
    expect(url).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    const startedUrl = new URL(url);
    expect(startedUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(startedUrl.searchParams.get("access_type")).toBe("offline");
    const scope = startedUrl.searchParams.get("scope") ?? "";
    expect(scope).toContain("gmail.send");
    expect(scope).toContain("calendar.events");
    expect(scope).toContain("https://www.googleapis.com/auth/drive");
    expect(scope).not.toContain("drive.file");
    const state = startedUrl.searchParams.get("state");
    expect(state).toBeTruthy();
    const payload = verifyOAuthState(state ?? "", "test-session-secret");
    expect(payload).toMatchObject({
      kind: "connector_oauth",
      connector_id: "google",
      tenant_id: tenantDemo.tenant_id,
      user_id: memberUserId,
      thread_id: "th-chat-1",
    });
    expect(payload?.code_verifier).toBeTruthy();
    expect(payload?.redirect_uri).toContain(
      "/api/connectors/google/oauth/callback",
    );
    expect(started.raw).not.toContain(payload?.code_verifier);

    const whatsapp = await jsonRequest(
      bffApp,
      "/api/connectors/whatsapp/oauth/start",
      {
        method: "POST",
        host: tenantDemo.host,
        cookies: memberCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(whatsapp.status).toBe(400);
  });

  it("callback writes CP, hides refresh, rejects ops cookie and wrong-user state", async () => {
    const refresh = "google-refresh-token-plain";
    googleGrant = {
      access_token: "atok-secret",
      refresh_token: refresh,
      expiry: "2099-01-01T00:00:00.000Z",
      scopes: [
        "openid",
        "email",
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.compose",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/drive",
      ],
      email: "alice@gmail.com",
    };

    const started = await jsonRequest(
      bffApp,
      "/api/connectors/google/oauth/start",
      {
        method: "POST",
        host: tenantDemo.host,
        cookies: memberCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(started.status).toBe(200);
    const startUrl = new URL(String(started.body.url));
    const state = startUrl.searchParams.get("state") ?? "";
    const callbackPath = `/api/connectors/google/oauth/callback?code=fake-code&state=${encodeURIComponent(state)}`;

    const opsDenied = await jsonRequest(bffApp, callbackPath, {
      host: tenantDemo.host,
      cookies: {
        [OPS_SESSION_COOKIE]: "ops-session-not-a-tenant-user",
      },
      headers: { accept: "application/json" },
    });
    expect(opsDenied.status).toBe(401);

    const wrongUser = await jsonRequest(bffApp, callbackPath, {
      host: tenantDemo.host,
      cookies: adminCookies,
      headers: { accept: "application/json" },
    });
    expect(wrongUser.status).toBe(401);
    expect(wrongUser.raw).not.toContain(refresh);

    const ok = await jsonRequest(bffApp, callbackPath, {
      host: tenantDemo.host,
      cookies: memberCookies,
      headers: { accept: "application/json" },
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      connector_id: "google",
      status: "connected",
      account_label: "alice@gmail.com",
    });
    assertNoSecrets(ok.raw, ok.body);
    expect(ok.raw).not.toContain(refresh);

    const html = await bffApp.request(callbackPath, {
      headers: {
        host: tenantDemo.host,
        cookie: cookieHeader(memberCookies),
        accept: "text/html",
      },
    });
    const htmlBody = await html.text();
    expect(html.status).toBe(200);
    expect(htmlBody).toContain("You can close this tab.");
    expect(htmlBody).not.toContain(refresh);

    const listed = await jsonRequest(bffApp, "/api/connectors", {
      host: tenantDemo.host,
      cookies: memberCookies,
    });
    const google = (
      listed.body.connectors as Array<Record<string, unknown>>
    ).find((row) => row.connector_id === "google");
    expect(google).toMatchObject({
      status: "connected",
      account_label: "alice@gmail.com",
    });
    expect(listed.raw).not.toContain(refresh);

    const secrets = await store.getUserConnectorSecrets(
      tenantDemo.tenant_id,
      memberUserId,
      "google",
    );
    expect(secrets.oauth_refresh).toBe(refresh);
    expect(secrets.oauth_access).toBe("atok-secret");
  });

  it("bare APP_HOST google callback resolves tenant from signed state (lp-xhf4.18)", async () => {
    googleGrant = {
      access_token: "atok-secret",
      refresh_token: "google-refresh-token-plain",
      expiry: "2099-01-01T00:00:00.000Z",
      scopes: [
        "openid",
        "email",
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.compose",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/drive",
      ],
      email: "alice@gmail.com",
    };

    const started = await jsonRequest(
      bffApp,
      "/api/connectors/google/oauth/start",
      {
        method: "POST",
        host: tenantDemo.host,
        cookies: memberCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(started.status).toBe(200);
    const startUrl = new URL(String(started.body.url));
    const state = startUrl.searchParams.get("state") ?? "";
    const qs = `code=fake-code&state=${encodeURIComponent(state)}`;

    const spoofed = await jsonRequest(
      bffApp,
      `/other/api/connectors/google/oauth/callback?${qs}`,
      {
        host: "app.withlanyard.com",
        cookies: otherCookies,
        headers: { accept: "application/json" },
      },
    );
    expect(spoofed.status).toBe(401);
    expect(spoofed.body).toEqual({ error: "Invalid OAuth state" });

    const ok = await jsonRequest(
      bffApp,
      `/api/connectors/google/oauth/callback?${qs}`,
      {
        host: "app.withlanyard.com",
        cookies: memberCookies,
        headers: { accept: "application/json" },
      },
    );
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      connector_id: "google",
      status: "connected",
      account_label: "alice@gmail.com",
    });
    expect(ok.body.error).toBeUndefined();
  });

  it("first Gmail tool without a connection returns needs_auth, not 403", async () => {
    const res = await jsonRequest(
      bffApp,
      "/api/connectors/google/chat-use",
      {
        method: "POST",
        host: tenantDemo.host,
        cookies: adminCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          thread_id: "th-gmail-1",
          args: [
            "gws",
            "gmail",
            "users",
            "messages",
            "send",
            "--to",
            "ada@example.com",
            "--subject",
            "Hi",
          ],
        }),
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("needs_auth");
    expect(res.body.connector_id).toBe("google");
    expect(res.body).not.toHaveProperty("error");
    const pending = res.body.pending as Record<string, unknown>;
    expect(pending.tool).toBe("gws");
    expect(pending.args).toEqual([
      "gmail",
      "users",
      "drafts",
      "create",
      "--to",
      "ada@example.com",
      "--subject",
      "Hi",
    ]);
    expect(pending.action_class).toBe("gmail.draft");
    const wizard = res.body.wizard as Record<string, unknown>;
    expect(wizard.portal_event).toBe("needs_auth");
    expect(wizard.mcq_id).toBe("cc-needs_auth-google-th-gmail-1");
    assertNoSecrets(res.raw, res.body);

    const resume = await jsonRequest(
      bffApp,
      "/api/connectors/google/pending/resume",
      {
        method: "POST",
        host: tenantDemo.host,
        cookies: adminCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(resume.status).toBe(200);
    expect(resume.body).toMatchObject({
      kind: "resume",
      connector_id: "google",
      tool: "gws",
      args: [
        "gmail",
        "users",
        "drafts",
        "create",
        "--to",
        "ada@example.com",
        "--subject",
        "Hi",
      ],
      thread_id: "th-gmail-1",
    });
    assertNoSecrets(resume.raw, resume.body);
  });

  it("page OAuth start does not store a pending tool", async () => {
    const started = await jsonRequest(
      bffApp,
      "/api/connectors/google/oauth/start",
      {
        method: "POST",
        host: tenantDemo.host,
        cookies: adminCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(started.status).toBe(200);
    const resume = await jsonRequest(
      bffApp,
      "/api/connectors/google/pending/resume",
      {
        method: "POST",
        host: tenantDemo.host,
        cookies: adminCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(resume.body).toMatchObject({
      kind: "connected_no_resume",
      reason: "missing",
    });
  });

  it("cancel does not auto-send the stored tool", async () => {
    const created = await jsonRequest(
      bffApp,
      "/api/connectors/google/chat-use",
      {
        method: "POST",
        host: tenantDemo.host,
        cookies: adminCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          thread_id: "th-gmail-cancel",
          args: ["gws", "gmail", "users", "drafts", "create"],
        }),
      },
    );
    expect(created.body.kind).toBe("needs_auth");
    const cancelled = await jsonRequest(
      bffApp,
      "/api/connectors/google/pending/cancel",
      {
        method: "POST",
        host: tenantDemo.host,
        cookies: adminCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({
      kind: "connected_no_resume",
      reason: "cancelled",
      message: "Google connected. The pending tool was not sent.",
    });
    const resume = await jsonRequest(
      bffApp,
      "/api/connectors/google/pending/resume",
      {
        method: "POST",
        host: tenantDemo.host,
        cookies: adminCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(resume.body.kind).toBe("connected_no_resume");
  });

  it("connected Gmail tool is ready, not a wizard", async () => {
    const res = await jsonRequest(
      bffApp,
      "/api/connectors/google/chat-use",
      {
        method: "POST",
        host: tenantDemo.host,
        cookies: memberCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          thread_id: "th-already",
          args: ["gws", "gmail", "users", "drafts", "create"],
        }),
      },
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ kind: "ready", connector_id: "google" });
  });

  it("POST disconnect removes the google row without leaking secrets", async () => {
    const res = await jsonRequest(
      bffApp,
      "/api/connectors/google/disconnect",
      {
        method: "POST",
        host: tenantDemo.host,
        cookies: memberCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      connector_id: "google",
      status: "not_connected",
      revoke_attempted: true,
    });
    assertNoSecrets(res.raw, res.body);

    const listed = await jsonRequest(bffApp, "/api/connectors", {
      host: tenantDemo.host,
      cookies: memberCookies,
    });
    const google = (
      listed.body.connectors as Array<Record<string, unknown>>
    ).find((row) => row.connector_id === "google");
    expect(google?.status).toBe("not_connected");
  });

  it("POST refresh fail returns needs_reauth wizard and keeps the row", async () => {
    const res = await jsonRequest(bffApp, "/api/connectors/google/refresh", {
      method: "POST",
      host: tenantDemo.host,
      cookies: memberCookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      connector_id: "google",
      status: "needs_reauth",
      wizard: true,
      account_label: "alice@gmail.com",
    });
    assertNoSecrets(res.raw, res.body);

    const listed = await jsonRequest(bffApp, "/api/connectors", {
      host: tenantDemo.host,
      cookies: memberCookies,
    });
    const google = (
      listed.body.connectors as Array<Record<string, unknown>>
    ).find((row) => row.connector_id === "google");
    expect(google?.status).toBe("needs_reauth");
    expect(google?.account_label).toBe("alice@gmail.com");
  });

  it("admin grant off google does not drop the member connection (not ACL)", async () => {
    const off = await jsonRequest(bffApp, "/api/connectors/grants", {
      method: "PUT",
      host: tenantDemo.host,
      cookies: adminCookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        role_id: memberRoleId,
        connector_id: "google",
        enabled: false,
      }),
    });
    expect(off.status).toBe(200);
    expect(off.body).toEqual({
      role_id: memberRoleId,
      connector_id: "google",
      enabled: false,
    });

    const listed = await jsonRequest(bffApp, "/api/connectors", {
      host: tenantDemo.host,
      cookies: memberCookies,
    });
    const google = (
      listed.body.connectors as Array<Record<string, unknown>>
    ).find((row) => row.connector_id === "google");
    expect(google?.status).toBe("connected");
    expect(google?.role_granted).toBe(true);
  });
});
