import { afterEach, describe, expect, it } from "vitest";

import { APP_HOST } from "@lanyard/shared";

import { createApp } from "../src/app.js";
import type { ControlPlaneAuthClient } from "../src/control-plane-client.js";
import { MemoryOperatorDirectory } from "../src/operator-directory.js";
import { FakeOpsGoogleVerifier } from "../src/ops-google.js";
import { MemoryOpsSessionStore } from "../src/ops-session.js";
import {
  OPS_SESSION_COOKIE,
  SESSION_COOKIE,
  SessionStore,
  signOAuthState,
} from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import {
  cookieHeader,
  createTestBindings,
  parseSetCookie,
} from "./test-helpers.js";

type JsonBody = Record<string, unknown>;

const alphaTenant: TenantContext = {
  tenant_id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  tenant_slug: "alpha",
  display_name: "Alpha",
  host: "alpha.withlanyard.com",
};

const operator = {
  operatorId: "op-ops@lanyard.example",
  email: "ops@lanyard.example",
};

async function jsonRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  init: RequestInit & {
    host?: string;
    cookies?: Record<string, string>;
    csrf?: boolean;
  } = {},
): Promise<{
  status: number;
  body: JsonBody;
  cookies: Record<string, string>;
  location: string | null;
}> {
  const headers = new Headers(init.headers);
  if (init.host) {
    headers.set("host", init.host);
  }
  if (init.cookies && Object.keys(init.cookies).length > 0) {
    headers.set("cookie", cookieHeader(init.cookies));
  }
  if (init.csrf && init.cookies?.lanyard_csrf) {
    headers.set("x-csrf-token", init.cookies.lanyard_csrf);
  }

  const response = await app.request(path, { ...init, headers });
  let body: JsonBody = {};
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    body = (await response.json()) as JsonBody;
  }
  const cookies = {
    ...init.cookies,
    ...parseSetCookie(response.headers.get("set-cookie")),
  };
  return {
    status: response.status,
    body,
    cookies,
    location: response.headers.get("location"),
  };
}

function createOpsApp(overrides: {
  localDev?: boolean;
  directory?: MemoryOperatorDirectory;
  google?: FakeOpsGoogleVerifier;
} = {}) {
  const sessions = new SessionStore();
  const opsSessions = new MemoryOpsSessionStore();
  const operatorDirectory =
    overrides.directory ?? new MemoryOperatorDirectory([operator]);
  const app = createApp(
    createTestBindings(
      { alpha: alphaTenant },
      {
        sessions,
        opsSessions,
        operatorDirectory,
        authClient: {
          getUserRbac: async () => ({
            user_id: "user-1",
            tenant_id: alphaTenant.tenant_id,
            hermes_profile: "default",
            allowed_path_prefixes: ["/"],
            role_names: ["member"],
          }),
        } as unknown as ControlPlaneAuthClient,
        opsGoogleVerifier:
          overrides.google ??
          new FakeOpsGoogleVerifier(
            new Map([
              [
                "ops-google-code",
                { sub: "google-ops-sub", email: operator.email },
              ],
              [
                "stranger-google-code",
                { sub: "google-stranger", email: "stranger@example.com" },
              ],
            ]),
          ),
        ...(overrides.localDev ? { devTenantSlug: "alpha" } : {}),
      },
    ),
  );
  return { app, sessions, opsSessions, operatorDirectory };
}

describe("ops session plane (lp-2qs.2)", () => {
  const stores: Array<{ clear: () => Promise<void> }> = [];

  afterEach(async () => {
    for (const store of stores) {
      await store.clear();
    }
    stores.length = 0;
  });

  it("does not treat /api/admin as a tenant route (401, not unknown tenant)", async () => {
    const { app, sessions, opsSessions } = createOpsApp();
    stores.push(sessions, opsSessions);

    const me = await jsonRequest(app, "/api/admin/auth/me", {
      host: APP_HOST,
    });
    expect(me.status).toBe(401);
    expect(me.body.error).toBe("Not authenticated");
  });

  it("tenant session cannot call admin routes", async () => {
    const { app, sessions, opsSessions } = createOpsApp();
    stores.push(sessions, opsSessions);

    const tenantSession = await sessions.create({
      userId: "user-1",
      tenantId: alphaTenant.tenant_id,
      email: "alice@alpha.example",
    });

    const me = await jsonRequest(app, "/api/admin/auth/me", {
      host: APP_HOST,
      cookies: { [SESSION_COOKIE]: tenantSession.sessionId },
    });
    expect(me.status).toBe(401);
    expect(me.body.error).toBe("Not authenticated");
    expect(me.cookies[OPS_SESSION_COOKIE]).toBeFalsy();
  });

  it("mints an ops cookie from the local-dev stub for an allowlisted email", async () => {
    const { app, sessions, opsSessions } = createOpsApp({ localDev: true });
    stores.push(sessions, opsSessions);

    const csrf = await jsonRequest(app, "/api/admin/auth/csrf", {
      host: APP_HOST,
    });
    expect(csrf.status).toBe(200);

    const stub = await jsonRequest(app, "/api/admin/auth/google/stub", {
      method: "POST",
      host: APP_HOST,
      cookies: csrf.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "OPS@lanyard.example" }),
    });
    expect(stub.status).toBe(200);
    expect(stub.body).toEqual({
      operator_id: operator.operatorId,
      email: operator.email,
      plane: "ops",
      provider: "google",
    });
    expect(stub.cookies[OPS_SESSION_COOKIE]).toBeTruthy();
    expect(stub.cookies[SESSION_COOKIE]).toBeFalsy();

    const me = await jsonRequest(app, "/api/admin/auth/me", {
      host: APP_HOST,
      cookies: stub.cookies,
    });
    expect(me.status).toBe(200);
    expect(me.body).toEqual({
      operator_id: operator.operatorId,
      email: operator.email,
      plane: "ops",
    });
    expect(me.body).not.toHaveProperty("tenant_id");
  });

  it("ops session cannot call tenant APIs", async () => {
    const { app, sessions, opsSessions } = createOpsApp({ localDev: true });
    stores.push(sessions, opsSessions);

    const csrf = await jsonRequest(app, "/api/admin/auth/csrf", {
      host: "alpha.withlanyard.com",
    });
    const stub = await jsonRequest(app, "/api/admin/auth/google/stub", {
      method: "POST",
      host: APP_HOST,
      cookies: csrf.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: operator.email }),
    });
    expect(stub.status).toBe(200);

    const tenantMe = await jsonRequest(app, "/api/auth/me", {
      host: "alpha.withlanyard.com",
      cookies: stub.cookies,
    });
    expect(tenantMe.status).toBe(401);
    expect(tenantMe.body.error).toBe("Not authenticated");

    const oauthStart = await jsonRequest(
      app,
      "/api/connectors/google/oauth/start",
      {
        method: "POST",
        host: "alpha.withlanyard.com",
        cookies: stub.cookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(oauthStart.status).toBe(401);
    expect(oauthStart.body.error).toBe("Not authenticated");
  });

  it("keeps both cookies independent when both are present", async () => {
    const { app, sessions, opsSessions } = createOpsApp({ localDev: true });
    stores.push(sessions, opsSessions);

    const tenantSession = await sessions.create({
      userId: "user-1",
      tenantId: alphaTenant.tenant_id,
      email: "alice@alpha.example",
    });
    const csrf = await jsonRequest(app, "/api/admin/auth/csrf", {
      host: APP_HOST,
    });
    const stub = await jsonRequest(app, "/api/admin/auth/google/stub", {
      method: "POST",
      host: APP_HOST,
      cookies: csrf.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: operator.email }),
    });

    const both = {
      ...stub.cookies,
      [SESSION_COOKIE]: tenantSession.sessionId,
    };

    const opsMe = await jsonRequest(app, "/api/admin/auth/me", {
      host: APP_HOST,
      cookies: both,
    });
    expect(opsMe.status).toBe(200);
    expect(opsMe.body.plane).toBe("ops");
    expect(opsMe.body.email).toBe(operator.email);

    const tenantMe = await jsonRequest(app, "/api/auth/me", {
      host: "alpha.withlanyard.com",
      cookies: both,
    });
    expect(tenantMe.status).toBe(200);
    expect(tenantMe.body.email).toBe("alice@alpha.example");
    expect(tenantMe.body.tenant_id).toBe(alphaTenant.tenant_id);
  });

  it("rejects the stub for emails not on the allowlist", async () => {
    const { app, sessions, opsSessions } = createOpsApp({ localDev: true });
    stores.push(sessions, opsSessions);

    const csrf = await jsonRequest(app, "/api/admin/auth/csrf", {
      host: APP_HOST,
    });
    const stub = await jsonRequest(app, "/api/admin/auth/google/stub", {
      method: "POST",
      host: APP_HOST,
      cookies: csrf.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "stranger@example.com" }),
    });
    expect(stub.status).toBe(403);
    expect(stub.cookies[OPS_SESSION_COOKIE]).toBeFalsy();
  });

  it("rejects the stub outside local-dev", async () => {
    const { app, sessions, opsSessions } = createOpsApp();
    stores.push(sessions, opsSessions);

    const csrf = await jsonRequest(app, "/api/admin/auth/csrf", {
      host: APP_HOST,
    });
    const stub = await jsonRequest(app, "/api/admin/auth/google/stub", {
      method: "POST",
      host: APP_HOST,
      cookies: csrf.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: operator.email }),
    });
    expect(stub.status).toBe(404);
  });

  it("requires CSRF on ops stub and logout", async () => {
    const { app, sessions, opsSessions } = createOpsApp({ localDev: true });
    stores.push(sessions, opsSessions);

    const csrf = await jsonRequest(app, "/api/admin/auth/csrf", {
      host: APP_HOST,
    });
    const noCsrf = await jsonRequest(app, "/api/admin/auth/google/stub", {
      method: "POST",
      host: APP_HOST,
      cookies: csrf.cookies,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: operator.email }),
    });
    expect(noCsrf.status).toBe(403);

    const stub = await jsonRequest(app, "/api/admin/auth/google/stub", {
      method: "POST",
      host: APP_HOST,
      cookies: csrf.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: operator.email }),
    });
    const logoutNoCsrf = await jsonRequest(app, "/api/admin/auth/logout", {
      method: "POST",
      host: APP_HOST,
      cookies: stub.cookies,
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(logoutNoCsrf.status).toBe(403);

    const logout = await jsonRequest(app, "/api/admin/auth/logout", {
      method: "POST",
      host: APP_HOST,
      cookies: stub.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(logout.status).toBe(200);

    const me = await jsonRequest(app, "/api/admin/auth/me", {
      host: APP_HOST,
      cookies: stub.cookies,
    });
    expect(me.status).toBe(401);
  });

  it("Google start uses /api/admin/auth/google/callback on an app host", async () => {
    const { app, sessions, opsSessions } = createOpsApp();
    stores.push(sessions, opsSessions);

    const response = await app.request("/api/admin/auth/google", {
      headers: { host: APP_HOST },
      redirect: "manual",
    });
    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("accounts.google.com");
    const url = new URL(location);
    expect(url.searchParams.get("redirect_uri")).toBe(
      `http://${APP_HOST}/api/admin/auth/google/callback`,
    );
  });

  it("Google callback mints ops cookie for an allowlisted identity", async () => {
    const { app, sessions, opsSessions } = createOpsApp();
    stores.push(sessions, opsSessions);

    const state = signOAuthState(
      {
        plane: "ops",
        redirect_uri: `https://${APP_HOST}/api/admin/auth/google/callback`,
      },
      "test-session-secret",
    );

    const response = await app.request(
      `/api/admin/auth/google/callback?code=ops-google-code&state=${encodeURIComponent(state)}`,
      {
        headers: {
          host: APP_HOST,
          accept: "application/json",
        },
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      operator_id: operator.operatorId,
      email: operator.email,
      plane: "ops",
      provider: "google",
    });
    const cookies = parseSetCookie(response.headers.get("set-cookie"));
    expect(cookies[OPS_SESSION_COOKIE]).toBeTruthy();
    expect(cookies[SESSION_COOKIE]).toBeFalsy();
  });

  it("Google callback redirects browsers to /admin", async () => {
    const { app, sessions, opsSessions } = createOpsApp();
    stores.push(sessions, opsSessions);

    const state = signOAuthState(
      {
        plane: "ops",
        redirect_uri: `https://${APP_HOST}/api/admin/auth/google/callback`,
      },
      "test-session-secret",
    );

    const response = await app.request(
      `/api/admin/auth/google/callback?code=ops-google-code&state=${encodeURIComponent(state)}`,
      {
        headers: {
          host: APP_HOST,
          accept: "text/html,application/json;q=0.8",
        },
      },
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/admin");
  });

  it("Google callback fail-closes when the email is not allowlisted", async () => {
    const { app, sessions, opsSessions } = createOpsApp();
    stores.push(sessions, opsSessions);

    const state = signOAuthState(
      {
        plane: "ops",
        redirect_uri: `https://${APP_HOST}/api/admin/auth/google/callback`,
      },
      "test-session-secret",
    );

    const response = await app.request(
      `/api/admin/auth/google/callback?code=stranger-google-code&state=${encodeURIComponent(state)}`,
      {
        headers: { host: APP_HOST, accept: "application/json" },
      },
    );
    expect(response.status).toBe(403);
    const cookies = parseSetCookie(response.headers.get("set-cookie"));
    expect(cookies[OPS_SESSION_COOKIE]).toBeFalsy();
  });

  it("rejects a tenant OAuth state on the ops callback", async () => {
    const { app, sessions, opsSessions } = createOpsApp();
    stores.push(sessions, opsSessions);

    const state = signOAuthState(
      {
        tenant_id: alphaTenant.tenant_id,
        tenant_slug: alphaTenant.tenant_slug,
        redirect_uri: "https://alpha.withlanyard.com/api/auth/google/callback",
      },
      "test-session-secret",
    );

    const response = await app.request(
      `/api/admin/auth/google/callback?code=ops-google-code&state=${encodeURIComponent(state)}`,
      {
        headers: { host: APP_HOST, accept: "application/json" },
      },
    );
    expect(response.status).toBe(403);
  });

  it("drops the ops session when the operator is removed from the allowlist", async () => {
    const directory = new MemoryOperatorDirectory([operator]);
    const { app, sessions, opsSessions } = createOpsApp({
      localDev: true,
      directory,
    });
    stores.push(sessions, opsSessions);

    const csrf = await jsonRequest(app, "/api/admin/auth/csrf", {
      host: APP_HOST,
    });
    const stub = await jsonRequest(app, "/api/admin/auth/google/stub", {
      method: "POST",
      host: APP_HOST,
      cookies: csrf.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: operator.email }),
    });
    expect(stub.status).toBe(200);

    const emptied = new MemoryOperatorDirectory([]);
    const locked = createApp(
      createTestBindings(
        { alpha: alphaTenant },
        {
          sessions,
          opsSessions,
          operatorDirectory: emptied,
          devTenantSlug: "alpha",
        },
      ),
    );
    const me = await jsonRequest(locked, "/api/admin/auth/me", {
      host: APP_HOST,
      cookies: stub.cookies,
    });
    expect(me.status).toBe(401);
  });

  it("does not treat /{slug}/api/admin as the ops API", async () => {
    const { app, sessions, opsSessions } = createOpsApp({ localDev: true });
    stores.push(sessions, opsSessions);

    const csrf = await jsonRequest(app, "/api/admin/auth/csrf", {
      host: APP_HOST,
    });
    const stub = await jsonRequest(app, "/api/admin/auth/google/stub", {
      method: "POST",
      host: APP_HOST,
      cookies: csrf.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: operator.email }),
    });
    expect(stub.status).toBe(200);

    const nested = await jsonRequest(app, "/alpha/api/admin/auth/me", {
      host: APP_HOST,
      cookies: stub.cookies,
    });
    expect(nested.status).toBe(404);
  });
});
