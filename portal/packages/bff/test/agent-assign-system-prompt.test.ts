/**
 * lp-lv9.4 — system_prompt store/PATCH/assign + inject on chat send.
 */
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { ChatThreadStore } from "../src/chat-store.js";
import { SessionStore } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import { cookieHeader, createTestBindings } from "./test-helpers.js";

const tenant: TenantContext = {
  tenant_id: "tenant-system-prompt",
  tenant_slug: "demo",
  display_name: "Demo",
  host: "demo.withlanyard.com",
};
const userId = "user-system-prompt";

async function boot(options?: {
  brainRpcEnabled?: boolean;
  invokeBrainRpc?: ReturnType<typeof vi.fn>;
  deliverInbound?: ReturnType<typeof vi.fn>;
}) {
  const chatThreads = new ChatThreadStore();
  const thread = chatThreads.create({
    tenant_id: tenant.tenant_id,
    user_id: userId,
    title: "New chat",
  });

  const sessions = new SessionStore();
  const session = await sessions.create({
    userId,
    tenantId: tenant.tenant_id,
    email: "purpose@example.com",
  });

  const invokeBrainRpc = options?.invokeBrainRpc ?? vi.fn();
  const deliverInbound =
    options?.deliverInbound ??
    vi.fn(async () => ({ ok: true as const }));

  const authClient = {
    getUserRbac: async () => ({
      user_id: userId,
      tenant_id: tenant.tenant_id,
      hermes_profile: "default",
      allowed_path_prefixes: ["/"],
      role_names: ["member"],
    }),
    getPrimaryGatewayInstance: async () => ({
      instance_id: "inst-system-prompt",
    }),
    getActiveSessionShare: async () => null,
  };

  const app = createApp(
    createTestBindings(
      { [tenant.tenant_slug]: tenant },
      {
        sessions,
        chatThreads,
        brainRpcEnabled: options?.brainRpcEnabled ?? false,
        authClient: authClient as never,
        relayClient: {
          invokeBrainRpc,
          deliverInbound,
        } as never,
      },
    ),
  );

  const cookies = {
    lanyard_session: session.sessionId,
    lanyard_csrf: "test-csrf-system-prompt",
  };

  return { app, chatThreads, thread, cookies, invokeBrainRpc, deliverInbound };
}

function headers(cookies: Record<string, string>): Headers {
  return new Headers({
    host: tenant.host,
    cookie: cookieHeader(cookies),
    "x-csrf-token": cookies.lanyard_csrf,
    "content-type": "application/json",
  });
}

async function assignSystemPrompt(
  app: ReturnType<typeof createApp>,
  cookies: Record<string, string>,
  threadId: string,
  body: Record<string, unknown> = {},
) {
  const res = await app.request(
    `/api/chat/threads/${threadId}/assign-system-prompt`,
    {
      method: "POST",
      headers: headers(cookies),
      body: JSON.stringify(body),
    },
  );
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body: json };
}

describe("thread system_prompt persistence + PATCH (lp-lv9.4)", () => {
  it("create summary includes empty system_prompt + default source", async () => {
    const { app, cookies } = await boot();
    const res = await app.request("/api/chat/threads", {
      method: "POST",
      headers: headers(cookies),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.system_prompt).toBe("");
    expect(body.system_prompt_source).toBe("default");
  });

  it("PATCH system_prompt sets source=user and persists", async () => {
    const { app, cookies, thread, chatThreads } = await boot();
    const res = await app.request(`/api/chat/threads/${thread.thread_id}`, {
      method: "PATCH",
      headers: headers(cookies),
      body: JSON.stringify({
        system_prompt: "User-defined purpose for this agent chat.",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.system_prompt).toBe(
      "User-defined purpose for this agent chat.",
    );
    expect(body.system_prompt_source).toBe("user");

    const reloaded = chatThreads.get(thread.thread_id);
    expect(reloaded?.system_prompt).toBe(
      "User-defined purpose for this agent chat.",
    );
    expect(reloaded?.system_prompt_source).toBe("user");
  });
});

describe("POST /chat/threads/:id/assign-system-prompt (lp-lv9.4)", () => {
  it("assigns offline fixture purpose and sets system_prompt_source=llm", async () => {
    const { app, cookies, thread, invokeBrainRpc, chatThreads } = await boot();

    // Seed one completed user turn so the generate gate opens.
    chatThreads.appendHistory(thread.thread_id, {
      type: "user_message",
      message_id: "m1",
      content: "summarize the quarterly pipeline notes",
      created_at: new Date().toISOString(),
      chat_id: thread.thread_id,
    });

    const { status, body } = await assignSystemPrompt(
      app,
      cookies,
      thread.thread_id,
      { message: "summarize the quarterly pipeline notes" },
    );

    expect(status).toBe(200);
    expect(body.applied).toBe(true);
    expect(body.prompt_source).toBe("fixture");
    expect(body.system_prompt_source).toBe("llm");
    expect(typeof body.system_prompt).toBe("string");
    expect(String(body.system_prompt).length).toBeGreaterThan(0);
    expect(invokeBrainRpc).not.toHaveBeenCalled();

    const reloaded = chatThreads.get(thread.thread_id);
    expect(reloaded?.system_prompt_source).toBe("llm");
    expect(reloaded?.system_prompt).toBe(body.system_prompt);
  });

  it("never overwrites user system_prompt_source", async () => {
    const { app, cookies, thread, chatThreads } = await boot();
    chatThreads.appendHistory(thread.thread_id, {
      type: "user_message",
      message_id: "m1",
      content: "hello",
      created_at: new Date().toISOString(),
      chat_id: thread.thread_id,
    });
    chatThreads.updateSystemPrompt(thread.thread_id, "Sticky purpose", {
      system_prompt_source: "user",
    });

    const { status, body } = await assignSystemPrompt(
      app,
      cookies,
      thread.thread_id,
      { message: "this should not replace" },
    );

    expect(status).toBe(200);
    expect(body.applied).toBe(false);
    expect(body.skipped_reason).toBe("system_prompt_source");
    expect(body.system_prompt).toBe("Sticky purpose");
    expect(body.system_prompt_source).toBe("user");
  });

  it("skips scheduled_task kind", async () => {
    const { app, cookies, chatThreads } = await boot();
    const jobThread = chatThreads.create({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      title: "Nightly",
      kind: "scheduled_task",
      scheduled_job_id: "job-nightly",
      title_source: "job",
    });
    chatThreads.appendHistory(jobThread.thread_id, {
      type: "user_message",
      message_id: "m1",
      content: "run",
      created_at: new Date().toISOString(),
      chat_id: jobThread.thread_id,
    });

    const { status, body } = await assignSystemPrompt(
      app,
      cookies,
      jobThread.thread_id,
      { message: "run" },
    );
    expect(status).toBe(200);
    expect(body.applied).toBe(false);
    expect(body.skipped_reason).toBe("kind");
  });

  it("uses host canned purpose when brain RPC returns suggest_purpose", async () => {
    const invokeBrainRpc = vi.fn(async () => ({
      ok: true as const,
      result: {
        type: "brain_rpc_result",
        ok: true,
        result: { system_prompt: "Host purpose summary" },
      },
    }));
    const { app, cookies, thread, chatThreads } = await boot({
      brainRpcEnabled: true,
      invokeBrainRpc,
    });
    chatThreads.appendHistory(thread.thread_id, {
      type: "user_message",
      message_id: "m1",
      content: "anything",
      created_at: new Date().toISOString(),
      chat_id: thread.thread_id,
    });

    const { status, body } = await assignSystemPrompt(
      app,
      cookies,
      thread.thread_id,
      { message: "anything" },
    );

    expect(status).toBe(200);
    expect(body.applied).toBe(true);
    expect(body.prompt_source).toBe("host");
    expect(body.system_prompt).toBe("Host purpose summary");
    expect(body.system_prompt_source).toBe("llm");
    expect(invokeBrainRpc).toHaveBeenCalledOnce();
  });
});

describe("chat send injects purpose block metadata (lp-lv9.4)", () => {
  it("includes system_prompt + purpose_block on deliver-inbound", async () => {
    const deliverInbound = vi.fn(async () => ({ ok: true as const }));
    const { app, cookies, thread, chatThreads } = await boot({
      deliverInbound,
    });
    chatThreads.updateSystemPrompt(thread.thread_id, "Help with Q3 planning", {
      system_prompt_source: "llm",
    });

    const res = await app.request(
      `/api/chat/threads/${thread.thread_id}/messages`,
      {
        method: "POST",
        headers: headers(cookies),
        body: JSON.stringify({ text: "continue" }),
      },
    );
    expect(res.status).toBe(200);
    expect(deliverInbound).toHaveBeenCalledOnce();
    const call = deliverInbound.mock.calls[0]?.[0] as {
      event: { metadata?: Record<string, unknown> };
    };
    expect(call.event.metadata).toMatchObject({
      system_prompt: "Help with Q3 planning",
      purpose_block: "## Chat purpose\nHelp with Q3 planning",
    });
  });

  it("omits purpose metadata when system_prompt is empty", async () => {
    const deliverInbound = vi.fn(async () => ({ ok: true as const }));
    const { app, cookies, thread } = await boot({ deliverInbound });

    const res = await app.request(
      `/api/chat/threads/${thread.thread_id}/messages`,
      {
        method: "POST",
        headers: headers(cookies),
        body: JSON.stringify({ text: "hello" }),
      },
    );
    expect(res.status).toBe(200);
    const call = deliverInbound.mock.calls[0]?.[0] as {
      event: { metadata?: Record<string, unknown> };
    };
    expect(call.event.metadata?.system_prompt).toBeUndefined();
    expect(call.event.metadata?.purpose_block).toBeUndefined();
  });
});
