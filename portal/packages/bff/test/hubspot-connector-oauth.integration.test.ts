/**
 * lp-xhf4.10 — BFF HubSpot OAuth start/callback fail-closed to tenant session;
 * pin mismatch 409; grant off is not ACL; clear pin keeps tokens.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp as createControlPlaneApp } from "../../control-plane/src/app.js";
import { HUBSPOT_OAUTH_SCOPES } from "../../control-plane/src/hubspot-oauth.js";
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

const SECRET_REFRESH = "hs-rtok-secret-do-not-leak";
const ACCESS = "hs-atok-secret";
const FULL_SCOPES = [...HUBSPOT_OAUTH_SCOPES];

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
  const accept = headers.get("accept") ?? "application/json";
  headers.set("accept", accept);

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
  expect(raw).not.toContain(ACCESS);
  for (const key of CONNECTOR_SPA_FORBIDDEN_KEYS) {
    expect(body).not.toHaveProperty(key);
  }
}

describe("bff HubSpot connector OAuth (lp-xhf4.10)", () => {
  let store: ControlPlaneStore;
  let bffApp: ReturnType<typeof createApp>;
  let tenantDemo: TenantContext;
  let memberCookies: Record<string, string> = {};
  let adminCookies: Record<string, string> = {};
  let memberUserId = "";
  let adminUserId = "";
  let memberRoleId = "";
  let exchangePortal = "62515";

  beforeEach(async () => {
    store = await createTestStore();
    exchangePortal = "62515";
    const controlPlaneApp = createControlPlaneApp(store, {
      devOpen: true,
      hubspotAuth: {
        clientId: "lanyard-hubspot-app",
        exchangeCode: async () => ({
          access_token: ACCESS,
          refresh_token: SECRET_REFRESH,
          expiry: "2099-01-01T00:00:00.000Z",
          scopes: FULL_SCOPES,
          email: "alice@hub.test",
          portal_id: exchangePortal,
        }),
      },
    });

    const createdDemo = await store.createTenant({
      slug: "demo",
      display_name: "Demo",
    });
    tenantDemo = {
      tenant_id: createdDemo.tenant_id,
      tenant_slug: createdDemo.tenant_slug,
      display_name: createdDemo.display_name,
      host: createdDemo.host,
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
        { demo: tenantDemo },
        { authClient, appHosts: ["demo.localhost", tenantDemo.host] },
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
      role_ids: [adminRole.role_id],
    });

    await store.upsertTenantConnectorEntitlement({
      tenant_id: tenantDemo.tenant_id,
      connector_id: "hubspot",
      enabled: true,
    });
    await store.upsertRoleConnectorGrant({
      tenant_id: tenantDemo.tenant_id,
      role_id: memberRoleId,
      connector_id: "hubspot",
      enabled: true,
    });
    await store.upsertRoleConnectorGrant({
      tenant_id: tenantDemo.tenant_id,
      role_id: adminRole.role_id,
      connector_id: "hubspot",
      enabled: true,
    });
  });

  afterEach(async () => {
    await store.close();
  });

  async function startOAuth(cookies: Record<string, string>): Promise<{
    status: number;
    body: JsonBody;
    raw: string;
    state: string | null;
    url: string;
  }> {
    const started = await jsonRequest(
      bffApp,
      "/api/connectors/hubspot/oauth/start",
      {
        method: "POST",
        host: tenantDemo.host,
        cookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    const url = String(started.body.url ?? "");
    const state = url
      ? new URL(url, "http://demo.localhost").searchParams.get("state")
      : null;
    return { ...started, state, url };
  }

  it("starts HubSpot OAuth with CRM scopes and PKCE", async () => {
    const started = await startOAuth(memberCookies);
    expect(started.status).toBe(200);
    expect(started.body.connector_id).toBe("hubspot");
    expect(started.url).toContain("https://app.hubspot.com/oauth/authorize");
    const parsed = new URL(started.url);
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    const scope = parsed.searchParams.get("scope") ?? "";
    expect(scope).toContain("crm.objects.contacts.write");
    expect(scope).toContain("crm.objects.deals.read");
    expect(scope).not.toContain("settings");
    const payload = verifyOAuthState(
      started.state ?? "",
      "test-session-secret",
    );
    expect(payload).toMatchObject({
      kind: "connector_oauth",
      connector_id: "hubspot",
      tenant_id: tenantDemo.tenant_id,
      user_id: memberUserId,
    });
    expect(started.raw).not.toContain(payload?.code_verifier);
    assertNoSecrets(started.raw, started.body);
  });

  it("callback writes CP and omits refresh; ops cookie and wrong user fail closed", async () => {
    const started = await startOAuth(memberCookies);
    expect(started.status).toBe(200);

    const opsDenied = await jsonRequest(
      bffApp,
      `/api/connectors/hubspot/oauth/callback?code=auth-code&state=${encodeURIComponent(started.state ?? "")}`,
      {
        host: tenantDemo.host,
        cookies: {
          [OPS_SESSION_COOKIE]: "ops-session-not-a-tenant-user",
          lanyard_csrf: memberCookies.lanyard_csrf ?? "csrf",
        },
      },
    );
    expect(opsDenied.status).toBe(401);

    const wrongUser = await jsonRequest(
      bffApp,
      `/api/connectors/hubspot/oauth/callback?code=auth-code&state=${encodeURIComponent(started.state ?? "")}`,
      {
        host: tenantDemo.host,
        cookies: adminCookies,
      },
    );
    expect(wrongUser.status).toBe(401);

    const connected = await jsonRequest(
      bffApp,
      `/api/connectors/hubspot/oauth/callback?code=auth-code&state=${encodeURIComponent(started.state ?? "")}`,
      {
        host: tenantDemo.host,
        cookies: memberCookies,
      },
    );
    expect(connected.status).toBe(200);
    expect(connected.body).toMatchObject({
      connector_id: "hubspot",
      status: "connected",
      account_label: "alice@hub.test (62515)",
    });
    assertNoSecrets(connected.raw, connected.body);

    const secrets = await store.getUserConnectorSecrets(
      tenantDemo.tenant_id,
      memberUserId,
      "hubspot",
    );
    expect(secrets.oauth_refresh).toBe(SECRET_REFRESH);
  });

  it("bare APP_HOST hubspot callback resolves tenant from signed state (lp-xhf4.18)", async () => {
    const started = await startOAuth(memberCookies);
    expect(started.status).toBe(200);
    const connected = await jsonRequest(
      bffApp,
      `/api/connectors/hubspot/oauth/callback?code=auth-code&state=${encodeURIComponent(started.state ?? "")}`,
      {
        host: "app.withlanyard.com",
        cookies: memberCookies,
        headers: { accept: "application/json" },
      },
    );
    expect(connected.status).toBe(200);
    expect(connected.body).toMatchObject({
      connector_id: "hubspot",
      status: "connected",
      account_label: "alice@hub.test (62515)",
    });
  });

  it("second user on the wrong portal is rejected", async () => {
    const firstStart = await startOAuth(memberCookies);
    const first = await jsonRequest(
      bffApp,
      `/api/connectors/hubspot/oauth/callback?code=auth-code&state=${encodeURIComponent(firstStart.state ?? "")}`,
      { host: tenantDemo.host, cookies: memberCookies },
    );
    expect(first.status).toBe(200);
    exchangePortal = "999999";
    const secondStart = await startOAuth(adminCookies);
    const denied = await jsonRequest(
      bffApp,
      `/api/connectors/hubspot/oauth/callback?code=auth-code&state=${encodeURIComponent(secondStart.state ?? "")}`,
      { host: tenantDemo.host, cookies: adminCookies },
    );
    expect(denied.status).toBe(409);
    expect(String(denied.body.error)).toMatch(/does not match tenant pin/);
    assertNoSecrets(denied.raw, denied.body);
    expect(
      await store.getUserConnectorConnection(
        tenantDemo.tenant_id,
        adminUserId,
        "hubspot",
      ),
    ).toBeNull();
  });

  it("clear pin does not delete tokens; grant off is not ACL", async () => {
    const started = await startOAuth(memberCookies);
    const connected = await jsonRequest(
      bffApp,
      `/api/connectors/hubspot/oauth/callback?code=auth-code&state=${encodeURIComponent(started.state ?? "")}`,
      { host: tenantDemo.host, cookies: memberCookies },
    );
    expect(connected.status).toBe(200);

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
    const secrets = await store.getUserConnectorSecrets(
      tenantDemo.tenant_id,
      memberUserId,
      "hubspot",
    );
    expect(secrets.oauth_refresh).toBe(SECRET_REFRESH);

    const off = await jsonRequest(bffApp, "/api/connectors/grants", {
      method: "PUT",
      host: tenantDemo.host,
      cookies: adminCookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        role_id: memberRoleId,
        connector_id: "hubspot",
        enabled: false,
      }),
    });
    expect(off.status).toBe(200);
    expect(
      await store.getUserConnectorConnection(
        tenantDemo.tenant_id,
        memberUserId,
        "hubspot",
      ),
    ).not.toBeNull();
  });
});
