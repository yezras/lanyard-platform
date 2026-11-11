import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { ControlPlaneStore } from "../src/store.js";
import { createTestStore } from "./pg-test-store.js";

type JsonBody = Record<string, unknown>;

async function jsonRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: JsonBody }> {
  const response = await app.request(path, init);
  const body = (await response.json()) as JsonBody;
  return { status: response.status, body };
}

describe("control-plane auth", () => {
  let store: ControlPlaneStore;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    store = await createTestStore();
    app = createApp(store, { devOpen: true });
  });

  afterEach(async () => {
    await store.close();
  });

  it("resolves tenant by slug", async () => {
    await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "acme", display_name: "Acme" }),
    });

    const lookup = await jsonRequest(app, "/tenants/by-slug/acme");
    expect(lookup.status).toBe(200);
    expect(lookup.body.tenant_slug).toBe("acme");
    expect(lookup.body.host).toBe("acme.withlanyard.com");
  });

  it("registers and logs in a tenant user", async () => {
    const tenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "demo", display_name: "Demo" }),
    });
    const tenantId = tenant.body.tenant_id as string;

    const register = await jsonRequest(
      app,
      `/tenants/${tenantId}/users/register`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "user@demo.example",
          password: "password123",
        }),
      },
    );

    expect(register.status).toBe(201);
    expect(register.body.email).toBe("user@demo.example");

    const login = await jsonRequest(app, "/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantId,
        email: "user@demo.example",
        password: "password123",
      }),
    });

    expect(login.status).toBe(200);
    expect(login.body.user_id).toBe(register.body.user_id);
  });

  it("rejects login with wrong password", async () => {
    const tenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "secure", display_name: "Secure" }),
    });
    const tenantId = tenant.body.tenant_id as string;

    await jsonRequest(app, `/tenants/${tenantId}/users/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "user@secure.example",
        password: "password123",
      }),
    });

    const login = await jsonRequest(app, "/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantId,
        email: "user@secure.example",
        password: "wrong-password",
      }),
    });

    expect(login.status).toBe(401);
  });

  it("upserts Google users per tenant via stub callback (development mode only)", async () => {
    // Development auth mode (default in tests) allows google_sub+email stubs.
    // Production mode rejects stubs — see oidc-production.integration.test.ts.
    const tenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "google", display_name: "Google" }),
    });
    const tenantId = tenant.body.tenant_id as string;

    const first = await jsonRequest(app, "/auth/google/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantId,
        google_sub: "sub-123",
        email: "google@example.com",
      }),
    });

    expect(first.status).toBe(200);

    const second = await jsonRequest(app, "/auth/google/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantId,
        google_sub: "sub-123",
        email: "google@example.com",
      }),
    });

    expect(second.status).toBe(200);
    expect(second.body.user_id).toBe(first.body.user_id);
  });

  it("isolates users by tenant", async () => {
    const tenantA = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "tenant-a", display_name: "A" }),
    });
    const tenantB = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "tenant-b", display_name: "B" }),
    });

    const tenantAId = tenantA.body.tenant_id as string;
    const tenantBId = tenantB.body.tenant_id as string;

    await jsonRequest(app, `/tenants/${tenantAId}/users/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "shared@example.com",
        password: "password-a",
      }),
    });

    await jsonRequest(app, `/tenants/${tenantBId}/users/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "shared@example.com",
        password: "password-b",
      }),
    });

    const loginA = await jsonRequest(app, "/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantAId,
        email: "shared@example.com",
        password: "password-a",
      }),
    });
    const loginBWrong = await jsonRequest(app, "/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantBId,
        email: "shared@example.com",
        password: "password-a",
      }),
    });

    expect(loginA.status).toBe(200);
    expect(loginBWrong.status).toBe(401);
  });
});