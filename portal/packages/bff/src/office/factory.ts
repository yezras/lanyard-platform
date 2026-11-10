import {
  createRedisClient,
  type RedisLike,
} from "../redis-session-store.js";
import {
  MemoryOfficeDocumentSessionStore,
  type OfficeDocumentSessionStore,
} from "./store.js";
import { RedisOfficeDocumentSessionStore } from "./redis-store.js";
import { DEFAULT_OFFICE_SESSION_TTL_SECONDS } from "./types.js";

export type OfficeSessionBackend = "memory" | "redis";

export type OfficeDocumentSessionStoreConfig = {
  /**
   * `memory` — process-local Map (lab / desired count = 1).
   * `redis` — shared ElastiCache Redis/Valkey (required when multi-instance).
   */
  backend: OfficeSessionBackend;
  redisUrl?: string;
  /** Absolute TTL seconds for Office sessions (default 3600). */
  ttlSeconds: number;
  /**
   * When true (multi-task / horizontal scale), backend must be redis.
   * Fail-closed at startup — no silent memory fallback.
   */
  multiInstance: boolean;
};

/**
 * Resolve Office session store config from environment.
 *
 * Env (values never committed):
 * - BFF_OFFICE_SESSION_BACKEND=memory|redis (falls back to BFF_SESSION_BACKEND, then memory)
 * - REDIS_URL — required when backend=redis
 * - BFF_OFFICE_SESSION_TTL_SECONDS — absolute TTL (default 3600)
 * - BFF_MULTI_INSTANCE=true|1 — requires redis backend
 */
export function loadOfficeDocumentSessionStoreConfig(
  env: NodeJS.ProcessEnv = process.env,
): OfficeDocumentSessionStoreConfig {
  const rawBackend = (
    env.BFF_OFFICE_SESSION_BACKEND?.trim().toLowerCase() ||
    env.BFF_SESSION_BACKEND?.trim().toLowerCase() ||
    "memory"
  ) as string;

  if (rawBackend !== "memory" && rawBackend !== "redis") {
    throw new Error(
      `BFF_OFFICE_SESSION_BACKEND must be "memory" or "redis" (got ${JSON.stringify(rawBackend)})`,
    );
  }

  const multiInstance =
    env.BFF_MULTI_INSTANCE === "1" ||
    env.BFF_MULTI_INSTANCE?.toLowerCase() === "true";

  const ttlSeconds = Number(
    env.BFF_OFFICE_SESSION_TTL_SECONDS ?? DEFAULT_OFFICE_SESSION_TTL_SECONDS,
  );
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("BFF_OFFICE_SESSION_TTL_SECONDS must be a positive number");
  }

  return {
    backend: rawBackend,
    redisUrl: env.REDIS_URL?.trim() || undefined,
    ttlSeconds,
    multiInstance,
  };
}

export function assertOfficeDocumentSessionStoreConfig(
  config: OfficeDocumentSessionStoreConfig,
): void {
  if (config.multiInstance && config.backend !== "redis") {
    throw new Error(
      "BFF_MULTI_INSTANCE requires BFF_OFFICE_SESSION_BACKEND=redis " +
        "(shared Office document session store). " +
        "Horizontal scale without sticky sessions is unsupported with memory backend.",
    );
  }
  if (config.backend === "redis" && !config.redisUrl) {
    throw new Error(
      "BFF_OFFICE_SESSION_BACKEND=redis requires REDIS_URL " +
        "(GitHub Secret / SSM SecureString — never commit credentials)",
    );
  }
}

export type CreateOfficeDocumentSessionStoreOptions =
  OfficeDocumentSessionStoreConfig & {
    /** Inject Redis-like client (tests / ioredis-mock). */
    redisClient?: RedisLike;
  };

/**
 * Build the process OfficeDocumentSessionStore.
 * Call assertOfficeDocumentSessionStoreConfig first in production boot.
 */
export function createOfficeDocumentSessionStore(
  config: CreateOfficeDocumentSessionStoreOptions,
): OfficeDocumentSessionStore {
  assertOfficeDocumentSessionStoreConfig(config);

  if (config.backend === "memory") {
    return new MemoryOfficeDocumentSessionStore();
  }

  const client: RedisLike =
    config.redisClient ??
    (createRedisClient({
      url: config.redisUrl!,
    }) as unknown as RedisLike);

  return new RedisOfficeDocumentSessionStore(client, {
    ttlSeconds: config.ttlSeconds,
  });
}
