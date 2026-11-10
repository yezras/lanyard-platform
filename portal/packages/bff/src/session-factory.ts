import {
  MemoryOpsSessionStore,
  RedisOpsSessionStore,
  type OpsSessionStore,
} from "./ops-session.js";
import {
  createRedisClient,
  RedisSessionStore,
  type RedisLike,
} from "./redis-session-store.js";
import {
  DEFAULT_SESSION_MAX_AGE_SECONDS,
  DEFAULT_SESSION_TTL_SECONDS,
  MemorySessionStore,
  type SessionStore,
} from "./session.js";

export type SessionBackend = "memory" | "redis";

export type SessionStoreConfig = {
  /**
   * `memory` — process-local Map (lab / desired count = 1).
   * `redis` — shared ElastiCache Redis/Valkey (required when multi-instance).
   */
  backend: SessionBackend;
  /**
   * Redis connection URL (redis:// or rediss://). Required when backend=redis.
   * Value from env / GitHub Secrets / SSM — never commit.
   */
  redisUrl?: string;
  /** Sliding TTL seconds (default 7d). */
  sessionTtlSeconds: number;
  /** Absolute max age seconds from createdAt (default 30d). */
  sessionMaxAgeSeconds: number;
  /**
   * When true (multi-task / horizontal scale), backend must be redis with REDIS_URL.
   * Fail-closed at startup — no silent memory fallback.
   */
  multiInstance: boolean;
};

/**
 * Resolve session store config from environment (G5.2).
 *
 * Env (GitHub Secret / runtime names only — values never in git):
 * - BFF_SESSION_BACKEND=memory|redis (default memory)
 * - REDIS_URL — redis:// or rediss:// URL with auth (required for redis)
 * - SESSION_TTL_SECONDS — sliding TTL (default 604800 = 7d)
 * - SESSION_MAX_AGE_SECONDS — absolute cap (default 2592000 = 30d)
 * - BFF_MULTI_INSTANCE=true|1 — requires redis backend + REDIS_URL
 */
export function loadSessionStoreConfig(
  env: NodeJS.ProcessEnv = process.env,
): SessionStoreConfig {
  const rawBackend = (env.BFF_SESSION_BACKEND?.trim().toLowerCase() ||
    "memory") as string;
  if (rawBackend !== "memory" && rawBackend !== "redis") {
    throw new Error(
      `BFF_SESSION_BACKEND must be "memory" or "redis" (got ${JSON.stringify(rawBackend)})`,
    );
  }

  const multiInstance =
    env.BFF_MULTI_INSTANCE === "1" ||
    env.BFF_MULTI_INSTANCE?.toLowerCase() === "true";

  const sessionTtlSeconds = Number(
    env.SESSION_TTL_SECONDS ?? DEFAULT_SESSION_TTL_SECONDS,
  );
  const sessionMaxAgeSeconds = Number(
    env.SESSION_MAX_AGE_SECONDS ?? DEFAULT_SESSION_MAX_AGE_SECONDS,
  );

  if (!Number.isFinite(sessionTtlSeconds) || sessionTtlSeconds <= 0) {
    throw new Error("SESSION_TTL_SECONDS must be a positive number");
  }
  if (!Number.isFinite(sessionMaxAgeSeconds) || sessionMaxAgeSeconds <= 0) {
    throw new Error("SESSION_MAX_AGE_SECONDS must be a positive number");
  }

  return {
    backend: rawBackend,
    redisUrl: env.REDIS_URL?.trim() || undefined,
    sessionTtlSeconds,
    sessionMaxAgeSeconds,
    multiInstance,
  };
}

/**
 * Assert config is safe for the declared topology.
 * Multi-instance without redis is a ship-stopper (G5 readiness rule).
 */
export function assertSessionStoreConfig(config: SessionStoreConfig): void {
  if (config.multiInstance && config.backend !== "redis") {
    throw new Error(
      "BFF_MULTI_INSTANCE requires BFF_SESSION_BACKEND=redis (shared session store). " +
        "Horizontal scale without sticky sessions is unsupported with memory backend.",
    );
  }
  if (config.backend === "redis" && !config.redisUrl) {
    throw new Error(
      "BFF_SESSION_BACKEND=redis requires REDIS_URL " +
        "(GitHub Secret / SSM SecureString — never commit credentials)",
    );
  }
}

export type CreateSessionStoreOptions = SessionStoreConfig & {
  /**
   * Inject a Redis-like client (tests / ioredis-mock).
   * When set with backend=redis, REDIS_URL is not used.
   */
  redisClient?: RedisLike;
};

/**
 * Build the process SessionStore. Call assertSessionStoreConfig first in production boot.
 */
export function createSessionStore(
  config: CreateSessionStoreOptions,
): SessionStore {
  assertSessionStoreConfig(config);

  if (config.backend === "memory") {
    return new MemorySessionStore();
  }

  const client: RedisLike =
    config.redisClient ??
    (createRedisClient({
      url: config.redisUrl!,
    }) as unknown as RedisLike);

  return new RedisSessionStore(client, {
    ttlSeconds: config.sessionTtlSeconds,
    maxAgeSeconds: config.sessionMaxAgeSeconds,
  });
}

/**
 * Ops session store. Same backend as tenant sessions, different Redis prefix
 * (`bff:v1:ops-sess:`). Never shares the tenant session Map/keyspace.
 */
export function createOpsSessionStore(
  config: CreateSessionStoreOptions,
): OpsSessionStore {
  assertSessionStoreConfig(config);

  if (config.backend === "memory") {
    return new MemoryOpsSessionStore();
  }

  const client: RedisLike =
    config.redisClient ??
    (createRedisClient({
      url: config.redisUrl!,
    }) as unknown as RedisLike);

  return new RedisOpsSessionStore(client, {
    ttlSeconds: config.sessionTtlSeconds,
    maxAgeSeconds: config.sessionMaxAgeSeconds,
  });
}
