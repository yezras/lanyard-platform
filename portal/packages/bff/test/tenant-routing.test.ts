import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { getRequestListener } from "@hono/node-server";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import {
  isConnectorOAuthCallbackPath,
  isOfficeDocumentServerPath,
} from "../src/middleware/tenant.js";
import type { TenantContext } from "../src/types.js";
import { createTestBindings } from "./test-helpers.js";

const demoTenant: TenantContext = {
  tenant_id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  tenant_slug: "demo",
  display_name: "Demo Tenant",
  host: "app.withlanyard.com",
};

const otherTenant: TenantContext = {
  tenant_id: "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
  tenant_slug: "other",
  display_name: "Other Tenant",
  host: "app.withlanyard.com",
};

describe("BFF tenant routing (path + subdomain)", () => {
  let closeServer: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await closeServer?.();
    closeServer = undefined;
  });

  function mountApp(options?: {
    devTenantSlug?: string;
    appHosts?: string[];
  }) {
    const app = createApp(
      createTestBindings(
        { demo: demoTenant, other: otherTenant },
        {
          devTenantSlug: options?.devTenantSlug,
          appHosts: options?.appHosts,
        },
      ),
    );
    const server = createServer(getRequestListener(app.fetch));
    return new Promise<ReturnType<typeof request>>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        closeServer = () =>
          new Promise((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          });
        resolve(request(`http://127.0.0.1:${port}`));
      });
    });
  }

  it("serves /health without tenant context", async () => {
    const agent = await mountApp();
    const response = await agent.get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", service: "bff" });
  });

  it("attaches tenant context for path-based app host", async () => {
    const agent = await mountApp();
    const response = await agent
      .get("/demo/api/context")
      .set("Host", "app.withlanyard.com");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      tenant_id: demoTenant.tenant_id,
      tenant_slug: "demo",
      display_name: "Demo Tenant",
      host: "app.withlanyard.com",
      hermes_profile: null,
      allowed_path_prefixes: [],
      role_names: [],
      brain_rpc_enabled: false,
      chat_delivery: "relay",
      vault_plane: "fs",
      ui: {
        can: {
          vault_edit: false,
        },
      },
    });
  });

  it("isolates two tenants on path-based host", async () => {
    const agent = await mountApp();
    const a = await agent
      .get("/demo/api/context")
      .set("Host", "app.withlanyard.com");
    const b = await agent
      .get("/other/api/context")
      .set("Host", "app.withlanyard.com");

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.tenant_id).toBe(demoTenant.tenant_id);
    expect(b.body.tenant_id).toBe(otherTenant.tenant_id);
    expect(a.body.tenant_id).not.toBe(b.body.tenant_id);
  });

  it("attaches tenant context for legacy subdomain host", async () => {
    const agent = await mountApp();
    const response = await agent
      .get("/api/context")
      .set("Host", "demo.withlanyard.com");

    expect(response.status).toBe(200);
    expect(response.body.tenant_slug).toBe("demo");
  });

  it("returns 404 JSON for unknown path tenant", async () => {
    const agent = await mountApp();
    const response = await agent
      .get("/missing/api/context")
      .set("Host", "app.withlanyard.com");

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Unknown tenant: missing");
  });

  it("returns 404 JSON for unknown subdomain tenant", async () => {
    const agent = await mountApp();
    const response = await agent
      .get("/api/context")
      .set("Host", "missing.withlanyard.com");

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Unknown tenant: missing");
  });

  it("returns 404 JSON for unrecognized host without path slug", async () => {
    const agent = await mountApp();
    const response = await agent.get("/api/context").set("Host", "example.com");

    expect(response.status).toBe(404);
    expect(response.body.error).toContain("Unknown tenant");
  });

  it("supports localhost bypass via DEV_TENANT_SLUG", async () => {
    const agent = await mountApp({ devTenantSlug: "demo" });
    const response = await agent
      .get("/api/context")
      .set("Host", "localhost:4000");

    expect(response.status).toBe(200);
    expect(response.body.tenant_slug).toBe("demo");
  });

  it("attaches tenant context for CloudFront app host when APP_HOSTS configured", async () => {
    const agent = await mountApp({
      appHosts: [
        "app.withlanyard.com",
        "localhost",
        "127.0.0.1",
        "d1watnzk551glk.cloudfront.net",
      ],
    });
    const response = await agent
      .get("/demo/api/context")
      .set("Host", "d1watnzk551glk.cloudfront.net");

    expect(response.status).toBe(200);
    expect(response.body.tenant_slug).toBe("demo");
  });

  it("returns 404 for CloudFront host when not in appHosts", async () => {
    const agent = await mountApp();
    const response = await agent
      .get("/demo/api/context")
      .set("Host", "example.cloudfront.net");

    expect(response.status).toBe(404);
    expect(response.body.error).toContain("Unknown tenant");
  });

  it("supports path tenant on localhost", async () => {
    const agent = await mountApp();
    const response = await agent
      .get("/demo/api/context")
      .set("Host", "localhost:4000");

    expect(response.status).toBe(200);
    expect(response.body.tenant_slug).toBe("demo");
  });

  it("supports slug.localhost dev host pattern", async () => {
    const agent = await mountApp();
    const response = await agent
      .get("/api/context")
      .set("Host", "demo.localhost:4000");

    expect(response.status).toBe(200);
    expect(response.body.tenant_slug).toBe("demo");
  });

  it("includes tenant_id on descriptor preview route (path)", async () => {
    const agent = await mountApp();
    const response = await agent
      .get("/demo/api/relay/descriptor-preview")
      .set("Host", "app.withlanyard.com");

    expect(response.status).toBe(200);
    expect(response.body.tenant_id).toBe(demoTenant.tenant_id);
    expect(response.body.descriptor).toBeDefined();
  });

  it("still requires tenant Host for non-office API routes", async () => {
    const agent = await mountApp();
    const response = await agent
      .get("/api/context")
      .set("Host", "host.docker.internal:4000");

    expect(response.status).toBe(404);
    expect(response.body.error).toContain("Unknown tenant");
  });

  it("defers tenant on bare connector OAuth callback (lp-xhf4.18)", async () => {
    const agent = await mountApp();
    const callback = await agent
      .get("/api/connectors/google/oauth/callback")
      .set("Host", "app.withlanyard.com");
    expect(callback.status).not.toBe(404);
    expect(JSON.stringify(callback.body)).not.toMatch(/Unknown tenant/);

    const context = await agent
      .get("/api/context")
      .set("Host", "app.withlanyard.com");
    expect(context.status).toBe(404);
    expect(context.body.error).toContain("Unknown tenant");
  });
});

describe("isOfficeDocumentServerPath", () => {
  it("matches DS content and callback under /api and /{slug}/api", () => {
    expect(
      isOfficeDocumentServerPath(
        "/api/office/sessions/sess-1/content",
      ),
    ).toBe(true);
    expect(
      isOfficeDocumentServerPath(
        "/demo/api/office/sessions/sess-1/content",
      ),
    ).toBe(true);
    expect(isOfficeDocumentServerPath("/api/office/callback")).toBe(true);
    expect(isOfficeDocumentServerPath("/demo/api/office/callback")).toBe(
      true,
    );
  });

  it("does not match mint or other office/browser routes", () => {
    expect(isOfficeDocumentServerPath("/api/office/sessions")).toBe(false);
    expect(isOfficeDocumentServerPath("/api/context")).toBe(false);
    expect(
      isOfficeDocumentServerPath("/api/office/sessions/sess-1/status"),
    ).toBe(false);
  });
});

describe("isConnectorOAuthCallbackPath", () => {
  it("matches bare and slug-prefixed callback", () => {
    expect(
      isConnectorOAuthCallbackPath("/api/connectors/google/oauth/callback"),
    ).toBe(true);
    expect(
      isConnectorOAuthCallbackPath(
        "/mocklab/api/connectors/google/oauth/callback",
      ),
    ).toBe(true);
    expect(
      isConnectorOAuthCallbackPath("/api/connectors/hubspot/oauth/callback"),
    ).toBe(true);
  });

  it("does not match other connector or office paths", () => {
    expect(isConnectorOAuthCallbackPath("/api/connectors/google")).toBe(false);
    expect(isConnectorOAuthCallbackPath("/api/context")).toBe(false);
    expect(isConnectorOAuthCallbackPath("/api/office/callback")).toBe(false);
  });
});
