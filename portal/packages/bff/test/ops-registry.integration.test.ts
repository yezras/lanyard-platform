import { describe, expect, it } from "vitest";

import { APP_HOST } from "@lanyard/shared";

import { createApp } from "../src/app.js";
import type { ControlPlaneAuthClient } from "../src/control-plane-client.js";
import { createFixtureConnectorSource } from "../src/integrations-sh-fixture.js";
import { createIntegrationsShSource } from "../src/integrations-sh-source.js";
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

const alphaTenant: TenantContext = {
  tenant_id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  tenant_slug: "alpha",
  display_name: "Alpha",
  host: "alpha.withlanyard.com",
};

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

function createRegistryApp(
  overrides: Parameters<typeof createTestBindings>[1] = {},
) {
  return createApp(
    createTestBindings(
      { alpha: alphaTenant },
      {
        opsSessions: new MemoryOpsSessionStore(),
        operatorDirectory: new MemoryOperatorDirectory([operator]),
        devTenantSlug: "alpha",
        authClient: {
          getUserRbac: async () => ({
            user_id: "user-1",
            tenant_id: alphaTenant.tenant_id,
            hermes_profile: "default",
            allowed_path_prefixes: ["/"],
            role_names: ["member"],
          }),
        } as unknown as ControlPlaneAuthClient,
        ...overrides,
      },
    ),
  );
}

async function opsLogin(
  app: ReturnType<typeof createApp>,
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

describe("ops registry proxy (lp-hdzm.5)", () => {
  it("searches the offline fixture without a live fetch", async () => {
    const app = createRegistryApp();
    const cookies = await opsLogin(app);
    const res = await jsonRequest(app, "/api/admin/registry/search?q=stripe", {
      host: APP_HOST,
      cookies,
    });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("integrations.sh");
    const results = res.body.results as Array<{ domain: string; kinds: string[] }>;
    expect(results.some((row) => row.domain === "stripe.com")).toBe(true);
    expect(results[0]?.kinds).toContain("mcp");
  });

  it("returns the pinned fixture envelope", async () => {
    const app = createRegistryApp();
    const cookies = await opsLogin(app);
    const res = await jsonRequest(app, "/api/admin/registry/envelope", {
      host: APP_HOST,
      cookies,
    });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("integrations.sh");
    const data = res.body.data as Array<{ domain: string }>;
    expect(data.map((row) => row.domain)).toEqual([
      "stripe.com",
      "slack.com",
      "google.com",
      "graphql.example",
      "pointer.example",
    ]);
  });

  it("returns a BFF-fetched stripe surface from the fixture", async () => {
    const app = createRegistryApp();
    const cookies = await opsLogin(app);
    const res = await jsonRequest(
      app,
      "/api/admin/registry/surfaces/stripe.com",
      { host: APP_HOST, cookies },
    );
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("integrations.sh");
    const surface = res.body.surface as {
      domain: string;
      surfaces: Array<{ type: string }>;
    };
    expect(surface.domain).toBe("stripe.com");
    expect(surface.surfaces.some((row) => row.type === "mcp")).toBe(true);
  });

  it("rejects a client-supplied snapshot body", async () => {
    const app = createRegistryApp();
    const cookies = await opsLogin(app);
    const res = await jsonRequest(app, "/api/admin/registry/snapshots", {
      method: "POST",
      host: APP_HOST,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        domain: "stripe.com",
        snapshot: { version: 3, surfaces: [], evil: true },
      }),
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("Client-supplied snapshot");
  });

  it("POSTs domain-only snapshots from the fixture", async () => {
    const app = createRegistryApp();
    const cookies = await opsLogin(app);
    const res = await jsonRequest(app, "/api/admin/registry/snapshots", {
      method: "POST",
      host: APP_HOST,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: "stripe.com" }),
    });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("integrations.sh");
    expect(res.body.domain).toBe("stripe.com");
    const snapshot = res.body.snapshot as { domain: string };
    expect(snapshot.domain).toBe("stripe.com");
  });

  it("rejects SSRF-shaped domains without calling fetch", async () => {
    const calls: string[] = [];
    const app = createRegistryApp({
      connectorSource: createIntegrationsShSource({
        fetchImpl: async (input) => {
          calls.push(String(input));
          return new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      }),
    });
    const cookies = await opsLogin(app);
    const ssrf = [
      "/api/admin/registry/surfaces/169.254.169.254",
      "/api/admin/registry/surfaces/127.0.0.1",
      "/api/admin/registry/surfaces/localhost",
    ];
    for (const path of ssrf) {
      const res = await jsonRequest(app, path, { host: APP_HOST, cookies });
      expect(res.status).toBe(400);
      expect(String(res.body.error)).toContain("Invalid domain");
    }
    expect(calls).toEqual([]);
  });

  it("does not follow an off-origin catalog redirect", async () => {
    const calls: string[] = [];
    const app = createRegistryApp({
      connectorSource: createIntegrationsShSource({
        fetchImpl: async (input) => {
          calls.push(String(input));
          return new Response(null, {
            status: 302,
            headers: { location: "https://evil.com/steal" },
          });
        },
      }),
    });
    const cookies = await opsLogin(app);
    const res = await jsonRequest(
      app,
      "/api/admin/registry/surfaces/stripe.com",
      { host: APP_HOST, cookies },
    );
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("Refused catalog URL");
    expect(calls).toEqual(["https://integrations.sh/api/stripe.com/surface"]);
  });

  it("rejects tenant cookies and anonymous callers", async () => {
    const app = createRegistryApp();
    const anon = await jsonRequest(app, "/api/admin/registry/search?q=stripe", {
      host: APP_HOST,
    });
    expect(anon.status).toBe(401);

    const tenantCsrf = await jsonRequest(app, "/api/auth/csrf", {
      host: alphaTenant.host,
    });
    const tenantCookie = {
      ...tenantCsrf.cookies,
      [SESSION_COOKIE]: "not-an-ops-session",
    };
    const withTenant = await jsonRequest(
      app,
      "/api/admin/registry/search?q=stripe",
      { host: APP_HOST, cookies: tenantCookie },
    );
    expect(withTenant.status).toBe(401);
  });

  it("loads the fixture source without a network client", () => {
    const source = createFixtureConnectorSource();
    expect(source.id).toBe("integrations.sh");
  });
});
