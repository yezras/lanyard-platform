/**
 * lac-bx3 P8 — BFF wake stamp on deliver-inbound (D1–D3).
 *
 * Prove: pnpm -C portal/packages/bff exec vitest run chat-deliver-inbound.group
 */
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { ChatThreadStore } from "../src/chat-store.js";
import { SessionStore } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import { cookieHeader, createTestBindings } from "./test-helpers.js";

const tenant: TenantContext = {
  tenant_id: "tenant-group-deliver",
  tenant_slug: "demo",
  display_name: "Demo",
  host: "demo.withlanyard.com",
};
const userId = "usr_alice";
const instanceId = "inst-group-deliver";

const owner = {
  kind: "human" as const,
  user_id: userId,
  display_name: "Alice",
};
const skip = {
  kind: "persona" as const,
  persona_id: "skip",
  display_name: "Skip",
};
const lev = {
  kind: "persona" as const,
  persona_id: "lev",
  display_name: "Lev",
};
const bana = {
  kind: "persona" as const,
  persona_id: "bana",
  display_name: "Bana",
};

async function boot(options: {
  kind: "chat" | "group";
  sseBody?: string;
} = { kind: "group" }) {
  const chatThreads = new ChatThreadStore();
  const thread =
    options.kind === "group"
      ? chatThreads.create({
          tenant_id: tenant.tenant_id,
          user_id: userId,
          title: "Review room",
          kind: "group",
          orchestrator_persona_id: "skip",
          participants: [owner, skip, lev, bana],
        })
      : chatThreads.create({
          tenant_id: tenant.tenant_id,
          user_id: userId,
          title: "1:1",
        });
  const sessions = new SessionStore();
  const session = await sessions.create({
    userId,
    tenantId: tenant.tenant_id,
    email: "alice@example.com",
  });
  const deliverInbound = vi.fn(async () => ({ ok: true as const }));
  const encoder = new TextEncoder();
  const openChatEventStream = vi.fn(async () => {
    const payload =
      options.sseBody ??
      `data: ${JSON.stringify({
        type: "message_send",
        chat_id: thread.thread_id,
        message_id: "msg-skip-1",
        content: "I'll take the first pass.",
        metadata: {
          persona_id: "skip",
          wake_reason: "orchestrator",
          speaker: {
            kind: "persona",
            id: "skip",
            display_name: "Skip",
          },
        },
      })}\n\n`;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(payload));
        controller.close();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  });
  const app = createApp(
    createTestBindings(
      { [tenant.tenant_slug]: tenant },
      {
        sessions,
        chatThreads,
        authClient: {
          getUserRbac: async () => ({
            user_id: userId,
            tenant_id: tenant.tenant_id,
            hermes_profile: "default",
            allowed_path_prefixes: ["/"],
            role_names: ["member"],
          }),
          getPrimaryGatewayInstance: async () => ({ instance_id: instanceId }),
          getActiveSessionShare: async () => null,
          listSessionSharesForGrantee: async () => [],
        } as never,
        relayClient: {
          deliverInbound,
          openChatEventStream,
        } as never,
      },
    ),
  );
  const cookies = {
    lanyard_session: session.sessionId,
    lanyard_csrf: "test-csrf-group-deliver",
  };
  return { app, chatThreads, thread, cookies, deliverInbound };
}

async function postMessage(
  app: ReturnType<typeof createApp>,
  threadId: string,
  cookies: Record<string, string>,
  text: string,
) {
  return app.request(`/api/chat/threads/${threadId}/messages`, {
    method: "POST",
    headers: {
      host: tenant.host,
      "content-type": "application/json",
      cookie: cookieHeader(cookies),
      "x-csrf-token": cookies.lanyard_csrf,
    },
    body: JSON.stringify({ text }),
  });
}

function inboundMetadata(
  deliverInbound: ReturnType<typeof vi.fn>,
): Record<string, unknown> | undefined {
  const event = deliverInbound.mock.calls[0]?.[0]?.event as
    | { metadata?: Record<string, unknown> }
    | undefined;
  return event?.metadata;
}

async function collectSse(
  res: Response,
  opts?: { maxMs?: number; stopAfterTypes?: string[] },
): Promise<void> {
  if (!res.body) throw new Error("no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + (opts?.maxMs ?? 3_000);
  const stop = new Set(opts?.stopAfterTypes ?? ["message_send"]);
  try {
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if ([...stop].some((type) => buffer.includes(`"type":"${type}"`))) {
        return;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
}

describe("POST /chat/threads/:id/messages group wake stamp (lac-bx3.15 D1-D3)", () => {
  it("1:1 kind=chat does not stamp target_persona_ids", async () => {
    const ctx = await boot({ kind: "chat" });
    const res = await postMessage(
      ctx.app,
      ctx.thread.thread_id,
      ctx.cookies,
      "hello 1:1",
    );
    expect(res.status).toBe(200);
    expect(ctx.deliverInbound).toHaveBeenCalledOnce();
    const metadata = inboundMetadata(ctx.deliverInbound);
    expect(metadata?.target_persona_ids).toBeUndefined();
    expect(metadata?.target_persona_id).toBeUndefined();
    expect(metadata?.wake_reason).toBeUndefined();
    const history = ctx.chatThreads.listHistory(ctx.thread.thread_id);
    expect(history.some((event) => event.speaker !== undefined)).toBe(false);
  });

  it("lists group thread with participants for Portal roster (lac-bx3.16)", async () => {
    const ctx = await boot({ kind: "group" });
    const res = await ctx.app.request("/api/chat/threads", {
      headers: {
        host: tenant.host,
        cookie: cookieHeader(ctx.cookies),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      threads: Array<{
        thread_id: string;
        kind?: string;
        participants?: unknown;
        orchestrator_persona_id?: string | null;
      }>;
    };
    const row = body.threads.find(
      (thread) => thread.thread_id === ctx.thread.thread_id,
    );
    expect(row?.kind).toBe("group");
    expect(row?.orchestrator_persona_id).toBe("skip");
    expect(row?.participants).toEqual([owner, skip, lev, bana]);
  });

  it("D1: POST with no mention stamps target_persona_ids=[orchestrator]", async () => {
    const ctx = await boot({ kind: "group" });
    const res = await postMessage(
      ctx.app,
      ctx.thread.thread_id,
      ctx.cookies,
      "Please review the auth change.",
    );
    expect(res.status).toBe(200);
    expect(ctx.deliverInbound).toHaveBeenCalledOnce();
    const metadata = inboundMetadata(ctx.deliverInbound);
    expect(metadata?.target_persona_ids).toEqual(["skip"]);
    expect(metadata?.target_persona_id).toBe("skip");
    expect(metadata?.lead_persona_id).toBe("skip");
    expect(metadata?.wake_reason).toBe("orchestrator");
    expect(metadata?.mentioned_persona_ids).toEqual([]);
    const user = ctx.chatThreads
      .listHistory(ctx.thread.thread_id)
      .find((event) => event.type === "user_message");
    expect(user?.speaker).toEqual({
      kind: "human",
      id: userId,
      display_name: "Alice",
    });
  });

  it("D2: POST @Lev stamps [lev] (lead stays silent)", async () => {
    const ctx = await boot({ kind: "group" });
    const res = await postMessage(
      ctx.app,
      ctx.thread.thread_id,
      ctx.cookies,
      "@Lev please look",
    );
    expect(res.status).toBe(200);
    expect(ctx.deliverInbound).toHaveBeenCalledOnce();
    const metadata = inboundMetadata(ctx.deliverInbound);
    expect(metadata?.target_persona_ids).toEqual(["lev"]);
    expect(metadata?.target_persona_id).toBe("lev");
    expect(metadata?.lead_persona_id).toBe("skip");
    expect(metadata?.wake_reason).toBe("mention");
    expect(metadata?.mentioned_persona_ids).toEqual(["lev"]);
  });

  it("D3: agent outbound tees as that persona's speaker", async () => {
    const sseBody = `data: ${JSON.stringify({
      type: "message_send",
      chat_id: "pending",
      message_id: "msg-lev-1",
      content: "I'll take the first pass.",
      metadata: {
        persona_id: "lev",
        wake_reason: "mention",
        speaker: {
          kind: "persona",
          id: "lev",
          display_name: "Lev",
        },
      },
    })}\n\n`;
    const ctx = await boot({ kind: "group", sseBody });
    const posted = await postMessage(
      ctx.app,
      ctx.thread.thread_id,
      ctx.cookies,
      "@Lev please look",
    );
    expect(posted.status).toBe(200);

    const sseRes = await ctx.app.request(
      `/api/chat/threads/${ctx.thread.thread_id}/events`,
      {
        headers: {
          host: tenant.host,
          cookie: cookieHeader(ctx.cookies),
          accept: "text/event-stream",
        },
      },
    );
    expect(sseRes.status).toBe(200);
    await collectSse(sseRes);

    const outbound = ctx.chatThreads
      .listHistory(ctx.thread.thread_id)
      .find((event) => event.type === "message_send");
    expect(outbound?.speaker).toEqual({
      kind: "persona",
      id: "lev",
      display_name: "Lev",
    });
  });
});
