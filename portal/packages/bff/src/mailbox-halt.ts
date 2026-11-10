/**
 * Mailbox halt / thaw (lp-v62i.3.7).
 * Freeze bit is gateway-owned (relay → agent fuse). BFF is the HTTP edge.
 * Stop-on-send stays interrupt-only; this module does not freeze on cancel.
 */

import {
  parseMailboxHaltInput,
  type MailboxAppendResult,
  type MailboxErrorCode,
  type MailboxHaltInput,
} from "@lanyard/shared";

import type { ChatHistoryEvent, ChatThreadStore } from "./chat-store.js";

export type MailboxHaltOk = { ok: true };
export type MailboxHaltErr = { ok: false; status: number; error: string };
export type MailboxHaltResult = MailboxHaltOk | MailboxHaltErr;

export type MailboxFrozenLookup =
  | { ok: true; frozen: boolean }
  | MailboxHaltErr;

/** Gateway client the BFF talks to. Production: RelayClient. Tests stub this. */
export type MailboxHaltGateway = {
  haltMailbox(input: {
    instanceId: string;
    threadId: string;
  }): Promise<MailboxHaltResult>;
  thawMailbox(input: {
    instanceId: string;
    threadId: string;
  }): Promise<MailboxHaltResult>;
  isMailboxFrozen(input: {
    instanceId: string;
    threadId: string;
  }): Promise<MailboxFrozenLookup>;
};

export function mailboxErrorBody(
  error: MailboxErrorCode,
): { ok: false; error: MailboxErrorCode } {
  return { ok: false, error };
}

export function mailboxHaltRoomFromThreadId(
  threadId: string,
): MailboxHaltInput | { ok: false; error: "not_found" } {
  try {
    return parseMailboxHaltInput({ room: threadId });
  } catch {
    return { ok: false, error: "not_found" };
  }
}

export function assertNotFrozen(frozen: boolean): MailboxAppendResult | null {
  if (frozen) {
    return { ok: false, error: "frozen" };
  }
  return null;
}

export async function freezeMailboxRoom(input: {
  gateway: Pick<MailboxHaltGateway, "haltMailbox">;
  instanceId: string;
  threadId: string;
}): Promise<MailboxHaltResult> {
  return input.gateway.haltMailbox({
    instanceId: input.instanceId,
    threadId: input.threadId,
  });
}

export async function thawMailboxRoom(input: {
  gateway: Partial<Pick<MailboxHaltGateway, "thawMailbox">>;
  instanceId: string;
  threadId: string;
}): Promise<MailboxHaltResult> {
  if (typeof input.gateway.thawMailbox !== "function") {
    return { ok: true };
  }
  // Method-call syntax (same as freezeMailboxRoom) keeps RelayClient this
  // bound; extracting thawMailbox then calling it unbound made
  // this.postMailboxFreeze throw TypeError on live BFF chat send.
  return input.gateway.thawMailbox({
    instanceId: input.instanceId,
    threadId: input.threadId,
  });
}

/**
 * Mailbox send/append owned by this leaf for the freeze contract.
 * Full mailbox.send runtime is agent lac-r9w. Frozen → no new bubble.
 */
export async function appendMailboxIfNotFrozen(input: {
  gateway: Pick<MailboxHaltGateway, "isMailboxFrozen">;
  instanceId: string;
  store: Pick<ChatThreadStore, "appendHistory">;
  threadId: string;
  event: ChatHistoryEvent & { type: "message_send"; message_id: string };
}): Promise<MailboxAppendResult> {
  const lookup = await input.gateway.isMailboxFrozen({
    instanceId: input.instanceId,
    threadId: input.threadId,
  });
  if (!lookup.ok) {
    return { ok: false, error: "frozen" };
  }
  const blocked = assertNotFrozen(lookup.frozen);
  if (blocked) {
    return blocked;
  }
  const messageId = input.event.message_id;
  input.store.appendHistory(input.threadId, input.event);
  return { ok: true, message_id: messageId };
}
