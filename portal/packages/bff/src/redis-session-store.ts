import { randomBytes } from "node:crypto";

import { Redis } from "ioredis";

import type { SessionRecord, SessionStore } from "./session.js";
import {
  DEFAULT_SESSION_MAX_AGE_SECONDS,
  DEFAULT_SESSION_TTL_SECONDS,
  SESSION_REDIS_KEY_PREFIX,
} from "./session.js";

/**
 * Minimal Redis client surface used by the session store (real + mock).
 * Kept loose so ioredis overloads and ioredis-mock both satisfy it.
 */
export type RedisLike = {
  get(key: string): Promise<string | null>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set(key: string, value: string, ...args: any[]): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  ping(): Promise<string>;
  quit(): Promise<string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scan(cursor: string | number, ...args: any[]): Promise<[string, string[]]>;
};

export type RedisSessionStoreOptions = {
  /** Sliding TTL in seconds (default 7d). */
  ttlSeconds?: number;
  /** Absolute max age from createdAt in seconds (default 30d). */
  maxAgeSeconds?: number;
  /**
   * Retry attempts on transient Redis errors (GET/SET/DEL/EXPIRE).
   * Default 3 with exponential backoff capped at 500ms (ADR G5).
   */
  maxRetries?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Redis/Valkey-backed session store for multi-instance BFF (G5.2).
 *
 * Key layout: `bff:v1:sess:{sessionId}` → JSON SessionRecord
 * Sliding TTL via EXPIRE on successful GET; absolute max age from createdAt.
 *
 * Fail-closed: read/write errors after retries do not fall back to memory.
 * GET failures return null (unauthenticated). CREATE failures throw.
 */
export class RedisSessionStore implements SessionStore {
  private readonly ttlSeconds: number;
  private readonly maxAgeSeconds: number;
  private readonly maxRetries: number;

  constructor(
    private readonly redis: RedisLike,
    options: RedisSessionStoreOptions = {},
  ) {
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
    this.maxAgeSeconds =
      options.maxAgeSeconds ?? DEFAULT_SESSION_MAX_AGE_SECONDS;
    this.maxRetries = options.maxRetries ?? 3;
  }

  private key(sessionId: string): string {
    return `${SESSION_REDIS_KEY_PREFIX}${sessionId}`;
  }

  private async withRetry<T>(op: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await op();
      } catch (error) {
        lastError = error;
        if (attempt + 1 >= this.maxRetries) {
          break;
        }
        const delayMs = Math.min(50 * 2 ** attempt, 500);
        await sleep(delayMs);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError));
  }

  async create(input: {
    userId: string;
    tenantId: string;
    email: string;
  }): Promise<SessionRecord> {
    const session: SessionRecord = {
      sessionId: randomBytes(24).toString("base64url"),
      userId: input.userId,
      tenantId: input.tenantId,
      email: input.email,
      createdAt: Date.now(),
    };
    await this.withRetry(() =>
      this.redis.set(
        this.key(session.sessionId),
        JSON.stringify(session),
        "EX",
        this.ttlSeconds,
      ),
    );
    return session;
  }

  async get(sessionId: string): Promise<SessionRecord | null> {
    try {
      const raw = await this.withRetry(() =>
        this.redis.get(this.key(sessionId)),
      );
      if (!raw) {
        return null;
      }

      let session: SessionRecord;
      try {
        session = JSON.parse(raw) as SessionRecord;
      } catch {
        await this.delete(sessionId);
        return null;
      }

      if (
        !session.sessionId ||
        !session.userId ||
        !session.tenantId ||
        typeof session.createdAt !== "number"
      ) {
        await this.delete(sessionId);
        return null;
      }

      const ageMs = Date.now() - session.createdAt;
      if (ageMs > this.maxAgeSeconds * 1000) {
        await this.delete(sessionId);
        return null;
      }

      // Sliding TTL: refresh EXPIRE on successful read.
      try {
        await this.withRetry(() =>
          this.redis.expire(this.key(sessionId), this.ttlSeconds),
        );
      } catch {
        // Session is still valid for this request even if EXPIRE fails.
      }

      return session;
    } catch {
      // Fail closed: unreadable session → unauthenticated (no memory fallback).
      return null;
    }
  }

  async delete(sessionId: string): Promise<void> {
    try {
      await this.withRetry(() => this.redis.del(this.key(sessionId)));
    } catch {
      // Best-effort logout; cookie is cleared by caller either way.
    }
  }

  /** Scan+delete all session keys. Test / lab only — avoid in production paths. */
  async clear(): Promise<void> {
    let cursor = "0";
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        "MATCH",
        `${SESSION_REDIS_KEY_PREFIX}*`,
        "COUNT",
        100,
      );
      cursor = next;
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } while (cursor !== "0");
  }

  async ready(): Promise<boolean> {
    try {
      const pong = await this.withRetry(() => this.redis.ping());
      return pong === "PONG";
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      // ignore close errors
    }
  }
}

export type CreateRedisClientOptions = {
  url: string;
  /**
   * When true, use lazyConnect so constructors don't hang offline.
   * Production default connects eagerly.
   */
  lazyConnect?: boolean;
};

/**
 * Create an ioredis client for REDIS_URL.
 * TLS is enabled when the URL uses rediss:// (ElastiCache in-transit encryption).
 * Auth token is part of the URL — never commit credentials.
 */
export function createRedisClient(options: CreateRedisClientOptions): Redis {
  return new Redis(options.url, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    lazyConnect: options.lazyConnect ?? false,
    // Prefer failing closed quickly over hanging request handlers.
    connectTimeout: 5_000,
  });
}
