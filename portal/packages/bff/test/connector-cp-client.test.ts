import { describe, expect, it, vi } from "vitest";

import {
  CONNECTOR_API_PATHS,
  CONTROL_PLANE_SERVICE_TOKEN_HEADER,
  ControlPlaneAuthClient,
} from "../src/control-plane-client.js";

describe("BFF connector CP client (lp-xhf4.2)", () => {
  const tenantId = "11111111-1111-4111-8111-111111111111";
  const userId = "22222222-2222-4222-8222-222222222222";

  it("presents the service token and maps public connection JSON without ciphertext", async () => {
    const requestFn = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get(CONTROL_PLANE_SERVICE_TOKEN_HEADER)).toBe("bff-cp");
      expect(url).toBe(
        `http://cp.test${CONNECTOR_API_PATHS.connection(tenantId, userId, "google")}`,
      );
      const posted = JSON.parse(String(init?.body ?? "{}")) as Record<
        string,
        unknown
      >;
      expect(posted.secrets).toEqual({ oauth_refresh: "rtok" });
      return Response.json({
        tenant_id: tenantId,
        user_id: userId,
        connector_id: "google",
        status: "connected",
        account_label: "alice@example.com",
        hubspot_portal_id: null,
        sticky: { "gmail.read": true },
        created_at: "2026-08-21T00:00:00.000Z",
        updated_at: "2026-08-21T00:00:00.000Z",
      });
    });

    const client = new ControlPlaneAuthClient("http://cp.test", requestFn, {
      serviceToken: "bff-cp",
    });
    const row = await client.upsertUserConnector({
      tenantId,
      userId,
      connectorId: "google",
      status: "connected",
      accountLabel: "alice@example.com",
      sticky: { "gmail.read": true },
      secrets: { oauth_refresh: "rtok" },
    });
    expect(row.connector_id).toBe("google");
    expect(row).not.toHaveProperty("secrets_ciphertext");
    expect(row).not.toHaveProperty("oauth_refresh");
    expect(row).not.toHaveProperty("secrets");
    expect(JSON.stringify(row)).not.toContain("rtok");
  });

  it("POSTs refresh onto the user-connector path", async () => {
    const requestFn = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(
        `http://cp.test${CONNECTOR_API_PATHS.connectionRefresh(tenantId, userId, "google")}`,
      );
      expect(init?.method).toBe("POST");
      return Response.json({
        connector_id: "google",
        status: "needs_reauth",
        account_label: "alice@example.com",
        wizard: true,
      });
    });
    const client = new ControlPlaneAuthClient("http://cp.test", requestFn, {
      serviceToken: "bff-cp",
    });
    const result = await client.refreshUserConnector({
      tenantId,
      userId,
      connectorId: "google",
    });
    expect(result.wizard).toBe(true);
    expect(result.status).toBe("needs_reauth");
  });

  it("POSTs lazy inject onto the user-connector path", async () => {
    const requestFn = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(
        `http://cp.test${CONNECTOR_API_PATHS.connectionInject(tenantId, userId, "whatsapp")}`,
      );
      expect(init?.method).toBe("POST");
      return Response.json({
        instance_id: "inst-user",
        owner_user_id: userId,
        connector_id: "whatsapp",
        sandbox_id: "sbx-1",
        injected: true,
        reason: "injected",
        skip_oauth: true,
        files: ["/var/lib/company-brain-backend/wacli/session.db"],
      });
    });
    const client = new ControlPlaneAuthClient("http://cp.test", requestFn, {
      serviceToken: "bff-cp",
    });
    const result = await client.injectUserConnector({
      tenantId,
      userId,
      connectorId: "whatsapp",
      sandboxDestroyed: true,
    });
    expect(result.injected).toBe(true);
    expect(result.skip_oauth).toBe(true);
    expect(result.files).toHaveLength(1);
  });

  it("POSTs Google OAuth complete without exposing refresh on the public row", async () => {
    const requestFn = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(
        `http://cp.test${CONNECTOR_API_PATHS.connectionOAuthComplete(tenantId, userId, "google")}`,
      );
      expect(init?.method).toBe("POST");
      const posted = JSON.parse(String(init?.body ?? "{}")) as Record<
        string,
        unknown
      >;
      expect(posted).toEqual({
        code: "auth-code",
        redirect_uri: "http://demo.localhost/api/connectors/google/oauth/callback",
        code_verifier: "pkce-verifier",
      });
      return Response.json({
        tenant_id: tenantId,
        user_id: userId,
        connector_id: "google",
        status: "connected",
        account_label: "alice@gmail.com",
        hubspot_portal_id: null,
        sticky: {},
        created_at: "2026-08-21T00:00:00.000Z",
        updated_at: "2026-08-21T00:00:00.000Z",
      });
    });
    const client = new ControlPlaneAuthClient("http://cp.test", requestFn, {
      serviceToken: "bff-cp",
    });
    const row = await client.completeConnectorOAuth({
      tenantId,
      userId,
      connectorId: "google",
      code: "auth-code",
      redirectUri: "http://demo.localhost/api/connectors/google/oauth/callback",
      codeVerifier: "pkce-verifier",
    });
    expect(row.account_label).toBe("alice@gmail.com");
    expect(row).not.toHaveProperty("oauth_refresh");
  });
});
