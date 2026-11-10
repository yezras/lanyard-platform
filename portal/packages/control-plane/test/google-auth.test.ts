import * as jose from "jose";
import { describe, expect, it } from "vitest";

import {
  GoogleAuthError,
  GOOGLE_OIDC_ISSUERS,
  profileFromGooglePayload,
  verifyGoogleIdToken,
} from "../src/google-auth.js";

const CLIENT_ID = "test-google-client-id.apps.googleusercontent.com";

async function mintGoogleLikeToken(options: {
  privateKey: jose.KeyLike;
  audience?: string;
  issuer?: string;
  sub?: string;
  email?: string;
  emailVerified?: boolean;
  expired?: boolean;
}): Promise<string> {
  const builder = new jose.SignJWT({
    email: options.email ?? "user@example.com",
    email_verified: options.emailVerified ?? true,
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setSubject(options.sub ?? "google-sub-1")
    .setAudience(options.audience ?? CLIENT_ID)
    .setIssuer(options.issuer ?? GOOGLE_OIDC_ISSUERS[0])
    .setIssuedAt();

  if (options.expired) {
    builder.setExpirationTime("-1h");
  } else {
    builder.setExpirationTime("1h");
  }

  return builder.sign(options.privateKey);
}

describe("verifyGoogleIdToken", () => {
  it("accepts a cryptographically verified token with valid aud/iss/email", async () => {
    const { publicKey, privateKey } = await jose.generateKeyPair("RS256");
    const jwks = jose.createLocalJWKSet(
      await jose.exportJWK(publicKey).then((jwk) => ({ keys: [jwk] })),
    );

    const idToken = await mintGoogleLikeToken({ privateKey });

    const profile = await verifyGoogleIdToken(idToken, {
      clientId: CLIENT_ID,
      verifyJwt: async (token, audience) => {
        const { payload } = await jose.jwtVerify(token, jwks, {
          audience,
          issuer: [...GOOGLE_OIDC_ISSUERS],
        });
        return payload;
      },
    });

    expect(profile).toEqual({
      sub: "google-sub-1",
      email: "user@example.com",
    });
  });

  it("rejects tokens with invalid signature (wrong key)", async () => {
    const { privateKey: signer } = await jose.generateKeyPair("RS256");
    const { publicKey: otherPublic } = await jose.generateKeyPair("RS256");
    const jwks = jose.createLocalJWKSet(
      await jose.exportJWK(otherPublic).then((jwk) => ({ keys: [jwk] })),
    );

    const idToken = await mintGoogleLikeToken({ privateKey: signer });

    await expect(
      verifyGoogleIdToken(idToken, {
        clientId: CLIENT_ID,
        verifyJwt: async (token, audience) => {
          const { payload } = await jose.jwtVerify(token, jwks, {
            audience,
            issuer: [...GOOGLE_OIDC_ISSUERS],
          });
          return payload;
        },
      }),
    ).rejects.toBeInstanceOf(GoogleAuthError);
  });

  it("rejects audience mismatch", async () => {
    const { publicKey, privateKey } = await jose.generateKeyPair("RS256");
    const jwks = jose.createLocalJWKSet(
      await jose.exportJWK(publicKey).then((jwk) => ({ keys: [jwk] })),
    );

    const idToken = await mintGoogleLikeToken({
      privateKey,
      audience: "other-client-id",
    });

    await expect(
      verifyGoogleIdToken(idToken, {
        clientId: CLIENT_ID,
        verifyJwt: async (token, audience) => {
          // Intentionally skip jose audience check so claim validation is exercised.
          const { payload } = await jose.jwtVerify(token, jwks, {
            issuer: [...GOOGLE_OIDC_ISSUERS],
          });
          void audience;
          return payload;
        },
      }),
    ).rejects.toMatchObject({
      name: "GoogleAuthError",
      message: expect.stringContaining("audience"),
    });
  });

  it("rejects issuer mismatch", () => {
    expect(() =>
      profileFromGooglePayload(
        {
          sub: "s",
          email: "a@b.com",
          email_verified: true,
          iss: "https://evil.example",
          aud: CLIENT_ID,
        },
        CLIENT_ID,
      ),
    ).toThrow(/issuer/);
  });

  it("rejects unverified email when claim is present", () => {
    expect(() =>
      profileFromGooglePayload(
        {
          sub: "s",
          email: "a@b.com",
          email_verified: false,
          iss: GOOGLE_OIDC_ISSUERS[0],
          aud: CLIENT_ID,
        },
        CLIENT_ID,
      ),
    ).toThrow(/not verified/);
  });

  it("rejects missing GOOGLE_CLIENT_ID", async () => {
    const prev = process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;
    try {
      await expect(verifyGoogleIdToken("a.b.c", {})).rejects.toMatchObject({
        name: "GoogleAuthError",
        message: expect.stringContaining("GOOGLE_CLIENT_ID"),
      });
    } finally {
      if (prev !== undefined) {
        process.env.GOOGLE_CLIENT_ID = prev;
      }
    }
  });

  it("does not accept decode-only payloads without signature verification", async () => {
    // Classic forge: base64 payload with valid JSON claims but no real signature.
    const header = Buffer.from(
      JSON.stringify({ alg: "none", typ: "JWT" }),
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        sub: "forged",
        email: "forged@example.com",
        email_verified: true,
        aud: CLIENT_ID,
        iss: GOOGLE_OIDC_ISSUERS[0],
      }),
    ).toString("base64url");
    const forged = `${header}.${payload}.`;

    await expect(
      verifyGoogleIdToken(forged, {
        clientId: CLIENT_ID,
        // Default path would hit Google JWKS; use a strict local verifier.
        verifyJwt: async () => {
          throw new GoogleAuthError("signature verification failed");
        },
      }),
    ).rejects.toBeInstanceOf(GoogleAuthError);
  });
});
