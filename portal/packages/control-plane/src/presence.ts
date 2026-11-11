/**
 * Presence state machine for on-demand Daytona sandboxes (lp-eya).
 *
 * Field catalog values live on `InstancePresence` / `INSTANCE_PRESENCE_STATES`
 * (lp-nye). This module owns legal transitions, validation, and reason→next
 * helpers for the Instance Orchestrator and BFF ensure_online path.
 *
 * Presence `online` is `agent_ready` (Relay / harness). `vault_writable` is a
 * separate flag (lp-vqr0.4 / 0017). Do not treat Mountpoint first-write as
 * `wake_succeeded`.
 *
 * Normative design:
 *   docs/plans/0008-daytona-agent-sandboxes/presence-state-machine.md
 * Identity context:
 *   docs/plans/0008-daytona-agent-sandboxes/identity-model.md
 *
 * Offline track only: pure types + validation. No live Daytona / AWS.
 */

import {
  INSTANCE_PRESENCE_STATES,
  type InstancePresence,
} from "./types.js";

export { INSTANCE_PRESENCE_STATES };
export type { InstancePresence };

/** Directed edge in the presence graph (non-self). */
export type PresenceTransitionEdge = readonly [
  from: InstancePresence,
  to: InstancePresence,
];

/**
 * Explicit non-self legal edges.
 *
 * Self-transitions (offline→offline, waking→waking, online→online,
 * error→error) are always legal (idempotent ensure_online / singleflight wait /
 * stop-when-already-offline).
 *
 * Wake path:   offline|error → waking → online
 * Stop path:   online|waking|error → offline
 * Failure:     waking → error; online → error (unexpected runtime loss)
 *
 * Illegal examples (must be rejected):
 *   offline → online   (must go through waking)
 *   error → online     (must go through waking)
 *   online → waking    (already up; ensure_online is a no-op stay online)
 *   offline → error    (error is post-attempt; provision stays offline)
 */
export const PRESENCE_TRANSITION_EDGES: readonly PresenceTransitionEdge[] = [
  ["offline", "waking"], // ensure_online begins create/start
  ["error", "waking"], // retry ensure_online after failure
  ["waking", "online"], // wake success (agent_ready: Relay/harness up)
  ["waking", "error"], // wake failure (create/start/mount)
  ["waking", "offline"], // abandon / cancel / timed-out wake
  ["online", "offline"], // idle stop (30m) or explicit stop
  ["online", "error"], // sandbox died / health failure while online
  ["error", "offline"], // clear error without retry
] as const;

/**
 * Lifecycle reasons the orchestrator / API use to drive presence.
 * Each reason maps to at most one next state from a given `from`.
 */
export const PRESENCE_TRANSITION_REASONS = [
  "ensure_online",
  "wake_succeeded",
  "wake_failed",
  "wake_abandoned",
  "idle_stop",
  "explicit_stop",
  "runtime_error",
  "clear",
] as const;

export type PresenceTransitionReason =
  (typeof PRESENCE_TRANSITION_REASONS)[number];

/** Thrown when a caller requests a graph-illegal from→to edge. */
export class IllegalPresenceTransitionError extends Error {
  readonly from: InstancePresence;
  readonly to: InstancePresence;

  constructor(from: InstancePresence, to: InstancePresence) {
    super(`Illegal presence transition: ${from} → ${to}`);
    this.name = "IllegalPresenceTransitionError";
    this.from = from;
    this.to = to;
  }
}

/**
 * Thrown when a lifecycle reason does not apply to the current state
 * (e.g. wake_succeeded while offline).
 */
export class IllegalPresenceReasonError extends Error {
  readonly from: InstancePresence;
  readonly reason: PresenceTransitionReason;

  constructor(from: InstancePresence, reason: PresenceTransitionReason) {
    super(`Presence reason "${reason}" is not applicable from state "${from}"`);
    this.name = "IllegalPresenceReasonError";
    this.from = from;
    this.reason = reason;
  }
}

/** Type guard for catalog presence values. */
export function isInstancePresence(value: unknown): value is InstancePresence {
  return (
    typeof value === "string" &&
    (INSTANCE_PRESENCE_STATES as readonly string[]).includes(value)
  );
}

/**
 * Parse unknown input to InstancePresence.
 * @throws {Error} when value is not a catalog state
 */
export function parseInstancePresence(value: unknown): InstancePresence {
  if (!isInstancePresence(value)) {
    throw new Error(
      `Invalid presence state: ${String(value)}; expected one of ${INSTANCE_PRESENCE_STATES.join("|")}`,
    );
  }
  return value;
}

/** True when `from → to` is legal (including self / no-op). */
export function isLegalPresenceTransition(
  from: InstancePresence,
  to: InstancePresence,
): boolean {
  if (from === to) {
    return true;
  }
  for (const [edgeFrom, edgeTo] of PRESENCE_TRANSITION_EDGES) {
    if (edgeFrom === from && edgeTo === to) {
      return true;
    }
  }
  return false;
}

/**
 * Assert `from → to` is legal.
 * @throws {IllegalPresenceTransitionError}
 */
export function assertLegalPresenceTransition(
  from: InstancePresence,
  to: InstancePresence,
): void {
  if (!isLegalPresenceTransition(from, to)) {
    throw new IllegalPresenceTransitionError(from, to);
  }
}

/**
 * Apply a presence transition if legal; return the next state.
 * @throws {IllegalPresenceTransitionError}
 */
export function transitionPresence(
  from: InstancePresence,
  to: InstancePresence,
): InstancePresence {
  assertLegalPresenceTransition(from, to);
  return to;
}

/**
 * All states reachable in one step from `from` (includes self).
 * Order matches `INSTANCE_PRESENCE_STATES`.
 */
export function allowedPresenceTargets(
  from: InstancePresence,
): InstancePresence[] {
  return INSTANCE_PRESENCE_STATES.filter((to) =>
    isLegalPresenceTransition(from, to),
  );
}

/**
 * Resolve next presence for a lifecycle reason without throwing.
 * Returns `null` when the reason does not apply from `from`
 * (caller decides no-op vs reject).
 *
 * ensure_online is idempotent: online→online and waking→waking (singleflight).
 */
export function nextPresenceForReason(
  from: InstancePresence,
  reason: PresenceTransitionReason,
): InstancePresence | null {
  switch (reason) {
    case "ensure_online":
      if (from === "online") return "online";
      if (from === "waking") return "waking";
      if (from === "offline" || from === "error") return "waking";
      return null;
    case "wake_succeeded":
      return from === "waking" ? "online" : null;
    case "wake_failed":
      return from === "waking" ? "error" : null;
    case "wake_abandoned":
      return from === "waking" ? "offline" : null;
    case "idle_stop":
    case "explicit_stop":
      if (from === "online" || from === "waking" || from === "error") {
        return "offline";
      }
      if (from === "offline") return "offline";
      return null;
    case "runtime_error":
      return from === "online" ? "error" : null;
    case "clear":
      if (from === "error" || from === "waking") return "offline";
      if (from === "offline") return "offline";
      // clear while online is not a stop; use explicit_stop / idle_stop
      return null;
    default: {
      const _exhaustive: never = reason;
      void _exhaustive;
      return null;
    }
  }
}

/**
 * Apply a lifecycle reason: resolve next state then validate the edge.
 * @throws {IllegalPresenceReasonError} when reason does not apply
 * @throws {IllegalPresenceTransitionError} if resolved edge is illegal (should not happen if table is consistent)
 */
export function applyPresenceReason(
  from: InstancePresence,
  reason: PresenceTransitionReason,
): InstancePresence {
  const next = nextPresenceForReason(from, reason);
  if (next === null) {
    throw new IllegalPresenceReasonError(from, reason);
  }
  return transitionPresence(from, next);
}
