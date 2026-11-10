/**
 * Single mailbox.send hop brain (lp-k5c4.16 / lp-v62i.25).
 *
 * Tool calls and agent @ prose both land here. In a group, @Name / @here
 * in an agent's message_send wakes that teammate in the same room
 * (lp-v62i.27) — not a hidden 1:1 hop.
 */

import { randomUUID } from "node:crypto";

import {
  isConnectorMark,
  isJackAddress,
  MAILBOX_SEND_TOOL_NAME,
  parseMailboxAppendRequest,
  parseMailboxSendInput,
  personaId,
  proseMailboxNonce,
  threadId,
  type MailboxAppendRequest,
  type MailboxErrorCode,
  type MailboxSendInput,
} from "@lanyard/shared";

import type { ChatThread, ChatThreadStore, DurableAgent } from "./chat-store.js";
import {
  isRoomAddressText,
  parsePersonaMentions,
} from "./group-inbound-stamp.js";
import type { ThreadLiveEventsHub } from "./thread-live-events.js";
import type { MailboxFuseTripLiveEvent } from "./mailbox-fuse-notice.js";
import type { MailboxHaltGateway } from "./mailbox-halt.js";
import { MailboxNonceStore } from "./mailbox-nonce.js";
import {
  appendMailboxHopInbound,
  appendMailboxHopOriginFailure,
  appendMailboxSendToolTrace,
  applyMailboxHop,
  enqueueMailboxHopWake,
  mailboxHopFailureNotice,
  mailboxHopWakeFailureNotice,
  mailboxHopWakePayload,
  persistMailboxHopHarnessOutput,
  type EnqueueMailboxHopWakeInput,
  type MailboxHopPersistPort,
  type MailboxHopResult,
} from "./mailbox-hop.js";

/** `@token` after start, whitespace, or punctuation. Emails (`a@b`) do not match. */
const MENTION_RE = /(^|[^\w])@([A-Za-z0-9][A-Za-z0-9._-]*)/g;

export { MAILBOX_SEND_TOOL_NAME };

export type MailboxSendExecution =
  | {
      ok: true;
      hop: Extract<MailboxHopResult, { ok: true }> | null;
      replayed: boolean;
      message_id: string;
      /** Settles when the addressee persist pump finishes (or immediately if none). */
      outputPersist: Promise<void>;
    }
  | { ok: false; error: MailboxErrorCode };

export type MailboxSpineEnqueue = Pick<
  EnqueueMailboxHopWakeInput,
  | "store"
  | "startTurn"
  | "owner"
  | "wake"
  | "remember"
  | "signalMidTurn"
> & {
  persist?: MailboxHopPersistPort;
};

function fail(error: MailboxErrorCode): MailboxSendExecution {
  return { ok: false, error };
}

function mentionTokens(text: string): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(MENTION_RE)) {
    const token = match[2];
    if (!token) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push(token);
  }
  return tokens;
}

function mentionMatches(
  token: string,
  id: string,
  displayName: string | undefined,
): boolean {
  const needle = token.toLowerCase();
  if (id.toLowerCase() === needle) return true;
  if (!displayName) return false;
  const name = displayName.toLowerCase();
  if (name === needle) return true;
  if (needle.length > 0 && name.split(/\s+/)[0] === needle) return true;
  return name.startsWith(`${needle} `);
}

/** Catalog @mentions. Connector marks and Jack are not personas. */
export function parseCatalogPersonaMentions(
  text: string,
  agents: readonly Pick<DurableAgent, "agent_id" | "name">[],
): string[] {
  const wanted = new Set<string>();
  for (const token of mentionTokens(text)) {
    if (isJackAddress(token) || isConnectorMark(token.toLowerCase())) {
      continue;
    }
    for (const agent of agents) {
      if (mentionMatches(token, agent.agent_id, agent.name)) {
        wanted.add(agent.agent_id);
      }
    }
  }
  return agents
    .map((agent) => agent.agent_id)
    .filter((id) => wanted.has(id));
}

/** Group message_send @Name / @here → other roster personas (lp-v62i.27). */
export function groupProseMailboxTos(input: {
  thread: ChatThread;
  from: string;
  content: string;
}): string[] {
  if (input.thread.kind !== "group") return [];
  const personas = input.thread.participants.filter(
    (participant) => participant.kind === "persona",
  );
  if (isRoomAddressText(input.content)) {
    return personas
      .map((participant) => participant.persona_id)
      .filter((id) => id !== input.from);
  }
  return parsePersonaMentions(input.content, input.thread.participants).filter(
    (id) => id !== input.from,
  );
}

export function mailboxHopNoticeLiveEvent(input: {
  threadId: string;
  messageId: string;
  content: string;
  createdAt: string;
}): MailboxFuseTripLiveEvent {
  return {
    type: "system_notice",
    chat_id: input.threadId,
    message_id: input.messageId,
    content: input.content,
    created_at: input.createdAt,
  };
}

function recordFromUnknown(
  value: unknown,
): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/** BFF thread_ids are UUIDs. A display name is not a room id. */
const HOST_THREAD_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Host stamps mailbox.send `room` from the origin thread when the model
 * omits it or sends a name. Keep a UUID the model already supplied.
 */
export function hostStampMailboxRoom(
  room: unknown,
  originThreadId: string,
): string {
  if (typeof room === "string") {
    const trimmed = room.trim();
    if (HOST_THREAD_ID_RE.test(trimmed)) return trimmed;
  }
  return originThreadId;
}

function sendInputFromUnknown(
  value: unknown,
  originThreadId?: string,
): MailboxSendInput | null {
  const rec = recordFromUnknown(value);
  const nonce =
    rec && typeof rec.nonce === "string" && rec.nonce.trim()
      ? rec.nonce
      : randomUUID();
  const room =
    originThreadId !== undefined
      ? hostStampMailboxRoom(rec?.room, originThreadId)
      : typeof rec?.room === "string"
        ? rec.room
        : undefined;
  const candidate =
    rec && room !== undefined
      ? { ...rec, room, nonce }
      : rec;
  try {
    return parseMailboxSendInput(candidate ?? value);
  } catch {
    if (!rec) return null;
    const to = rec.to;
    const text = rec.text;
    if (typeof to !== "string" || typeof text !== "string" || !room) {
      return null;
    }
    try {
      return parseMailboxSendInput({
        to,
        room,
        text,
        nonce,
      });
    } catch {
      return null;
    }
  }
}

function sendInputFromContentJson(content: string): MailboxSendInput | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return null;
  }
  const direct = sendInputFromUnknown(parsed);
  if (direct) return direct;
  const rec = recordFromUnknown(parsed);
  if (!rec) return null;
  if (rec.mailbox_send) {
    const nested = sendInputFromUnknown(rec.mailbox_send);
    if (nested) return nested;
  }
  const name = rec.name ?? rec.tool_name ?? rec.tool;
  const args = rec.arguments ?? rec.input ?? rec.params;
  if (
    (name === MAILBOX_SEND_TOOL_NAME || name === "mailbox_send") &&
    args
  ) {
    return sendInputFromUnknown(args);
  }
  return null;
}

/**
 * Pull mailbox.send args off a harness/Relay tool_progress row.
 * Extra @ in the tool body is text; only `to` wakes.
 * Live 2026-08-28: empty speaker, JSON `{to,room,text}` in content, no tool_name.
 */
export function mailboxSendFromToolEvent(
  event: {
    type?: string;
    tool_name?: string;
    tool_label?: string;
    content?: string;
    metadata?: Record<string, unknown>;
  },
  originThreadId?: string,
): MailboxSendInput | null {
  if (event.type !== "tool_progress") return null;
  const nested = event.metadata?.mailbox_send;
  if (nested) {
    const parsed = sendInputFromUnknown(nested, originThreadId);
    if (parsed) return parsed;
  }
  if (typeof event.content === "string" && event.content.trim()) {
    try {
      const stamped = sendInputFromUnknown(
        JSON.parse(event.content) as unknown,
        originThreadId,
      );
      if (stamped) return stamped;
    } catch {
      /* fall through to nested-argument parse */
    }
    const fromContent = sendInputFromContentJson(event.content);
    if (fromContent) {
      return sendInputFromUnknown(fromContent, originThreadId) ?? fromContent;
    }
  }
  return null;
}

function speakerPersonaId(
  speaker:
    | { kind?: string; id?: string; display_name?: string }
    | string
    | null
    | undefined,
): string | null {
  if (!speaker || typeof speaker !== "object") return null;
  if (speaker.kind !== "persona") return null;
  const id = speaker.id?.trim();
  return id ? id : null;
}

function metadataPersonaId(
  metadata: Record<string, unknown> | undefined,
): string | null {
  const persona = metadata?.persona;
  if (!persona || typeof persona !== "object" || Array.isArray(persona)) {
    return null;
  }
  const id = (persona as { persona_id?: unknown }).persona_id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/** Empty speaker: from = persona metadata, else 1:1 agent_id, else group lead. */
export function mailboxFromForHarnessEvent(
  event: {
    speaker?: { kind?: string; id?: string; display_name?: string } | string | null;
    metadata?: Record<string, unknown>;
  },
  thread: Pick<ChatThread, "agent_id" | "orchestrator_persona_id">,
): string | null {
  return (
    speakerPersonaId(event.speaker) ??
    metadataPersonaId(event.metadata) ??
    (thread.agent_id?.trim() ? thread.agent_id : null) ??
    (thread.orchestrator_persona_id?.trim()
      ? thread.orchestrator_persona_id
      : null)
  );
}

export function parseMailboxAppendOrError(
  value: unknown,
): MailboxAppendRequest | { ok: false; error: MailboxErrorCode } {
  try {
    return parseMailboxAppendRequest(value);
  } catch {
    return { ok: false, error: "not_found" };
  }
}

export async function executeMailboxSend(input: {
  chat: ChatThreadStore;
  nonces: MailboxNonceStore;
  request: MailboxAppendRequest;
  liveEvents?: Pick<ThreadLiveEventsHub, "publish">;
  spine?: MailboxSpineEnqueue | null;
  userId: string;
  instanceId: string;
  /** Channel tool send writes a from bubble. Prose path sets false (already teed). */
  appendFromBubble?: boolean;
  gateway?: Pick<MailboxHaltGateway, "isMailboxFrozen">;
  /** Thread where the tool ran. Group + roster `to` stays channel even if `room` is 1:1. */
  originThreadId?: string;
}): Promise<MailboxSendExecution> {
  const existing = input.nonces.lookup(input.request.room, input.request.nonce);
  if (existing !== undefined) {
    return {
      ok: true,
      hop: null,
      replayed: true,
      message_id: existing,
      outputPersist: Promise.resolve(),
    };
  }

  if (input.gateway) {
    try {
      const lookup = await input.gateway.isMailboxFrozen({
        instanceId: input.instanceId,
        threadId: input.request.room,
      });
      if (lookup.ok && lookup.frozen) {
        return fail("frozen");
      }
    } catch {
      /* Spine tenants may have no Relay freeze probe. Fail open. */
    }
  }

  const hop = applyMailboxHop(
    input.chat,
    input.request,
    input.userId,
    input.originThreadId,
  );
  if (!hop.ok) {
    const toAgent = input.chat.getAgent(input.request.to);
    appendMailboxHopOriginFailure({
      store: input.chat,
      liveEvents: input.liveEvents,
      tenantId: input.request.tenant_id,
      threadId: input.originThreadId ?? input.request.room,
      content: mailboxHopFailureNotice(
        hop.error,
        toAgent?.name ?? input.request.to,
      ),
    });
    return fail(hop.error);
  }

  const messageId = hop.ok && hop.mode === "one_to_one"
    ? hop.notice_message_id ?? randomUUID()
    : randomUUID();
  input.nonces.remember(input.request.room, input.request.nonce, messageId);

  if (hop.mode === "one_to_one" && hop.origin_thread_id && hop.notice_message_id) {
    const originHistory = input.chat.listHistory(hop.origin_thread_id);
    const notice = originHistory.find(
      (event) =>
        event.type === "system_notice" && event.message_id === hop.notice_message_id,
    );
    if (notice && notice.type === "system_notice") {
      input.liveEvents?.publish(
        hop.origin_thread_id,
        mailboxHopNoticeLiveEvent({
          threadId: hop.origin_thread_id,
          messageId: notice.message_id,
          content: notice.content,
          createdAt: notice.created_at,
        }),
      );
    }
  }

  if (
    hop.mode === "channel" &&
    hop.allow_from_bubble &&
    input.appendFromBubble !== false
  ) {
    const fromAgent = input.chat.getAgent(input.request.from);
    input.chat.appendHistory(hop.target_thread_id, {
      type: "message_send",
      chat_id: hop.target_thread_id,
      message_id: messageId,
      content: input.request.text,
      created_at: new Date().toISOString(),
      speaker: {
        kind: "persona",
        id: input.request.from,
        display_name: fromAgent?.name ?? input.request.from,
      },
    });
  }

  // lp-v62i.17 — persist mailbox.send tool_progress (speaker=caller) into origin thread history + human pool (tenant+human)
  // so follow-up "Message him" can resolve via pool delta. Covers both 1:1 and group origin.
  try {
    const fromAgent = input.chat.getAgent(input.request.from);
    const callerDisplayName = fromAgent?.name ?? input.request.from;
    // Origin thread is where the tool ran; channel stays on the shared log even if room was 1:1.
    const traceThreadId =
      hop.mode === "one_to_one"
        ? hop.origin_thread_id ?? input.originThreadId ?? input.request.room
        : hop.target_thread_id;
    const traceThread = input.chat.getInTenant(traceThreadId, input.request.tenant_id) ?? input.chat.get(traceThreadId);
    const humanUserId = (traceThread as unknown as { user_id?: string } | null)?.user_id ?? input.userId;
    // Try to get the pool store that ChatThreadStore was wired with (via setContextPoolStore), otherwise no-op
    const poolStore = (input.chat as unknown as { contextPoolStore?: import("./context-pool.js").ContextPoolStore | null }).contextPoolStore ?? null;
    appendMailboxSendToolTrace({
      store: input.chat,
      contextPoolStore: poolStore,
      traceThreadId,
      callerPersonaId: input.request.from,
      callerDisplayName,
      tenantId: input.request.tenant_id,
      humanUserId,
      request: input.request,
      messageId,
    });
  } catch {}

  const payload = input.spine
    ? mailboxHopWakePayload({
        store: input.chat,
        hop,
        text: input.request.text,
      })
    : null;

  if (hop.mode === "one_to_one") {
    const fromAgent = input.chat.getAgent(input.request.from);
    appendMailboxHopInbound({
      store: input.chat,
      hop,
      request: input.request,
      fromDisplayName: fromAgent?.name ?? input.request.from,
      liveEvents: input.liveEvents,
    });
  }

  let outputPersist: Promise<void> = Promise.resolve();
  if (input.spine && payload) {
    const delivered = await enqueueMailboxHopWake({
      store: input.spine.store,
      startTurn: input.spine.startTurn,
      owner: input.spine.owner,
      tenantId: input.request.tenant_id,
      userId: input.userId,
      instanceId: input.instanceId,
      hop,
      payload,
      wake: input.spine.wake,
      remember: input.spine.remember,
      signalMidTurn: input.spine.signalMidTurn,
    });
    if (!delivered.ok) {
      const toAgent = input.chat.getAgent(hop.wake_to);
      appendMailboxHopOriginFailure({
        store: input.chat,
        liveEvents: input.liveEvents,
        tenantId: input.request.tenant_id,
        threadId:
          hop.mode === "one_to_one"
            ? hop.origin_thread_id ?? input.originThreadId ?? input.request.room
            : hop.target_thread_id,
        content: mailboxHopWakeFailureNotice(
          toAgent?.name ?? hop.wake_to,
          delivered.error,
        ),
      });
    } else if (input.spine.persist) {
      const toAgent = input.chat.getAgent(hop.wake_to);
      outputPersist = persistMailboxHopHarnessOutput({
        store: input.chat,
        threadId: hop.target_thread_id,
        persist: {
          harnessClient: input.spine.persist.harnessClient,
          registry: input.spine.persist.registry,
          liveEvents: input.liveEvents,
        },
        wakePersona: {
          id: hop.wake_to,
          display_name: toAgent?.name ?? hop.wake_to,
        },
      }).catch(() => {});
    }
  }

  return { ok: true, hop, replayed: false, message_id: messageId, outputPersist };
}

export async function hopHumanOneToOneMentions(input: {
  chat: ChatThreadStore;
  nonces: MailboxNonceStore;
  liveEvents?: Pick<ThreadLiveEventsHub, "publish">;
  spine?: MailboxSpineEnqueue | null;
  tenantId: string;
  userId: string;
  instanceId: string;
  thread: ChatThread;
  text: string;
  nonceSeed: string;
  gateway?: Pick<MailboxHaltGateway, "isMailboxFrozen">;
}): Promise<{ hopped: boolean; tos: string[] }> {
  if (input.thread.kind !== "chat" || !input.thread.agent_id) {
    return { hopped: false, tos: [] };
  }
  const agents = input.chat.listAgents(input.tenantId, input.userId);
  const peers = parseCatalogPersonaMentions(input.text, agents).filter(
    (id) => id !== input.thread.agent_id,
  );
  if (peers.length === 0) {
    return { hopped: false, tos: [] };
  }

  const tos: string[] = [];
  for (const to of peers) {
    let parsed: MailboxAppendRequest;
    try {
      parsed = parseMailboxAppendRequest({
        from: input.thread.agent_id,
        to,
        room: input.thread.thread_id,
        text: input.text,
        nonce: proseMailboxNonce(
          input.nonceSeed,
          personaId(to),
          threadId(input.thread.thread_id),
        ),
        tenant_id: input.tenantId,
      });
    } catch {
      continue;
    }
    const result = await executeMailboxSend({
      chat: input.chat,
      nonces: input.nonces,
      request: parsed,
      liveEvents: input.liveEvents,
      spine: input.spine,
      userId: input.userId,
      instanceId: input.instanceId,
      appendFromBubble: false,
      gateway: input.gateway,
      originThreadId: input.thread.thread_id,
    });
    if (result.ok) {
      tos.push(to);
      void result.outputPersist.catch(() => {});
    }
  }
  return { hopped: tos.length > 0, tos };
}

export async function hopMailboxFromHarnessEvent(input: {
  chat: ChatThreadStore;
  nonces: MailboxNonceStore;
  liveEvents?: Pick<ThreadLiveEventsHub, "publish">;
  spine?: MailboxSpineEnqueue | null;
  tenantId: string;
  userId: string;
  instanceId: string;
  thread: ChatThread;
  event: {
    type?: string;
    content?: string;
    tool_name?: string;
    tool_label?: string;
    metadata?: Record<string, unknown>;
    speaker?: { kind?: string; id?: string; display_name?: string } | string | null;
  };
  mailedTo: Set<string>;
  nonceSeed: string;
  gateway?: Pick<MailboxHaltGateway, "isMailboxFrozen">;
}): Promise<string[]> {
  const from = mailboxFromForHarnessEvent(input.event, input.thread);
  if (!from) return [];

  const toolSend = mailboxSendFromToolEvent(
    input.event,
    input.thread.thread_id,
  );
  const agents = input.chat.listAgents(input.tenantId, input.userId);
  const proseTos =
    input.event.type === "message_send" && input.event.content
      ? input.thread.kind === "group"
        ? groupProseMailboxTos({
            thread: input.thread,
            from,
            content: input.event.content,
          })
        : parseCatalogPersonaMentions(input.event.content, agents).filter(
            (id) => id !== from,
          )
      : [];

  const sends: MailboxAppendRequest[] = [];
  if (toolSend) {
    const parsed = parseMailboxAppendOrError({
      ...toolSend,
      from,
      tenant_id: input.tenantId,
    });
    if (!("error" in parsed)) {
      sends.push(parsed);
    }
  }
  for (const to of proseTos) {
    if (sends.some((send) => send.to === to)) continue;
    const room = input.thread.thread_id;
    try {
      sends.push(
        parseMailboxAppendRequest({
          from,
          to,
          room,
          text: input.event.content ?? "",
          nonce: proseMailboxNonce(
            input.nonceSeed,
            personaId(to),
            threadId(room),
          ),
          tenant_id: input.tenantId,
        }),
      );
    } catch {
      /* skip illegal ids */
    }
  }

  const woken: string[] = [];
  for (const request of sends) {
    if (input.mailedTo.has(request.to)) continue;
    const result = await executeMailboxSend({
      chat: input.chat,
      nonces: input.nonces,
      request,
      liveEvents: input.liveEvents,
      spine: input.spine,
      userId: input.userId,
      instanceId: input.instanceId,
      appendFromBubble:
        toolSend !== null &&
        (request.room === input.thread.thread_id ||
          input.thread.kind === "group"),
      gateway: input.gateway,
      originThreadId: input.thread.thread_id,
    });
    if (result.ok) {
      const resolvedTo = result.hop?.wake_to ?? request.to;
      input.mailedTo.add(request.to);
      input.mailedTo.add(resolvedTo);
      woken.push(resolvedTo);
      void result.outputPersist.catch(() => {});
    }
  }
  return woken;
}
