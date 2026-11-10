/**
 * lp-cxhb.2 — Durable agent catalog (row is the agent).
 * I3: New agent = one catalog row + one 1:1; second create is a different person.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { ChatThreadStore, DEFAULT_AGENT_NAME } from "../src/chat-store.js";
import { SessionStore } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import { cookieHeader, createTestBindings } from "./test-helpers.js";

const tenant: TenantContext = {
  tenant_id: "tenant-agent-catalog",
  tenant_slug: "demo",
  display_name: "Demo",
  host: "demo.withlanyard.com",
};
const userId = "user-agent-catalog";

describe("ChatThreadStore.createAgent (lp-cxhb.2)", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDbPath(): string {
    const dir = mkdtempSync(join(tmpdir(), "bff-agent-catalog-"));
    dirs.push(dir);
    return join(dir, "chat.db");
  }

  it("persists catalog fields and exactly one chat stream", () => {
    const store = new ChatThreadStore();
    const agent = store.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Legal",
      avatar: "aabbccddeeff0011",
      objective: "Draft contracts.",
    });

    expect(agent.agent_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(agent.name).toBe("Legal");
    expect(agent.avatar).toBe("aabbccddeeff0011");
    expect(agent.objective).toBe("Draft contracts.");
    expect(agent.thread_id).toBeTruthy();

    const thread = store.get(agent.thread_id);
    expect(thread).toMatchObject({
      thread_id: agent.thread_id,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      title: "Legal",
      avatar_seed: "aabbccddeeff0011",
      system_prompt: "Draft contracts.",
      kind: "chat",
      agent_id: agent.agent_id,
      scheduled_job_id: null,
    });
    expect(store.listForOwner(tenant.tenant_id, userId)).toHaveLength(1);
    expect(store.listAgents(tenant.tenant_id, userId)).toEqual([agent]);
  });

  it("mints a different agent id on a second create", () => {
    const store = new ChatThreadStore();
    const first = store.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Legal",
    });
    const second = store.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Finance",
    });

    expect(second.agent_id).not.toBe(first.agent_id);
    expect(second.thread_id).not.toBe(first.thread_id);
    expect(store.listAgents(tenant.tenant_id, userId)).toHaveLength(2);
    expect(store.listForOwner(tenant.tenant_id, userId)).toHaveLength(2);
  });

  it("does not mint a second 1:1 for an existing agent", () => {
    const store = new ChatThreadStore();
    const agent = store.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Solo",
    });
    expect(() =>
      store.create({
        tenant_id: tenant.tenant_id,
        user_id: userId,
        title: "Clone thread",
        kind: "chat",
        agent_id: agent.agent_id,
      }),
    ).toThrow(/one 1:1/i);
    expect(store.listForOwner(tenant.tenant_id, userId)).toHaveLength(1);
    expect(store.get(agent.thread_id)?.agent_id).toBe(agent.agent_id);
  });

  it("retains catalog uniqueness across SQLite restart", () => {
    const dbPath = tempDbPath();
    const store1 = new ChatThreadStore({ dbPath });
    const first = store1.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Legal",
      avatar: "1111222233334444",
      objective: "Contracts",
    });
    const second = store1.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Ops",
      objective: "Runbooks",
    });
    store1.close();

    const store2 = new ChatThreadStore({ dbPath });
    try {
      const listed = store2.listAgents(tenant.tenant_id, userId);
      expect(listed).toHaveLength(2);
      const ids = new Set(listed.map((row) => row.agent_id));
      expect(ids.has(first.agent_id)).toBe(true);
      expect(ids.has(second.agent_id)).toBe(true);
      expect(ids.size).toBe(2);

      const reloaded = store2.getAgent(first.agent_id);
      expect(reloaded).toMatchObject({
        agent_id: first.agent_id,
        name: "Legal",
        avatar: "1111222233334444",
        objective: "Contracts",
        thread_id: first.thread_id,
      });
      expect(store2.get(first.thread_id)?.agent_id).toBe(first.agent_id);
      expect(store2.listForOwner(tenant.tenant_id, userId)).toHaveLength(2);
    } finally {
      store2.close();
    }
  });
});

describe("POST /api/agents catalog uniqueness (lp-cxhb.2 I3)", () => {
  async function boot(store?: ChatThreadStore) {
    const chatThreads = store ?? new ChatThreadStore();
    const sessions = new SessionStore();
    const session = await sessions.create({
      userId,
      tenantId: tenant.tenant_id,
      email: "catalog@example.com",
    });
    const authClient = {
      getUserRbac: async () => ({
        user_id: userId,
        tenant_id: tenant.tenant_id,
        hermes_profile: "default",
        allowed_path_prefixes: ["/"],
        role_names: ["member"],
      }),
      getPrimaryGatewayInstance: async () => ({
        instance_id: "inst-agent-catalog",
      }),
      getActiveSessionShare: async () => null,
      listSessionSharesForGrantee: async () => [],
    };
    const app = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          sessions,
          chatThreads,
          brainRpcEnabled: false,
          authClient: authClient as never,
        },
      ),
    );
    const cookies = {
      lanyard_session: session.sessionId,
      lanyard_csrf: "test-csrf-agent-catalog",
    };
    return { app, chatThreads, cookies };
  }

  function headers(cookies: Record<string, string>): Headers {
    return new Headers({
      host: tenant.host,
      cookie: cookieHeader(cookies),
      "x-csrf-token": cookies.lanyard_csrf,
      "content-type": "application/json",
    });
  }

  it("creates catalog fields plus one 1:1; second POST is a different agent", async () => {
    const { app, chatThreads, cookies } = await boot();

    const res1 = await app.request("/api/agents", {
      method: "POST",
      headers: headers(cookies),
      body: JSON.stringify({
        name: "Legal",
        avatar: "deadbeefdeadbeef",
        objective: "Review NDAs.",
      }),
    });
    expect(res1.status).toBe(201);
    const body1 = (await res1.json()) as {
      agent_id: string;
      name: string;
      avatar: string;
      objective: string;
      thread_id: string;
    };
    expect(body1).toMatchObject({
      name: "Legal",
      avatar: "deadbeefdeadbeef",
      objective: "Review NDAs.",
    });
    expect(body1.agent_id).toBeTruthy();
    expect(body1.thread_id).toBeTruthy();
    expect(chatThreads.get(body1.thread_id)?.kind).toBe("chat");

    const res2 = await app.request("/api/agents", {
      method: "POST",
      headers: headers(cookies),
      body: JSON.stringify({ name: "Finance" }),
    });
    expect(res2.status).toBe(201);
    const body2 = (await res2.json()) as {
      agent_id: string;
      thread_id: string;
    };
    expect(body2.agent_id).not.toBe(body1.agent_id);
    expect(body2.thread_id).not.toBe(body1.thread_id);

    const listed = await app.request("/api/agents", {
      headers: new Headers({
        host: tenant.host,
        cookie: cookieHeader(cookies),
      }),
    });
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as {
      agents: Array<{ agent_id: string; thread_id: string }>;
    };
    expect(listBody.agents).toHaveLength(2);
    const ids = new Set(listBody.agents.map((row) => row.agent_id));
    expect(ids.has(body1.agent_id)).toBe(true);
    expect(ids.has(body2.agent_id)).toBe(true);

    const threads = chatThreads.listForOwner(tenant.tenant_id, userId);
    expect(threads).toHaveLength(2);
    expect(threads.filter((t) => t.kind === "chat")).toHaveLength(2);
  });

  it("lp-cxhb.4: empty POST (UI New agent) mints catalog + one 1:1; never a second 1:1 per agent", async () => {
    const { app, chatThreads, cookies } = await boot();

    const res1 = await app.request("/api/agents", {
      method: "POST",
      headers: headers(cookies),
      body: JSON.stringify({}),
    });
    expect(res1.status).toBe(201);
    const body1 = (await res1.json()) as {
      agent_id: string;
      name: string;
      thread_id: string;
    };
    // T3 distinct seed: empty POST mints distinct codename, not generic "New agent"
    expect(body1.name).not.toBe("");
    expect(body1.name).not.toBe(DEFAULT_AGENT_NAME);
    expect(body1.agent_id).toBeTruthy();
    expect(body1.thread_id).toBeTruthy();

    const res2 = await app.request("/api/agents", {
      method: "POST",
      headers: headers(cookies),
      body: JSON.stringify({}),
    });
    expect(res2.status).toBe(201);
    const body2 = (await res2.json()) as {
      agent_id: string;
      name: string;
      thread_id: string;
    };
    expect(body2.agent_id).not.toBe(body1.agent_id);
    expect(body2.thread_id).not.toBe(body1.thread_id);
    expect(body2.name).not.toBe(body1.name);

    const listed = await app.request("/api/agents", {
      headers: new Headers({
        host: tenant.host,
        cookie: cookieHeader(cookies),
      }),
    });
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as {
      agents: Array<{ agent_id: string; thread_id: string }>;
    };
    expect(listBody.agents).toHaveLength(2);

    const threadsRes = await app.request("/api/chat/threads", {
      headers: new Headers({
        host: tenant.host,
        cookie: cookieHeader(cookies),
      }),
    });
    expect(threadsRes.status).toBe(200);
    const threadsBody = (await threadsRes.json()) as {
      threads: Array<{
        thread_id: string;
        agent_id: string | null;
        kind: string;
      }>;
    };
    const chats = threadsBody.threads.filter((row) => row.kind === "chat");
    expect(chats).toHaveLength(2);
    expect(new Set(chats.map((row) => row.agent_id)).size).toBe(2);
    expect(
      chats.filter((row) => row.agent_id === body1.agent_id),
    ).toHaveLength(1);
    expect(
      chats.filter((row) => row.agent_id === body2.agent_id),
    ).toHaveLength(1);
    expect(chatThreads.get(body1.thread_id)?.agent_id).toBe(body1.agent_id);
    expect(chatThreads.get(body2.thread_id)?.agent_id).toBe(body2.agent_id);
  });
});
