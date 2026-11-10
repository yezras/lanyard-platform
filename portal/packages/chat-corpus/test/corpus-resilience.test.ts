/**
 * lp-gkh.7 — Metrics, retry with backoff, DLQ for corpus writes.
 */
import { describe, expect, it, vi } from "vitest";

import {
  buildChatCorpusDlqObjectKey,
  contentSha256,
  CORPUS_METRIC_WRITE_BYTES,
  CORPUS_METRIC_WRITE_FAILURE,
  CORPUS_METRIC_WRITE_LATENCY,
  CORPUS_METRIC_WRITE_SUCCESS,
  corpusRetryDelayMs,
  createCorpusMetricsHooks,
  DEFAULT_CORPUS_RETRY_MAX_ATTEMPTS,
  FakeCorpusObjectStore,
  FakeCorpusWriter,
  InMemoryCorpusMetrics,
  isChatCorpusDlqObjectKey,
  isChatCorpusTurnObjectKey,
  isTransientCorpusStoreError,
  normalizeCorpusRetryPolicy,
  S3CorpusWriter,
  serializeChatTurnRecordBody,
  type ChatTurnRecord,
  type CorpusWriteMetricsEvent,
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

describe("retry policy helpers (lp-gkh.7)", () => {
  it("normalizes defaults (3 attempts, 50ms base, 1000ms cap)", () => {
    const p = normalizeCorpusRetryPolicy(undefined);
    expect(p.maxAttempts).toBe(DEFAULT_CORPUS_RETRY_MAX_ATTEMPTS);
    expect(p.maxAttempts).toBe(3);
    expect(p.baseDelayMs).toBe(50);
    expect(p.maxDelayMs).toBe(1000);
  });

  it("exponential delay caps at maxDelayMs", () => {
    const policy = { baseDelayMs: 50, maxDelayMs: 200 };
    expect(corpusRetryDelayMs(0, policy)).toBe(50);
    expect(corpusRetryDelayMs(1, policy)).toBe(100);
    expect(corpusRetryDelayMs(2, policy)).toBe(200);
    expect(corpusRetryDelayMs(5, policy)).toBe(200);
  });

  it("classifies AccessDenied as permanent and network as transient", () => {
    expect(isTransientCorpusStoreError(new Error("AccessDenied"))).toBe(false);
    expect(isTransientCorpusStoreError(new Error("network down"))).toBe(true);
    expect(isTransientCorpusStoreError(new Error("SlowDown: reduce rate"))).toBe(
      true,
    );
    expect(isTransientCorpusStoreError(new Error("NoSuchBucket"))).toBe(false);
  });
});

describe("metrics emitted on write (lp-gkh.7)", () => {
  it("FakeCorpusWriter emits success + latency + bytes via onWriteEvent", async () => {
    const metrics = new InMemoryCorpusMetrics();
    const events: CorpusWriteMetricsEvent[] = [];
    const writer = new FakeCorpusWriter({
      onWriteEvent(event) {
        events.push(event);
        metrics.observe(event);
      },
    });
    const record = baseRecord();
    const result = await writer.writeTurn(record);
    expect(result.ok).toBe(true);
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    expect(result.bytes).toBe(
      Buffer.byteLength(serializeChatTurnRecordBody(record), "utf8"),
    );
    expect(result.attempts).toBe(1);

    const snap = metrics.snapshot();
    expect(snap.write_success).toBe(1);
    expect(snap.write_failure).toBe(0);
    expect(snap.write_latency_ms_count).toBe(1);
    expect(snap.write_bytes).toBe(result.bytes);
    expect(events).toHaveLength(1);
    expect(events[0]!.retried).toBe(false);
  });

  it("createCorpusMetricsHooks fans out to sink with stable names", async () => {
    const metrics = new InMemoryCorpusMetrics();
    const sinkCalls: Array<{ name: string; value?: number }> = [];
    const hooks = createCorpusMetricsHooks(metrics, (name, value) => {
      sinkCalls.push({ name, value });
    });
    const writer = new FakeCorpusWriter(hooks);
    await writer.writeTurn(baseRecord());
    const names = sinkCalls.map((c) => c.name);
    expect(names).toContain(CORPUS_METRIC_WRITE_SUCCESS);
    expect(names).toContain(CORPUS_METRIC_WRITE_LATENCY);
    expect(names).toContain(CORPUS_METRIC_WRITE_BYTES);
    expect(names).not.toContain(CORPUS_METRIC_WRITE_FAILURE);
    expect(metrics.snapshot().write_success).toBe(1);
  });

  it("S3CorpusWriter records failure metrics after exhausted retries", async () => {
    const metrics = new InMemoryCorpusMetrics();
    const sleep = vi.fn(async () => {});
    const store = new FakeCorpusObjectStore({
      error: () => new Error("network down"),
    });
    const writer = new S3CorpusWriter({
      bucket: BUCKET,
      store,
      retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5, sleep },
      hooks: {
        onWriteEvent: (e) => metrics.observe(e),
      },
    });
    const result = await writer.writeTurn(baseRecord());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("S3_GET_FAILED");
    expect(result.attempts).toBe(3);
    expect(result.retryable).toBe(true);
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    expect(result.bytes).toBeGreaterThan(0);
    expect(sleep).toHaveBeenCalledTimes(2); // delays between 3 attempts
    const snap = metrics.snapshot();
    expect(snap.write_failure).toBe(1);
    expect(snap.write_success).toBe(0);
    expect(snap.write_retry).toBe(2);
  });
});

describe("retry with backoff (lp-gkh.7)", () => {
  it("retries transient put failures then succeeds", async () => {
    const store = new FakeCorpusObjectStore();
    let puts = 0;
    const originalPut = store.putObject.bind(store);
    store.putObject = async (input) => {
      puts += 1;
      if (puts < 3) {
        throw new Error("ServiceUnavailable: try again");
      }
      return originalPut(input);
    };
    const sleep = vi.fn(async () => {});
    const writer = new S3CorpusWriter({
      bucket: BUCKET,
      store,
      retry: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 50, sleep },
    });
    const result = await writer.writeTurn(baseRecord());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("written");
    expect(result.attempts).toBeGreaterThanOrEqual(3); // 1 get + 3 puts
    expect(puts).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(store.get(BUCKET, EXPECTED_KEY)).toBeDefined();
  });

  it("does not retry permanent AccessDenied", async () => {
    const store = new FakeCorpusObjectStore();
    let puts = 0;
    store.putObject = async () => {
      puts += 1;
      throw new Error("AccessDenied");
    };
    const sleep = vi.fn(async () => {});
    const writer = new S3CorpusWriter({
      bucket: BUCKET,
      store,
      retry: { maxAttempts: 5, baseDelayMs: 10, maxDelayMs: 50, sleep },
    });
    const result = await writer.writeTurn(baseRecord());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("S3_PUT_FAILED");
    expect(result.retryable).toBe(false);
    expect(puts).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("DLQ failed/ prefix (lp-gkh.7)", () => {
  it("builds failed/ key without thread= (excluded from training export)", () => {
    const key = buildChatCorpusDlqObjectKey({
      tenant_id: "tenant-1",
      turn_id: "turn-1",
      failed_at: "2026-08-07T15:04:05.000Z",
    });
    expect(key).toBe(
      "tenants/tenant-1/chat-corpus/v1/failed/year=2026/month=08/day=07/turn=turn-1.json",
    );
    expect(isChatCorpusDlqObjectKey(key)).toBe(true);
    expect(isChatCorpusTurnObjectKey(key)).toBe(false);
  });

  it("enqueues DLQ envelope after exhausted transient failures", async () => {
    const store = new FakeCorpusObjectStore({
      error: () => new Error("network down"),
    });
    const sleep = vi.fn(async () => {});
    // DLQ uses a clean store so enqueue can succeed while main path fails.
    const dlqStore = new FakeCorpusObjectStore();
    const metrics = new InMemoryCorpusMetrics();
    const writer = new S3CorpusWriter({
      bucket: BUCKET,
      store,
      retry: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 2, sleep },
      dlq: {
        enabled: true,
        store: dlqStore,
        now: () => new Date("2026-08-07T15:04:05.000Z"),
      },
      hooks: { onWriteEvent: (e) => metrics.observe(e) },
    });
    const record = baseRecord();
    const result = await writer.writeTurn(record);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.dlq_key).toBe(
      "tenants/tenant-1/chat-corpus/v1/failed/year=2026/month=08/day=07/turn=turn-1.json",
    );
    expect(metrics.snapshot().write_dlq).toBe(1);
    const obj = dlqStore.get(BUCKET, result.dlq_key!);
    expect(obj).toBeDefined();
    const envelope = JSON.parse(obj!.body.trim()) as {
      record_type: string;
      code: string;
      record: ChatTurnRecord;
      original_key: string;
    };
    expect(envelope.record_type).toBe("chat_turn_dlq");
    expect(envelope.code).toBe("S3_GET_FAILED");
    expect(envelope.record.turn_id).toBe("turn-1");
    expect(envelope.original_key).toBe(EXPECTED_KEY);
  });

  it("DLQ off by default — no failed/ object on error", async () => {
    const store = new FakeCorpusObjectStore({
      error: () => new Error("network down"),
    });
    const writer = new S3CorpusWriter({
      bucket: BUCKET,
      store,
      retry: {
        maxAttempts: 1,
        sleep: async () => {},
      },
    });
    expect(writer.isDlqEnabled()).toBe(false);
    const result = await writer.writeTurn(baseRecord());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.dlq_key).toBeUndefined();
    // Store only throws — no successful puts of any kind.
    expect(store.getPutCount()).toBe(0);
  });

  it("invalid record can DLQ with raw_preview when enabled", async () => {
    const store = new FakeCorpusObjectStore();
    const writer = new S3CorpusWriter({
      bucket: BUCKET,
      store,
      dlq: {
        enabled: true,
        now: () => new Date("2026-08-07T12:00:00.000Z"),
      },
    });
    const result = await writer.writeTurn({ not: "valid" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_RECORD");
    expect(result.dlq_key).toBeDefined();
    expect(isChatCorpusDlqObjectKey(result.dlq_key!)).toBe(true);
    const body = store.get(BUCKET, result.dlq_key!)?.body ?? "";
    const envelope = JSON.parse(body.trim()) as { raw_preview?: string };
    expect(envelope.raw_preview).toContain("not");
  });
});
