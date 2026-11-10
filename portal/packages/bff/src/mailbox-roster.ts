/**
 * Mailbox roster checks (lp-v62i.3.1).
 * room = BFF thread_id. Fail closed: not_found / forbidden / bad_to.
 * 1:1 hop membership hole is a later leaf — default fail closed here.
 */

import {
  isConnectorMark,
  isMailboxForbiddenTo,
  type MailboxErrorCode,
} from "@lanyard/shared";

import type { ChatThread, ChatThreadStore } from "./chat-store.js";

export type MailboxRosterOk = {
  ok: true;
  thread: ChatThread;
};

export type MailboxRosterErr = {
  ok: false;
  error: MailboxErrorCode;
};

export type MailboxRosterCheck = MailboxRosterOk | MailboxRosterErr;

function isHumanAddress(thread: ChatThread, to: string): boolean {
  if (thread.user_id === to) return true;
  return thread.participants.some(
    (participant) => participant.kind === "human" && participant.user_id === to,
  );
}

function fromIsOnRoster(
  store: ChatThreadStore,
  thread: ChatThread,
  from: string,
): boolean {
  if (
    thread.participants.some(
      (participant) =>
        participant.kind === "persona" && participant.persona_id === from,
    )
  ) {
    return true;
  }
  const channel = store.getChannel(thread.thread_id);
  if (!channel) return false;
  return channel.members.some((member) => member.agent_id === from);
}

function toIsCatalogPersona(
  store: ChatThreadStore,
  tenantId: string,
  to: string,
): boolean {
  const agent = store.getAgent(to);
  return agent !== undefined && agent.tenant_id === tenantId;
}

function badTo(to: string): boolean {
  if (to.length === 0) return true;
  if (isMailboxForbiddenTo(to) || isConnectorMark(to.toLowerCase())) {
    return true;
  }
  return false;
}

/**
 * Lookup room, membership of `from`, existence of `to`.
 * Channel: `from` must be a roster persona. Unknown `to` is not_found;
 * Jack / connector / human / self is bad_to.
 */
export function checkMailboxRoster(input: {
  store: ChatThreadStore;
  tenant_id: string;
  room: string;
  from: string;
  to: string;
}): MailboxRosterCheck {
  if (badTo(input.to) || input.from === input.to) {
    return { ok: false, error: "bad_to" };
  }

  const thread = input.store.getInTenant(input.room, input.tenant_id);
  if (!thread) {
    return { ok: false, error: "not_found" };
  }

  if (!fromIsOnRoster(input.store, thread, input.from)) {
    return { ok: false, error: "forbidden" };
  }

  if (isHumanAddress(thread, input.to)) {
    return { ok: false, error: "bad_to" };
  }

  if (!toIsCatalogPersona(input.store, input.tenant_id, input.to)) {
    return { ok: false, error: "not_found" };
  }

  return { ok: true, thread };
}
