/**
 * Log / audit redaction for Portal services (G2b.2).
 *
 * Default (shared sinks / L1): never emit vault file bodies, chat/request
 * bodies, or secret material. Payload fields are redacted unless explicitly
 * enabled via debug gate (see `isDebugPayloadsEnabled`).
 *
 * Secrets are **always** redacted, including when debug payloads are on.
 */

export const REDACTED = "[REDACTED]";

/**
 * Keys that must never appear in shared logs or audit metadata.
 *
 * Office bridge (lp-5q6.33): download_token, callback_nonce, editor_jwt, jwt,
 * and other token-shaped keys are always secrets — even when debug payloads
 * are enabled.
 */
const SECRET_KEY_PATTERN =
  /^(api[_-]?key|secret|secrets?|password|passwd|pwd|token|access[_-]?token|refresh[_-]?token|id[_-]?token|private[_-]?key|client[_-]?secret|authorization|auth|cookie|set[_-]?cookie|x[_-]?csrf[_-]?token|session[_-]?id|session[_-]?secret|gateway[_-]?secret|relay[_-]?.*secret|internal[_-]?ops[_-]?token|internal[_-]?token|service[_-]?token|bearer|headers|env|download[_-]?token|callback[_-]?nonce|callback[_-]?token|editor[_-]?jwt|office[_-]?jwt|onlyoffice[_-]?token|jwt|nonce)$/i;

/**
 * Payload / body keys redacted on shared sinks by default (G2b doctrine:
 * metadata over payloads). Still redacted when debug payloads are off.
 *
 * Note: free-form log line text uses the structured field `msg` (not
 * `message`) so chat message bodies keyed as `message` stay redacted.
 *
 * Office bridge (lp-5q6.33): vault bodies and callback/download URL secrets
 * must never ship to shared sinks as free-form fields.
 */
const PAYLOAD_KEY_PATTERN =
  /^(body|content|payload|text|message|messages|file[_-]?content|vault[_-]?content|vault[_-]?body|raw|dump|bytes|buffer|request[_-]?body|response[_-]?body|chat[_-]?body|event[_-]?payload|frame[_-]?payload|outbound[_-]?payload|inbound[_-]?payload|data[_-]?uri|base64|file[_-]?bytes|callback[_-]?url|download[_-]?url|changesurl|document[_-]?url|assembled[_-]?url)$/i;

/** Structured log envelope keys that must never be treated as payloads. */
const LOG_ENVELOPE_KEYS = new Set([
  "timestamp",
  "level",
  "service",
  "msg",
  "request_id",
  "tenant_id",
  "tenant_slug",
  "user_id",
  "instance_id",
  "route",
  "status",
  "duration_ms",
  "error_code",
  "method",
  "debug_payloads",
]);

export type RedactOptions = {
  /**
   * When true, allow non-secret payload/body fields through (still redacts
   * secrets and truncates oversized strings). Default false.
   */
  allowPayloads?: boolean;
  /** Max length for free-form string values. Default 512. */
  maxStringLength?: number;
  /** Marker used for redacted values. */
  redactedMarker?: string;
  /** Max depth for nested objects. Default 8. */
  maxDepth?: number;
  /** Max array elements kept. Default 50. */
  maxArrayLength?: number;
};

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

export function isPayloadKey(key: string): boolean {
  return PAYLOAD_KEY_PATTERN.test(key);
}

/** Minimal env map (avoids hard Node types in @lanyard/shared). */
export type EnvMap = Record<string, string | undefined>;

function readProcessEnv(): EnvMap {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (globalThis as { process?: { env?: EnvMap } }).process;
    return p?.env ?? {};
  } catch {
    return {};
  }
}

/**
 * True when operator explicitly enables payload-bearing debug logs.
 * Default: false (fail closed for shared sinks).
 *
 * Env (either):
 * - `PORTAL_DEBUG_PAYLOADS=true|1`
 * - `LOG_DEBUG_PAYLOADS=true|1`
 */
export function isDebugPayloadsEnabled(env: EnvMap = readProcessEnv()): boolean {
  const raw = env.PORTAL_DEBUG_PAYLOADS ?? env.LOG_DEBUG_PAYLOADS;
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function truncateString(
  value: string,
  max: number,
  marker: string,
): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…${marker}:truncated`;
}

/**
 * Recursively redact a value for safe emission to shared log sinks.
 * Pure / side-effect free — safe for tests and audit metadata.
 */
export function redactForLog(value: unknown, options: RedactOptions = {}): unknown {
  const marker = options.redactedMarker ?? REDACTED;
  const allowPayloads = options.allowPayloads ?? false;
  const maxStringLength = options.maxStringLength ?? 512;
  const maxDepth = options.maxDepth ?? 8;
  const maxArrayLength = options.maxArrayLength ?? 50;

  return redactValue(value, {
    marker,
    allowPayloads,
    maxStringLength,
    maxDepth,
    maxArrayLength,
    depth: 0,
    seen: new WeakSet<object>(),
  });
}

type InternalCtx = {
  marker: string;
  allowPayloads: boolean;
  maxStringLength: number;
  maxDepth: number;
  maxArrayLength: number;
  depth: number;
  seen: WeakSet<object>;
};

function redactValue(value: unknown, ctx: InternalCtx): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return truncateString(value, ctx.maxStringLength, ctx.marker);
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }

  if (typeof value === "function") {
    return ctx.marker;
  }

  if (typeof value === "symbol") {
    return value.toString();
  }

  if (value instanceof Error) {
    // Stack traces are allowed on L1 (ops), but never custom body props.
    return {
      name: value.name,
      message: truncateString(value.message, ctx.maxStringLength, ctx.marker),
      ...(value.stack
        ? {
            stack: truncateString(value.stack, 4000, ctx.marker),
          }
        : {}),
    };
  }

  // Node Buffer is a Uint8Array subclass; treat all byte arrays as opaque.
  if (value instanceof Uint8Array) {
    return {
      type: "Uint8Array",
      byteLength: value.byteLength,
      content: ctx.marker,
    };
  }

  if (Array.isArray(value)) {
    if (ctx.depth >= ctx.maxDepth) return ctx.marker;
    const slice = value.slice(0, ctx.maxArrayLength);
    const mapped = slice.map((item) =>
      redactValue(item, { ...ctx, depth: ctx.depth + 1 }),
    );
    if (value.length > ctx.maxArrayLength) {
      mapped.push(`${ctx.marker}:array_truncated`);
    }
    return mapped;
  }

  if (typeof value === "object") {
    if (ctx.seen.has(value as object)) return ctx.marker;
    if (ctx.depth >= ctx.maxDepth) return ctx.marker;
    ctx.seen.add(value as object);

    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretKey(key)) {
        out[key] = ctx.marker;
        continue;
      }
      // Envelope keys (incl. `msg`) are never treated as chat/vault payloads.
      if (
        !ctx.allowPayloads &&
        isPayloadKey(key) &&
        !LOG_ENVELOPE_KEYS.has(key)
      ) {
        out[key] = ctx.marker;
        continue;
      }
      out[key] = redactValue(child, { ...ctx, depth: ctx.depth + 1 });
    }
    return out;
  }

  return ctx.marker;
}

/**
 * Redact for durable audit_log metadata: secrets + payloads always stripped.
 * Never enable payload dump into audit storage.
 */
export function redactAuditMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  return redactForLog(metadata, {
    allowPayloads: false,
    maxStringLength: 256,
  }) as Record<string, unknown>;
}

/**
 * Assert a redacted structure still has no secret keys with non-redacted values.
 * Useful in tests / smoke checks.
 */
export function assertNoSecretLeaks(
  value: unknown,
  path = "$",
  options: { allowPayloadKeys?: boolean } = {},
): void {
  if (value === null || typeof value !== "object") return;

  if (Array.isArray(value)) {
    value.forEach((item, i) =>
      assertNoSecretLeaks(item, `${path}[${i}]`, options),
    );
    return;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKey(key) && child !== REDACTED && child !== undefined) {
      throw new Error(`Secret field leaked at ${path}.${key}`);
    }
    if (
      !options.allowPayloadKeys &&
      isPayloadKey(key) &&
      child !== REDACTED &&
      child !== undefined
    ) {
      throw new Error(`Payload field leaked at ${path}.${key}`);
    }
    assertNoSecretLeaks(child, `${path}.${key}`, options);
  }
}
