/**
 * BFF chat send path — ensure_online before deliver-inbound (lp-y3j / Phase 5).
 *
 * Call site: POST /api/chat/threads/:threadId/messages, immediately before
 * relay deliver-inbound.
 *
 * Semantics (flag on + runtime_kind=daytona):
 * - presence offline|waking|error → POST ensure-online (wake / join singleflight)
 * - presence online → skip wake (no ensure-online POST)
 *
 * Env: `ENSURE_ONLINE_ON_CHAT` (bindings.ensureOnlineOnChat) — **default off**
 * (offline-safe; enable for daytona pilot / lab only). Speculative pre-check
 * only. A Relay handshake 502/503 still detaches as `agent_starting` (T4)
 * even when the flag is off; it does not call CP unless the flag is on.
 *
 * Offline piping stub: `lp-kng.2.8`. Phase 5 production call site: `lp-y3j`
 * (depends on CP ensure_online `lp-nus`).
 *
 * @see ./ensure-online-hook.ts
 * @see docs/plans/0008-daytona-agent-sandboxes/cp-internal-orchestrator-api.md
 * @see docs/plans/0008-daytona-agent-sandboxes/presence-state-machine.md
 */

import {
  ensureOnlineIfNeeded,
  ensureOnlineIfNeededKickoff,
  type EnsureOnlineHookClient,
  type EnsureOnlineHookResult,
  type EnsureOnlineIfNeededInput,
  type EnsureOnlineKickoffResult,
} from "./ensure-online-hook.js";

/** @deprecated Prefer EnsureOnlineHookClient — kept for chat tests/callers. */
export type EnsureOnlineChatClient = EnsureOnlineHookClient;

export type EnsureOnlineChatHookResult = EnsureOnlineHookResult;

export type EnsureOnlineBeforeChatDeliverInput = EnsureOnlineIfNeededInput;

export type EnsureOnlineChatKickoffResult = EnsureOnlineKickoffResult;

/**
 * Maybe wake the sandbox for a chat send.
 *
 * Does **not** catch ControlPlaneRequestError — callers map status → HTTP.
 */
export async function ensureOnlineBeforeChatDeliver(
  input: EnsureOnlineBeforeChatDeliverInput,
): Promise<EnsureOnlineChatHookResult> {
  return ensureOnlineIfNeeded(input);
}

/**
 * Chat POST (lp-vqr0.8 / T4). Starts the wake but does not hold the
 * CloudFront origin for `wait_timeout_ms`.
 */
export async function ensureOnlineBeforeChatDeliverKickoff(
  input: EnsureOnlineBeforeChatDeliverInput,
): Promise<EnsureOnlineChatKickoffResult> {
  return ensureOnlineIfNeededKickoff(input);
}
