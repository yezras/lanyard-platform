import * as jose from "jose";

import { parseGoogleWorkspaceTokenResponse } from "./google-workspace-oauth.js";
import type { GoogleWorkspaceTokenGrant } from "./google-workspace-oauth.js";

export type GoogleProfile = {
  sub: string;
  email: string;
};

export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

/** Google OIDC issuers (both forms appear in production tokens). */
export const GOOGLE_OIDC_ISSUERS = [
  "https://accounts.google.com",
  "accounts.google.com",
] as const;

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

export type GoogleJwtPayload = {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  iss?: string;
  aud?: string | string[];
  exp?: number;
};

/**
 * Pluggable JWT verifier for tests (local JWKS) or alternate backends.
 * Production default uses Google's remote JWKS with signature checks.
 */
export type GoogleIdTokenJwtVerifier = (
  idToken: string,
  audience: string,
) => Promise<GoogleJwtPayload>;

export type GoogleWorkspaceCodeExchange = (input: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}) => Promise<GoogleWorkspaceTokenGrant>;

export type GoogleAuthConfig = {
  clientId?: string;
  clientSecret?: string;
  /** Override cryptographic JWT verification (unit/integration tests). */
  verifyJwt?: GoogleIdTokenJwtVerifier;
  /**
   * Override Google Workspace token exchange (connector OAuth tests).
   * Production default posts to Google with PKCE.
   */
  exchangeWorkspaceCode?: GoogleWorkspaceCodeExchange;
};

let cachedGoogleJwks: ReturnType<typeof jose.createRemoteJWKSet> | undefined;

function getGoogleJwks(): ReturnType<typeof jose.createRemoteJWKSet> {
  if (!cachedGoogleJwks) {
    cachedGoogleJwks = jose.createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  }
  return cachedGoogleJwks;
}

/** Reset cached JWKS (tests only). */
export function resetGoogleJwksCacheForTests(): void {
  cachedGoogleJwks = undefined;
}

export async function verifyJwtWithGoogleJwks(
  idToken: string,
  audience: string,
): Promise<GoogleJwtPayload> {
  try {
    const { payload } = await jose.jwtVerify(idToken, getGoogleJwks(), {
      audience,
      issuer: [...GOOGLE_OIDC_ISSUERS],
    });
    return payload as GoogleJwtPayload;
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      throw error;
    }
    const message =
      error instanceof Error ? error.message : "Google ID token verification failed";
    throw new GoogleAuthError(`Invalid Google ID token: ${message}`);
  }
}

function getGoogleClientId(config: GoogleAuthConfig = {}): string | undefined {
  return config.clientId?.trim() || process.env.GOOGLE_CLIENT_ID?.trim() || undefined;
}

function getGoogleClientSecret(
  config: GoogleAuthConfig = {},
): string | undefined {
  return (
    config.clientSecret?.trim() ||
    process.env.GOOGLE_CLIENT_SECRET?.trim() ||
    undefined
  );
}

/**
 * Validate OIDC claims after signature/issuer/audience verification.
 * Enforces email_verified when the claim is present.
 */
export function profileFromGooglePayload(
  payload: GoogleJwtPayload,
  expectedAudience: string,
): GoogleProfile {
  const aud = payload.aud;
  const audOk =
    aud === expectedAudience ||
    (Array.isArray(aud) && aud.includes(expectedAudience));
  if (!audOk) {
    throw new GoogleAuthError("Google ID token audience mismatch");
  }

  if (
    payload.iss &&
    !(GOOGLE_OIDC_ISSUERS as readonly string[]).includes(payload.iss)
  ) {
    throw new GoogleAuthError("Google ID token issuer mismatch");
  }

  if (payload.email_verified === false) {
    throw new GoogleAuthError("Google ID token email is not verified");
  }

  const sub = payload.sub;
  const email = payload.email;
  if (typeof sub !== "string" || !sub || typeof email !== "string" || !email) {
    throw new GoogleAuthError("Google ID token missing required claims");
  }

  return { sub, email: email.toLowerCase() };
}

/**
 * Cryptographically verify a Google OIDC ID token (JWKS signature + aud/iss).
 * Does **not** accept base64-decoded payloads without signature checks.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  config: GoogleAuthConfig = {},
): Promise<GoogleProfile> {
  const clientId = getGoogleClientId(config);
  if (!clientId) {
    throw new GoogleAuthError("GOOGLE_CLIENT_ID is not configured");
  }

  if (!idToken.trim()) {
    throw new GoogleAuthError("Invalid Google ID token");
  }

  const verifyJwt = config.verifyJwt ?? verifyJwtWithGoogleJwks;
  let payload: GoogleJwtPayload;
  try {
    payload = await verifyJwt(idToken, clientId);
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      throw error;
    }
    const message =
      error instanceof Error ? error.message : "Google ID token verification failed";
    throw new GoogleAuthError(`Invalid Google ID token: ${message}`);
  }

  return profileFromGooglePayload(payload, clientId);
}

export async function exchangeGoogleCode(
  code: string,
  redirectUri: string,
  config: GoogleAuthConfig = {},
): Promise<GoogleProfile> {
  const clientId = getGoogleClientId(config);
  const clientSecret = getGoogleClientSecret(config);
  if (!clientId || !clientSecret) {
    throw new GoogleAuthError(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured",
    );
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResponse.ok) {
    throw new GoogleAuthError("Failed to exchange Google authorization code");
  }

  const tokenBody = (await tokenResponse.json()) as { id_token?: string };
  if (!tokenBody.id_token) {
    throw new GoogleAuthError("Google token response missing id_token");
  }

  return verifyGoogleIdToken(tokenBody.id_token, config);
}

export async function exchangeGoogleWorkspaceCode(
  code: string,
  redirectUri: string,
  codeVerifier: string,
  config: GoogleAuthConfig = {},
): Promise<GoogleWorkspaceTokenGrant> {
  if (config.exchangeWorkspaceCode) {
    return config.exchangeWorkspaceCode({
      code,
      redirectUri,
      codeVerifier,
    });
  }

  const clientId = getGoogleClientId(config);
  const clientSecret = getGoogleClientSecret(config);
  if (!clientId || !clientSecret) {
    throw new GoogleAuthError(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured",
    );
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenResponse.ok) {
    throw new GoogleAuthError("Failed to exchange Google authorization code");
  }

  const tokenBody: unknown = await tokenResponse.json();
  const rec = tokenBody as { id_token?: string };
  if (!rec.id_token || typeof rec.id_token !== "string") {
    throw new GoogleAuthError("Google token response missing id_token");
  }
  const profile = await verifyGoogleIdToken(rec.id_token, config);
  return parseGoogleWorkspaceTokenResponse(tokenBody, profile);
}
