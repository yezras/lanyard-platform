/**
 * Agent cold-wake starting state (lp-6ty) — Portal UI contract for BFF SSE.
 *
 * BFF (`lp-u7z`) publishes on GET /api/chat/threads/:threadId/events:
 *   - `agent_starting` — ensure_online in flight ("Agent starting…")
 *   - `agent_ready`    — wake succeeded; normal relay stream follows
 *   - `error`          — wake failed/timeout (ENSURE_ONLINE_* codes)
 *
 * Chat message POST failures use the lp-mrh JSON body (wake_timeout, …).
 *
 * @see docs/plans/0008-daytona-agent-sandboxes/cp-internal-orchestrator-api.md
 * @see docs/plans/0008-daytona-agent-sandboxes/wake-failure-errors.md
 */

/** Matches BFF `AGENT_STARTING_MESSAGE` (lp-u7z / agent-starting-events.ts). */
export const AGENT_STARTING_MESSAGE = "Agent starting…";

/** Named SSE event types the BFF injects during ensure_online (not relay chat). */
export const AGENT_WAKE_SSE_EVENT_TYPES = [
  "agent_starting",
  "agent_ready",
] as const;

export type AgentStartingLiveEvent = {
  type: "agent_starting";
  instance_id?: string;
  thread_id?: string;
  presence?: string;
  message?: string;
  created_at?: string;
};

export type AgentReadyLiveEvent = {
  type: "agent_ready";
  instance_id?: string;
  thread_id?: string;
  already_online?: boolean;
  wake_joined?: boolean;
  created_at?: string;
};

/**
 * Wake failure on chat events SSE (`event: error` frames from BFF).
 * Prefer `message` for UI; `code` may be CP ENSURE_ONLINE_* or BFF wake_*.
 */
export type AgentWakeErrorLiveEvent = {
  type: "error";
  code?: string;
  message?: string;
  instance_id?: string;
  thread_id?: string;
  status?: number;
  created_at?: string;
};

export type AgentWakeLiveEvent =
  | AgentStartingLiveEvent
  | AgentReadyLiveEvent
  | AgentWakeErrorLiveEvent;

/** UI state derived from live events (session-local; not durable history). */
export type AgentWakeUiStatus =
  | {
      kind: "starting";
      message: string;
      presence?: string;
      instanceId?: string;
    }
  | {
      kind: "error";
      message: string;
      code?: string;
      status?: number;
      retryable?: boolean;
      retryGuidance?: string;
    };

const ENSURE_ONLINE_ERROR_CODES = new Set([
  "ENSURE_ONLINE_TIMEOUT",
  "ENSURE_ONLINE_WAKE_FAILED",
  "ENSURE_ONLINE_ERROR",
]);

const WAKE_FAILURE_CODES = new Set([
  "wake_timeout",
  "daytona_unavailable",
  "vault_mount_failed",
  "wake_failed",
  "daytona_path_gated",
  "instance_revoked",
  "not_found",
  "not_implemented",
  "rate_limited",
  "invalid_argument",
  "forbidden",
  "unavailable",
]);

// Re-export chat POST helpers so UI code can import one module for wake UX.
export {
  chatSendErrorFromResponse,
  ChatSendError,
  formatWakeFailureDescription,
  isWakeFailureResponseBody,
  type WakeFailureResponseBody,
} from "../../api/chat.js";

export function isAgentWakeLiveEvent(
  value: unknown,
): value is AgentWakeLiveEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return (
    type === "agent_starting" ||
    type === "agent_ready" ||
    (type === "error" && isAgentWakeErrorPayload(value))
  );
}

/**
 * True when an `error` frame looks like ensure_online / wake failure
 * (not a generic connection error without payload).
 */
export function isAgentWakeErrorPayload(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const rec = value as Record<string, unknown>;
  if (rec.type !== "error") {
    return false;
  }
  const code = typeof rec.code === "string" ? rec.code.trim() : "";
  if (code && (ENSURE_ONLINE_ERROR_CODES.has(code) || WAKE_FAILURE_CODES.has(code))) {
    return true;
  }
  if (typeof rec.instance_id === "string" && rec.instance_id.trim()) {
    return true;
  }
  if (typeof rec.thread_id === "string" && rec.thread_id.trim()) {
    return true;
  }
  // BFF wake errors always include a message; require code or message+status.
  if (
    typeof rec.message === "string" &&
    rec.message.trim() &&
    typeof rec.status === "number"
  ) {
    return true;
  }
  return false;
}

/** Map a parsed live event into UI status (or null for agent_ready). */
export function agentWakeUiStatusFromLiveEvent(
  event: AgentWakeLiveEvent,
): AgentWakeUiStatus | null {
  if (event.type === "agent_starting") {
    const message =
      typeof event.message === "string" && event.message.trim()
        ? event.message.trim()
        : AGENT_STARTING_MESSAGE;
    return {
      kind: "starting",
      message,
      ...(typeof event.presence === "string" && event.presence
        ? { presence: event.presence }
        : {}),
      ...(typeof event.instance_id === "string" && event.instance_id
        ? { instanceId: event.instance_id }
        : {}),
    };
  }
  if (event.type === "agent_ready") {
    return null;
  }
  // error
  const message =
    typeof event.message === "string" && event.message.trim()
      ? event.message.trim()
      : "The agent failed to start. Your message was not delivered.";
  return {
    kind: "error",
    message,
    ...(typeof event.code === "string" && event.code
      ? { code: event.code }
      : {}),
    ...(typeof event.status === "number" ? { status: event.status } : {}),
  };
}

/** Banner title for wake failures (distinct from generic Hermes/relay errors). */
export function wakeFailureBannerTitle(code?: string): string {
  if (code === "wake_timeout" || code === "ENSURE_ONLINE_TIMEOUT") {
    return "Agent start timed out";
  }
  return "Agent failed to start";
}

/**
 * Parse unknown SSE JSON into a wake live event, or null if not applicable.
 */
export function parseAgentWakeLiveEvent(
  value: unknown,
): AgentWakeLiveEvent | null {
  if (!isAgentWakeLiveEvent(value)) {
    return null;
  }
  return value;
}
