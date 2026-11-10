import { Redis } from "ioredis";

import type { RedisLike } from "./types.js";

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
    connectTimeout: 5_000,
  });
}

export function asRedisLike(client: Redis): RedisLike {
  return client as unknown as RedisLike;
}
