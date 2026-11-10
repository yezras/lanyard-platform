/**
 * Shared ensure_online gate for platform call sites.
 *
 * Used by:
 * - BFF chat send (`ensure-online-chat.ts`) — Phase 5 `lp-y3j`
 * - Brain RPC (`ensure-online-brain-rpc.ts`) — Phase 5 `lp-7bk`
 * - Channel adapter inbound (`ensure-online-channel-adapter.ts` /
 *   `channel-adapter-deliver.ts` — Slack/email, lp-e23)
 *
 * Gate (fail-closed / offline-safe defaults):
 * 1. Feature flag `enabled` — **default off** at config load for every path.
 *    When off, pure no-op (no CP HTTP).
 * 2. When on, probe GET presence; if `runtime_kind !== "daytona"`, no-op
 *    (EC2 tenants stay on the always-on path; no Daytona wake).
 * 3. When on + daytona + presence already `online` → **skip wake** (no POST
 *    ensure-online). Matches Phase 5 acceptance "Online skips wake".
 * 4. When on + daytona + presence offline|waking|error → POST ensure-online
 *    (cold/warm wake or singleflight join). The waiting helper awaits CP;
 *    chat POST uses kickoff so CloudFront is not held for wait_timeout_ms
 *    (lp-vqr0.8). CP `lp-nus` owns create/start + timeout semantics.
 *
 * Offline piping (`lp-kng.2`): leave flags off so no real Daytona is woken.
 * Unit tests inject a fake ControlPlaneAuthClient (no network).
 *
 * @see docs/plans/0008-daytona-agent-sandboxes/cp-internal-orchestrator-api.md
 * @see docs/plans/0008-daytona-agent-sandboxes/presence-state-machine.md
 * @see docs/plans/0008-daytona-agent-sandboxes/offline-piping.md
 */

import type {
  EnsureOnlineRequest,
  EnsureOnlineResponse,
  InstancePresenceResponse,
  InstancePresenceState,
  RuntimeKind,
} from "./control-plane-client.js";

/** Minimal CP surface used by ensure_online hooks (real client or test fake). */
export type EnsureOnlineHookClient = {
  getInstancePresence(instanceId: string): Promise<InstancePresenceResponse>;
  ensureOnline(
    instanceId: string,
    body?: EnsureOnlineRequest,
  ): Promise<EnsureOnlineResponse>;
};

export type EnsureOnlineSkippedResult =
  | { action: "skipped"; reason: "flag_off" }
  | {
      action: "skipped";
      reason: "runtime_kind_not_daytona";
      runtime_kind: RuntimeKind;
      presence: InstancePresenceState;
    }
  | {
      /** Presence already online — wake not required (lp-y3j). */
      action: "skipped";
      reason: "already_online";
      runtime_kind: RuntimeKind;
      presence: "online";
      sandbox_id: string | null;
    };

export type EnsureOnlineHookResult =
  | EnsureOnlineSkippedResult
  | { action: "ensured"; response: EnsureOnlineResponse };

/**
 * Chat POST detach (lp-vqr0.8 / T4). Same skips as the waiting hook, plus
 * `waking` when ensure_online is in flight and has not settled this tick.
 */
export type EnsureOnlineKickoffResult =
  | EnsureOnlineHookResult
  | {
      action: "waking";
      presence: InstancePresenceState;
      flight: Promise<EnsureOnlineResponse>;
    };

export type ImmediateRace<T> =
  | { status: "resolved"; value: T }
  | { status: "rejected"; error: unknown }
  | { status: "pending" };

/**
 * Settle a promise only if it already has (or will have on this microtask
 * turn). Otherwise return `pending` on the next timer tick so the HTTP
 * handler does not wait out `wait_timeout_ms`.
 *
 * Instant test fakes resolve on a microtask and win. A delayed CP wake
 * loses and the caller returns `agent_starting`.
 */
export function raceImmediate<T>(promise: Promise<T>): Promise<ImmediateRace<T>> {
  const settled: Promise<ImmediateRace<T>> = promise.then(
    (value) => ({ status: "resolved", value }),
    (error: unknown) => ({ status: "rejected", error }),
  );
  const pending: Promise<ImmediateRace<T>> = new Promise((resolve) => {
    setTimeout(() => resolve({ status: "pending" }), 0);
  });
  return Promise.race([settled, pending]);
}

export type EnsureOnlineFlightRegistry = {
  join<T>(key: string, start: () => Promise<T>): Promise<T>;
};

/** Per-app singleflight so concurrent chat POSTs share one CP wake. */
export function createEnsureOnlineFlightRegistry(): EnsureOnlineFlightRegistry {
  const inflight = new Map<string, Promise<unknown>>();
  return {
    join<T>(key: string, start: () => Promise<T>): Promise<T> {
      const existing = inflight.get(key);
      if (existing) return existing as Promise<T>;
      const flight = start().finally(() => {
        if (inflight.get(key) === flight) {
          inflight.delete(key);
        }
      });
      inflight.set(key, flight);
      return flight;
    },
  };
}

export type EnsureOnlineIfNeededInput = {
  /** Feature flag; default must be false at config load. */
  enabled: boolean;
  authClient: EnsureOnlineHookClient;
  instanceId: string;
  /** Optional wait_timeout_ms forwarded to ensure-online. */
  waitTimeoutMs?: number;
  /**
   * lp-u7z: called immediately before POST ensure-online when a wake (or
   * singleflight join) will run. Not called on flag-off / non-daytona /
   * already-online skips. Used to emit `agent_starting` on chat SSE.
   */
  onStarting?: (info: {
    instanceId: string;
    presence: InstancePresenceState;
  }) => void | Promise<void>;
  /**
   * lp-vqr0.8: optional per-app join so concurrent chat POSTs share one
   * ensure_online HTTP call. Kickoff uses this; the waiting hook does not.
   */
  flights?: EnsureOnlineFlightRegistry;
};

type EnsureOnlineProbe =
  | { kind: "skip"; result: EnsureOnlineSkippedResult }
  | { kind: "wake"; presence: InstancePresenceState };

async function probeEnsureOnlineNeed(
  input: EnsureOnlineIfNeededInput,
): Promise<EnsureOnlineProbe> {
  if (!input.enabled) {
    return { kind: "skip", result: { action: "skipped", reason: "flag_off" } };
  }

  const presence = await input.authClient.getInstancePresence(input.instanceId);

  if (presence.runtime_kind !== "daytona") {
    return {
      kind: "skip",
      result: {
        action: "skipped",
        reason: "runtime_kind_not_daytona",
        runtime_kind: presence.runtime_kind,
        presence: presence.presence,
      },
    };
  }

  // Online short-circuit: no ensure-online POST (no second create/start).
  // offline|waking|error still POST so CP can wake or join singleflight.
  if (presence.presence === "online") {
    return {
      kind: "skip",
      result: {
        action: "skipped",
        reason: "already_online",
        runtime_kind: presence.runtime_kind,
        presence: "online",
        sandbox_id: presence.sandbox_id,
      },
    };
  }

  return { kind: "wake", presence: presence.presence };
}

function ensureOnlineBody(
  waitTimeoutMs: number | undefined,
): EnsureOnlineRequest {
  return waitTimeoutMs !== undefined ? { wait_timeout_ms: waitTimeoutMs } : {};
}

function startEnsureOnlineFlight(
  input: EnsureOnlineIfNeededInput,
): Promise<EnsureOnlineResponse> {
  const start = () =>
    input.authClient.ensureOnline(
      input.instanceId,
      ensureOnlineBody(input.waitTimeoutMs),
    );
  return input.flights
    ? input.flights.join(input.instanceId, start)
    : start();
}

/**
 * Maybe wake the sandbox before touching the agent host.
 *
 * Does **not** catch ControlPlaneRequestError — callers map status → HTTP.
 */
export async function ensureOnlineIfNeeded(
  input: EnsureOnlineIfNeededInput,
): Promise<EnsureOnlineHookResult> {
  const probe = await probeEnsureOnlineNeed(input);
  if (probe.kind === "skip") {
    return probe.result;
  }

  // Wake (or singleflight join) will run — notify before blocking POST.
  if (input.onStarting) {
    await input.onStarting({
      instanceId: input.instanceId,
      presence: probe.presence,
    });
  }

  const response = await startEnsureOnlineFlight(input);
  return { action: "ensured", response };
}

/**
 * Chat POST variant (lp-vqr0.8). Starts ensure_online but does not wait
 * `wait_timeout_ms`. If the CP call is still pending after this tick,
 * returns `waking` so the HTTP handler can release CloudFront.
 */
export async function ensureOnlineIfNeededKickoff(
  input: EnsureOnlineIfNeededInput,
): Promise<EnsureOnlineKickoffResult> {
  const probe = await probeEnsureOnlineNeed(input);
  if (probe.kind === "skip") {
    return probe.result;
  }

  if (input.onStarting) {
    await input.onStarting({
      instanceId: input.instanceId,
      presence: probe.presence,
    });
  }

  const flight = startEnsureOnlineFlight(input);
  const raced = await raceImmediate(flight);
  if (raced.status === "pending") {
    return { action: "waking", presence: probe.presence, flight };
  }
  if (raced.status === "rejected") {
    throw raced.error;
  }
  return { action: "ensured", response: raced.value };
}
