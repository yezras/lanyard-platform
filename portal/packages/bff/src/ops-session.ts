import { randomBytes } from "node:crypto";

import { deleteCookie, setCookie } from "hono/cookie";

import {
  DEFAULT_SESSION_MAX_AGE_SECONDS,
  DEFAULT_SESSION_TTL_SECONDS,
  OPS_SESSION_COOKIE,
} from "./session.js";
import type { RedisLike } from "./redis-session-store.js";

/** Redis key prefix for ops console sessions. Never tenant `bff:v1:sess:`. */
export const OPS_SESSION_REDIS_KEY_PREFIX = "bff:v1:ops-sess:";

/**
 * Operator browser session. `tenantId` is illegal on this record — ops is
 * not a tenant user and must not mint `lanyard_session`.
 */
export type OpsSessionRecord = {
  plane: "ops";
  sessionId: string;
  operatorId: string;
  email: string;
  createdAt: number;
};

export type OpsSessionUser = {
  operator_id: string;
  email: string;
  plane: "ops";
};

export type OpsVariables = {
  opsOperator: OpsSessionUser | null;
};

export interface OpsSessionStore {
  create(input: {
    operatorId: string;
    email: string;
  }): Promise<OpsSessionRecord>;
  get(sessionId: string): Promise<OpsSessionRecord | null>;
  delete(sessionId: string): Promise<void>;
  clear(): Promise<void>;
  ready(): Promise<boolean>;
  close?(): Promise<void>;
}

function parseOpsSessionRecord(raw: unknown): OpsSessionRecord | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = raw as Record<string, unknown>;
  if (value.plane !== "ops") {
    return null;
  }
  if (typeof value.tenantId === "string" && value.tenantId.length > 0) {
    return null;
  }
  if (
    typeof value.sessionId !== "string" ||
    !value.sessionId ||
    typeof value.operatorId !== "string" ||
    !value.operatorId ||
    typeof value.email !== "string" ||
    !value.email ||
    typeof value.createdAt !== "number"
  ) {
    return null;
  }
  return {
    plane: "ops",
    sessionId: value.sessionId,
    operatorId: value.operatorId,
    email: value.email,
    createdAt: value.createdAt,
  };
}

export class MemoryOpsSessionStore implements OpsSessionStore {
  private readonly sessions = new Map<string, OpsSessionRecord>();

  async create(input: {
    operatorId: string;
    email: string;
  }): Promise<OpsSessionRecord> {
    const session: OpsSessionRecord = {
      plane: "ops",
      sessionId: randomBytes(24).toString("base64url"),
      operatorId: input.operatorId,
      email: input.email,
      createdAt: Date.now(),
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  async get(sessionId: string): Promise<OpsSessionRecord | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async clear(): Promise<void> {
    this.sessions.clear();
  }

  async ready(): Promise<boolean> {
    return true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type RedisOpsSessionStoreOptions = {
  ttlSeconds?: number;
  maxAgeSeconds?: number;
  maxRetries?: number;
};

export class RedisOpsSessionStore implements OpsSessionStore {
  private readonly ttlSeconds: number;
  private readonly maxAgeSeconds: number;
  private readonly maxRetries: number;

  constructor(
    private readonly redis: RedisLike,
    options: RedisOpsSessionStoreOptions = {},
  ) {
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
    this.maxAgeSeconds =
      options.maxAgeSeconds ?? DEFAULT_SESSION_MAX_AGE_SECONDS;
    this.maxRetries = options.maxRetries ?? 3;
  }

  private key(sessionId: string): string {
    return `${OPS_SESSION_REDIS_KEY_PREFIX}${sessionId}`;
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
    operatorId: string;
    email: string;
  }): Promise<OpsSessionRecord> {
    const session: OpsSessionRecord = {
      plane: "ops",
      sessionId: randomBytes(24).toString("base64url"),
      operatorId: input.operatorId,
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

  async get(sessionId: string): Promise<OpsSessionRecord | null> {
    try {
      const raw = await this.withRetry(() =>
        this.redis.get(this.key(sessionId)),
      );
      if (!raw) {
        return null;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        await this.delete(sessionId);
        return null;
      }

      const session = parseOpsSessionRecord(parsed);
      if (!session) {
        await this.delete(sessionId);
        return null;
      }

      const ageMs = Date.now() - session.createdAt;
      if (ageMs > this.maxAgeSeconds * 1000) {
        await this.delete(sessionId);
        return null;
      }

      try {
        await this.withRetry(() =>
          this.redis.expire(this.key(sessionId), this.ttlSeconds),
        );
      } catch {
        // Session is still valid for this request even if EXPIRE fails.
      }

      return session;
    } catch {
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

  async clear(): Promise<void> {
    let cursor = "0";
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        "MATCH",
        `${OPS_SESSION_REDIS_KEY_PREFIX}*`,
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

type CookieContext = Parameters<typeof setCookie>[0];

export function setOpsSessionCookie(
  c: CookieContext,
  sessionId: string,
  secure: boolean,
): void {
  setCookie(c, OPS_SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
  });
}

export function clearOpsSessionCookie(
  c: CookieContext,
  secure: boolean,
): void {
  deleteCookie(c, OPS_SESSION_COOKIE, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
  });
}

export async function resolveAllowlistedOpsSessionUser(
  store: OpsSessionStore,
  lookup: (email: string) => Promise<{ operatorId: string; email: string } | null>,
  sessionId: string | null,
): Promise<OpsSessionUser | null> {
  if (!sessionId) {
    return null;
  }
  const session = await store.get(sessionId);
  if (!session || session.plane !== "ops") {
    return null;
  }
  const operator = await lookup(session.email);
  if (!operator) {
    await store.delete(sessionId);
    return null;
  }
  return {
    operator_id: session.operatorId,
    email: session.email,
    plane: "ops",
  };
}

/** Exported for Redis parse tests. */
export const parseOpsSessionRecordForTests = parseOpsSessionRecord;
