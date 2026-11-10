/**
 * BFF platform activity signals (lp-96v / Phase 5).
 *
 * Refresh the Control Plane idle timer (`last_activity_at`) from real product
 * activity so Daytona sandboxes are not reaped while the user/agent is busy.
 *
 * Listed sources (acceptance: "Listed events call signal-activity"):
 * - **message** — user chat POST / spine sandbox_need=none (before startTurn)
 * - **toolbox** — spine sandbox_need=toolbox (before startTurn)
 * - **tool_progress** — relay SSE `tool_progress` (debounced; not per token)
 * - **brain_rpc** — Brain RPC host invoke paths
 *
 * **Not** signaled: streaming `message_send` token chunks (acceptance:
 * "Does not require Daytona round-trip per token"). CP `signal-activity` is a
 * presence-store write only — never a Daytona API call (`lp-84f`).
 *
 * Env: `SIGNAL_ACTIVITY_ENABLED` (bindings.signalActivityEnabled) — gates the
 * ambient sources (**tool_progress**, **brain_rpc**; default off, offline-safe).
 * **message and toolbox are not flag-gated** (lp-v62i.8 / lp-k5c4.7): a spine
 * send always signals so mid_turn arms even when the env var is unset — live
 * MockLab 2026-08-26 reaped a bound box mid-turn with `skipped_mid_turn=0`
 * because the flag defaulted false. Failures are best-effort: never fail the
 * user request if signal-activity errors.
 *
 * mid_turn (lp-053): message + toolbox + tool_progress arm the mid-turn lock
 * so the idle reaper does not stop during an active agent turn/tools.
 *
 * @see docs/plans/0008-daytona-agent-sandboxes/cp-internal-orchestrator-api.md
 * @see docs/plans/0008-daytona-agent-sandboxes/idle-reaper.md
 * @see docs/plans/0008-daytona-agent-sandboxes/mid-turn-protection.md
 */

import type {
  SignalActivityRequest,
  SignalActivityResponse,
} from "./control-plane-client.js";

/**
 * Spine / user-turn sources that always POST signal-activity (lp-k5c4.7).
 * Not gated by SIGNAL_ACTIVITY_ENABLED.
 */
export const ALWAYS_ARM_ACTIVITY_SOURCES = ["message", "toolbox"] as const;
export type AlwaysArmActivitySource =
  (typeof ALWAYS_ARM_ACTIVITY_SOURCES)[number];

/**
 * Ambient sources still gated by SIGNAL_ACTIVITY_ENABLED (offline-safe).
 */
export const FLAG_GATED_ACTIVITY_SOURCES = [
  "tool_progress",
  "brain_rpc",
] as const;
export type FlagGatedActivitySource =
  (typeof FLAG_GATED_ACTIVITY_SOURCES)[number];

const ALWAYS_ARM_SOURCE_SET = new Set<string>(ALWAYS_ARM_ACTIVITY_SOURCES);

/** Discrete platform events that refresh the idle timer (lp-96v / lp-k5c4.7). */
export type ActivitySignalSource =
  | AlwaysArmActivitySource
  | FlagGatedActivitySource;

export function isAlwaysArmActivitySource(
  source: ActivitySignalSource,
): source is AlwaysArmActivitySource {
  return ALWAYS_ARM_SOURCE_SET.has(source);
}

/**
 * Default min interval between tool_progress → signal-activity POSTs per
 * instance. Idle grace is 30 min; 30s debounce is plenty and avoids flooding
 * CP on high-frequency tool updates. Not applied to message / brain_rpc.
 */
export const DEFAULT_TOOL_PROGRESS_MIN_INTERVAL_MS = 30_000;

/** Minimal CP surface used by activity hooks (real client or test fake). */
export type SignalActivityHookClient = {
  signalActivity(
    instanceId: string,
    body?: SignalActivityRequest,
  ): Promise<SignalActivityResponse>;
};

export type SignalActivityHookResult =
  | { action: "skipped"; reason: "flag_off" }
  | { action: "skipped"; reason: "debounced"; source: ActivitySignalSource }
  | {
      action: "signaled";
      source: ActivitySignalSource;
      response: SignalActivityResponse;
    }
  | {
      action: "failed";
      source: ActivitySignalSource;
      error: unknown;
    };

export type SignalActivityIfNeededInput = {
  /**
   * Feature flag; default must be false at config load. Gates tool_progress /
   * brain_rpc only — `message` and `toolbox` always signal (lp-k5c4.7).
   */
  enabled: boolean;
  authClient: SignalActivityHookClient;
  instanceId: string;
  source: ActivitySignalSource;
  /**
   * Optional mid_turn arm/clear (lp-053). When omitted, defaults by source:
   * message + toolbox + tool_progress → true; brain_rpc → omit (activity only).
   */
  midTurn?: boolean | null;
  /**
   * Min interval for tool_progress debounce. Ignored for other sources.
   * Default {@link DEFAULT_TOOL_PROGRESS_MIN_INTERVAL_MS}.
   */
  minIntervalMs?: number;
  /**
   * Injectable last-signal wall clock map (tests). Key = instanceId.
   * When omitted, uses a process-local map.
   */
  lastSignaledAt?: Map<string, number>;
  /** Injectable clock (tests). */
  nowMs?: () => number;
};

/** Process-local debounce state for tool_progress (per instance_id). */
const defaultLastSignaledAt = new Map<string, number>();

/**
 * Resolve mid_turn body field from explicit override or source defaults.
 * Returns undefined when the body should omit mid_turn (no lock change).
 */
export function midTurnForSource(
  source: ActivitySignalSource,
  override?: boolean | null,
): boolean | undefined {
  if (override === null) return undefined;
  if (override !== undefined) return override;
  // Arm lock while agent turn / tools are in flight (lp-053 + lp-k5c4.7).
  if (
    source === "message" ||
    source === "toolbox" ||
    source === "tool_progress"
  ) {
    return true;
  }
  // brain_rpc: short vault/settings ops — activity only, no mid_turn change.
  return undefined;
}

/**
 * Build optional signal-activity body for a source.
 * Exported for unit tests (no network).
 */
export function buildSignalActivityBody(
  source: ActivitySignalSource,
  midTurnOverride?: boolean | null,
): SignalActivityRequest {
  const mid = midTurnForSource(source, midTurnOverride);
  if (mid === undefined) return {};
  return { mid_turn: mid };
}

/**
 * Maybe POST signal-activity for a listed platform event.
 *
 * Does **not** call Daytona. Does **not** throw on CP errors (best-effort).
 * Callers should not await for request latency unless they need the result
 * in tests — production call sites may `void signalActivityIfNeeded(...)`.
 */
export async function signalActivityIfNeeded(
  input: SignalActivityIfNeededInput,
): Promise<SignalActivityHookResult> {
  // lp-k5c4.7: message + toolbox bypass the flag — a spine send must always
  // reach CP (refresh idle timer + arm mid_turn) or the idle reaper can stop
  // the bound box mid-turn when SIGNAL_ACTIVITY_ENABLED is left unset (live
  // MockLab 2026-08-26: skipped_mid_turn=0 reap at 06:37 ET). tool_progress /
  // brain_rpc stay flag-gated (offline-safe default).
  if (!input.enabled && !isAlwaysArmActivitySource(input.source)) {
    return { action: "skipped", reason: "flag_off" };
  }

  const instanceId = input.instanceId?.trim();
  if (!instanceId) {
    return {
      action: "failed",
      source: input.source,
      error: new Error("signalActivityIfNeeded: empty instanceId"),
    };
  }

  const now = (input.nowMs ?? Date.now)();
  const lastMap = input.lastSignaledAt ?? defaultLastSignaledAt;

  if (input.source === "tool_progress") {
    const minInterval =
      input.minIntervalMs ?? DEFAULT_TOOL_PROGRESS_MIN_INTERVAL_MS;
    const last = lastMap.get(instanceId) ?? 0;
    if (now - last < minInterval) {
      return {
        action: "skipped",
        reason: "debounced",
        source: "tool_progress",
      };
    }
  }

  const body = buildSignalActivityBody(input.source, input.midTurn);

  try {
    const response = await input.authClient.signalActivity(instanceId, body);
    // Record success time for tool_progress debounce (and for other sources
    // so a follow-up tool_progress soon after message/brain_rpc can debounce).
    lastMap.set(instanceId, now);
    return { action: "signaled", source: input.source, response };
  } catch (error) {
    return { action: "failed", source: input.source, error };
  }
}

/**
 * Fire-and-forget wrapper for call sites that must not block the response.
 * Swallows all rejections (signalActivityIfNeeded already catches CP errors).
 */
export function signalActivityBestEffort(
  input: SignalActivityIfNeededInput,
): void {
  void signalActivityIfNeeded(input).catch(() => {
    /* unreachable: signalActivityIfNeeded does not throw */
  });
}

/** Test helper: clear process-local debounce map. */
export function resetSignalActivityDebounceStateForTests(): void {
  defaultLastSignaledAt.clear();
}
