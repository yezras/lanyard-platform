/**
 * CorpusWriter — durable turn archive write boundary (lp-gkh.4 / lp-gkh.7).
 *
 * Interface: `writeTurn(record) → Promise<CorpusWriteResult>`
 * - Fake in-memory for tests ({@link FakeCorpusWriter})
 * - S3 PutObject by turn_id key ({@link S3CorpusWriter})
 *
 * **Never throws to the caller path** — failures are returned as
 * `{ ok: false, … }`. Callers fail-open for chat (user turn still succeeds)
 * and surface drops via metrics / retry / DLQ (`lp-gkh.7`).
 *
 * Resilience (lp-gkh.7):
 * - Metrics: success, failure, latency_ms, bytes (+ retry / DLQ counters)
 * - Retry with exponential backoff for transient S3 errors
 * - Optional DLQ via S3 `failed/` prefix (SQS deferred)
 */

import { enqueueCorpusDlq } from "./dlq.js";
import {
  buildChatCorpusObjectKeyFromRecord,
  ChatCorpusKeyError,
} from "./key.js";
import type { CorpusWriteMetricsEvent } from "./metrics.js";
import type { CorpusObjectStore } from "./object-store.js";
import { safeParseChatTurnRecord } from "./parse.js";
import {
  isTransientCorpusStoreError,
  normalizeCorpusRetryPolicy,
  type CorpusRetryPolicy,
  type CorpusRetryPolicyInput,
  withCorpusRetry,
} from "./retry.js";
import type { ChatTurnRecord } from "./schema.js";

/** JSON Content-Type for ChatTurnRecord objects. */
export const CHAT_CORPUS_CONTENT_TYPE = "application/json; charset=utf-8";

/**
 * Success statuses:
 * - `written` — PutObject applied (first write or content changed)
 * - `idempotent_skip` — same key + identical body already present
 */
export type CorpusWriteStatus = "written" | "idempotent_skip";

export type CorpusWriteOk = {
  ok: true;
  status: CorpusWriteStatus;
  /** Relative object key (no bucket). */
  key: string;
  /** Bucket when using S3 writer; empty for pure in-memory fake. */
  bucket: string;
  turn_id: string;
  tenant_id: string;
  /** End-to-end writeTurn latency including retries (ms). */
  latency_ms?: number;
  /** Serialized body UTF-8 byte length. */
  bytes?: number;
  /** 1-based attempts used (1 = no retry). */
  attempts?: number;
};

export type CorpusWriteErr = {
  ok: false;
  /** Stable machine code for metrics / DLQ routing. */
  code: string;
  /** Human-readable detail (safe to log; no secrets). */
  error: string;
  turn_id?: string;
  tenant_id?: string;
  key?: string;
  bucket?: string;
  latency_ms?: number;
  bytes?: number;
  attempts?: number;
  /** True when the failure was classified as retriable (retries exhausted). */
  retryable?: boolean;
  /** DLQ object key when a poison enqueue succeeded. */
  dlq_key?: string;
};

/** Result of one corpus write attempt — never thrown. */
export type CorpusWriteResult = CorpusWriteOk | CorpusWriteErr;

/**
 * Platform-boundary writer for L10 chat corpus turns.
 * BFF (primary) and optional Relay dual-write implement/call this.
 */
export interface CorpusWriter {
  writeTurn(record: unknown): Promise<CorpusWriteResult>;
}

/** Optional observer for fail-open telemetry (lp-gkh.7). */
export type CorpusWriterHooks = {
  /**
   * Invoked after every writeTurn outcome (success or failure).
   * Must not throw; writer swallows hook errors.
   */
  onWriteResult?: (result: CorpusWriteResult) => void;
  /**
   * Rich metrics event (latency, bytes, attempts, DLQ). Preferred for
   * {@link InMemoryCorpusMetrics.observe}.
   */
  onWriteEvent?: (event: CorpusWriteMetricsEvent) => void;
};

function notify(
  hooks: CorpusWriterHooks | undefined,
  result: CorpusWriteResult,
  event: CorpusWriteMetricsEvent,
): void {
  if (hooks?.onWriteResult) {
    try {
      hooks.onWriteResult(result);
    } catch {
      // Fail-open: hooks must not break the write path.
    }
  }
  if (hooks?.onWriteEvent) {
    try {
      hooks.onWriteEvent(event);
    } catch {
      // Fail-open.
    }
  }
}

function nowMs(): number {
  return Date.now();
}

function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/** Stable JSON body for content-addressed idempotency compare. */
export function serializeChatTurnRecordBody(record: ChatTurnRecord): string {
  return `${JSON.stringify(record)}\n`;
}

function err(
  code: string,
  error: string,
  extra: Partial<CorpusWriteErr> = {},
): CorpusWriteErr {
  return { ok: false, code, error, ...extra };
}

function withTiming(
  result: CorpusWriteResult,
  timing: {
    latency_ms: number;
    bytes: number;
    attempts: number;
  },
): CorpusWriteResult {
  if (result.ok) {
    return {
      ...result,
      latency_ms: timing.latency_ms,
      bytes: timing.bytes,
      attempts: timing.attempts,
    };
  }
  return {
    ...result,
    latency_ms: timing.latency_ms,
    bytes: timing.bytes,
    attempts: timing.attempts,
  };
}

/**
 * In-memory CorpusWriter for unit tests and local fail-open dry runs.
 * Stores full records keyed by corpus object key (same shape as S3).
 */
export class FakeCorpusWriter implements CorpusWriter {
  private readonly byKey = new Map<string, ChatTurnRecord>();
  private readonly byTurnId = new Map<string, ChatTurnRecord>();
  private writeCount = 0;
  private readonly hooks: CorpusWriterHooks;

  constructor(hooks: CorpusWriterHooks = {}) {
    this.hooks = hooks;
  }

  async writeTurn(input: unknown): Promise<CorpusWriteResult> {
    this.writeCount += 1;
    const started = nowMs();
    let result: CorpusWriteResult;
    let bytes = 0;
    try {
      const inner = this.writeTurnInner(input);
      result = inner.result;
      bytes = inner.bytes;
    } catch (e) {
      // Defensive: interface contract is never-throw.
      result = err(
        "UNEXPECTED",
        e instanceof Error ? e.message : String(e),
      );
    }
    const latency_ms = Math.max(0, nowMs() - started);
    const attempts = 1;
    result = withTiming(result, { latency_ms, bytes, attempts });
    notify(this.hooks, result, {
      result,
      latency_ms,
      bytes,
      attempts,
      retried: false,
    });
    return result;
  }

  private writeTurnInner(input: unknown): {
    result: CorpusWriteResult;
    bytes: number;
  } {
    const parsed = safeParseChatTurnRecord(input);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .slice(0, 5)
        .join("; ");
      return {
        result: err("INVALID_RECORD", message || "invalid ChatTurnRecord"),
        bytes: 0,
      };
    }
    const record = parsed.data;
    let key: string;
    try {
      key = buildChatCorpusObjectKeyFromRecord(record);
    } catch (e) {
      if (e instanceof ChatCorpusKeyError) {
        return {
          result: err(e.code, e.message, {
            turn_id: record.turn_id,
            tenant_id: record.tenant_id,
          }),
          bytes: 0,
        };
      }
      return {
        result: err("KEY_ERROR", e instanceof Error ? e.message : String(e), {
          turn_id: record.turn_id,
          tenant_id: record.tenant_id,
        }),
        bytes: 0,
      };
    }

    const body = serializeChatTurnRecordBody(record);
    const bytes = utf8Bytes(body);

    const existing = this.byKey.get(key);
    if (existing) {
      const same =
        serializeChatTurnRecordBody(existing) === body;
      if (same) {
        return {
          result: {
            ok: true,
            status: "idempotent_skip",
            key,
            bucket: "",
            turn_id: record.turn_id,
            tenant_id: record.tenant_id,
          },
          bytes,
        };
      }
    }

    this.byKey.set(key, record);
    this.byTurnId.set(record.turn_id, record);
    return {
      result: {
        ok: true,
        status: "written",
        key,
        bucket: "",
        turn_id: record.turn_id,
        tenant_id: record.tenant_id,
      },
      bytes,
    };
  }

  /** Test helper: stored record for a corpus key. */
  getByKey(key: string): ChatTurnRecord | undefined {
    return this.byKey.get(key);
  }

  /** Test helper: last record written for a turn_id (any key). */
  getByTurnId(turnId: string): ChatTurnRecord | undefined {
    return this.byTurnId.get(turnId);
  }

  /** All stored keys (sorted). */
  keys(): string[] {
    return [...this.byKey.keys()].sort();
  }

  size(): number {
    return this.byKey.size;
  }

  getWriteCount(): number {
    return this.writeCount;
  }

  clear(): void {
    this.byKey.clear();
    this.byTurnId.clear();
    this.writeCount = 0;
  }
}

export type CorpusDlqOptions = {
  /**
   * When true, exhausted / permanent store failures enqueue a DLQ object
   * under the `failed/` prefix (same bucket by default).
   * Default: false (opt-in).
   */
  enabled?: boolean;
  /**
   * v1 mode is S3 failed/ prefix. SQS is deferred (see metrics-retry-dlq.md).
   */
  mode?: "failed_prefix";
  /** Override store for DLQ puts (default: writer store). */
  store?: CorpusObjectStore;
  /** Injectable clock for DLQ hive partitions / failed_at. */
  now?: () => Date;
};

export type S3CorpusWriterOptions = {
  /** Bare bucket name (no s3://). */
  bucket: string;
  /** Injected object store (FakeCorpusObjectStore or live AWS adapter). */
  store: CorpusObjectStore;
  hooks?: CorpusWriterHooks;
  /** Retry policy for transient S3 get/put errors (lp-gkh.7). */
  retry?: CorpusRetryPolicyInput;
  /** Optional poison-message DLQ (lp-gkh.7). */
  dlq?: CorpusDlqOptions;
};

/**
 * S3 CorpusWriter: PutObject under tenant/time/thread/turn key.
 * Idempotent on same `turn_id` (stable key): identical body → skip put.
 *
 * Resilience (lp-gkh.7): retries transient store errors with backoff;
 * optional `failed/` DLQ after exhaustion; emits latency + bytes metrics.
 */
export class S3CorpusWriter implements CorpusWriter {
  private readonly bucket: string;
  private readonly store: CorpusObjectStore;
  private readonly hooks: CorpusWriterHooks;
  private readonly retry: CorpusRetryPolicy;
  private readonly dlqEnabled: boolean;
  private readonly dlqStore: CorpusObjectStore;
  private readonly dlqNow: () => Date;

  constructor(options: S3CorpusWriterOptions) {
    const bucket = options.bucket?.trim() ?? "";
    if (!bucket) {
      throw new Error("S3CorpusWriter: bucket is required");
    }
    if (bucket.startsWith("s3://") || bucket.includes("/")) {
      throw new Error(
        "S3CorpusWriter: bucket must be a bare bucket name (no s3:// or key prefix)",
      );
    }
    this.bucket = bucket;
    this.store = options.store;
    this.hooks = options.hooks ?? {};
    this.retry = normalizeCorpusRetryPolicy(options.retry);
    this.dlqEnabled = options.dlq?.enabled === true;
    this.dlqStore = options.dlq?.store ?? options.store;
    this.dlqNow = options.dlq?.now ?? (() => new Date());
  }

  async writeTurn(input: unknown): Promise<CorpusWriteResult> {
    const started = nowMs();
    let result: CorpusWriteResult;
    let bytes = 0;
    let attempts = 1;
    let dlqMeta: CorpusWriteMetricsEvent["dlq"];

    try {
      const inner = await this.writeTurnInner(input);
      result = inner.result;
      bytes = inner.bytes;
      attempts = inner.attempts;
      dlqMeta = inner.dlq;
    } catch (e) {
      result = err(
        "UNEXPECTED",
        e instanceof Error ? e.message : String(e),
      );
    }

    const latency_ms = Math.max(0, nowMs() - started);
    result = withTiming(result, { latency_ms, bytes, attempts });
    if (dlqMeta?.ok && dlqMeta.key && !result.ok) {
      result = { ...result, dlq_key: dlqMeta.key };
    }

    notify(this.hooks, result, {
      result,
      latency_ms,
      bytes,
      attempts,
      retried: attempts > 1,
      dlq: dlqMeta,
    });
    return result;
  }

  private async writeTurnInner(input: unknown): Promise<{
    result: CorpusWriteResult;
    bytes: number;
    attempts: number;
    dlq?: CorpusWriteMetricsEvent["dlq"];
  }> {
    const parsed = safeParseChatTurnRecord(input);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .slice(0, 5)
        .join("; ");
      const code = "INVALID_RECORD";
      const error = message || "invalid ChatTurnRecord";
      // Poison invalid payloads: optional DLQ with raw preview.
      let dlq: CorpusWriteMetricsEvent["dlq"];
      if (this.dlqEnabled) {
        const enq = await enqueueCorpusDlq({
          store: this.dlqStore,
          bucket: this.bucket,
          code,
          error,
          attempts: 1,
          raw: input,
          now: this.dlqNow,
        });
        dlq = enq.ok
          ? { ok: true, key: enq.key }
          : { ok: false, error: enq.error };
      }
      return {
        result: err(code, error, {
          retryable: false,
          ...(dlq?.ok && dlq.key ? { dlq_key: dlq.key } : {}),
        }),
        bytes: 0,
        attempts: 1,
        dlq,
      };
    }
    const record = parsed.data;

    let key: string;
    try {
      key = buildChatCorpusObjectKeyFromRecord(record);
    } catch (e) {
      if (e instanceof ChatCorpusKeyError) {
        return {
          result: err(e.code, e.message, {
            turn_id: record.turn_id,
            tenant_id: record.tenant_id,
            retryable: false,
          }),
          bytes: 0,
          attempts: 1,
        };
      }
      return {
        result: err("KEY_ERROR", e instanceof Error ? e.message : String(e), {
          turn_id: record.turn_id,
          tenant_id: record.tenant_id,
          retryable: false,
        }),
        bytes: 0,
        attempts: 1,
      };
    }

    const body = serializeChatTurnRecordBody(record);
    const bytes = utf8Bytes(body);
    const base = {
      key,
      bucket: this.bucket,
      turn_id: record.turn_id,
      tenant_id: record.tenant_id,
    };

    // --- getObject with retry (transient only) ---
    let existing: string | null;
    let getAttempts = 0;
    try {
      const loop = await withCorpusRetry(
        async (attempt) => {
          getAttempts = attempt;
          return this.store.getObject({ bucket: this.bucket, key });
        },
        {
          policy: this.retry,
          shouldRetry: (error) => isTransientCorpusStoreError(error),
        },
      );
      existing = loop.value;
      getAttempts = loop.attempts;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const retryable = isTransientCorpusStoreError(e);
      const attempts = getAttempts > 0 ? getAttempts : 1;
      const fail = err("S3_GET_FAILED", message, {
        ...base,
        retryable,
      });
      const dlq = await this.maybeDlq({
        code: "S3_GET_FAILED",
        error: message,
        attempts,
        original_key: key,
        record,
      });
      return {
        result: {
          ...fail,
          ...(dlq?.ok && dlq.key ? { dlq_key: dlq.key } : {}),
        },
        bytes,
        attempts,
        dlq,
      };
    }

    if (existing !== null && existing === body) {
      return {
        result: {
          ok: true,
          status: "idempotent_skip",
          ...base,
        },
        bytes,
        attempts: getAttempts,
      };
    }

    // --- putObject with retry (transient only) ---
    let putAttempts = 0;
    try {
      const loop = await withCorpusRetry(
        async (attempt) => {
          putAttempts = attempt;
          await this.store.putObject({
            bucket: this.bucket,
            key,
            body,
            contentType: CHAT_CORPUS_CONTENT_TYPE,
          });
        },
        {
          policy: this.retry,
          shouldRetry: (error) => isTransientCorpusStoreError(error),
        },
      );
      putAttempts = loop.attempts;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const retryable = isTransientCorpusStoreError(e);
      // Report total store ops when put fails after a successful get.
      const attempts = getAttempts + (putAttempts > 0 ? putAttempts : 1);
      const fail = err("S3_PUT_FAILED", message, {
        ...base,
        retryable,
      });
      const dlq = await this.maybeDlq({
        code: "S3_PUT_FAILED",
        error: message,
        attempts,
        original_key: key,
        record,
      });
      return {
        result: {
          ...fail,
          ...(dlq?.ok && dlq.key ? { dlq_key: dlq.key } : {}),
        },
        bytes,
        attempts,
        dlq,
      };
    }

    return {
      result: {
        ok: true,
        status: "written",
        ...base,
      },
      bytes,
      attempts: getAttempts + putAttempts,
    };
  }

  private async maybeDlq(input: {
    code: string;
    error: string;
    attempts: number;
    original_key: string;
    record: ChatTurnRecord;
  }): Promise<CorpusWriteMetricsEvent["dlq"] | undefined> {
    if (!this.dlqEnabled) {
      return undefined;
    }
    const enq = await enqueueCorpusDlq({
      store: this.dlqStore,
      bucket: this.bucket,
      code: input.code,
      error: input.error,
      attempts: input.attempts,
      original_key: input.original_key,
      record: input.record,
      now: this.dlqNow,
    });
    if (enq.ok) {
      return { ok: true, key: enq.key };
    }
    return { ok: false, error: enq.error };
  }

  getBucket(): string {
    return this.bucket;
  }

  /** Effective retry policy (for tests / ops introspection). */
  getRetryPolicy(): CorpusRetryPolicy {
    return { ...this.retry };
  }

  isDlqEnabled(): boolean {
    return this.dlqEnabled;
  }
}
