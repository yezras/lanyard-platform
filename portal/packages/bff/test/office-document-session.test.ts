/**
 * lp-5q6.21 — Office document session store and lifecycle.
 *
 * Acceptance:
 * - server-owned OfficeDocumentSession with opaque session id
 * - stores tenant_id, user_id, path, revision, mode, file_type, document_key,
 *   download token hash, callback nonce, created_at, expires_at, last_save status
 * - memory (lab) + redis (multi-instance)
 * - expired sessions cannot download or write
 * - create is idempotent by caller key
 * - tests: expiry, tenant mismatch, user mismatch, duplicate create
 */
import RedisMock from "ioredis-mock";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertOfficeDocumentSessionStoreConfig,
  createOfficeDocumentSessionStore,
  DEFAULT_OFFICE_SESSION_TTL_SECONDS,
  hashDownloadToken,
  loadOfficeDocumentSessionStoreConfig,
  MemoryOfficeDocumentSessionStore,
  RedisOfficeDocumentSessionStore,
  verifyDownloadToken,
  type CreateOfficeDocumentSessionInput,
  type DocumentRevision,
  type OfficeDocumentSessionStore,
} from "../src/office/index.js";
import type { RedisLike } from "../src/redis-session-store.js";

const REVISION: DocumentRevision = {
  token: "rev-etag-abc123",
  kind: "etag",
  size_bytes: 4096,
};

function baseCreate(
  overrides: Partial<CreateOfficeDocumentSessionInput> = {},
): CreateOfficeDocumentSessionInput {
  return {
    tenant_id: "tenant-a",
    user_id: "user-1",
    path: "/Projects/Acme/proposal.docx",
    revision: REVISION,
    mode: "edit",
    file_type: "docx",
    document_key: "dk-v1-tenant-a-proposal-rev-etag-abc123",
    download_token: "download-token-secret-value",
    callback_nonce: "callback-nonce-value",
    ...overrides,
  };
}

async function expectSessionShape(
  store: OfficeDocumentSessionStore,
  input: CreateOfficeDocumentSessionInput = baseCreate(),
) {
  const { session, download_token, idempotent_replay } =
    await store.create(input);
  expect(idempotent_replay).toBe(false);
  expect(session.session_id).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(session.session_id.length).toBeGreaterThanOrEqual(32);
  expect(session.tenant_id).toBe(input.tenant_id);
  expect(session.user_id).toBe(input.user_id);
  expect(session.path).toBe(input.path);
  expect(session.revision).toEqual(input.revision);
  expect(session.mode).toBe(input.mode);
  expect(session.file_type).toBe(input.file_type);
  expect(session.document_key).toBe(input.document_key);
  expect(session.download_token_hash).toBe(hashDownloadToken(download_token));
  expect(session.download_token_hash).not.toContain(download_token);
  expect(session.callback_nonce).toBeTruthy();
  expect(session.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(session.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(session.last_save_status).toBe("none");
  expect(session.lifecycle).toBe("active");
  expect(verifyDownloadToken(download_token, session.download_token_hash)).toBe(
    true,
  );
  return { session, download_token };
}

describe("OfficeDocumentSession model (memory)", () => {
  const store = new MemoryOfficeDocumentSessionStore();

  afterEach(async () => {
    await store.clear();
  });

  it("creates server-owned session with all required fields and opaque id", async () => {
    await expectSessionShape(store);
  });

  it("does not store raw download token — only hash", async () => {
    const { session, download_token } = await store.create(baseCreate());
    const raw = JSON.stringify(session);
    expect(raw).not.toContain(download_token);
    expect(session.download_token_hash).toBe(hashDownloadToken(download_token));
  });

  it("expired session cannot download or write", async () => {
    const now = new Date("2026-07-24T12:00:00.000Z");
    const { session } = await store.create(
      baseCreate({ now, ttl_seconds: 60 }),
    );

    const afterExpiry = new Date("2026-07-24T12:02:00.000Z");

    const download = await store.authorize({
      session_id: session.session_id,
      tenant_id: "tenant-a",
      purpose: "download",
      now: afterExpiry,
    });
    expect(download).toEqual({ ok: false, reason: "expired" });

    const write = await store.authorize({
      session_id: session.session_id,
      tenant_id: "tenant-a",
      purpose: "write",
      now: afterExpiry,
    });
    expect(write).toEqual({ ok: false, reason: "expired" });

    // Still active before expiry.
    const before = await store.authorize({
      session_id: session.session_id,
      tenant_id: "tenant-a",
      purpose: "download",
      now,
    });
    expect(before.ok).toBe(true);
  });

  it("tenant mismatch fails closed for download, write, and owner_read", async () => {
    const { session } = await store.create(baseCreate());

    for (const purpose of ["download", "write", "owner_read"] as const) {
      const result = await store.authorize({
        session_id: session.session_id,
        tenant_id: "tenant-other",
        user_id: "user-1",
        purpose,
      });
      expect(result).toEqual({ ok: false, reason: "tenant_mismatch" });
    }
  });

  it("user mismatch fails closed for owner_read", async () => {
    const { session } = await store.create(baseCreate());

    const mismatch = await store.authorize({
      session_id: session.session_id,
      tenant_id: "tenant-a",
      user_id: "user-other",
      purpose: "owner_read",
    });
    expect(mismatch).toEqual({ ok: false, reason: "user_mismatch" });

    const owner = await store.authorize({
      session_id: session.session_id,
      tenant_id: "tenant-a",
      user_id: "user-1",
      purpose: "owner_read",
    });
    expect(owner.ok).toBe(true);
  });

  it("duplicate create with same caller_key is idempotent", async () => {
    const input = baseCreate({ caller_key: "open-req-42" });
    const first = await store.create(input);
    const second = await store.create(input);

    expect(second.idempotent_replay).toBe(true);
    expect(second.session.session_id).toBe(first.session.session_id);
    expect(second.session.document_key).toBe(first.session.document_key);
    expect(second.session.download_token_hash).toBe(
      first.session.download_token_hash,
    );
    expect(second.session.callback_nonce).toBe(first.session.callback_nonce);
  });

  it("same caller_key with different path creates a new session", async () => {
    const first = await store.create(
      baseCreate({ caller_key: "open-req-99", path: "/a.docx" }),
    );
    const second = await store.create(
      baseCreate({ caller_key: "open-req-99", path: "/b.docx" }),
    );
    expect(second.idempotent_replay).toBe(false);
    expect(second.session.session_id).not.toBe(first.session.session_id);
  });

  it("closed session cannot download or write", async () => {
    const { session } = await store.create(baseCreate());
    await store.close(session.session_id);

    const download = await store.authorize({
      session_id: session.session_id,
      tenant_id: "tenant-a",
      purpose: "download",
    });
    expect(download).toEqual({ ok: false, reason: "closed" });

    const write = await store.authorize({
      session_id: session.session_id,
      tenant_id: "tenant-a",
      purpose: "write",
    });
    expect(write).toEqual({ ok: false, reason: "closed" });
  });

  it("view mode cannot write", async () => {
    const { session } = await store.create(baseCreate({ mode: "view" }));
    const write = await store.authorize({
      session_id: session.session_id,
      tenant_id: "tenant-a",
      purpose: "write",
    });
    expect(write).toEqual({ ok: false, reason: "mode" });

    const download = await store.authorize({
      session_id: session.session_id,
      tenant_id: "tenant-a",
      purpose: "download",
    });
    expect(download.ok).toBe(true);
  });

  it("updateLifecycle records last_save_status", async () => {
    const { session } = await store.create(baseCreate());
    const updated = await store.updateLifecycle(session.session_id, "saved", {
      last_save_status: "saved",
      dirty: false,
      saved_revision: {
        token: "rev-etag-new",
        kind: "etag",
        size_bytes: 5000,
      },
    });
    expect(updated?.lifecycle).toBe("saved");
    expect(updated?.last_save_status).toBe("saved");
    expect(updated?.saved_revision?.token).toBe("rev-etag-new");
    // After saved, write is blocked by lifecycle; download still allowed.
    const write = await store.authorize({
      session_id: session.session_id,
      tenant_id: "tenant-a",
      purpose: "write",
    });
    expect(write).toEqual({ ok: false, reason: "lifecycle" });
  });

  it("unknown session_id is not_found", async () => {
    const result = await store.authorize({
      session_id: "does-not-exist",
      tenant_id: "tenant-a",
      purpose: "download",
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("OfficeDocumentSession store (redis via ioredis-mock)", () => {
  let redis: RedisLike;
  let store: RedisOfficeDocumentSessionStore;

  afterEach(async () => {
    await store?.clear();
    await store?.closeStore?.();
  });

  function makeStore(): RedisOfficeDocumentSessionStore {
    // Fresh mock per test so keys do not leak across cases.
    redis = new RedisMock() as unknown as RedisLike;
    store = new RedisOfficeDocumentSessionStore(redis, { ttlSeconds: 3600 });
    return store;
  }

  it("creates and loads session with required fields", async () => {
    const s = makeStore();
    expect(await s.ready()).toBe(true);
    await expectSessionShape(s);
  });

  it("expired session cannot download or write", async () => {
    const s = makeStore();
    const now = new Date("2026-07-24T12:00:00.000Z");
    const { session } = await s.create(baseCreate({ now, ttl_seconds: 30 }));

    const after = new Date("2026-07-24T12:01:00.000Z");
    expect(
      await s.authorize({
        session_id: session.session_id,
        tenant_id: "tenant-a",
        purpose: "download",
        now: after,
      }),
    ).toEqual({ ok: false, reason: "expired" });
    expect(
      await s.authorize({
        session_id: session.session_id,
        tenant_id: "tenant-a",
        purpose: "write",
        now: after,
      }),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("tenant mismatch fails closed", async () => {
    const s = makeStore();
    const { session } = await s.create(baseCreate());
    expect(
      await s.authorize({
        session_id: session.session_id,
        tenant_id: "tenant-b",
        purpose: "download",
      }),
    ).toEqual({ ok: false, reason: "tenant_mismatch" });
  });

  it("user mismatch fails closed for owner_read", async () => {
    const s = makeStore();
    const { session } = await s.create(baseCreate());
    expect(
      await s.authorize({
        session_id: session.session_id,
        tenant_id: "tenant-a",
        user_id: "user-2",
        purpose: "owner_read",
      }),
    ).toEqual({ ok: false, reason: "user_mismatch" });
  });

  it("duplicate create with same caller_key is idempotent across shared redis", async () => {
    const s = makeStore();
    // Two store instances, one Redis — multi-instance BFF.
    const s2 = new RedisOfficeDocumentSessionStore(redis, { ttlSeconds: 3600 });

    const input = baseCreate({ caller_key: "shared-open-1" });
    const first = await s.create(input);
    const second = await s2.create(input);

    expect(second.idempotent_replay).toBe(true);
    expect(second.session.session_id).toBe(first.session.session_id);

    const loaded = await s2.get(first.session.session_id);
    expect(loaded?.path).toBe(input.path);
    expect(loaded?.revision.token).toBe(REVISION.token);
  });
});

describe("OfficeDocumentSession store factory", () => {
  it("defaults to memory backend", () => {
    const config = loadOfficeDocumentSessionStoreConfig({});
    expect(config.backend).toBe("memory");
    expect(config.ttlSeconds).toBe(DEFAULT_OFFICE_SESSION_TTL_SECONDS);
    expect(config.multiInstance).toBe(false);
  });

  it("falls back to BFF_SESSION_BACKEND when office-specific unset", () => {
    const config = loadOfficeDocumentSessionStoreConfig({
      BFF_SESSION_BACKEND: "redis",
      REDIS_URL: "redis://localhost:6379/0",
    });
    expect(config.backend).toBe("redis");
  });

  it("fail-closed: multi-instance requires redis", () => {
    expect(() =>
      assertOfficeDocumentSessionStoreConfig({
        backend: "memory",
        multiInstance: true,
        ttlSeconds: 3600,
      }),
    ).toThrow(/BFF_MULTI_INSTANCE requires BFF_OFFICE_SESSION_BACKEND=redis/);
  });

  it("fail-closed: redis requires REDIS_URL", () => {
    expect(() =>
      assertOfficeDocumentSessionStoreConfig({
        backend: "redis",
        multiInstance: false,
        ttlSeconds: 3600,
      }),
    ).toThrow(/REDIS_URL/);
  });

  it("createOfficeDocumentSessionStore returns memory store by default", async () => {
    const store = createOfficeDocumentSessionStore({
      backend: "memory",
      multiInstance: false,
      ttlSeconds: 3600,
    });
    expect(store).toBeInstanceOf(MemoryOfficeDocumentSessionStore);
    expect(await store.ready()).toBe(true);
  });

  it("createOfficeDocumentSessionStore returns redis store with injected client", async () => {
    const redis = new RedisMock() as unknown as RedisLike;
    const store = createOfficeDocumentSessionStore({
      backend: "redis",
      redisUrl: "redis://unused",
      multiInstance: true,
      ttlSeconds: 1800,
      redisClient: redis,
    });
    expect(store).toBeInstanceOf(RedisOfficeDocumentSessionStore);
    const { session } = await store.create(baseCreate());
    expect(session.session_id).toBeTruthy();
    await store.clear();
    await store.closeStore?.();
  });
});
