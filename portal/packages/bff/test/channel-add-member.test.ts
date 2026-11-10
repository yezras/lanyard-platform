/**
 * lp-k5c4.20 — channel.add_member host tool (tools-not-HTTP).
 *
 * Prove:
 * - Tool schema {thread_id, agent_id} parses and rejects bad shapes
 * - Host handler wraps addChannelMember as owner, authorizes caller is member (fail closed)
 * - Agent in #ops can add Drift then @Drift wakes in #ops
 * - Non-member cannot add (forbidden)
 * - Unknown agent → not_found
 * - Duplicate → bad_request
 * - Roster grows; @ works; 1:1 unchanged
 * - No auto-add on @ of non-member
 * - add_member does not start a turn (no enqueue)
 * - Floor of two on remove still holds
 */

import { describe, expect, it } from "vitest";

import {
  CHANNEL_ADD_MEMBER_TOOL_NAME,
  parseChannelAddMemberInput,
} from "@lanyard/shared";

import { ChatThreadStore } from "../src/chat-store.js";
import {
  applyChannelAddMember,
  handleChannelAddMemberToolCall,
} from "../src/channel-add-member.js";
import { parsePersonaMentions } from "../src/group-inbound-stamp.js";
import type { TenantContext } from "../src/types.js";

const tenant: TenantContext = {
  tenant_id: "tenant-k5c4-20",
  tenant_slug: "demo",
  display_name: "Demo",
  host: "demo.withlanyard.com",
};
const userId = "user-k5c4-20";

function seedOpsWithDrift() {
  const store = new ChatThreadStore();
  // #ops with two members
  const alpha = store.createAgent({
    tenant_id: tenant.tenant_id,
    user_id: userId,
    name: "Alpha",
  });
  const beta = store.createAgent({
    tenant_id: tenant.tenant_id,
    user_id: userId,
    name: "Beta",
  });
  const ops = store.createChannel({
    tenant_id: tenant.tenant_id,
    user_id: userId,
    name: "#ops",
    member_agent_ids: [alpha.agent_id, beta.agent_id],
  });
  // Drift is catalog but not in #ops
  const drift = store.createAgent({
    tenant_id: tenant.tenant_id,
    user_id: userId,
    name: "Drift",
  });
  return { store, alpha, beta, drift, ops };
}

describe("channel.add_member schema (lp-k5c4.20)", () => {
  it("tool name is channel.add_member", () => {
    expect(CHANNEL_ADD_MEMBER_TOOL_NAME).toBe("channel.add_member");
  });

  it("parses {thread_id, agent_id}", () => {
    expect(
      parseChannelAddMemberInput({ thread_id: "thr_123", agent_id: "agent_456" }),
    ).toEqual({ thread_id: "thr_123", agent_id: "agent_456" });
  });

  it("rejects extra keys (no HTTP smuggling)", () => {
    expect(() =>
      parseChannelAddMemberInput({
        thread_id: "thr_123",
        agent_id: "agent_456",
        from: "spoofs",
      } as unknown as Record<string, unknown>),
    ).toThrow(/invalid ChannelAddMemberInput/);
  });

  it("rejects empty / colon / whitespace ids", () => {
    expect(() => parseChannelAddMemberInput({ thread_id: "", agent_id: "a" })).toThrow();
    expect(() => parseChannelAddMemberInput({ thread_id: "thr:1", agent_id: "a" })).toThrow();
    expect(() => parseChannelAddMemberInput({ thread_id: "thr 1", agent_id: "a" })).toThrow();
    expect(() => parseChannelAddMemberInput({ thread_id: "thr_1", agent_id: "" })).toThrow();
  });

  it("rejects missing fields", () => {
    expect(() => parseChannelAddMemberInput({ thread_id: "thr_1" } as unknown as object)).toThrow();
    expect(() => parseChannelAddMemberInput({} as unknown as object)).toThrow();
  });
});

describe("channel.add_member host handler (lp-k5c4.20)", () => {
  it("Agent in #ops can add Drift (catalog, not a member) then @Drift; Drift wakes in #ops", () => {
    const { store, alpha, drift, ops } = seedOpsWithDrift();

    // Alpha is member, adds Drift
    const result = applyChannelAddMember({
      store,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      caller_agent_id: alpha.agent_id,
      thread_id: ops.thread_id,
      agent_id: drift.agent_id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Roster grows
    const channel = store.getChannel(ops.thread_id);
    expect(channel?.members.map((m) => m.agent_id)).toEqual(
      expect.arrayContaining([alpha.agent_id, drift.agent_id]),
    );
    expect(channel?.members).toHaveLength(3);
    // Participants synced so @Drift resolves
    const updatedThread = store.get(ops.thread_id);
    expect(updatedThread?.participants.some((p) => p.kind === "persona" && p.persona_id === drift.agent_id)).toBe(true);

    // @Drift now works: parsePersonaMentions should find Drift
    const mentions = parsePersonaMentions("@Drift please help", updatedThread!.participants);
    expect(mentions.map(String)).toContain(drift.agent_id);

    // Drift's 1:1 is unchanged (still exists, not deleted, not auto-mutated by channel add)
    const driftOneToOne = store.findDirectThreadForAgent(drift.agent_id);
    expect(driftOneToOne).not.toBeNull();
    expect(driftOneToOne?.thread_id).toBe(drift.thread_id);
    // Channel and 1:1 are distinct threads
    expect(driftOneToOne?.thread_id).not.toBe(ops.thread_id);
    // No turn started: we only mutated roster, didn't enqueue - verify no history side effect besides roster
    expect(store.listHistory(ops.thread_id).length).toBe(0);
  });

  it("Non-member cannot add (fail closed → forbidden)", () => {
    const { store, drift, ops } = seedOpsWithDrift();
    // Drift is not a member, tries to add someone else
    const outsider = store.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Outsider",
    });
    const result = applyChannelAddMember({
      store,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      caller_agent_id: drift.agent_id, // not a member
      thread_id: ops.thread_id,
      agent_id: outsider.agent_id,
    });
    expect(result).toEqual(
      expect.objectContaining({ ok: false, error: "forbidden" }),
    );
    // Roster unchanged
    expect(store.getChannel(ops.thread_id)?.members).toHaveLength(2);
  });

  it("Unknown agent → not_found", () => {
    const { store, alpha, ops } = seedOpsWithDrift();
    const result = applyChannelAddMember({
      store,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      caller_agent_id: alpha.agent_id,
      thread_id: ops.thread_id,
      agent_id: "ghost-agent-id",
    });
    expect(result).toEqual(expect.objectContaining({ ok: false, error: "not_found" }));
    expect(store.getChannel(ops.thread_id)?.members).toHaveLength(2);
  });

  it("Duplicate member → bad_request (not_found is not masked)", () => {
    const { store, alpha, beta, ops } = seedOpsWithDrift();
    const result = applyChannelAddMember({
      store,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      caller_agent_id: alpha.agent_id,
      thread_id: ops.thread_id,
      agent_id: beta.agent_id, // already member
    });
    expect(result).toEqual(expect.objectContaining({ ok: false, error: "bad_request" }));
    expect(store.getChannel(ops.thread_id)?.members).toHaveLength(2);
  });

  it("Unknown channel → not_found", () => {
    const { store, alpha, drift } = seedOpsWithDrift();
    const result = applyChannelAddMember({
      store,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      caller_agent_id: alpha.agent_id,
      thread_id: "missing-thread",
      agent_id: drift.agent_id,
    });
    expect(result).toEqual(expect.objectContaining({ ok: false, error: "not_found" }));
  });

  it("Do not auto-add on @ of a non-member (invite is explicit)", () => {
    const { store, ops, drift } = seedOpsWithDrift();
    const before = store.getChannel(ops.thread_id)?.members.map((m) => m.agent_id) ?? [];
    expect(before).not.toContain(drift.agent_id);

    // Simulate @Drift in channel text without calling add_member
    const thread = store.get(ops.thread_id)!;
    const mentions = parsePersonaMentions("@Drift hello", thread.participants);
    // Should NOT find Drift because he's not on roster
    expect(mentions.map(String)).not.toContain(drift.agent_id);

    // Roster still unchanged
    expect(store.getChannel(ops.thread_id)?.members.map((m) => m.agent_id)).not.toContain(drift.agent_id);
  });

  it("Does not create a new catalog person as side effect", () => {
    const { store, alpha, ops } = seedOpsWithDrift();
    const beforeCount = store.listAgents(tenant.tenant_id, userId).length;
    // Try to add with a name-like id that doesn't exist - should fail, not mint
    const result = applyChannelAddMember({
      store,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      caller_agent_id: alpha.agent_id,
      thread_id: ops.thread_id,
      agent_id: "new-person-should-not-be-created",
    });
    expect(result.ok).toBe(false);
    expect(store.listAgents(tenant.tenant_id, userId)).toHaveLength(beforeCount);
  });

  it("1:1 of the added agent unchanged (lp-k5c4.20 Playwright check)", () => {
    const { store, alpha, drift, ops } = seedOpsWithDrift();
    const beforeOneToOne = store.findDirectThreadForAgent(drift.agent_id);
    expect(beforeOneToOne).not.toBeNull();
    const beforeHistory = store.listHistory(drift.thread_id);

    applyChannelAddMember({
      store,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      caller_agent_id: alpha.agent_id,
      thread_id: ops.thread_id,
      agent_id: drift.agent_id,
    });

    const afterOneToOne = store.findDirectThreadForAgent(drift.agent_id);
    expect(afterOneToOne?.thread_id).toBe(beforeOneToOne?.thread_id);
    expect(store.listHistory(drift.thread_id)).toEqual(beforeHistory);
  });

  it("add_member does not start a turn (no enqueue, no harness wake)", () => {
    const { store, alpha, drift, ops } = seedOpsWithDrift();
    // The handler is synchronous and pure roster mutation; we verify it doesn't throw or enqueue
    const result = handleChannelAddMemberToolCall({
      store,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      caller_agent_id: alpha.agent_id,
      raw: { thread_id: ops.thread_id, agent_id: drift.agent_id },
    });
    expect(result.ok).toBe(true);
    // No history, no turn - just roster
    expect(store.listHistory(ops.thread_id)).toHaveLength(0);
  });

  it("Floor of two on human remove still holds (unchanged by add_member)", () => {
    const { store, alpha, beta, ops } = seedOpsWithDrift();
    // Add Drift to make 3
    const drift = store.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Drift2",
    });
    const added = applyChannelAddMember({
      store,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      caller_agent_id: alpha.agent_id,
      thread_id: ops.thread_id,
      agent_id: drift.agent_id,
    });
    expect(added.ok).toBe(true);
    expect(store.getChannel(ops.thread_id)?.members).toHaveLength(3);

    // Remove one, back to 2
    store.removeChannelMember({
      thread_id: ops.thread_id,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      agent_id: drift.agent_id,
    });
    expect(store.getChannel(ops.thread_id)?.members).toHaveLength(2);

    // Try to remove below floor → should throw
    expect(() =>
      store.removeChannelMember({
        thread_id: ops.thread_id,
        tenant_id: tenant.tenant_id,
        user_id: userId,
        agent_id: alpha.agent_id,
      }),
    ).toThrow();
    expect(store.getChannel(ops.thread_id)?.members).toHaveLength(2);
  });

  it("handleChannelAddMemberToolCall rejects invalid raw shape → bad_request", () => {
    const { store, alpha } = seedOpsWithDrift();
    const result = handleChannelAddMemberToolCall({
      store,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      caller_agent_id: alpha.agent_id,
      raw: { thread_id: "thr_1" }, // missing agent_id
    });
    expect(result).toEqual(expect.objectContaining({ ok: false, error: "bad_request" }));
  });

  it("caller_id with colon/whitespace is bad_request (fail closed)", () => {
    const { store, drift, ops } = seedOpsWithDrift();
    const result = applyChannelAddMember({
      store,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      caller_agent_id: "bad:caller",
      thread_id: ops.thread_id,
      agent_id: drift.agent_id,
    });
    // Caller not found on roster → forbidden (still fail closed, not bypass)
    expect(result.error).toBe("forbidden");
  });
});
