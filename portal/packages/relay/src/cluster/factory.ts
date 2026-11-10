import {
  assertRelayClusterEnvConfig,
  loadRelayClusterConfig,
} from "./config.js";
import { asRedisLike, createRedisClient } from "./redis-client.js";
import { RedisRelayCluster } from "./redis-relay-cluster.js";
import { SingleNodeCluster } from "./single-node-cluster.js";
import type {
  RedisLike,
  RelayCluster,
  RelayClusterConfig,
} from "./types.js";

export type CreateRelayClusterOptions = RelayClusterConfig & {
  /**
   * Inject a Redis-like client (tests / ioredis-mock).
   * When set with mode=bus, REDIS_URL is not used.
   */
  redisClient?: RedisLike;
};

/**
 * Build the process RelayCluster. For production boot, load via loadRelayClusterConfig
 * then assertRelayClusterEnvConfig (unless redisClient is injected for tests).
 */
export function createRelayCluster(
  config: CreateRelayClusterOptions,
): RelayCluster {
  if (config.mode === "single") {
    return new SingleNodeCluster({
      nodeId: config.nodeId,
      advertiseUrl: config.advertiseUrl,
    });
  }

  if (!config.advertiseUrl) {
    throw new Error(
      "RELAY_CLUSTER_MODE=bus requires RELAY_ADVERTISE_URL",
    );
  }

  const client: RedisLike =
    config.redisClient ??
    asRedisLike(
      createRedisClient({
        url: config.redisUrl!,
      }),
    );

  if (!config.redisClient && !config.redisUrl) {
    throw new Error(
      "RELAY_CLUSTER_MODE=bus requires REDIS_URL " +
        "(GitHub Secret / SSM — never commit credentials)",
    );
  }

  return new RedisRelayCluster({
    ...config,
    advertiseUrl: config.advertiseUrl,
    redisClient: client,
  });
}

/**
 * Convenience for process boot from env.
 */
export function createRelayClusterFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  overrides?: { redisClient?: RedisLike },
): RelayCluster {
  const config = loadRelayClusterConfig(env);
  if (!overrides?.redisClient) {
    assertRelayClusterEnvConfig(config);
  } else if (config.mode === "bus" && !config.advertiseUrl) {
    throw new Error(
      "RELAY_CLUSTER_MODE=bus requires RELAY_ADVERTISE_URL",
    );
  }
  return createRelayCluster({
    ...config,
    redisClient: overrides?.redisClient,
  });
}
