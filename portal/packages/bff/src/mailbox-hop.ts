/**
 * BFF 1:1 mailbox hop (lp-v62i.3.3 / lp-v62i.3.6 / lp-v62i.20.1).
 *
 * Membership hole authorizes wake. Origin 1:1 gets one Sent-to-{name} notice
 * plus the hop text (display name, never a UUID). Channel hops write no origin
 * notice and no Jack↔to inbound (channel already appends a from-bubble). Group
 * origin + roster `to` stays on that channel even if mailbox.send `room` is a
 * 1:1 id. 1:1 persists a from inbound on the target so reload shows the hop
 * without a target SSE subscriber. Channel hops startTurn the addressee
 * (wake_to) on the shared thread and persist their output even if the only
 * SSE is the origin connection. Wake payload is TARGET room tail + hidden
 * instruction (mailbox text).
 */

import { randomUUID } from "node:crypto";

import {
  isMailboxForbiddenTo,
  MAILBOX_SEND_TOOL_NAME,
  type InboundSandboxNeed,
  type MailboxAppendRequest,
  type MailboxErrorCode,
  type TurnId,
  type TurnRequest,
  type TurnRequestMetadata,
} from "@lanyard/shared";

import { proxyHarnessTurnsUntilAbort } from "./chat-delivery-events.js";
import {
  durableOutboundFromRelayEvent,
  type ChatHistoryEvent,
  type ChatThread,
  type ChatThreadStore,
} from "./chat-store.js";
import type { ContextPoolStore } from "./context-pool.js";
import type { HarnessClient } from "./harness-client.js";
import type { HarnessTurnRegistry } from "./harness-turn-registry.js";
import { harnessWakeMetadata } from "./harness-wake-payload.js";
import { HOST_PLAYBOOK } from "./host-playbook.js";
import {
  deliverSpineTurns,
  inboundWorkItemFromClassifiedTurn,
  type InboundQueueStore,
  type SpineDeliverResult,
  type SpineMidTurnSignal,
  type SpineStartTurn,
  type SpineToolboxWakePort,
} from "./inbound-queue.js";
import { parseRelaySseDataLine } from "./relay-client.js";
import type { ThreadLiveEventsHub } from "./thread-live-events.js";

/** Origin 1:1 leftover after subtracting Messaged @X (lp-v62i.20.2). */
export function mailboxHopOriginSentNotice(
  displayName: string,
  text: string,
): string {
  const name = displayName.trim();
  const body = text.trim();
  return body ? `Sent to ${name}\n${body}` : `Sent to ${name}`;
}

/**
 * lp-v62i.17 — persist mailbox.send tool_progress into human pool for follow-up continuity.
 * Bill → Fred via mailbox.send is recorded as type tool_progress with speaker = Bill
 * into thread history AND human ContextPoolStore (key tenant+human) so next turn
 * "Message him" can resolve "him" via pool delta. Covers origin thread (where the
 * host tool ran) and also the human pool for that tenant+human.
 * Idempotent on messageId — caller should use the hop's notice_message_id or a fresh UUID.
 */
export function appendMailboxSendToolTrace(input: {
  store: ChatThreadStore;
  contextPoolStore?: ContextPoolStore | null;
  traceThreadId: string;
  callerPersonaId: string;
  callerDisplayName: string;
  tenantId: string;
  humanUserId: string;
  request: MailboxAppendRequest;
  messageId: string;
}): void {
  const speaker = {
    kind: "persona" as const,
    id: input.callerPersonaId,
    display_name: input.callerDisplayName,
  };
  const traceEvent = {
    type: "tool_progress" as const,
    chat_id: input.traceThreadId,
    message_id: input.messageId,
    content: JSON.stringify({
      to: input.request.to,
      text: input.request.text,
      nonce: input.request.nonce,
    }),
    created_at: new Date().toISOString(),
    tool_name: MAILBOX_SEND_TOOL_NAME,
    tool_call_id: `mailbox-${input.messageId}`,
    tool_status: "complete" as const,
    metadata: { mailbox_send: { ...input.request } },
    speaker,
  };
  try {
    input.store.appendHistory(input.traceThreadId, traceEvent as unknown as import("./chat-store.js").ChatHistoryEvent);
  } catch {}
  // Explicit human pool append — appendHistory already does it via ChatThreadStore.contextPoolStore
  // for group+1:1 (lp-v62i.17), but also ensure direct pool write when store is wired separately.
  if (input.contextPoolStore) {
    try {
      input.contextPoolStore.append({
        key: { tenant_id: input.tenantId, human_user_id: input.humanUserId },
        threadId: input.traceThreadId,
        event: traceEvent as unknown as import("./chat-store.js").ChatHistoryEvent,
      });
    } catch {}
  }
}

export type MailboxHopResult =
  | {
      ok: true;
      mode: "one_to_one";
      target_thread_id: string;
      origin_thread_id: string | null;
      minted: boolean;
      notice_message_id: string | null;
      wake_to: string;
      allow_from_bubble: false;
    }
  | {
      ok: true;
      mode: "channel";
      target_thread_id: string;
      wake_to: string;
      allow_from_bubble: true;
    }
  | { ok: false; error: MailboxErrorCode };

function fail(error: MailboxErrorCode): MailboxHopResult {
  return { ok: false, error };
}

function personaOnRoster(thread: ChatThread, personaId: string): boolean {
  return thread.participants.some(
    (participant) =>
      participant.kind === "persona" && participant.persona_id === personaId,
  );
}

function catalogAgentOnTenant(
  store: ChatThreadStore,
  agentId: string,
  tenantId: string,
  userId?: string,
) {
  const direct = store.getAgent(agentId);
  if (direct && direct.tenant_id === tenantId) return direct;
  if (!userId) return null;
  const needle = agentId.trim().toLowerCase();
  if (!needle) return null;
  const matches = store.listAgents(tenantId, userId).filter((agent) => {
    const name = agent.name.trim().toLowerCase();
    return name === needle || name.split(/\s+/)[0] === needle;
  });
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Authorize a mailbox send. 1:1 hop mints Jack↔to if missing, appends the
 * origin notice, and never writes `from` onto the target. Channel mode
 * requires both personas on the roster and does not notice the origin 1:1.
 *
 * Origin thread is where the tool ran. Group origin + `to` on that roster
 * stays channel mode even if `request.room` is a 1:1 id — do not mint Jack↔to.
 */
export function applyMailboxHop(
  store: ChatThreadStore,
  request: MailboxAppendRequest,
  userId?: string,
  originThreadId?: string,
): MailboxHopResult {
  if (isMailboxForbiddenTo(request.to) || request.from === request.to) {
    return fail("bad_to");
  }

  const toAgent = catalogAgentOnTenant(
    store,
    request.to,
    request.tenant_id,
    userId,
  );
  if (!toAgent) {
    return fail("not_found");
  }
  const toId = toAgent.agent_id;
  if (request.from === toId) {
    return fail("bad_to");
  }

  const originRoom = originThreadId
    ? (store.getInTenant(originThreadId, request.tenant_id) ??
      store.get(originThreadId))
    : null;
  if (
    originRoom?.kind === "group" &&
    personaOnRoster(originRoom, request.from) &&
    personaOnRoster(originRoom, toId)
  ) {
    return {
      ok: true,
      mode: "channel",
      target_thread_id: originRoom.thread_id,
      wake_to: toId,
      allow_from_bubble: true,
    };
  }

  const room = store.getInTenant(request.room, request.tenant_id);
  if (!room) {
    return fail("not_found");
  }

  if (room.kind === "group") {
    if (!personaOnRoster(room, request.from)) {
      return fail("forbidden");
    }
    if (!personaOnRoster(room, toId)) {
      return fail("forbidden");
    }
    return {
      ok: true,
      mode: "channel",
      target_thread_id: room.thread_id,
      wake_to: toId,
      allow_from_bubble: true,
    };
  }

  if (room.kind !== "chat") {
    return fail("not_found");
  }

  if (room.agent_id !== toId && room.agent_id !== request.from) {
    return fail("forbidden");
  }

  const origin =
    room.agent_id === request.from
      ? room
      : store.findDirectThreadForAgent(request.from);

  const existingTarget =
    room.agent_id === toId
      ? room
      : store.findDirectThreadForAgent(toId);
  const minted = existingTarget === null;

  let target = existingTarget;
  if (!target) {
    try {
      target = store.ensureDirectThreadForAgent(toId);
    } catch {
      return fail("not_found");
    }
  }
  if (!target) {
    return fail("not_found");
  }

  let notice_message_id: string | null = null;
  if (origin && origin.kind === "chat") {
    notice_message_id = randomUUID();
    store.appendHistory(origin.thread_id, {
      type: "system_notice",
      message_id: notice_message_id,
      content: mailboxHopOriginSentNotice(toAgent.name, request.text),
      created_at: new Date().toISOString(),
      chat_id: origin.thread_id,
    });
  }

  return {
    ok: true,
    mode: "one_to_one",
    target_thread_id: target.thread_id,
    origin_thread_id: origin?.thread_id ?? null,
    minted,
    notice_message_id,
    wake_to: toId,
    allow_from_bubble: false,
  };
}

export type MailboxHopWakePayload = {
  thread_id: string;
  message: string;
  metadata: TurnRequestMetadata;
};

/**
 * Harness wake fields after a successful hop authorize (lp-v62i.3.6 / .25).
 * Tail is TARGET `listHistory`. Mailbox text is message AND hidden_instruction
 * so the addressee cannot miss the brief. 1:1 never appends `from` as a
 * speaker on Jack↔to.
 */
export function mailboxHopWakePayload(input: {
  store: Pick<ChatThreadStore, "listHistory" | "getAgent"> & {
    fetchContextPool?: (key: { tenant_id: string; human_user_id: string }) => { revision_id: number; events: unknown[]; persona_ids?: string[] } | null;
    getContextPoolMeta?: (key: { tenant_id: string; human_user_id: string }) => { revision_id: number; events: unknown[]; persona_ids?: string[] } | null;
  };
  hop: Extract<MailboxHopResult, { ok: true }>;
  text: string;
  tenantId?: string;
  humanUserId?: string;
  contextPoolStore?: {
    fetch: (key: { tenant_id: string; human_user_id: string }) => { revision_id: number; events: Array<{ event_json: unknown }>; };
    listParticipantPersonaIds: (store: unknown, key: { tenant_id: string; human_user_id: string }) => string[];
  };
  humanPoolKey?: { tenant_id: string; human_user_id: string };
}): MailboxHopWakePayload {
  const message = input.text.trim();
  const roomTail = input.store.listHistory(input.hop.target_thread_id);
  const hiddenInstruction = message || undefined;
  const toAgent = input.store.getAgent(input.hop.wake_to);
  const persona = toAgent
    ? {
        persona_id: toAgent.agent_id,
        display_name: toAgent.name,
        ...(toAgent.avatar ? { avatar_seed: toAgent.avatar } : {}),
        system_prompt: [
          `You are ${toAgent.name}. You are a named teammate, not a generic assistant. Never claim to be Muse Spark.`,
          toAgent.objective ? `Your objective: ${toAgent.objective}` : null,
          "Reply concisely as this persona.",
        ]
          .filter(Boolean)
          .join(" "),
      }
    : undefined;
  // lp-ornl: human-scoped pool is NOT used for mailbox hop — mailbox hops already carry hidden_instruction/tail.
  // But include pool if caller provides humanPoolKey (future callers may use it for 1:1 hops via BFF).
  let contextPool: { tenant_id: string; human_user_id: string; revision_id: number; events: unknown[]; persona_ids?: string[] } | undefined;
  if (input.humanPoolKey && input.contextPoolStore) {
    try {
      const fetched = input.contextPoolStore.fetch(input.humanPoolKey);
      if (fetched.events.length > 0) {
        const personaIds = input.contextPoolStore.listParticipantPersonaIds(input.store, input.humanPoolKey);
        contextPool = {
          tenant_id: input.humanPoolKey.tenant_id,
          human_user_id: input.humanPoolKey.human_user_id,
          revision_id: fetched.revision_id,
          events: fetched.events.map((e) => e.event_json),
          persona_ids: personaIds,
        };
      }
    } catch {}
  }
  return {
    thread_id: input.hop.target_thread_id,
    message,
    metadata: harnessWakeMetadata({
      hostPlaybook: HOST_PLAYBOOK,
      roomTail,
      hiddenInstruction,
      persona,
      contextPool,
    }),
  };
}

export type EnqueueMailboxHopWakeInput = {
  store: InboundQueueStore;
  startTurn: SpineStartTurn;
  owner: string;
  tenantId: string;
  userId: string;
  instanceId: string;
  hop: Extract<MailboxHopResult, { ok: true }>;
  payload: MailboxHopWakePayload;
  /** Last classified need on the target thread, if known. */
  priorNeed?: InboundSandboxNeed | null;
  wake?: SpineToolboxWakePort;
  remember?: (threadId: string, turnId: TurnId) => void | Promise<void>;
  signalMidTurn?: SpineMidTurnSignal;
};

export type MailboxHopPersistPort = {
  harnessClient: Pick<HarnessClient, "openTurnEventStream">;
  registry: HarnessTurnRegistry;
  liveEvents?: Pick<ThreadLiveEventsHub, "publish">;
};

export function mailboxHopFailureNotice(
  error: MailboxErrorCode,
  toLabel: string,
): string {
  return `Could not send to ${toLabel} (${error}).`;
}

export function mailboxHopWakeFailureNotice(
  toLabel: string,
  detail: string,
): string {
  return `Could not wake ${toLabel}: ${detail}`;
}

export function isMailboxHopInbound(
  event: ChatHistoryEvent,
): boolean {
  if (event.type !== "message_send") return false;
  const meta = event.metadata?.mailbox_inbound;
  return Boolean(meta && typeof meta === "object");
}

export function mailboxHopInboundEvent(input: {
  targetThreadId: string;
  messageId: string;
  text: string;
  fromPersonaId: string;
  fromDisplayName: string;
  originThreadId: string | null;
  createdAt?: string;
}): ChatHistoryEvent {
  return {
    type: "message_send",
    chat_id: input.targetThreadId,
    message_id: input.messageId,
    content: input.text,
    created_at: input.createdAt ?? new Date().toISOString(),
    speaker: {
      kind: "persona",
      id: input.fromPersonaId,
      display_name: input.fromDisplayName,
    },
    metadata: {
      mailbox_inbound: {
        from: input.fromPersonaId,
        from_display_name: input.fromDisplayName,
        origin_thread_id: input.originThreadId,
      },
    },
  };
}

export function appendMailboxHopInbound(input: {
  store: Pick<ChatThreadStore, "appendHistory">;
  hop: Extract<MailboxHopResult, { ok: true; mode: "one_to_one" }>;
  request: Pick<MailboxAppendRequest, "from" | "text">;
  fromDisplayName: string;
  messageId?: string;
  liveEvents?: Pick<ThreadLiveEventsHub, "publish">;
}): ChatHistoryEvent {
  const event = mailboxHopInboundEvent({
    targetThreadId: input.hop.target_thread_id,
    messageId: input.messageId ?? randomUUID(),
    text: input.request.text,
    fromPersonaId: input.request.from,
    fromDisplayName: input.fromDisplayName,
    originThreadId: input.hop.origin_thread_id,
  });
  input.store.appendHistory(input.hop.target_thread_id, event);
  input.liveEvents?.publish(input.hop.target_thread_id, event);
  return event;
}

export function appendMailboxHopOriginFailure(input: {
  store: Pick<ChatThreadStore, "getInTenant" | "get" | "appendHistory">;
  liveEvents?: Pick<ThreadLiveEventsHub, "publish">;
  tenantId: string;
  threadId: string;
  content: string;
}): ChatHistoryEvent | null {
  const thread =
    input.store.getInTenant(input.threadId, input.tenantId) ??
    input.store.get(input.threadId);
  if (!thread) return null;
  const event: ChatHistoryEvent = {
    type: "system_notice",
    message_id: randomUUID(),
    content: input.content,
    created_at: new Date().toISOString(),
    chat_id: thread.thread_id,
  };
  input.store.appendHistory(thread.thread_id, event);
  input.liveEvents?.publish(thread.thread_id, event);
  return event;
}

/**
 * Persist already-remembered harness turns onto thread history without a
 * GET /events subscriber. claim() is exactly-once with a later SSE drain.
 */
export async function persistMailboxHopHarnessOutput(input: {
  store: Pick<ChatThreadStore, "appendHistory">;
  threadId: string;
  persist: MailboxHopPersistPort;
  stallTimeoutMs?: number;
  /** Stamp empty-speaker harness output as the addressee (Bill, not Bob). */
  wakePersona?: { id: string; display_name: string };
}): Promise<void> {
  const abort = new AbortController();
  await proxyHarnessTurnsUntilAbort({
    threadId: input.threadId,
    harnessClient: input.persist.harnessClient,
    registry: input.persist.registry,
    abort: abort.signal,
    existingOnly: true,
    stallTimeoutMs: input.stallTimeoutMs,
    proxyBody: async (body) => {
      await persistHarnessOutboundBody({
        threadId: input.threadId,
        store: input.store,
        body,
        liveEvents: input.persist.liveEvents,
        wakePersona: input.wakePersona,
      });
    },
    writeError: async () => {},
  });
}

export async function persistHarnessOutboundBody(input: {
  threadId: string;
  store: Pick<ChatThreadStore, "appendHistory">;
  body: ReadableStream<Uint8Array>;
  liveEvents?: Pick<ThreadLiveEventsHub, "publish">;
  wakePersona?: { id: string; display_name: string };
}): Promise<void> {
  const reader = input.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const event = parseRelaySseDataLine(line);
        if (!event) continue;
        const personaMeta = (
          event.metadata as Record<string, unknown> | undefined
        )?.persona as
          | { persona_id?: string; display_name?: string }
          | undefined;
        const fallback = input.wakePersona;
        const stampId = personaMeta?.persona_id ?? fallback?.id;
        const stampName =
          personaMeta?.display_name ?? fallback?.display_name ?? stampId;
        const shouldStampPersona =
          (event.type === "message_send" || event.type === "tool_progress") &&
          Boolean(stampId);
        const stamped = shouldStampPersona
          ? {
              ...event,
              speaker: {
                kind: "persona" as const,
                id: stampId!,
                display_name: stampName!,
              },
            }
          : event;
        const durable = durableOutboundFromRelayEvent({
          ...stamped,
          chat_id: stamped.chat_id || input.threadId,
        });
        if (!durable) continue;
        input.store.appendHistory(input.threadId, durable);
        input.liveEvents?.publish(input.threadId, durable);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Enqueue a mailbox hop as source=mailbox on the TARGET thread.
 * Classifier inherits prior need or stays none for a hidden_instruction wake.
 */
export async function enqueueMailboxHopWake(
  input: EnqueueMailboxHopWakeInput,
): Promise<SpineDeliverResult> {
  const hiddenInstruction = Boolean(
    input.payload.metadata.hidden_instruction?.trim(),
  );
  const turn: TurnRequest = {
    tenant_id: input.tenantId,
    user_id: input.userId,
    instance_id: input.instanceId,
    thread_id: input.hop.target_thread_id,
    message: input.payload.message,
    metadata: input.payload.metadata,
  };
  return deliverSpineTurns({
    store: input.store,
    startTurn: input.startTurn,
    items: [
      inboundWorkItemFromClassifiedTurn(turn, {
        source: "mailbox",
        text: turn.message,
        hiddenInstruction,
        priorNeed: input.priorNeed,
      }),
    ],
    owner: input.owner,
    wake: input.wake,
    remember: input.remember,
    signalMidTurn: input.signalMidTurn,
  });
}
