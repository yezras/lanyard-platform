/**
 * ensure_online wake rate limits / abuse controls (lp-rq1).
 *
 * Sliding-window counters for **new** wake starts only:
 * - Global process limit (all tenants)
 * - Per-tenant limit
 *
 * Singleflight joiners must **not** call {@link WakeRateLimiter.tryAcquire} —
 * concurrent callers for the same instance share one wake without consuming
 * extra quota. already_online / ec2 short-circuits also skip the limiter.
 *
 * Env (all optional; max 0 or unset = that scope disabled):
 * - ENSURE_ONLINE_GLOBAL_MAX_WAKES     — max new wakes per window (global)
 * - ENSURE_ONLINE_TENANT_MAX_WAKES     — max new wakes per window (per tenant)
 * - ENSURE_ONLINE_RATE_LIMIT_WINDOW_MS — window length (default 60_000)
 *
 * Offline track: pure in-process; inject {@link WakeRateLimiterOptions.now}
 * for fake-clock unit tests. No Redis (process-local; multi-replica CP is
 * eventually consistent / looser — still useful against single-process storms).
 */

import { parseNonNegativeIntEnv } from "./daytona-config.js";
import { parsePositiveMsEnv } from "./idle-reaper.js";

/** Env var names (stable public contract for deploy / docs). */
export const ENSURE_ONLINE_RATE_LIMIT_ENV = {
  globalMaxWakes: "ENSURE_ONLINE_GLOBAL_MAX_WAKES",
  tenantMaxWakes: "ENSURE_ONLINE_TENANT_MAX_WAKES",
  windowMs: "ENSURE_ONLINE_RATE_LIMIT_WINDOW_MS",
} as const;

/** Default sliding window when env omits window ms. */
export const DEFAULT_WAKE_RATE_LIMIT_WINDOW_MS = 60_000;

/** Which limit rejected the wake. */
export type WakeRateLimitScope = "global" | "tenant";

export type WakeRateLimitConfig = {
  /**
   * Max new wake starts per window across all tenants in this process.
   * `0` = global limit disabled.
   */
  globalMaxWakes: number;
  /**
   * Max new wake starts per window per tenant_id in this process.
   * `0` = per-tenant limit disabled.
   */
  tenantMaxWakes: number;
  /** Sliding window length in ms. */
  windowMs: number;
};

export type WakeRateLimitDecision =
  | { allowed: true }
  | {
      allowed: false;
      scope: WakeRateLimitScope;
      limit: number;
      windowMs: number;
      /** Approximate ms until the oldest event in the window ages out. */
      retryAfterMs: number;
      /** Count observed in-window at reject time (before this acquire). */
      current: number;
    };

export type WakeRateLimiterOptions = {
  config: WakeRateLimitConfig;
  /** Clock for window math (tests inject fake time). Default Date.now. */
  now?: () => number;
};

/**
 * Process-local sliding-window wake rate limiter.
 * Safe for single-process concurrent awaits (JS run-to-completion).
 */
export type WakeRateLimiter = {
  readonly config: WakeRateLimitConfig;
  /**
   * Reserve one new wake start for `tenantId`.
   * Call only when starting a leader wake (not singleflight joiners).
   */
  tryAcquire(tenantId: string, nowMs?: number): WakeRateLimitDecision;
  /** Whether any limit is active (global or tenant max > 0). */
  isEnabled(): boolean;
  /** Test/ops: clear counters. */
  reset(): void;
  /** Test helper: in-window counts. */
  snapshot(nowMs?: number): {
    global: number;
    by_tenant: Record<string, number>;
  };
};

/**
 * True when at least one of global/tenant max is positive.
 */
export function isWakeRateLimitConfigEnabled(
  config: WakeRateLimitConfig,
): boolean {
  return (
    (Number.isFinite(config.globalMaxWakes) && config.globalMaxWakes > 0) ||
    (Number.isFinite(config.tenantMaxWakes) && config.tenantMaxWakes > 0)
  );
}

/**
 * Normalize config: floor ints, clamp negatives to 0, ensure window ≥ 1 when
 * any limit is set (else keep default window).
 */
export function normalizeWakeRateLimitConfig(
  input: Partial<WakeRateLimitConfig> | null | undefined,
): WakeRateLimitConfig {
  const globalMaxWakes = Math.max(
    0,
    Math.floor(
      Number.isFinite(input?.globalMaxWakes)
        ? (input?.globalMaxWakes as number)
        : 0,
    ),
  );
  const tenantMaxWakes = Math.max(
    0,
    Math.floor(
      Number.isFinite(input?.tenantMaxWakes)
        ? (input?.tenantMaxWakes as number)
        : 0,
    ),
  );
  let windowMs = Math.floor(
    Number.isFinite(input?.windowMs) && (input?.windowMs as number) > 0
      ? (input?.windowMs as number)
      : DEFAULT_WAKE_RATE_LIMIT_WINDOW_MS,
  );
  if (windowMs < 1) {
    windowMs = DEFAULT_WAKE_RATE_LIMIT_WINDOW_MS;
  }
  return { globalMaxWakes, tenantMaxWakes, windowMs };
}

/**
 * Load wake rate-limit config from env. Pure; no I/O beyond the env map.
 * Unset / 0 max → that scope disabled (fail-open for missing config).
 */
export function resolveWakeRateLimitConfig(
  env: NodeJS.ProcessEnv = process.env,
): WakeRateLimitConfig {
  return normalizeWakeRateLimitConfig({
    globalMaxWakes:
      parseNonNegativeIntEnv(env[ENSURE_ONLINE_RATE_LIMIT_ENV.globalMaxWakes]) ??
      0,
    tenantMaxWakes:
      parseNonNegativeIntEnv(env[ENSURE_ONLINE_RATE_LIMIT_ENV.tenantMaxWakes]) ??
      0,
    windowMs:
      parsePositiveMsEnv(env[ENSURE_ONLINE_RATE_LIMIT_ENV.windowMs]) ??
      DEFAULT_WAKE_RATE_LIMIT_WINDOW_MS,
  });
}

function pruneWindow(timestamps: number[], cutoff: number): number[] {
  // timestamps are append-only ascending when clock is monotonic.
  let i = 0;
  while (i < timestamps.length && timestamps[i]! < cutoff) {
    i += 1;
  }
  return i === 0 ? timestamps : timestamps.slice(i);
}

/**
 * Create a process-local sliding-window limiter.
 * When both maxes are 0, {@link WakeRateLimiter.tryAcquire} always allows.
 */
export function createWakeRateLimiter(
  options: WakeRateLimiterOptions,
): WakeRateLimiter {
  const config = normalizeWakeRateLimitConfig(options.config);
  const nowFn = options.now ?? (() => Date.now());

  let globalHits: number[] = [];
  const tenantHits = new Map<string, number[]>();

  function resolveNow(nowMs?: number): number {
    if (nowMs !== undefined && Number.isFinite(nowMs)) {
      return nowMs;
    }
    return nowFn();
  }

  function pruneAll(now: number): void {
    const cutoff = now - config.windowMs;
    globalHits = pruneWindow(globalHits, cutoff);
    for (const [tenantId, hits] of tenantHits) {
      const next = pruneWindow(hits, cutoff);
      if (next.length === 0) {
        tenantHits.delete(tenantId);
      } else {
        tenantHits.set(tenantId, next);
      }
    }
  }

  return {
    config,
    isEnabled(): boolean {
      return isWakeRateLimitConfigEnabled(config);
    },
    tryAcquire(tenantId: string, nowMs?: number): WakeRateLimitDecision {
      if (!isWakeRateLimitConfigEnabled(config)) {
        return { allowed: true };
      }

      const now = resolveNow(nowMs);
      pruneAll(now);

      const tid = tenantId?.trim() || "unknown";

      // Check global first (coarser platform cost control).
      if (config.globalMaxWakes > 0 && globalHits.length >= config.globalMaxWakes) {
        const oldest = globalHits[0] ?? now;
        const retryAfterMs = Math.max(1, oldest + config.windowMs - now);
        return {
          allowed: false,
          scope: "global",
          limit: config.globalMaxWakes,
          windowMs: config.windowMs,
          retryAfterMs,
          current: globalHits.length,
        };
      }

      if (config.tenantMaxWakes > 0) {
        const hits = tenantHits.get(tid) ?? [];
        if (hits.length >= config.tenantMaxWakes) {
          const oldest = hits[0] ?? now;
          const retryAfterMs = Math.max(1, oldest + config.windowMs - now);
          return {
            allowed: false,
            scope: "tenant",
            limit: config.tenantMaxWakes,
            windowMs: config.windowMs,
            retryAfterMs,
            current: hits.length,
          };
        }
      }

      // Admit: record hit under both scopes that are enabled.
      globalHits.push(now);
      if (config.tenantMaxWakes > 0 || config.globalMaxWakes > 0) {
        const hits = tenantHits.get(tid) ?? [];
        hits.push(now);
        tenantHits.set(tid, hits);
      }

      return { allowed: true };
    },
    reset(): void {
      globalHits = [];
      tenantHits.clear();
    },
    snapshot(nowMs?: number) {
      const now = resolveNow(nowMs);
      pruneAll(now);
      const by_tenant: Record<string, number> = {};
      for (const [tid, hits] of tenantHits) {
        by_tenant[tid] = hits.length;
      }
      return { global: globalHits.length, by_tenant };
    },
  };
}

/**
 * Thrown when ensure_online rejects a **new** wake start due to rate limit
 * (lp-rq1). Map to HTTP 429 with code `ENSURE_ONLINE_RATE_LIMITED`.
 */
export class EnsureOnlineRateLimitedError extends Error {
  readonly code = "ENSURE_ONLINE_RATE_LIMITED" as const;
  readonly httpStatus = 429 as const;
  readonly instanceId: string;
  readonly tenantId: string;
  readonly scope: WakeRateLimitScope;
  readonly limit: number;
  readonly windowMs: number;
  readonly retryAfterMs: number;
  readonly current: number;

  constructor(input: {
    instanceId: string;
    tenantId: string;
    scope: WakeRateLimitScope;
    limit: number;
    windowMs: number;
    retryAfterMs: number;
    current: number;
  }) {
    super(
      `ensure_online rate limited (${input.scope}) for instance ${input.instanceId}: ` +
        `${input.current}/${input.limit} wakes in ${input.windowMs}ms window`,
    );
    this.name = "EnsureOnlineRateLimitedError";
    this.instanceId = input.instanceId;
    this.tenantId = input.tenantId;
    this.scope = input.scope;
    this.limit = input.limit;
    this.windowMs = input.windowMs;
    this.retryAfterMs = input.retryAfterMs;
    this.current = input.current;
  }

  /** Structured JSON body for CP HTTP 429. */
  toBody(): {
    error: "rate_limited";
    code: "ENSURE_ONLINE_RATE_LIMITED";
    instance_id: string;
    tenant_id: string;
    scope: WakeRateLimitScope;
    limit: number;
    window_ms: number;
    retry_after_ms: number;
    current: number;
    message: string;
  } {
    return {
      error: "rate_limited",
      code: this.code,
      instance_id: this.instanceId,
      tenant_id: this.tenantId,
      scope: this.scope,
      limit: this.limit,
      window_ms: this.windowMs,
      retry_after_ms: this.retryAfterMs,
      current: this.current,
      message: this.message,
    };
  }
}
