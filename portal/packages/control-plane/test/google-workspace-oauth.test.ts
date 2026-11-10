import { describe, expect, it } from "vitest";

import {
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_DRIVE_SCOPE,
  GOOGLE_WORKSPACE_OAUTH_SCOPES,
  GoogleWorkspaceGrantError,
  InsufficientGoogleScopesError,
  completeGoogleConnectorOAuth,
  connectorSecretsFromGoogleGrant,
  googleConsentCoversWorkspace,
  googleWorkspaceScopeParam,
  gwsAccessTokenEnv,
  parseGoogleWorkspaceTokenResponse,
} from "../src/google-workspace-oauth.js";

const FULL_SCOPES = [...GOOGLE_WORKSPACE_OAUTH_SCOPES];

describe("Google Workspace consent (lp-xhf4.7)", () => {
  it("includes Gmail, Calendar, and full Drive, not drive.file-only", () => {
    const param = googleWorkspaceScopeParam();
    expect(param).toContain("gmail.readonly");
    expect(param).toContain("gmail.compose");
    expect(param).toContain("gmail.send");
    expect(param).toContain("calendar.readonly");
    expect(param).toContain("calendar.events");
    expect(param).toContain(GOOGLE_DRIVE_SCOPE);
    expect(param).not.toContain("drive.file");
    expect(GOOGLE_WORKSPACE_OAUTH_SCOPES).not.toContain(GOOGLE_DRIVE_FILE_SCOPE);
    expect(googleConsentCoversWorkspace(FULL_SCOPES)).toEqual({ ok: true });
  });

  it("rejects drive.file as the only Drive scope", () => {
    const granted = FULL_SCOPES.filter((scope) => scope !== GOOGLE_DRIVE_SCOPE);
    granted.push(GOOGLE_DRIVE_FILE_SCOPE);
    const result = googleConsentCoversWorkspace(granted);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/drive\.file-only/);
    }
  });

  it("rejects missing Gmail send", () => {
    const granted = FULL_SCOPES.filter(
      (scope) => scope !== "https://www.googleapis.com/auth/gmail.send",
    );
    const result = googleConsentCoversWorkspace(granted);
    expect(result.ok).toBe(false);
  });
});

describe("parseGoogleWorkspaceTokenResponse", () => {
  it("requires refresh token and workspace scopes", () => {
    const grant = parseGoogleWorkspaceTokenResponse(
      {
        access_token: "atok",
        refresh_token: "rtok-secret",
        expires_in: 3600,
        scope: googleWorkspaceScopeParam(),
        id_token: "not-inspected-here",
      },
      { sub: "sub-1", email: "Ada@Example.com" },
      new Date("2026-08-21T00:00:00.000Z"),
    );
    expect(grant.email).toBe("ada@example.com");
    expect(grant.refresh_token).toBe("rtok-secret");
    expect(grant.expiry).toBe("2026-08-21T01:00:00.000Z");
    const secrets = connectorSecretsFromGoogleGrant(grant);
    expect(secrets.oauth_refresh).toBe("rtok-secret");
    expect(gwsAccessTokenEnv(grant.access_token)).toEqual({
      GOOGLE_WORKSPACE_CLI_TOKEN: "atok",
    });
  });

  it("fails closed without refresh_token", () => {
    expect(() =>
      parseGoogleWorkspaceTokenResponse(
        {
          access_token: "atok",
          scope: googleWorkspaceScopeParam(),
        },
        { sub: "sub-1", email: "ada@example.com" },
      ),
    ).toThrow(GoogleWorkspaceGrantError);
  });

  it("fails closed on drive.file-only grants", () => {
    expect(() =>
      parseGoogleWorkspaceTokenResponse(
        {
          access_token: "atok",
          refresh_token: "rtok",
          scope: `openid email ${GOOGLE_DRIVE_FILE_SCOPE}`,
        },
        { sub: "sub-1", email: "ada@example.com" },
      ),
    ).toThrow(InsufficientGoogleScopesError);
  });
});

describe("completeGoogleConnectorOAuth", () => {
  it("writes CP connection with email label and does not return refresh", async () => {
    const refresh = "rtok-secret-do-not-leak";
    const connection = await completeGoogleConnectorOAuth({
      tenant_id: "t1",
      user_id: "u1",
      code: "auth-code",
      redirect_uri: "http://demo.localhost/api/connectors/google/oauth/callback",
      code_verifier: "verifier-1",
      ports: {
        exchange: async (input) => {
          expect(input.code).toBe("auth-code");
          expect(input.codeVerifier).toBe("verifier-1");
          return {
            access_token: "atok",
            refresh_token: refresh,
            expiry: "2026-08-21T01:00:00.000Z",
            scopes: FULL_SCOPES,
            email: "alice@gmail.com",
          };
        },
        upsert: async (input) => {
          expect(input.account_label).toBe("alice@gmail.com");
          expect(input.status).toBe("connected");
          expect(input.secrets.oauth_refresh).toBe(refresh);
          expect(input.replace_secrets).toBe(true);
          return {
            tenant_id: input.tenant_id,
            user_id: input.user_id,
            connector_id: "google",
            status: "connected",
            account_label: input.account_label,
            hubspot_portal_id: null,
            sticky: {},
            created_at: "2026-08-21T00:00:00.000Z",
            updated_at: "2026-08-21T00:00:00.000Z",
          };
        },
        ensureUserSandbox: async () => ({ created: true }),
      },
    });
    expect(connection.account_label).toBe("alice@gmail.com");
    expect(JSON.stringify(connection)).not.toContain(refresh);
  });
});
