/**
 * Single-use jti store for G2a upgrade-token replay resistance.
 *
 * - memory: process-local Map (single-task / lab)
 * - redis: shared store for multi-relay (G6); optional via injected client
 *
 * Atomicity: consume() is SET NX — only the first caller succeeds.
 */

import { JTI_SKEW_SECONDS } from "./auth.js";

export interface JtiStore {
  /**
   * Atomically claim a jti until exp (+ skew).
   * @returns true if this is the first use; false if already consumed (replay).
   */
  consume(jti: string, expUnixSeconds: number): Promise<boolean> | boolean;

  /** Test / ops helper — number of live entries (best-effort). */
  size?(): number;
}

/**
 * In-process jti store with lazy expiry on access and optional sweep timer.
 */
export class InMemoryJtiStore implements JtiStore {
  /** jti → absolute expiry unix seconds (with skew already applied) */
  private readonly entries = new Map<string, number>();
  private readonly skewSeconds: number;
  private sweepTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options?: { skewSeconds?: number; sweepIntervalMs?: number }) {
    this.skewSeconds = options?.skewSeconds ?? JTI_SKEW_SECONDS;
    const sweepMs = options?.sweepIntervalMs ?? 30_000;
    if (sweepMs > 0) {
      this.sweepTimer = setInterval(() => this.sweep(), sweepMs);
      // Do not keep the process alive solely for the sweeper (tests/CI).
      if (typeof this.sweepTimer.unref === "function") {
        this.sweepTimer.unref();
      }
    }
  }

  consume(jti: string, expUnixSeconds: number): boolean {
    if (!jti) return false;
    const now = Math.floor(Date.now() / 1000);
    this.purgeExpired(now);

    const existing = this.entries.get(jti);
    if (existing !== undefined && existing > now) {
      return false;
    }

    // Non-expiring tokens: retain for max skew window only if exp==0.
    const retainUntil =
      expUnixSeconds > 0
        ? expUnixSeconds + this.skewSeconds
        : now + this.skewSeconds;
    this.entries.set(jti, retainUntil);
    return true;
  }

  size(): number {
    this.purgeExpired(Math.floor(Date.now() / 1000));
    return this.entries.size;
  }

  /** Drop all entries (tests). */
  clear(): void {
    this.entries.clear();
  }

  dispose(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    this.entries.clear();
  }

  private sweep(): void {
    this.purgeExpired(Math.floor(Date.now() / 1000));
  }

  private purgeExpired(now: number): void {
    for (const [key, exp] of this.entries) {
      if (exp <= now) this.entries.delete(key);
    }
  }
}

/**
 * Minimal Redis surface for jti SET NX EX.
 * Compatible with ioredis and ioredis-mock without hard dependency.
 */
export type RedisJtiClient = {
  set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<string | null>;
};

export type RedisJtiStoreOptions = {
  client: RedisJtiClient;
  /** Key prefix; default `relay:v1:jti:` per G2a/G6 ADR. */
  keyPrefix?: string;
  skewSeconds?: number;
};

/**
 * Shared Redis jti store: `SET relay:v1:jti:{jti} 1 NX EX <ttl>`.
 * Used when multi-relay (G6); optional for G2a.2 single-task.
 */
export class RedisJtiStore implements JtiStore {
  private readonly client: RedisJtiClient;
  private readonly keyPrefix: string;
  private readonly skewSeconds: number;

  constructor(options: RedisJtiStoreOptions) {
    this.client = options.client;
    this.keyPrefix = options.keyPrefix ?? "relay:v1:jti:";
    this.skewSeconds = options.skewSeconds ?? JTI_SKEW_SECONDS;
  }

  async consume(jti: string, expUnixSeconds: number): Promise<boolean> {
    if (!jti) return false;
    const now = Math.floor(Date.now() / 1000);
    let ttl: number;
    if (expUnixSeconds > 0) {
      ttl = Math.max(1, expUnixSeconds + this.skewSeconds - now);
    } else {
      ttl = Math.max(1, this.skewSeconds);
    }
    const key = `${this.keyPrefix}${jti}`;
    // ioredis: set(key, value, "EX", ttl, "NX") → "OK" | null
    const result = await this.client.set(key, "1", "EX", ttl, "NX");
    return result === "OK";
  }
}
