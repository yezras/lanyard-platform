/**
 * BFF-originated SSE events for agent cold/warm wake (lp-u7z).
 *
 * While ensure_online is in flight for a chat thread, clients subscribed to
 * GET /api/chat/threads/:threadId/events observe:
 *   - `agent_starting` — wake in progress (user-visible "Agent starting…")
 *   - `agent_ready`    — ensure succeeded; stream transitions to normal relay proxy
 *   - `error`          — wake failed / timed out (maps CP 504 → ENSURE_ONLINE_TIMEOUT)
 *
 * These are **not** relay/gateway chat events; the BFF injects them on the same
 * SSE connection so the Portal UI can show starting state without looking stuck.
 *
 * @see ./thread-live-events.ts
 * @see docs/plans/0008-daytona-agent-sandboxes/cp-internal-orchestrator-api.md
 */

import { ControlPlaneRequestError } from "./control-plane-client.js";
import type { InstancePresenceState } from "./control-plane-client.js";

/** User-visible copy for the starting state (lp-6ty consumes). */
export const AGENT_STARTING_MESSAGE = "Agent starting…";

export type AgentStartingLiveEvent = {
  type: "agent_starting";
  instance_id: string;
  thread_id: string;
  /** Presence observed when wake began (offline | waking | error). */
  presence: InstancePresenceState;
  message: typeof AGENT_STARTING_MESSAGE;
  created_at: string;
};

export type AgentReadyLiveEvent = {
  type: "agent_ready";
  instance_id: string;
  thread_id: string;
  already_online: boolean;
  wake_joined: boolean;
  created_at: string;
};

/**
 * Wake failure on the chat events SSE.
 * `type` is `error` so existing clients treat it like other stream errors;
 * `code` distinguishes timeout vs hard wake fail for UI copy / retry (lp-mrh).
 */
export type AgentWakeErrorLiveEvent = {
  type: "error";
  code: string;
  message: string;
  instance_id?: string;
  thread_id?: string;
  /** HTTP status from CP when known (504 timeout, 502 wake fail, …). */
  status?: number;
  created_at: string;
};

export type AgentWakeLiveEvent =
  | AgentStartingLiveEvent
  | AgentReadyLiveEvent
  | AgentWakeErrorLiveEvent;

export function buildAgentStartingEvent(input: {
  instanceId: string;
  threadId: string;
  presence: InstancePresenceState;
  now?: Date;
}): AgentStartingLiveEvent {
  return {
    type: "agent_starting",
    instance_id: input.instanceId,
    thread_id: input.threadId,
    presence: input.presence,
    message: AGENT_STARTING_MESSAGE,
    created_at: (input.now ?? new Date()).toISOString(),
  };
}

/** HTTP 202 body when chat POST detaches from a still-running wake (T4). */
export type AgentStartingAcceptedBody = {
  ok: true;
  status: "agent_starting";
  thread_id: string;
  instance_id: string;
  presence: InstancePresenceState;
  message: typeof AGENT_STARTING_MESSAGE;
};

export function buildAgentStartingAcceptedBody(input: {
  instanceId: string;
  threadId: string;
  presence: InstancePresenceState;
}): AgentStartingAcceptedBody {
  return {
    ok: true,
    status: "agent_starting",
    thread_id: input.threadId,
    instance_id: input.instanceId,
    presence: input.presence,
    message: AGENT_STARTING_MESSAGE,
  };
}

export function buildAgentReadyEvent(input: {
  instanceId: string;
  threadId: string;
  alreadyOnline?: boolean;
  wakeJoined?: boolean;
  now?: Date;
}): AgentReadyLiveEvent {
  return {
    type: "agent_ready",
    instance_id: input.instanceId,
    thread_id: input.threadId,
    already_online: Boolean(input.alreadyOnline),
    wake_joined: Boolean(input.wakeJoined),
    created_at: (input.now ?? new Date()).toISOString(),
  };
}

/**
 * Map ensure_online / CP failures to a structured SSE error event.
 * 504 → ENSURE_ONLINE_TIMEOUT; 502 → ENSURE_ONLINE_WAKE_FAILED; else ENSURE_ONLINE_ERROR.
 */
export function mapEnsureOnlineErrorToLiveEvent(input: {
  error: unknown;
  instanceId?: string;
  threadId?: string;
  now?: Date;
}): AgentWakeErrorLiveEvent {
  const created_at = (input.now ?? new Date()).toISOString();
  if (input.error instanceof ControlPlaneRequestError) {
    const code =
      input.error.code ??
      (input.error.status === 504
        ? "ENSURE_ONLINE_TIMEOUT"
        : input.error.status === 502
          ? "ENSURE_ONLINE_WAKE_FAILED"
          : "ENSURE_ONLINE_ERROR");
    return {
      type: "error",
      code,
      message: input.error.message,
      instance_id: input.instanceId,
      thread_id: input.threadId,
      status: input.error.status,
      created_at,
    };
  }
  return {
    type: "error",
    code: "ENSURE_ONLINE_ERROR",
    message:
      input.error instanceof Error
        ? input.error.message
        : "ensure_online failed",
    instance_id: input.instanceId,
    thread_id: input.threadId,
    created_at,
  };
}
