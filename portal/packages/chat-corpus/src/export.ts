/**
 * Training export — list/read ChatTurnRecord objects by tenant + time range
 * (lp-gkh.8).
 *
 * Ops / training-pipeline roles only. No tenant browser API in v1.
 * Works against any {@link CorpusObjectStore} that implements `listObjects`
 * + `getObject` (use {@link FakeCorpusObjectStore} for dry-run tests).
 */

import {
  buildChatCorpusDayPrefixesForRange,
  buildChatCorpusTenantPrefix,
  ChatCorpusKeyError,
  isChatCorpusTurnObjectKey,
  utcDateString,
} from "./key.js";
import type { CorpusObjectStore } from "./object-store.js";
import { safeParseChatTurnRecord } from "./parse.js";
import type { ChatTurnRecord } from "./schema.js";

/** One listed turn key under the corpus prefix. */
export type CorpusExportKey = {
  /** Relative S3 object key. */
  key: string;
  /** Byte size when the store reported it. */
  size?: number;
};

export type CorpusExportListOk = {
  ok: true;
  tenant_id: string;
  /** Inclusive UTC from day `YYYY-MM-DD`. */
  from: string;
  /** Inclusive UTC to day `YYYY-MM-DD`. */
  to: string;
  bucket: string;
  /** Day prefixes that were listed (trailing slash). */
  prefixes: string[];
  /** Sorted unique turn object keys in range. */
  keys: CorpusExportKey[];
};

export type CorpusExportListErr = {
  ok: false;
  code: string;
  error: string;
  tenant_id?: string;
  bucket?: string;
};

export type CorpusExportListResult = CorpusExportListOk | CorpusExportListErr;

export type ListCorpusTurnsOptions = {
  store: CorpusObjectStore;
  /** Bare bucket name (no s3://). */
  bucket: string;
  tenant_id: string;
  /**
   * Inclusive range start — `YYYY-MM-DD` or RFC3339 (UTC calendar day).
   */
  from: string;
  /**
   * Inclusive range end — `YYYY-MM-DD` or RFC3339 (UTC calendar day).
   */
  to: string;
  /** Cap on enumerated UTC days (default 366). */
  maxDays?: number;
  /** Page size hint per ListObjects call. */
  maxKeysPerPage?: number;
};

export type ReadCorpusTurnOk = {
  ok: true;
  key: string;
  bucket: string;
  record: ChatTurnRecord;
  /** Raw body as stored (includes trailing newline when written by S3CorpusWriter). */
  body: string;
};

export type ReadCorpusTurnErr = {
  ok: false;
  code: string;
  error: string;
  key?: string;
  bucket?: string;
};

export type ReadCorpusTurnResult = ReadCorpusTurnOk | ReadCorpusTurnErr;

function listErr(
  code: string,
  error: string,
  extra: Partial<CorpusExportListErr> = {},
): CorpusExportListErr {
  return { ok: false, code, error, ...extra };
}

function readErr(
  code: string,
  error: string,
  extra: Partial<ReadCorpusTurnErr> = {},
): ReadCorpusTurnErr {
  return { ok: false, code, error, ...extra };
}

function assertBareBucket(bucket: string): string {
  const b = bucket?.trim() ?? "";
  if (!b) {
    throw new ChatCorpusKeyError("INVALID_BUCKET", "bucket is required");
  }
  if (b.startsWith("s3://") || b.includes("/")) {
    throw new ChatCorpusKeyError(
      "INVALID_BUCKET",
      "bucket must be a bare bucket name (no s3:// or key prefix)",
    );
  }
  return b;
}

/**
 * List all object keys under a single prefix (paginated).
 * Requires `store.listObjects`.
 */
export async function listAllCorpusKeysUnderPrefix(input: {
  store: CorpusObjectStore;
  bucket: string;
  prefix: string;
  maxKeysPerPage?: number;
}): Promise<CorpusExportKey[]> {
  const list = input.store.listObjects;
  if (typeof list !== "function") {
    throw new ChatCorpusKeyError(
      "LIST_NOT_SUPPORTED",
      "CorpusObjectStore.listObjects is required for training export",
    );
  }
  const out: CorpusExportKey[] = [];
  let token: string | undefined;
  do {
    const page = await list.call(input.store, {
      bucket: input.bucket,
      prefix: input.prefix,
      continuationToken: token,
      maxKeys: input.maxKeysPerPage,
    });
    for (const obj of page.objects) {
      out.push({ key: obj.key, size: obj.size });
    }
    token = page.continuationToken;
  } while (token);
  return out;
}

/**
 * List turn object keys for one tenant within an inclusive UTC date range.
 *
 * Lists day hive prefixes under
 * `tenants/{tid}/chat-corpus/v1/year=/month=/day=/` and keeps only
 * `…/turn={id}.json` keys. Never throws — returns Result.
 */
export async function listCorpusTurns(
  options: ListCorpusTurnsOptions,
): Promise<CorpusExportListResult> {
  try {
    return await listCorpusTurnsInner(options);
  } catch (e) {
    if (e instanceof ChatCorpusKeyError) {
      return listErr(e.code, e.message, {
        tenant_id: options.tenant_id,
        bucket: options.bucket,
      });
    }
    return listErr(
      "UNEXPECTED",
      e instanceof Error ? e.message : String(e),
      { tenant_id: options.tenant_id, bucket: options.bucket },
    );
  }
}

async function listCorpusTurnsInner(
  options: ListCorpusTurnsOptions,
): Promise<CorpusExportListResult> {
  const bucket = assertBareBucket(options.bucket);
  const from = utcDateString(options.from);
  const to = utcDateString(options.to);
  // Validate tenant via prefix builder (path segment rules).
  buildChatCorpusTenantPrefix(options.tenant_id);

  const prefixes = buildChatCorpusDayPrefixesForRange(
    options.tenant_id,
    from,
    to,
    { maxDays: options.maxDays },
  );

  const seen = new Set<string>();
  const keys: CorpusExportKey[] = [];

  for (const prefix of prefixes) {
    let pageKeys: CorpusExportKey[];
    try {
      pageKeys = await listAllCorpusKeysUnderPrefix({
        store: options.store,
        bucket,
        prefix,
        maxKeysPerPage: options.maxKeysPerPage,
      });
    } catch (e) {
      if (e instanceof ChatCorpusKeyError) {
        return listErr(e.code, e.message, {
          tenant_id: options.tenant_id,
          bucket,
        });
      }
      return listErr(
        "S3_LIST_FAILED",
        e instanceof Error ? e.message : String(e),
        { tenant_id: options.tenant_id, bucket },
      );
    }
    for (const item of pageKeys) {
      if (!isChatCorpusTurnObjectKey(item.key)) {
        continue;
      }
      if (seen.has(item.key)) {
        continue;
      }
      seen.add(item.key);
      keys.push(item);
    }
  }

  keys.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  return {
    ok: true,
    tenant_id: options.tenant_id,
    from,
    to,
    bucket,
    prefixes,
    keys,
  };
}

/**
 * Download and parse one ChatTurnRecord by key. Never throws — Result.
 */
export async function readCorpusTurn(input: {
  store: CorpusObjectStore;
  bucket: string;
  key: string;
}): Promise<ReadCorpusTurnResult> {
  try {
    const bucket = assertBareBucket(input.bucket);
    const key = input.key?.trim() ?? "";
    if (!key) {
      return readErr("INVALID_KEY", "key is required", { bucket });
    }
    let body: string | null;
    try {
      body = await input.store.getObject({ bucket, key });
    } catch (e) {
      return readErr(
        "S3_GET_FAILED",
        e instanceof Error ? e.message : String(e),
        { bucket, key },
      );
    }
    if (body === null) {
      return readErr("NOT_FOUND", `object not found: ${key}`, { bucket, key });
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(body);
    } catch (e) {
      return readErr(
        "INVALID_JSON",
        e instanceof Error ? e.message : String(e),
        { bucket, key },
      );
    }
    const parsed = safeParseChatTurnRecord(parsedJson);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .slice(0, 5)
        .join("; ");
      return readErr("INVALID_RECORD", message || "invalid ChatTurnRecord", {
        bucket,
        key,
      });
    }
    return {
      ok: true,
      key,
      bucket,
      record: parsed.data,
      body,
    };
  } catch (e) {
    if (e instanceof ChatCorpusKeyError) {
      return readErr(e.code, e.message, {
        bucket: input.bucket,
        key: input.key,
      });
    }
    return readErr(
      "UNEXPECTED",
      e instanceof Error ? e.message : String(e),
      { bucket: input.bucket, key: input.key },
    );
  }
}

/**
 * Stream turns for a tenant + date range as async iterable of read results
 * (list then get each key). Suitable for JSONL training export.
 */
export async function* iterateCorpusTurns(
  options: ListCorpusTurnsOptions,
): AsyncGenerator<ReadCorpusTurnResult, void, undefined> {
  const listed = await listCorpusTurns(options);
  if (!listed.ok) {
    yield {
      ok: false,
      code: listed.code,
      error: listed.error,
      bucket: listed.bucket,
    };
    return;
  }
  for (const item of listed.keys) {
    yield await readCorpusTurn({
      store: options.store,
      bucket: listed.bucket,
      key: item.key,
    });
  }
}

/**
 * High-level exporter bound to a bucket + store (ops job wiring).
 */
export class CorpusTrainingExporter {
  private readonly bucket: string;
  private readonly store: CorpusObjectStore;

  constructor(options: { bucket: string; store: CorpusObjectStore }) {
    this.bucket = assertBareBucket(options.bucket);
    this.store = options.store;
  }

  getBucket(): string {
    return this.bucket;
  }

  listTurns(
    input: Omit<ListCorpusTurnsOptions, "store" | "bucket">,
  ): Promise<CorpusExportListResult> {
    return listCorpusTurns({
      ...input,
      store: this.store,
      bucket: this.bucket,
    });
  }

  readTurn(key: string): Promise<ReadCorpusTurnResult> {
    return readCorpusTurn({
      store: this.store,
      bucket: this.bucket,
      key,
    });
  }

  iterateTurns(
    input: Omit<ListCorpusTurnsOptions, "store" | "bucket">,
  ): AsyncGenerator<ReadCorpusTurnResult, void, undefined> {
    return iterateCorpusTurns({
      ...input,
      store: this.store,
      bucket: this.bucket,
    });
  }
}
