import { describe, expect, it } from "vitest";

import {
  assertRelayClusterEnvConfig,
  DEFAULT_OWNER_LEASE_SECONDS,
  DEFAULT_REVOKE_RETENTION_SECONDS,
  loadRelayClusterConfig,
} from "../src/cluster/config.js";
import { createRelayCluster } from "../src/cluster/factory.js";
import { SingleNodeCluster } from "../src/cluster/single-node-cluster.js";

describe("relay cluster config (G6.2)", () => {
  it("defaults to single mode without Redis", () => {
    const config = loadRelayClusterConfig({});
    expect(config.mode).toBe("single");
    expect(config.redisUrl).toBeUndefined();
    expect(config.ownerLeaseSeconds).toBe(DEFAULT_OWNER_LEASE_SECONDS);
    expect(config.revokeRetentionSeconds).toBe(DEFAULT_REVOKE_RETENTION_SECONDS);
    expect(config.nodeId).toBeTruthy();
  });

  it("parses bus mode and REDIS_URL secret name only (value from env)", () => {
    const config = loadRelayClusterConfig({
      RELAY_CLUSTER_MODE: "bus",
      REDIS_URL: "rediss://:token@cache.example:6379/0",
      RELAY_ADVERTISE_URL: "http://relay-a.internal:8787",
      RELAY_NODE_ID: "node-a",
      RELAY_OWNER_LEASE_SECONDS: "45",
    });
    expect(config.mode).toBe("bus");
    expect(config.redisUrl).toBe("rediss://:token@cache.example:6379/0");
    expect(config.advertiseUrl).toBe("http://relay-a.internal:8787");
    expect(config.nodeId).toBe("node-a");
    expect(config.ownerLeaseSeconds).toBe(45);
  });

  it("strips trailing slash from RELAY_ADVERTISE_URL", () => {
    const config = loadRelayClusterConfig({
      RELAY_ADVERTISE_URL: "http://relay.internal:8787/",
    });
    expect(config.advertiseUrl).toBe("http://relay.internal:8787");
  });

  it("fail-closed: bus mode requires REDIS_URL", () => {
    expect(() =>
      assertRelayClusterEnvConfig({
        mode: "bus",
        nodeId: "n1",
        advertiseUrl: "http://relay:8787",
        ownerLeaseSeconds: 30,
        ownerHeartbeatMs: 10_000,
        revokeRetentionSeconds: 86_400,
        busAckTimeoutMs: 2_000,
      }),
    ).toThrow(/REDIS_URL/);
  });

  it("fail-closed: bus mode requires RELAY_ADVERTISE_URL", () => {
    expect(() =>
      assertRelayClusterEnvConfig({
        mode: "bus",
        nodeId: "n1",
        advertiseUrl: null,
        redisUrl: "redis://127.0.0.1:6379",
        ownerLeaseSeconds: 30,
        ownerHeartbeatMs: 10_000,
        revokeRetentionSeconds: 86_400,
        busAckTimeoutMs: 2_000,
      }),
    ).toThrow(/RELAY_ADVERTISE_URL/);
  });

  it("rejects unknown cluster mode", () => {
    expect(() =>
      loadRelayClusterConfig({ RELAY_CLUSTER_MODE: "sticky" }),
    ).toThrow(/single" or "bus/);
  });

  it("createRelayCluster returns SingleNodeCluster by default", () => {
    const cluster = createRelayCluster({
      mode: "single",
      nodeId: "local",
      advertiseUrl: null,
      ownerLeaseSeconds: 30,
      ownerHeartbeatMs: 10_000,
      revokeRetentionSeconds: 86_400,
      busAckTimeoutMs: 2_000,
    });
    expect(cluster).toBeInstanceOf(SingleNodeCluster);
    expect(cluster.mode).toBe("single");
  });
});
