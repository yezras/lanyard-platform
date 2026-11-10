/**
 * lp-cxhb.7 — Channel lead + unmentioned wake stamp (I9).
 *
 * Prove: pnpm -C portal/packages/bff exec vitest run channel-lead
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import {
  parseSetChannelLead,
  SetChannelLeadError,
} from "../src/channel-lead.js";
import { ChatThreadStore } from "../src/chat-store.js";
import { stampGroupDeliverInbound } from "../src/group-inbound-stamp.js";
import { SessionStore } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import { cookieHeader, createTestBindings } from "./test-helpers.js";

const tenant: TenantContext = {
  tenant_id: "tenant-channel-lead",
  tenant_slug: "demo",
  display_name: "Demo",
  host: "demo.withlanyard.com",
};
const userId = "user-channel-lead";

describe("parseSetChannelLead (lp-cxhb.7)", () => {
  const members = new Set(["agent-legal", "agent-ops"]);

  it("accepts a roster member as lead", () => {
    expect(
      parseSetChannelLead({ lead_agent_id: "agent-ops" }, members),
    ).toEqual({
      ok: true,
      value: { lead_agent_id: "agent-ops" },
    });
  });

  it("rejects a missing lead", () => {
    const parsed = parseSetChannelLead({}, members);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues).toContainEqual({ code: "lead_required" });
  });

  it("rejects a non-member lead", () => {
    const parsed = parseSetChannelLead(
      { lead_agent_id: "agent-ghost" },
      members,
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues).toContainEqual({
      code: "lead_not_member",
      agent_id: "agent-ghost",
    });
  });
});

describe("ChatThreadStore.setChannelLead (lp-cxhb.7)", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  function twoMemberChannel(store = new ChatThreadStore()) {
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
    return { store, legal, ops, channel };
  }

  it("create-time lead is the first member", () => {
    const { channel, legal } = twoMemberChannel();
    expect(channel.lead_agent_id).toBe(legal.agent_id);
    expect(channel.thread.orchestrator_persona_id).toBe(legal.agent_id);
  });

  it("moves lead to another member and keeps orchestrator in lockstep", () => {
    const { store, channel, ops } = twoMemberChannel();
    const updated = store.setChannelLead({
      thread_id: channel.thread_id,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      lead_agent_id: ops.agent_id,
    });
    expect(updated?.lead_agent_id).toBe(ops.agent_id);
    expect(updated?.thread.orchestrator_persona_id).toBe(ops.agent_id);
    expect(store.getChannel(channel.thread_id)?.lead_agent_id).toBe(
      ops.agent_id,
    );
  });

  it("is idempotent when the lead is already that member", () => {
    const { store, channel, legal } = twoMemberChannel();
    const again = store.setChannelLead({
      thread_id: channel.thread_id,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      lead_agent_id: legal.agent_id,
    });
    expect(again?.lead_agent_id).toBe(legal.agent_id);
  });

  it("throws when the lead is not a member", () => {
    const { store, channel } = twoMemberChannel();
    expect(() =>
      store.setChannelLead({
        thread_id: channel.thread_id,
        tenant_id: tenant.tenant_id,
        user_id: userId,
        lead_agent_id: "agent-ghost",
      }),
    ).toThrow(SetChannelLeadError);
  });

  it("returns null for a missing channel", () => {
    const store = new ChatThreadStore();
    expect(
      store.setChannelLead({
        thread_id: "missing",
        tenant_id: tenant.tenant_id,
        user_id: userId,
        lead_agent_id: "agent-legal",
      }),
    ).toBeNull();
  });

  it("retains the new lead across SQLite restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "bff-channel-lead-"));
    dirs.push(dir);
    const dbPath = join(dir, "chat.db");
    const store1 = new ChatThreadStore({ dbPath });
    const { channel, ops } = twoMemberChannel(store1);
    store1.setChannelLead({
      thread_id: channel.thread_id,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      lead_agent_id: ops.agent_id,
    });
    store1.close();

    const store2 = new ChatThreadStore({ dbPath });
    try {
      const loaded = store2.getChannel(channel.thread_id);
      expect(loaded?.lead_agent_id).toBe(ops.agent_id);
      expect(loaded?.thread.orchestrator_persona_id).toBe(ops.agent_id);
    } finally {
      store2.close();
    }
  });
});

describe("I9 unmentioned channel inbound stamps lead only", () => {
  function room() {
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
      name: "Review",
      member_agent_ids: [legal.agent_id, ops.agent_id],
    });
    return { store, legal, ops, channel };
  }

  it("I9: no mention stamps target_persona_ids=[lead] and lead_persona_id", () => {
    const { channel, legal, ops } = room();
    const stamp = stampGroupDeliverInbound({
      thread: channel.thread,
      authorUserId: userId,
      authorDisplayName: "Alice",
      text: "Please review the NDA.",
    });
    expect(stamp?.deliveries).toHaveLength(1);
    expect(stamp?.deliveries[0]?.metadata).toEqual({
      target_persona_ids: [legal.agent_id],
      target_persona_id: legal.agent_id,
      lead_persona_id: legal.agent_id,
      wake_reason: "orchestrator",
      mentioned_persona_ids: [],
      mentioned_user_ids: [],
      persona_ids: [legal.agent_id, ops.agent_id],
    });
    expect(stamp?.deliveries[0]?.metadata.target_persona_ids).not.toContain(
      ops.agent_id,
    );
  });

  it("I9: after the user changes lead, unmentioned mail follows the new lead", () => {
    const { store, channel, ops } = room();
    const updated = store.setChannelLead({
      thread_id: channel.thread_id,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      lead_agent_id: ops.agent_id,
    });
    const stamp = stampGroupDeliverInbound({
      thread: updated!.thread,
      authorUserId: userId,
      authorDisplayName: "Alice",
      text: "Please review the NDA.",
    });
    expect(stamp?.deliveries[0]?.metadata.target_persona_ids).toEqual([
      ops.agent_id,
    ]);
    expect(stamp?.deliveries[0]?.metadata.lead_persona_id).toBe(ops.agent_id);
    expect(stamp?.deliveries[0]?.metadata.wake_reason).toBe("orchestrator");
  });
});

describe("PATCH /api/channels/:threadId lead (lp-cxhb.7)", () => {
  async function boot() {
    const chatThreads = new ChatThreadStore();
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
    const channel = chatThreads.createChannel({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Deal room",
      member_agent_ids: [legal.agent_id, ops.agent_id],
    });
    const sessions = new SessionStore();
    const session = await sessions.create({
      userId,
      tenantId: tenant.tenant_id,
      email: "lead@example.com",
    });
    const app = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          sessions,
          chatThreads,
          brainRpcEnabled: false,
          authClient: {
            getUserRbac: async () => ({
              user_id: userId,
              tenant_id: tenant.tenant_id,
              hermes_profile: "default",
              allowed_path_prefixes: ["/"],
              role_names: ["member"],
            }),
            getPrimaryGatewayInstance: async () => ({
              instance_id: "inst-channel-lead",
            }),
            getActiveSessionShare: async () => null,
            listSessionSharesForGrantee: async () => [],
          } as never,
        },
      ),
    );
    const cookies = {
      lanyard_session: session.sessionId,
      lanyard_csrf: "test-csrf-channel-lead",
    };
    return { app, chatThreads, cookies, legal, ops, channel };
  }

  function headers(cookies: Record<string, string>): Headers {
    return new Headers({
      host: tenant.host,
      cookie: cookieHeader(cookies),
      "x-csrf-token": cookies.lanyard_csrf,
      "content-type": "application/json",
    });
  }

  it("GET returns the channel including lead_agent_id", async () => {
    const { app, cookies, channel, legal } = await boot();
    const res = await app.request(`/api/channels/${channel.thread_id}`, {
      headers: new Headers({
        host: tenant.host,
        cookie: cookieHeader(cookies),
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lead_agent_id: string };
    expect(body.lead_agent_id).toBe(legal.agent_id);
  });

  it("PATCH moves lead to another member", async () => {
    const { app, cookies, channel, ops, chatThreads } = await boot();
    const res = await app.request(`/api/channels/${channel.thread_id}`, {
      method: "PATCH",
      headers: headers(cookies),
      body: JSON.stringify({ lead_agent_id: ops.agent_id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lead_agent_id: string };
    expect(body.lead_agent_id).toBe(ops.agent_id);
    expect(chatThreads.get(channel.thread_id)?.orchestrator_persona_id).toBe(
      ops.agent_id,
    );
  });

  it("PATCH with a non-member is 400", async () => {
    const { app, cookies, channel } = await boot();
    const res = await app.request(`/api/channels/${channel.thread_id}`, {
      method: "PATCH",
      headers: headers(cookies),
      body: JSON.stringify({ lead_agent_id: "ghost" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      issues: Array<{ code: string }>;
    };
    expect(body.issues.some((issue) => issue.code === "lead_not_member")).toBe(
      true,
    );
  });

  it("I9: POST unmentioned message stamps target_persona_ids=[lead]", async () => {
    const chatThreads = new ChatThreadStore();
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
    const channel = chatThreads.createChannel({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Review",
      member_agent_ids: [legal.agent_id, ops.agent_id],
    });
    const sessions = new SessionStore();
    const session = await sessions.create({
      userId,
      tenantId: tenant.tenant_id,
      email: "lead@example.com",
    });
    const deliverInbound = vi.fn(async () => ({ ok: true as const }));
    const app = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          sessions,
          chatThreads,
          brainRpcEnabled: false,
          authClient: {
            getUserRbac: async () => ({
              user_id: userId,
              tenant_id: tenant.tenant_id,
              hermes_profile: "default",
              allowed_path_prefixes: ["/"],
              role_names: ["member"],
            }),
            getPrimaryGatewayInstance: async () => ({
              instance_id: "inst-channel-lead-deliver",
            }),
            getActiveSessionShare: async () => null,
            listSessionSharesForGrantee: async () => [],
          } as never,
          relayClient: { deliverInbound } as never,
        },
      ),
    );
    const cookies = {
      lanyard_session: session.sessionId,
      lanyard_csrf: "test-csrf-channel-lead-deliver",
    };

    const first = await app.request(
      `/api/chat/threads/${channel.thread_id}/messages`,
      {
        method: "POST",
        headers: headers(cookies),
        body: JSON.stringify({ text: "Please review the NDA." }),
      },
    );
    expect(first.status).toBe(200);
    expect(deliverInbound).toHaveBeenCalledOnce();
    const firstMeta = (
      deliverInbound.mock.calls[0]?.[0] as {
        event?: { metadata?: Record<string, unknown> };
      }
    )?.event?.metadata;
    expect(firstMeta?.target_persona_ids).toEqual([legal.agent_id]);
    expect(firstMeta?.lead_persona_id).toBe(legal.agent_id);
    expect(firstMeta?.wake_reason).toBe("orchestrator");

    const patched = await app.request(`/api/channels/${channel.thread_id}`, {
      method: "PATCH",
      headers: headers(cookies),
      body: JSON.stringify({ lead_agent_id: ops.agent_id }),
    });
    expect(patched.status).toBe(200);

    deliverInbound.mockClear();
    const second = await app.request(
      `/api/chat/threads/${channel.thread_id}/messages`,
      {
        method: "POST",
        headers: headers(cookies),
        body: JSON.stringify({ text: "Please review the NDA again." }),
      },
    );
    expect(second.status).toBe(200);
    expect(deliverInbound).toHaveBeenCalledOnce();
    const secondMeta = (
      deliverInbound.mock.calls[0]?.[0] as {
        event?: { metadata?: Record<string, unknown> };
      }
    )?.event?.metadata;
    expect(secondMeta?.target_persona_ids).toEqual([ops.agent_id]);
    expect(secondMeta?.lead_persona_id).toBe(ops.agent_id);
  });
});
