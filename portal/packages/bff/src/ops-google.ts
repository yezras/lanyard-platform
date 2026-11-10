import * as jose from "jose";

export type OpsGoogleIdentity = {
  sub: string;
  email: string;
};

export class OpsGoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpsGoogleAuthError";
  }
}

export interface OpsGoogleVerifier {
  exchangeAuthorizationCode(
    code: string,
    redirectUri: string,
  ): Promise<OpsGoogleIdentity>;
}

export class FakeOpsGoogleVerifier implements OpsGoogleVerifier {
  constructor(
    private readonly identitiesByCode: ReadonlyMap<string, OpsGoogleIdentity>,
  ) {}

  async exchangeAuthorizationCode(
    code: string,
    _redirectUri: string,
  ): Promise<OpsGoogleIdentity> {
    const identity = this.identitiesByCode.get(code);
    if (!identity) {
      throw new OpsGoogleAuthError("Failed to exchange Google authorization code");
    }
    return {
      sub: identity.sub,
      email: identity.email.trim().toLowerCase(),
    };
  }
}

const GOOGLE_OIDC_ISSUERS = [
  "https://accounts.google.com",
  "accounts.google.com",
] as const;

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

type GoogleJwtPayload = {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  iss?: string;
  aud?: string | string[];
};

export type OpsGoogleJwtVerifier = (
  idToken: string,
  audience: string,
) => Promise<GoogleJwtPayload>;

export type GoogleAuthorizationCodeExchangerOptions = {
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
  verifyJwt?: OpsGoogleJwtVerifier;
};

let cachedGoogleJwks: ReturnType<typeof jose.createRemoteJWKSet> | undefined;

function getGoogleJwks(): ReturnType<typeof jose.createRemoteJWKSet> {
  if (!cachedGoogleJwks) {
    cachedGoogleJwks = jose.createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  }
  return cachedGoogleJwks;
}

export function resetOpsGoogleJwksCacheForTests(): void {
  cachedGoogleJwks = undefined;
}

async function verifyJwtWithGoogleJwks(
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
    const message =
      error instanceof Error ? error.message : "Google ID token verification failed";
    throw new OpsGoogleAuthError(`Invalid Google ID token: ${message}`);
  }
}

export function profileFromGooglePayload(
  payload: GoogleJwtPayload,
  expectedAudience: string,
): OpsGoogleIdentity {
  const aud = payload.aud;
  const audOk =
    aud === expectedAudience ||
    (Array.isArray(aud) && aud.includes(expectedAudience));
  if (!audOk) {
    throw new OpsGoogleAuthError("Google ID token audience mismatch");
  }

  if (
    payload.iss &&
    !(GOOGLE_OIDC_ISSUERS as readonly string[]).includes(payload.iss)
  ) {
    throw new OpsGoogleAuthError("Google ID token issuer mismatch");
  }

  if (payload.email_verified === false) {
    throw new OpsGoogleAuthError("Google ID token email is not verified");
  }

  const sub = payload.sub;
  const email = payload.email;
  if (typeof sub !== "string" || !sub || typeof email !== "string" || !email) {
    throw new OpsGoogleAuthError("Google ID token missing required claims");
  }

  return { sub, email: email.toLowerCase() };
}

/**
 * Exchanges a Google authorization code for a verified identity.
 * Does not create a tenant user.
 */
export class GoogleAuthorizationCodeExchanger implements OpsGoogleVerifier {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetchImpl: typeof fetch;
  private readonly verifyJwt: OpsGoogleJwtVerifier;

  constructor(options: GoogleAuthorizationCodeExchangerOptions) {
    this.clientId = options.clientId.trim();
    this.clientSecret = options.clientSecret.trim();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.verifyJwt = options.verifyJwt ?? verifyJwtWithGoogleJwks;
  }

  async exchangeAuthorizationCode(
    code: string,
    redirectUri: string,
  ): Promise<OpsGoogleIdentity> {
    if (!this.clientId || !this.clientSecret) {
      throw new OpsGoogleAuthError(
        "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured",
      );
    }

    const tokenResponse = await this.fetchImpl(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      },
    );

    if (!tokenResponse.ok) {
      throw new OpsGoogleAuthError("Failed to exchange Google authorization code");
    }

    const tokenBody = (await tokenResponse.json()) as { id_token?: string };
    if (!tokenBody.id_token) {
      throw new OpsGoogleAuthError("Google token response missing id_token");
    }

    let payload: GoogleJwtPayload;
    try {
      payload = await this.verifyJwt(tokenBody.id_token, this.clientId);
    } catch (error) {
      if (error instanceof OpsGoogleAuthError) {
        throw error;
      }
      const message =
        error instanceof Error
          ? error.message
          : "Google ID token verification failed";
      throw new OpsGoogleAuthError(`Invalid Google ID token: ${message}`);
    }

    return profileFromGooglePayload(payload, this.clientId);
  }
}
