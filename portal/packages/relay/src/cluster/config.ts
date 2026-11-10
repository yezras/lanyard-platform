import { randomUUID } from "node:crypto";

import type { RelayClusterConfig, RelayClusterMode } from "./types.js";

export const DEFAULT_OWNER_LEASE_SECONDS = 30;
export const DEFAULT_OWNER_HEARTBEAT_MS = 10_000;
export const DEFAULT_REVOKE_RETENTION_SECONDS = 7 * 24 * 60 * 60;
export const DEFAULT_BUS_ACK_TIMEOUT_MS = 2_000;

/**
 * Load relay cluster config from environment (G6.2).
 *
 * Env (GitHub Secret / runtime names only — values never in git):
 * - RELAY_CLUSTER_MODE=single|bus (default single)
 * - REDIS_URL — redis:// or rediss:// when mode=bus
 * - RELAY_NODE_ID — optional stable node id (default random UUID)
 * - RELAY_ADVERTISE_URL — internal base URL for SSE/history stickiness (required in bus)
 * - RELAY_OWNER_LEASE_SECONDS — owner key TTL (default 30)
 * - RELAY_OWNER_HEARTBEAT_MS — refresh interval (default 10000)
 * - RELAY_REVOKE_RETENTION_SECONDS — revoked marker TTL (default 7d)
 * - RELAY_BUS_ACK_TIMEOUT_MS — deliver/interrupt wait (default 2000)
 */
export function loadRelayClusterConfig(
  env: NodeJS.ProcessEnv = process.env,
): RelayClusterConfig {
  const rawMode = (env.RELAY_CLUSTER_MODE?.trim().toLowerCase() ||
    "single") as string;
  if (rawMode !== "single" && rawMode !== "bus") {
    throw new Error(
      `RELAY_CLUSTER_MODE must be "single" or "bus" (got ${JSON.stringify(rawMode)})`,
    );
  }
  const mode = rawMode as RelayClusterMode;

  const ownerLeaseSeconds = Number(
    env.RELAY_OWNER_LEASE_SECONDS ?? DEFAULT_OWNER_LEASE_SECONDS,
  );
  const ownerHeartbeatMs = Number(
    env.RELAY_OWNER_HEARTBEAT_MS ?? DEFAULT_OWNER_HEARTBEAT_MS,
  );
  const revokeRetentionSeconds = Number(
    env.RELAY_REVOKE_RETENTION_SECONDS ?? DEFAULT_REVOKE_RETENTION_SECONDS,
  );
  const busAckTimeoutMs = Number(
    env.RELAY_BUS_ACK_TIMEOUT_MS ?? DEFAULT_BUS_ACK_TIMEOUT_MS,
  );

  if (!Number.isFinite(ownerLeaseSeconds) || ownerLeaseSeconds <= 0) {
    throw new Error("RELAY_OWNER_LEASE_SECONDS must be a positive number");
  }
  if (!Number.isFinite(ownerHeartbeatMs) || ownerHeartbeatMs <= 0) {
    throw new Error("RELAY_OWNER_HEARTBEAT_MS must be a positive number");
  }
  if (!Number.isFinite(revokeRetentionSeconds) || revokeRetentionSeconds <= 0) {
    throw new Error("RELAY_REVOKE_RETENTION_SECONDS must be a positive number");
  }
  if (!Number.isFinite(busAckTimeoutMs) || busAckTimeoutMs <= 0) {
    throw new Error("RELAY_BUS_ACK_TIMEOUT_MS must be a positive number");
  }

  const advertiseUrl = env.RELAY_ADVERTISE_URL?.trim().replace(/\/$/, "") || null;
  const redisUrl = env.REDIS_URL?.trim() || undefined;
  const nodeId =
    env.RELAY_NODE_ID?.trim() ||
    env.ECS_TASK_ARN?.trim() ||
    randomUUID();

  return {
    mode,
    nodeId,
    advertiseUrl,
    ownerLeaseSeconds,
    ownerHeartbeatMs,
    revokeRetentionSeconds,
    busAckTimeoutMs,
    redisUrl,
  };
}

/**
 * Assert env-loaded config is shippable (requires REDIS_URL for bus mode).
 * REDIS_URL value is never logged — secret name only.
 */
export function assertRelayClusterEnvConfig(config: RelayClusterConfig): void {
  if (config.mode === "bus" && !config.redisUrl) {
    throw new Error(
      "RELAY_CLUSTER_MODE=bus requires REDIS_URL " +
        "(GitHub Secret / SSM SecureString — never commit credentials)",
    );
  }
  if (config.mode === "bus" && !config.advertiseUrl) {
    throw new Error(
      "RELAY_CLUSTER_MODE=bus requires RELAY_ADVERTISE_URL " +
        "(internal base URL for owner advertise_url)",
    );
  }
}

/** @deprecated Prefer assertRelayClusterEnvConfig */
export const assertRelayClusterConfig = assertRelayClusterEnvConfig;
