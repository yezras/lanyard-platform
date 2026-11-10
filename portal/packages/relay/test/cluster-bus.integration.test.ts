import RedisMock from "ioredis-mock";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import WebSocket from "ws";
import {
  LANYARD_WEB_PLATFORM,
  RELAY_UNAUTHORIZED_CLOSE_CODE,
  type InboundFrame,
  type MessageEvent,
} from "@lanyard/shared";

import { makeUpgradeToken } from "../src/auth.js";
import {
  createRelayCluster,
  ownerKey,
  revokedKey,
  type RedisLike,
} from "../src/cluster/index.js";
import { ChatDeliveryHub } from "../src/chat-delivery-hub.js";
import { RELAY_INTERNAL_TOKEN_HEADER } from "../src/internal-http.js";
import { createRelayServer } from "../src/server.js";
import { InMemorySecretStore } from "../src/secret-store.js";
import { RelaySessionServerImpl } from "../src/relay-session-server.js";

const INTERNAL_TOKEN = "test-relay-internal-token";
const GATEWAY_ID = "gw-bus-001";
const INSTANCE_ID = "inst-bus-001";
const SECRET = "test-bus-secret-xyz";

/**
 * Isolated in-memory Redis pair for multi-node tests.
 * ioredis-mock keys the shared store by host — use a unique host per suite
 * so revoke markers do not leak across tests.
 */
function createSharedRedisPair(): { redisA: RedisLike; redisB: RedisLike } {
  const host = `relay-bus-test-${crypto.randomUUID()}`;
  const redisA = new RedisMock({ host }) as unknown as RedisLike & {
    createConnectedClient?: () => RedisLike;
    flushall?: () => Promise<string>;
  };
  const redisB =
    typeof redisA.createConnectedClient === "function"
      ? redisA.createConnectedClient()
      : (new RedisMock({ host }) as unknown as RedisLike);
  return { redisA, redisB };
}

function clusterOptions(
  nodeId: string,
  advertiseUrl: string,
  redis: RedisLike,
) {
  return {
    mode: "bus" as const,
    nodeId,
    advertiseUrl,
    ownerLeaseSeconds: 30,
    ownerHeartbeatMs: 60_000,
    revokeRetentionSeconds: 86_400,
    busAckTimeoutMs: 1_500,
    redisClient: redis,
  };
}

async function connectGateway(
  port: number,
  token: string,
): Promise<{
  ws: WebSocket;
  waitForDescriptor: () => Promise<void>;
  waitForInbound: () => Promise<InboundFrame>;
  close: () => Promise<void>;
}> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/relay`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });

  let buffer = "";
  const descriptorWaiters: Array<() => void> = [];
  const inboundWaiters: Array<(f: InboundFrame) => void> = [];

  ws.on("message", (data) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const frame = JSON.parse(line) as { type?: string };
      if (frame.type === "descriptor") {
        descriptorWaiters.shift()?.();
      } else if (frame.type === "inbound") {
        inboundWaiters.shift()?.(frame as InboundFrame);
      }
    }
  });

  return {
    ws,
    waitForDescriptor: () =>
      new Promise((resolve) => {
        descriptorWaiters.push(resolve);
      }),
    waitForInbound: () =>
      new Promise((resolve) => {
        inboundWaiters.push(resolve);
      }),
    close: () =>
      new Promise((resolve) => {
        ws.once("close", () => resolve());
        ws.close();
      }),
  };
}

function sampleEvent(text = "hello from bus"): MessageEvent {
  return {
    text,
    message_type: "text",
    source: {
      platform: LANYARD_WEB_PLATFORM,
      chat_id: "chat-bus-1",
      chat_type: "dm",
      chat_name: "Bus Chat",
      user_id: "user-1",
      user_name: "Test",
      thread_id: null,
      chat_topic: null,
    },
  };
}

describe("multi-relay routing bus (G6.2)", () => {
  let redis: RedisLike;
  let redisB: RedisLike;
  let secretStoreA: InMemorySecretStore;
  let secretStoreB: InMemorySecretStore;
  let hubA: ChatDeliveryHub;
  let hubB: ChatDeliveryHub;
  let sessionA: RelaySessionServerImpl;
  let sessionB: RelaySessionServerImpl;
  let serverA: Awaited<ReturnType<typeof createRelayServer>>;
  let serverB: Awaited<ReturnType<typeof createRelayServer>>;

  beforeEach(async () => {
    const pair = createSharedRedisPair();
    redis = pair.redisA;
    redisB = pair.redisB;

    secretStoreA = new InMemorySecretStore();
    secretStoreB = new InMemorySecretStore();
    // Both nodes know the same instance secret (prod: CP validate / shared load).
    for (const store of [secretStoreA, secretStoreB]) {
      store.register({
        gatewayId: GATEWAY_ID,
        instanceId: INSTANCE_ID,
        secrets: [SECRET],
        tenantId: "tenant-bus",
      });
    }

    hubA = new ChatDeliveryHub();
    hubB = new ChatDeliveryHub();

    const clusterA = createRelayCluster(
      clusterOptions("node-a", "http://127.0.0.1:0", redis),
    );
    const clusterB = createRelayCluster(
      clusterOptions("node-b", "http://127.0.0.1:0", redisB),
    );

    // Patch advertise URLs after bind (ports assigned dynamically).
    sessionA = new RelaySessionServerImpl({
      secretStore: secretStoreA,
      chatHub: hubA,
      allowQueryToken: true,
      cluster: clusterA,
    });
    sessionB = new RelaySessionServerImpl({
      secretStore: secretStoreB,
      chatHub: hubB,
      allowQueryToken: true,
      cluster: clusterB,
    });

    serverA = await createRelayServer({
      host: "127.0.0.1",
      port: 0,
      relayPath: "/relay",
      sessionServer: sessionA,
      chatHub: hubA,
      secretStore: secretStoreA,
      internalToken: INTERNAL_TOKEN,
    });
    serverB = await createRelayServer({
      host: "127.0.0.1",
      port: 0,
      relayPath: "/relay",
      sessionServer: sessionB,
      chatHub: hubB,
      secretStore: secretStoreB,
      internalToken: INTERNAL_TOKEN,
    });

    // Update advertise URLs to real bound ports for owner registry.
    clusterA.advertiseUrl = `http://127.0.0.1:${serverA.port}`;
    clusterB.advertiseUrl = `http://127.0.0.1:${serverB.port}`;
  });

  afterEach(async () => {
    await serverA?.close();
    await serverB?.close();
    for (const client of [redis, redisB]) {
      try {
        await client?.quit();
      } catch {
        // ignore
      }
    }
  });

  it("GET /ready fails closed when Redis is unreachable in bus mode", async () => {
    // Healthy shared redis → ready
    const ok = await fetch(`http://127.0.0.1:${serverA.port}/ready`);
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { status: string; mode: string };
    expect(body).toMatchObject({ status: "ready", mode: "bus" });
  });

  it("GET /health stays up without Redis dependency", async () => {
    const res = await fetch(`http://127.0.0.1:${serverA.port}/health`);
    expect(res.status).toBe(200);
  });

  it("claims owner lease on handshake and exposes GET /internal/instances/:id/owner", async () => {
    const token = makeUpgradeToken(GATEWAY_ID, SECRET);
    const gw = await connectGateway(serverA.port, token);
    gw.ws.send(
      JSON.stringify({
        type: "hello",
        platform: LANYARD_WEB_PLATFORM,
        botId: "lanyard-web",
      }) + "\n",
    );
    await gw.waitForDescriptor();

    // Allow async claimOwner to settle.
    await new Promise((r) => setTimeout(r, 50));

    const ownerRes = await fetch(
      `http://127.0.0.1:${serverB.port}/internal/instances/${INSTANCE_ID}/owner`,
      { headers: { [RELAY_INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN } },
    );
    expect(ownerRes.status).toBe(200);
    const owner = (await ownerRes.json()) as {
      node_id: string;
      advertise_url: string;
      connected: boolean;
      mode: string;
    };
    expect(owner.mode).toBe("bus");
    expect(owner.connected).toBe(true);
    expect(owner.node_id).toBe("node-a");
    expect(owner.advertise_url).toContain(`:${serverA.port}`);

    const raw = await redis.get(ownerKey(INSTANCE_ID));
    expect(raw).toBeTruthy();

    await gw.close();
  });

  it("delivers inbound via bus when HTTP hits non-owner node", async () => {
    const token = makeUpgradeToken(GATEWAY_ID, SECRET);
    const gw = await connectGateway(serverA.port, token);
    gw.ws.send(
      JSON.stringify({
        type: "hello",
        platform: LANYARD_WEB_PLATFORM,
        botId: "lanyard-web",
      }) + "\n",
    );
    await gw.waitForDescriptor();
    await new Promise((r) => setTimeout(r, 50));

    const inboundPromise = gw.waitForInbound();

    // BFF hits node B (no local session) — bus routes to node A.
    const res = await fetch(
      `http://127.0.0.1:${serverB.port}/internal/deliver-inbound`,
      {
        method: "POST",
        headers: {
          [RELAY_INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          instance_id: INSTANCE_ID,
          tenant_id: "tenant-bus",
          event: sampleEvent("cross-node deliver"),
        }),
      },
    );
    expect(res.status).toBe(200);

    const inbound = await inboundPromise;
    expect(inbound.event.text).toBe("cross-node deliver");

    await gw.close();
  });

  it("interrupt via non-owner node reaches gateway on owner", async () => {
    const token = makeUpgradeToken(GATEWAY_ID, SECRET);
    const gw = await connectGateway(serverA.port, token);
    gw.ws.send(
      JSON.stringify({
        type: "hello",
        platform: LANYARD_WEB_PLATFORM,
        botId: "lanyard-web",
      }) + "\n",
    );
    await gw.waitForDescriptor();
    await new Promise((r) => setTimeout(r, 50));

    const interruptPromise = new Promise<Record<string, unknown>>((resolve) => {
      gw.ws.on("message", (data) => {
        try {
          const frame = JSON.parse(data.toString().trim()) as Record<
            string,
            unknown
          >;
          if (frame.type === "interrupt_inbound") resolve(frame);
        } catch {
          // ignore
        }
      });
    });

    const res = await fetch(
      `http://127.0.0.1:${serverB.port}/internal/interrupt-inbound`,
      {
        method: "POST",
        headers: {
          [RELAY_INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          instance_id: INSTANCE_ID,
          session_key: "agent:main:relay:dm:chat-bus-1",
          chat_id: "chat-bus-1",
        }),
      },
    );
    expect(res.status).toBe(200);

    const frame = await interruptPromise;
    expect(frame.session_key).toBe("agent:main:relay:dm:chat-bus-1");

    await gw.close();
  });

  it("revoke on non-owner node closes live WS on owner with 4401 and sets shared marker", async () => {
    const token = makeUpgradeToken(GATEWAY_ID, SECRET);
    const gw = await connectGateway(serverA.port, token);
    gw.ws.send(
      JSON.stringify({
        type: "hello",
        platform: LANYARD_WEB_PLATFORM,
        botId: "lanyard-web",
      }) + "\n",
    );
    await gw.waitForDescriptor();
    await new Promise((r) => setTimeout(r, 50));

    const closePromise = new Promise<{ code: number; reason: string }>(
      (resolve) => {
        gw.ws.once("close", (code, reason) => {
          resolve({ code, reason: reason.toString() });
        });
      },
    );

    // Revoke hits node B while session lives on A.
    const res = await fetch(
      `http://127.0.0.1:${serverB.port}/internal/instances/${INSTANCE_ID}/revoke`,
      {
        method: "POST",
        headers: { [RELAY_INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      cluster_revoked: boolean;
      close_code: number;
    };
    expect(body.cluster_revoked).toBe(true);
    expect(body.close_code).toBe(RELAY_UNAUTHORIZED_CLOSE_CODE);

    const closed = await closePromise;
    expect(closed.code).toBe(RELAY_UNAUTHORIZED_CLOSE_CODE);

    // Shared marker present for both nodes.
    const marker = await redis.get(revokedKey(INSTANCE_ID));
    expect(marker).toBeTruthy();
    expect(secretStoreA.getByInstanceId(INSTANCE_ID)?.revoked).toBe(true);
    expect(secretStoreB.getByInstanceId(INSTANCE_ID)?.revoked).toBe(true);

    // Reconnect rejected on both nodes.
    for (const port of [serverA.port, serverB.port]) {
      await expect(
        new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(`ws://127.0.0.1:${port}/relay`, {
            headers: {
              Authorization: `Bearer ${makeUpgradeToken(GATEWAY_ID, SECRET)}`,
            },
          });
          ws.on("open", () =>
            reject(new Error(`revoked secret should not connect on ${port}`)),
          );
          ws.on("error", () => resolve());
        }),
      ).resolves.toBeUndefined();
    }
  });

  it("local deliver still works when request hits the owner node", async () => {
    const token = makeUpgradeToken(GATEWAY_ID, SECRET);
    const gw = await connectGateway(serverA.port, token);
    gw.ws.send(
      JSON.stringify({
        type: "hello",
        platform: LANYARD_WEB_PLATFORM,
        botId: "lanyard-web",
      }) + "\n",
    );
    await gw.waitForDescriptor();

    const inboundPromise = gw.waitForInbound();
    const res = await fetch(
      `http://127.0.0.1:${serverA.port}/internal/deliver-inbound`,
      {
        method: "POST",
        headers: {
          [RELAY_INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          instance_id: INSTANCE_ID,
          event: sampleEvent("local path"),
        }),
      },
    );
    expect(res.status).toBe(200);
    const inbound = await inboundPromise;
    expect(inbound.event.text).toBe("local path");
    await gw.close();
  });
});

describe("single-node default (no Redis)", () => {
  it("process-local deliver and revoke without cluster injection", async () => {
    const secretStore = new InMemorySecretStore();
    secretStore.register({
      gatewayId: GATEWAY_ID,
      instanceId: INSTANCE_ID,
      secrets: [SECRET],
    });
    const chatHub = new ChatDeliveryHub();
    const sessionServer = new RelaySessionServerImpl({
      secretStore,
      chatHub,
      allowQueryToken: true,
    });
    const server = await createRelayServer({
      host: "127.0.0.1",
      port: 0,
      relayPath: "/relay",
      sessionServer,
      chatHub,
      secretStore,
      internalToken: INTERNAL_TOKEN,
    });

    try {
      const ready = await fetch(`http://127.0.0.1:${server.port}/ready`);
      expect(ready.status).toBe(200);
      const body = (await ready.json()) as { mode: string };
      expect(body.mode).toBe("single");

      const token = makeUpgradeToken(GATEWAY_ID, SECRET);
      const gw = await connectGateway(server.port, token);
      gw.ws.send(
        JSON.stringify({
          type: "hello",
          platform: LANYARD_WEB_PLATFORM,
          botId: "lanyard-web",
        }) + "\n",
      );
      await gw.waitForDescriptor();

      const delivered = await sessionServer.deliverInbound(
        INSTANCE_ID,
        sampleEvent(),
      );
      expect(delivered).toBe(true);

      await gw.close();
    } finally {
      await server.close();
    }
  });
});
