/**
 * Fuse-trip room notice (lp-v62i.3.8).
 * Gateway reports the trip; BFF appends one system_notice. Freeze is
 * gateway-owned (halt-wire). Do not add Resume chrome.
 */

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { threadId, type MailboxErrorCode } from "@lanyard/shared";

import type { ChatHistoryEvent, ChatThreadStore } from "./chat-store.js";

export const MAILBOX_FUSE_TRIP_NOTICE =
  "This room paused after too much agent traffic.";

export function mailboxFuseTripNotice(): string {
  return MAILBOX_FUSE_TRIP_NOTICE;
}

export type MailboxFuseTripOk = {
  ok: true;
  inserted: boolean;
  message_id: string;
  thread_id: string;
  created_at: string;
};
export type MailboxFuseTripErr = { ok: false; error: MailboxErrorCode };
export type MailboxFuseTripResult = MailboxFuseTripOk | MailboxFuseTripErr;

export type MailboxFuseTripInput = {
  tenant_id: string;
  thread_id: string;
};

export type MailboxFuseTripLiveEvent = {
  type: "system_notice";
  chat_id: string;
  message_id: string;
  content: string;
  created_at: string;
};

export function mailboxInternalTokenMatches(
  expected: string,
  presented: string,
): boolean {
  if (!expected || !presented) return false;
  try {
    const a = createHash("sha256").update(expected, "utf8").digest();
    const b = createHash("sha256").update(presented, "utf8").digest();
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function parseMailboxFuseTripInput(
  value: unknown,
): MailboxFuseTripInput | MailboxFuseTripErr {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "not_found" };
  }
  const rec = value as Record<string, unknown>;
  const tenantId = rec.tenant_id;
  const room = rec.thread_id;
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return { ok: false, error: "not_found" };
  }
  if (typeof room !== "string") {
    return { ok: false, error: "not_found" };
  }
  try {
    return { tenant_id: tenantId, thread_id: threadId(room) };
  } catch {
    return { ok: false, error: "not_found" };
  }
}

function isOpenFuseNotice(event: ChatHistoryEvent): boolean {
  return (
    event.type === "system_notice" && event.content === MAILBOX_FUSE_TRIP_NOTICE
  );
}

function existingOpenFuseNotice(
  history: readonly ChatHistoryEvent[],
): ChatHistoryEvent | null {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const event = history[i];
    if (!event) continue;
    if (event.type === "user_message") return null;
    if (isOpenFuseNotice(event)) return event;
  }
  return null;
}

/**
 * Append exactly one fuse-trip system_notice for the room. A second trip
 * before the next human message is a no-op (one line is the product lock).
 */
export function appendMailboxFuseTripNotice(input: {
  store: Pick<ChatThreadStore, "getInTenant" | "appendHistory" | "listHistory">;
  tenant_id: string;
  thread_id: string;
  now?: Date;
}): MailboxFuseTripResult {
  const thread = input.store.getInTenant(input.thread_id, input.tenant_id);
  if (!thread) {
    return { ok: false, error: "not_found" };
  }

  const existing = existingOpenFuseNotice(
    input.store.listHistory(thread.thread_id),
  );
  if (existing && existing.type === "system_notice") {
    return {
      ok: true,
      inserted: false,
      message_id: existing.message_id,
      thread_id: thread.thread_id,
      created_at: existing.created_at,
    };
  }

  const createdAt = (input.now ?? new Date()).toISOString();
  const messageId = randomUUID();
  input.store.appendHistory(thread.thread_id, {
    type: "system_notice",
    message_id: messageId,
    content: MAILBOX_FUSE_TRIP_NOTICE,
    created_at: createdAt,
    chat_id: thread.thread_id,
  });
  return {
    ok: true,
    inserted: true,
    message_id: messageId,
    thread_id: thread.thread_id,
    created_at: createdAt,
  };
}

export function mailboxFuseTripLiveEvent(input: {
  threadId: string;
  messageId: string;
  createdAt: string;
}): MailboxFuseTripLiveEvent {
  return {
    type: "system_notice",
    chat_id: input.threadId,
    message_id: input.messageId,
    content: MAILBOX_FUSE_TRIP_NOTICE,
    created_at: input.createdAt,
  };
}
