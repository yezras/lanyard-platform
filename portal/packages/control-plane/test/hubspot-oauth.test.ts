import { describe, expect, it } from "vitest";

import { parseSticky } from "../src/connectors.js";
import {
  HUBSPOT_CRM_OBJECTS,
  HUBSPOT_OAUTH_SCOPES,
  HubSpotGrantError,
  HubSpotPortalPinMismatchError,
  InsufficientHubSpotScopesError,
  applyHubSpotPortalPin,
  clearHubSpotPortalPin,
  completeHubSpotConnectorOAuth,
  connectorSecretsFromHubSpotGrant,
  decideHubSpotPortalPin,
  hubspotAccessTokenEnv,
  hubspotAccountLabel,
  hubspotConsentCoversCrm,
  hubspotOauthRequestsForbiddenScope,
  hubspotOauthScopeParam,
  hubspotWriteIsEveryCall,
  parseHubSpotTokenAndInfo,
} from "../src/hubspot-oauth.js";

const FULL_SCOPES = [...HUBSPOT_OAUTH_SCOPES];

describe("HubSpot consent (lp-xhf4.10)", () => {
  it("covers contacts, companies, deals, notes, tasks, meetings + identity", () => {
    expect([...HUBSPOT_CRM_OBJECTS]).toEqual([
      "contacts",
      "companies",
      "deals",
      "notes",
      "tasks",
      "meetings",
    ]);
    const param = hubspotOauthScopeParam();
    expect(param).toContain("crm.objects.contacts.read");
    expect(param).toContain("crm.objects.contacts.write");
    expect(param).toContain("crm.objects.companies.read");
    expect(param).toContain("crm.objects.deals.write");
    expect(param).toContain("oauth");
    expect(param).not.toContain("settings");
    expect(param).not.toMatch(/marketing/);
    expect(hubspotOauthRequestsForbiddenScope()).toBe(false);
    expect(hubspotConsentCoversCrm(FULL_SCOPES)).toEqual({ ok: true });
  });

  it("rejects missing contacts write", () => {
    const granted = FULL_SCOPES.filter(
      (scope) => scope !== "crm.objects.contacts.write",
    );
    const result = hubspotConsentCoversCrm(granted);
    expect(result.ok).toBe(false);
  });

  it("hubspot.write is every_call; hubspot.read can be sticky", () => {
    expect(hubspotWriteIsEveryCall()).toBe(true);
    expect(parseSticky({ "hubspot.read": true })).toEqual({
      "hubspot.read": true,
    });
    expect(() => parseSticky({ "hubspot.write": true })).toThrow(
      /every_call/,
    );
  });
});

describe("HubSpot portal pin", () => {
  it("sets on first connect and matches later", () => {
    expect(decideHubSpotPortalPin(null, "123456")).toEqual({
      kind: "set",
      portal_id: "123456",
    });
    expect(applyHubSpotPortalPin("123456", "123456")).toEqual({
      kind: "match",
      portal_id: "123456",
    });
  });

  it("fails closed on mismatch", () => {
    expect(decideHubSpotPortalPin("111", "222")).toEqual({
      kind: "mismatch",
      portal_id: "222",
      pinned: "111",
    });
    expect(() => applyHubSpotPortalPin("111", "222")).toThrow(
      HubSpotPortalPinMismatchError,
    );
  });
});

describe("parseHubSpotTokenAndInfo", () => {
  it("requires refresh, portal id, and CRM scopes", () => {
    const grant = parseHubSpotTokenAndInfo(
      {
        access_token: "hs-atok",
        refresh_token: "hs-rtok-secret",
        expires_in: 1800,
      },
      {
        user: "Ada@Example.com",
        hub_id: 62515,
        scopes: FULL_SCOPES,
      },
      new Date("2026-08-21T00:00:00.000Z"),
    );
    expect(grant.email).toBe("ada@example.com");
    expect(grant.portal_id).toBe("62515");
    expect(grant.expiry).toBe("2026-08-21T00:30:00.000Z");
    const secrets = connectorSecretsFromHubSpotGrant(grant);
    expect(secrets.oauth_refresh).toBe("hs-rtok-secret");
    expect(hubspotAccessTokenEnv(grant.access_token)).toEqual({
      HUBSPOT_ACCESS_TOKEN: "hs-atok",
    });
    expect(hubspotAccountLabel(grant.email, grant.portal_id)).toBe(
      "ada@example.com (62515)",
    );
  });

  it("fails closed without refresh_token", () => {
    expect(() =>
      parseHubSpotTokenAndInfo(
        { access_token: "hs-atok" },
        { user: "ada@example.com", hub_id: 1, scopes: FULL_SCOPES },
      ),
    ).toThrow(HubSpotGrantError);
  });

  it("fails closed on incomplete CRM scopes", () => {
    expect(() =>
      parseHubSpotTokenAndInfo(
        {
          access_token: "hs-atok",
          refresh_token: "hs-rtok",
        },
        {
          user: "ada@example.com",
          hub_id: 1,
          scopes: ["oauth", "crm.objects.contacts.read"],
        },
      ),
    ).toThrow(InsufficientHubSpotScopesError);
  });
});

describe("completeHubSpotConnectorOAuth", () => {
  it("pins on first connect and does not return refresh", async () => {
    const refresh = "hs-rtok-secret-do-not-leak";
    let pinned: string | null = null;
    const connection = await completeHubSpotConnectorOAuth({
      tenant_id: "t1",
      user_id: "u1",
      code: "auth-code",
      redirect_uri: "http://demo.localhost/api/connectors/hubspot/oauth/callback",
      code_verifier: "verifier-1",
      ports: {
        exchange: async (input) => {
          expect(input.code).toBe("auth-code");
          expect(input.codeVerifier).toBe("verifier-1");
          return {
            access_token: "hs-atok",
            refresh_token: refresh,
            expiry: "2026-08-21T00:30:00.000Z",
            scopes: FULL_SCOPES,
            email: "alice@hub.test",
            portal_id: "62515",
          };
        },
        getAccess: async () => ({
          tenant_id: "t1",
          user_id: "u1",
          connector_id: "hubspot",
          entitled: true,
          role_granted: true,
          connection: null,
        }),
        getEntitlement: async () =>
          pinned
            ? {
                tenant_id: "t1",
                connector_id: "hubspot",
                enabled: true,
                hubspot_portal_id: pinned,
                created_at: "2026-08-21T00:00:00.000Z",
                updated_at: "2026-08-21T00:00:00.000Z",
              }
            : {
                tenant_id: "t1",
                connector_id: "hubspot",
                enabled: true,
                hubspot_portal_id: null,
                created_at: "2026-08-21T00:00:00.000Z",
                updated_at: "2026-08-21T00:00:00.000Z",
              },
        upsertEntitlement: async (input) => {
          pinned = input.hubspot_portal_id;
          return {
            tenant_id: input.tenant_id,
            connector_id: "hubspot",
            enabled: input.enabled,
            hubspot_portal_id: input.hubspot_portal_id,
            created_at: "2026-08-21T00:00:00.000Z",
            updated_at: "2026-08-21T00:00:00.000Z",
          };
        },
        upsert: async (input) => {
          expect(input.account_label).toBe("alice@hub.test (62515)");
          expect(input.secrets.oauth_refresh).toBe(refresh);
          return {
            tenant_id: input.tenant_id,
            user_id: input.user_id,
            connector_id: "hubspot",
            status: "connected",
            account_label: input.account_label,
            hubspot_portal_id: pinned,
            sticky: {},
            created_at: "2026-08-21T00:00:00.000Z",
            updated_at: "2026-08-21T00:00:00.000Z",
          };
        },
        ensureUserSandbox: async () => ({ created: true }),
      },
    });
    expect(pinned).toBe("62515");
    expect(connection.account_label).toBe("alice@hub.test (62515)");
    expect(JSON.stringify(connection)).not.toContain(refresh);
  });

  it("rejects a second user on the wrong portal without writing", async () => {
    let upserted = false;
    await expect(
      completeHubSpotConnectorOAuth({
        tenant_id: "t1",
        user_id: "u2",
        code: "auth-code",
        redirect_uri:
          "http://demo.localhost/api/connectors/hubspot/oauth/callback",
        code_verifier: "verifier-2",
        ports: {
          exchange: async () => ({
            access_token: "hs-atok-2",
            refresh_token: "hs-rtok-2",
            expiry: "2026-08-21T00:30:00.000Z",
            scopes: FULL_SCOPES,
            email: "bob@other.test",
            portal_id: "999",
          }),
          getAccess: async () => ({
            tenant_id: "t1",
            user_id: "u2",
            connector_id: "hubspot",
            entitled: true,
            role_granted: true,
            connection: null,
          }),
          getEntitlement: async () => ({
            tenant_id: "t1",
            connector_id: "hubspot",
            enabled: true,
            hubspot_portal_id: "62515",
            created_at: "2026-08-21T00:00:00.000Z",
            updated_at: "2026-08-21T00:00:00.000Z",
          }),
          upsertEntitlement: async () => {
            throw new Error("must not rewrite pin");
          },
          upsert: async () => {
            upserted = true;
            throw new Error("must not write connection");
          },
          ensureUserSandbox: async () => {
            throw new Error("must not provision");
          },
        },
      }),
    ).rejects.toBeInstanceOf(HubSpotPortalPinMismatchError);
    expect(upserted).toBe(false);
  });
});

describe("clearHubSpotPortalPin", () => {
  it("clears the pin without touching tokens", async () => {
    let secretsTouched = false;
    const result = await clearHubSpotPortalPin({
      tenant_id: "t1",
      ports: {
        getEntitlement: async () => ({
          tenant_id: "t1",
          connector_id: "hubspot",
          enabled: true,
          hubspot_portal_id: "62515",
          created_at: "2026-08-21T00:00:00.000Z",
          updated_at: "2026-08-21T00:00:00.000Z",
        }),
        upsertEntitlement: async (input) => {
          expect(input.hubspot_portal_id).toBeNull();
          expect(input.enabled).toBe(true);
          secretsTouched = false;
          return {
            tenant_id: input.tenant_id,
            connector_id: "hubspot",
            enabled: true,
            hubspot_portal_id: null,
            created_at: "2026-08-21T00:00:00.000Z",
            updated_at: "2026-08-21T00:00:00.000Z",
          };
        },
      },
    });
    expect(result).toEqual({ hubspot_portal_id: null });
    expect(secretsTouched).toBe(false);
  });
});
