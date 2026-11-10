/**
 * lp-u7z — SSE/event: Agent starting status during wake (fake CP / relay only).
 *
 * Acceptance:
 * - Client can observe starting state (agent_starting on events SSE)
 * - Success transitions to normal stream (agent_ready then relay proxy)
 * - Timeout maps to error event (ENSURE_ONLINE_TIMEOUT)
 */
import { describe, expect, it, vi } from "vitest";

import {
  AGENT_STARTING_MESSAGE,
  buildAgentReadyEvent,
  buildAgentStartingAcceptedBody,
  buildAgentStartingEvent,
  mapEnsureOnlineErrorToLiveEvent,
} from "../src/agent-starting-events.js";
import { createApp } from "../src/app.js";
import { ChatThreadStore } from "../src/chat-store.js";
import {
  ControlPlaneRequestError,
  type EnsureOnlineResponse,
  type InstancePresenceResponse,
  type InstancePresenceState,
} from "../src/control-plane-client.js";
import { ensureOnlineBeforeChatDeliver } from "../src/ensure-online-chat.js";
import { SessionStore } from "../src/session.js";
import { createThreadLiveEventsHub } from "../src/thread-live-events.js";
import type { TenantContext } from "../src/types.js";
import { cookieHeader, createTestBindings } from "./test-helpers.js";

const INSTANCE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function presence(
  overrides: Partial<InstancePresenceResponse> = {},
): InstancePresenceResponse {
  return {
    instance_id: INSTANCE_ID,
    tenant_id: "t1",
    presence: "offline",
    sandbox_id: null,
    runtime_kind: "daytona",
    agent_snapshot_id: "snap-1",
    s3_vault_prefix: "tenants/t1/vault/",
    last_activity_at: null,
    revoked_at: null,
    ...overrides,
  };
}

function ensureResponse(
  overrides: Partial<EnsureOnlineResponse> = {},
): EnsureOnlineResponse {
  return {
    instance_id: INSTANCE_ID,
    tenant_id: "t1",
    presence: "online",
    sandbox_id: "sbx-1",
    runtime_kind: "daytona",
    already_online: false,
    wake_joined: false,
    ...overrides,
  };
}

describe("agent starting event builders (lp-u7z)", () => {
  it("buildAgentStartingEvent carries user-visible copy", () => {
    const ev = buildAgentStartingEvent({
      instanceId: INSTANCE_ID,
      threadId: "thr-1",
      presence: "offline",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(ev).toEqual({
      type: "agent_starting",
      instance_id: INSTANCE_ID,
      thread_id: "thr-1",
      presence: "offline",
      message: AGENT_STARTING_MESSAGE,
      created_at: "2026-01-01T00:00:00.000Z",
    });
    expect(AGENT_STARTING_MESSAGE).toBe("Agent starting…");
  });

  it("buildAgentStartingAcceptedBody is the 202 chat POST contract (T4)", () => {
    expect(
      buildAgentStartingAcceptedBody({
        instanceId: INSTANCE_ID,
        threadId: "thr-1",
        presence: "waking",
      }),
    ).toEqual({
      ok: true,
      status: "agent_starting",
      thread_id: "thr-1",
      instance_id: INSTANCE_ID,
      presence: "waking",
      message: AGENT_STARTING_MESSAGE,
    });
  });

  it("mapEnsureOnlineErrorToLiveEvent maps 504 → ENSURE_ONLINE_TIMEOUT", () => {
    const ev = mapEnsureOnlineErrorToLiveEvent({
      error: new ControlPlaneRequestError(
        504,
        "ensure_online timed out",
        "ENSURE_ONLINE_TIMEOUT",
      ),
      instanceId: INSTANCE_ID,
      threadId: "thr-1",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(ev.type).toBe("error");
    expect(ev.code).toBe("ENSURE_ONLINE_TIMEOUT");
    expect(ev.status).toBe(504);
    expect(ev.message).toContain("timed out");
  });

  it("mapEnsureOnlineErrorToLiveEvent maps 502 → ENSURE_ONLINE_WAKE_FAILED", () => {
    const ev = mapEnsureOnlineErrorToLiveEvent({
      error: new ControlPlaneRequestError(502, "wake failed"),
      instanceId: INSTANCE_ID,
      threadId: "thr-1",
    });
    expect(ev.code).toBe("ENSURE_ONLINE_WAKE_FAILED");
    expect(ev.status).toBe(502);
  });

  it("hub delivers publish to subscribers", () => {
    const hub = createThreadLiveEventsHub();
    const seen: string[] = [];
    const unsub = hub.subscribe("thr-1", (ev) => {
      seen.push(ev.type);
    });
    hub.publish(
      "thr-1",
      buildAgentStartingEvent({
        instanceId: INSTANCE_ID,
        threadId: "thr-1",
        presence: "waking",
      }),
    );
    hub.publish(
      "thr-1",
      buildAgentReadyEvent({
        instanceId: INSTANCE_ID,
        threadId: "thr-1",
      }),
    );
    hub.publish("thr-other", buildAgentReadyEvent({
      instanceId: INSTANCE_ID,
      threadId: "thr-other",
    }));
    expect(seen).toEqual(["agent_starting", "agent_ready"]);
    unsub();
    expect(hub.listenerCount("thr-1")).toBe(0);
  });
});

describe("ensureOnline onStarting callback (lp-u7z)", () => {
  it("calls onStarting only when wake POST will run", async () => {
    const onStarting = vi.fn();
    const client = {
      getInstancePresence: vi.fn(async () => presence({ presence: "offline" })),
      ensureOnline: vi.fn(async () => ensureResponse()),
    };
    await ensureOnlineBeforeChatDeliver({
      enabled: true,
      authClient: client,
      instanceId: INSTANCE_ID,
      onStarting,
    });
    expect(onStarting).toHaveBeenCalledOnce();
    expect(onStarting).toHaveBeenCalledWith({
      instanceId: INSTANCE_ID,
      presence: "offline",
    });
    expect(client.ensureOnline).toHaveBeenCalledOnce();
  });

  it("does not call onStarting when already online", async () => {
    const onStarting = vi.fn();
    const client = {
      getInstancePresence: vi.fn(async () =>
        presence({ presence: "online", sandbox_id: "sbx" }),
      ),
      ensureOnline: vi.fn(async () => ensureResponse({ already_online: true })),
    };
    await ensureOnlineBeforeChatDeliver({
      enabled: true,
      authClient: client,
      instanceId: INSTANCE_ID,
      onStarting,
    });
    expect(onStarting).not.toHaveBeenCalled();
    expect(client.ensureOnline).not.toHaveBeenCalled();
  });

  it("does not call onStarting when flag off", async () => {
    const onStarting = vi.fn();
    const client = {
      getInstancePresence: vi.fn(),
      ensureOnline: vi.fn(),
    };
    await ensureOnlineBeforeChatDeliver({
      enabled: false,
      authClient: client,
      instanceId: INSTANCE_ID,
      onStarting,
    });
    expect(onStarting).not.toHaveBeenCalled();
    expect(client.getInstancePresence).not.toHaveBeenCalled();
  });
});

/**
 * End-to-end-ish: chat message POST publishes live events; events SSE observes
 * starting → ready → normal relay frames (or timeout error).
 */
describe("chat SSE agent starting during wake (lp-u7z acceptance)", () => {
  const tenant: TenantContext = {
    tenant_id: "tenant-u7z",
    tenant_slug: "demo",
    display_name: "Demo",
    host: "demo.withlanyard.com",
  };
  const userId = "user-u7z";

  async function boot(options: {
    presence: InstancePresenceState;
    ensureError?: ControlPlaneRequestError;
    /** Delay ensureOnline to let SSE subscribe first. */
    ensureDelayMs?: number;
    relayInitiallyDown?: boolean;
  }) {
    const hub = createThreadLiveEventsHub();
    const chatThreads = new ChatThreadStore();
    const thread = chatThreads.create({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      title: "Wake SSE",
    });
    const sessions = new SessionStore();
    const session = await sessions.create({
      userId,
      tenantId: tenant.tenant_id,
      email: "u7z@example.com",
    });

    let relayOpenCount = 0;
    const ensureOnline = vi.fn(async () => {
      if (options.ensureDelayMs) {
        await new Promise((r) => setTimeout(r, options.ensureDelayMs));
      }
      if (options.ensureError) throw options.ensureError;
      return ensureResponse({ already_online: false, wake_joined: false });
    });

    const authClient = {
      getUserRbac: async () => ({
        user_id: userId,
        tenant_id: tenant.tenant_id,
        hermes_profile: "default",
        allowed_path_prefixes: ["/"],
        role_names: ["member"],
      }),
      getPrimaryGatewayInstance: async () => ({ instance_id: INSTANCE_ID }),
      getInstancePresence: vi.fn(async () =>
        presence({ presence: options.presence }),
      ),
      ensureOnline,
      getActiveSessionShare: async () => null,
    };

    const relayClient = {
      deliverInbound: vi.fn(async () => ({ ok: true as const })),
      openChatEventStream: vi.fn(async () => {
        relayOpenCount += 1;
        // First open fails while cold; after wake (2nd+) succeeds with a frame.
        if (options.relayInitiallyDown && relayOpenCount === 1) {
          return new Response(null, { status: 502 });
        }
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "message_send",
                  chat_id: thread.thread_id,
                  message_id: "m-relay-1",
                  content: "hello from relay",
                })}\n\n`,
              ),
            );
            controller.close();
          },
        });
        return new Response(body, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }),
    };

    const app = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          sessions,
          chatThreads,
          ensureOnlineOnChat: true,
          threadLiveEvents: hub,
          authClient: authClient as never,
          relayClient: relayClient as never,
        },
      ),
    );

    const cookies = {
      lanyard_session: session.sessionId,
      lanyard_csrf: "test-csrf-u7z",
    };

    return {
      app,
      cookies,
      threadId: thread.thread_id,
      hub,
      ensureOnline,
      relayClient,
      getRelayOpenCount: () => relayOpenCount,
    };
  }

  async function collectSse(
    res: Response,
    opts?: { maxMs?: number; stopAfterTypes?: string[] },
  ): Promise<Array<{ event?: string; data: string }>> {
    if (!res.body) throw new Error("no body");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const events: Array<{ event?: string; data: string }> = [];
    const deadline = Date.now() + (opts?.maxMs ?? 5_000);
    const stop = new Set(opts?.stopAfterTypes ?? []);

    try {
      while (Date.now() < deadline) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          if (!chunk.trim()) continue;
          let event: string | undefined;
          let data = "";
          for (const line of chunk.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            if (line.startsWith("data:")) data = line.slice(5).trim();
          }
          if (data) {
            events.push({ event, data });
            try {
              const parsed = JSON.parse(data) as {
                type?: string;
                code?: string;
              };
              if (parsed.type && stop.has(parsed.type)) {
                return events;
              }
              if (parsed.code && stop.has(parsed.code)) {
                return events;
              }
              if (event && stop.has(event)) {
                return events;
              }
            } catch {
              /* ignore */
            }
          }
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }
    return events;
  }

  async function waitForHubListener(
    hub: ReturnType<typeof createThreadLiveEventsHub>,
    threadId: string,
    maxMs = 2_000,
  ): Promise<void> {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      if (hub.listenerCount(threadId) > 0) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`hub listener for ${threadId} not attached within ${maxMs}ms`);
  }

  it("Client can observe starting state on events SSE during wake", async () => {
    const ctx = await boot({
      presence: "offline",
      ensureDelayMs: 80,
      relayInitiallyDown: true,
    });

    const sseResP = ctx.app.request(
      `/api/chat/threads/${ctx.threadId}/events`,
      {
        headers: {
          host: tenant.host,
          cookie: cookieHeader(ctx.cookies),
          accept: "text/event-stream",
        },
      },
    );

    // Wait until events handler subscribed to the live hub (not a fixed sleep).
    await waitForHubListener(ctx.hub, ctx.threadId);

    const postRes = await ctx.app.request(
      `/api/chat/threads/${ctx.threadId}/messages`,
      {
        method: "POST",
        headers: {
          host: tenant.host,
          "content-type": "application/json",
          cookie: cookieHeader(ctx.cookies),
          "x-csrf-token": ctx.cookies.lanyard_csrf,
        },
        body: JSON.stringify({ text: "wake me" }),
      },
    );
    expect(postRes.status).toBe(202);
    expect(await postRes.json()).toMatchObject({
      ok: true,
      status: "agent_starting",
      thread_id: ctx.threadId,
    });

    const sseRes = await sseResP;
    expect(sseRes.status).toBe(200);
    const events = await collectSse(sseRes, {
      maxMs: 3_000,
      stopAfterTypes: ["message_send"],
    });

    const types = events.map((e) => {
      try {
        return (JSON.parse(e.data) as { type?: string }).type ?? e.event;
      } catch {
        return e.event;
      }
    });

    expect(types).toContain("agent_starting");
    expect(types).toContain("agent_ready");
    expect(types).toContain("message_send");
    // starting before ready before normal stream
    const iStart = types.indexOf("agent_starting");
    const iReady = types.indexOf("agent_ready");
    const iMsg = types.indexOf("message_send");
    expect(iStart).toBeGreaterThanOrEqual(0);
    expect(iReady).toBeGreaterThan(iStart);
    expect(iMsg).toBeGreaterThan(iReady);
    expect(ctx.ensureOnline).toHaveBeenCalledOnce();
    expect(ctx.getRelayOpenCount()).toBeGreaterThanOrEqual(2);
  });

  it("Timeout maps to error event with ENSURE_ONLINE_TIMEOUT", async () => {
    const ctx = await boot({
      presence: "offline",
      ensureDelayMs: 40,
      ensureError: new ControlPlaneRequestError(
        504,
        "ensure_online wait timed out",
        "ENSURE_ONLINE_TIMEOUT",
      ),
      relayInitiallyDown: true,
    });

    const sseResP = ctx.app.request(
      `/api/chat/threads/${ctx.threadId}/events`,
      {
        headers: {
          host: tenant.host,
          cookie: cookieHeader(ctx.cookies),
          accept: "text/event-stream",
        },
      },
    );
    await waitForHubListener(ctx.hub, ctx.threadId);

    const postRes = await ctx.app.request(
      `/api/chat/threads/${ctx.threadId}/messages`,
      {
        method: "POST",
        headers: {
          host: tenant.host,
          "content-type": "application/json",
          cookie: cookieHeader(ctx.cookies),
          "x-csrf-token": ctx.cookies.lanyard_csrf,
        },
        body: JSON.stringify({ text: "will timeout" }),
      },
    );
    expect(postRes.status).toBe(202);
    expect(ctx.relayClient.deliverInbound).not.toHaveBeenCalled();

    const sseRes = await sseResP;
    const events = await collectSse(sseRes, {
      maxMs: 2_000,
      stopAfterTypes: ["ENSURE_ONLINE_TIMEOUT"],
    });

    const parsed = events.map((e) => {
      try {
        return JSON.parse(e.data) as {
          type?: string;
          code?: string;
          status?: number;
          error?: string;
        };
      } catch {
        return null;
      }
    });

    const errorEv = parsed.find(
      (e) => e?.type === "error" && e.code === "ENSURE_ONLINE_TIMEOUT",
    );

    expect(errorEv).toBeTruthy();
    expect(errorEv?.status).toBe(504);
    expect(ctx.relayClient.deliverInbound).not.toHaveBeenCalled();
  });

  it("online skip: no agent_starting; normal relay stream only", async () => {
    const ctx = await boot({
      presence: "online",
      relayInitiallyDown: false,
    });

    const published: string[] = [];
    ctx.hub.subscribe(ctx.threadId, (ev) => {
      published.push(ev.type);
    });

    const postRes = await ctx.app.request(
      `/api/chat/threads/${ctx.threadId}/messages`,
      {
        method: "POST",
        headers: {
          host: tenant.host,
          "content-type": "application/json",
          cookie: cookieHeader(ctx.cookies),
          "x-csrf-token": ctx.cookies.lanyard_csrf,
        },
        body: JSON.stringify({ text: "already warm" }),
      },
    );
    expect(postRes.status).toBe(200);
    expect(ctx.ensureOnline).not.toHaveBeenCalled();
    expect(published).toEqual([]);

    const sseRes = await ctx.app.request(
      `/api/chat/threads/${ctx.threadId}/events`,
      {
        headers: {
          host: tenant.host,
          cookie: cookieHeader(ctx.cookies),
          accept: "text/event-stream",
        },
      },
    );
    const events = await collectSse(sseRes, {
      maxMs: 2_000,
      stopAfterTypes: ["message_send"],
    });
    const types = events.map((e) => {
      try {
        return (JSON.parse(e.data) as { type?: string }).type;
      } catch {
        return e.event;
      }
    });
    expect(types).toContain("message_send");
    expect(types).not.toContain("agent_starting");
  });
});
