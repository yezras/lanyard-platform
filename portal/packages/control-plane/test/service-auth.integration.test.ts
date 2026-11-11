import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CONTROL_PLANE_SERVICE_TOKEN_HEADER,
  createApp,
  INTERNAL_OPS_TOKEN_HEADER,
} from "../src/app.js";
import {
  assertProductionServiceToken,
  DEV_CONTROL_PLANE_SERVICE_TOKEN,
  serviceTokenMatches,
} from "../src/service-auth.js";
import { ControlPlaneStore } from "../src/store.js";
import { createTestStore } from "./pg-test-store.js";

type JsonBody = Record<string, unknown>;

const SERVICE_TOKEN = "test-bff-service-token-g12";
const OPS_TOKEN = "test-ops-token-g12";
const SPOOFED = "not-the-real-service-token";

async function jsonRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: JsonBody }> {
  const response = await app.request(path, init);
  const body = (await response.json()) as JsonBody;
  return { status: response.status, body };
}

describe("control-plane service auth unit helpers (G1.2)", () => {
  it("matches equal tokens and rejects spoofed tokens", () => {
    expect(serviceTokenMatches(SERVICE_TOKEN, SERVICE_TOKEN)).toBe(true);
    expect(serviceTokenMatches(SERVICE_TOKEN, SPOOFED)).toBe(false);
  });

  it("rejects production start with missing or dev placeholder token", () => {
    expect(() => assertProductionServiceToken(undefined)).toThrow(
      /CONTROL_PLANE_SERVICE_TOKEN/,
    );
    expect(() =>
      assertProductionServiceToken(DEV_CONTROL_PLANE_SERVICE_TOKEN),
    ).toThrow(/non-development/);
    expect(() => assertProductionServiceToken(SERVICE_TOKEN)).not.toThrow();
  });
});

describe("control-plane service auth (G1.2)", () => {
  let store: ControlPlaneStore;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    store = await createTestStore();
    app = createApp(store, {
      authMode: "production",
      serviceToken: SERVICE_TOKEN,
      internalOpsToken: OPS_TOKEN,
    });
  });

  afterEach(async () => {
    await store.close();
  });

  it("allows health without credentials and reports service_auth", async () => {
    const health = await jsonRequest(app, "/health");
    expect(health.status).toBe(200);
    expect(health.body.auth_mode).toBe("production");
    expect(health.body.service_auth).toBe("configured");
  });

  it("rejects anonymous BFF-facing calls", async () => {
    const create = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "anon", display_name: "Anon" }),
    });
    expect(create.status).toBe(401);
    expect(String(create.body.error)).toMatch(/unauthorized/i);
  });

  it("rejects spoofed service tokens", async () => {
    const create = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [CONTROL_PLANE_SERVICE_TOKEN_HEADER]: SPOOFED,
      },
      body: JSON.stringify({ slug: "spoof", display_name: "Spoof" }),
    });
    expect(create.status).toBe(401);
  });

  it("allows BFF calls with a valid service token", async () => {
    const create = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [CONTROL_PLANE_SERVICE_TOKEN_HEADER]: SERVICE_TOKEN,
      },
      body: JSON.stringify({ slug: "bff-ok", display_name: "BFF OK" }),
    });
    expect(create.status).toBe(201);
    expect(create.body.tenant_slug).toBe("bff-ok");
  });

  it("allows operator tooling with a valid ops token", async () => {
    const create = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [INTERNAL_OPS_TOKEN_HEADER]: OPS_TOKEN,
      },
      body: JSON.stringify({ slug: "ops-ok", display_name: "Ops OK" }),
    });
    expect(create.status).toBe(201);
  });

  it("requires service credentials for login and internal lookup", async () => {
    const tenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [CONTROL_PLANE_SERVICE_TOKEN_HEADER]: SERVICE_TOKEN,
      },
      body: JSON.stringify({ slug: "login-gate", display_name: "Login" }),
    });
    const tenantId = tenant.body.tenant_id as string;

    await jsonRequest(app, `/tenants/${tenantId}/users/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [CONTROL_PLANE_SERVICE_TOKEN_HEADER]: SERVICE_TOKEN,
      },
      body: JSON.stringify({
        email: "user@login.example",
        password: "password123",
      }),
    });

    const anonLogin = await jsonRequest(app, "/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantId,
        email: "user@login.example",
        password: "password123",
      }),
    });
    expect(anonLogin.status).toBe(401);

    const serviceLogin = await jsonRequest(app, "/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [CONTROL_PLANE_SERVICE_TOKEN_HEADER]: SERVICE_TOKEN,
      },
      body: JSON.stringify({
        tenant_id: tenantId,
        email: "user@login.example",
        password: "password123",
      }),
    });
    expect(serviceLogin.status).toBe(200);

    const anonLookup = await jsonRequest(
      app,
      "/internal/tenants/by-slug/login-gate",
    );
    expect(anonLookup.status).toBe(401);

    const serviceLookup = await jsonRequest(
      app,
      "/internal/tenants/by-slug/login-gate",
      {
        headers: {
          [CONTROL_PLANE_SERVICE_TOKEN_HEADER]: SERVICE_TOKEN,
        },
      },
    );
    expect(serviceLookup.status).toBe(200);
  });

  it("fails closed when production mode has no credentials configured", async () => {
    const locked = createApp(store, {
      authMode: "production",
      // no serviceToken, no internalOpsToken
    });

    const create = await jsonRequest(locked, "/tenants", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [CONTROL_PLANE_SERVICE_TOKEN_HEADER]: "anything",
      },
      body: JSON.stringify({ slug: "nope", display_name: "Nope" }),
    });

    expect(create.status).toBe(503);
  });

  it("enforces service token in development when configured", async () => {
    const gated = createApp(store, {
      authMode: "development",
      serviceToken: SERVICE_TOKEN,
    });

    const anon = await jsonRequest(gated, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "dev-anon", display_name: "Dev" }),
    });
    expect(anon.status).toBe(401);

    const ok = await jsonRequest(gated, "/tenants", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [CONTROL_PLANE_SERVICE_TOKEN_HEADER]: SERVICE_TOKEN,
      },
      body: JSON.stringify({ slug: "dev-ok", display_name: "Dev" }),
    });
    expect(ok.status).toBe(201);
  });

  it("leaves development open only with explicit devOpen when service token is unset", async () => {
    const open = createApp(store, {
      authMode: "development",
      devOpen: true,
    });
    const create = await jsonRequest(open, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "open-dev", display_name: "Open" }),
    });
    expect(create.status).toBe(201);

    const health = await jsonRequest(open, "/health");
    expect(health.body.service_auth).toBe("open");
    expect(health.body.dev_open).toBe(true);
  });

  it("fails closed in development without service token or explicit open mode", async () => {
    const locked = createApp(store, {
      authMode: "development",
      // no serviceToken, no devOpen
    });

    const health = await jsonRequest(locked, "/health");
    expect(health.status).toBe(200);
    expect(health.body.service_auth).toBe("required");
    expect(health.body.dev_open).toBe(false);

    const create = await jsonRequest(locked, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "locked-dev", display_name: "Locked" }),
    });
    expect(create.status).toBe(503);
    expect(String(create.body.error)).toMatch(/not configured/i);
  });
});
