/**
 * lp-cxhb.8 — P7: @ wake only in channels (I10/I11).
 *
 * I10: `@Legal` in a channel stamps exactly Legal (`target_persona_ids`).
 *      Legal is lead here; `@Ops` wakes Ops only (lp-k5c4.15 named @s).
 * I11: `@Legal` in a 1:1 does not start a Legal turn — no group stamp,
 *      no fan-out delivery to the mentioned non-member agent.
 *
 * Prove: pnpm -C portal/packages/bff exec vitest run mention-wake-channel
 */
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { ChatThreadStore } from "../src/chat-store.js";
import { stampGroupDeliverInbound } from "../src/group-inbound-stamp.js";
import { SessionStore } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import { cookieHeader, createTestBindings } from "./test-helpers.js";

const tenant: TenantContext = {
  tenant_id: "tenant-mention-wake",
  tenant_slug: "demo",
  display_name: "Demo",
  host: "demo.withlanyard.com",
};
const userId = "usr_mention_wake";

function roomWithLegalAndOps() {
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
  return { store, legal, ops, channel };
}

describe("channel mention wake (lp-cxhb.8 I10)", () => {
  it("I10: @Legal in a channel stamps exactly Legal", () => {
    const { legal, ops, channel } = roomWithLegalAndOps();
    const stamp = stampGroupDeliverInbound({
      thread: channel.thread,
      authorUserId: userId,
      authorDisplayName: "Alice",
      text: "@Legal please review the NDA.",
    });
    expect(stamp).not.toBeNull();
    expect(stamp?.decision.reason).toBe("mention");
    expect(stamp?.deliveries).toHaveLength(1);
    expect(stamp?.deliveries[0]?.targetPersonaId).toBe(legal.agent_id);
    expect(stamp?.deliveries[0]?.metadata.target_persona_ids).toEqual([
      legal.agent_id,
    ]);
    expect(stamp?.deliveries[0]?.metadata.target_persona_ids).not.toContain(
      ops.agent_id,
    );
    expect(stamp?.deliveries[0]?.metadata.wake_reason).toBe("mention");
    expect(stamp?.mentionedPersonaIds).toEqual([legal.agent_id]);
  });

  it("I10: @Ops in a channel wakes Ops only (not lead)", () => {
    const { legal, ops, channel } = roomWithLegalAndOps();
    const stamp = stampGroupDeliverInbound({
      thread: channel.thread,
      authorUserId: userId,
      authorDisplayName: "Alice",
      text: "@Ops please take this",
    });
    expect(stamp?.decision.reason).toBe("mention");
    expect(stamp?.deliveries.map((row) => row.targetPersonaId)).toEqual([
      ops.agent_id,
    ]);
    expect(stamp?.deliveries[0]?.metadata.target_persona_ids).toEqual([
      ops.agent_id,
    ]);
    expect(stamp?.deliveries[0]?.metadata.target_persona_ids).not.toContain(
      legal.agent_id,
    );
    expect(stamp?.mentionedPersonaIds).toEqual([ops.agent_id]);
  });

  it("I10: @legal matches display name case-insensitively", () => {
    const { legal, channel } = roomWithLegalAndOps();
    const stamp = stampGroupDeliverInbound({
      thread: channel.thread,
      authorUserId: userId,
      authorDisplayName: "Alice",
      text: "ping @legal — thoughts?",
    });
    expect(stamp?.deliveries[0]?.metadata.target_persona_ids).toEqual([
      legal.agent_id,
    ]);
  });

  it("I10: multiple @ mentions fan out one delivery per target", () => {
    const { legal, ops, channel } = roomWithLegalAndOps();
    const stamp = stampGroupDeliverInbound({
      thread: channel.thread,
      authorUserId: userId,
      authorDisplayName: "Alice",
      text: "@Legal @Ops both of you on this",
    });
    expect(stamp?.decision.reason).toBe("mention");
    expect(stamp?.deliveries.map((row) => row.targetPersonaId)).toEqual([
      legal.agent_id,
      ops.agent_id,
    ]);
    for (const delivery of stamp?.deliveries ?? []) {
      expect(delivery.metadata.target_persona_ids).toEqual([
        legal.agent_id,
        ops.agent_id,
      ]);
      expect(delivery.metadata.wake_reason).toBe("mention");
    }
  });

  it("I10: unknown @ token falls back to lead, not a phantom agent", () => {
    const { legal, channel } = roomWithLegalAndOps();
    const stamp = stampGroupDeliverInbound({
      thread: channel.thread,
      authorUserId: userId,
      authorDisplayName: "Alice",
      text: "@ghost anyone home?",
    });
    expect(stamp?.decision.reason).toBe("orchestrator");
    expect(stamp?.deliveries[0]?.metadata.target_persona_ids).toEqual([
      legal.agent_id,
    ]);
  });
});

describe("1:1 mention inertness (lp-cxhb.8 I11)", () => {
  it("I11: stampGroupDeliverInbound is null on a 1:1 even with @Name", () => {
    const { store, ops } = roomWithLegalAndOps();
    const oneToOne = store.get(ops.thread_id);
    expect(oneToOne?.kind).toBe("chat");
    const stamp = stampGroupDeliverInbound({
      thread: oneToOne!,
      authorUserId: userId,
      authorDisplayName: "Alice",
      text: "@Legal what do you think?",
    });
    expect(stamp).toBeNull();
  });

  it("I11: POST @Legal into a 1:1 wakes only that thread's agent", async () => {
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
    const sessions = new SessionStore();
    const session = await sessions.create({
      userId,
      tenantId: tenant.tenant_id,
      email: "mentions@example.com",
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
              instance_id: "inst-mention-wake",
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
      lanyard_csrf: "test-csrf-mention-wake",
    };
    const res = await app.request(
      `/api/chat/threads/${legal.thread_id}/messages`,
      {
        method: "POST",
        headers: {
          host: tenant.host,
          "content-type": "application/json",
          cookie: cookieHeader(cookies),
          "x-csrf-token": cookies.lanyard_csrf,
        },
        body: JSON.stringify({ text: "@Ops please take this over" }),
      },
    );
    expect(res.status).toBe(200);
    expect(deliverInbound).toHaveBeenCalledOnce();

    const event = (deliverInbound.mock.calls[0]?.[0] as { event?: Record<string, unknown> })
      ?.event;
    const metadata = event?.metadata as Record<string, unknown> | undefined;
    expect(metadata?.target_persona_ids).toBeUndefined();
    expect(metadata?.target_persona_id).toBeUndefined();
    expect(metadata?.wake_reason).toBeUndefined();

    expect(ops.thread_id).not.toBe(legal.thread_id);
    const history = chatThreads.listHistory(legal.thread_id);
    expect(history.some((row) => row.type === "message_send")).toBe(false);
  });
});
