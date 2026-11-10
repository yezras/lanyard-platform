import { describe, expect, it } from "vitest";

import { APP_HOST, defaultAppHosts } from "@lanyard/shared";

import { createApp } from "../src/app.js";
import {
  isOAuthRedirectHostAllowed,
  resolveOAuthRedirectOrigin,
} from "../src/oauth-redirect.js";
import type { TenantContext } from "../src/types.js";
import { createTestBindings } from "./test-helpers.js";

const alphaTenant: TenantContext = {
  tenant_id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  tenant_slug: "alpha",
  display_name: "Alpha",
  host: "alpha.withlanyard.com",
};

describe("resolveOAuthRedirectOrigin", () => {
  const base = {
    tenantHost: "alpha.withlanyard.com",
    tenantSlug: "alpha",
    appHosts: defaultAppHosts(),
    secureCookies: true,
  };

  it("accepts allowlisted tenant subdomain Host", () => {
    const result = resolveOAuthRedirectOrigin({
      ...base,
      hostHeader: "alpha.withlanyard.com",
    });
    expect(result).toEqual({
      ok: true,
      host: "alpha.withlanyard.com",
      origin: "https://alpha.withlanyard.com",
    });
  });

  it("accepts path-first app host", () => {
    const result = resolveOAuthRedirectOrigin({
      ...base,
      tenantHost: APP_HOST,
      hostHeader: APP_HOST,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.origin).toBe(`https://${APP_HOST}`);
    }
  });

  it("preserves local port on allowlisted localhost", () => {
    const result = resolveOAuthRedirectOrigin({
      ...base,
      secureCookies: false,
      hostHeader: "localhost:4000",
    });
    expect(result).toEqual({
      ok: true,
      host: "localhost:4000",
      origin: "http://localhost:4000",
    });
  });

  it("rejects Host spoofing and does not use the attacker host", () => {
    const result = resolveOAuthRedirectOrigin({
      ...base,
      hostHeader: "evil.attacker.example",
    });
    // Falls back to tenant host (allowlisted).
    expect(result).toEqual({
      ok: true,
      host: "alpha.withlanyard.com",
      origin: "https://alpha.withlanyard.com",
    });
    expect(JSON.stringify(result)).not.toContain("evil.attacker.example");
  });

  it("rejects when Host is spoofed and tenant host is not allowlisted", () => {
    const result = resolveOAuthRedirectOrigin({
      tenantHost: "not-a-real-host.example",
      tenantSlug: "alpha",
      appHosts: defaultAppHosts(),
      secureCookies: true,
      hostHeader: "evil.attacker.example",
    });
    expect(result).toEqual({ ok: false, reason: "host_not_allowlisted" });
  });

  it("isOAuthRedirectHostAllowed rejects arbitrary hosts", () => {
    expect(
      isOAuthRedirectHostAllowed("evil.attacker.example", {
        tenantHost: "alpha.withlanyard.com",
        tenantSlug: "alpha",
        appHosts: defaultAppHosts(),
      }),
    ).toBe(false);
  });
});

describe("GET /auth/google Host allowlist (lp-p37.8)", () => {
  const oauthConfig = {
    sessionSecret: "test-session-secret",
    secureCookies: true,
    googleClientId: "test-google-client-id",
    googleRedirectPath: "/api/auth/google/callback",
    relayUrl: "http://relay.test",
    relayInternalToken: "test-relay-internal-token",
    stagingMaxUploadBytes: 1024 * 1024,
  } as const;

  it("mints redirect_uri from allowlisted tenant Host", async () => {
    const app = createApp(
      createTestBindings(
        { alpha: alphaTenant },
        {
          appHosts: defaultAppHosts(),
          config: { ...oauthConfig },
        },
      ),
    );

    const response = await app.request("/api/auth/google", {
      headers: { host: "alpha.withlanyard.com" },
      redirect: "manual",
    });

    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("accounts.google.com");
    const url = new URL(location);
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    expect(redirectUri).toBe(
      "https://alpha.withlanyard.com/api/auth/google/callback",
    );
  });

  it("fails closed when Host is spoofed (no tenant / no allowlisted origin)", async () => {
    const app = createApp(
      createTestBindings(
        { alpha: alphaTenant },
        {
          appHosts: defaultAppHosts(),
          config: { ...oauthConfig },
        },
      ),
    );

    // Spoofed Host cannot resolve a tenant and never reaches OAuth minting.
    const response = await app.request("/api/auth/google", {
      headers: { host: "evil.attacker.example" },
      redirect: "manual",
    });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/unknown tenant/i);
  });

  it("path-first app host uses allowlisted origin, not an off-list Host", async () => {
    const app = createApp(
      createTestBindings(
        { alpha: alphaTenant },
        {
          appHosts: defaultAppHosts(),
          config: {
            ...oauthConfig,
            googleRedirectPath: "/alpha/api/auth/google/callback",
          },
        },
      ),
    );

    const response = await app.request("/alpha/api/auth/google", {
      headers: { host: APP_HOST },
      redirect: "manual",
    });
    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";
    const url = new URL(location);
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    expect(redirectUri).toBe(
      `https://${APP_HOST}/alpha/api/auth/google/callback`,
    );
  });
});
