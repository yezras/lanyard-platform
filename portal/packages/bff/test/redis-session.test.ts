import RedisMock from "ioredis-mock";
import { afterEach, describe, expect, it } from "vitest";

import {
  RedisSessionStore,
  type RedisLike,
} from "../src/redis-session-store.js";
import {
  assertSessionStoreConfig,
  createSessionStore,
  loadSessionStoreConfig,
} from "../src/session-factory.js";
import {
  DEFAULT_SESSION_MAX_AGE_SECONDS,
  DEFAULT_SESSION_TTL_SECONDS,
  MemorySessionStore,
  SESSION_REDIS_KEY_PREFIX,
} from "../src/session.js";

describe("session store config (G5.2)", () => {
  it("defaults to memory backend", () => {
    const config = loadSessionStoreConfig({});
    expect(config.backend).toBe("memory");
    expect(config.multiInstance).toBe(false);
    expect(config.sessionTtlSeconds).toBe(DEFAULT_SESSION_TTL_SECONDS);
    expect(config.sessionMaxAgeSeconds).toBe(DEFAULT_SESSION_MAX_AGE_SECONDS);
  });

  it("parses redis backend and multi-instance flag", () => {
    const config = loadSessionStoreConfig({
      BFF_SESSION_BACKEND: "redis",
      REDIS_URL: "rediss://:token@cache.example:6379/0",
      BFF_MULTI_INSTANCE: "true",
      SESSION_TTL_SECONDS: "3600",
      SESSION_MAX_AGE_SECONDS: "86400",
    });
    expect(config.backend).toBe("redis");
    expect(config.redisUrl).toBe("rediss://:token@cache.example:6379/0");
    expect(config.multiInstance).toBe(true);
    expect(config.sessionTtlSeconds).toBe(3600);
    expect(config.sessionMaxAgeSeconds).toBe(86400);
  });

  it("fail-closed: multi-instance requires redis backend", () => {
    expect(() =>
      assertSessionStoreConfig({
        backend: "memory",
        multiInstance: true,
        sessionTtlSeconds: DEFAULT_SESSION_TTL_SECONDS,
        sessionMaxAgeSeconds: DEFAULT_SESSION_MAX_AGE_SECONDS,
      }),
    ).toThrow(/BFF_MULTI_INSTANCE requires BFF_SESSION_BACKEND=redis/);
  });

  it("fail-closed: redis backend requires REDIS_URL", () => {
    expect(() =>
      assertSessionStoreConfig({
        backend: "redis",
        multiInstance: false,
        sessionTtlSeconds: DEFAULT_SESSION_TTL_SECONDS,
        sessionMaxAgeSeconds: DEFAULT_SESSION_MAX_AGE_SECONDS,
      }),
    ).toThrow(/REDIS_URL/);
  });

  it("rejects unknown backend", () => {
    expect(() =>
      loadSessionStoreConfig({ BFF_SESSION_BACKEND: "sqlite" }),
    ).toThrow(/memory" or "redis/);
  });

  it("createSessionStore returns MemorySessionStore by default", async () => {
    const store = createSessionStore({
      backend: "memory",
      multiInstance: false,
      sessionTtlSeconds: DEFAULT_SESSION_TTL_SECONDS,
      sessionMaxAgeSeconds: DEFAULT_SESSION_MAX_AGE_SECONDS,
    });
    expect(store).toBeInstanceOf(MemorySessionStore);
    expect(await store.ready()).toBe(true);
  });
});

describe("RedisSessionStore", () => {
  let redis: RedisLike;
  let store: RedisSessionStore;

  afterEach(async () => {
    try {
      await store?.clear();
    } catch {
      // Broken redis fixtures throw on clear — ignore in teardown.
    }
    try {
      await store?.close?.();
    } catch {
      // ignore
    }
  });

  function makeStore(
    options: ConstructorParameters<typeof RedisSessionStore>[1] = {},
  ): RedisSessionStore {
    // Each RedisMock() with data={} gets isolated data; share one client.
    redis = new RedisMock() as unknown as RedisLike;
    store = new RedisSessionStore(redis, options);
    return store;
  }

  it("creates, gets (sliding TTL), and deletes sessions", async () => {
    const s = makeStore({ ttlSeconds: 60, maxAgeSeconds: 3600 });
    const created = await s.create({
      userId: "u1",
      tenantId: "t1",
      email: "a@example.com",
    });
    expect(created.sessionId).toMatch(/^[A-Za-z0-9_-]+$/);

    const raw = await redis.get(
      `${SESSION_REDIS_KEY_PREFIX}${created.sessionId}`,
    );
    expect(raw).toBeTruthy();

    const got = await s.get(created.sessionId);
    expect(got).toEqual(created);

    await s.delete(created.sessionId);
    expect(await s.get(created.sessionId)).toBeNull();
  });

  it("rejects sessions past absolute max age", async () => {
    const s = makeStore({ ttlSeconds: 3600, maxAgeSeconds: 1 });
    const created = await s.create({
      userId: "u1",
      tenantId: "t1",
      email: "a@example.com",
    });

    // Backdate createdAt beyond max age.
    const aged = { ...created, createdAt: Date.now() - 5_000 };
    await redis.set(
      `${SESSION_REDIS_KEY_PREFIX}${created.sessionId}`,
      JSON.stringify(aged),
      "EX",
      3600,
    );

    expect(await s.get(created.sessionId)).toBeNull();
  });

  it("shares sessions across two store instances (sticky-less dual-instance)", async () => {
    const shared = new RedisMock() as unknown as RedisLike;
    const a = new RedisSessionStore(shared, { ttlSeconds: 60 });
    const b = new RedisSessionStore(shared, { ttlSeconds: 60 });

    const created = await a.create({
      userId: "u-shared",
      tenantId: "tenant-a",
      email: "shared@example.com",
    });

    // Instance B (no process-local map) must resolve the same cookie id.
    const fromB = await b.get(created.sessionId);
    expect(fromB).toEqual(created);

    await b.delete(created.sessionId);
    expect(await a.get(created.sessionId)).toBeNull();

    await a.close?.();
    await b.close?.();
  });

  it("get fail-closed returns null when redis errors (no memory fallback)", async () => {
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

    const s = new RedisSessionStore(broken, { maxRetries: 1 });
    store = s;
    expect(await s.get("any-id")).toBeNull();
    expect(await s.ready()).toBe(false);
    await expect(
      s.create({ userId: "u", tenantId: "t", email: "e@example.com" }),
    ).rejects.toThrow(/ECONNREFUSED/);
  });

  it("ready returns true when PING succeeds", async () => {
    const s = makeStore();
    expect(await s.ready()).toBe(true);
  });
});
