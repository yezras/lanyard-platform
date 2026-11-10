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
  type CapabilityDescriptor,
  type InboundFrame,
  type MessageEvent,
  type OutboundResultFrame,
} from "@lanyard/shared";

import { ChatDeliveryHub } from "../src/chat-delivery-hub.js";
import { makeUpgradeToken } from "../src/auth.js";
import { RELAY_INTERNAL_TOKEN_HEADER } from "../src/internal-http.js";
import { RelaySessionServerImpl } from "../src/relay-session-server.js";
import { createRelayServer } from "../src/server.js";
import { InMemorySecretStore } from "../src/secret-store.js";

const GATEWAY_ID = "gw-chat-001";
const INSTANCE_ID = "inst-chat-001";
const SECRET = "chat-relay-secret";
const INTERNAL_TOKEN = "chat-internal-token";
const CHAT_ID = "thread-chat-e2e";

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

async function readSseEvent(
  response: Response,
  timeoutMs = 5000,
): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("missing SSE body");

  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + timeoutMs;

  try {
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice("data:".length).trim();
        if (!payload) continue;
        return JSON.parse(payload) as Record<string, unknown>;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  throw new Error("timed out waiting for SSE event");
}

describe("chat platform integration", () => {
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
      tenantId: "tenant-chat-001",
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
  }, 15_000);

  it("deliver-inbound reaches mock gateway and outbound send publishes to SSE hub", async () => {
    const token = makeUpgradeToken(GATEWAY_ID, SECRET);
    const gateway = await createMockGateway(server.port, server.relayPath, token);

    gateway.ws.send(
      JSON.stringify({
        type: "hello",
        platform: LANYARD_WEB_PLATFORM,
        botId: "lanyard-web",
      }) + "\n",
    );
    await gateway.waitForDescriptor();

    const sseResponse = await fetch(
      `http://127.0.0.1:${server.port}/internal/chat/${encodeURIComponent(CHAT_ID)}/events`,
      {
        headers: {
          [RELAY_INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN,
          accept: "text/event-stream",
        },
      },
    );
    expect(sseResponse.ok).toBe(true);

    const inboundPromise = gateway.waitForInbound();
    const event: MessageEvent = {
      text: "hello brain",
      message_type: "text",
      source: {
        platform: LANYARD_WEB_PLATFORM,
        chat_id: CHAT_ID,
        chat_type: "dm",
        chat_name: "E2E",
        user_id: "user-1",
        user_name: "Tester",
        thread_id: null,
        chat_topic: null,
      },
    };

    const deliverRes = await fetch(
      `http://127.0.0.1:${server.port}/internal/deliver-inbound`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [RELAY_INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN,
        },
        body: JSON.stringify({
          instance_id: INSTANCE_ID,
          tenant_id: "tenant-chat-001",
          event,
        }),
      },
    );
    expect(deliverRes.status).toBe(200);

    const inbound = await inboundPromise;
    expect(inbound.event.text).toBe("hello brain");

    const sendPromise = gateway.sendOutbound({
      op: "send",
      chat_id: CHAT_ID,
      content: "# Hello\n\nStreaming **markdown** reply.",
    });
    const ssePromise = readSseEvent(sseResponse);

    const [sendResult, sseEvent] = await Promise.all([sendPromise, ssePromise]);
    expect(sendResult.success).toBe(true);
    expect(sseEvent.type).toBe("message_send");
    expect(sseEvent.content).toContain("markdown");

    await gateway.close();
  });

  it("publishes tool_progress from metadata.portal_event convention", async () => {
    const token = makeUpgradeToken(GATEWAY_ID, SECRET);
    const gateway = await createMockGateway(server.port, server.relayPath, token);

    gateway.ws.send(
      JSON.stringify({
        type: "hello",
        platform: LANYARD_WEB_PLATFORM,
        botId: "lanyard-web",
      }) + "\n",
    );
    await gateway.waitForDescriptor();

    const sseResponse = await fetch(
      `http://127.0.0.1:${server.port}/internal/chat/${encodeURIComponent(CHAT_ID)}/events`,
      {
        headers: {
          [RELAY_INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN,
          accept: "text/event-stream",
        },
      },
    );

    const sendPromise = gateway.sendOutbound({
      op: "send",
      chat_id: CHAT_ID,
      content: "searching vault",
      metadata: {
        portal_event: "tool_progress",
        tool_label: "Searching vault index",
      },
    });
    const ssePromise = readSseEvent(sseResponse);

    const [, sseEvent] = await Promise.all([sendPromise, ssePromise]);
    expect(sseEvent.type).toBe("tool_progress");
    expect(sseEvent.tool_label).toBe("Searching vault index");

    await gateway.close();
  });

  it("round-trips MCQ outbound metadata and selection inbound", async () => {
    const token = makeUpgradeToken(GATEWAY_ID, SECRET);
    const gateway = await createMockGateway(server.port, server.relayPath, token);

    gateway.ws.send(
      JSON.stringify({
        type: "hello",
        platform: LANYARD_WEB_PLATFORM,
        botId: "lanyard-web",
      }) + "\n",
    );
    await gateway.waitForDescriptor();

    const sseResponse = await fetch(
      `http://127.0.0.1:${server.port}/internal/chat/${encodeURIComponent(CHAT_ID)}/events`,
      {
        headers: {
          [RELAY_INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN,
          accept: "text/event-stream",
        },
      },
    );

    const sendPromise = gateway.sendOutbound({
      op: "send",
      chat_id: CHAT_ID,
      content: "Which lane?",
      metadata: {
        portal_event: "mcq",
        mcq_id: "lane-pick-001",
        choices: [
          { id: "fast", label: "Fast lane" },
          { id: "safe", label: "Safe lane" },
        ],
      },
    });
    const ssePromise = readSseEvent(sseResponse);

    const [sendResult, sseEvent] = await Promise.all([sendPromise, ssePromise]);
    expect(sendResult.success).toBe(true);
    expect(sseEvent.type).toBe("mcq");
    expect(sseEvent.mcq_id).toBe("lane-pick-001");
    expect(sseEvent.content).toBe("Which lane?");
    expect(sseEvent.choices).toEqual([
      { id: "fast", label: "Fast lane" },
      { id: "safe", label: "Safe lane" },
    ]);

    const inboundPromise = gateway.waitForInbound();
    const selectionEvent: MessageEvent = {
      text: "Safe lane",
      message_type: "mcq_selection",
      reply_to_message_id: sendResult.message_id,
      metadata: {
        portal_inbound: "mcq_selection",
        mcq_id: "lane-pick-001",
        choice_id: "safe",
        choice_label: "Safe lane",
      },
      source: {
        platform: LANYARD_WEB_PLATFORM,
        chat_id: CHAT_ID,
        chat_type: "dm",
        chat_name: "E2E",
        user_id: "user-1",
        user_name: "Tester",
        thread_id: null,
        chat_topic: null,
      },
    };

    const deliverRes = await fetch(
      `http://127.0.0.1:${server.port}/internal/deliver-inbound`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [RELAY_INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN,
        },
        body: JSON.stringify({
          instance_id: INSTANCE_ID,
          tenant_id: "tenant-chat-001",
          event: selectionEvent,
        }),
      },
    );
    expect(deliverRes.status).toBe(200);

    const inbound = await inboundPromise;
    expect(inbound.event.text).toBe("Safe lane");
    expect(inbound.event.message_type).toBe("mcq_selection");
    expect(inbound.event.metadata).toEqual({
      portal_inbound: "mcq_selection",
      mcq_id: "lane-pick-001",
      choice_id: "safe",
      choice_label: "Safe lane",
    });

    await gateway.close();
  });

  it("channel mailbox send serializes as message_send with speaker, not a mailbox_* SSE type", async () => {
    const token = makeUpgradeToken(GATEWAY_ID, SECRET);
    const gateway = await createMockGateway(
      server.port,
      server.relayPath,
      token,
    );

    gateway.ws.send(
      JSON.stringify({
        type: "hello",
        platform: LANYARD_WEB_PLATFORM,
        botId: "lanyard-web",
      }) + "\n",
    );
    await gateway.waitForDescriptor();

    const sseResponse = await fetch(
      `http://127.0.0.1:${server.port}/internal/chat/${encodeURIComponent(CHAT_ID)}/events`,
      {
        headers: {
          [RELAY_INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN,
          accept: "text/event-stream",
        },
      },
    );
    expect(sseResponse.ok).toBe(true);

    const speaker = {
      kind: "persona",
      id: "bill",
      display_name: "Bill",
    };
    const sendPromise = gateway.sendOutbound({
      op: "send",
      chat_id: CHAT_ID,
      content: "Fizz, take the workshop notes.",
      metadata: {
        speaker,
        persona: { persona_id: "bill", display_name: "Bill" },
      },
    });
    const ssePromise = readSseEvent(sseResponse);

    const [sendResult, sseEvent] = await Promise.all([sendPromise, ssePromise]);
    expect(sendResult.success).toBe(true);
    expect(sseEvent.type).toBe("message_send");
    expect(String(sseEvent.type).startsWith("mailbox_")).toBe(false);
    expect(sseEvent.content).toBe("Fizz, take the workshop notes.");
    expect(sseEvent.speaker).toEqual(speaker);

    await gateway.close();
  });
});