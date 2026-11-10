/**
 * Host tool channel.add_member (lp-k5c4.20).
 *
 * Wraps ChatThreadStore.addChannelMember as the owning user (tenant_id/user_id)
 * after authorizing the caller is a member of the channel. Fail closed.
 * Does not start a turn. Does not auto-add on @. No HTTP from model.
 */

import {
  parseChannelAddMemberInput,
  type ChannelAddMemberInput,
} from "@lanyard/shared";

import { ChannelNotFoundError, type ChatThreadStore } from "./chat-store.js";
import { CreateChannelError } from "./create-channel.js";

export const CHANNEL_ADD_MEMBER_TOOL_NAME = "channel.add_member" as const;

export type ChannelAddMemberHostErrorCode =
  | "not_found"
  | "forbidden"
  | "bad_request";

export type ChannelAddMemberHostResult =
  | { ok: true; channel: ReturnType<ChatThreadStore["getChannel"]> }
  | { ok: false; error: ChannelAddMemberHostErrorCode; message?: string };

export function channelAddMemberErrorBody(error: ChannelAddMemberHostErrorCode): {
  ok: false;
  error: ChannelAddMemberHostErrorCode;
} {
  return { ok: false, error };
}

/**
 * Validate tool input at BFF boundary (same shape as shared schema).
 * Throws on invalid shape; caller should map to 400.
 */
export function parseChannelAddMemberToolInput(
  value: unknown,
): ChannelAddMemberInput {
  return parseChannelAddMemberInput(value);
}

function isChannelMember(
  store: ChatThreadStore,
  threadId: string,
  agentId: string,
): boolean {
  const channel = store.getChannel(threadId);
  if (!channel) return false;
  return channel.members.some((m) => m.agent_id === agentId);
}

/**
 * Authorize and execute channel.add_member.
 *
 * - Verifies channel exists and is owned by tenant/user (via getChannelForUser)
 * - Verifies caller_agent_id is a member of the channel (fail closed → forbidden)
 * - Wraps store.addChannelMember as owner identity (tenant_id/user_id)
 * - Maps store errors to host error codes (not_found / bad_request / forbidden)
 * - Does NOT enqueue or start a turn
 */
export function applyChannelAddMember(input: {
  store: ChatThreadStore;
  tenant_id: string;
  user_id: string;
  caller_agent_id: string;
  thread_id: string;
  agent_id: string;
}): ChannelAddMemberHostResult {
  const threadId = input.thread_id.trim();
  const agentId = input.agent_id.trim();
  const callerId = input.caller_agent_id.trim();

  if (!threadId || !agentId || !callerId) {
    return { ok: false, error: "bad_request", message: "missing required id" };
  }

  // Channel must exist and be owned by this tenant/user
  const channel = input.store.getChannelForUser(
    threadId,
    input.tenant_id,
    input.user_id,
  );
  if (!channel) {
    return { ok: false, error: "not_found", message: "Channel not found" };
  }

  // Caller must be a member (fail closed)
  const callerIsMember = channel.members.some(
    (m) => m.agent_id === callerId,
  );
  if (!callerIsMember) {
    return { ok: false, error: "forbidden", message: "Caller not a member" };
  }

  // Target agent must exist in catalog for this tenant
  const targetAgent = input.store.getAgent(agentId);
  if (!targetAgent || targetAgent.tenant_id !== input.tenant_id) {
    return { ok: false, error: "not_found", message: `Unknown agent ${agentId}` };
  }

  // Wrap addChannelMember as owner identity (not spoofed Portal session)
  try {
    const updated = input.store.addChannelMember({
      thread_id: threadId,
      tenant_id: input.tenant_id,
      user_id: input.user_id,
      agent_id: agentId,
    });
    // updated is Channel; ensure participants synced (store does this)
    return { ok: true, channel: updated as ReturnType<ChatThreadStore["getChannel"]> };
  } catch (error) {
    if (error instanceof ChannelNotFoundError) {
      return { ok: false, error: "not_found", message: error.message };
    }
    if (error instanceof CreateChannelError) {
      // Map CreateChannelError issues to host codes
      const hasNotFound = error.issues.some((i) => i.code === "member_not_found");
      const hasDuplicate = error.issues.some((i) => i.code === "members_duplicate");
      if (hasNotFound) {
        return { ok: false, error: "not_found", message: error.message };
      }
      if (hasDuplicate) {
        return { ok: false, error: "bad_request", message: error.message };
      }
      return { ok: false, error: "bad_request", message: error.message };
    }
    throw error;
  }
}

/**
 * Host handler that parses raw tool input then authorizes and executes.
 * Model supplies only { thread_id, agent_id }; caller is stamped by host.
 */
export function handleChannelAddMemberToolCall(input: {
  store: ChatThreadStore;
  tenant_id: string;
  user_id: string;
  caller_agent_id: string;
  raw: unknown;
}): ChannelAddMemberHostResult {
  let parsed: ChannelAddMemberInput;
  try {
    parsed = parseChannelAddMemberInput(input.raw);
  } catch (e) {
    return {
      ok: false,
      error: "bad_request",
      message: e instanceof Error ? e.message : "invalid input",
    };
  }
  return applyChannelAddMember({
    store: input.store,
    tenant_id: input.tenant_id,
    user_id: input.user_id,
    caller_agent_id: input.caller_agent_id,
    thread_id: parsed.thread_id,
    agent_id: parsed.agent_id,
  });
}
