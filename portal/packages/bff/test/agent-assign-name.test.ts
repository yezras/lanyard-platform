/**
 * lp-fn5.3.4 / lp-pxr.2 / lp-7st.1 — POST /api/chat/threads/:id/assign-name
 * (offline fixture + host suggest_title path).
 */
import { describe, expect, it, vi } from "vitest";

import {
  CHAT_SUGGEST_TITLE_METHOD,
  CHAT_SUGGEST_TITLE_PROMPT,
  OFFLINE_CODENAME_FALLBACKS,
  looksLikePromptWordSnippet,
} from "../src/agent-name.js";
import { createApp } from "../src/app.js";
import { ChatThreadStore } from "../src/chat-store.js";
import { SessionStore } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import { cookieHeader, createTestBindings } from "./test-helpers.js";

const tenant: TenantContext = {
  tenant_id: "tenant-assign-name",
  tenant_slug: "demo",
  display_name: "Demo",
  host: "demo.withlanyard.com",
};
const userId = "user-assign-name";

async function boot() {
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
    email: "name@example.com",
  });

  const invokeBrainRpc = vi.fn();
  const authClient = {
    getUserRbac: async () => ({
      user_id: userId,
      tenant_id: tenant.tenant_id,
      hermes_profile: "default",
      allowed_path_prefixes: ["/"],
      role_names: ["member"],
    }),
    getPrimaryGatewayInstance: async () => ({
      instance_id: "inst-assign-name",
    }),
    getActiveSessionShare: async () => null,
  };

  const app = createApp(
    createTestBindings(
      { [tenant.tenant_slug]: tenant },
      {
        sessions,
        chatThreads,
        brainRpcEnabled: false,
        authClient: authClient as never,
        relayClient: { invokeBrainRpc } as never,
      },
    ),
  );

  const cookies = {
    lanyard_session: session.sessionId,
    lanyard_csrf: "test-csrf-assign-name",
  };

  return { app, chatThreads, thread, cookies, invokeBrainRpc };
}

async function assignName(
  app: ReturnType<typeof createApp>,
  cookies: Record<string, string>,
  threadId: string,
  message: string,
) {
  const headers = new Headers({
    host: tenant.host,
    cookie: cookieHeader(cookies),
    "x-csrf-token": cookies.lanyard_csrf,
    "content-type": "application/json",
  });
  const res = await app.request(`/api/chat/threads/${threadId}/assign-name`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

describe("POST /chat/threads/:id/assign-name (lp-fn5.3.4 / lp-pxr.2 / lp-7st.1)", () => {
  it("assigns neutral offline fixture (not Hound keyword map) and sets title_source=llm", async () => {
    const { app, cookies, thread, invokeBrainRpc, chatThreads } = await boot();
    const message = "summarize the quarterly pipeline notes";

    const { status, body } = await assignName(
      app,
      cookies,
      thread.thread_id,
      message,
    );

    expect(status).toBe(200);
    expect(body.applied).toBe(true);
    expect(body.name_source).toBe("fixture");
    expect(body.title_source).toBe("llm");
    expect(typeof body.title).toBe("string");
    expect(String(body.title).length).toBeGreaterThan(0);
    expect(String(body.title)).not.toBe("New chat");
    // Offline path: neutral hash pool only — never product sales→Hound map.
    expect(body.title).not.toBe("Hound");
    expect(OFFLINE_CODENAME_FALLBACKS).toContain(body.title);
    expect(looksLikePromptWordSnippet(String(body.title), message)).toBe(false);
    // Offline path must not hit brain RPC.
    expect(invokeBrainRpc).not.toHaveBeenCalled();

    const reloaded = chatThreads.get(thread.thread_id);
    expect(reloaded?.title_source).toBe("llm");
    expect(reloaded?.title).toBe(body.title);
  });

  it("sales multi-sentence prompt does not always yield Hound", async () => {
    const { app, cookies, thread } = await boot();
    const salesPrompt =
      "I need a new strategy for sales pipeline outreach to enterprise prospects this quarter. Please draft sequences and scoring.";

    const { status, body } = await assignName(
      app,
      cookies,
      thread.thread_id,
      salesPrompt,
    );

    expect(status).toBe(200);
    expect(body.applied).toBe(true);
    expect(body.name_source).toBe("fixture");
    expect(body.title).not.toBe("Hound");
    expect(OFFLINE_CODENAME_FALLBACKS).toContain(body.title);
  });

  it("never overwrites user title_source", async () => {
    const { app, cookies, thread, chatThreads } = await boot();
    chatThreads.updateTitle(thread.thread_id, "Sticky name", {
      title_source: "user",
    });

    const { status, body } = await assignName(
      app,
      cookies,
      thread.thread_id,
      "this should not rename",
    );

    expect(status).toBe(200);
    expect(body.applied).toBe(false);
    expect(body.skipped_reason).toBe("title_source");
    expect(body.title).toBe("Sticky name");
    expect(body.title_source).toBe("user");
  });

  it("never overwrites job title_source", async () => {
    const { app, cookies, thread, chatThreads } = await boot();
    chatThreads.updateTitle(thread.thread_id, "Nightly digest", {
      title_source: "job",
    });

    const { status, body } = await assignName(
      app,
      cookies,
      thread.thread_id,
      "this should not rename",
    );

    expect(status).toBe(200);
    expect(body.applied).toBe(false);
    expect(body.skipped_reason).toBe("title_source");
    expect(body.title).toBe("Nightly digest");
    expect(body.title_source).toBe("job");
  });

  it("eager bootstrap with empty message sets fixture New agent (lp-lv9.3)", async () => {
    const { app, cookies, thread, chatThreads } = await boot();

    const { status, body } = await assignName(
      app,
      cookies,
      thread.thread_id,
      "",
    );

    expect(status).toBe(200);
    expect(body.applied).toBe(true);
    expect(body.name_source).toBe("fixture");
    expect(body.title).toBe("New agent");
    expect(body.title_source).toBe("llm");
    expect(chatThreads.get(thread.thread_id)?.title).toBe("New agent");
  });

  it("bootstrap skips host RPC even when brain RPC is enabled (lp-7st.1)", async () => {
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
      email: "name@example.com",
    });

    const invokeBrainRpc = vi.fn(async () => ({
      ok: true as const,
      result: {
        type: "brain_rpc_result",
        ok: true,
        result: { title: "Should Not Apply On Bootstrap" },
      },
    }));

    const app = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          sessions,
          chatThreads,
          brainRpcEnabled: true,
          authClient: {
            getUserRbac: async () => ({
              user_id: userId,
              tenant_id: tenant.tenant_id,
              hermes_profile: "default",
              allowed_path_prefixes: ["/"],
              role_names: ["member"],
            }),
            getPrimaryGatewayInstance: async () => ({
              instance_id: "inst-bootstrap-no-host",
            }),
            getActiveSessionShare: async () => null,
          } as never,
          relayClient: { invokeBrainRpc } as never,
        },
      ),
    );

    const cookies = {
      lanyard_session: session.sessionId,
      lanyard_csrf: "test-csrf-bootstrap-no-host",
    };

    const { status, body } = await assignName(
      app,
      cookies,
      thread.thread_id,
      "",
    );

    expect(status).toBe(200);
    expect(body.applied).toBe(true);
    expect(body.name_source).toBe("fixture");
    expect(body.title).toBe("New agent");
    expect(invokeBrainRpc).not.toHaveBeenCalled();
  });

  it("late bootstrap does not overwrite a refined llm title (lp-lv9.3)", async () => {
    const { app, cookies, thread, chatThreads } = await boot();
    // First-message refine wins first.
    const refined = await assignName(
      app,
      cookies,
      thread.thread_id,
      "summarize the quarterly pipeline notes",
    );
    expect(refined.body.applied).toBe(true);
    expect(refined.body.title_source).toBe("llm");
    const refinedTitle = String(refined.body.title);

    // Late eager bootstrap (empty message) must not clobber refine.
    const { status, body } = await assignName(
      app,
      cookies,
      thread.thread_id,
      "",
    );
    expect(status).toBe(200);
    expect(body.applied).toBe(false);
    expect(body.title).toBe(refinedTitle);
    expect(body.title_source).toBe("llm");
    expect(chatThreads.get(thread.thread_id)?.title).toBe(refinedTitle);
  });

  it("first-message refine may overwrite prior llm bootstrap title (lp-lv9.3)", async () => {
    const { app, cookies, thread, chatThreads } = await boot();
    const bootstrap = await assignName(app, cookies, thread.thread_id, "");
    expect(bootstrap.body.applied).toBe(true);
    expect(bootstrap.body.title).toBe("New agent");

    const refineMessage = "draft a Q3 plan for sales";
    const { status, body } = await assignName(
      app,
      cookies,
      thread.thread_id,
      refineMessage,
    );
    expect(status).toBe(200);
    expect(body.applied).toBe(true);
    expect(body.title_source).toBe("llm");
    expect(body.title).not.toBe("New agent");
    // Neutral offline fixture — not sales→Hound keyword map.
    expect(body.title).not.toBe("Hound");
    expect(OFFLINE_CODENAME_FALLBACKS).toContain(body.title);
    expect(looksLikePromptWordSnippet(String(body.title), refineMessage)).toBe(
      false,
    );
    expect(chatThreads.get(thread.thread_id)?.title).toBe(body.title);
  });

  it("uses host canned name when brain RPC returns suggest_title", async () => {
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
      email: "name@example.com",
    });

    const invokeBrainRpc = vi.fn(async () => ({
      ok: true as const,
      result: {
        type: "brain_rpc_result",
        ok: true,
        result: { title: "Mock Lab Agent" },
      },
    }));

    const app = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          sessions,
          chatThreads,
          brainRpcEnabled: true,
          authClient: {
            getUserRbac: async () => ({
              user_id: userId,
              tenant_id: tenant.tenant_id,
              hermes_profile: "default",
              allowed_path_prefixes: ["/"],
              role_names: ["member"],
            }),
            getPrimaryGatewayInstance: async () => ({
              instance_id: "inst-host-name",
            }),
            getActiveSessionShare: async () => null,
          } as never,
          relayClient: { invokeBrainRpc } as never,
        },
      ),
    );

    const cookies = {
      lanyard_session: session.sessionId,
      lanyard_csrf: "test-csrf-host-name",
    };

    const { status, body } = await assignName(
      app,
      cookies,
      thread.thread_id,
      "anything",
    );

    expect(status).toBe(200);
    expect(body.applied).toBe(true);
    expect(body.name_source).toBe("host");
    expect(body.title).toBe("Mock Lab Agent");
    expect(body.title_source).toBe("llm");
    expect(invokeBrainRpc).toHaveBeenCalledOnce();

    // Host path must pass creative-codename brief (lp-pxr.2).
    const rpcArg = invokeBrainRpc.mock.calls[0]?.[0] as {
      request?: { method?: string; params?: Record<string, unknown> };
    };
    const request = rpcArg?.request;
    expect(request?.method).toBe(CHAT_SUGGEST_TITLE_METHOD);
    expect(request?.params?.instruction).toBe(CHAT_SUGGEST_TITLE_PROMPT);
    expect(request?.params?.prompt).toBe(CHAT_SUGGEST_TITLE_PROMPT);
    expect(String(request?.params?.instruction)).toMatch(/codename/i);
  });

  it("host path passes through creative short codenames", async () => {
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
      email: "name@example.com",
    });

    const invokeBrainRpc = vi.fn(async () => ({
      ok: true as const,
      result: {
        type: "brain_rpc_result",
        ok: true,
        result: { title: "Night Scout" },
      },
    }));

    const app = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          sessions,
          chatThreads,
          brainRpcEnabled: true,
          authClient: {
            getUserRbac: async () => ({
              user_id: userId,
              tenant_id: tenant.tenant_id,
              hermes_profile: "default",
              allowed_path_prefixes: ["/"],
              role_names: ["member"],
            }),
            getPrimaryGatewayInstance: async () => ({
              instance_id: "inst-creative-name",
            }),
            getActiveSessionShare: async () => null,
          } as never,
          relayClient: { invokeBrainRpc } as never,
        },
      ),
    );

    const cookies = {
      lanyard_session: session.sessionId,
      lanyard_csrf: "test-csrf-creative-name",
    };

    const message =
      "I need a new strategy for sales pipeline outreach to enterprise buyers.";
    const { status, body } = await assignName(
      app,
      cookies,
      thread.thread_id,
      message,
    );

    expect(status).toBe(200);
    expect(body.applied).toBe(true);
    expect(body.name_source).toBe("host");
    expect(body.title).toBe("Night Scout");
    expect(looksLikePromptWordSnippet(String(body.title), message)).toBe(false);
  });

  it("falls back to neutral fixture when host suggest_title fails", async () => {
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
      email: "name@example.com",
    });

    const invokeBrainRpc = vi.fn(async () => {
      throw new Error("host unavailable");
    });

    const app = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          sessions,
          chatThreads,
          brainRpcEnabled: true,
          authClient: {
            getUserRbac: async () => ({
              user_id: userId,
              tenant_id: tenant.tenant_id,
              hermes_profile: "default",
              allowed_path_prefixes: ["/"],
              role_names: ["member"],
            }),
            getPrimaryGatewayInstance: async () => ({
              instance_id: "inst-host-fail",
            }),
            getActiveSessionShare: async () => null,
          } as never,
          relayClient: { invokeBrainRpc } as never,
        },
      ),
    );

    const cookies = {
      lanyard_session: session.sessionId,
      lanyard_csrf: "test-csrf-host-fail",
    };

    const message = "sales pipeline outreach to enterprise prospects";
    const { status, body } = await assignName(
      app,
      cookies,
      thread.thread_id,
      message,
    );

    expect(status).toBe(200);
    expect(body.applied).toBe(true);
    expect(body.name_source).toBe("fixture");
    expect(body.title).not.toBe("Hound");
    expect(OFFLINE_CODENAME_FALLBACKS).toContain(body.title);
    expect(invokeBrainRpc).toHaveBeenCalledOnce();
  });

  /**
   * Concurrent late-bootstrap race (lp-lv9.3):
   * Bootstrap always uses generic "New agent" (no host). If refine already set
   * title_source=llm, late bootstrap must refuse the write.
   */
  it("late bootstrap after refine does not overwrite host-refined title (lp-lv9.3)", async () => {
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
      email: "name@example.com",
    });

    const invokeBrainRpc = vi.fn(async () => ({
      ok: true as const,
      result: {
        type: "brain_rpc_result",
        ok: true,
        result: { title: "Refined Host Title" },
      },
    }));

    const app = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          sessions,
          chatThreads,
          brainRpcEnabled: true,
          authClient: {
            getUserRbac: async () => ({
              user_id: userId,
              tenant_id: tenant.tenant_id,
              hermes_profile: "default",
              allowed_path_prefixes: ["/"],
              role_names: ["member"],
            }),
            getPrimaryGatewayInstance: async () => ({
              instance_id: "inst-race-bootstrap",
            }),
            getActiveSessionShare: async () => null,
          } as never,
          relayClient: { invokeBrainRpc } as never,
        },
      ),
    );

    const cookies = {
      lanyard_session: session.sessionId,
      lanyard_csrf: "test-csrf-race-bootstrap",
    };

    // 1) First-message refine via host path.
    const refined = await assignName(
      app,
      cookies,
      thread.thread_id,
      "summarize the quarterly pipeline notes",
    );
    expect(refined.status).toBe(200);
    expect(refined.body.applied).toBe(true);
    expect(refined.body.name_source).toBe("host");
    expect(refined.body.title).toBe("Refined Host Title");
    expect(refined.body.title_source).toBe("llm");
    expect(chatThreads.get(thread.thread_id)?.title).toBe("Refined Host Title");

    // 2) Late bootstrap must refuse (title_source already llm).
    const bootstrap = await assignName(app, cookies, thread.thread_id, "");
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.body.applied).toBe(false);
    expect(bootstrap.body.title).toBe("Refined Host Title");
    expect(bootstrap.body.title_source).toBe("llm");
    expect(chatThreads.get(thread.thread_id)?.title).toBe("Refined Host Title");
    // Bootstrap must not call host.
    expect(invokeBrainRpc).toHaveBeenCalledTimes(1);
  });
});
