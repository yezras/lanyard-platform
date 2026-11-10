import * as jose from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CONTROL_PLANE_SERVICE_TOKEN_HEADER,
  createApp,
  INTERNAL_OPS_TOKEN_HEADER,
} from "../src/app.js";
import { GOOGLE_OIDC_ISSUERS } from "../src/google-auth.js";
import { ControlPlaneStore } from "../src/store.js";
import { createTestStore } from "./pg-test-store.js";

type JsonBody = Record<string, unknown>;

const SERVICE_TOKEN = "test-production-service-token";
const OPS_TOKEN = "test-production-ops-token";
const CLIENT_ID = "prod-client-id.apps.googleusercontent.com";

async function jsonRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: JsonBody }> {
  const response = await app.request(path, init);
  const body = (await response.json()) as JsonBody;
  return { status: response.status, body };
}

function serviceHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    [CONTROL_PLANE_SERVICE_TOKEN_HEADER]: SERVICE_TOKEN,
    ...extra,
  };
}

describe("control-plane production auth (G1.1 + G1.2)", () => {
  let store: ControlPlaneStore;
  let privateKey: jose.KeyLike;
  let jwks: jose.JWTVerifyGetKey;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    store = await createTestStore();
    const pair = await jose.generateKeyPair("RS256");
    privateKey = pair.privateKey;
    jwks = jose.createLocalJWKSet(
      await jose.exportJWK(pair.publicKey).then((jwk) => ({ keys: [jwk] })),
    );

    app = createApp(store, {
      authMode: "production",
      serviceToken: SERVICE_TOKEN,
      internalOpsToken: OPS_TOKEN,
      googleAuth: {
        clientId: CLIENT_ID,
        verifyJwt: async (token, audience) => {
          const { payload } = await jose.jwtVerify(token, jwks, {
            audience,
            issuer: [...GOOGLE_OIDC_ISSUERS],
          });
          return payload;
        },
      },
    });
  });

  afterEach(async () => {
    await store.close();
  });

  it("allows health without credentials and reports auth_mode", async () => {
    const health = await jsonRequest(app, "/health");
    expect(health.status).toBe(200);
    expect(health.body.auth_mode).toBe("production");
    expect(health.body.service_auth).toBe("configured");
  });

  it("rejects unauthenticated tenant admin access", async () => {
    const create = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "locked", display_name: "Locked" }),
    });
    expect(create.status).toBe(401);
    expect(create.body.error).toMatch(/unauthorized/i);
  });

  it("rejects unauthenticated internal API access", async () => {
    const lookup = await jsonRequest(app, "/internal/tenants/by-slug/nope");
    expect(lookup.status).toBe(401);
  });

  it("allows tenant admin with service token (BFF path)", async () => {
    const create = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...serviceHeaders(),
      },
      body: JSON.stringify({ slug: "svc-ok", display_name: "Svc OK" }),
    });
    expect(create.status).toBe(201);
    expect(create.body.tenant_slug).toBe("svc-ok");
  });

  it("allows tenant admin with ops token (operator path)", async () => {
    const create = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [INTERNAL_OPS_TOKEN_HEADER]: OPS_TOKEN,
      },
      body: JSON.stringify({ slug: "ops-ok", display_name: "Ops OK" }),
    });
    expect(create.status).toBe(201);
    expect(create.body.tenant_slug).toBe("ops-ok");
  });

  it("rejects Google stub credentials in production", async () => {
    const tenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...serviceHeaders(),
      },
      body: JSON.stringify({ slug: "g-stub", display_name: "G" }),
    });
    const tenantId = tenant.body.tenant_id as string;

    const stub = await jsonRequest(app, "/auth/google/callback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...serviceHeaders(),
      },
      body: JSON.stringify({
        tenant_id: tenantId,
        google_sub: "stub-sub",
        email: "stub@example.com",
      }),
    });

    expect(stub.status).toBe(401);
    expect(String(stub.body.error)).toMatch(/stub/i);
  });

  it("accepts verified Google id_token in production via BFF service token", async () => {
    const tenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...serviceHeaders(),
      },
      body: JSON.stringify({ slug: "g-ok", display_name: "G" }),
    });
    const tenantId = tenant.body.tenant_id as string;

    const idToken = await new jose.SignJWT({
      email: "verified@example.com",
      email_verified: true,
    })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setSubject("sub-verified")
      .setAudience(CLIENT_ID)
      .setIssuer(GOOGLE_OIDC_ISSUERS[0])
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

    const callback = await jsonRequest(app, "/auth/google/callback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...serviceHeaders(),
      },
      body: JSON.stringify({
        tenant_id: tenantId,
        id_token: idToken,
      }),
    });

    expect(callback.status).toBe(200);
    expect(callback.body.email).toBe("verified@example.com");
  });

  it("rejects id_token with wrong audience", async () => {
    const tenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...serviceHeaders(),
      },
      body: JSON.stringify({ slug: "g-bad-aud", display_name: "G" }),
    });
    const tenantId = tenant.body.tenant_id as string;

    const idToken = await new jose.SignJWT({
      email: "bad@example.com",
      email_verified: true,
    })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setSubject("sub-bad")
      .setAudience("wrong-audience")
      .setIssuer(GOOGLE_OIDC_ISSUERS[0])
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

    const callback = await jsonRequest(app, "/auth/google/callback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...serviceHeaders(),
      },
      body: JSON.stringify({
        tenant_id: tenantId,
        id_token: idToken,
      }),
    });

    expect(callback.status).toBe(401);
  });

  it("requires service credentials for password login (private CP)", async () => {
    const tenant = await jsonRequest(app, "/tenants", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...serviceHeaders(),
      },
      body: JSON.stringify({ slug: "login-gate", display_name: "L" }),
    });
    const tenantId = tenant.body.tenant_id as string;

    await jsonRequest(app, `/tenants/${tenantId}/users/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...serviceHeaders(),
      },
      body: JSON.stringify({
        email: "user@login.example",
        password: "password123",
      }),
    });

    const anon = await jsonRequest(app, "/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantId,
        email: "user@login.example",
        password: "password123",
      }),
    });
    expect(anon.status).toBe(401);

    const login = await jsonRequest(app, "/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...serviceHeaders(),
      },
      body: JSON.stringify({
        tenant_id: tenantId,
        email: "user@login.example",
        password: "password123",
      }),
    });

    expect(login.status).toBe(200);
    expect(login.body.email).toBe("user@login.example");
  });

  it("fails closed when production mode has no credentials configured", async () => {
    const locked = createApp(store, {
      authMode: "production",
      // no serviceToken, no internalOpsToken
      googleAuth: { clientId: CLIENT_ID },
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
});
