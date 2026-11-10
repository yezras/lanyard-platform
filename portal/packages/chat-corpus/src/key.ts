/**
 * S3 object key builder for ChatTurnRecord v1 (lp-gkh.4).
 *
 * Normative layout (plan 0011 / contracts/chat-corpus-v1):
 *   tenants/{tenant_id}/chat-corpus/v1/year={YYYY}/month={MM}/day={DD}/thread={thread_id}/turn={turn_id}.json
 *
 * Partition is tenant + time; `turn_id` makes the key idempotent for PutObject.
 */

/** Layout generation segment under the corpus prefix. */
export const CHAT_CORPUS_LAYOUT_VERSION = "v1" as const;

/** Relative prefix template under the bucket (no leading slash). */
export const CHAT_CORPUS_PREFIX_ROOT = "tenants" as const;

export class ChatCorpusKeyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ChatCorpusKeyError";
    this.code = code;
  }
}

/**
 * Validate an opaque path segment used in corpus keys (tenant, thread, turn).
 * Rejects empty, path separators, traversal, and control characters.
 */
export function assertValidCorpusPathSegment(
  value: string,
  field: string,
): string {
  const id = value?.trim() ?? "";
  if (!id) {
    throw new ChatCorpusKeyError(
      "INVALID_PATH_SEGMENT",
      `${field} is required for corpus object key`,
    );
  }
  if (id.includes("/") || id.includes("\\")) {
    throw new ChatCorpusKeyError(
      "INVALID_PATH_SEGMENT",
      `${field} must be a single path segment (no slashes)`,
    );
  }
  if (id === "." || id === ".." || id.includes("..")) {
    throw new ChatCorpusKeyError(
      "INVALID_PATH_SEGMENT",
      `${field} path traversal not allowed`,
    );
  }
  // Opaque ids (UUID / slug-like); same spirit as vault tenant segment rules.
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) {
    throw new ChatCorpusKeyError(
      "INVALID_PATH_SEGMENT",
      `${field} must match opaque single-segment id (alnum start, max 128)`,
    );
  }
  return id;
}

export type ChatCorpusKeyParts = {
  tenant_id: string;
  thread_id: string;
  turn_id: string;
  /** RFC3339 / ISO-8601; year/month/day partitions are UTC. */
  created_at: string;
};

export type ChatCorpusHiveParts = {
  year: string;
  month: string;
  day: string;
};

/**
 * Derive UTC year/month/day hive partitions from a turn `created_at` timestamp.
 */
export function chatCorpusHiveFromCreatedAt(createdAt: string): ChatCorpusHiveParts {
  const ms = Date.parse(createdAt);
  if (Number.isNaN(ms)) {
    throw new ChatCorpusKeyError(
      "INVALID_CREATED_AT",
      "created_at must be an RFC3339 / ISO-8601 date-time for corpus hive partitions",
    );
  }
  const d = new Date(ms);
  const year = String(d.getUTCFullYear()).padStart(4, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return { year, month, day };
}

/**
 * Build the relative S3 object key for one ChatTurnRecord.
 * Does not include bucket or `s3://` scheme.
 */
export function buildChatCorpusObjectKey(parts: ChatCorpusKeyParts): string {
  const tenantId = assertValidCorpusPathSegment(parts.tenant_id, "tenant_id");
  const threadId = assertValidCorpusPathSegment(parts.thread_id, "thread_id");
  const turnId = assertValidCorpusPathSegment(parts.turn_id, "turn_id");
  const { year, month, day } = chatCorpusHiveFromCreatedAt(parts.created_at);

  return [
    CHAT_CORPUS_PREFIX_ROOT,
    tenantId,
    "chat-corpus",
    CHAT_CORPUS_LAYOUT_VERSION,
    `year=${year}`,
    `month=${month}`,
    `day=${day}`,
    `thread=${threadId}`,
    `turn=${turnId}.json`,
  ].join("/");
}

/**
 * Build key from a validated (or draft) turn record shape.
 */
export function buildChatCorpusObjectKeyFromRecord(record: {
  tenant_id: string;
  thread_id: string;
  turn_id: string;
  created_at: string;
}): string {
  return buildChatCorpusObjectKey({
    tenant_id: record.tenant_id,
    thread_id: record.thread_id,
    turn_id: record.turn_id,
    created_at: record.created_at,
  });
}

/**
 * Prefix for listing all turns for a tenant under layout v1 (trailing slash).
 * Used by training export (`lp-gkh.8`) and IAM drafts.
 */
export function buildChatCorpusTenantPrefix(tenantId: string): string {
  const id = assertValidCorpusPathSegment(tenantId, "tenant_id");
  return `${CHAT_CORPUS_PREFIX_ROOT}/${id}/chat-corpus/${CHAT_CORPUS_LAYOUT_VERSION}/`;
}

/**
 * Day hive prefix for listing turns on one UTC calendar day (trailing slash).
 *   tenants/{tid}/chat-corpus/v1/year=YYYY/month=MM/day=DD/
 */
export function buildChatCorpusDayPrefix(
  tenantId: string,
  hive: ChatCorpusHiveParts,
): string {
  const id = assertValidCorpusPathSegment(tenantId, "tenant_id");
  const year = hive.year?.trim() ?? "";
  const month = hive.month?.trim() ?? "";
  const day = hive.day?.trim() ?? "";
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) {
    throw new ChatCorpusKeyError(
      "INVALID_HIVE",
      "hive year/month/day must be YYYY, MM, DD (zero-padded)",
    );
  }
  const monthNum = Number(month);
  const dayNum = Number(day);
  if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) {
    throw new ChatCorpusKeyError(
      "INVALID_HIVE",
      "hive month must be 01-12 and day 01-31",
    );
  }
  return [
    CHAT_CORPUS_PREFIX_ROOT,
    id,
    "chat-corpus",
    CHAT_CORPUS_LAYOUT_VERSION,
    `year=${year}`,
    `month=${month}`,
    `day=${day}`,
    "",
  ].join("/");
}

/**
 * Parse UTC year/month/day from a corpus object key when the hive segments
 * are present. Returns null for non-turn / malformed keys.
 */
export function parseChatCorpusHiveFromKey(
  key: string,
): ChatCorpusHiveParts | null {
  const m = key.match(
    /\/chat-corpus\/v1\/year=(\d{4})\/month=(\d{2})\/day=(\d{2})\//,
  );
  if (!m) {
    return null;
  }
  return { year: m[1]!, month: m[2]!, day: m[3]! };
}

/**
 * True when key is a per-turn object under layout v1
 * (`…/turn={id}.json`).
 */
export function isChatCorpusTurnObjectKey(key: string): boolean {
  return /\/chat-corpus\/v1\/year=\d{4}\/month=\d{2}\/day=\d{2}\/thread=[^/]+\/turn=[^/]+\.json$/.test(
    key,
  );
}

/**
 * Normalize a date-only or date-time string to a UTC calendar day
 * `YYYY-MM-DD`. Accepts `YYYY-MM-DD` or RFC3339 / ISO-8601.
 */
export function utcDateString(input: string): string {
  const raw = input?.trim() ?? "";
  if (!raw) {
    throw new ChatCorpusKeyError("INVALID_DATE", "date is required");
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    // Interpret bare dates as UTC calendar days (not local midnight).
    const ms = Date.parse(`${raw}T00:00:00.000Z`);
    if (Number.isNaN(ms)) {
      throw new ChatCorpusKeyError(
        "INVALID_DATE",
        `invalid calendar date: ${raw}`,
      );
    }
    return raw;
  }
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) {
    throw new ChatCorpusKeyError(
      "INVALID_DATE",
      `date must be YYYY-MM-DD or RFC3339 / ISO-8601: ${raw}`,
    );
  }
  const d = new Date(ms);
  const year = String(d.getUTCFullYear()).padStart(4, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Inclusive UTC day range as hive parts (from ≤ to). Caps at maxDays to
 * avoid accidental unbounded ListObject fan-out.
 */
export function enumerateChatCorpusDayHives(
  from: string,
  to: string,
  options: { maxDays?: number } = {},
): ChatCorpusHiveParts[] {
  const fromDay = utcDateString(from);
  const toDay = utcDateString(to);
  if (fromDay > toDay) {
    throw new ChatCorpusKeyError(
      "INVALID_DATE_RANGE",
      `from (${fromDay}) must be ≤ to (${toDay})`,
    );
  }
  const maxDays = options.maxDays ?? 366;
  const out: ChatCorpusHiveParts[] = [];
  let cursor = Date.parse(`${fromDay}T00:00:00.000Z`);
  const end = Date.parse(`${toDay}T00:00:00.000Z`);
  while (cursor <= end) {
    if (out.length >= maxDays) {
      throw new ChatCorpusKeyError(
        "DATE_RANGE_TOO_LARGE",
        `date range exceeds maxDays=${maxDays}; narrow the window`,
      );
    }
    const d = new Date(cursor);
    out.push({
      year: String(d.getUTCFullYear()).padStart(4, "0"),
      month: String(d.getUTCMonth() + 1).padStart(2, "0"),
      day: String(d.getUTCDate()).padStart(2, "0"),
    });
    cursor += 24 * 60 * 60 * 1000;
  }
  return out;
}

/**
 * Day prefixes (trailing slash) covering an inclusive UTC date range.
 * Training export lists under these prefixes instead of full tenant fan-out.
 */
export function buildChatCorpusDayPrefixesForRange(
  tenantId: string,
  from: string,
  to: string,
  options: { maxDays?: number } = {},
): string[] {
  return enumerateChatCorpusDayHives(from, to, options).map((hive) =>
    buildChatCorpusDayPrefix(tenantId, hive),
  );
}
