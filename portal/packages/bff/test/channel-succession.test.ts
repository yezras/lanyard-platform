/**
 * lp-cxhb.9 — P8: lead succession on lead removal (I12).
 *
 * LLM picks the successor from the channel log + remaining objectives
 * (fake picker here — never a live model). Fail/timeout falls back to
 * longest join time (picker order tie-break). A system notice
 * "Lead is now X" is always posted to the channel log. Removal is never
 * blocked on the model.
 *
 * Prove: pnpm -C portal/packages/bff exec vitest run channel-succession
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LEAD_SUCCESSION_TIMEOUT_MS,
  resolveLeadSuccessor,
  tenureSuccessorAgentId,
  type SuccessionContext,
} from "../src/channel-succession.js";
import { createApp } from "../src/app.js";
import { ChatThreadStore } from "../src/chat-store.js";
import { SessionStore } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import { cookieHeader, createTestBindings } from "./test-helpers.js";

const tenant: TenantContext = {
  tenant_id: "tenant-succession",
  tenant_slug: "demo",
  display_name: "Demo",
  host: "demo.withlanyard.com",
};
const userId = "usr_succession";

function ctx(overrides: Partial<SuccessionContext> = {}): SuccessionContext {
  return {
    channel_name: "Deal room",
    log: [
      { speaker: "Alice", content: "@Legal please review" },
      { speaker: "Legal", content: "On it — contract risk is low." },
    ],
    candidates: [
      { agent_id: "ops", name: "Ops", objective: "Run ops", joined_at: "2026-01-02T00:00:00Z" },
      { agent_id: "fin", name: "Fin", objective: "Own budget", joined_at: "2026-01-03T00:00:00Z" },
    ],
    ...overrides,
  };
}

describe("tenureSuccessorAgentId (lp-cxhb.9 I12)", () => {
  it("picks the longest-serving remaining member", () => {
    expect(tenureSuccessorAgentId(ctx().candidates)).toBe("ops");
  });

  it("tie-breaks on picker order (first wins)", () => {
    const tied = [
      { agent_id: "b", joined_at: "2026-01-01T00:00:00Z" },
      { agent_id: "a", joined_at: "2026-01-01T00:00:00Z" },
    ];
    expect(tenureSuccessorAgentId(tied)).toBe("b");
  });

  it("is null with no candidates", () => {
    expect(tenureSuccessorAgentId([])).toBeNull();
  });
});

describe("resolveLeadSuccessor (lp-cxhb.9 I12)", () => {
  it("uses a valid fake picker pick", async () => {
    const result = await resolveLeadSuccessor({
      picker: (input) => input.candidates[1]?.agent_id,
      context: ctx(),
    });
    expect(result).toEqual({ agent_id: "fin", source: "picker" });
  });

  it("falls back to tenure when the picker returns an unknown id", async () => {
    const result = await resolveLeadSuccessor({
      picker: () => "ghost",
      context: ctx(),
    });
    expect(result).toEqual({ agent_id: "ops", source: "tenure" });
  });

  it("falls back to tenure when the picker returns null", async () => {
    const result = await resolveLeadSuccessor({
      picker: () => null,
      context: ctx(),
    });
    expect(result).toEqual({ agent_id: "ops", source: "tenure" });
  });

  it("falls back to tenure when the picker throws", async () => {
    const result = await resolveLeadSuccessor({
      picker: () => {
        throw new Error("model exploded");
      },
      context: ctx(),
    });
    expect(result).toEqual({ agent_id: "ops", source: "tenure" });
  });

  it("never blocks on the model: hanging picker times out to tenure", async () => {
    const started = Date.now();
    const result = await resolveLeadSuccessor({
      picker: () => new Promise<string>(() => {}),
      context: ctx(),
      timeoutMs: 25,
    });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result).toEqual({ agent_id: "ops", source: "tenure" });
  });

  it("with no picker, tenure applies without any model call", async () => {
    const result = await resolveLeadSuccessor({ context: ctx() });
    expect(result).toEqual({ agent_id: "ops", source: "tenure" });
  });

  it("is null with no candidates", async () => {
    expect(
      await resolveLeadSuccessor({ picker: () => "ops", context: ctx({ candidates: [] }) }),
    ).toBeNull();
  });

  it("exposes the default timeout constant", () => {
    expect(DEFAULT_LEAD_SUCCESSION_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe("ChatThreadStore lead succession (lp-cxhb.9 I12)", () => {
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
    const fin = store.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Fin",
    });
    const channel = store.createChannel({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Deal room",
      member_agent_ids: [legal.agent_id, ops.agent_id],
    });
    store.addChannelMember({
      thread_id: channel.thread_id,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      agent_id: fin.agent_id,
    });
    return { store, legal, ops, fin, channel };
  }

  it("I12: removing the lead honors a supplied successor", () => {
    const { store, legal, fin, channel } = room();
    const next = store.removeChannelMember({
      thread_id: channel.thread_id,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      agent_id: legal.agent_id,
      successor_agent_id: fin.agent_id,
    });
    expect(next.lead_agent_id).toBe(fin.agent_id);
    const notice = store
      .listHistory(channel.thread_id)
      .find((event) => event.type === "system_notice");
    expect(notice?.type === "system_notice" && notice.content).toContain(
      "Fin",
    );
  });

  /** Longest-tenured remaining member once `lead` leaves the room. */
  function tenureAfterLeadLeaves(
    store: ChatThreadStore,
    channel: { thread_id: string },
    leadId: string,
  ): string {
    const remaining =
      store
        .getChannel(channel.thread_id)
        ?.members.filter((member) => member.agent_id !== leadId) ?? [];
    return [...remaining].sort((a, b) =>
      a.joined_at.localeCompare(b.joined_at),
    )[0]!.agent_id;
  }

  it("I12: removing the lead without a picker falls back to longest tenure", () => {
    const { store, legal, channel } = room();
    const expected = tenureAfterLeadLeaves(store, channel, legal.agent_id);
    const next = store.removeChannelMember({
      thread_id: channel.thread_id,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      agent_id: legal.agent_id,
    });
    expect(next.lead_agent_id).toBe(expected);
    const notice = store
      .listHistory(channel.thread_id)
      .find((event) => event.type === "system_notice");
    expect(notice?.type === "system_notice" && notice.content).toContain(
      "Lead is now",
    );
  });

  it("I12: an invalid successor id falls back to tenure", () => {
    const { store, legal, channel } = room();
    const expected = tenureAfterLeadLeaves(store, channel, legal.agent_id);
    const next = store.removeChannelMember({
      thread_id: channel.thread_id,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      agent_id: legal.agent_id,
      successor_agent_id: "ghost",
    });
    expect(next.lead_agent_id).toBe(expected);
  });

  it("removing a non-lead member keeps the lead and posts no notice", () => {
    const { store, legal, fin, channel } = room();
    const before = store.listHistory(channel.thread_id);
    const next = store.removeChannelMember({
      thread_id: channel.thread_id,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      agent_id: fin.agent_id,
    });
    expect(next.lead_agent_id).toBe(legal.agent_id);
    expect(store.listHistory(channel.thread_id)).toHaveLength(before.length);
  });
});

describe("HTTP lead succession (lp-cxhb.9 I12)", () => {
  async function boot(overrides: Record<string, unknown> = {}) {
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
    const fin = chatThreads.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Fin",
    });
    const channel = chatThreads.createChannel({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Deal room",
      member_agent_ids: [legal.agent_id, ops.agent_id],
    });
    chatThreads.addChannelMember({
      thread_id: channel.thread_id,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      agent_id: fin.agent_id,
    });
    chatThreads.appendHistory(channel.thread_id, {
      type: "user_message",
      message_id: "m-seed",
      content: "@Legal please review the MSA.",
      created_at: new Date().toISOString(),
      chat_id: channel.thread_id,
    });
    const sessions = new SessionStore();
    const session = await sessions.create({
      userId,
      tenantId: tenant.tenant_id,
      email: "succession@example.com",
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
              instance_id: "inst-succession",
            }),
            getActiveSessionShare: async () => null,
            listSessionSharesForGrantee: async () => [],
          } as never,
          leadSuccessionTimeoutMs: 25,
          ...overrides,
        },
      ),
    );
    const cookies = {
      lanyard_session: session.sessionId,
      lanyard_csrf: "test-csrf-succession",
    };
    return { app, chatThreads, cookies, legal, ops, fin, channel };
  }

  function deleteMember(
    app: ReturnType<typeof createApp>,
    threadId: string,
    agentId: string,
    cookies: Record<string, string>,
  ) {
    return app.request(`/api/channels/${threadId}/members/${agentId}`, {
      method: "DELETE",
      headers: new Headers({
        host: tenant.host,
        cookie: cookieHeader(cookies),
        "x-csrf-token": cookies.lanyard_csrf,
      }),
    });
  }

  it("I12: fake picker selects the successor from log + objectives", async () => {
    let sawChannelName = "";
    const { app, chatThreads, cookies, legal, fin, channel } = await boot({
      leadSuccessionPicker: (context: {
        channel_name: string;
        candidates: Array<{ agent_id: string; objective?: string }>;
      }) => {
        sawChannelName = context.channel_name;
        expect(context.candidates.map((c) => c.agent_id)).toContain(
          fin.agent_id,
        );
        return context.candidates[1]?.agent_id ?? null;
      },
    });
    const res = await deleteMember(app, channel.thread_id, legal.agent_id, cookies);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lead_agent_id: string };
    expect(sawChannelName).toBe("Deal room");
    expect(body.lead_agent_id).not.toBe(legal.agent_id);
    const notice = chatThreads
      .listHistory(channel.thread_id)
      .find((event) => event.type === "system_notice");
    expect(notice).toBeDefined();
  });

  it("I12: hanging picker times out to tenure; removal still succeeds", async () => {
    const { app, chatThreads, cookies, legal, channel } = await boot({
      leadSuccessionPicker: () => new Promise<string>(() => {}),
    });
    const remaining =
      chatThreads
        .getChannel(channel.thread_id)
        ?.members.filter((member) => member.agent_id !== legal.agent_id) ?? [];
    const tenureId = [...remaining].sort((a, b) =>
      a.joined_at.localeCompare(b.joined_at),
    )[0]!.agent_id;
    const started = Date.now();
    const res = await deleteMember(app, channel.thread_id, legal.agent_id, cookies);
    expect(res.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(2_000);
    const body = (await res.json()) as { lead_agent_id: string };
    expect(body.lead_agent_id).toBe(tenureId);
    const notice = chatThreads
      .listHistory(channel.thread_id)
      .find((event) => event.type === "system_notice");
    expect(notice?.type === "system_notice").toBe(true);
  });

  it("I12: no picker configured → tenure fallback, no model needed", async () => {
    const { app, chatThreads, cookies, legal, channel } = await boot();
    const res = await deleteMember(app, channel.thread_id, legal.agent_id, cookies);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lead_agent_id: string };
    expect(body.lead_agent_id).not.toBe(legal.agent_id);
    const notice = chatThreads
      .listHistory(channel.thread_id)
      .find((event) => event.type === "system_notice");
    expect(notice).toBeDefined();
  });

  it("removing a non-lead member does not consult the picker", async () => {
    let called = false;
    const { app, cookies, fin, channel } = await boot({
      leadSuccessionPicker: () => {
        called = true;
        return null;
      },
    });
    const res = await deleteMember(app, channel.thread_id, fin.agent_id, cookies);
    expect(res.status).toBe(200);
    expect(called).toBe(false);
  });
});
