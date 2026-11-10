/**
 * lp-hdzm.19 — BFF promote/custom/delete against CP + fixture catalog.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { APP_HOST } from "@lanyard/shared";

import { createApp as createControlPlaneApp } from "../../control-plane/src/app.js";
import { ControlPlaneStore } from "../../control-plane/src/store.js";
import { createTestStore } from "../../control-plane/test/pg-test-store.js";
import { createApp } from "../src/app.js";
import { ControlPlaneAuthClient } from "../src/control-plane-client.js";
import { createFixtureConnectorSource } from "../src/integrations-sh-fixture.js";
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
  let body: JsonBody = {};
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    body = (await response.json()) as JsonBody;
  }
  return {
    status: response.status,
    body,
    cookies: {
      ...init.cookies,
      ...parseSetCookie(response.headers.get("set-cookie")),
    },
  };
}

describe("ops registry writes (lp-hdzm.19)", () => {
  let store: ControlPlaneStore;
  let bffApp: ReturnType<typeof createApp>;
  let controlPlaneApp: ReturnType<typeof createControlPlaneApp>;
  let tenantDemo: TenantContext;

  beforeEach(async () => {
    store = await createTestStore();
    controlPlaneApp = createControlPlaneApp(store, { devOpen: true });
    const created = await store.createTenant({
      slug: "demo",
      display_name: "Demo",
    });
    tenantDemo = {
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
        { demo: tenantDemo },
        {
          authClient,
          opsSessions: new MemoryOpsSessionStore(),
          operatorDirectory: new MemoryOperatorDirectory([operator]),
          devTenantSlug: "demo",
        },
      ),
    );
  });

  afterEach(async () => {
    await store.close();
  });

  async function opsLogin(
    app: ReturnType<typeof createApp> = bffApp,
  ): Promise<Record<string, string>> {
    const csrf = await jsonRequest(app, "/api/admin/auth/csrf", {
      host: APP_HOST,
    });
    const stub = await jsonRequest(app, "/api/admin/auth/google/stub", {
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

  it("promotes stripe from the fixture with inlined OpenAPI and MCP", async () => {
    const cookies = await opsLogin();
    const res = await jsonRequest(bffApp, "/api/admin/registry/promote", {
      method: "POST",
      host: APP_HOST,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: "stripe.com" }),
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe("stripe");
    const snapshot = res.body.snapshot as {
      runnability: string;
      surfaces: Array<{ kind: string; runnability: string; spec?: unknown }>;
    };
    expect(snapshot.runnability).toBe("runnable");
    expect(
      snapshot.surfaces.some(
        (row) => row.kind === "mcp" && row.runnability === "runnable",
      ),
    ).toBe(true);
    expect(
      snapshot.surfaces.some(
        (row) => row.kind === "openapi" && row.runnability === "runnable" && row.spec,
      ),
    ).toBe(true);

    const listed = await jsonRequest(bffApp, "/api/admin/registry/connectors", {
      host: APP_HOST,
      cookies,
    });
    expect(listed.status).toBe(200);
    const connectors = listed.body.connectors as Array<{ id: string }>;
    expect(connectors.some((row) => row.id === "stripe")).toBe(true);
  });

  it("promotes stripe when the live catalog summary exceeds CP label max", async () => {
    const inner = createFixtureConnectorSource();
    const liveSummary =
      "Stripe exposes a REST HTTP API at https://api.stripe.com, an OAuth-protected MCP server at https://mcp.stripe.com, and the `stripe` CLI; all require Stripe-issued credentials.";
    expect(liveSummary.length).toBeGreaterThan(128);
    const longSource = {
      id: inner.id,
      search: (query: Parameters<typeof inner.search>[0]) => inner.search(query),
      getEnvelope: () => inner.getEnvelope(),
      async getSurface(domain: string) {
        const result = await inner.getSurface(domain);
        if (!result.ok) {
          return result;
        }
        return { ok: true as const, value: { ...result.value, summary: liveSummary } };
      },
    };
    const longApp = createApp(
      createTestBindings(
        { demo: tenantDemo },
        {
          authClient: new ControlPlaneAuthClient(
            "http://control-plane.test",
            (input, init) => {
              const url = new URL(input);
              return controlPlaneApp.request(url.pathname + url.search, init);
            },
          ),
          opsSessions: new MemoryOpsSessionStore(),
          operatorDirectory: new MemoryOperatorDirectory([operator]),
          devTenantSlug: "demo",
          connectorSource: longSource,
        },
      ),
    );
    const cookies = await opsLogin(longApp);
    const res = await jsonRequest(longApp, "/api/admin/registry/promote", {
      method: "POST",
      host: APP_HOST,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: "stripe.com" }),
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: "stripe", label: "Stripe" });
    expect(String(res.body.label).length).toBeLessThanOrEqual(128);
  });

  it("409s google alias promote", async () => {
    const cookies = await opsLogin();
    const res = await jsonRequest(bffApp, "/api/admin/registry/promote", {
      method: "POST",
      host: APP_HOST,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: "google.com" }),
    });
    expect(res.status).toBe(409);
    expect(String(res.body.error)).toMatch(/alias|reserved/i);
  });

  it("rejects GraphQL promote and custom GraphQL", async () => {
    const cookies = await opsLogin();
    const promote = await jsonRequest(bffApp, "/api/admin/registry/promote", {
      method: "POST",
      host: APP_HOST,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: "graphql.example" }),
    });
    expect(promote.status).toBe(400);
    expect(String(promote.body.error)).toMatch(/GraphQL/i);

    const custom = await jsonRequest(bffApp, "/api/admin/registry/custom", {
      method: "POST",
      host: APP_HOST,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: "gqlco",
        label: "GQL Co",
        surfaces: [{ kind: "graphql", slug: "gql", url: "https://gql.example/graphql" }],
      }),
    });
    expect(custom.status).toBe(400);
    expect(String(custom.body.error)).toMatch(/GraphQL/i);
  });

  it("adds custom, 409s reserved/collision, and 409s delete while onboarded", async () => {
    const cookies = await opsLogin();
    const created = await jsonRequest(bffApp, "/api/admin/registry/custom", {
      method: "POST",
      host: APP_HOST,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: "linear",
        label: "Linear",
        surfaces: [
          {
            kind: "mcp",
            slug: "linear-mcp",
            initialize_url: "https://mcp.linear.app/mcp",
            transports: ["streamable-http"],
          },
        ],
      }),
    });
    expect(created.status).toBe(201);
    expect(created.body.id).toBe("linear");
    const snapshot = created.body.snapshot as { runnability: string };
    expect(snapshot.runnability).toBe("not_runnable");

    const reserved = await jsonRequest(bffApp, "/api/admin/registry/custom", {
      method: "POST",
      host: APP_HOST,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: "google",
        label: "Google",
        surfaces: [{ kind: "cli", slug: "gws", argv: ["gws"] }],
      }),
    });
    expect(reserved.status).toBe(409);

    const collision = await jsonRequest(bffApp, "/api/admin/registry/custom", {
      method: "POST",
      host: APP_HOST,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: "linear",
        label: "Linear again",
        surfaces: [{ kind: "cli", slug: "lin", argv: ["linear"] }],
      }),
    });
    expect(collision.status).toBe(409);

    const linearId = await store.parseConnectorId("linear");
    await store.upsertTenantConnectorEntitlement({
      tenant_id: tenantDemo.tenant_id,
      connector_id: linearId,
      enabled: true,
    });
    const blocked = await jsonRequest(
      bffApp,
      "/api/admin/registry/connectors/linear",
      {
        method: "DELETE",
        host: APP_HOST,
        cookies,
        csrf: true,
      },
    );
    expect(blocked.status).toBe(409);
    expect(String(blocked.body.error)).toMatch(/onboarded/i);

    await store.upsertTenantConnectorEntitlement({
      tenant_id: tenantDemo.tenant_id,
      connector_id: linearId,
      enabled: false,
    });
    const deleted = await jsonRequest(
      bffApp,
      "/api/admin/registry/connectors/linear",
      {
        method: "DELETE",
        host: APP_HOST,
        cookies,
        csrf: true,
      },
    );
    expect(deleted.status).toBe(200);
    expect(deleted.body.archived).toBe(true);
  });

  it("promotes pointer-only as not_runnable", async () => {
    const cookies = await opsLogin();
    const res = await jsonRequest(bffApp, "/api/admin/registry/promote", {
      method: "POST",
      host: APP_HOST,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: "pointer.example" }),
    });
    expect(res.status).toBe(201);
    const snapshot = res.body.snapshot as { runnability: string };
    expect(snapshot.runnability).toBe("not_runnable");
  });
});
