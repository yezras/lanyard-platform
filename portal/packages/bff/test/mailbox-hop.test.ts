/**
 * lp-v62i.3.3 — 1:1 hop membership hole, mint, origin notice.
 *
 * Prove: pnpm --filter @lanyard/bff exec vitest run mailbox-hop
 */
import { describe, expect, it, vi } from "vitest";

import { parseMailboxAppendRequest } from "@lanyard/shared";

import {
  ChatThreadStore,
  InvalidGroupThreadError,
  type ChatThread,
} from "../src/chat-store.js";
import {
  applyMailboxHop,
  mailboxHopOriginSentNotice,
  mailboxHopWakePayload,
} from "../src/mailbox-hop.js";

const tenantId = "tenant-mailbox-hop";
const userId = "usr_jack";

function parseSend(input: {
  from: string;
  to: string;
  room: string;
  text?: string;
  nonce?: string;
}) {
  return parseMailboxAppendRequest({
    from: input.from,
    to: input.to,
    room: input.room,
    text: input.text ?? "can you take this?",
    nonce: input.nonce ?? "nonce-1",
    tenant_id: tenantId,
  });
}

function seedBillAndFizz(store = new ChatThreadStore()) {
  const bill = store.createAgent({
    tenant_id: tenantId,
    user_id: userId,
    name: "Bill",
    objective: "Lead the room.",
  });
  const fizz = store.createAgent({
    tenant_id: tenantId,
    user_id: userId,
    name: "Fizz",
    objective: "Ship it.",
  });
  return { store, bill, fizz };
}

function dropDirectThreadKeepingAgent(
  store: ChatThreadStore,
  agentId: string,
): string {
  const thread = store.findDirectThreadForAgent(agentId);
  if (!thread) {
    throw new Error(`expected 1:1 for ${agentId}`);
  }
  const internals = store as unknown as {
    threads: Map<string, ChatThread>;
    history: Map<string, unknown>;
  };
  internals.threads.delete(thread.thread_id);
  internals.history.delete(thread.thread_id);
  return thread.thread_id;
}

describe("mailboxHopOriginSentNotice", () => {
  it("is Sent to display name plus text, never the old hop sentence or raw id", () => {
    expect(mailboxHopOriginSentNotice("Fizz", "can you take this?")).toBe(
      "Sent to Fizz\ncan you take this?",
    );
    expect(mailboxHopOriginSentNotice("Fizz", "can you take this?")).not.toContain(
      "A message has been sent",
    );
    expect(mailboxHopOriginSentNotice("Bill", "ping")).not.toMatch(
      /agt_|[0-9a-f]{8}-[0-9a-f]{4}-/i,
    );
  });
});

describe("applyMailboxHop 1:1 (lp-v62i.3.3)", () => {
  it("resolves to by display name when userId is passed (lp-v62i.19.2)", () => {
    const { store, bill, fizz } = seedBillAndFizz();
    const result = applyMailboxHop(
      store,
      parseSend({ from: bill.agent_id, to: "Fizz", room: bill.thread_id }),
      userId,
    );
    expect(result).toMatchObject({
      ok: true,
      mode: "one_to_one",
      wake_to: fizz.agent_id,
      target_thread_id: fizz.thread_id,
    });
  });

  it("reuses Jack↔Fizz, authorizes wake, and notices Bill's 1:1", () => {
    const { store, bill, fizz } = seedBillAndFizz();
    const result = applyMailboxHop(
      store,
      parseSend({ from: bill.agent_id, to: fizz.agent_id, room: bill.thread_id }),
    );

    expect(result).toMatchObject({
      ok: true,
      mode: "one_to_one",
      target_thread_id: fizz.thread_id,
      origin_thread_id: bill.thread_id,
      minted: false,
      wake_to: fizz.agent_id,
      allow_from_bubble: false,
    });
    if (!result.ok || result.mode !== "one_to_one") return;

    const origin = store.listHistory(bill.thread_id);
    expect(origin).toHaveLength(1);
    expect(origin[0]).toEqual({
      type: "system_notice",
      message_id: result.notice_message_id,
      content: mailboxHopOriginSentNotice("Fizz", "can you take this?"),
      created_at: expect.any(String),
      chat_id: bill.thread_id,
    });
    expect(origin[0]?.content).toContain("Sent to Fizz");
    expect(origin[0]?.content).toContain("can you take this?");
    expect(origin[0]?.content).not.toContain("A message has been sent");
    expect(origin[0]?.content).not.toContain(fizz.agent_id);
    expect(origin[0]).not.toHaveProperty("metadata");
    expect(origin[0]).not.toHaveProperty("ask");
    expect(JSON.stringify(origin[0])).not.toMatch(/view message|href|url/i);

    const target = store.listHistory(fizz.thread_id);
    expect(target).toEqual([]);
  });

  it("mints missing Jack↔Fizz then authorizes Fizz's wake there", () => {
    const { store, bill, fizz } = seedBillAndFizz();
    const dropped = dropDirectThreadKeepingAgent(store, fizz.agent_id);
    expect(store.findDirectThreadForAgent(fizz.agent_id)).toBeNull();

    const result = applyMailboxHop(
      store,
      parseSend({ from: bill.agent_id, to: fizz.agent_id, room: bill.thread_id }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok || result.mode !== "one_to_one") return;
    expect(result.minted).toBe(true);
    expect(result.wake_to).toBe(fizz.agent_id);
    expect(result.target_thread_id).not.toBe(dropped);
    expect(result.allow_from_bubble).toBe(false);

    const minted = store.findDirectThreadForAgent(fizz.agent_id);
    expect(minted?.thread_id).toBe(result.target_thread_id);
    expect(minted).toMatchObject({
      kind: "chat",
      agent_id: fizz.agent_id,
      tenant_id: tenantId,
      user_id: userId,
      title: "Fizz",
    });
    expect(store.listHistory(minted!.thread_id)).toEqual([]);
    expect(
      store.listHistory(bill.thread_id).some(
        (event) =>
          event.type === "system_notice" &&
          event.content ===
            mailboxHopOriginSentNotice("Fizz", "can you take this?"),
      ),
    ).toBe(true);
    expect(JSON.stringify(store.listHistory(bill.thread_id))).not.toContain(
      "A message has been sent",
    );
  });

  it("does not mint a second 1:1 when Jack↔Fizz already exists", () => {
    const { store, bill, fizz } = seedBillAndFizz();
    const before = store.listForOwner(tenantId, userId).length;
    const result = applyMailboxHop(
      store,
      parseSend({
        from: bill.agent_id,
        to: fizz.agent_id,
        room: fizz.thread_id,
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      mode: "one_to_one",
      target_thread_id: fizz.thread_id,
      minted: false,
    });
    expect(store.listForOwner(tenantId, userId)).toHaveLength(before);
    expect(store.findDirectThreadForAgent(fizz.agent_id)?.thread_id).toBe(
      fizz.thread_id,
    );
  });

  it("target 1:1 mint failure is not_found and writes no origin notice", () => {
    const { store, bill, fizz } = seedBillAndFizz();
    dropDirectThreadKeepingAgent(store, fizz.agent_id);
    vi.spyOn(store, "ensureDirectThreadForAgent").mockImplementation(() => {
      throw new Error("mint failed");
    });

    const result = applyMailboxHop(
      store,
      parseSend({ from: bill.agent_id, to: fizz.agent_id, room: bill.thread_id }),
    );

    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(store.listHistory(bill.thread_id)).toEqual([]);
    expect(store.findDirectThreadForAgent(fizz.agent_id)).toBeNull();
  });

  it("unknown to is not_found with no notice", () => {
    const { store, bill } = seedBillAndFizz();
    const result = applyMailboxHop(
      store,
      parseSend({ from: bill.agent_id, to: "ghost-fizz", room: bill.thread_id }),
    );
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(store.listHistory(bill.thread_id)).toEqual([]);
  });
});

describe("applyMailboxHop channel (lp-v62i.3.3)", () => {
  it("writes no origin notice and allows a from bubble because from is a member", () => {
    const { store, bill, fizz } = seedBillAndFizz();
    const channel = store.createChannel({
      tenant_id: tenantId,
      user_id: userId,
      name: "workshop",
      member_agent_ids: [bill.agent_id, fizz.agent_id],
    });

    const result = applyMailboxHop(
      store,
      parseSend({
        from: bill.agent_id,
        to: fizz.agent_id,
        room: channel.thread_id,
        text: "Fizz, take this in workshop",
      }),
    );

    expect(result).toEqual({
      ok: true,
      mode: "channel",
      target_thread_id: channel.thread_id,
      wake_to: fizz.agent_id,
      allow_from_bubble: true,
    });
    expect(store.listHistory(bill.thread_id)).toEqual([]);
    expect(store.listHistory(fizz.thread_id)).toEqual([]);

    store.appendHistory(channel.thread_id, {
      type: "message_send",
      chat_id: channel.thread_id,
      message_id: "msg-bill-channel",
      content: "Fizz, take this in workshop",
      created_at: "2026-08-25T12:00:00.000Z",
      speaker: {
        kind: "persona",
        id: bill.agent_id,
        display_name: "Bill",
      },
    });
    const channelHistory = store.listHistory(channel.thread_id);
    expect(channelHistory).toHaveLength(1);
    expect(channelHistory[0]).toMatchObject({
      type: "message_send",
      speaker: {
        kind: "persona",
        id: bill.agent_id,
        display_name: "Bill",
      },
    });
  });

  it("group origin + roster to stays channel even when room is their 1:1", () => {
    const { store, bill, fizz } = seedBillAndFizz();
    const channel = store.createChannel({
      tenant_id: tenantId,
      user_id: userId,
      name: "teamguys",
      member_agent_ids: [bill.agent_id, fizz.agent_id],
    });
    const fizzThreadId = fizz.thread_id;
    const mint = vi.spyOn(store, "ensureDirectThreadForAgent");

    const result = applyMailboxHop(
      store,
      parseSend({
        from: bill.agent_id,
        to: fizz.agent_id,
        room: fizzThreadId,
        text: "Fizz, stay in the room",
      }),
      userId,
      channel.thread_id,
    );

    expect(result).toEqual({
      ok: true,
      mode: "channel",
      target_thread_id: channel.thread_id,
      wake_to: fizz.agent_id,
      allow_from_bubble: true,
    });
    expect(mint).not.toHaveBeenCalled();
    expect(store.findDirectThreadForAgent(fizz.agent_id)?.thread_id).toBe(
      fizzThreadId,
    );
    expect(store.listHistory(fizzThreadId)).toEqual([]);
    expect(store.listHistory(bill.thread_id)).toEqual([]);
  });

  it("group origin does not mint a missing 1:1 when to is on the roster", () => {
    const { store, bill, fizz } = seedBillAndFizz();
    const channel = store.createChannel({
      tenant_id: tenantId,
      user_id: userId,
      name: "teamguys",
      member_agent_ids: [bill.agent_id, fizz.agent_id],
    });
    const dropped = dropDirectThreadKeepingAgent(store, fizz.agent_id);
    expect(store.findDirectThreadForAgent(fizz.agent_id)).toBeNull();
    const mint = vi.spyOn(store, "ensureDirectThreadForAgent");

    const result = applyMailboxHop(
      store,
      parseSend({
        from: bill.agent_id,
        to: fizz.agent_id,
        room: dropped,
      }),
      userId,
      channel.thread_id,
    );

    expect(result).toEqual({
      ok: true,
      mode: "channel",
      target_thread_id: channel.thread_id,
      wake_to: fizz.agent_id,
      allow_from_bubble: true,
    });
    expect(mint).not.toHaveBeenCalled();
    expect(store.findDirectThreadForAgent(fizz.agent_id)).toBeNull();
  });

  it("forbids channel send when from is not on the roster", () => {
    const { store, bill, fizz } = seedBillAndFizz();
    const ops = store.createAgent({
      tenant_id: tenantId,
      user_id: userId,
      name: "Ops",
    });
    const channel = store.createChannel({
      tenant_id: tenantId,
      user_id: userId,
      name: "workshop",
      member_agent_ids: [fizz.agent_id, ops.agent_id],
    });

    const result = applyMailboxHop(
      store,
      parseSend({
        from: bill.agent_id,
        to: fizz.agent_id,
        room: channel.thread_id,
      }),
    );
    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(store.listHistory(bill.thread_id)).toEqual([]);
    expect(store.listHistory(channel.thread_id)).toEqual([]);
  });
});

describe("guest write and speaker check (lp-v62i.3.3)", () => {
  it("forbids Fizz sending into Bill↔Jack", () => {
    const { store, bill, fizz } = seedBillAndFizz();
    const ops = store.createAgent({
      tenant_id: tenantId,
      user_id: userId,
      name: "Ops",
    });

    const result = applyMailboxHop(
      store,
      parseSend({
        from: fizz.agent_id,
        to: ops.agent_id,
        room: bill.thread_id,
      }),
    );
    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(store.listHistory(bill.thread_id)).toEqual([]);
    expect(store.listHistory(ops.thread_id)).toEqual([]);
  });

  it("1:1 hop to Bill still does not append Fizz as speaker on Bill↔Jack", () => {
    const { store, bill, fizz } = seedBillAndFizz();
    const result = applyMailboxHop(
      store,
      parseSend({
        from: fizz.agent_id,
        to: bill.agent_id,
        room: bill.thread_id,
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      mode: "one_to_one",
      allow_from_bubble: false,
      target_thread_id: bill.thread_id,
    });
    const billHistory = store.listHistory(bill.thread_id);
    expect(
      billHistory.some(
        (event) =>
          "speaker" in event && event.speaker?.id === fizz.agent_id,
      ),
    ).toBe(false);
    expect(
      billHistory.some(
        (event) => event.type === "message_send" || event.type === "user_message",
      ),
    ).toBe(false);
  });

  it("leaves appendHistory speakerIsParticipant unchanged on groups", () => {
    const { store, bill, fizz } = seedBillAndFizz();
    const channel = store.createChannel({
      tenant_id: tenantId,
      user_id: userId,
      name: "workshop",
      member_agent_ids: [bill.agent_id, fizz.agent_id],
    });

    applyMailboxHop(
      store,
      parseSend({
        from: bill.agent_id,
        to: fizz.agent_id,
        room: fizz.thread_id,
      }),
    );

    expect(() =>
      store.appendHistory(channel.thread_id, {
        type: "message_send",
        chat_id: channel.thread_id,
        message_id: "msg-stranger",
        content: "impersonation",
        created_at: "2026-08-25T12:00:01.000Z",
        speaker: {
          kind: "persona",
          id: "stranger",
          display_name: "Stranger",
        },
      }),
    ).toThrow(InvalidGroupThreadError);
    expect(store.listHistory(channel.thread_id)).toEqual([]);
  });
});

describe("mailboxHopWakePayload (lp-v62i.3.6)", () => {
  it("1:1 hop uses TARGET tail + hidden_instruction, not a Bill bubble", () => {
    const { store, bill, fizz } = seedBillAndFizz();
    store.appendHistory(fizz.thread_id, {
      type: "user_message",
      message_id: "msg-jack",
      content: "earlier with Fizz",
      created_at: "2026-08-25T11:00:00.000Z",
      chat_id: fizz.thread_id,
    });
    const hop = applyMailboxHop(
      store,
      parseSend({
        from: bill.agent_id,
        to: fizz.agent_id,
        room: bill.thread_id,
        text: "Fizz, take the NDA",
      }),
    );
    expect(hop.ok).toBe(true);
    if (!hop.ok) return;

    const payload = mailboxHopWakePayload({
      store,
      hop,
      text: "Fizz, take the NDA",
    });
    expect(payload.thread_id).toBe(fizz.thread_id);
    expect(payload.message).toBe("Fizz, take the NDA");
    expect(payload.metadata.hidden_instruction).toBe("Fizz, take the NDA");
    expect(payload.metadata.room_tail).toEqual([
      {
        type: "user_message",
        message_id: "msg-jack",
        content: "earlier with Fizz",
        created_at: "2026-08-25T11:00:00.000Z",
        chat_id: fizz.thread_id,
      },
    ]);

    const target = store.listHistory(fizz.thread_id);
    expect(
      target.some(
        (event) =>
          "speaker" in event && event.speaker?.id === bill.agent_id,
      ),
    ).toBe(false);
    expect(
      target.some(
        (event) =>
          event.type === "user_message" && event.content === "Fizz, take the NDA",
      ),
    ).toBe(false);
    expect(
      target.some(
        (event) => event.type === "message_send" || event.type === "user_message",
      ),
    ).toBe(true);
    expect(target).toHaveLength(1);
  });

  it("channel hop wake has room tail and mailbox text as hidden_instruction", () => {
    const { store, bill, fizz } = seedBillAndFizz();
    const channel = store.createChannel({
      tenant_id: tenantId,
      user_id: userId,
      name: "workshop",
      member_agent_ids: [bill.agent_id, fizz.agent_id],
    });
    store.appendHistory(channel.thread_id, {
      type: "message_send",
      chat_id: channel.thread_id,
      message_id: "msg-bill-channel",
      content: "Fizz, take this in workshop",
      created_at: "2026-08-25T12:00:00.000Z",
      speaker: {
        kind: "persona",
        id: bill.agent_id,
        display_name: "Bill",
      },
    });
    const hop = applyMailboxHop(
      store,
      parseSend({
        from: bill.agent_id,
        to: fizz.agent_id,
        room: channel.thread_id,
        text: "Fizz, take this in workshop",
      }),
    );
    expect(hop.ok).toBe(true);
    if (!hop.ok) return;

    const payload = mailboxHopWakePayload({
      store,
      hop,
      text: "Fizz, take this in workshop",
    });
    expect(payload.thread_id).toBe(channel.thread_id);
    expect(payload.message).toBe("Fizz, take this in workshop");
    expect(payload.metadata.hidden_instruction).toBe(
      "Fizz, take this in workshop",
    );
    expect(payload.metadata.persona).toMatchObject({
      persona_id: fizz.agent_id,
      display_name: "Fizz",
    });
    expect(payload.metadata.room_tail).toHaveLength(1);
    expect(payload.metadata.room_tail?.[0]).toMatchObject({
      type: "message_send",
      content: "Fizz, take this in workshop",
      speaker: { id: bill.agent_id, display_name: "Bill" },
    });
  });
});
