import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { APP_HOST } from "@lanyard/shared";

import { createApp as createControlPlaneApp } from "../../control-plane/src/app.js";
import { ControlPlaneStore } from "../../control-plane/src/store.js";
import { createTestStore } from "../../control-plane/test/pg-test-store.js";
import { createApp } from "../src/app.js";
import { CONNECTOR_SPA_FORBIDDEN_KEYS } from "../src/connectors.js";
import { ControlPlaneAuthClient } from "../src/control-plane-client.js";
import { MemoryOperatorDirectory } from "../src/operator-directory.js";
import { MemoryOpsSessionStore } from "../src/ops-session.js";
import { OPS_SESSION_COOKIE, SESSION_COOKIE } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import {
  cookieHeader,
  createTestBindings,
  parseSetCookie,
} from "./test-helpers.js";

type JsonBody = Record<string, unknown>;

const SECRET_REFRESH = "ops-entitle-refresh-secret";

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

describe("ops connector entitlements (lp-xhf4.14)", () => {
  let store: ControlPlaneStore;
  let bffApp: ReturnType<typeof createApp>;
  let tenantDemo: TenantContext;
  let tenantOther: TenantContext;
  let memberCookies: Record<string, string> = {};
  let memberUserId = "";

  beforeEach(async () => {
    store = await createTestStore();
    const controlPlaneApp = createControlPlaneApp(store, { devOpen: true });

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
        {
          authClient,
          opsSessions: new MemoryOpsSessionStore(),
          operatorDirectory: new MemoryOperatorDirectory([operator]),
          devTenantSlug: "demo",
        },
      ),
    );

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

    await store.upsertTenantConnectorEntitlement({
      tenant_id: tenantDemo.tenant_id,
      connector_id: "google",
      enabled: true,
    });
    await store.upsertUserConnectorConnection({
      tenant_id: tenantDemo.tenant_id,
      user_id: memberUserId,
      connector_id: "google",
      status: "connected",
      account_label: "alice@gmail.com",
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

  it("rejects a tenant cookie on the ops catalog and toggle", async () => {
    const list = await jsonRequest(bffApp, "/api/admin/connectors", {
      host: APP_HOST,
      cookies: memberCookies,
    });
    expect(list.status).toBe(401);
    expect(list.body).toEqual({ error: "Not authenticated" });
    expect(list.raw).not.toContain(SECRET_REFRESH);

    const csrf = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: tenantDemo.host,
      cookies: memberCookies,
    });
    const toggle = await jsonRequest(
      bffApp,
      `/api/admin/tenants/${tenantDemo.tenant_id}/connectors/google`,
      {
        method: "PUT",
        host: APP_HOST,
        cookies: csrf.cookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      },
    );
    expect(toggle.status).toBe(401);
    expect(toggle.body).toEqual({ error: "Not authenticated" });

    const still = await store.getUserConnectorConnection(
      tenantDemo.tenant_id,
      memberUserId,
      "google",
    );
    expect(still?.status).toBe("connected");
  });

  it("ops session lists cross-tenant counts and can toggle entitlement", async () => {
    const opsCookies = await opsLogin();
    expect(opsCookies[SESSION_COOKIE]).toBeFalsy();

    const list = await jsonRequest(bffApp, "/api/admin/connectors", {
      host: APP_HOST,
      cookies: opsCookies,
    });
    expect(list.status).toBe(200);
    for (const key of CONNECTOR_SPA_FORBIDDEN_KEYS) {
      expect(list.raw.includes(`"${key}"`)).toBe(false);
    }
    expect(list.raw).not.toContain(SECRET_REFRESH);
    expect(list.raw).not.toContain("alice@gmail.com");
    const tenants = list.body.tenants as Array<{
      tenant_id: string;
      tenant_slug: string;
      connectors: Array<{
        connector_id: string;
        enabled: boolean;
        status_counts: { connected: number };
      }>;
    }>;
    const demo = tenants.find((row) => row.tenant_id === tenantDemo.tenant_id);
    const other = tenants.find((row) => row.tenant_id === tenantOther.tenant_id);
    expect(demo?.connectors.find((c) => c.connector_id === "google")).toEqual({
      connector_id: "google",
      enabled: true,
      status_counts: { connected: 1, pairing: 0, needs_reauth: 0 },
    });
    expect(other?.connectors.every((c) => c.enabled === false)).toBe(true);
    expect(list.body.totals).toMatchObject({
      google: { connected: 1, entitled_tenants: 1 },
    });

    const off = await jsonRequest(
      bffApp,
      `/api/admin/tenants/${tenantDemo.tenant_id}/connectors/google`,
      {
        method: "PUT",
        host: APP_HOST,
        cookies: opsCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      },
    );
    expect(off.status).toBe(200);
    expect(off.body).toEqual({
      tenant_id: tenantDemo.tenant_id,
      connector_id: "google",
      enabled: false,
      surfaces: [],
    });
    expect(off.raw).not.toContain(SECRET_REFRESH);

    const gone = await store.getUserConnectorConnection(
      tenantDemo.tenant_id,
      memberUserId,
      "google",
    );
    expect(gone).toBeNull();

    const after = await jsonRequest(bffApp, "/api/admin/connectors", {
      host: APP_HOST,
      cookies: opsCookies,
    });
    const demoAfter = (
      after.body.tenants as Array<{
        tenant_id: string;
        connectors: Array<{ connector_id: string; enabled: boolean }>;
      }>
    ).find((row) => row.tenant_id === tenantDemo.tenant_id);
    expect(demoAfter?.connectors.find((c) => c.connector_id === "google")?.enabled).toBe(
      false,
    );
  });

  it("onboards a promoted registry connector with surfaces and lists onboarded-only", async () => {
    const opsCookies = await opsLogin();
    await store.insertCanonicalConnector({
      id: "stripe",
      domain: "stripe.com",
      label: "Stripe",
      source: "integrations.sh",
      snapshot: {
        version: 1,
        source: "integrations.sh",
        domain: "stripe.com",
        compiled_at: new Date().toISOString(),
        runnability: "runnable",
        surfaces: [
          {
            kind: "mcp",
            slug: "mcp",
            label: "MCP",
            runnability: "runnable",
            initialize_url: "https://mcp.stripe.com",
            transport: "streamable-http",
            auth_kind: "bearer",
          },
        ],
      },
    });

    const onboard = await jsonRequest(
      bffApp,
      `/api/admin/tenants/${tenantDemo.tenant_id}/connectors/stripe`,
      {
        method: "PUT",
        host: APP_HOST,
        cookies: opsCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ surfaces: ["mcp"] }),
      },
    );
    expect(onboard.status).toBe(200);
    expect(onboard.body).toMatchObject({
      tenant_id: tenantDemo.tenant_id,
      connector_id: "stripe",
      enabled: true,
      surfaces: ["mcp"],
    });

    const listed = await jsonRequest(
      bffApp,
      `/api/admin/tenants/${tenantDemo.tenant_id}/connectors`,
      { host: APP_HOST, cookies: opsCookies },
    );
    expect(listed.status).toBe(200);
    const connectors = listed.body.connectors as Array<{
      connector_id: string;
      surfaces: string[];
    }>;
    expect(connectors.map((row) => row.connector_id).sort()).toEqual([
      "google",
      "stripe",
    ]);
    expect(connectors.find((row) => row.connector_id === "stripe")?.surfaces).toEqual(
      ["mcp"],
    );
  });

  it("ops cookie cannot start tenant connector OAuth", async () => {
    const opsCookies = await opsLogin();
    const start = await jsonRequest(bffApp, "/api/connectors/google/oauth/start", {
      method: "POST",
      host: tenantDemo.host,
      cookies: opsCookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(start.status).toBe(401);
  });
});
