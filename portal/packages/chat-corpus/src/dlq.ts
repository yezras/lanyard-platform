/**
 * Corpus write DLQ (lp-gkh.7) — poison / exhausted messages.
 *
 * **v1 path:** S3 `failed/` prefix under the same tenant corpus layout
 * (no SQS dependency). IAM writer PutObject already covers
 * `tenants/{tid}/chat-corpus/v1/…`.
 *
 * **Deferred:** SQS (or EventBridge) DLQ + redrive — tracked as follow-on;
 * not required for acceptance when `failed/` path is live. See
 * docs/plans/0011-tenant-chat-corpus/metrics-retry-dlq.md.
 */

import {
  assertValidCorpusPathSegment,
  chatCorpusHiveFromCreatedAt,
  CHAT_CORPUS_LAYOUT_VERSION,
  CHAT_CORPUS_PREFIX_ROOT,
  ChatCorpusKeyError,
} from "./key.js";
import type { CorpusObjectStore } from "./object-store.js";
import type { ChatTurnRecord } from "./schema.js";

/** Content-Type for DLQ envelope objects. */
export const CHAT_CORPUS_DLQ_CONTENT_TYPE =
  "application/json; charset=utf-8";

/** Envelope schema marker (not a ChatTurnRecord). */
export const CHAT_CORPUS_DLQ_RECORD_TYPE = "chat_turn_dlq" as const;

export type CorpusDlqEnvelope = {
  dlq_schema_version: 1;
  record_type: typeof CHAT_CORPUS_DLQ_RECORD_TYPE;
  failed_at: string;
  code: string;
  error: string;
  attempts: number;
  /** Intended corpus object key when known. */
  original_key?: string;
  tenant_id?: string;
  turn_id?: string;
  thread_id?: string;
  /** Validated turn when available (for redrive). */
  record?: ChatTurnRecord;
  /** Truncated raw input when the record failed validation. */
  raw_preview?: string;
};

export type BuildCorpusDlqKeyInput = {
  tenant_id: string;
  turn_id: string;
  /**
   * RFC3339 used for hive partitions (failed_at or original created_at).
   */
  failed_at: string;
};

/**
 * DLQ object key under the allowed writer prefix:
 *   tenants/{tid}/chat-corpus/v1/failed/year=/month=/day=/turn={turn_id}.json
 *
 * Deliberately **omits** `thread=` so {@link isChatCorpusTurnObjectKey}
 * excludes DLQ objects from training export list/read.
 */
export function buildChatCorpusDlqObjectKey(
  parts: BuildCorpusDlqKeyInput,
): string {
  const tenantId = assertValidCorpusPathSegment(parts.tenant_id, "tenant_id");
  const turnId = assertValidCorpusPathSegment(parts.turn_id, "turn_id");
  const { year, month, day } = chatCorpusHiveFromCreatedAt(parts.failed_at);

  return [
    CHAT_CORPUS_PREFIX_ROOT,
    tenantId,
    "chat-corpus",
    CHAT_CORPUS_LAYOUT_VERSION,
    "failed",
    `year=${year}`,
    `month=${month}`,
    `day=${day}`,
    `turn=${turnId}.json`,
  ].join("/");
}

/** True when key is a corpus DLQ object under the failed/ prefix. */
export function isChatCorpusDlqObjectKey(key: string): boolean {
  return /\/chat-corpus\/v1\/failed\/year=\d{4}\/month=\d{2}\/day=\d{2}\/turn=[^/]+\.json$/.test(
    key,
  );
}

export type CorpusDlqEnqueueInput = {
  store: CorpusObjectStore;
  bucket: string;
  code: string;
  error: string;
  attempts: number;
  original_key?: string;
  record?: ChatTurnRecord;
  /** Fallback identity when record is missing. */
  tenant_id?: string;
  turn_id?: string;
  thread_id?: string;
  /** Raw input for poison invalid records (truncated). */
  raw?: unknown;
  now?: () => Date;
};

export type CorpusDlqEnqueueResult =
  | { ok: true; key: string; bucket: string }
  | { ok: false; code: string; error: string; key?: string };

const RAW_PREVIEW_MAX = 2048;

function truncatePreview(raw: unknown): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  let text: string;
  try {
    text = typeof raw === "string" ? raw : JSON.stringify(raw);
  } catch {
    text = String(raw);
  }
  if (text.length <= RAW_PREVIEW_MAX) {
    return text;
  }
  return `${text.slice(0, RAW_PREVIEW_MAX)}…`;
}

/**
 * Put a DLQ envelope under the failed/ prefix. Never throws.
 * Failures return `{ ok: false }` for metric emission.
 */
export async function enqueueCorpusDlq(
  input: CorpusDlqEnqueueInput,
): Promise<CorpusDlqEnqueueResult> {
  try {
    const now = input.now ?? (() => new Date());
    const failedAt = now().toISOString();
    const tenantId =
      input.record?.tenant_id?.trim() ||
      input.tenant_id?.trim() ||
      "unknown";
    const turnId =
      input.record?.turn_id?.trim() ||
      input.turn_id?.trim() ||
      `unknown-${failedAt.replace(/[^0-9A-Za-z]/g, "").slice(0, 20)}`;

    let key: string;
    try {
      key = buildChatCorpusDlqObjectKey({
        tenant_id: tenantId,
        turn_id: turnId,
        failed_at: failedAt,
      });
    } catch (e) {
      if (e instanceof ChatCorpusKeyError) {
        return { ok: false, code: e.code, error: e.message };
      }
      return {
        ok: false,
        code: "DLQ_KEY_ERROR",
        error: e instanceof Error ? e.message : String(e),
      };
    }

    const envelope: CorpusDlqEnvelope = {
      dlq_schema_version: 1,
      record_type: CHAT_CORPUS_DLQ_RECORD_TYPE,
      failed_at: failedAt,
      code: input.code,
      error: input.error,
      attempts: input.attempts,
    };
    if (input.original_key) envelope.original_key = input.original_key;
    if (input.record) {
      envelope.record = input.record;
      envelope.tenant_id = input.record.tenant_id;
      envelope.turn_id = input.record.turn_id;
      envelope.thread_id = input.record.thread_id;
    } else {
      if (input.tenant_id) envelope.tenant_id = input.tenant_id;
      if (input.turn_id) envelope.turn_id = input.turn_id;
      if (input.thread_id) envelope.thread_id = input.thread_id;
      const preview = truncatePreview(input.raw);
      if (preview !== undefined) envelope.raw_preview = preview;
    }

    const body = `${JSON.stringify(envelope)}\n`;
    await input.store.putObject({
      bucket: input.bucket,
      key,
      body,
      contentType: CHAT_CORPUS_DLQ_CONTENT_TYPE,
    });
    return { ok: true, key, bucket: input.bucket };
  } catch (e) {
    return {
      ok: false,
      code: "S3_DLQ_FAILED",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
