/**
 * Retry policy for corpus S3 writes (lp-gkh.7).
 *
 * Transient store errors are retried with exponential backoff.
 * Permanent errors (validation, auth, missing bucket) fail immediately.
 *
 * Policy SoT: docs/plans/0011-tenant-chat-corpus/metrics-retry-dlq.md
 */

/** Default: 3 attempts, 50ms base, 1000ms cap (same spirit as BFF Redis G5). */
export const DEFAULT_CORPUS_RETRY_MAX_ATTEMPTS = 3;
export const DEFAULT_CORPUS_RETRY_BASE_DELAY_MS = 50;
export const DEFAULT_CORPUS_RETRY_MAX_DELAY_MS = 1000;

export type CorpusRetryPolicy = {
  /** Total attempts including the first (default 3). Min 1. */
  maxAttempts: number;
  /** Base delay before attempt 2 (default 50ms). */
  baseDelayMs: number;
  /** Cap on exponential delay (default 1000ms). */
  maxDelayMs: number;
  /**
   * Injectable sleep for unit tests. Defaults to real setTimeout.
   * Must resolve (never throw).
   */
  sleep: (ms: number) => Promise<void>;
};

export type CorpusRetryPolicyInput = Partial<CorpusRetryPolicy>;

export function defaultCorpusSleep(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function normalizeCorpusRetryPolicy(
  input: CorpusRetryPolicyInput | undefined,
): CorpusRetryPolicy {
  const maxAttemptsRaw = input?.maxAttempts ?? DEFAULT_CORPUS_RETRY_MAX_ATTEMPTS;
  const maxAttempts =
    Number.isFinite(maxAttemptsRaw) && maxAttemptsRaw >= 1
      ? Math.min(Math.floor(maxAttemptsRaw), 10)
      : DEFAULT_CORPUS_RETRY_MAX_ATTEMPTS;
  const baseDelayMsRaw =
    input?.baseDelayMs ?? DEFAULT_CORPUS_RETRY_BASE_DELAY_MS;
  const baseDelayMs =
    Number.isFinite(baseDelayMsRaw) && baseDelayMsRaw >= 0
      ? Math.floor(baseDelayMsRaw)
      : DEFAULT_CORPUS_RETRY_BASE_DELAY_MS;
  const maxDelayMsRaw =
    input?.maxDelayMs ?? DEFAULT_CORPUS_RETRY_MAX_DELAY_MS;
  const maxDelayMs =
    Number.isFinite(maxDelayMsRaw) && maxDelayMsRaw >= 0
      ? Math.floor(maxDelayMsRaw)
      : DEFAULT_CORPUS_RETRY_MAX_DELAY_MS;
  return {
    maxAttempts,
    baseDelayMs,
    maxDelayMs: Math.max(maxDelayMs, baseDelayMs),
    sleep: input?.sleep ?? defaultCorpusSleep,
  };
}

/**
 * Delay before the next attempt after `attempt` (0-based failed attempt index).
 * attempt 0 → base, attempt 1 → 2*base, … capped at maxDelayMs.
 */
export function corpusRetryDelayMs(
  attempt: number,
  policy: Pick<CorpusRetryPolicy, "baseDelayMs" | "maxDelayMs">,
): number {
  if (attempt < 0) {
    return 0;
  }
  const exp = policy.baseDelayMs * 2 ** attempt;
  return Math.min(exp, policy.maxDelayMs);
}

/**
 * Permanent S3 / client errors that must not be retried.
 * Auth and bucket misconfig need operator fix, not more puts.
 */
const PERMANENT_ERROR_RE =
  /AccessDenied|InvalidAccessKey|SignatureDoesNotMatch|NoSuchBucket|AllAccessDisabled|InvalidBucketName|EntityTooLarge|InvalidArgument|InvalidObjectState|NoSuchKey|403\b|Forbidden|Unauthorized|ExpiredToken|AccountProblem|PermanentRedirect/i;

/**
 * Known transient / retriable transport and service errors.
 */
const TRANSIENT_ERROR_RE =
  /throttl|SlowDown|timeout|timed\s*out|ECONNRESET|EPIPE|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ServiceUnavailable|InternalError|RequestTimeout|503\b|500\b|429\b|network|temporarily|TooManyRequests|PriorRequestNotComplete|socket hang up|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|TooManyRequests|Please reduce your request rate|Slow Down/i;

/** CorpusWriteResult codes that are never retriable (client / schema). */
const PERMANENT_RESULT_CODES = new Set([
  "INVALID_RECORD",
  "KEY_ERROR",
  "INVALID_PATH_SEGMENT",
  "INVALID_CREATED_AT",
  "UNEXPECTED",
]);

/**
 * Whether a thrown store error should be retried.
 * Unknown errors default to **transient** (prefer retry over silent drop).
 */
export function isTransientCorpusStoreError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  if (!msg) {
    return true;
  }
  if (PERMANENT_ERROR_RE.test(msg)) {
    return false;
  }
  if (TRANSIENT_ERROR_RE.test(msg)) {
    return true;
  }
  // Default: retry unknown store failures (fail-closed for silent drop).
  return true;
}

/**
 * Whether a CorpusWriteResult error code is retriable.
 * S3_GET_FAILED / S3_PUT_FAILED are retriable when the message is transient.
 */
export function isRetriableCorpusWriteCode(
  code: string,
  errorMessage?: string,
): boolean {
  if (PERMANENT_RESULT_CODES.has(code)) {
    return false;
  }
  if (code === "S3_GET_FAILED" || code === "S3_PUT_FAILED" || code === "S3_DLQ_FAILED") {
    if (errorMessage !== undefined) {
      return isTransientCorpusStoreError(new Error(errorMessage));
    }
    return true;
  }
  return false;
}

export type RetryLoopResult<T> = {
  value: T;
  /** 1-based number of attempts used. */
  attempts: number;
};

/**
 * Run `op` with exponential backoff while `shouldRetry(error, attempt)` is true.
 * `attempt` in shouldRetry is 1-based count of failures so far.
 */
export async function withCorpusRetry<T>(
  op: (attempt: number) => Promise<T>,
  options: {
    policy: CorpusRetryPolicy;
    shouldRetry: (error: unknown, attempt: number) => boolean;
  },
): Promise<RetryLoopResult<T>> {
  const { policy, shouldRetry } = options;
  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      const value = await op(attempt);
      return { value, attempts: attempt };
    } catch (error) {
      lastError = error;
      const canRetry =
        attempt < policy.maxAttempts && shouldRetry(error, attempt);
      if (!canRetry) {
        break;
      }
      const delay = corpusRetryDelayMs(attempt - 1, policy);
      await policy.sleep(delay);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError));
}
