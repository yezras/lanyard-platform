import RedisMock from "ioredis-mock";
import { afterEach, describe, expect, it } from "vitest";

import {
  MemoryOpsSessionStore,
  OPS_SESSION_REDIS_KEY_PREFIX,
  parseOpsSessionRecordForTests,
  RedisOpsSessionStore,
} from "../src/ops-session.js";
import type { RedisLike } from "../src/redis-session-store.js";
import {
  createOpsSessionStore,
  createSessionStore,
} from "../src/session-factory.js";
import {
  DEFAULT_SESSION_MAX_AGE_SECONDS,
  DEFAULT_SESSION_TTL_SECONDS,
  SESSION_REDIS_KEY_PREFIX,
} from "../src/session.js";

describe("MemoryOpsSessionStore", () => {
  it("stores operator identity without tenantId", async () => {
    const store = new MemoryOpsSessionStore();
    const created = await store.create({
      operatorId: "op-1",
      email: "ops@lanyard.example",
    });
    expect(created.plane).toBe("ops");
    expect("tenantId" in created).toBe(false);
    expect(created.operatorId).toBe("op-1");
    expect(await store.get(created.sessionId)).toEqual(created);
  });
});

describe("parseOpsSessionRecord", () => {
  it("rejects tenant-shaped records", () => {
    expect(
      parseOpsSessionRecordForTests({
        plane: "ops",
        sessionId: "s1",
        operatorId: "op-1",
        email: "ops@lanyard.example",
        createdAt: Date.now(),
        tenantId: "tenant-1",
      }),
    ).toBeNull();
    expect(
      parseOpsSessionRecordForTests({
        sessionId: "s1",
        userId: "u1",
        tenantId: "t1",
        email: "a@example.com",
        createdAt: Date.now(),
      }),
    ).toBeNull();
  });
});

describe("RedisOpsSessionStore", () => {
  let store: RedisOpsSessionStore | undefined;

  afterEach(async () => {
    try {
      await store?.clear();
    } catch {
      // ignore
    }
    try {
      await store?.close?.();
    } catch {
      // ignore
    }
  });

  it("uses a distinct Redis prefix from tenant sessions", async () => {
    const redis = new RedisMock() as unknown as RedisLike;
    store = new RedisOpsSessionStore(redis, {
      ttlSeconds: 60,
      maxAgeSeconds: 3600,
    });
    const created = await store.create({
      operatorId: "op-1",
      email: "ops@lanyard.example",
    });
    const opsRaw = await redis.get(
      `${OPS_SESSION_REDIS_KEY_PREFIX}${created.sessionId}`,
    );
    const tenantRaw = await redis.get(
      `${SESSION_REDIS_KEY_PREFIX}${created.sessionId}`,
    );
    expect(opsRaw).toBeTruthy();
    expect(tenantRaw).toBeNull();
    expect(JSON.parse(opsRaw as string).plane).toBe("ops");
    expect(JSON.parse(opsRaw as string).tenantId).toBeUndefined();
  });
});

describe("createOpsSessionStore", () => {
  it("returns a memory ops store by default", async () => {
    const store = createOpsSessionStore({
      backend: "memory",
      multiInstance: false,
      sessionTtlSeconds: DEFAULT_SESSION_TTL_SECONDS,
      sessionMaxAgeSeconds: DEFAULT_SESSION_MAX_AGE_SECONDS,
    });
    expect(store).toBeInstanceOf(MemoryOpsSessionStore);
    const tenant = createSessionStore({
      backend: "memory",
      multiInstance: false,
      sessionTtlSeconds: DEFAULT_SESSION_TTL_SECONDS,
      sessionMaxAgeSeconds: DEFAULT_SESSION_MAX_AGE_SECONDS,
    });
    const ops = await store.create({
      operatorId: "op-1",
      email: "ops@lanyard.example",
    });
    expect(await tenant.get(ops.sessionId)).toBeNull();
  });
});
