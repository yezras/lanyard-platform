/**
 * lp-xhf4.10 — HubSpot OAuth complete pins portal id; mismatch fails closed;
 * grant off is not ACL; clear pin keeps tokens.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import {
  CONNECTOR_GUEST_PATHS,
  createInMemoryGuestConnectorStore,
} from "../src/connector-user-sandbox.js";
import {
  HUBSPOT_OAUTH_SCOPES,
  InsufficientHubSpotScopesError,
} from "../src/hubspot-oauth.js";
import { CONTROL_PLANE_SERVICE_TOKEN_HEADER } from "../src/service-auth.js";
import { ControlPlaneStore } from "../src/store.js";
import { createTestStore } from "./pg-test-store.js";

type JsonBody = Record<string, unknown>;

const SERVICE_TOKEN = "test-cp-service-token";
const REFRESH = "hubspot-refresh-token-plain";
const ACCESS = "hubspot-access-token-plain";
const FULL_SCOPES = [...HUBSPOT_OAUTH_SCOPES];

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

describe("HubSpot connector OAuth complete (lp-xhf4.10)", () => {
  let store: ControlPlaneStore;
  let guest: ReturnType<typeof createInMemoryGuestConnectorStore>;
  let app: ReturnType<typeof createApp>;
  let tenantId = "";
  let userId = "";
  let otherUserId = "";
  let roleId = "";
  let exchangePortal = "62515";

  beforeEach(async () => {
    store = await createTestStore();
    guest = createInMemoryGuestConnectorStore();
    const tenant = await store.createTenant({
      slug: "hs-oauth",
      display_name: "HubSpot OAuth",
    });
    tenantId = tenant.tenant_id;
    userId = (
      await store.registerUser({
        tenant_id: tenantId,
        email: "alice@hs.test",
        password: "password123",
      })
    ).user_id;
    otherUserId = (
      await store.registerUser({
        tenant_id: tenantId,
        email: "bob@hs.test",
        password: "password123",
      })
    ).user_id;
    const role = await store.createRole({
      tenant_id: tenantId,
      name: "member",
      hermes_profile: "contributor",
      path_prefixes: ["/"],
    });
    roleId = role.role_id;
    await store.setUserRoles({
      tenant_id: tenantId,
      user_id: userId,
      role_ids: [roleId],
    });
    await store.setUserRoles({
      tenant_id: tenantId,
      user_id: otherUserId,
      role_ids: [roleId],
    });
    await store.upsertTenantConnectorEntitlement({
      tenant_id: tenantId,
      connector_id: "hubspot",
      enabled: true,
    });
    await store.upsertRoleConnectorGrant({
      tenant_id: tenantId,
      role_id: roleId,
      connector_id: "hubspot",
      enabled: true,
    });
    exchangePortal = "62515";
    app = createApp(store, {
      serviceToken: SERVICE_TOKEN,
      guestConnectorStore: guest,
      hubspotAuth: {
        clientId: "lanyard-hubspot-app",
        exchangeCode: async ({ codeVerifier }) => {
          expect(codeVerifier).toBe("pkce-verifier");
          return {
            access_token: ACCESS,
            refresh_token: REFRESH,
            expiry: "2099-01-01T00:00:00.000Z",
            scopes: FULL_SCOPES,
            email: "alice@hub.test",
            portal_id: exchangePortal,
          };
        },
      },
    });
  });

  afterEach(async () => {
    await store.close();
  });

  async function completeOAuth(uid: string): Promise<{
    status: number;
    body: JsonBody;
    raw: string;
  }> {
    return jsonRequest(
      app,
      `/internal/tenants/${tenantId}/users/${uid}/connectors/hubspot/oauth/complete`,
      {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({
          code: "auth-code",
          redirect_uri:
            "http://hs-oauth.localhost/api/connectors/hubspot/oauth/callback",
          code_verifier: "pkce-verifier",
        }),
      },
    );
  }

  it("writes CP secrets, pins portal, and injects without refresh on the guest", async () => {
    const complete = await completeOAuth(userId);
    expect(complete.status).toBe(200);
    expect(complete.body).toMatchObject({
      connector_id: "hubspot",
      status: "connected",
      account_label: "alice@hub.test (62515)",
      hubspot_portal_id: "62515",
    });
    expect(complete.raw).not.toContain(REFRESH);
    expect(complete.raw).not.toContain(ACCESS);

    const entitlement = await store.getTenantConnectorEntitlement(
      tenantId,
      "hubspot",
    );
    expect(entitlement?.hubspot_portal_id).toBe("62515");

    const secrets = await store.getUserConnectorSecrets(
      tenantId,
      userId,
      "hubspot",
    );
    expect(secrets.oauth_refresh).toBe(REFRESH);
    expect(secrets.oauth_access).toBe(ACCESS);
    expect(secrets.oauth_scopes).toEqual(FULL_SCOPES);

    const binding = await store.ensureUserSandboxInstance({
      tenant_id: tenantId,
      owner_user_id: userId,
    });
    await store.updateInstanceRegistry({
      tenant_id: tenantId,
      instance_id: binding.instance_id,
      sandbox_id: "sbx-alice-hs",
      presence: "online",
    });

    const injected = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/users/${userId}/connectors/hubspot/inject`,
      { method: "POST", headers: serviceHeaders(), body: "{}" },
    );
    expect(injected.status).toBe(200);
    expect(injected.body.injected).toBe(true);
    expect(injected.body.files).toEqual([CONNECTOR_GUEST_PATHS.hubspot]);
    expect(guest.printenv("sbx-alice-hs")).toMatchObject({
      HUBSPOT_ACCESS_TOKEN: ACCESS,
    });
    const cache = guest.read("sbx-alice-hs")?.files.get(
      CONNECTOR_GUEST_PATHS.hubspot,
    );
    expect(cache?.contents).toBe(ACCESS);
    expect(cache?.contents).not.toContain(REFRESH);
  });

  it("rejects a second user whose HubSpot portal mismatches the pin", async () => {
    const first = await completeOAuth(userId);
    expect(first.status).toBe(200);
    exchangePortal = "999999";
    const denied = await completeOAuth(otherUserId);
    expect(denied.status).toBe(409);
    expect(String(denied.body.error)).toMatch(/does not match tenant pin/);
    expect(denied.raw).not.toContain(REFRESH);

    const other = await store.getUserConnectorConnection(
      tenantId,
      otherUserId,
      "hubspot",
    );
    expect(other).toBeNull();
    const pin = await store.getTenantConnectorEntitlement(tenantId, "hubspot");
    expect(pin?.hubspot_portal_id).toBe("62515");
  });

  it("clears the pin without deleting tokens", async () => {
    const first = await completeOAuth(userId);
    expect(first.status).toBe(200);
    const cleared = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/connector-entitlements/hubspot`,
      {
        method: "PUT",
        headers: serviceHeaders(),
        body: JSON.stringify({
          enabled: true,
          hubspot_portal_id: null,
        }),
      },
    );
    expect(cleared.status).toBe(200);
    expect(cleared.body.hubspot_portal_id).toBeNull();
    const secrets = await store.getUserConnectorSecrets(
      tenantId,
      userId,
      "hubspot",
    );
    expect(secrets.oauth_refresh).toBe(REFRESH);
    const row = await store.getUserConnectorConnection(
      tenantId,
      userId,
      "hubspot",
    );
    expect(row?.status).toBe("connected");
    expect(row?.hubspot_portal_id).toBeNull();
  });

  it("keeps the connection row when the role grant turns off", async () => {
    const first = await completeOAuth(userId);
    expect(first.status).toBe(200);
    const off = await jsonRequest(
      app,
      `/internal/tenants/${tenantId}/roles/${roleId}/connector-grants/hubspot`,
      {
        method: "PUT",
        headers: serviceHeaders(),
        body: JSON.stringify({ enabled: false }),
      },
    );
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({
      connector_id: "hubspot",
      enabled: false,
    });
    const row = await store.getUserConnectorConnection(
      tenantId,
      userId,
      "hubspot",
    );
    expect(row?.status).toBe("connected");
    const secrets = await store.getUserConnectorSecrets(
      tenantId,
      userId,
      "hubspot",
    );
    expect(secrets.oauth_refresh).toBe(REFRESH);
  });

  it("rejects incomplete CRM consent", async () => {
    app = createApp(store, {
      serviceToken: SERVICE_TOKEN,
      guestConnectorStore: guest,
      hubspotAuth: {
        clientId: "lanyard-hubspot-app",
        exchangeCode: async () => {
          throw new InsufficientHubSpotScopesError(
            "HubSpot consent missing scopes: crm.objects.deals.write",
          );
        },
      },
    });
    const denied = await completeOAuth(userId);
    expect(denied.status).toBe(400);
    expect(String(denied.body.error)).toMatch(/missing scopes/);
    expect(denied.raw).not.toContain(REFRESH);
  });
});
