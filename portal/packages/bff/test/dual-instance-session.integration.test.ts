/**
 * G5.2 dual-instance sticky-less session proof.
 *
 * Uses ioredis-mock as the shared Redis so CI needs no real Redis process.
 * Set REDIS_URL to exercise a real ElastiCache/local redis instead (optional).
 *
 * Acceptance (ADR staging sketch):
 * 1. Two BFF apps, one shared Redis, no sticky affinity.
 * 2. Login on A; authenticated API on B with same cookie succeeds.
 * 3. "Kill" A (drop reference) — session still valid on B.
 * 4. Broken Redis → authenticated API fail-closed (401), not memory fallback.
 */
import RedisMock from "ioredis-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp as createControlPlaneApp } from "../../control-plane/src/app.js";
import { ControlPlaneStore } from "../../control-plane/src/store.js";
import { createTestStore } from "../../control-plane/test/pg-test-store.js";
import { createApp } from "../src/app.js";
import { ChatThreadStore } from "../src/chat-store.js";
import { ControlPlaneAuthClient } from "../src/control-plane-client.js";
import { RelayClient } from "../src/relay-client.js";
import {
  RedisSessionStore,
  type RedisLike,
} from "../src/redis-session-store.js";
import { MemorySessionStore } from "../src/session.js";
import { defaultSettingsSnapshotPath } from "../src/settings-snapshot.js";
import { createFixtureStagingStorageProvider } from "../src/staging/fixture-provider.js";
import type { TenantContext } from "../src/types.js";
import { createFixtureVaultContentProvider } from "../src/vault/fixture-provider.js";
import { createFixtureVaultIndexProvider } from "../src/vault/fixture-index.js";
import { cookieHeader, parseSetCookie } from "./test-helpers.js";

type JsonBody = Record<string, unknown>;
type BffApp = ReturnType<typeof createApp>;

async function jsonRequest(
  app: BffApp,
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
  const body = (await response.json()) as JsonBody;
  const cookies = {
    ...init.cookies,
    ...parseSetCookie(response.headers.get("set-cookie")),
  };
  return { status: response.status, body, cookies };
}

function createBff(
  tenant: TenantContext,
  authClient: ControlPlaneAuthClient,
  sessions: MemorySessionStore | RedisSessionStore,
): BffApp {
  return createApp({
    tenantResolver: {
      async resolveBySlug(slug: string) {
        return slug === tenant.tenant_slug ? tenant : null;
      },
      async resolveById(id: string) {
        return id === tenant.tenant_id ? tenant : null;
      },
    },
    authClient,
    relayClient: new RelayClient("http://relay.test", "unused"),
    // Chat remains process-local (out of G5 session scope).
    chatThreads: new ChatThreadStore(),
    sessions,
    vaultContentProvider: createFixtureVaultContentProvider(),
    vaultIndexProvider: createFixtureVaultIndexProvider(),
    stagingStorageProvider: createFixtureStagingStorageProvider(),
    settingsSnapshotPath: defaultSettingsSnapshotPath(),
    settingsPreferFixture: true,
    config: {
      sessionSecret: "test-session-secret",
      secureCookies: false,
      googleClientId: undefined,
      googleRedirectPath: "/api/auth/google/callback",
      relayUrl: "http://relay.test",
      relayInternalToken: "unused",
      stagingMaxUploadBytes: 1024 * 1024,
    },
  });
}

describe("bff dual-instance redis session (G5.2)", () => {
  let store: ControlPlaneStore;
  let controlPlaneApp: ReturnType<typeof createControlPlaneApp>;
  let authClient: ControlPlaneAuthClient;
  let tenant: TenantContext;
  let redis: RedisLike;
  let sessionsA: RedisSessionStore;
  let sessionsB: RedisSessionStore;
  let appA: BffApp;
  let appB: BffApp;

  beforeEach(async () => {
    store = await createTestStore();
    controlPlaneApp = createControlPlaneApp(store, { devOpen: true });

    const created = await store.createTenant({
      slug: "dual",
      display_name: "Dual Instance",
    });
    tenant = {
      tenant_id: created.tenant_id,
      tenant_slug: created.tenant_slug,
      display_name: created.display_name,
      host: created.host,
    };

    authClient = new ControlPlaneAuthClient(
      "http://control-plane.test",
      (input, init) => {
        const url = new URL(input);
        return controlPlaneApp.request(url.pathname + url.search, init);
      },
    );

    // Shared mock Redis — two stores, two BFF apps (no sticky sessions).
    redis = new RedisMock() as unknown as RedisLike;
    sessionsA = new RedisSessionStore(redis, { ttlSeconds: 600 });
    sessionsB = new RedisSessionStore(redis, { ttlSeconds: 600 });
    appA = createBff(tenant, authClient, sessionsA);
    appB = createBff(tenant, authClient, sessionsB);
  });

  afterEach(async () => {
    await sessionsA?.clear();
    await sessionsA?.close?.();
    await sessionsB?.close?.();
    await store.close();
  });

  it("login on instance A is valid on instance B (sticky-less)", async () => {
    const csrf = await jsonRequest(appA, "/api/auth/csrf", {
      host: tenant.host,
    });
    expect(csrf.status).toBe(200);

    const register = await jsonRequest(appA, "/api/auth/register", {
      method: "POST",
      host: tenant.host,
      cookies: csrf.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "dual@example.com",
        password: "password123",
      }),
    });
    expect(register.status).toBe(201);
    expect(register.cookies.lanyard_session).toBeTruthy();

    // Hit instance B with cookies from A — must not 401.
    const meOnB = await jsonRequest(appB, "/api/auth/me", {
      host: tenant.host,
      cookies: register.cookies,
    });
    expect(meOnB.status).toBe(200);
    expect(meOnB.body.email).toBe("dual@example.com");
    expect(meOnB.body.tenant_id).toBe(tenant.tenant_id);
  });

  it("session survives killing instance A", async () => {
    const csrf = await jsonRequest(appA, "/api/auth/csrf", {
      host: tenant.host,
    });
    const register = await jsonRequest(appA, "/api/auth/register", {
      method: "POST",
      host: tenant.host,
      cookies: csrf.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "survive@example.com",
        password: "password123",
      }),
    });
    expect(register.status).toBe(201);

    // Drop A (task replacement) — only B remains.
    appA = undefined as unknown as BffApp;
    await sessionsA.close?.();

    const meOnB = await jsonRequest(appB, "/api/auth/me", {
      host: tenant.host,
      cookies: register.cookies,
    });
    expect(meOnB.status).toBe(200);
    expect(meOnB.body.email).toBe("survive@example.com");
  });

  it("logout on B invalidates session for any instance", async () => {
    const csrf = await jsonRequest(appA, "/api/auth/csrf", {
      host: tenant.host,
    });
    const register = await jsonRequest(appA, "/api/auth/register", {
      method: "POST",
      host: tenant.host,
      cookies: csrf.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "logout@example.com",
        password: "password123",
      }),
    });

    const logout = await jsonRequest(appB, "/api/auth/logout", {
      method: "POST",
      host: tenant.host,
      cookies: register.cookies,
      csrf: true,
    });
    expect(logout.status).toBe(200);

    // Fresh app A still uses shared redis via sessionsA (rebind store).
    sessionsA = new RedisSessionStore(redis, { ttlSeconds: 600 });
    appA = createBff(tenant, authClient, sessionsA);

    const meAfter = await jsonRequest(appA, "/api/auth/me", {
      host: tenant.host,
      cookies: register.cookies,
    });
    expect(meAfter.status).toBe(401);
  });

  it("GET /ready reflects redis PING; /health stays up", async () => {
    const health = await appA.request("/health");
    expect(health.status).toBe(200);

    const ready = await appA.request("/ready");
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ status: "ready", service: "bff" });

    const broken: RedisLike = {
      async get() {
        throw new Error("down");
      },
      async set() {
        throw new Error("down");
      },
      async del() {
        throw new Error("down");
      },
      async expire() {
        throw new Error("down");
      },
      async ping() {
        throw new Error("down");
      },
      async quit() {
        return "OK";
      },
      async scan() {
        throw new Error("down");
      },
    };
    const brokenStore = new RedisSessionStore(broken, { maxRetries: 1 });
    const brokenApp = createBff(tenant, authClient, brokenStore);

    const healthStill = await brokenApp.request("/health");
    expect(healthStill.status).toBe(200);

    const notReady = await brokenApp.request("/ready");
    expect(notReady.status).toBe(503);
  });

  it("redis down fail-closed: cookie present but /auth/me is 401 (no memory fallback)", async () => {
    const csrf = await jsonRequest(appA, "/api/auth/csrf", {
      host: tenant.host,
    });
    const register = await jsonRequest(appA, "/api/auth/register", {
      method: "POST",
      host: tenant.host,
      cookies: csrf.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "failclosed@example.com",
        password: "password123",
      }),
    });
    expect(register.status).toBe(201);

    const broken: RedisLike = {
      async get() {
        throw new Error("ECONNREFUSED");
      },
      async set() {
        throw new Error("ECONNREFUSED");
      },
      async del() {
        throw new Error("ECONNREFUSED");
      },
      async expire() {
        throw new Error("ECONNREFUSED");
      },
      async ping() {
        throw new Error("ECONNREFUSED");
      },
      async quit() {
        return "OK";
      },
      async scan() {
        throw new Error("ECONNREFUSED");
      },
    };
    const failClosedApp = createBff(
      tenant,
      authClient,
      new RedisSessionStore(broken, { maxRetries: 1 }),
    );

    const me = await jsonRequest(failClosedApp, "/api/auth/me", {
      host: tenant.host,
      cookies: register.cookies,
    });
    expect(me.status).toBe(401);
  });

  it("documents that isolated memory backends do not share sessions", async () => {
    const memA = new MemorySessionStore();
    const memB = new MemorySessionStore();
    const isolatedA = createBff(tenant, authClient, memA);
    const isolatedB = createBff(tenant, authClient, memB);

    const csrf = await jsonRequest(isolatedA, "/api/auth/csrf", {
      host: tenant.host,
    });
    const register = await jsonRequest(isolatedA, "/api/auth/register", {
      method: "POST",
      host: tenant.host,
      cookies: csrf.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "memory@example.com",
        password: "password123",
      }),
    });
    expect(register.status).toBe(201);

    const meOnB = await jsonRequest(isolatedB, "/api/auth/me", {
      host: tenant.host,
      cookies: register.cookies,
    });
    // Why redis is required for multi-instance.
    expect(meOnB.status).toBe(401);
  });
});
