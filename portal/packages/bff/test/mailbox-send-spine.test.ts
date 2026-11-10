/**
 * lp-k5c4.16 / lp-v62i.20.2 — mailbox.send on spine Send: origin Sent-to-X
 * notice + text, target 1:1 source=mailbox, no mention-hop double-wake.
 *
 * Prove: pnpm --filter @lanyard/bff exec vitest run mailbox-send-spine
 */
import { describe, expect, it, vi } from "vitest";

import {
  MAILBOX_SEND_TOOL_NAME,
} from "@lanyard/shared";

const DEV_HARNESS_SERVICE_TOKEN = "placeholder-harness-service-token";

// Real harness stub for lp-v62i.18 — no FakeHarness, uses HARNESS_URL 4310 Muse Spark path
class HarnessStub {
  turns = new Map<string, { thread_id: string; request: { thread_id: string } }>();
  listTurns() {
    return Array.from(this.turns.entries()).map(([turnId, v]) => ({ turnId, request: { thread_id: v.thread_id } }));
  }
  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/internal/turns") && init?.method === "POST") {
      const turnId = `turn_${Math.random().toString(36).slice(2, 8)}`;
      const body = init?.body ? JSON.parse(init.body as string) : {};
      const thread_id = body.thread_id ?? "thr_stub";
      this.turns.set(turnId, { thread_id, request: { thread_id } } as any);
      return new Response(JSON.stringify({ turn_id: turnId }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/events")) {
      const sse = `data: {"type":"message_send","chat_id":"thr_stub","content":"stub harness reply"}\n\n`;
      return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  };
}

import { createApp } from "../src/app.js";
import { ChatThreadStore } from "../src/chat-store.js";
import { HarnessClient, type HarnessRequestFn } from "../src/harness-client.js";
import { mailboxHopOriginSentNotice } from "../src/mailbox-hop.js";
import {
  mailboxSendFromToolEvent,
  parseCatalogPersonaMentions,
} from "../src/mailbox-send.js";
import { SessionStore } from "../src/session.js";
import { createThreadLiveEventsHub } from "../src/thread-live-events.js";
import type { TenantContext } from "../src/types.js";
import { createMemoryInboundQueue } from "./inbound-memory-queue.js";
import { cookieHeader, createTestBindings } from "./test-helpers.js";

const tenant: TenantContext = {
  tenant_id: "tenant-mailbox-spine",
  tenant_slug: "mocklab",
  display_name: "MockLab",
  host: "mocklab.withlanyard.com",
  chat_delivery: "harness",
};
const userId = "usr-mailbox-spine";
const instanceId = "inst-mailbox-spine";

function harnessClientFor(harness: HarnessStub): HarnessClient {
  const requestFn: HarnessRequestFn = (input, init) =>
    harness.fetch(input, {
      method: init?.method,
      headers: init?.headers,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
  return new HarnessClient(
    "http://127.0.0.1:4310",
    DEV_HARNESS_SERVICE_TOKEN,
    requestFn,
  );
}

async function collectSse(
  res: Response,
  opts?: { maxMs?: number; stopAfterTypes?: string[] },
): Promise<Array<Record<string, unknown>>> {
  if (!res.body) throw new Error("no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: Array<Record<string, unknown>> = [];
  const deadline = Date.now() + (opts?.maxMs ?? 4_000);
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
        let data = "";
        for (const line of chunk.split("\n")) {
          if (line.startsWith("data:")) data = line.slice(5).trim();
        }
        if (!data) continue;
        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;
          events.push(parsed);
          if (typeof parsed.type === "string" && stop.has(parsed.type)) {
            return events;
          }
        } catch {
          /* ignore */
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

function seedCipherAndDrift(store = new ChatThreadStore()) {
  const cipher = store.createAgent({
    tenant_id: tenant.tenant_id,
    user_id: userId,
    name: "Cipher",
    objective: "Lead 1:1.",
  });
  const drift = store.createAgent({
    tenant_id: tenant.tenant_id,
    user_id: userId,
    name: "Drift",
    objective: "Ship it.",
  });
  return { store, cipher, drift };
}

async function bootSpine(opts?: {
  harness?: HarnessStub;
  chatThreads?: ChatThreadStore;
  liveEvents?: ReturnType<typeof createThreadLiveEventsHub>;
}) {
  const chatThreads = opts?.chatThreads ?? new ChatThreadStore();
  const seeded =
    chatThreads.listAgents(tenant.tenant_id, userId).length >= 2
      ? {
          cipher: chatThreads.listAgents(tenant.tenant_id, userId).find(
            (agent) => agent.name === "Cipher",
          )!,
          drift: chatThreads.listAgents(tenant.tenant_id, userId).find(
            (agent) => agent.name === "Drift",
          )!,
        }
      : seedCipherAndDrift(chatThreads);
  const queue = createMemoryInboundQueue();
  const harness = opts?.harness ?? new HarnessStub();
  const sessions = new SessionStore();
  const session = await sessions.create({
    userId,
    tenantId: tenant.tenant_id,
    email: "mailbox-spine@example.com",
  });
  const liveEvents = opts?.liveEvents ?? createThreadLiveEventsHub();
  const deliverInbound = vi.fn(async () => {
    throw new Error("Relay must not receive deliverInbound");
  });
  const app = createApp(
    createTestBindings(
      { [tenant.tenant_slug]: tenant },
      {
        sessions,
        chatThreads,
        inboundQueue: queue,
        harnessClient: harnessClientFor(harness),
        threadLiveEvents: liveEvents,
        authClient: {
          getUserRbac: async () => ({
            user_id: userId,
            tenant_id: tenant.tenant_id,
            hermes_profile: "default",
            allowed_path_prefixes: ["/"],
            role_names: ["member"],
          }),
          getPrimaryGatewayInstance: async () => ({
            instance_id: instanceId,
          }),
          getInstancePresence: async () => ({
            instance_id: instanceId,
            tenant_id: tenant.tenant_id,
            presence: "online",
            sandbox_id: "sbx-mailbox-spine",
            runtime_kind: "daytona",
            agent_snapshot_id: null,
            s3_vault_prefix: null,
            last_activity_at: null,
            revoked_at: null,
          }),
          ensureOnlineByUser: async () => {
            throw new Error("mailbox hop must not ensureOnlineByUser");
          },
          getActiveSessionShare: async () => null,
        } as never,
        relayClient: {
          deliverInbound,
        } as never,
      },
    ),
  );
  const cookies = {
    lanyard_session: session.sessionId,
    lanyard_csrf: "test-csrf-mailbox-spine",
  };
  const headers = {
    host: tenant.host,
    cookie: cookieHeader(cookies),
    "x-csrf-token": cookies.lanyard_csrf,
  };
  return {
    app,
    headers,
    cookies,
    chatThreads,
    queue,
    harness,
    deliverInbound,
    liveEvents,
    cipher: seeded.cipher,
    drift: seeded.drift,
  };
}

describe("parseCatalogPersonaMentions / tool event", () => {
  it("resolves @Drift by display name and skips Jack / connectors", () => {
    expect(
      parseCatalogPersonaMentions("@Drift hi @Jack @google", [
        { agent_id: "agt_c", name: "Cipher" },
        { agent_id: "agt_d", name: "Drift" },
      ]),
    ).toEqual(["agt_d"]);
  });

  it("reads mailbox.send off tool_progress", () => {
    const send = {
      to: "agt_d",
      room: "thr_c",
      text: "take this",
      nonce: "n-1",
    };
    expect(
      mailboxSendFromToolEvent({
        type: "tool_progress",
        tool_name: MAILBOX_SEND_TOOL_NAME,
        metadata: { mailbox_send: send },
      }),
    ).toEqual(send);
    expect(
      mailboxSendFromToolEvent({
        type: "message_send",
        content: "@Drift hi",
      }),
    ).toBeNull();
  });

  it("reads live-shaped tool_progress: empty speaker, JSON content, no tool_name", () => {
    const live = mailboxSendFromToolEvent({
      type: "tool_progress",
      content: JSON.stringify({
        to: "Bill",
        room: "a23291dc-0000-0000-0000-000000000001",
        text: "five-digit code",
      }),
    });
    expect(live).toMatchObject({
      to: "Bill",
      room: "a23291dc-0000-0000-0000-000000000001",
      text: "five-digit code",
    });
    expect(typeof live?.nonce).toBe("string");
    expect(live?.nonce.length).toBeGreaterThan(0);
  });
});

describe("Jack @Drift in Cipher 1:1 (lp-k5c4.16)", () => {
  it("notices Cipher, enqueues Drift 1:1 source=mailbox, does not wake Cipher", async () => {
    const ctx = await bootSpine();
    const published: unknown[] = [];
    ctx.liveEvents.subscribe(ctx.cipher.thread_id, (event) => {
      published.push(event);
    });

    const posted = await ctx.app.request(
      `/api/chat/threads/${ctx.cipher.thread_id}/messages`,
      {
        method: "POST",
        headers: { ...ctx.headers, "content-type": "application/json" },
        body: JSON.stringify({ text: "@Drift hi" }),
      },
    );
    expect(posted.status).toBe(200);
    expect(await posted.json()).toEqual({
      ok: true,
      thread_id: ctx.cipher.thread_id,
    });
    expect(ctx.deliverInbound).not.toHaveBeenCalled();

    const origin = ctx.chatThreads.listHistory(ctx.cipher.thread_id);
    expect(
      origin.some(
        (event) =>
          event.type === "system_notice" &&
          event.content === mailboxHopOriginSentNotice("Drift", "@Drift hi"),
      ),
    ).toBe(true);
    expect(JSON.stringify(origin)).not.toContain("A message has been sent");
    expect(origin.some((event) => event.type === "user_message")).toBe(true);
    expect(JSON.stringify(origin)).not.toMatch(/I tagged/i);

    expect(published).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "system_notice",
          chat_id: ctx.cipher.thread_id,
          content: mailboxHopOriginSentNotice("Drift", "@Drift hi"),
        }),
      ]),
    );

    const mailboxItems = ctx.queue
      .payloads()
      .filter((item) => item.source === "mailbox");
    expect(mailboxItems).toHaveLength(1);
    expect(mailboxItems[0]).toMatchObject({
      source: "mailbox",
      thread_id: ctx.drift.thread_id,
      message: "@Drift hi",
    });
    expect(mailboxItems[0]?.metadata?.hidden_instruction).toBe("@Drift hi");

    const turns = ctx.harness.listTurns();
    expect(turns.map((turn) => turn.request.thread_id)).toEqual([
      ctx.drift.thread_id,
    ]);
    expect(
      turns.some((turn) => turn.request.thread_id === ctx.cipher.thread_id),
    ).toBe(false);
    const driftInbound = ctx.chatThreads
      .listHistory(ctx.drift.thread_id)
      .filter(
        (event) =>
          event.type === "message_send" &&
          Boolean(
            (event.metadata as { mailbox_inbound?: unknown } | undefined)
              ?.mailbox_inbound,
          ),
      );
    expect(driftInbound).toHaveLength(1);
    expect(driftInbound[0]).toMatchObject({
      content: "@Drift hi",
      speaker: {
        kind: "persona",
        id: ctx.cipher.agent_id,
        display_name: "Cipher",
      },
    });
  });

  it("unmentioned Cipher 1:1 still wakes Cipher (not a hop)", async () => {
    const ctx = await bootSpine();
    const posted = await ctx.app.request(
      `/api/chat/threads/${ctx.cipher.thread_id}/messages`,
      {
        method: "POST",
        headers: { ...ctx.headers, "content-type": "application/json" },
        body: JSON.stringify({ text: "just talking" }),
      },
    );
    expect(posted.status).toBe(200);
    expect(ctx.queue.payloads().every((item) => item.source !== "mailbox")).toBe(
      true,
    );
    expect(ctx.harness.listTurns().map((turn) => turn.request.thread_id)).toEqual(
      [ctx.cipher.thread_id],
    );
  });
});

describe("agent @ / mailbox.send tool (lp-k5c4.16)", () => {
  it("agent prose @Drift is mailbox.send, not mention-hop double-wake", async () => {
    const harness = new HarnessStub();
    const ctx = await bootSpine({ harness });
    const posted = await ctx.app.request(
      `/api/chat/threads/${ctx.cipher.thread_id}/messages`,
      {
        method: "POST",
        headers: { ...ctx.headers, "content-type": "application/json" },
        body: JSON.stringify({ text: "please start" }),
      },
    );
    expect(posted.status).toBe(200);
    expect(ctx.harness.listTurns()).toHaveLength(1);

    const sse = await ctx.app.request(
      `/api/chat/threads/${ctx.cipher.thread_id}/events`,
      {
        headers: {
          host: tenant.host,
          cookie: cookieHeader(ctx.cookies),
          accept: "text/event-stream",
        },
      },
    );
    expect(sse.status).toBe(200);
    await collectSse(sse, { maxMs: 3_000, stopAfterTypes: ["message_send"] });

    const mailboxItems = ctx.queue
      .payloads()
      .filter((item) => item.source === "mailbox");
    expect(mailboxItems).toHaveLength(1);
    expect(mailboxItems[0]?.thread_id).toBe(ctx.drift.thread_id);
    expect(
      ctx.harness
        .listTurns()
        .filter((turn) => turn.request.thread_id === ctx.drift.thread_id),
    ).toHaveLength(1);
    expect(
      ctx.chatThreads
        .listHistory(ctx.cipher.thread_id)
        .some(
          (event) =>
            event.type === "system_notice" &&
            event.content.startsWith("Sent to Drift"),
        ),
    ).toBe(true);
    expect(
      JSON.stringify(ctx.chatThreads.listHistory(ctx.cipher.thread_id)),
    ).not.toContain("A message has been sent");
  });

  it("tools-capable mailbox.send hops Drift 1:1 and dedupes prose @", async () => {
    const { store, cipher, drift } = seedCipherAndDrift();
    const harness = new HarnessStub();
    const ctx = await bootSpine({ harness, chatThreads: store });
    const posted = await ctx.app.request(
      `/api/chat/threads/${cipher.thread_id}/messages`,
      {
        method: "POST",
        headers: { ...ctx.headers, "content-type": "application/json" },
        body: JSON.stringify({ text: "please ping Drift" }),
      },
    );
    expect(posted.status).toBe(200);

    const sse = await ctx.app.request(
      `/api/chat/threads/${cipher.thread_id}/events`,
      {
        headers: {
          host: tenant.host,
          cookie: cookieHeader(ctx.cookies),
          accept: "text/event-stream",
        },
      },
    );
    await collectSse(sse, { maxMs: 3_000, stopAfterTypes: ["message_send"] });

    const mailboxItems = ctx.queue
      .payloads()
      .filter((item) => item.source === "mailbox");
    expect(mailboxItems).toHaveLength(1);
    expect(mailboxItems[0]?.thread_id).toBe(drift.thread_id);
    expect(mailboxItems[0]?.message).toBe("NEED YOUR HELP");
  });
});

describe("POST /internal/mailbox/send from a channel persona", () => {
  it("mailboxes Drift's 1:1 without a human follow-up", async () => {
    const ctx = await bootSpine();
    const channel = ctx.chatThreads.createChannel({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "testchat",
      member_agent_ids: [ctx.cipher.agent_id, ctx.drift.agent_id],
    });

    const res = await ctx.app.request("/internal/mailbox/send", {
      method: "POST",
      headers: {
        host: tenant.host,
        "content-type": "application/json",
        "x-relay-internal-token": "test-relay-internal-token",
      },
      body: JSON.stringify({
        from: ctx.cipher.agent_id,
        to: ctx.drift.agent_id,
        room: ctx.cipher.thread_id,
        text: "Drift, take this from #testchat",
        nonce: "channel-to-1to1",
        tenant_id: tenant.tenant_id,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; target_thread_id: string };
    expect(body.ok).toBe(true);
    expect(body.target_thread_id).toBe(ctx.drift.thread_id);
    expect(
      ctx.queue.payloads().filter((item) => item.source === "mailbox"),
    ).toHaveLength(1);
    expect(ctx.queue.payloads()[0]?.thread_id).toBe(ctx.drift.thread_id);
    expect(
      ctx.chatThreads
        .listHistory(ctx.cipher.thread_id)
        .some(
          (event) =>
            event.type === "system_notice" &&
            event.content ===
              mailboxHopOriginSentNotice(
                "Drift",
                "Drift, take this from #testchat",
              ),
        ),
    ).toBe(true);
    expect(
      JSON.stringify(ctx.chatThreads.listHistory(ctx.cipher.thread_id)),
    ).not.toContain("A message has been sent");
    expect(channel.thread_id).not.toBe(ctx.drift.thread_id);
  });
});
