/**
 * lp-cxhb.5 — New channel: required name, ≥2 catalog members (I4, I5, I6).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import {
  CHANNEL_MIN_MEMBERS,
  CreateChannelError,
  parseCreateChannel,
} from "../src/create-channel.js";
import { ChatThreadStore } from "../src/chat-store.js";
import { SessionStore } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import { cookieHeader, createTestBindings } from "./test-helpers.js";

const tenant: TenantContext = {
  tenant_id: "tenant-create-channel",
  tenant_slug: "demo",
  display_name: "Demo",
  host: "demo.withlanyard.com",
};
const userId = "user-create-channel";

describe("parseCreateChannel (lp-cxhb.5 I4/I5)", () => {
  const catalog = new Set(["agent-legal", "agent-ops", "agent-fin"]);

  it("I4: rejects a missing name", () => {
    const parsed = parseCreateChannel(
      { member_agent_ids: ["agent-legal", "agent-ops"] },
      catalog,
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues).toContainEqual({ code: "name_required" });
  });

  it("I4: rejects a whitespace-only name", () => {
    const parsed = parseCreateChannel(
      { name: "   ", member_agent_ids: ["agent-legal", "agent-ops"] },
      catalog,
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues.some((issue) => issue.code === "name_required")).toBe(
      true,
    );
  });

  it("I4: rejects fewer than two members", () => {
    const none = parseCreateChannel({ name: "Room" }, catalog);
    expect(none.ok).toBe(false);
    if (!none.ok) {
      expect(none.issues).toContainEqual({
        code: "members_min",
        min: CHANNEL_MIN_MEMBERS,
        got: 0,
      });
    }

    const one = parseCreateChannel(
      { name: "Room", member_agent_ids: ["agent-legal"] },
      catalog,
    );
    expect(one.ok).toBe(false);
    if (!one.ok) {
      expect(one.issues).toContainEqual({
        code: "members_min",
        min: CHANNEL_MIN_MEMBERS,
        got: 1,
      });
    }
  });

  it("I5: accepts a required name and two catalog members", () => {
    const parsed = parseCreateChannel(
      { name: "  Review  ", member_agent_ids: ["agent-legal", "agent-ops"] },
      catalog,
    );
    expect(parsed).toEqual({
      ok: true,
      value: {
        name: "Review",
        member_agent_ids: ["agent-legal", "agent-ops"],
      },
    });
  });

  it("rejects unknown member ids", () => {
    const parsed = parseCreateChannel(
      { name: "Room", member_agent_ids: ["agent-legal", "ghost"] },
      catalog,
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues).toContainEqual({
      code: "member_not_found",
      agent_id: "ghost",
    });
  });

  it("rejects duplicate member ids and keeps first-seen order", () => {
    const parsed = parseCreateChannel(
      {
        name: "Room",
        member_agent_ids: ["agent-ops", "agent-legal", "agent-ops"],
      },
      catalog,
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues).toContainEqual({
      code: "members_duplicate",
      agent_id: "agent-ops",
    });
  });

  it("I6: empty catalog cannot satisfy two members", () => {
    const parsed = parseCreateChannel(
      { name: "Room", member_agent_ids: ["a", "b"] },
      new Set(),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(
      parsed.issues.filter((issue) => issue.code === "member_not_found"),
    ).toHaveLength(2);
  });
});

describe("ChatThreadStore.createChannel (lp-cxhb.5)", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDbPath(): string {
    const dir = mkdtempSync(join(tmpdir(), "bff-create-channel-"));
    dirs.push(dir);
    return join(dir, "chat.db");
  }

  it("I4: throws when the roster is below two", () => {
    const store = new ChatThreadStore();
    const legal = store.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Legal",
    });
    expect(() =>
      store.createChannel({
        tenant_id: tenant.tenant_id,
        user_id: userId,
        name: "Too small",
        member_agent_ids: [legal.agent_id],
      }),
    ).toThrow(CreateChannelError);
  });

  it("I5: persists a group thread plus membership pointers", () => {
    const store = new ChatThreadStore();
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

    expect(channel.name).toBe("Deal room");
    expect(channel.thread.kind).toBe("group");
    expect(channel.thread.title).toBe("Deal room");
    expect(channel.lead_agent_id).toBe(legal.agent_id);
    expect(channel.members.map((row) => row.agent_id)).toEqual([
      legal.agent_id,
      ops.agent_id,
    ]);
    expect(store.listAgents(tenant.tenant_id, userId)).toHaveLength(2);
    expect(store.get(legal.thread_id)?.kind).toBe("chat");
    expect(store.get(ops.thread_id)?.kind).toBe("chat");
    const owned = store.listForOwner(tenant.tenant_id, userId);
    expect(owned.filter((row) => row.kind === "group")).toHaveLength(1);
    expect(owned.filter((row) => row.kind === "chat")).toHaveLength(2);
    expect(store.listChannels(tenant.tenant_id, userId)).toEqual([channel]);
  });

  it("I6: two inline-created agents then createChannel succeeds", () => {
    const store = new ChatThreadStore();
    expect(store.listAgents(tenant.tenant_id, userId)).toEqual([]);
    const first = store.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Skip",
    });
    const second = store.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Lev",
    });
    const channel = store.createChannel({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Empty-catalog room",
      member_agent_ids: [first.agent_id, second.agent_id],
    });
    expect(channel.members).toHaveLength(2);
    expect(channel.lead_agent_id).toBe(first.agent_id);
  });

  it("retains channel membership across SQLite restart", () => {
    const dbPath = tempDbPath();
    const store1 = new ChatThreadStore({ dbPath });
    const legal = store1.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Legal",
    });
    const ops = store1.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Ops",
    });
    const created = store1.createChannel({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Durable room",
      member_agent_ids: [ops.agent_id, legal.agent_id],
    });
    store1.close();

    const store2 = new ChatThreadStore({ dbPath });
    try {
      const listed = store2.listChannels(tenant.tenant_id, userId);
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({
        thread_id: created.thread_id,
        name: "Durable room",
        lead_agent_id: ops.agent_id,
      });
      expect(listed[0]?.members.map((row) => row.agent_id)).toEqual([
        ops.agent_id,
        legal.agent_id,
      ]);
      expect(store2.get(created.thread_id)?.kind).toBe("group");
    } finally {
      store2.close();
    }
  });

  it("delete channel keeps durable agents and their 1:1s", () => {
    const store = new ChatThreadStore();
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
      name: "Temp",
      member_agent_ids: [legal.agent_id, ops.agent_id],
    });
    expect(store.delete(channel.thread_id)).toBe(true);
    expect(store.listChannels(tenant.tenant_id, userId)).toEqual([]);
    expect(store.listAgents(tenant.tenant_id, userId)).toHaveLength(2);
    expect(store.get(legal.thread_id)?.kind).toBe("chat");
    expect(store.get(ops.thread_id)?.kind).toBe("chat");
  });
});

describe("POST /api/channels (lp-cxhb.5 I4/I5/I6)", () => {
  async function boot(store?: ChatThreadStore) {
    const chatThreads = store ?? new ChatThreadStore();
    const sessions = new SessionStore();
    const session = await sessions.create({
      userId,
      tenantId: tenant.tenant_id,
      email: "channel@example.com",
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
        instance_id: "inst-create-channel",
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
      lanyard_csrf: "test-csrf-create-channel",
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

  it("I4: POST without two members is 400", async () => {
    const { app, chatThreads, cookies } = await boot();
    const legal = chatThreads.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Legal",
    });
    const res = await app.request("/api/channels", {
      method: "POST",
      headers: headers(cookies),
      body: JSON.stringify({
        name: "Solo",
        member_agent_ids: [legal.agent_id],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      issues: Array<{ code: string }>;
    };
    expect(body.error).toMatch(/at least 2 members/i);
    expect(body.issues.some((issue) => issue.code === "members_min")).toBe(
      true,
    );
    expect(chatThreads.listChannels(tenant.tenant_id, userId)).toEqual([]);
  });

  it("I4: POST without a name is 400", async () => {
    const { app, chatThreads, cookies } = await boot();
    const legal = chatThreads.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Legal",
    });
    const ops = chatThreads.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Ops",
    });
    const res = await app.request("/api/channels", {
      method: "POST",
      headers: headers(cookies),
      body: JSON.stringify({
        member_agent_ids: [legal.agent_id, ops.agent_id],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/name is required/i);
  });

  it("I5: POST with name + two members creates a group channel", async () => {
    const { app, chatThreads, cookies } = await boot();
    const legal = chatThreads.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Legal",
    });
    const ops = chatThreads.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Ops",
    });
    const res = await app.request("/api/channels", {
      method: "POST",
      headers: headers(cookies),
      body: JSON.stringify({
        name: "Deal room",
        member_agent_ids: [legal.agent_id, ops.agent_id],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      thread_id: string;
      name: string;
      kind: string;
      lead_agent_id: string;
      members: Array<{ agent_id: string }>;
    };
    expect(body).toMatchObject({
      name: "Deal room",
      kind: "group",
      lead_agent_id: legal.agent_id,
    });
    expect(body.members.map((row) => row.agent_id)).toEqual([
      legal.agent_id,
      ops.agent_id,
    ]);
    expect(chatThreads.get(body.thread_id)?.kind).toBe("group");

    const listed = await app.request("/api/channels", {
      headers: new Headers({
        host: tenant.host,
        cookie: cookieHeader(cookies),
      }),
    });
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as {
      channels: Array<{ thread_id: string }>;
    };
    expect(listBody.channels).toHaveLength(1);
    expect(listBody.channels[0]?.thread_id).toBe(body.thread_id);
  });

  it("I6: empty catalog, POST /agents twice, then POST /channels", async () => {
    const { app, cookies } = await boot();
    const listedAgents = await app.request("/api/agents", {
      headers: new Headers({
        host: tenant.host,
        cookie: cookieHeader(cookies),
      }),
    });
    expect(listedAgents.status).toBe(200);
    const empty = (await listedAgents.json()) as { agents: unknown[] };
    expect(empty.agents).toEqual([]);

    const a1 = await app.request("/api/agents", {
      method: "POST",
      headers: headers(cookies),
      body: JSON.stringify({ name: "Skip" }),
    });
    const a2 = await app.request("/api/agents", {
      method: "POST",
      headers: headers(cookies),
      body: JSON.stringify({ name: "Lev" }),
    });
    expect(a1.status).toBe(201);
    expect(a2.status).toBe(201);
    const first = (await a1.json()) as { agent_id: string };
    const second = (await a2.json()) as { agent_id: string };

    const channelRes = await app.request("/api/channels", {
      method: "POST",
      headers: headers(cookies),
      body: JSON.stringify({
        name: "Fresh room",
        member_agent_ids: [first.agent_id, second.agent_id],
      }),
    });
    expect(channelRes.status).toBe(201);
    const channel = (await channelRes.json()) as {
      members: Array<{ agent_id: string }>;
    };
    expect(channel.members).toHaveLength(2);
  });
});
