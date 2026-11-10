/**
 * lp-v62i.22 — Agent rename updates catalog, 1:1 title, roster chip, persona.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { ChatThreadStore } from "../src/chat-store.js";
import { personaMetaForWake } from "../src/persona-turn.js";
import { SessionStore } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import { cookieHeader, createTestBindings } from "./test-helpers.js";

const tenant: TenantContext = {
  tenant_id: "tenant-rename-agent",
  tenant_slug: "demo",
  display_name: "Demo",
  host: "demo.withlanyard.com",
};
const userId = "user-rename-agent";

describe("ChatThreadStore.renameAgent (lp-v62i.22)", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDbPath(): string {
    const dir = mkdtempSync(join(tmpdir(), "bff-rename-agent-"));
    dirs.push(dir);
    return join(dir, "chat.db");
  }

  it("updates catalog, 1:1 title, and group participant display_name", () => {
    const store = new ChatThreadStore();
    const bob = store.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Bob",
    });
    const fred = store.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Fred",
    });
    const channel = store.createChannel({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "teamguys",
      member_agent_ids: [bob.agent_id, fred.agent_id],
    });
    store.appendHistory(bob.thread_id, {
      type: "message_send",
      chat_id: bob.thread_id,
      message_id: "msg-old",
      content: "I am Bob",
      created_at: "2026-08-28T12:00:00.000Z",
      speaker: { kind: "persona", id: bob.agent_id, display_name: "Bob" },
    });

    const renamed = store.renameAgent({
      agent_id: bob.agent_id,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Alice",
    });
    expect(renamed?.name).toBe("Alice");
    expect(store.getAgent(bob.agent_id)?.name).toBe("Alice");
    expect(store.get(bob.thread_id)).toMatchObject({
      title: "Alice",
      title_source: "user",
    });
    expect(store.get(fred.thread_id)?.title).toBe("Fred");

    const roster = store.get(channel.thread_id)?.participants ?? [];
    expect(roster).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "persona",
          persona_id: bob.agent_id,
          display_name: "Alice",
        }),
        expect.objectContaining({
          kind: "persona",
          persona_id: fred.agent_id,
          display_name: "Fred",
        }),
      ]),
    );

    const history = store.listHistory(bob.thread_id);
    expect(history[0]).toMatchObject({
      speaker: { kind: "persona", id: bob.agent_id, display_name: "Bob" },
    });

    const oneToOne = personaMetaForWake({
      thread: store.get(bob.thread_id)!,
      personaId: bob.agent_id,
      agent: store.getAgent(bob.agent_id),
      teammates: store.listAgents(tenant.tenant_id, userId),
    });
    expect(oneToOne.display_name).toBe("Alice");
    expect(oneToOne.system_prompt).toContain("You are Alice");
    expect(oneToOne.system_prompt).not.toContain("You are Bob");

    const channelWake = personaMetaForWake({
      thread: store.get(channel.thread_id)!,
      personaId: bob.agent_id,
      agent: store.getAgent(bob.agent_id),
    });
    expect(channelWake.display_name).toBe("Alice");
    expect(channelWake.system_prompt).toContain("You are Alice");
    expect(channelWake.system_prompt).toContain("Members: Alice, Fred.");
    expect(channelWake.system_prompt).not.toMatch(/\(id /);
    expect(channelWake.system_prompt).not.toContain("Bob");
  });

  it("retains the renamed catalog across SQLite restart", () => {
    const dbPath = tempDbPath();
    const store1 = new ChatThreadStore({ dbPath });
    const bob = store1.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Bob",
    });
    const fred = store1.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Fred",
    });
    const channel = store1.createChannel({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "teamguys",
      member_agent_ids: [bob.agent_id, fred.agent_id],
    });
    store1.renameAgent({
      agent_id: bob.agent_id,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Alice",
    });
    store1.close();

    const store2 = new ChatThreadStore({ dbPath });
    try {
      expect(store2.getAgent(bob.agent_id)?.name).toBe("Alice");
      expect(store2.get(bob.thread_id)?.title).toBe("Alice");
      expect(
        store2.get(channel.thread_id)?.participants.find(
          (row) => row.kind === "persona" && row.persona_id === bob.agent_id,
        ),
      ).toMatchObject({ display_name: "Alice" });
    } finally {
      store2.close();
    }
  });

  it("returns null for a missing or foreign agent", () => {
    const store = new ChatThreadStore();
    const bob = store.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Bob",
    });
    expect(
      store.renameAgent({
        agent_id: bob.agent_id,
        tenant_id: tenant.tenant_id,
        user_id: "someone-else",
        name: "Alice",
      }),
    ).toBeNull();
    expect(store.getAgent(bob.agent_id)?.name).toBe("Bob");
    expect(
      store.renameAgent({
        agent_id: "missing",
        tenant_id: tenant.tenant_id,
        user_id: userId,
        name: "Alice",
      }),
    ).toBeNull();
  });
});

describe("PATCH /api/agents/:id (lp-v62i.22)", () => {
  async function boot(store?: ChatThreadStore) {
    const chatThreads = store ?? new ChatThreadStore();
    const sessions = new SessionStore();
    const session = await sessions.create({
      userId,
      tenantId: tenant.tenant_id,
      email: "rename@example.com",
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
        instance_id: "inst-rename-agent",
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
      lanyard_csrf: "test-csrf-rename-agent",
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

  it("patch name then GET catalog, thread title, and persona wake use the new name", async () => {
    const { app, chatThreads, cookies } = await boot();
    const created = await app.request("/api/agents", {
      method: "POST",
      headers: headers(cookies),
      body: JSON.stringify({ name: "Bob" }),
    });
    expect(created.status).toBe(201);
    const bob = (await created.json()) as {
      agent_id: string;
      thread_id: string;
      name: string;
    };
    const peer = await app.request("/api/agents", {
      method: "POST",
      headers: headers(cookies),
      body: JSON.stringify({ name: "Fred" }),
    });
    const fred = (await peer.json()) as { agent_id: string };
    const channelRes = await app.request("/api/channels", {
      method: "POST",
      headers: headers(cookies),
      body: JSON.stringify({
        name: "teamguys",
        member_agent_ids: [bob.agent_id, fred.agent_id],
      }),
    });
    expect(channelRes.status).toBe(201);
    const channel = (await channelRes.json()) as { thread_id: string };

    const patched = await app.request(`/api/agents/${bob.agent_id}`, {
      method: "PATCH",
      headers: headers(cookies),
      body: JSON.stringify({ name: "Alice" }),
    });
    expect(patched.status).toBe(200);
    const patchedBody = (await patched.json()) as { name: string };
    expect(patchedBody.name).toBe("Alice");

    const listed = await app.request("/api/agents", {
      headers: new Headers({
        host: tenant.host,
        cookie: cookieHeader(cookies),
      }),
    });
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as {
      agents: Array<{ agent_id: string; name: string }>;
    };
    expect(
      listBody.agents.find((row) => row.agent_id === bob.agent_id)?.name,
    ).toBe("Alice");

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
        title: string;
        kind: string;
        participants?: Array<{
          kind: string;
          persona_id?: string;
          display_name?: string;
        }>;
      }>;
    };
    const oneToOne = threadsBody.threads.find(
      (row) => row.thread_id === bob.thread_id,
    );
    expect(oneToOne?.title).toBe("Alice");
    const group = threadsBody.threads.find(
      (row) => row.thread_id === channel.thread_id,
    );
    expect(group?.kind).toBe("group");
    expect(group?.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "persona",
          persona_id: bob.agent_id,
          display_name: "Alice",
        }),
      ]),
    );

    const agent = chatThreads.getAgent(bob.agent_id);
    const meta = personaMetaForWake({
      thread: chatThreads.get(bob.thread_id)!,
      personaId: bob.agent_id,
      agent,
      teammates: chatThreads.listAgents(tenant.tenant_id, userId),
    });
    expect(meta.display_name).toBe("Alice");
    expect(meta.system_prompt).toContain("You are Alice");
    expect(meta.system_prompt).not.toContain("You are Bob");
  });

  it("returns 404 for an unknown agent and 400 for an empty name", async () => {
    const { app, cookies } = await boot();
    const missing = await app.request("/api/agents/not-a-person", {
      method: "PATCH",
      headers: headers(cookies),
      body: JSON.stringify({ name: "Alice" }),
    });
    expect(missing.status).toBe(404);

    const created = await app.request("/api/agents", {
      method: "POST",
      headers: headers(cookies),
      body: JSON.stringify({ name: "Bob" }),
    });
    const bob = (await created.json()) as { agent_id: string };
    const empty = await app.request(`/api/agents/${bob.agent_id}`, {
      method: "PATCH",
      headers: headers(cookies),
      body: JSON.stringify({ name: "   " }),
    });
    expect(empty.status).toBe(400);
  });
});
