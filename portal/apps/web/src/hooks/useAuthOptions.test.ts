import { describe, expect, it } from "vitest";

import { resolveAuthSignInOptions } from "./authSignInOptions.js";

describe("resolveAuthSignInOptions", () => {
  it("enables Google OAuth when the BFF redirects", () => {
    expect(
      resolveAuthSignInOptions({
        hostname: "demo.localhost",
        tenantSlug: "demo",
        googleStatus: 302,
      }),
    ).toEqual({
      googleSignIn: true,
      googleDevStub: false,
      tenantSlug: "demo",
    });
  });

  it("enables Google OAuth on opaque redirect (Chromium redirect:manual)", () => {
    expect(
      resolveAuthSignInOptions({
        hostname: "d1watnzk551glk.cloudfront.net",
        tenantSlug: "mocklab",
        googleStatus: 0,
        googleResponseType: "opaqueredirect",
      }),
    ).toEqual({
      googleSignIn: true,
      googleDevStub: false,
      tenantSlug: "mocklab",
    });
  });

  it("does not treat bare status 0 as Google (network noise)", () => {
    expect(
      resolveAuthSignInOptions({
        hostname: "d1watnzk551glk.cloudfront.net",
        tenantSlug: "mocklab",
        googleStatus: 0,
      }),
    ).toEqual({
      googleSignIn: false,
      googleDevStub: false,
      tenantSlug: "mocklab",
    });
  });

  it("enables dev stub on demo.localhost without OAuth", () => {
    expect(
      resolveAuthSignInOptions({
        hostname: "demo.localhost",
        tenantSlug: "demo",
        googleStatus: 503,
      }),
    ).toEqual({
      googleSignIn: false,
      googleDevStub: true,
      tenantSlug: "demo",
    });
  });

  it("enables dev stub on localhost with demo tenant from context", () => {
    expect(
      resolveAuthSignInOptions({
        hostname: "localhost",
        tenantSlug: "demo",
        googleStatus: 503,
      }),
    ).toEqual({
      googleSignIn: false,
      googleDevStub: true,
      tenantSlug: "demo",
    });
  });

  it("hides dev stub outside local demo hosts", () => {
    expect(
      resolveAuthSignInOptions({
        hostname: "beta.withlanyard.com",
        tenantSlug: "beta",
        googleStatus: 503,
      }),
    ).toEqual({
      googleSignIn: false,
      googleDevStub: false,
      tenantSlug: "beta",
    });
  });
});