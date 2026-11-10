import { describe, expect, it } from "vitest";
import { HTTPException } from "hono/http-exception";

import {
  CONNECTOR_SPA_FORBIDDEN_KEYS,
  assertConnectorSpaJson,
  connectorOAuthStartState,
  hubspotPinFromEntitlements,
  parseConnectorId,
  teamGrantMatrix,
  toSpaConnectorStatus,
  toSpaTeamMemberConnector,
} from "../src/connectors.js";
import type {
  ConnectorAccess,
  ConnectorConnectionPublic,
  TenantRole,
} from "../src/control-plane-client.js";

const connection: ConnectorConnectionPublic = {
  tenant_id: "t1",
  user_id: "u1",
  connector_id: "google",
  status: "connected",
  account_label: "alice@example.com",
  hubspot_portal_id: null,
  sticky: { "gmail.read": true },
  created_at: "2026-08-21T00:00:00.000Z",
  updated_at: "2026-08-21T00:00:00.000Z",
};

describe("connector SPA DTO (lp-xhf4.3)", () => {
  it("allowlists status/account_label/sticky and drops ciphertext keys", () => {
    const access = {
      tenant_id: "t1",
      user_id: "u1",
      connector_id: "google",
      entitled: true,
      role_granted: true,
      connection: {
        ...connection,
        secrets_ciphertext: "kms-blob",
        oauth_refresh: "rtok-secret-do-not-leak",
        secrets: { oauth_refresh: "rtok-secret-do-not-leak" },
      },
    } as ConnectorAccess & { connection: Record<string, unknown> };

    const spa = toSpaConnectorStatus(access as ConnectorAccess);
    expect(spa).toEqual({
      connector_id: "google",
      label: "Google",
      status: "connected",
      account_label: "alice@example.com",
      sticky: { "gmail.read": true },
      entitled: true,
      role_granted: true,
      hubspot_portal_id: null,
    });
    expect(spa).not.toHaveProperty("oauth_refresh");
    expect(spa).not.toHaveProperty("secrets");
    expect(JSON.stringify(spa)).not.toContain("rtok-secret-do-not-leak");
    assertConnectorSpaJson(spa);
  });

  it("treats a missing connection row as not_connected", () => {
    const spa = toSpaConnectorStatus({
      tenant_id: "t1",
      user_id: "u1",
      connector_id: "whatsapp",
      entitled: false,
      role_granted: false,
      connection: null,
    });
    expect(spa.status).toBe("not_connected");
    expect(spa.account_label).toBeNull();
    expect(spa.sticky).toEqual({});
  });

  it("team rows omit entitlement bits and still hide secrets", () => {
    const row = toSpaTeamMemberConnector("google", {
      ...connection,
      oauth_access: "atok",
    } as ConnectorConnectionPublic & { oauth_access: string });
    expect(row).toEqual({
      connector_id: "google",
      status: "connected",
      account_label: "alice@example.com",
      sticky: { "gmail.read": true },
    });
    expect(row).not.toHaveProperty("entitled");
    expect(JSON.stringify(row)).not.toContain("atok");
  });

  it("builds a closed role × connector grant matrix", () => {
    const roles: TenantRole[] = [
      {
        role_id: "role-member",
        tenant_id: "t1",
        name: "member",
        hermes_profile: "contributor",
        path_prefixes: ["/"],
        created_at: "2026-08-21T00:00:00.000Z",
      },
    ];
    const grants = teamGrantMatrix(
      roles,
      new Map([
        [
          "role-member",
          [
            {
              tenant_id: "t1",
              role_id: "role-member",
              connector_id: "google",
              enabled: true,
            },
          ],
        ],
      ]),
    );
    expect(grants).toEqual([
      {
        role_id: "role-member",
        role_name: "member",
        connector_id: "google",
        enabled: true,
      },
      {
        role_id: "role-member",
        role_name: "member",
        connector_id: "hubspot",
        enabled: false,
      },
      {
        role_id: "role-member",
        role_name: "member",
        connector_id: "whatsapp",
        enabled: false,
      },
      {
        role_id: "role-member",
        role_name: "member",
        connector_id: "github",
        enabled: false,
      },
    ]);
  });

  it("rejects malformed connector ids and accepts registry slugs", () => {
    expect(() => parseConnectorId("Not A Connector")).toThrow(HTTPException);
    expect(() => parseConnectorId("")).toThrow(HTTPException);
    expect(parseConnectorId("slack")).toBe("slack");
    expect(parseConnectorId("hubspot")).toBe("hubspot");
  });

  it("labels a granted registry connector from canonical", () => {
    const spa = toSpaConnectorStatus({
      tenant_id: "t1",
      user_id: "u1",
      connector_id: "slack",
      label: "Slack",
      entitled: true,
      role_granted: true,
      connection: null,
    });
    expect(spa).toMatchObject({
      connector_id: "slack",
      label: "Slack",
      status: "not_connected",
      entitled: true,
      role_granted: true,
    });
  });

  it("binds OAuth start state to tenant + user", () => {
    expect(
      connectorOAuthStartState({
        connectorId: "google",
        tenantId: "t1",
        userId: "u1",
        threadId: "th-1",
        redirectUri: "http://demo.localhost/api/connectors/google/oauth/callback",
        codeVerifier: "pkce-verifier",
      }),
    ).toEqual({
      kind: "connector_oauth",
      connector_id: "google",
      tenant_id: "t1",
      user_id: "u1",
      thread_id: "th-1",
      redirect_uri: "http://demo.localhost/api/connectors/google/oauth/callback",
      code_verifier: "pkce-verifier",
    });
  });

  it("reads HubSpot pin from entitlements and ignores empty pins", () => {
    expect(
      hubspotPinFromEntitlements([
        { connector_id: "google", hubspot_portal_id: "nope" },
        { connector_id: "hubspot", hubspot_portal_id: "123456" },
      ]),
    ).toBe("123456");
    expect(
      hubspotPinFromEntitlements([
        { connector_id: "hubspot", hubspot_portal_id: "" },
      ]),
    ).toBeNull();
    expect(hubspotPinFromEntitlements([])).toBeNull();
  });

  it("fails closed if forbidden keys appear on SPA JSON", () => {
    for (const key of CONNECTOR_SPA_FORBIDDEN_KEYS) {
      expect(() => assertConnectorSpaJson({ [key]: "nope" })).toThrow(
        /leaked/,
      );
    }
  });
});
