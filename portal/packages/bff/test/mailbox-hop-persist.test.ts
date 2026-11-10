/**
 * lp-v62i.20.1 / lp-v62i.25 — persist mailbox hop inbound + addressee
 * harness output without a target GET /events subscriber. Channel hops
 * startTurn(wake_to) on the shared thread. claim() keeps a later SSE drain unique.
 *
 * Prove: pnpm --filter @lanyard/bff exec vitest run mailbox-hop-persist
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  asTurnId,
  MAILBOX_SEND_TOOL_NAME,
  parseMailboxAppendRequest,
  type TurnRequest,
} from "@lanyard/shared";

import { proxyHarnessTurnsUntilAbort } from "../src/chat-delivery-events.js";
import { ChatThreadStore } from "../src/chat-store.js";
import { readableStreamFromText } from "../src/harness-client.js";
import { createHarnessTurnRegistry } from "../src/harness-turn-registry.js";
import type { SpineStartTurn } from "../src/inbound-queue.js";
import {
  isMailboxHopInbound,
  mailboxHopFailureNotice,
  mailboxHopOriginSentNotice,
  mailboxHopWakeFailureNotice,
  persistHarnessOutboundBody,
  persistMailboxHopHarnessOutput,
} from "../src/mailbox-hop.js";
import { MailboxNonceStore } from "../src/mailbox-nonce.js";
import {
  executeMailboxSend,
  hopMailboxFromHarnessEvent,
  hostStampMailboxRoom,
  mailboxSendFromToolEvent,
  type MailboxSpineEnqueue,
} from "../src/mailbox-send.js";
import { createThreadLiveEventsHub } from "../src/thread-live-events.js";
import { createMemoryInboundQueue } from "./inbound-memory-queue.js";

const tenantId = "tenant-mailbox-persist";
const userId = "usr_jack";
const instanceId = "inst-mailbox-persist";

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
    text: input.text ?? "Bill, take this",
    nonce: input.nonce ?? "nonce-persist-1",
    tenant_id: tenantId,
  });
}

function seedFredAndBill(store = new ChatThreadStore()) {
  const fred = store.createAgent({
    tenant_id: tenantId,
    user_id: userId,
    name: "Fred",
    objective: "Ping teammates.",
  });
  const bill = store.createAgent({
    tenant_id: tenantId,
    user_id: userId,
    name: "Bill",
    objective: "Lead the room.",
  });
  return { store, fred, bill };
}

function sseBody(event: Record<string, unknown>): ReadableStream<Uint8Array> {
  return readableStreamFromText(`data: ${JSON.stringify(event)}\n\n`);
}

function harnessThatReplies(reply: Record<string, unknown>) {
  const opened: string[] = [];
  return {
    opened,
    client: {
      openTurnEventStream: async (turnId: string) => {
        opened.push(turnId);
        return {
          status: 200,
          ok: true,
          headers: { get: () => "text/event-stream" },
          body: sseBody(reply),
          text: async () => "",
          json: async () => ({}),
        };
      },
    },
  };
}

function recordingStartTurn(turnId = "turn_bill_1") {
  const calls: TurnRequest[] = [];
  const startTurn: SpineStartTurn = async (request) => {
    calls.push(request);
    return { ok: true, turn_id: asTurnId(turnId) };
  };
  return { startTurn, calls, turnId: asTurnId(turnId) };
}

function spineFor(input: {
  startTurn: SpineStartTurn;
  registry: ReturnType<typeof createHarnessTurnRegistry>;
  harnessClient: MailboxSpineEnqueue["persist"] extends infer P
    ? P extends { harnessClient: infer C }
      ? C
      : never
    : never;
}): MailboxSpineEnqueue {
  const queue = createMemoryInboundQueue();
  return {
    store: queue,
    startTurn: input.startTurn,
    owner: "mailbox-persist-worker",
    remember: async (threadId, turnId) => {
      await input.registry.remember(threadId, turnId);
    },
    persist: {
      harnessClient: input.harnessClient,
      registry: input.registry,
    },
  };
}

describe("lp-v62i.20.1 persist mailbox hop without target SSE", () => {
  let consoleError: ReturnType<typeof vi.spyOn> | undefined;

  afterEach(() => {
    consoleError?.mockRestore();
    consoleError = undefined;
  });

  function silenceProxyLogs() {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  }

  it("Fred mailbox.send to Bill persists inbound with nobody on Bill SSE", async () => {
    silenceProxyLogs();
    const { store, fred, bill } = seedFredAndBill();
    const harness = harnessThatReplies({
      type: "message_send",
      chat_id: bill.thread_id,
      message_id: "msg-bill-reply",
      content: "got it",
    });
    const registry = createHarnessTurnRegistry();
    const started = recordingStartTurn();
    const spine = spineFor({
      startTurn: started.startTurn,
      registry,
      harnessClient: harness.client,
    });
    const liveEvents = createThreadLiveEventsHub();

    const result = await executeMailboxSend({
      chat: store,
      nonces: new MailboxNonceStore(),
      request: parseSend({
        from: fred.agent_id,
        to: bill.agent_id,
        room: fred.thread_id,
      }),
      liveEvents,
      spine,
      userId,
      instanceId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const origin = store.listHistory(fred.thread_id);
    const sentNotice = origin.find((event) => event.type === "system_notice");
    expect(sentNotice?.content).toBe(
      mailboxHopOriginSentNotice("Bill", "Bill, take this"),
    );
    expect(sentNotice?.content).not.toContain("A message has been sent");
    expect(sentNotice?.content).not.toContain(bill.agent_id);

    const inbound = store.listHistory(bill.thread_id).filter(isMailboxHopInbound);
    expect(inbound).toHaveLength(1);
    expect(inbound[0]).toMatchObject({
      type: "message_send",
      content: "Bill, take this",
      speaker: {
        kind: "persona",
        id: fred.agent_id,
        display_name: "Fred",
      },
      metadata: {
        mailbox_inbound: {
          from: fred.agent_id,
          from_display_name: "Fred",
          origin_thread_id: fred.thread_id,
        },
      },
    });
    expect(started.calls).toHaveLength(1);
    expect(started.calls[0]?.thread_id).toBe(bill.thread_id);
    expect(registry.latest(bill.thread_id)).toBe(started.turnId);

    await result.outputPersist;
    expect(
      store
        .listHistory(bill.thread_id)
        .filter(
          (event) =>
            event.type === "message_send" && event.content === "got it",
        ),
    ).toHaveLength(1);
    expect(harness.opened).toEqual([started.turnId]);
    expect(await registry.claim(bill.thread_id, started.turnId)).toBe(false);

    const before = store.listHistory(bill.thread_id);
    await persistMailboxHopHarnessOutput({
      store,
      threadId: bill.thread_id,
      persist: { harnessClient: harness.client, registry },
    });
    await proxyHarnessTurnsUntilAbort({
      threadId: bill.thread_id,
      harnessClient: harness.client,
      registry,
      abort: new AbortController().signal,
      existingOnly: true,
      stallTimeoutMs: 0,
      proxyBody: async (body) => {
        await persistHarnessOutboundBody({
          threadId: bill.thread_id,
          store,
          body,
        });
      },
      writeError: async () => {},
    });
    expect(store.listHistory(bill.thread_id)).toEqual(before);
    expect(store.listHistory(bill.thread_id).filter(isMailboxHopInbound)).toHaveLength(
      1,
    );
  });

  it("hopMailboxFromHarnessEvent persists Bill inbound without opening Bill events", async () => {
    silenceProxyLogs();
    const { store, fred, bill } = seedFredAndBill();
    const harness = harnessThatReplies({
      type: "message_send",
      chat_id: bill.thread_id,
      message_id: "msg-bill-reply",
      content: "on it",
    });
    const registry = createHarnessTurnRegistry();
    const started = recordingStartTurn("turn_from_harness");
    const spine = spineFor({
      startTurn: started.startTurn,
      registry,
      harnessClient: harness.client,
    });
    const fredThread = store.get(fred.thread_id);
    expect(fredThread).toBeTruthy();

    const woken = await hopMailboxFromHarnessEvent({
      chat: store,
      nonces: new MailboxNonceStore(),
      spine,
      tenantId,
      userId,
      instanceId,
      thread: fredThread!,
      event: {
        type: "tool_progress",
        tool_name: MAILBOX_SEND_TOOL_NAME,
        speaker: {
          kind: "persona",
          id: fred.agent_id,
          display_name: "Fred",
        },
        metadata: {
          mailbox_send: {
            to: bill.agent_id,
            room: fred.thread_id,
            text: "please review",
            nonce: "nonce-from-harness",
          },
        },
      },
      mailedTo: new Set(),
      nonceSeed: "seed-from-harness",
    });

    expect(woken).toEqual([bill.agent_id]);
    expect(
      store.listHistory(bill.thread_id).filter(isMailboxHopInbound),
    ).toHaveLength(1);
    expect(started.calls[0]?.thread_id).toBe(bill.thread_id);
    expect(store.listHistory(bill.thread_id)[0]).toMatchObject({
      content: "please review",
      speaker: { id: fred.agent_id, display_name: "Fred" },
    });
    await vi.waitFor(() => {
      expect(harness.opened).toEqual([started.turnId]);
    });
  });

  it("host-stamps origin room when mailbox.send omits room", async () => {
    silenceProxyLogs();
    const { store, fred, bill } = seedFredAndBill();
    const harness = harnessThatReplies({
      type: "message_send",
      chat_id: bill.thread_id,
      message_id: "msg-bill-stamped",
      content: "on it",
    });
    const registry = createHarnessTurnRegistry();
    const started = recordingStartTurn("turn_stamped_room");
    const spine = spineFor({
      startTurn: started.startTurn,
      registry,
      harnessClient: harness.client,
    });
    const fredThread = store.get(fred.thread_id)!;

    const woken = await hopMailboxFromHarnessEvent({
      chat: store,
      nonces: new MailboxNonceStore(),
      spine,
      tenantId,
      userId,
      instanceId,
      thread: fredThread,
      event: {
        type: "tool_progress",
        tool_name: MAILBOX_SEND_TOOL_NAME,
        speaker: {
          kind: "persona",
          id: fred.agent_id,
          display_name: "Fred",
        },
        metadata: {
          mailbox_send: {
            to: "Bill",
            text: "please review",
          },
        },
      },
      mailedTo: new Set(),
      nonceSeed: "seed-stamped-room",
    });

    expect(woken).toEqual([bill.agent_id]);
    expect(started.calls[0]?.thread_id).toBe(bill.thread_id);
    expect(
      store.listHistory(bill.thread_id).filter(isMailboxHopInbound),
    ).toHaveLength(1);
  });

  it("group origin omitted room stays on the channel", async () => {
    silenceProxyLogs();
    const { store, fred, bill } = seedFredAndBill();
    const channel = store.createChannel({
      tenant_id: tenantId,
      user_id: userId,
      name: "teamguys",
      member_agent_ids: [fred.agent_id, bill.agent_id],
    });
    const billHistoryBefore = store.listHistory(bill.thread_id);
    const started = recordingStartTurn("turn_group_omitted_room");
    const spine = spineFor({
      startTurn: started.startTurn,
      registry: createHarnessTurnRegistry(),
      harnessClient: harnessThatReplies({
        type: "message_send",
        chat_id: channel.thread_id,
        content: "stay here",
      }).client,
    });

    const woken = await hopMailboxFromHarnessEvent({
      chat: store,
      nonces: new MailboxNonceStore(),
      spine,
      tenantId,
      userId,
      instanceId,
      thread: store.get(channel.thread_id)!,
      event: {
        type: "tool_progress",
        tool_name: MAILBOX_SEND_TOOL_NAME,
        speaker: {
          kind: "persona",
          id: fred.agent_id,
          display_name: "Fred",
        },
        metadata: {
          mailbox_send: { to: "Bill", text: "stay in the room" },
        },
      },
      mailedTo: new Set(),
      nonceSeed: "seed-group-omitted",
    });

    expect(woken).toEqual([bill.agent_id]);
    expect(started.calls[0]?.thread_id).toBe(channel.thread_id);
    expect(store.listHistory(bill.thread_id)).toEqual(billHistoryBefore);
  });

  it("not_found hop writes a visible origin notice on Fred", async () => {
    const { store, fred } = seedFredAndBill();
    const published: unknown[] = [];
    const liveEvents = createThreadLiveEventsHub();
    liveEvents.subscribe(fred.thread_id, (event) => {
      published.push(event);
    });

    const result = await executeMailboxSend({
      chat: store,
      nonces: new MailboxNonceStore(),
      request: parseSend({
        from: fred.agent_id,
        to: "ghost-bill",
        room: fred.thread_id,
        nonce: "nonce-not-found",
      }),
      liveEvents,
      userId,
      instanceId,
    });

    expect(result).toEqual({ ok: false, error: "not_found" });
    const origin = store.listHistory(fred.thread_id);
    expect(origin).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "system_notice",
          content: mailboxHopFailureNotice("not_found", "ghost-bill"),
          chat_id: fred.thread_id,
        }),
      ]),
    );
    expect(
      origin.some((event) => event.type === "tool_progress"),
    ).toBe(false);
    expect(published).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "system_notice",
          content: mailboxHopFailureNotice("not_found", "ghost-bill"),
        }),
      ]),
    );
  });

  it("forbidden hop writes a visible origin notice on Fred", async () => {
    const { store, fred, bill } = seedFredAndBill();
    const ops = store.createAgent({
      tenant_id: tenantId,
      user_id: userId,
      name: "Ops",
    });

    const result = await executeMailboxSend({
      chat: store,
      nonces: new MailboxNonceStore(),
      request: parseSend({
        from: bill.agent_id,
        to: ops.agent_id,
        room: fred.thread_id,
        nonce: "nonce-forbidden",
      }),
      userId,
      instanceId,
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(
      store.listHistory(fred.thread_id).some(
        (event) =>
          event.type === "system_notice" &&
          event.content === mailboxHopFailureNotice("forbidden", "Ops"),
      ),
    ).toBe(true);
    expect(store.listHistory(bill.thread_id).filter(isMailboxHopInbound)).toEqual(
      [],
    );
    expect(store.listHistory(ops.thread_id).filter(isMailboxHopInbound)).toEqual(
      [],
    );
  });

  it("startTurn failure is visible on Fred after the origin hop notice", async () => {
    const { store, fred, bill } = seedFredAndBill();
    const startTurn: SpineStartTurn = async () => ({
      ok: false,
      status: 502,
      error: "harness down",
    });
    const registry = createHarnessTurnRegistry();
    const harness = harnessThatReplies({
      type: "message_send",
      content: "should not persist",
    });
    const spine = spineFor({
      startTurn,
      registry,
      harnessClient: harness.client,
    });

    const result = await executeMailboxSend({
      chat: store,
      nonces: new MailboxNonceStore(),
      request: parseSend({
        from: fred.agent_id,
        to: bill.agent_id,
        room: fred.thread_id,
        nonce: "nonce-wake-fail",
      }),
      spine,
      userId,
      instanceId,
    });

    expect(result.ok).toBe(true);
    const origin = store.listHistory(fred.thread_id);
    expect(
      origin.some(
        (event) =>
          event.type === "system_notice" &&
          event.content ===
            mailboxHopOriginSentNotice("Bill", "Bill, take this"),
      ),
    ).toBe(true);
    expect(JSON.stringify(origin)).not.toContain("A message has been sent");
    expect(
      origin.some(
        (event) =>
          event.type === "system_notice" &&
          event.content === mailboxHopWakeFailureNotice("Bill", "harness down"),
      ),
    ).toBe(true);
    expect(store.listHistory(bill.thread_id).filter(isMailboxHopInbound)).toHaveLength(
      1,
    );
    expect(harness.opened).toEqual([]);
  });

  it("1:1 origin still hops Bill when they also share a group", async () => {
    silenceProxyLogs();
    const { store, fred, bill } = seedFredAndBill();
    store.createChannel({
      tenant_id: tenantId,
      user_id: userId,
      name: "teamguys",
      member_agent_ids: [fred.agent_id, bill.agent_id],
    });
    const harness = harnessThatReplies({
      type: "message_send",
      chat_id: bill.thread_id,
      content: "got the private ping",
    });
    const registry = createHarnessTurnRegistry();
    const started = recordingStartTurn("turn_private_still");
    const spine = spineFor({
      startTurn: started.startTurn,
      registry,
      harnessClient: harness.client,
    });
    const fredThread = store.get(fred.thread_id);
    expect(fredThread).toBeTruthy();

    const result = await executeMailboxSend({
      chat: store,
      nonces: new MailboxNonceStore(),
      request: parseSend({
        from: fred.agent_id,
        to: bill.agent_id,
        room: fred.thread_id,
        text: "Bill, privately",
        nonce: "nonce-1to1-origin-shared-group",
      }),
      spine,
      userId,
      instanceId,
      originThreadId: fredThread!.thread_id,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hop).toMatchObject({
      mode: "one_to_one",
      target_thread_id: bill.thread_id,
    });
    expect(store.listHistory(bill.thread_id).filter(isMailboxHopInbound)).toHaveLength(
      1,
    );
    expect(started.calls[0]?.thread_id).toBe(bill.thread_id);
    await result.outputPersist;
  });

  it("group origin + room=Bill 1:1 stays on the channel and does not mint Bill", async () => {
    silenceProxyLogs();
    const { store, fred, bill } = seedFredAndBill();
    const channel = store.createChannel({
      tenant_id: tenantId,
      user_id: userId,
      name: "teamguys",
      member_agent_ids: [fred.agent_id, bill.agent_id],
    });
    const billThreadId = bill.thread_id;
    const dropped = (() => {
      const internals = store as unknown as {
        threads: Map<string, unknown>;
        history: Map<string, unknown>;
      };
      internals.threads.delete(billThreadId);
      internals.history.delete(billThreadId);
      return billThreadId;
    })();
    expect(store.findDirectThreadForAgent(bill.agent_id)).toBeNull();
    const mint = vi.spyOn(store, "ensureDirectThreadForAgent");
    const harness = harnessThatReplies({
      type: "message_send",
      chat_id: channel.thread_id,
      content: "should not land on Bill 1:1",
    });
    const registry = createHarnessTurnRegistry();
    const started = recordingStartTurn("turn_group_origin");
    const spine = spineFor({
      startTurn: started.startTurn,
      registry,
      harnessClient: harness.client,
    });

    const result = await executeMailboxSend({
      chat: store,
      nonces: new MailboxNonceStore(),
      request: parseSend({
        from: fred.agent_id,
        to: bill.agent_id,
        room: dropped,
        text: "Bill, stay in #teamguys",
        nonce: "nonce-group-origin-1to1-room",
      }),
      spine,
      userId,
      instanceId,
      originThreadId: channel.thread_id,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hop).toMatchObject({
      mode: "channel",
      target_thread_id: channel.thread_id,
    });
    expect(mint).not.toHaveBeenCalled();
    expect(store.findDirectThreadForAgent(bill.agent_id)).toBeNull();
    expect(started.calls[0]?.thread_id).toBe(channel.thread_id);
    expect(started.calls[0]?.thread_id).not.toBe(dropped);
    expect(started.calls[0]?.metadata?.persona).toMatchObject({
      persona_id: bill.agent_id,
      display_name: "Bill",
    });
    expect(started.calls[0]?.metadata?.hidden_instruction).toBe(
      "Bill, stay in #teamguys",
    );
    expect(
      store.listHistory(channel.thread_id).some(
        (event) =>
          event.type === "message_send" &&
          event.content === "Bill, stay in #teamguys" &&
          "speaker" in event &&
          event.speaker?.id === fred.agent_id,
      ),
    ).toBe(true);
    await result.outputPersist;
    expect(harness.opened).toEqual([started.turnId]);
    expect(
      store.listHistory(channel.thread_id).some(
        (event) =>
          event.type === "message_send" &&
          event.content === "should not land on Bill 1:1" &&
          "speaker" in event &&
          event.speaker?.id === bill.agent_id,
      ),
    ).toBe(true);
    expect(await registry.claim(channel.thread_id, started.turnId)).toBe(false);
  });

  it("hopMailboxFromHarnessEvent group origin with room=Bill 1:1 does not wake Bill 1:1", async () => {
    silenceProxyLogs();
    const { store, fred, bill } = seedFredAndBill();
    const channel = store.createChannel({
      tenant_id: tenantId,
      user_id: userId,
      name: "teamguys",
      member_agent_ids: [fred.agent_id, bill.agent_id],
    });
    const billHistoryBefore = store.listHistory(bill.thread_id);
    const harness = harnessThatReplies({
      type: "message_send",
      chat_id: bill.thread_id,
      content: "should not persist on Bill",
    });
    const registry = createHarnessTurnRegistry();
    const started = recordingStartTurn("turn_from_group");
    const spine = spineFor({
      startTurn: started.startTurn,
      registry,
      harnessClient: harness.client,
    });

    const groupThread = store.get(channel.thread_id);
    expect(groupThread).toBeTruthy();

    const woken = await hopMailboxFromHarnessEvent({
      chat: store,
      nonces: new MailboxNonceStore(),
      spine,
      tenantId,
      userId,
      instanceId,
      thread: groupThread!,
      event: {
        type: "tool_progress",
        tool_name: MAILBOX_SEND_TOOL_NAME,
        speaker: {
          kind: "persona",
          id: fred.agent_id,
          display_name: "Fred",
        },
        metadata: {
          mailbox_send: {
            to: bill.agent_id,
            room: bill.thread_id,
            text: "Bill, take this in the room",
            nonce: "nonce-group-tool-1to1-room",
          },
        },
      },
      mailedTo: new Set(),
      nonceSeed: "seed-group-tool",
    });

    expect(woken).toEqual([bill.agent_id]);
    expect(started.calls[0]?.thread_id).toBe(channel.thread_id);
    expect(started.calls[0]?.metadata?.persona).toMatchObject({
      persona_id: bill.agent_id,
      display_name: "Bill",
    });
    expect(store.listHistory(bill.thread_id).filter(isMailboxHopInbound)).toEqual(
      [],
    );
    expect(store.listHistory(bill.thread_id)).toEqual(billHistoryBefore);
    expect(store.findDirectThreadForAgent(bill.agent_id)?.thread_id).toBe(
      bill.thread_id,
    );
    expect(
      store.listHistory(channel.thread_id).some(
        (event) =>
          event.type === "message_send" &&
          event.content === "Bill, take this in the room" &&
          "speaker" in event &&
          event.speaker?.id === fred.agent_id,
      ),
    ).toBe(true);
    await vi.waitFor(() => {
      expect(harness.opened).toEqual([started.turnId]);
    });
    expect(
      store.listHistory(channel.thread_id).some(
        (event) =>
          event.type === "message_send" &&
          event.content === "should not persist on Bill" &&
          "speaker" in event &&
          event.speaker?.id === bill.agent_id,
      ),
    ).toBe(true);
  });

  it("channel mode does not persist a Jack↔Bill 1:1 inbound", async () => {
    silenceProxyLogs();
    const { store, fred, bill } = seedFredAndBill();
    const channel = store.createChannel({
      tenant_id: tenantId,
      user_id: userId,
      name: "workshop",
      member_agent_ids: [fred.agent_id, bill.agent_id],
    });
    const harness = harnessThatReplies({
      type: "message_send",
      chat_id: channel.thread_id,
      content: "channel reply",
    });
    const registry = createHarnessTurnRegistry();
    const started = recordingStartTurn("turn_channel");
    const spine = spineFor({
      startTurn: started.startTurn,
      registry,
      harnessClient: harness.client,
    });

    const result = await executeMailboxSend({
      chat: store,
      nonces: new MailboxNonceStore(),
      request: parseSend({
        from: fred.agent_id,
        to: bill.agent_id,
        room: channel.thread_id,
        text: "Bill, take this in workshop",
        nonce: "nonce-channel",
      }),
      spine,
      userId,
      instanceId,
      appendFromBubble: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hop).toMatchObject({
      mode: "channel",
      target_thread_id: channel.thread_id,
    });
    await result.outputPersist;
    expect(store.listHistory(bill.thread_id).filter(isMailboxHopInbound)).toEqual(
      [],
    );
    expect(
      store.listHistory(fred.thread_id).filter(isMailboxHopInbound),
    ).toEqual([]);
    expect(
      store
        .listHistory(fred.thread_id)
        .some(
          (event) =>
            event.type === "system_notice" &&
            event.content.startsWith("Sent to Bill"),
        ),
    ).toBe(false);
    expect(store.listHistory(channel.thread_id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "message_send",
          content: "Bill, take this in workshop",
          speaker: {
            kind: "persona",
            id: fred.agent_id,
            display_name: "Fred",
          },
        }),
      ]),
    );
    expect(started.calls[0]?.thread_id).toBe(channel.thread_id);
    expect(started.calls[0]?.metadata?.persona).toMatchObject({
      persona_id: bill.agent_id,
      display_name: "Bill",
    });
    expect(started.calls[0]?.message).toBe("Bill, take this in workshop");
    expect(started.calls[0]?.metadata?.hidden_instruction).toBe(
      "Bill, take this in workshop",
    );
    expect(harness.opened).toEqual([started.turnId]);
    const channelSends = store
      .listHistory(channel.thread_id)
      .filter((event) => event.type === "message_send");
    const speakers = channelSends
      .map((event) =>
        "speaker" in event && event.speaker ? event.speaker.id : null,
      )
      .filter((id): id is string => Boolean(id));
    expect(speakers).toContain(fred.agent_id);
    expect(speakers).toContain(bill.agent_id);
    expect(
      channelSends.some(
        (event) =>
          event.content === "channel reply" &&
          "speaker" in event &&
          event.speaker?.id === bill.agent_id &&
          event.speaker.display_name === "Bill",
      ),
    ).toBe(true);
    expect(await registry.claim(channel.thread_id, started.turnId)).toBe(false);
  });

  it("live-shaped tool_progress (empty speaker, JSON content) hops 1:1 inbound", async () => {
    silenceProxyLogs();
    const { store, fred, bill } = seedFredAndBill();
    const harness = harnessThatReplies({
      type: "message_send",
      chat_id: bill.thread_id,
      message_id: "msg-bill-live-reply",
      content: "48291",
    });
    const registry = createHarnessTurnRegistry();
    const started = recordingStartTurn("turn_live_empty_speaker");
    const spine = spineFor({
      startTurn: started.startTurn,
      registry,
      harnessClient: harness.client,
    });
    const fredThread = store.get(fred.thread_id);
    expect(fredThread).toBeTruthy();

    // Live dump 2026-08-28: Bob 1:1 a23291dc — tool_progress with empty
    // speaker, mailbox.send args as JSON content, no tool_name.
    const liveEvent = {
      type: "tool_progress",
      speaker: "",
      content: JSON.stringify({
        to: "Bill",
        room: fred.thread_id,
        text: "five-digit code",
      }),
    };

    const woken = await hopMailboxFromHarnessEvent({
      chat: store,
      nonces: new MailboxNonceStore(),
      spine,
      tenantId,
      userId,
      instanceId,
      thread: fredThread!,
      event: liveEvent,
      mailedTo: new Set(),
      nonceSeed: "seed-live-empty-speaker",
    });

    expect(woken).toEqual([bill.agent_id]);
    const inbound = store.listHistory(bill.thread_id).filter(isMailboxHopInbound);
    expect(inbound).toHaveLength(1);
    expect(inbound[0]).toMatchObject({
      content: "five-digit code",
      speaker: {
        kind: "persona",
        id: fred.agent_id,
        display_name: "Fred",
      },
    });
    expect(started.calls[0]?.thread_id).toBe(bill.thread_id);
    expect(started.calls[0]?.metadata?.persona).toMatchObject({
      persona_id: bill.agent_id,
      display_name: "Bill",
    });
    expect(started.calls[0]?.metadata?.hidden_instruction).toBe("five-digit code");
    await vi.waitFor(() => {
      expect(harness.opened).toEqual([started.turnId]);
    });
    expect(
      store
        .listHistory(bill.thread_id)
        .some(
          (event) =>
            event.type === "message_send" && event.content === "48291",
        ),
    ).toBe(true);
  });

  it("channel send startTurns Bill as Bill and persists Bill's reply", async () => {
    silenceProxyLogs();
    const { store, fred, bill } = seedFredAndBill();
    const josh = store.createAgent({
      tenant_id: tenantId,
      user_id: userId,
      name: "Josh",
      objective: "Research.",
    });
    const channel = store.createChannel({
      tenant_id: tenantId,
      user_id: userId,
      name: "team-guys",
      member_agent_ids: [fred.agent_id, bill.agent_id, josh.agent_id],
    });
    const harness = harnessThatReplies({
      type: "message_send",
      chat_id: channel.thread_id,
      message_id: "msg-bill-ice-cream",
      content: "Ice cream brief received — I'll research flavors.",
    });
    const registry = createHarnessTurnRegistry();
    const started = recordingStartTurn("turn_channel_bill");
    const spine = spineFor({
      startTurn: started.startTurn,
      registry,
      harnessClient: harness.client,
    });

    const result = await executeMailboxSend({
      chat: store,
      nonces: new MailboxNonceStore(),
      request: parseSend({
        from: fred.agent_id,
        to: bill.agent_id,
        room: channel.thread_id,
        text: "ice cream brief",
        nonce: "nonce-ice-cream-brief",
      }),
      spine,
      userId,
      instanceId,
      originThreadId: channel.thread_id,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hop).toMatchObject({
      mode: "channel",
      target_thread_id: channel.thread_id,
      wake_to: bill.agent_id,
    });
    expect(started.calls).toHaveLength(1);
    expect(started.calls[0]).toMatchObject({
      thread_id: channel.thread_id,
      message: "ice cream brief",
    });
    expect(started.calls[0]?.metadata?.persona).toMatchObject({
      persona_id: bill.agent_id,
      display_name: "Bill",
    });
    expect(started.calls[0]?.metadata?.hidden_instruction).toBe(
      "ice cream brief",
    );
    await result.outputPersist;
    const channelSends = store
      .listHistory(channel.thread_id)
      .filter((event) => event.type === "message_send");
    const speakerIds = channelSends
      .map((event) =>
        "speaker" in event && event.speaker ? event.speaker.id : null,
      )
      .filter((id): id is string => Boolean(id));
    expect(speakerIds).toContain(fred.agent_id);
    expect(speakerIds).toContain(bill.agent_id);
    expect(new Set(speakerIds).size).toBeGreaterThan(1);
    expect(
      channelSends.some(
        (event) =>
          event.content === "Ice cream brief received — I'll research flavors." &&
          "speaker" in event &&
          event.speaker?.id === bill.agent_id &&
          event.speaker.display_name === "Bill",
      ),
    ).toBe(true);
    expect(store.listHistory(bill.thread_id).filter(isMailboxHopInbound)).toEqual(
      [],
    );
    expect(await registry.claim(channel.thread_id, started.turnId)).toBe(false);
  });

  it("live-shaped channel tool_progress empty speaker still hops Bill as Bill", async () => {
    silenceProxyLogs();
    const { store, fred, bill } = seedFredAndBill();
    const channel = store.createChannel({
      tenant_id: tenantId,
      user_id: userId,
      name: "team-guys",
      member_agent_ids: [fred.agent_id, bill.agent_id],
    });
    const harness = harnessThatReplies({
      type: "message_send",
      chat_id: channel.thread_id,
      content: "on the ice cream brief",
    });
    const registry = createHarnessTurnRegistry();
    const started = recordingStartTurn("turn_live_channel");
    const spine = spineFor({
      startTurn: started.startTurn,
      registry,
      harnessClient: harness.client,
    });
    const groupThread = store.get(channel.thread_id);
    expect(groupThread?.agent_id).toBeNull();
    expect(groupThread?.orchestrator_persona_id).toBe(fred.agent_id);

    const woken = await hopMailboxFromHarnessEvent({
      chat: store,
      nonces: new MailboxNonceStore(),
      spine,
      tenantId,
      userId,
      instanceId,
      thread: groupThread!,
      event: {
        type: "tool_progress",
        speaker: "",
        content: JSON.stringify({
          to: "Bill",
          room: channel.thread_id,
          text: "ice cream brief",
        }),
      },
      mailedTo: new Set(),
      nonceSeed: "seed-live-channel",
    });

    expect(woken).toEqual([bill.agent_id]);
    expect(started.calls[0]?.thread_id).toBe(channel.thread_id);
    expect(started.calls[0]?.metadata?.persona).toMatchObject({
      persona_id: bill.agent_id,
      display_name: "Bill",
    });
    expect(started.calls[0]?.metadata?.persona?.persona_id).not.toBe(
      fred.agent_id,
    );
    await vi.waitFor(() => {
      expect(
        store.listHistory(channel.thread_id).some(
          (event) =>
            event.type === "message_send" &&
            event.content === "on the ice cream brief" &&
            "speaker" in event &&
            event.speaker?.id === bill.agent_id,
        ),
      ).toBe(true);
    });
  });
});

describe("lp-v62i.24 host stamps mailbox.send room", () => {
  it("fills origin when room is omitted or a name, keeps a UUID", () => {
    const origin = "a23291dc-1111-4111-8111-39e35b7f0001";
    const uuidRoom = "c23291dc-2222-4222-8222-39e35b7f0002";
    const omitted = mailboxSendFromToolEvent(
      {
        type: "tool_progress",
        tool_name: MAILBOX_SEND_TOOL_NAME,
        metadata: { mailbox_send: { to: "agt_d", text: "take this" } },
      },
      origin,
    );
    expect(omitted).toMatchObject({ to: "agt_d", room: origin, text: "take this" });
    expect(omitted?.nonce).toEqual(expect.any(String));

    expect(
      mailboxSendFromToolEvent(
        {
          type: "tool_progress",
          tool_name: MAILBOX_SEND_TOOL_NAME,
          metadata: {
            mailbox_send: {
              to: "agt_d",
              room: "teamguys",
              text: "in the room",
              nonce: "n-name",
            },
          },
        },
        origin,
      ),
    ).toEqual({
      to: "agt_d",
      room: origin,
      text: "in the room",
      nonce: "n-name",
    });

    expect(
      mailboxSendFromToolEvent(
        {
          type: "tool_progress",
          tool_name: MAILBOX_SEND_TOOL_NAME,
          metadata: {
            mailbox_send: {
              to: "agt_d",
              room: uuidRoom,
              text: "keep uuid",
              nonce: "n-uuid",
            },
          },
        },
        origin,
      ),
    ).toEqual({
      to: "agt_d",
      room: uuidRoom,
      text: "keep uuid",
      nonce: "n-uuid",
    });
    expect(hostStampMailboxRoom("teamguys", origin)).toBe(origin);
    expect(hostStampMailboxRoom(uuidRoom, origin)).toBe(uuidRoom);
  });
});

describe("lp-v62i.27 in-channel agent @ wakes", () => {
  let consoleError: ReturnType<typeof vi.spyOn> | undefined;
  afterEach(() => {
    consoleError?.mockRestore();
    consoleError = undefined;
  });
  function silenceProxyLogs() {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  }

  it("Fred message_send @Bill in the channel wakes Bill as Bill", async () => {
    silenceProxyLogs();
    const { store, fred, bill } = seedFredAndBill();
    const channel = store.createChannel({
      tenant_id: tenantId,
      user_id: userId,
      name: "team-guys",
      member_agent_ids: [fred.agent_id, bill.agent_id],
    });
    const harness = harnessThatReplies({
      type: "message_send",
      chat_id: channel.thread_id,
      content: "I can help with that.",
    });
    const registry = createHarnessTurnRegistry();
    const started = recordingStartTurn("turn_prose_at_bill");
    const spine = spineFor({
      startTurn: started.startTurn,
      registry,
      harnessClient: harness.client,
    });
    const woken = await hopMailboxFromHarnessEvent({
      chat: store,
      nonces: new MailboxNonceStore(),
      spine,
      tenantId,
      userId,
      instanceId,
      thread: store.get(channel.thread_id)!,
      event: {
        type: "message_send",
        content: "@Bill can you help with the ice cream brief?",
        speaker: {
          kind: "persona",
          id: fred.agent_id,
          display_name: "Fred",
        },
      },
      mailedTo: new Set(),
      nonceSeed: "seed-prose-at",
    });
    expect(woken).toEqual([bill.agent_id]);
    expect(started.calls[0]?.thread_id).toBe(channel.thread_id);
    expect(started.calls[0]?.metadata?.persona).toMatchObject({
      persona_id: bill.agent_id,
      display_name: "Bill",
    });
    expect(started.calls[0]?.metadata?.hidden_instruction).toBe(
      "@Bill can you help with the ice cream brief?",
    );
    expect(store.findDirectThreadForAgent(bill.agent_id)?.thread_id).toBe(
      bill.thread_id,
    );
    expect(store.listHistory(bill.thread_id).filter(isMailboxHopInbound)).toEqual(
      [],
    );
  });

  it("Fred @here in the channel wakes every other member", async () => {
    silenceProxyLogs();
    const { store, fred, bill } = seedFredAndBill();
    const josh = store.createAgent({
      tenant_id: tenantId,
      user_id: userId,
      name: "Josh",
    });
    const channel = store.createChannel({
      tenant_id: tenantId,
      user_id: userId,
      name: "team-guys",
      member_agent_ids: [fred.agent_id, bill.agent_id, josh.agent_id],
    });
    const harness = harnessThatReplies({
      type: "message_send",
      chat_id: channel.thread_id,
      content: "here",
    });
    let n = 0;
    const calls: TurnRequest[] = [];
    const startTurn = async (request: TurnRequest) => {
      n += 1;
      calls.push(request);
      return { ok: true as const, turn_id: asTurnId(`turn_here_${n}`) };
    };
    const spine = spineFor({
      startTurn,
      registry: createHarnessTurnRegistry(),
      harnessClient: harness.client,
    });
    const woken = await hopMailboxFromHarnessEvent({
      chat: store,
      nonces: new MailboxNonceStore(),
      spine,
      tenantId,
      userId,
      instanceId,
      thread: store.get(channel.thread_id)!,
      event: {
        type: "message_send",
        content: "@here check in",
        speaker: {
          kind: "persona",
          id: fred.agent_id,
          display_name: "Fred",
        },
      },
      mailedTo: new Set(),
      nonceSeed: "seed-prose-here",
    });
    expect(woken.sort()).toEqual([bill.agent_id, josh.agent_id].sort());
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.thread_id === channel.thread_id)).toBe(
      true,
    );
    const personaIds = calls.map(
      (call) => call.metadata?.persona?.persona_id,
    );
    expect(personaIds).toContain(bill.agent_id);
    expect(personaIds).toContain(josh.agent_id);
    expect(personaIds).not.toContain(fred.agent_id);
  });
});
