/**
 * lp-gkh.4 — CorpusWriter interface + fake + idempotent S3 put by turn_id.
 */
import { describe, expect, it } from "vitest";

import {
  buildChatCorpusObjectKey,
  buildChatCorpusObjectKeyFromRecord,
  buildChatCorpusTenantPrefix,
  chatCorpusHiveFromCreatedAt,
  ChatCorpusKeyError,
  CHAT_CORPUS_LAYOUT_VERSION,
  contentSha256,
  FakeCorpusObjectStore,
  FakeCorpusWriter,
  S3CorpusWriter,
  serializeChatTurnRecordBody,
  type ChatTurnRecord,
  type CorpusWriteResult,
} from "../src/index.js";

const BUCKET = "lanyard-chat-corpus-test";

function baseRecord(overrides: Partial<ChatTurnRecord> = {}): ChatTurnRecord {
  const inputContent = "hello";
  const outputContent = "world";
  return {
    schema_version: 1,
    record_type: "chat_turn",
    tenant_id: "tenant-1",
    user_id: "user-1",
    instance_id: "instance-1",
    thread_id: "thread-1",
    turn_id: "turn-1",
    created_at: "2026-08-07T15:04:05.000Z",
    model: { provider: "poolside", name: "laguna-s-2.1" },
    input: {
      role: "user",
      content: inputContent,
      content_sha256: contentSha256(inputContent),
    },
    output: {
      role: "assistant",
      content: outputContent,
      content_sha256: contentSha256(outputContent),
      finish_reason: "stop",
    },
    tool_events: [],
    meta: { client: "portal_web" },
    ...overrides,
  };
}

const EXPECTED_KEY =
  "tenants/tenant-1/chat-corpus/v1/year=2026/month=08/day=07/thread=thread-1/turn=turn-1.json";

describe("chat corpus S3 key shape (lp-gkh.4)", () => {
  it("builds tenants/{tid}/chat-corpus/v1/year=/month=/day=/thread=/turn=.json", () => {
    const key = buildChatCorpusObjectKey({
      tenant_id: "tenant-1",
      thread_id: "thread-1",
      turn_id: "turn-1",
      created_at: "2026-08-07T15:04:05.000Z",
    });
    expect(key).toBe(EXPECTED_KEY);
    expect(key).toContain(`/chat-corpus/${CHAT_CORPUS_LAYOUT_VERSION}/`);
    expect(key.endsWith("turn=turn-1.json")).toBe(true);
  });

  it("uses UTC hive partitions from created_at", () => {
    // 2026-08-07T01:00:00+09:00 → 2026-08-06T16:00:00Z
    const hive = chatCorpusHiveFromCreatedAt("2026-08-07T01:00:00+09:00");
    expect(hive).toEqual({ year: "2026", month: "08", day: "06" });
    const key = buildChatCorpusObjectKey({
      tenant_id: "t1",
      thread_id: "th1",
      turn_id: "tu1",
      created_at: "2026-08-07T01:00:00+09:00",
    });
    expect(key).toContain("year=2026/month=08/day=06/");
  });

  it("buildChatCorpusObjectKeyFromRecord matches explicit parts", () => {
    const record = baseRecord();
    expect(buildChatCorpusObjectKeyFromRecord(record)).toBe(EXPECTED_KEY);
  });

  it("tenant list prefix ends with slash under v1", () => {
    expect(buildChatCorpusTenantPrefix("tenant-1")).toBe(
      "tenants/tenant-1/chat-corpus/v1/",
    );
  });

  it("rejects path traversal / empty path segments", () => {
    expect(() =>
      buildChatCorpusObjectKey({
        tenant_id: "../x",
        thread_id: "t",
        turn_id: "u",
        created_at: "2026-08-07T00:00:00Z",
      }),
    ).toThrow(ChatCorpusKeyError);
    expect(() =>
      buildChatCorpusObjectKey({
        tenant_id: "ok",
        thread_id: "a/b",
        turn_id: "u",
        created_at: "2026-08-07T00:00:00Z",
      }),
    ).toThrow(ChatCorpusKeyError);
  });
});

describe("FakeCorpusWriter stores records", () => {
  it("stores a valid record under the corpus key", async () => {
    const writer = new FakeCorpusWriter();
    const record = baseRecord();
    const result = await writer.writeTurn(record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("written");
    expect(result.key).toBe(EXPECTED_KEY);
    expect(result.turn_id).toBe("turn-1");
    expect(writer.size()).toBe(1);
    expect(writer.getByKey(EXPECTED_KEY)).toEqual(record);
    expect(writer.getByTurnId("turn-1")).toEqual(record);
  });

  it("second write same turn_id is ok (idempotent_skip when body equal)", async () => {
    const writer = new FakeCorpusWriter();
    const record = baseRecord();
    const first = await writer.writeTurn(record);
    const second = await writer.writeTurn(record);
    expect(first.ok && first.status === "written").toBe(true);
    expect(second.ok && second.status === "idempotent_skip").toBe(true);
    expect(writer.size()).toBe(1);
    expect(writer.getWriteCount()).toBe(2);
  });

  it("returns INVALID_RECORD without throwing on bad input", async () => {
    const writer = new FakeCorpusWriter();
    const result = await writer.writeTurn({ schema_version: 2 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_RECORD");
    expect(writer.size()).toBe(0);
  });

  it("notifies hooks without letting hook failures throw", async () => {
    const seen: CorpusWriteResult[] = [];
    const writer = new FakeCorpusWriter({
      onWriteResult: (r) => {
        seen.push(r);
        throw new Error("hook boom");
      },
    });
    const result = await writer.writeTurn(baseRecord());
    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(1);
  });
});

describe("S3CorpusWriter + FakeCorpusObjectStore", () => {
  it("PutObject uses normative key shape", async () => {
    const store = new FakeCorpusObjectStore();
    const writer = new S3CorpusWriter({ bucket: BUCKET, store });
    const record = baseRecord();
    const result = await writer.writeTurn(record);
    expect(result).toMatchObject({
      ok: true,
      status: "written",
      key: EXPECTED_KEY,
      bucket: BUCKET,
      turn_id: "turn-1",
    });
    expect(store.getPutCount()).toBe(1);
    const obj = store.get(BUCKET, EXPECTED_KEY);
    expect(obj).toBeDefined();
    expect(obj?.contentType).toMatch(/^application\/json/);
    expect(JSON.parse(obj!.body.trim())).toEqual(record);
  });

  it("second write same turn_id is ok (idempotent; no second put when body equal)", async () => {
    const store = new FakeCorpusObjectStore();
    const writer = new S3CorpusWriter({ bucket: BUCKET, store });
    const record = baseRecord();
    const first = await writer.writeTurn(record);
    const second = await writer.writeTurn(record);
    expect(first.ok && first.status === "written").toBe(true);
    expect(second.ok && second.status === "idempotent_skip").toBe(true);
    if (!second.ok) return;
    expect(second.key).toBe(EXPECTED_KEY);
    // One put only — second path short-circuits after getObject equality.
    expect(store.getPutCount()).toBe(1);
    expect(store.getGetCount()).toBe(2);
  });

  it("re-puts when same turn_id key exists with different body", async () => {
    const store = new FakeCorpusObjectStore();
    const writer = new S3CorpusWriter({ bucket: BUCKET, store });
    const first = baseRecord({
      output: {
        role: "assistant",
        content: "v1",
        content_sha256: contentSha256("v1"),
      },
    });
    const second = baseRecord({
      output: {
        role: "assistant",
        content: "v2-corrected",
        content_sha256: contentSha256("v2-corrected"),
      },
    });
    expect((await writer.writeTurn(first)).ok).toBe(true);
    const result = await writer.writeTurn(second);
    expect(result.ok && result.status === "written").toBe(true);
    expect(store.getPutCount()).toBe(2);
    const body = store.get(BUCKET, EXPECTED_KEY)?.body ?? "";
    expect(JSON.parse(body.trim()).output.content).toBe("v2-corrected");
  });

  it("never throws on store put failure — returns Result", async () => {
    const store = new FakeCorpusObjectStore({
      error: () => new Error("network down"),
    });
    const writer = new S3CorpusWriter({ bucket: BUCKET, store });
    const result = await writer.writeTurn(baseRecord());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // getObject fails first in the path
    expect(result.code).toBe("S3_GET_FAILED");
    expect(result.error).toMatch(/network down/);
    expect(result.key).toBe(EXPECTED_KEY);
  });

  it("never throws on put-only failure after empty get", async () => {
    const store = new FakeCorpusObjectStore();
    // Succeed get (miss), fail put
    let puts = 0;
    const originalPut = store.putObject.bind(store);
    store.putObject = async (input) => {
      puts += 1;
      if (puts === 1) {
        throw new Error("AccessDenied");
      }
      return originalPut(input);
    };
    const writer = new S3CorpusWriter({ bucket: BUCKET, store });
    const result = await writer.writeTurn(baseRecord());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("S3_PUT_FAILED");
    expect(result.error).toMatch(/AccessDenied/);
  });

  it("rejects invalid records without calling putObject", async () => {
    const store = new FakeCorpusObjectStore();
    const writer = new S3CorpusWriter({ bucket: BUCKET, store });
    const result = await writer.writeTurn({ not: "a record" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_RECORD");
    expect(store.getPutCount()).toBe(0);
  });

  it("constructor rejects bad bucket names", () => {
    const store = new FakeCorpusObjectStore();
    expect(() => new S3CorpusWriter({ bucket: "", store })).toThrow(/bucket/);
    expect(
      () => new S3CorpusWriter({ bucket: "s3://my-bucket", store }),
    ).toThrow(/bare bucket/);
  });

  it("serializeChatTurnRecordBody is stable for equality checks", () => {
    const r = baseRecord();
    expect(serializeChatTurnRecordBody(r)).toBe(
      `${JSON.stringify(r)}\n`,
    );
  });
});
