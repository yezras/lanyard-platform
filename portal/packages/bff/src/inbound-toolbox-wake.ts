/**
 * Spine toolbox wake at enqueue (plan 0019 §4.4 / lp-k5c4.4).
 *
 * sandbox_need=toolbox kicks CP ensure_online (singleflight). none does not
 * wake. Leaser never talks to Daytona. Bound start_from_stopped and unbound
 * warm_pool claim are CP concerns (lp-k5c4.5); this module only calls CP.
 * Replenish stays off the Send / enqueue stack.
 */

import type { InboundWorkItem } from "@lanyard/shared";

import type {
  EnsureOnlineResponse,
  SignalActivityRequest,
  SignalActivityResponse,
} from "./control-plane-client.js";
import {
  ensureOnlineIfNeededKickoff,
  type EnsureOnlineFlightRegistry,
  type EnsureOnlineHookClient,
  type EnsureOnlineKickoffResult,
} from "./ensure-online-hook.js";

export type SpineToolboxWakeClient = EnsureOnlineHookClient & {
  signalActivity?(
    instanceId: string,
    body?: SignalActivityRequest,
  ): Promise<SignalActivityResponse>;
};

export type SpineToolboxWakePort = {
  authClient: SpineToolboxWakeClient;
  flights?: EnsureOnlineFlightRegistry;
  waitTimeoutMs?: number;
  now?: () => number;
};

export type ToolboxEnqueueWakeResult =
  | { action: "skipped"; reason: "sandbox_need_none" }
  | EnsureOnlineKickoffResult;

export async function kickToolboxEnsureOnlineAtEnqueue(input: {
  item: InboundWorkItem;
  authClient: SpineToolboxWakeClient;
  flights?: EnsureOnlineFlightRegistry;
  waitTimeoutMs?: number;
}): Promise<ToolboxEnqueueWakeResult> {
  if (input.item.sandbox_need !== "toolbox") {
    return { action: "skipped", reason: "sandbox_need_none" };
  }

  await annotateSpineWorkArrived(input.authClient, input.item.instance_id);

  return ensureOnlineIfNeededKickoff({
    enabled: true,
    authClient: input.authClient,
    instanceId: input.item.instance_id,
    flights: input.flights,
    waitTimeoutMs: input.waitTimeoutMs,
  });
}

export async function annotateSpineWorkArrived(
  authClient: SpineToolboxWakeClient,
  instanceId: string,
): Promise<void> {
  if (!authClient.signalActivity) return;
  try {
    await authClient.signalActivity(instanceId, { spine_work_arrived: true });
  } catch {
    // Lease annotation is best-effort; enqueue must still persist.
  }
}

export async function annotateSpineLeaseEmpty(
  authClient: SpineToolboxWakeClient,
  instanceId: string,
  lastTurnAtMs: number,
): Promise<void> {
  if (!authClient.signalActivity) return;
  try {
    await authClient.signalActivity(instanceId, {
      at: new Date(lastTurnAtMs).toISOString(),
      spine_lease_empty: true,
    });
  } catch {
    // Reaper falls back to 10m grace if the annotation misses.
  }
}

export async function sandboxIdFromWakeResult(
  result: ToolboxEnqueueWakeResult,
): Promise<string | undefined> {
  if (result.action === "ensured") {
    return result.response.sandbox_id ?? undefined;
  }
  if (result.action === "waking") {
    const response: EnsureOnlineResponse = await result.flight;
    return response.sandbox_id ?? undefined;
  }
  if (result.action === "skipped" && result.reason === "already_online") {
    return result.sandbox_id ?? undefined;
  }
  return undefined;
}
