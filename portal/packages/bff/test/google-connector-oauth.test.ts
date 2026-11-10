import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_DRIVE_SCOPE,
  GOOGLE_OAUTH_AUTHORIZE_URL,
  GOOGLE_WORKSPACE_OAUTH_SCOPES,
  buildGoogleConnectorAuthorizeUrl,
  connectorGoogleOAuthState,
  connectorOAuthCallbackHtml,
  connectorOAuthCallbackJson,
  createPkcePair,
  googleAuthorizeUrlIncludesWorkspaceScopes,
  parseConnectorGoogleOAuthState,
} from "../src/google-connector-oauth.js";
import { signOAuthState, verifyOAuthState } from "../src/session.js";

describe("Google connector PKCE + scopes (lp-xhf4.7)", () => {
  it("binds S256 verifier into signed state", () => {
    const pkce = createPkcePair();
    expect(pkce.method).toBe("S256");
    expect(pkce.challenge).toBe(
      createHash("sha256").update(pkce.verifier).digest("base64url"),
    );
    const raw = connectorGoogleOAuthState({
      tenantId: "t1",
      userId: "u1",
      redirectUri: "http://demo.localhost/api/connectors/google/oauth/callback",
      codeVerifier: pkce.verifier,
      threadId: "th-1",
    });
    const signed = signOAuthState(raw, "test-session-secret");
    const parsed = parseConnectorGoogleOAuthState(
      verifyOAuthState(signed, "test-session-secret"),
    );
    expect(parsed).toMatchObject({
      kind: "connector_oauth",
      connector_id: "google",
      tenant_id: "t1",
      user_id: "u1",
      thread_id: "th-1",
      code_verifier: pkce.verifier,
    });
    expect(
      parseConnectorGoogleOAuthState(
        verifyOAuthState(signed, "wrong-secret"),
      ),
    ).toBeNull();
  });

  it("authorize URL asks for Gmail + Calendar + full Drive, not drive.file", () => {
    const url = buildGoogleConnectorAuthorizeUrl({
      clientId: "lanyard-google-app",
      redirectUri: "http://demo.localhost/api/connectors/google/oauth/callback",
      state: "signed-state",
      codeChallenge: "challenge",
    });
    expect(url.startsWith(GOOGLE_OAUTH_AUTHORIZE_URL)).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("access_type")).toBe("offline");
    expect(parsed.searchParams.get("include_granted_scopes")).toBe("false");
    const scope = parsed.searchParams.get("scope") ?? "";
    expect(scope).toContain("gmail.send");
    expect(scope).toContain("calendar.events");
    expect(scope).toContain(GOOGLE_DRIVE_SCOPE);
    expect(scope).not.toContain(GOOGLE_DRIVE_FILE_SCOPE);
    expect(googleAuthorizeUrlIncludesWorkspaceScopes(url)).toBe(true);
    expect(GOOGLE_WORKSPACE_OAUTH_SCOPES).toHaveLength(8);
  });

  it("callback HTML/JSON omit refresh tokens", () => {
    const json = connectorOAuthCallbackJson({
      connector_id: "google",
      status: "connected",
      account_label: "alice@gmail.com",
    });
    expect(json).toEqual({
      connector_id: "google",
      status: "connected",
      account_label: "alice@gmail.com",
    });
    expect(JSON.stringify(json)).not.toMatch(/refresh/i);
    const html = connectorOAuthCallbackHtml({
      connector_id: "google",
      status: "connected",
      account_label: "alice@gmail.com",
    });
    expect(html).toContain("You can close this tab.");
    expect(html).toContain("lanyard.connector.oauth");
    expect(html).toContain("alice@gmail.com");
    expect(html).not.toMatch(/refresh_token|oauth_refresh|code_verifier/);
  });
});
