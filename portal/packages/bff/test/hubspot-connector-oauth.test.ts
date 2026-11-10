import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CONNECTOR_OAUTH_MESSAGE_TYPE,
  connectorOAuthCallbackHtml,
  connectorOAuthCallbackJson,
  connectorOAuthState,
  createPkcePair,
  parseConnectorOAuthState,
} from "../src/connector-oauth.js";
import { hubspotPinFromEntitlements } from "../src/connectors.js";
import {
  HUBSPOT_OAUTH_AUTHORIZE_URL,
  HUBSPOT_OAUTH_SCOPES,
  buildHubSpotConnectorAuthorizeUrl,
  hubspotAuthorizeUrlIncludesCrmScopes,
} from "../src/hubspot-connector-oauth.js";
import { signOAuthState, verifyOAuthState } from "../src/session.js";

describe("HubSpot connector PKCE + scopes (lp-xhf4.10)", () => {
  it("binds S256 verifier into signed state", () => {
    const pkce = createPkcePair();
    expect(pkce.method).toBe("S256");
    expect(pkce.challenge).toBe(
      createHash("sha256").update(pkce.verifier).digest("base64url"),
    );
    const raw = connectorOAuthState({
      connectorId: "hubspot",
      tenantId: "t1",
      userId: "u1",
      redirectUri: "http://demo.localhost/api/connectors/hubspot/oauth/callback",
      codeVerifier: pkce.verifier,
      threadId: "th-1",
    });
    const signed = signOAuthState(raw, "test-session-secret");
    const parsed = parseConnectorOAuthState(
      verifyOAuthState(signed, "test-session-secret"),
      "hubspot",
    );
    expect(parsed).toMatchObject({
      kind: "connector_oauth",
      connector_id: "hubspot",
      tenant_id: "t1",
      user_id: "u1",
      thread_id: "th-1",
      code_verifier: pkce.verifier,
    });
    expect(
      parseConnectorOAuthState(
        verifyOAuthState(signed, "wrong-secret"),
        "hubspot",
      ),
    ).toBeNull();
  });

  it("authorize URL asks for six CRM objects + identity, not settings", () => {
    const url = buildHubSpotConnectorAuthorizeUrl({
      clientId: "lanyard-hubspot-app",
      redirectUri: "http://demo.localhost/api/connectors/hubspot/oauth/callback",
      state: "signed-state",
      codeChallenge: "challenge",
    });
    expect(url.startsWith(HUBSPOT_OAUTH_AUTHORIZE_URL)).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    const scope = parsed.searchParams.get("scope") ?? "";
    expect(scope).toContain("crm.objects.contacts.write");
    expect(scope).toContain("crm.objects.companies.read");
    expect(scope).toContain("crm.objects.deals.write");
    expect(scope).toContain("oauth");
    expect(scope).not.toContain("settings");
    expect(hubspotAuthorizeUrlIncludesCrmScopes(url)).toBe(true);
    expect(HUBSPOT_OAUTH_SCOPES).toContain("crm.objects.contacts.read");
  });

  it("callback HTML/JSON omit refresh tokens", () => {
    const json = connectorOAuthCallbackJson({
      connector_id: "hubspot",
      status: "connected",
      account_label: "alice@hub.test (62515)",
    });
    expect(json).toEqual({
      connector_id: "hubspot",
      status: "connected",
      account_label: "alice@hub.test (62515)",
    });
    expect(JSON.stringify(json)).not.toMatch(/refresh/i);
    const html = connectorOAuthCallbackHtml({
      connector_id: "hubspot",
      status: "connected",
      account_label: "alice@hub.test (62515)",
    });
    expect(html).toContain("You can close this tab.");
    expect(html).toContain(CONNECTOR_OAUTH_MESSAGE_TYPE);
    expect(html).toContain("alice@hub.test (62515)");
    expect(html).not.toMatch(/refresh_token|oauth_refresh|code_verifier/);
  });

  it("reads the tenant pin from entitlements without tokens", () => {
    expect(
      hubspotPinFromEntitlements([
        { connector_id: "google", hubspot_portal_id: null },
        { connector_id: "hubspot", hubspot_portal_id: "62515" },
      ]),
    ).toBe("62515");
    expect(
      hubspotPinFromEntitlements([
        { connector_id: "hubspot", hubspot_portal_id: null },
      ]),
    ).toBeNull();
  });
});
