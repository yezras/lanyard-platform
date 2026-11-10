import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "vitest";
import WebSocket from "ws";
import {
  BRAIN_RPC_CONTRACT_VERSION,
  LANYARD_WEB_PLATFORM,
  RELAY_UNAUTHORIZED_CLOSE_CODE,
  type BrainRpcRequestFrame,
  type CapabilityDescriptor,
  type InboundFrame,
  type MessageEvent,
  type OutboundResultFrame,
} from "@lanyard/shared";
import { ChatDeliveryHub } from "../src/chat-delivery-hub.js";
import { makeUpgradeToken } from "../src/auth.js";
import { RELAY_INTERNAL_TOKEN_HEADER } from "../src/internal-http.js";
import { createRelayServer } from "../src/server.js";
import { InMemorySecretStore } from "../src/secret-store.js";
import { RelaySessionServerImpl } from "../src/relay-session-server.js";

const INTERNAL_TOKEN = "test-relay-internal-token";

const GATEWAY_ID = "gw-test-001";
const INSTANCE_ID = "inst-test-001";
const SECRET = "test-relay-secret-abc123";

interface MockGatewayClient {
  ws: WebSocket;
  waitForDescriptor(): Promise<CapabilityDescriptor>;
  sendOutbound(
    action: Record<string, unknown>,
  ): Promise<OutboundResultFrame["result"]>;
  waitForInbound(): Promise<InboundFrame>;
  close(): Promise<void>;
}

function createMockGateway(
  port: number,
  relayPath: string,
  token: string,
): Promise<MockGatewayClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${relayPath}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    let buffer = "";
    const descriptorWaiters: Array<(d: CapabilityDescriptor) => void> = [];
    const inboundWaiters: Array<(f: InboundFrame) => void> = [];
    const outboundWaiters = new Map<
      string,
      (r: OutboundResultFrame["result"]) => void
    >();

    ws.on("error", reject);

    ws.on("open", () => {
      resolve({
        ws,
        waitForDescriptor: () =>
          new Promise((res) => {
            descriptorWaiters.push(res);
          }),
        sendOutbound: (action) =>
          new Promise((res, rej) => {
            const requestId = crypto.randomUUID().replace(/-/g, "");
            outboundWaiters.set(requestId, res);
            ws.send(
              JSON.stringify({
                type: "outbound",
                requestId,
                action,
              }) + "\n",
            );
            setTimeout(() => {
              if (outboundWaiters.has(requestId)) {
                outboundWaiters.delete(requestId);
                rej(new Error("outbound timed out"));
              }
            }, 3000);
          }),
        waitForInbound: () =>
          new Promise((res) => {
            inboundWaiters.push(res);
          }),
        close: () =>
          new Promise((res) => {
            ws.once("close", () => res());
            ws.close();
          }),
      });
    });

    ws.on("message", (data) => {
      const chunk = data.toString();
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const frame = JSON.parse(line);

        if (frame.type === "descriptor") {
          const waiter = descriptorWaiters.shift();
          waiter?.(frame.descriptor);
        } else if (frame.type === "outbound_result") {
          const waiter = outboundWaiters.get(frame.requestId);
          if (waiter) {
            outboundWaiters.delete(frame.requestId);
            waiter(frame.result);
          }
        } else if (frame.type === "inbound") {
          const waiter = inboundWaiters.shift();
          waiter?.(frame as InboundFrame);
        }
      }
    });
  });
}

describe("relay integration", () => {
  let secretStore: InMemorySecretStore;
  let chatHub: ChatDeliveryHub;
  let sessionServer: RelaySessionServerImpl;
  let server: Awaited<ReturnType<typeof createRelayServer>>;

  beforeEach(async () => {
    secretStore = new InMemorySecretStore();
    chatHub = new ChatDeliveryHub();
    secretStore.register({
      gatewayId: GATEWAY_ID,
      instanceId: INSTANCE_ID,
      secrets: [SECRET],
    });

    sessionServer = new RelaySessionServerImpl({
      secretStore,
      chatHub,
      allowQueryToken: true,
    });

    server = await createRelayServer({
      host: "127.0.0.1",
      port: 0,
      relayPath: "/relay",
      sessionServer,
      chatHub,
      secretStore,
      internalToken: INTERNAL_TOKEN,
    });
  });

  afterEach(async () => {
    await server.close();
  });

  it("GET /health returns ok", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", service: "relay" });
  });

  it("rejects WebSocket upgrade with invalid secret", async () => {
    const badToken = makeUpgradeToken(GATEWAY_ID, "wrong-secret");
    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}/relay`, {
          headers: { Authorization: `Bearer ${badToken}` },
        });
        ws.on("open", () => reject(new Error("should not connect")));
        ws.on("error", () => resolve());
      }),
    ).resolves.toBeUndefined();
  });

  it("completes handshake with lanyard_web descriptor", async () => {
    const token = makeUpgradeToken(GATEWAY_ID, SECRET);
    const client = await createMockGateway(server.port, server.relayPath, token);

    client.ws.send(
      JSON.stringify({
        type: "hello",
        platform: LANYARD_WEB_PLATFORM,
        botId: "lanyard-web",
      }) + "\n",
    );

    const descriptor = await client.waitForDescriptor();
    expect(descriptor.platform).toBe(LANYARD_WEB_PLATFORM);
    expect(descriptor.contract_version).toBe(1);
    expect(descriptor.supports_edit).toBe(true);
    expect(descriptor.supports_draft_streaming).toBe(true);

    await client.close();
  });

  it("handles outbound send, edit, and typing", async () => {
    const token = makeUpgradeToken(GATEWAY_ID, SECRET);
    const client = await createMockGateway(server.port, server.relayPath, token);

    client.ws.send(
      JSON.stringify({
        type: "hello",
        platform: LANYARD_WEB_PLATFORM,
        botId: "lanyard-web",
      }) + "\n",
    );
    await client.waitForDescriptor();

    const sendResult = await client.sendOutbound({
      op: "send",
      chat_id: "chat-1",
      content: "Hello from gateway",
    });
    expect(sendResult.success).toBe(true);
    expect(sendResult.message_id).toBeTruthy();

    const editResult = await client.sendOutbound({
      op: "edit",
      chat_id: "chat-1",
      message_id: "msg-1",
      content: "Updated text",
    });
    expect(editResult.success).toBe(true);

    const typingResult = await client.sendOutbound({
      op: "typing",
      chat_id: "chat-1",
    });
    expect(typingResult.success).toBe(true);

    await client.close();
  });

  it("delivers inbound frames to connected gateway", async () => {
    const token = makeUpgradeToken(GATEWAY_ID, SECRET);
    const client = await createMockGateway(server.port, server.relayPath, token);

    client.ws.send(
      JSON.stringify({
        type: "hello",
        platform: LANYARD_WEB_PLATFORM,
        botId: "lanyard-web",
      }) + "\n",
    );
    await client.waitForDescriptor();

    const inboundPromise = client.waitForInbound();

    const event: MessageEvent = {
      text: "User message from portal",
      message_type: "text",
      source: {
        platform: LANYARD_WEB_PLATFORM,
        chat_id: "chat-1",
        chat_type: "dm",
        chat_name: "Test Chat",
        user_id: "user-1",
        user_name: "Test User",
        thread_id: null,
        chat_topic: null,
      },
    };

    const delivered = await sessionServer.deliverInbound(INSTANCE_ID, event);
    expect(delivered).toBe(true);

    const inbound = await inboundPromise;
    expect(inbound.type).toBe("inbound");
    expect(inbound.event.text).toBe("User message from portal");
    expect(inbound.event.source.platform).toBe(LANYARD_WEB_PLATFORM);

    await client.close();
  });

  it("delivers interrupt_inbound frames to the connected gateway", async () => {
    const token = makeUpgradeToken(GATEWAY_ID, SECRET);
    const client = await createMockGateway(server.port, server.relayPath, token);

    client.ws.send(
      JSON.stringify({
        type: "hello",
        platform: LANYARD_WEB_PLATFORM,
        botId: "lanyard-web",
      }) + "\n",
    );
    await client.waitForDescriptor();

    const interruptPromise = new Promise<Record<string, unknown>>((resolve) => {
      client.ws.on("message", (data) => {
        const line = data.toString().trim();
        if (!line) return;
        try {
          const frame = JSON.parse(line) as Record<string, unknown>;
          if (frame.type === "interrupt_inbound") {
            resolve(frame);
          }
        } catch {
          // ignore non-JSON
        }
      });
    });

    const delivered = await sessionServer.deliverInterruptInbound(
      INSTANCE_ID,
      "agent:main:lanyard_web:dm:chat-1",
      "chat-1",
    );
    expect(delivered).toBe(true);

    const frame = await interruptPromise;
    expect(frame).toEqual({
      type: "interrupt_inbound",
      session_key: "agent:main:lanyard_web:dm:chat-1",
      chat_id: "chat-1",
    });

    await client.close();
  });

  it("closes connected gateway with 4401 on revoke", async () => {
    const token = makeUpgradeToken(GATEWAY_ID, SECRET);
    const client = await createMockGateway(server.port, server.relayPath, token);

    client.ws.send(
      JSON.stringify({
        type: "hello",
        platform: LANYARD_WEB_PLATFORM,
        botId: "lanyard-web",
      }) + "\n",
    );
    await client.waitForDescriptor();

    const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      client.ws.once("close", (code, reason) => {
        resolve({ code, reason: reason.toString() });
      });
    });

    const result = await sessionServer.revokeInstance(INSTANCE_ID);
    expect(result).toMatchObject({
      instance_id: INSTANCE_ID,
      secret_revoked: true,
      sessions_closed: 1,
      close_code: RELAY_UNAUTHORIZED_CLOSE_CODE,
    });

    const closed = await closePromise;
    expect(closed.code).toBe(RELAY_UNAUTHORIZED_CLOSE_CODE);
    expect(closed.reason).toContain("revoked");

    const reToken = makeUpgradeToken(GATEWAY_ID, SECRET);
    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}/relay`, {
          headers: { Authorization: `Bearer ${reToken}` },
        });
        ws.on("open", () => reject(new Error("revoked secret should not connect")));
        ws.on("error", () => resolve());
      }),
    ).resolves.toBeUndefined();
  });

  it("POST /internal/instances/:id/revoke closes live WS with 4401 and rejects re-connect", async () => {
    const token = makeUpgradeToken(GATEWAY_ID, SECRET);
    const client = await createMockGateway(server.port, server.relayPath, token);

    client.ws.send(
      JSON.stringify({
        type: "hello",
        platform: LANYARD_WEB_PLATFORM,
        botId: "lanyard-web",
      }) + "\n",
    );
    await client.waitForDescriptor();
    expect(sessionServer.sessionCount()).toBe(1);

    const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      client.ws.once("close", (code, reason) => {
        resolve({ code, reason: reason.toString() });
      });
    });

    const res = await fetch(
      `http://127.0.0.1:${server.port}/internal/instances/${INSTANCE_ID}/revoke`,
      {
        method: "POST",
        headers: { [RELAY_INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      secret_revoked: boolean;
      sessions_closed: number;
      close_code: number;
    };
    expect(body).toMatchObject({
      ok: true,
      secret_revoked: true,
      sessions_closed: 1,
      close_code: RELAY_UNAUTHORIZED_CLOSE_CODE,
    });

    const closed = await closePromise;
    expect(closed.code).toBe(RELAY_UNAUTHORIZED_CLOSE_CODE);
    expect(closed.reason).toContain("revoked");
    expect(sessionServer.sessionCount()).toBe(0);
    expect(secretStore.getByInstanceId(INSTANCE_ID)?.revoked).toBe(true);

    const reToken = makeUpgradeToken(GATEWAY_ID, SECRET);
    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}/relay`, {
          headers: { Authorization: `Bearer ${reToken}` },
        });
        ws.on("open", () => reject(new Error("revoked secret should not connect")));
        ws.on("error", () => resolve());
      }),
    ).resolves.toBeUndefined();
  });

  it("POST /internal/instances/:id/revoke requires internal token", async () => {
    const missing = await fetch(
      `http://127.0.0.1:${server.port}/internal/instances/${INSTANCE_ID}/revoke`,
      { method: "POST" },
    );
    expect(missing.status).toBe(401);

    const wrong = await fetch(
      `http://127.0.0.1:${server.port}/internal/instances/${INSTANCE_ID}/revoke`,
      {
        method: "POST",
        headers: { [RELAY_INTERNAL_TOKEN_HEADER]: "not-the-token" },
      },
    );
    expect(wrong.status).toBe(401);
  });

  it("POST /internal/instances/:id/revoke returns 404 for unknown instance", async () => {
    const res = await fetch(
      `http://127.0.0.1:${server.port}/internal/instances/does-not-exist/revoke`,
      {
        method: "POST",
        headers: { [RELAY_INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN },
      },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("not found");
  });

  it("accepts token via query param when enabled", async () => {
    const token = makeUpgradeToken(GATEWAY_ID, SECRET);
    const ws = new WebSocket(
      `ws://127.0.0.1:${server.port}/relay?token=${encodeURIComponent(token)}`,
    );

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });

    ws.close();
  });

  it("POST /internal/brain-rpc fail-closed when gateway is not connected", async () => {
    const request: BrainRpcRequestFrame = {
      type: "brain_rpc_request",
      contract_version: BRAIN_RPC_CONTRACT_VERSION,
      request_id: "req_no_gw",
      method: "brain.ping",
      timeout_ms: 2_000,
      auth: {
        tenant_id: "ten_1",
        instance_id: INSTANCE_ID,
        subject: {
          portal_user_id: "usr_1",
          hermes_profile: "contributor",
          roles: ["contributor"],
          path_prefixes: ["/"],
        },
        session_id: "sess_1",
        issued_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      params: {},
      idempotency_key: null,
    };

    const res = await fetch(`http://127.0.0.1:${server.port}/internal/brain-rpc`, {
      method: "POST",
      headers: {
        [RELAY_INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        instance_id: INSTANCE_ID,
        tenant_id: "ten_1",
        request,
      }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.reason).toBe("not_connected");
  });

  it("POST /internal/brain-rpc round-trips brain.ping with mock gateway", async () => {
    const token = makeUpgradeToken(GATEWAY_ID, SECRET);
    const client = await createMockGateway(server.port, server.relayPath, token);

    client.ws.send(
      JSON.stringify({
        type: "hello",
        platform: LANYARD_WEB_PLATFORM,
        botId: "lanyard-web",
      }) + "\n",
    );
    await client.waitForDescriptor();

    // Auto-reply to brain_rpc_request
    client.ws.on("message", (data) => {
      const line = data.toString().trim();
      if (!line) return;
      try {
        const frame = JSON.parse(line) as Record<string, unknown>;
        if (frame.type === "brain_rpc_request") {
          client.ws.send(
            JSON.stringify({
              type: "brain_rpc_result",
              contract_version: BRAIN_RPC_CONTRACT_VERSION,
              request_id: frame.request_id,
              ok: true,
              result: {
                pong: true,
                echo: (frame.params as { echo?: string } | undefined)?.echo,
                contract_version: BRAIN_RPC_CONTRACT_VERSION,
              },
              error: null,
              meta: { duration_ms: 1 },
            }) + "\n",
          );
        }
      } catch {
        // ignore
      }
    });

    const request: BrainRpcRequestFrame = {
      type: "brain_rpc_request",
      contract_version: BRAIN_RPC_CONTRACT_VERSION,
      request_id: "req_ping_1",
      method: "brain.ping",
      timeout_ms: 5_000,
      auth: {
        tenant_id: "ten_1",
        instance_id: INSTANCE_ID,
        subject: {
          portal_user_id: "usr_1",
          hermes_profile: "contributor",
          roles: ["contributor"],
          path_prefixes: ["/Projects"],
        },
        session_id: "sess_1",
        issued_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      params: { echo: "relay" },
      idempotency_key: null,
    };

    const res = await fetch(`http://127.0.0.1:${server.port}/internal/brain-rpc`, {
      method: "POST",
      headers: {
        [RELAY_INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        instance_id: INSTANCE_ID,
        tenant_id: "ten_1",
        request,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      result: { ok: boolean; result: { pong: boolean; echo?: string } };
    };
    expect(body.ok).toBe(true);
    expect(body.result.ok).toBe(true);
    expect(body.result.result.pong).toBe(true);
    expect(body.result.result.echo).toBe("relay");

    await client.close();
  });

  it("POST /internal/brain-rpc requires internal token", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/internal/brain-rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instance_id: INSTANCE_ID, request: { type: "brain_rpc_request" } }),
    });
    expect(res.status).toBe(401);
  });
  it("rejects replay of the same upgrade bearer (G2a single-use jti)", async () => {
    const token = makeUpgradeToken(GATEWAY_ID, SECRET);
    const first = await createMockGateway(server.port, server.relayPath, token);
    expect(sessionServer.sessionCount()).toBe(1);

    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}/relay`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        ws.on("open", () => reject(new Error("replay should not connect")));
        ws.on("error", () => resolve());
      }),
    ).resolves.toBeUndefined();

    expect(sessionServer.authMetrics().upgrade_replay_rejected).toBeGreaterThanOrEqual(
      1,
    );
    await first.close();
  });

  it("allows legitimate reconnect with a fresh jti", async () => {
    const firstToken = makeUpgradeToken(GATEWAY_ID, SECRET);
    const first = await createMockGateway(
      server.port,
      server.relayPath,
      firstToken,
    );
    await first.close();

    // Wait for close handler to drop session map entry.
    await new Promise((r) => setTimeout(r, 20));

    const secondToken = makeUpgradeToken(GATEWAY_ID, SECRET);
    expect(secondToken).not.toBe(firstToken);
    const second = await createMockGateway(
      server.port,
      server.relayPath,
      secondToken,
    );
    expect(sessionServer.sessionCount()).toBe(1);
    await second.close();
  });

  it("session exclusivity: new connection replaces prior with 4401", async () => {
    const first = await createMockGateway(
      server.port,
      server.relayPath,
      makeUpgradeToken(GATEWAY_ID, SECRET),
    );

    const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      first.ws.once("close", (code, reason) => {
        resolve({ code, reason: reason.toString() });
      });
    });

    const second = await createMockGateway(
      server.port,
      server.relayPath,
      makeUpgradeToken(GATEWAY_ID, SECRET),
    );

    const closed = await closePromise;
    expect(closed.code).toBe(RELAY_UNAUTHORIZED_CLOSE_CODE);
    expect(closed.reason).toContain("replaced");
    expect(sessionServer.sessionCount()).toBe(1);

    await second.close();
  });

  it("production policy rejects legacy tokens and exp=0", async () => {
    // Rebuild session server with production fail-closed policy.
    await server.close();

    const { resolveRelayAuthPolicy } = await import("../src/relay-auth-policy.js");
    const authPolicy = resolveRelayAuthPolicy({ NODE_ENV: "production" });
    sessionServer = new RelaySessionServerImpl({
      secretStore,
      chatHub,
      allowQueryToken: false,
      authPolicy,
    });
    server = await createRelayServer({
      host: "127.0.0.1",
      port: 0,
      relayPath: "/relay",
      sessionServer,
      chatHub,
      secretStore,
      internalToken: INTERNAL_TOKEN,
    });

    const legacy = makeUpgradeToken(GATEWAY_ID, SECRET, {
      legacy: true,
      ttlSeconds: 60,
    });
    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}/relay`, {
          headers: { Authorization: `Bearer ${legacy}` },
        });
        ws.on("open", () => reject(new Error("legacy should fail in production")));
        ws.on("error", () => resolve());
      }),
    ).resolves.toBeUndefined();

    const nonExpiring = makeUpgradeToken(GATEWAY_ID, SECRET, { ttlSeconds: 0 });
    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}/relay`, {
          headers: { Authorization: `Bearer ${nonExpiring}` },
        });
        ws.on("open", () => reject(new Error("exp=0 should fail in production")));
        ws.on("error", () => resolve());
      }),
    ).resolves.toBeUndefined();

    // Stock pin path: jti mint connects under production (no host venv patch).
    const good = makeUpgradeToken(GATEWAY_ID, SECRET, { ttlSeconds: 60 });
    const client = await createMockGateway(server.port, server.relayPath, good);
    expect(sessionServer.authMetrics().upgrade_jti_accepted).toBeGreaterThanOrEqual(
      1,
    );
    await client.close();
  });

  it("dual-accept: production + RELAY_ALLOW_LEGACY accepts jti and legacy (lp-t7q.9)", async () => {
    await server.close();

    const { resolveRelayAuthPolicy } = await import("../src/relay-auth-policy.js");
    const authPolicy = resolveRelayAuthPolicy({
      NODE_ENV: "production",
      RELAY_ALLOW_LEGACY_UPGRADE_TOKEN: "1",
    });
    expect(authPolicy.requireJti).toBe(false);
    expect(authPolicy.rejectNonExpiring).toBe(true);

    sessionServer = new RelaySessionServerImpl({
      secretStore,
      chatHub,
      allowQueryToken: false,
      authPolicy,
    });
    server = await createRelayServer({
      host: "127.0.0.1",
      port: 0,
      relayPath: "/relay",
      sessionServer,
      chatHub,
      secretStore,
      internalToken: INTERNAL_TOKEN,
    });

    // Stock Hermes g7h3 mint (jti) — must connect without host legacy patch.
    const jtiToken = makeUpgradeToken(GATEWAY_ID, SECRET, { ttlSeconds: 60 });
    const jtiClient = await createMockGateway(
      server.port,
      server.relayPath,
      jtiToken,
    );
    expect(sessionServer.authMetrics().upgrade_jti_accepted).toBeGreaterThanOrEqual(
      1,
    );
    await jtiClient.close();
    await new Promise((r) => setTimeout(r, 20));

    // Legacy mint (host-patch / pre-jti pin) still accepted during dual-accept window.
    const legacyToken = makeUpgradeToken(GATEWAY_ID, SECRET, {
      legacy: true,
      ttlSeconds: 60,
    });
    const legacyClient = await createMockGateway(
      server.port,
      server.relayPath,
      legacyToken,
    );
    expect(
      sessionServer.authMetrics().upgrade_legacy_accepted,
    ).toBeGreaterThanOrEqual(1);
    await legacyClient.close();
  });

  it("dual-accept still rejects jti replay (single-use preserved)", async () => {
    await server.close();

    const { resolveRelayAuthPolicy } = await import("../src/relay-auth-policy.js");
    const authPolicy = resolveRelayAuthPolicy({
      NODE_ENV: "production",
      RELAY_ALLOW_LEGACY_UPGRADE_TOKEN: "1",
    });
    sessionServer = new RelaySessionServerImpl({
      secretStore,
      chatHub,
      allowQueryToken: false,
      authPolicy,
    });
    server = await createRelayServer({
      host: "127.0.0.1",
      port: 0,
      relayPath: "/relay",
      sessionServer,
      chatHub,
      secretStore,
      internalToken: INTERNAL_TOKEN,
    });

    const token = makeUpgradeToken(GATEWAY_ID, SECRET, { ttlSeconds: 60 });
    const first = await createMockGateway(server.port, server.relayPath, token);
    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}/relay`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        ws.on("open", () => reject(new Error("replay should not connect")));
        ws.on("error", () => resolve());
      }),
    ).resolves.toBeUndefined();
    expect(sessionServer.authMetrics().upgrade_replay_rejected).toBeGreaterThanOrEqual(
      1,
    );
    await first.close();
  });
});