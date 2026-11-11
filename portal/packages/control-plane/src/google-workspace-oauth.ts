/**
 * Google Workspace connector OAuth (lp-xhf4.7).
 *
 * One Lanyard-owned Google app. Scopes are closed: Gmail + Calendar + full
 * Drive. `drive.file` alone cannot search existing company folders.
 *
 * Token grant is parsed at the Google boundary. CP stores ciphertext.
 * Guest inject gets a short-lived access token only.
 */

import type {
  ConnectorConnectionPublic,
  ConnectorSecrets,
} from "./connectors.js";
import type { GoogleProfile } from "./google-auth.js";

export const GOOGLE_OAUTH_AUTHORIZE_URL =
  "https://accounts.google.com/o/oauth2/v2/auth" as const;

export const GOOGLE_OAUTH_TOKEN_URL =
  "https://oauth2.googleapis.com/token" as const;

export const GOOGLE_DRIVE_SCOPE =
  "https://www.googleapis.com/auth/drive" as const;

export const GOOGLE_DRIVE_FILE_SCOPE =
  "https://www.googleapis.com/auth/drive.file" as const;

/** Fixed v1 Google consent. Not per-role. */
export const GOOGLE_WORKSPACE_OAUTH_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  GOOGLE_DRIVE_SCOPE,
] as const;

export type GoogleWorkspaceOauthScope =
  (typeof GOOGLE_WORKSPACE_OAUTH_SCOPES)[number];

const EMAIL_SCOPE_ALIASES = new Set([
  "email",
  "https://www.googleapis.com/auth/userinfo.email",
]);

export type GoogleWorkspaceTokenGrant = {
  access_token: string;
  refresh_token: string;
  expiry: string;
  scopes: string[];
  email: string;
};

export class InsufficientGoogleScopesError extends Error {
  readonly code = "INSUFFICIENT_GOOGLE_SCOPES" as const;

  constructor(message: string) {
    super(message);
    this.name = "InsufficientGoogleScopesError";
  }
}

export class GoogleWorkspaceGrantError extends Error {
  readonly code = "GOOGLE_WORKSPACE_GRANT" as const;

  constructor(message: string) {
    super(message);
    this.name = "GoogleWorkspaceGrantError";
  }
}

export function googleWorkspaceScopeParam(): string {
  return GOOGLE_WORKSPACE_OAUTH_SCOPES.join(" ");
}

export function parseGrantedGoogleScopes(
  scope: string | string[] | undefined | null,
): string[] {
  if (scope == null) {
    return [];
  }
  const raw = Array.isArray(scope) ? scope.join(" ") : scope;
  return raw
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function grantHasScope(granted: ReadonlySet<string>, required: string): boolean {
  if (granted.has(required)) {
    return true;
  }
  if (required === "email") {
    for (const alias of EMAIL_SCOPE_ALIASES) {
      if (granted.has(alias)) return true;
    }
  }
  return false;
}

export function googleConsentCoversWorkspace(
  granted: readonly string[],
): { ok: true } | { ok: false; reason: string } {
  const set = new Set(granted);
  if (set.has(GOOGLE_DRIVE_FILE_SCOPE) && !set.has(GOOGLE_DRIVE_SCOPE)) {
    return {
      ok: false,
      reason: "Google Drive consent is drive.file-only; full Drive is required",
    };
  }
  const missing = GOOGLE_WORKSPACE_OAUTH_SCOPES.filter(
    (scope) => !grantHasScope(set, scope),
  );
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Google consent missing scopes: ${missing.join(" ")}`,
    };
  }
  return { ok: true };
}

export function assertGoogleConsentCoversWorkspace(
  granted: readonly string[],
): void {
  const result = googleConsentCoversWorkspace(granted);
  if (!result.ok) {
    throw new InsufficientGoogleScopesError(result.reason);
  }
}

export function expiryFromExpiresIn(
  expiresIn: number | undefined,
  now: Date = new Date(),
): string {
  const seconds =
    typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0
      ? expiresIn
      : 3600;
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

export function connectorSecretsFromGoogleGrant(
  grant: GoogleWorkspaceTokenGrant,
): ConnectorSecrets {
  return {
    oauth_access: grant.access_token,
    oauth_refresh: grant.refresh_token,
    oauth_expiry: grant.expiry,
    oauth_scopes: grant.scopes,
    whatsapp_session_db: null,
  };
}

export function parseGoogleWorkspaceTokenResponse(
  body: unknown,
  profile: GoogleProfile,
  now: Date = new Date(),
): GoogleWorkspaceTokenGrant {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new GoogleWorkspaceGrantError("Google token response is not an object");
  }
  const rec = body as Record<string, unknown>;
  const access =
    typeof rec.access_token === "string" ? rec.access_token.trim() : "";
  const refresh =
    typeof rec.refresh_token === "string" ? rec.refresh_token.trim() : "";
  if (!access) {
    throw new GoogleWorkspaceGrantError(
      "Google token response missing access_token",
    );
  }
  if (!refresh) {
    throw new GoogleWorkspaceGrantError(
      "Google token response missing refresh_token",
    );
  }
  const scopes = parseGrantedGoogleScopes(
    typeof rec.scope === "string" || Array.isArray(rec.scope)
      ? (rec.scope as string | string[])
      : undefined,
  );
  assertGoogleConsentCoversWorkspace(scopes);
  const email = profile.email.trim().toLowerCase();
  if (!email) {
    throw new GoogleWorkspaceGrantError("Google profile missing email");
  }
  const expiresIn =
    typeof rec.expires_in === "number"
      ? rec.expires_in
      : typeof rec.expires_in === "string"
        ? Number(rec.expires_in)
        : undefined;
  return {
    access_token: access,
    refresh_token: refresh,
    expiry: expiryFromExpiresIn(expiresIn, now),
    scopes,
    email,
  };
}

export type CompleteGoogleConnectorOAuthPorts = {
  exchange(input: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<GoogleWorkspaceTokenGrant>;
  upsert(input: {
    tenant_id: string;
    user_id: string;
    connector_id: "google";
    status: "connected";
    account_label: string;
    secrets: ConnectorSecrets;
    replace_secrets?: boolean;
    actor?: string | null;
  }): Promise<ConnectorConnectionPublic>;
  ensureUserSandbox(input: {
    tenant_id: string;
    owner_user_id: string;
    actor?: string | null;
  }): Promise<unknown>;
};

export async function completeGoogleConnectorOAuth(input: {
  tenant_id: string;
  user_id: string;
  code: string;
  redirect_uri: string;
  code_verifier: string;
  actor?: string | null;
  ports: CompleteGoogleConnectorOAuthPorts;
}): Promise<ConnectorConnectionPublic> {
  const code = input.code.trim();
  const redirect_uri = input.redirect_uri.trim();
  const code_verifier = input.code_verifier.trim();
  if (!code || !redirect_uri || !code_verifier) {
    throw new GoogleWorkspaceGrantError(
      "Google connector OAuth requires code, redirect_uri, and code_verifier",
    );
  }
  const grant = await input.ports.exchange({
    code,
    redirectUri: redirect_uri,
    codeVerifier: code_verifier,
  });
  const connection = await input.ports.upsert({
    tenant_id: input.tenant_id,
    user_id: input.user_id,
    connector_id: "google",
    status: "connected",
    account_label: grant.email,
    secrets: connectorSecretsFromGoogleGrant(grant),
    replace_secrets: true,
    actor: input.actor ?? null,
  });
  await input.ports.ensureUserSandbox({
    tenant_id: input.tenant_id,
    owner_user_id: input.user_id,
    actor: input.actor ?? null,
  });
  return connection;
}

export function assertNoRefreshTokenInPublicDto(
  value: unknown,
  refreshToken: string,
): void {
  const raw = JSON.stringify(value);
  if (raw.includes(refreshToken)) {
    throw new Error("connector public DTO leaked refresh token");
  }
}

/** Env gws reads first (GOOGLE_WORKSPACE_CLI_TOKEN). */
export function gwsAccessTokenEnv(
  accessToken: string,
): Record<"GOOGLE_WORKSPACE_CLI_TOKEN", string> {
  return { GOOGLE_WORKSPACE_CLI_TOKEN: accessToken };
}
