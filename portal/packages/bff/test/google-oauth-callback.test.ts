import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import type { ControlPlaneAuthClient, AuthUser } from "../src/control-plane-client.js";
import { SessionStore, signOAuthState } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import {
  cookieHeader,
  createTestBindings,
  parseSetCookie,
} from "./test-helpers.js";

const alphaTenant: TenantContext = {
  tenant_id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  tenant_slug: "alpha",
  display_name: "Alpha",
  host: "alpha.withlanyard.com",
};

const demoTenant: TenantContext = {
  tenant_id: "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
  tenant_slug: "demo",
  display_name: "Demo",
  host: "app.withlanyard.com",
};

function mockAuthClient(googleUser: AuthUser): ControlPlaneAuthClient {
  return {
    googleCallback: async () => googleUser,
    getUserRbac: async () => ({
      user_id: googleUser.user_id,
      tenant_id: googleUser.tenant_id,
      hermes_profile: "default",
      allowed_path_prefixes: ["/"],
      role_names: ["member"],
    }),
  } as unknown as ControlPlaneAuthClient;
}

describe("Google OAuth callback redirect (portal-1zj)", () => {
  let sessions: SessionStore;

  afterEach(async () => {
    await sessions?.clear();
  });

  it("redirects browser success to /{tenant_slug}/ with session cookie", async () => {
    sessions = new SessionStore();
    const googleUser: AuthUser = {
      user_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      tenant_id: alphaTenant.tenant_id,
      email: "google-user@alpha.example",
    };

    const app = createApp(
      createTestBindings(
        { alpha: alphaTenant, demo: demoTenant },
        { authClient: mockAuthClient(googleUser), sessions },
      ),
    );

    const state = signOAuthState(
      {
        tenant_id: alphaTenant.tenant_id,
        tenant_slug: alphaTenant.tenant_slug,
        redirect_uri: "http://alpha.withlanyard.com/api/auth/google/callback",
      },
      "test-session-secret",
    );

    const response = await app.request(
      `/api/auth/google/callback?code=fake-oauth-code&state=${encodeURIComponent(state)}`,
      {
        headers: {
          host: "alpha.withlanyard.com",
          // Browser Accept often includes both html and json — default redirect.
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
        },
      },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/alpha/");
    const cookies = parseSetCookie(response.headers.get("set-cookie"));
    expect(cookies.lanyard_session).toBeTruthy();
    expect(cookies.lanyard_csrf).toBeTruthy();

    const me = await app.request("/api/auth/me", {
      headers: {
        host: "alpha.withlanyard.com",
        cookie: cookieHeader(cookies),
      },
    });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      user_id: googleUser.user_id,
      email: googleUser.email,
      tenant_id: alphaTenant.tenant_id,
    });
  });

  it("redirects path-first callback to /{tenant_slug}/ (no live Google)", async () => {
    sessions = new SessionStore();
    const googleUser: AuthUser = {
      user_id: "11111111-2222-3333-4444-555555555555",
      tenant_id: demoTenant.tenant_id,
      email: "google-user@demo.example",
    };

    const app = createApp(
      createTestBindings(
        { alpha: alphaTenant, demo: demoTenant },
        { authClient: mockAuthClient(googleUser), sessions },
      ),
    );

    const state = signOAuthState(
      {
        tenant_id: demoTenant.tenant_id,
        tenant_slug: demoTenant.tenant_slug,
        redirect_uri:
          "https://app.withlanyard.com/demo/api/auth/google/callback",
      },
      "test-session-secret",
    );

    const response = await app.request(
      `/demo/api/auth/google/callback?code=fake-oauth-code&state=${encodeURIComponent(state)}`,
      {
        headers: { host: "app.withlanyard.com" },
      },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/demo/");
    const cookies = parseSetCookie(response.headers.get("set-cookie"));
    expect(cookies.lanyard_session).toBeTruthy();

    const me = await app.request("/demo/api/auth/me", {
      headers: {
        host: "app.withlanyard.com",
        cookie: cookieHeader(cookies),
      },
    });
    expect(me.status).toBe(200);
    expect((await me.json() as { email: string }).email).toBe(googleUser.email);
  });

  it("returns JSON only when Accept prefers application/json without text/html", async () => {
    sessions = new SessionStore();
    const googleUser: AuthUser = {
      user_id: "99999999-8888-7777-6666-555555555555",
      tenant_id: alphaTenant.tenant_id,
      email: "api-client@alpha.example",
    };

    const app = createApp(
      createTestBindings(
        { alpha: alphaTenant, demo: demoTenant },
        { authClient: mockAuthClient(googleUser), sessions },
      ),
    );

    const state = signOAuthState(
      {
        tenant_id: alphaTenant.tenant_id,
        tenant_slug: alphaTenant.tenant_slug,
        redirect_uri: "http://alpha.withlanyard.com/api/auth/google/callback",
      },
      "test-session-secret",
    );

    const response = await app.request(
      `/api/auth/google/callback?code=fake-oauth-code&state=${encodeURIComponent(state)}`,
      {
        headers: {
          host: "alpha.withlanyard.com",
          accept: "application/json",
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.json()).toEqual({
      user_id: googleUser.user_id,
      email: googleUser.email,
      tenant_id: alphaTenant.tenant_id,
      provider: "google",
    });
    const cookies = parseSetCookie(response.headers.get("set-cookie"));
    expect(cookies.lanyard_session).toBeTruthy();
  });
});
