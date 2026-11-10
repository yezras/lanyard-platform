/**
 * lp-cxhb.6 — Channel membership after create: add/remove, floor of two (I7).
 * Delete channel keeps durable agents and their 1:1s (I8).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import {
  CHANNEL_MIN_MEMBERS,
  CreateChannelError,
  parseAddChannelMember,
  parseRemoveChannelMember,
} from "../src/create-channel.js";
import { ChannelNotFoundError, ChatThreadStore } from "../src/chat-store.js";
import { SessionStore } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import { cookieHeader, createTestBindings } from "./test-helpers.js";

const tenant: TenantContext = {
  tenant_id: "tenant-channel-membership",
  tenant_slug: "demo",
  display_name: "Demo",
  host: "demo.withlanyard.com",
};
const userId = "user-channel-membership";

describe("parseAddChannelMember / parseRemoveChannelMember (lp-cxhb.6 I7)", () => {
  const catalog = new Set(["agent-legal", "agent-ops", "agent-fin"]);
  const pair = ["agent-legal", "agent-ops"];

  it("I7: add accepts a new catalog agent", () => {
    expect(
      parseAddChannelMember("agent-fin", pair, catalog),
    ).toEqual({ ok: true, value: { agent_id: "agent-fin" } });
  });

  it("I7: add rejects a duplicate member", () => {
    const parsed = parseAddChannelMember("agent-legal", pair, catalog);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues).toContainEqual({
      code: "members_duplicate",
      agent_id: "agent-legal",
    });
  });

  it("I7: add rejects an unknown catalog id", () => {
    const parsed = parseAddChannelMember("ghost", pair, catalog);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues).toContainEqual({
      code: "member_not_found",
      agent_id: "ghost",
    });
  });

  it("I7: remove from three keeps two", () => {
    expect(
      parseRemoveChannelMember("agent-fin", [...pair, "agent-fin"]),
    ).toEqual({
      ok: true,
      value: {
        agent_id: "agent-fin",
        remaining_agent_ids: pair,
      },
    });
  });

  it("I7: cannot go below two", () => {
    const parsed = parseRemoveChannelMember("agent-legal", pair);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues).toContainEqual({
      code: "members_min",
      min: CHANNEL_MIN_MEMBERS,
      got: 1,
    });
  });

  it("I7: remove rejects a non-member", () => {
    const parsed = parseRemoveChannelMember("agent-fin", pair);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues).toContainEqual({
      code: "member_not_in_channel",
      agent_id: "agent-fin",
    });
  });
});

describe("ChatThreadStore membership (lp-cxhb.6 I7/I8)", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDbPath(): string {
    const dir = mkdtempSync(join(tmpdir(), "bff-channel-membership-"));
    dirs.push(dir);
    return join(dir, "chat.db");
  }

  function seedPair(store: ChatThreadStore) {
    const legal = store.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Legal",
    });
    const ops = store.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Ops",
    });
    const channel = store.createChannel({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Deal room",
      member_agent_ids: [legal.agent_id, ops.agent_id],
    });
    return { legal, ops, channel };
  }

  it("I7: add a third member; remove back to two", () => {
    const store = new ChatThreadStore();
    const { legal, ops, channel } = seedPair(store);
    const fin = store.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Fin",
    });

    const added = store.addChannelMember({
      thread_id: channel.thread_id,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      agent_id: fin.agent_id,
    });
    expect(added.members.map((row) => row.agent_id)).toEqual([
      legal.agent_id,
      ops.agent_id,
      fin.agent_id,
    ]);
    expect(added.lead_agent_id).toBe(legal.agent_id);
    expect(
      added.thread.participants.filter((row) => row.kind === "persona"),
    ).toHaveLength(3);

    const removed = store.removeChannelMember({
      thread_id: channel.thread_id,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      agent_id: fin.agent_id,
    });
    expect(removed.members.map((row) => row.agent_id)).toEqual([
      legal.agent_id,
      ops.agent_id,
    ]);
    expect(store.listAgents(tenant.tenant_id, userId)).toHaveLength(3);
  });

  it("I7: cannot remove when only two members remain", () => {
    const store = new ChatThreadStore();
    const { legal, channel } = seedPair(store);
    expect(() =>
      store.removeChannelMember({
        thread_id: channel.thread_id,
        tenant_id: tenant.tenant_id,
        user_id: userId,
        agent_id: legal.agent_id,
      }),
    ).toThrow(CreateChannelError);
    expect(
      store.getChannel(channel.thread_id)?.members,
    ).toHaveLength(2);
  });

  it("I7: removing the lead keeps a remaining member as lead", () => {
    const store = new ChatThreadStore();
    const { legal, ops, channel } = seedPair(store);
    const fin = store.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Fin",
    });
    store.addChannelMember({
      thread_id: channel.thread_id,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      agent_id: fin.agent_id,
    });
    const next = store.removeChannelMember({
      thread_id: channel.thread_id,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      agent_id: legal.agent_id,
    });
    expect(next.lead_agent_id).toBe(ops.agent_id);
    expect(next.thread.orchestrator_persona_id).toBe(ops.agent_id);
    expect(next.members.map((row) => row.agent_id)).toEqual([
      ops.agent_id,
      fin.agent_id,
    ]);
  });

  it("I8: deleteChannel keeps durable agents and 1:1 history", () => {
    const store = new ChatThreadStore();
    const { legal, ops, channel } = seedPair(store);
    store.appendHistory(legal.thread_id, {
      type: "user_message",
      message_id: "m-legal",
      content: "hello legal",
      created_at: new Date().toISOString(),
      chat_id: legal.thread_id,
    });
    store.appendHistory(ops.thread_id, {
      type: "user_message",
      message_id: "m-ops",
      content: "hello ops",
      created_at: new Date().toISOString(),
      chat_id: ops.thread_id,
    });
    expect(
      store.deleteChannel({
        thread_id: channel.thread_id,
        tenant_id: tenant.tenant_id,
        user_id: userId,
      }),
    ).toBe(true);
    expect(store.getChannel(channel.thread_id)).toBeUndefined();
    expect(store.listChannels(tenant.tenant_id, userId)).toEqual([]);
    expect(store.listAgents(tenant.tenant_id, userId)).toHaveLength(2);
    expect(store.get(legal.thread_id)?.kind).toBe("chat");
    expect(store.get(ops.thread_id)?.kind).toBe("chat");
    expect(store.listHistory(legal.thread_id).map((row) => row.type)).toEqual([
      "user_message",
    ]);
    expect(store.listHistory(ops.thread_id).map((row) => row.type)).toEqual([
      "user_message",
    ]);
  });

  it("deleteChannel on a missing id is false, not an agent delete", () => {
    const store = new ChatThreadStore();
    const { legal } = seedPair(store);
    expect(
      store.deleteChannel({
        thread_id: legal.thread_id,
        tenant_id: tenant.tenant_id,
        user_id: userId,
      }),
    ).toBe(false);
    expect(store.getAgent(legal.agent_id)?.thread_id).toBe(legal.thread_id);
  });

  it("add/remove persist across SQLite restart", () => {
    const dbPath = tempDbPath();
    const store1 = new ChatThreadStore({ dbPath });
    const { legal, ops, channel } = seedPair(store1);
    const fin = store1.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Fin",
    });
    store1.addChannelMember({
      thread_id: channel.thread_id,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      agent_id: fin.agent_id,
    });
    store1.removeChannelMember({
      thread_id: channel.thread_id,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      agent_id: ops.agent_id,
    });
    store1.close();

    const store2 = new ChatThreadStore({ dbPath });
    try {
      const loaded = store2.getChannel(channel.thread_id);
      expect(loaded?.members.map((row) => row.agent_id)).toEqual([
        legal.agent_id,
        fin.agent_id,
      ]);
      expect(loaded?.lead_agent_id).toBe(legal.agent_id);
    } finally {
      store2.close();
    }
  });

  it("throws ChannelNotFoundError for an unknown room", () => {
    const store = new ChatThreadStore();
    expect(() =>
      store.addChannelMember({
        thread_id: "missing",
        tenant_id: tenant.tenant_id,
        user_id: userId,
        agent_id: "agent-legal",
      }),
    ).toThrow(ChannelNotFoundError);
  });
});

describe("HTTP channel membership (lp-cxhb.6 I7/I8)", () => {
  async function boot(store?: ChatThreadStore) {
    const chatThreads = store ?? new ChatThreadStore();
    const sessions = new SessionStore();
    const session = await sessions.create({
      userId,
      tenantId: tenant.tenant_id,
      email: "members@example.com",
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
        instance_id: "inst-channel-membership",
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
      lanyard_csrf: "test-csrf-channel-membership",
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

  async function seedHttp(app: ReturnType<typeof createApp>, cookies: Record<string, string>) {
    const a1 = await app.request("/api/agents", {
      method: "POST",
      headers: headers(cookies),
      body: JSON.stringify({ name: "Legal" }),
    });
    const a2 = await app.request("/api/agents", {
      method: "POST",
      headers: headers(cookies),
      body: JSON.stringify({ name: "Ops" }),
    });
    const legal = (await a1.json()) as { agent_id: string; thread_id: string };
    const ops = (await a2.json()) as { agent_id: string; thread_id: string };
    const created = await app.request("/api/channels", {
      method: "POST",
      headers: headers(cookies),
      body: JSON.stringify({
        name: "Deal room",
        member_agent_ids: [legal.agent_id, ops.agent_id],
      }),
    });
    const channel = (await created.json()) as {
      thread_id: string;
      members: Array<{ agent_id: string }>;
    };
    return { legal, ops, channel };
  }

  it("I7: POST member then DELETE member; floor of two is 400", async () => {
    const { app, cookies } = await boot();
    const { legal, ops, channel } = await seedHttp(app, cookies);
    const finRes = await app.request("/api/agents", {
      method: "POST",
      headers: headers(cookies),
      body: JSON.stringify({ name: "Fin" }),
    });
    const fin = (await finRes.json()) as { agent_id: string };

    const added = await app.request(
      `/api/channels/${channel.thread_id}/members`,
      {
        method: "POST",
        headers: headers(cookies),
        body: JSON.stringify({ agent_id: fin.agent_id }),
      },
    );
    expect(added.status).toBe(201);
    const addedBody = (await added.json()) as {
      members: Array<{ agent_id: string }>;
    };
    expect(addedBody.members.map((row) => row.agent_id)).toEqual([
      legal.agent_id,
      ops.agent_id,
      fin.agent_id,
    ]);

    const got = await app.request(`/api/channels/${channel.thread_id}`, {
      headers: new Headers({
        host: tenant.host,
        cookie: cookieHeader(cookies),
      }),
    });
    expect(got.status).toBe(200);

    const removed = await app.request(
      `/api/channels/${channel.thread_id}/members/${fin.agent_id}`,
      { method: "DELETE", headers: headers(cookies) },
    );
    expect(removed.status).toBe(200);
    const removedBody = (await removed.json()) as {
      members: Array<{ agent_id: string }>;
    };
    expect(removedBody.members).toHaveLength(2);

    const blocked = await app.request(
      `/api/channels/${channel.thread_id}/members/${legal.agent_id}`,
      { method: "DELETE", headers: headers(cookies) },
    );
    expect(blocked.status).toBe(400);
    const blockedBody = (await blocked.json()) as {
      error: string;
      issues: Array<{ code: string }>;
    };
    expect(blockedBody.error).toMatch(/at least 2 members/i);
    expect(blockedBody.issues.some((issue) => issue.code === "members_min")).toBe(
      true,
    );
  });

  it("I8: DELETE channel keeps both agents and their 1:1s", async () => {
    const { app, cookies } = await boot();
    const { legal, ops, channel } = await seedHttp(app, cookies);

    const deleted = await app.request(`/api/channels/${channel.thread_id}`, {
      method: "DELETE",
      headers: headers(cookies),
    });
    expect(deleted.status).toBe(200);

    const listed = await app.request("/api/channels", {
      headers: new Headers({
        host: tenant.host,
        cookie: cookieHeader(cookies),
      }),
    });
    const listBody = (await listed.json()) as { channels: unknown[] };
    expect(listBody.channels).toEqual([]);

    const agents = await app.request("/api/agents", {
      headers: new Headers({
        host: tenant.host,
        cookie: cookieHeader(cookies),
      }),
    });
    const agentBody = (await agents.json()) as {
      agents: Array<{ agent_id: string; thread_id: string }>;
    };
    expect(agentBody.agents).toHaveLength(2);
    const ids = new Set(agentBody.agents.map((row) => row.agent_id));
    expect(ids.has(legal.agent_id)).toBe(true);
    expect(ids.has(ops.agent_id)).toBe(true);

    const threadsRes = await app.request("/api/chat/threads", {
      headers: new Headers({
        host: tenant.host,
        cookie: cookieHeader(cookies),
      }),
    });
    expect(threadsRes.status).toBe(200);
    const threadsBody = (await threadsRes.json()) as {
      threads: Array<{ thread_id: string; kind?: string }>;
    };
    const byId = new Map(
      threadsBody.threads.map((row) => [row.thread_id, row]),
    );
    expect(byId.get(legal.thread_id)?.kind ?? "chat").toBe("chat");
    expect(byId.get(ops.thread_id)?.kind ?? "chat").toBe("chat");
    expect(byId.has(channel.thread_id)).toBe(false);

    const missing = await app.request(`/api/channels/${channel.thread_id}`, {
      headers: new Headers({
        host: tenant.host,
        cookie: cookieHeader(cookies),
      }),
    });
    expect(missing.status).toBe(404);
  });
});
