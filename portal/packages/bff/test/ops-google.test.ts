import { describe, expect, it } from "vitest";

import {
  FakeOpsGoogleVerifier,
  GoogleAuthorizationCodeExchanger,
  OpsGoogleAuthError,
  profileFromGooglePayload,
} from "../src/ops-google.js";

describe("FakeOpsGoogleVerifier", () => {
  it("returns the identity for a known code", async () => {
    const verifier = new FakeOpsGoogleVerifier(
      new Map([
        ["code-1", { sub: "google-sub", email: "Ops@Lanyard.example" }],
      ]),
    );
    await expect(
      verifier.exchangeAuthorizationCode("code-1", "http://localhost/cb"),
    ).resolves.toEqual({
      sub: "google-sub",
      email: "ops@lanyard.example",
    });
    await expect(
      verifier.exchangeAuthorizationCode("nope", "http://localhost/cb"),
    ).rejects.toBeInstanceOf(OpsGoogleAuthError);
  });
});

describe("profileFromGooglePayload", () => {
  const audience = "test-google-client-id";

  it("accepts a verified email", () => {
    expect(
      profileFromGooglePayload(
        {
          sub: "sub-1",
          email: "Ops@Lanyard.example",
          email_verified: true,
          iss: "https://accounts.google.com",
          aud: audience,
        },
        audience,
      ),
    ).toEqual({ sub: "sub-1", email: "ops@lanyard.example" });
  });

  it("rejects audience mismatch and unverified email", () => {
    expect(() =>
      profileFromGooglePayload(
        {
          sub: "sub-1",
          email: "ops@lanyard.example",
          aud: "other-client",
        },
        audience,
      ),
    ).toThrow(/audience mismatch/);
    expect(() =>
      profileFromGooglePayload(
        {
          sub: "sub-1",
          email: "ops@lanyard.example",
          email_verified: false,
          aud: audience,
        },
        audience,
      ),
    ).toThrow(/not verified/);
  });
});

describe("GoogleAuthorizationCodeExchanger", () => {
  it("exchanges a code then verifies the id_token via injected fetch", async () => {
    const exchanger = new GoogleAuthorizationCodeExchanger({
      clientId: "test-google-client-id",
      clientSecret: "test-secret",
      fetchImpl: async () =>
        new Response(JSON.stringify({ id_token: "fake-id-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      verifyJwt: async () => ({
        sub: "google-sub",
        email: "ops@lanyard.example",
        email_verified: true,
        iss: "https://accounts.google.com",
        aud: "test-google-client-id",
      }),
    });

    await expect(
      exchanger.exchangeAuthorizationCode(
        "auth-code",
        "http://localhost:4000/api/admin/auth/google/callback",
      ),
    ).resolves.toEqual({
      sub: "google-sub",
      email: "ops@lanyard.example",
    });
  });

  it("fail-closes when Google omits id_token", async () => {
    const exchanger = new GoogleAuthorizationCodeExchanger({
      clientId: "test-google-client-id",
      clientSecret: "test-secret",
      fetchImpl: async () =>
        new Response(JSON.stringify({ access_token: "nope" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    await expect(
      exchanger.exchangeAuthorizationCode("auth-code", "http://localhost/cb"),
    ).rejects.toThrow(/missing id_token/);
  });
});
