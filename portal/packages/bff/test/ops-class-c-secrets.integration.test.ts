import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { APP_HOST } from "@lanyard/shared";

import { createApp as createControlPlaneApp } from "../../control-plane/src/app.js";
import { fingerprintSecretValue } from "../../control-plane/src/daytona-env-redact.js";
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

const PLAIN = "sk_test_class_c_stripe_live_value";

const operator = {
  operatorId: "op-ops@lanyard.example",
  email: "ops@lanyard.example",
};

const stripeSnapshot = {
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

describe("ops Class C secret routes (lp-hdzm.32)", () => {
  let store: ControlPlaneStore;
  let bffApp: ReturnType<typeof createApp>;
  let tenantDemo: TenantContext;
  let memberCookies: Record<string, string> = {};

  beforeEach(async () => {
    store = await createTestStore();
    const controlPlaneApp = createControlPlaneApp(store, { devOpen: true });

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
    await store.insertCanonicalConnector({
      id: "stripe",
      domain: "stripe.com",
      label: "Stripe",
      source: "integrations.sh",
      snapshot: stripeSnapshot,
    });

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
    memberCookies = memberReg.cookies;
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

  function classCPath(surface = "mcp"): string {
    return `/api/admin/tenants/${tenantDemo.tenant_id}/connectors/stripe/class-c-secrets${
      surface ? `/${surface}` : ""
    }`;
  }

  it("rejects a tenant cookie on the Class C list and write", async () => {
    const list = await jsonRequest(bffApp, classCPath(""), {
      host: APP_HOST,
      cookies: memberCookies,
    });
    expect(list.status).toBe(401);

    const csrf = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: tenantDemo.host,
      cookies: memberCookies,
    });
    const put = await jsonRequest(bffApp, classCPath("mcp"), {
      method: "PUT",
      host: APP_HOST,
      cookies: csrf.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: PLAIN }),
    });
    expect(put.status).toBe(401);
    expect(put.raw).not.toContain(PLAIN);
  });

  it("requires CSRF on the Class C write", async () => {
    const opsCookies = await opsLogin();
    const noCsrf = await jsonRequest(bffApp, classCPath("mcp"), {
      method: "PUT",
      host: APP_HOST,
      cookies: opsCookies,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: PLAIN }),
    });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.raw).not.toContain(PLAIN);
  });

  it("sets a Stripe key, lists fingerprint only, then deletes it", async () => {
    const opsCookies = await opsLogin();

    const emptyList = await jsonRequest(bffApp, classCPath(""), {
      host: APP_HOST,
      cookies: opsCookies,
    });
    expect(emptyList.status).toBe(200);
    const emptySurfaces = emptyList.body.surfaces as Array<{
      surface_id: string;
      present: boolean;
    }>;
    expect(emptySurfaces.map((row) => row.surface_id)).toEqual([
      "mcp",
      "api",
      "cli",
    ]);
    expect(emptySurfaces.every((row) => row.present === false)).toBe(true);
    expect(emptyList.raw).not.toContain(PLAIN);
    expect(emptyList.body).not.toHaveProperty("value");

    const put = await jsonRequest(bffApp, classCPath("mcp"), {
      method: "PUT",
      host: APP_HOST,
      cookies: opsCookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: PLAIN, auth_kind: "bearer" }),
    });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({
      tenant_id: tenantDemo.tenant_id,
      connector_id: "stripe",
      surface_id: "mcp",
      present: true,
      fingerprint: fingerprintSecretValue(PLAIN),
    });
    expect(put.raw).not.toContain(PLAIN);
    expect(put.body).not.toHaveProperty("value");
    expect(JSON.stringify(put.body)).not.toContain(PLAIN);

    const listed = await jsonRequest(bffApp, classCPath(""), {
      host: APP_HOST,
      cookies: opsCookies,
    });
    expect(listed.status).toBe(200);
    const mcp = (
      listed.body.surfaces as Array<{
        surface_id: string;
        present: boolean;
        fingerprint: string | null;
      }>
    ).find((row) => row.surface_id === "mcp");
    expect(mcp).toMatchObject({
      present: true,
      fingerprint: fingerprintSecretValue(PLAIN),
    });
    expect(listed.raw).not.toContain(PLAIN);

    const del = await jsonRequest(bffApp, classCPath("mcp"), {
      method: "DELETE",
      host: APP_HOST,
      cookies: opsCookies,
      csrf: true,
    });
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ ok: true, deleted: true });
    expect(del.raw).not.toContain(PLAIN);
  });

  it("rejects first-class connectors and unknown surfaces before CP", async () => {
    const opsCookies = await opsLogin();
    const google = await jsonRequest(
      bffApp,
      `/api/admin/tenants/${tenantDemo.tenant_id}/connectors/google/class-c-secrets/cli`,
      {
        method: "PUT",
        host: APP_HOST,
        cookies: opsCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: PLAIN }),
      },
    );
    expect(google.status).toBe(400);
    expect(google.raw).not.toContain(PLAIN);

    const graphql = await jsonRequest(bffApp, classCPath("graphql"), {
      method: "PUT",
      host: APP_HOST,
      cookies: opsCookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: PLAIN }),
    });
    expect(graphql.status).toBe(400);
    expect(graphql.raw).not.toContain(PLAIN);
  });
});
