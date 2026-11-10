/**
 * lp-xhf4.7 — Google connector OAuth complete writes CP ciphertext;
 * first-use inject exposes GOOGLE_WORKSPACE_CLI_TOKEN on the user guest.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import {
  CONNECTOR_GUEST_PATHS,
  createInMemoryGuestConnectorStore,
} from "../src/connector-user-sandbox.js";
import {
  GOOGLE_WORKSPACE_OAUTH_SCOPES,
  InsufficientGoogleScopesError,
} from "../src/google-workspace-oauth.js";
import { CONTROL_PLANE_SERVICE_TOKEN_HEADER } from "../src/service-auth.js";
import { ControlPlaneStore } from "../src/store.js";
import { createTestStore } from "./pg-test-store.js";

type JsonBody = Record<string, unknown>;

const SERVICE_TOKEN = "test-cp-service-token";
const REFRESH = "google-refresh-token-plain";
const ACCESS = "google-access-token-plain";

async function jsonRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: JsonBody; raw: string }> {
  const response = await app.request(path, init);
  const raw = await response.text();
  const body = JSON.parse(raw) as JsonBody;
  return { status: response.status, body, raw };
}

function serviceHeaders(): Headers {
  const headers = new Headers();
  headers.set(CONTROL_PLANE_SERVICE_TOKEN_HEADER, SERVICE_TOKEN);
  headers.set("content-type", "application/json");
  return headers;
}

describe("Google connector OAuth complete (lp-xhf4.7)", () => {
  let store: ControlPlaneStore;
  let guest: ReturnType<typeof createInMemoryGuestConnectorStore>;
  let app: ReturnType<typeof createApp>;
  let tenantId = "";
  let userId = "";

  beforeEach(async () => {
    store = await createTestStore();
    guest = createInMemoryGuestConnectorStore();
    const tenant = await store.createTenant({
      slug: "gws-oauth",
      display_name: "GWS OAuth",
    });
    tenantId = tenant.tenant_id;
    userId = (
      await store.registerUser({
        tenant_id: tenantId,
        email: "alice@gws.test",
        password: "password123",
      })
    ).user_id;
    app = createApp(store, {
      serviceToken: SERVICE_TOKEN,
      guestConnectorStore: guest,
      googleAuth: {
        clientId: "lanyard-google-app",
        exchangeWorkspaceCode: async ({ codeVerifier }) => {
          expect(codeVerifier).toBe("pkce-verifier");
          return {
            access_token: ACCESS,
            refresh_token: REFRESH,
            expiry: "2099-01-01T00:00:00.000Z",
            scopes: [...GOOGLE_WORKSPACE_OAUTH_SCOPES],
            email: "alice@gmail.com",
          };
        },
      },
    });
  });

  afterEach(async () => {
    await store.close();
  });

  it("writes CP secrets and injects gws token without refresh on the guest", async () => {
    const complete = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/users/${userId}/connectors/google/oauth/complete`,
      {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({
          code: "auth-code",
          redirect_uri:
            "http://gws-oauth.localhost/api/connectors/google/oauth/callback",
          code_verifier: "pkce-verifier",
        }),
      },
    );
    expect(complete.status).toBe(200);
    expect(complete.body).toMatchObject({
      connector_id: "google",
      status: "connected",
      account_label: "alice@gmail.com",
    });
    expect(complete.raw).not.toContain(REFRESH);
    expect(complete.raw).not.toContain(ACCESS);

    const secrets = await store.getUserConnectorSecrets(
      tenantId,
      userId,
      "google",
    );
    expect(secrets.oauth_refresh).toBe(REFRESH);
    expect(secrets.oauth_access).toBe(ACCESS);
    expect(secrets.oauth_scopes).toEqual([...GOOGLE_WORKSPACE_OAUTH_SCOPES]);

    const binding = await store.ensureUserSandboxInstance({
      tenant_id: tenantId,
      owner_user_id: userId,
    });
    await store.updateInstanceRegistry({
      tenant_id: tenantId,
      instance_id: binding.instance_id,
      sandbox_id: "sbx-alice-gws",
      presence: "online",
    });

    const injected = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/users/${userId}/connectors/google/inject`,
      { method: "POST", headers: serviceHeaders(), body: "{}" },
    );
    expect(injected.status).toBe(200);
    expect(injected.body.injected).toBe(true);
    expect(injected.body.files).toEqual([CONNECTOR_GUEST_PATHS.google]);
    expect(guest.printenv("sbx-alice-gws")).toMatchObject({
      GOOGLE_WORKSPACE_CLI_TOKEN: ACCESS,
      GWS_ACCESS_TOKEN: ACCESS,
    });
    const cache = guest.read("sbx-alice-gws")?.files.get(
      CONNECTOR_GUEST_PATHS.google,
    );
    expect(cache?.contents).toContain(ACCESS);
    expect(cache?.contents).not.toContain(REFRESH);
  });

  it("rejects drive.file-only grants", async () => {
    app = createApp(store, {
      serviceToken: SERVICE_TOKEN,
      guestConnectorStore: guest,
      googleAuth: {
        clientId: "lanyard-google-app",
        exchangeWorkspaceCode: async () => {
          throw new InsufficientGoogleScopesError(
            "Google Drive consent is drive.file-only; full Drive is required",
          );
        },
      },
    });
    const denied = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/users/${userId}/connectors/google/oauth/complete`,
      {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({
          code: "auth-code",
          redirect_uri:
            "http://gws-oauth.localhost/api/connectors/google/oauth/callback",
          code_verifier: "pkce-verifier",
        }),
      },
    );
    expect(denied.status).toBe(400);
    expect(denied.body.error).toMatch(/drive\.file-only/);
    expect(denied.raw).not.toContain(REFRESH);
  });
});
