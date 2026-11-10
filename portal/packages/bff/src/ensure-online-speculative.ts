/**
 * Speculative ensure_online when the user opens /chat (lp-vqr0.9 / T7).
 *
 * Same wake as Send, started earlier so start-from-stopped is hidden.
 * Joins the per-app flight registry; does not publish agent_starting
 * (the user has not sent yet).
 *
 * Relay: gated by ENSURE_ONLINE_ON_CHAT, then primary instance kickoff.
 * Harness: ensure-online-by-user is the Send resolver, so it always
 * starts (flag-off relay stays a no-op for offline piping).
 */

import {
  isHarnessWakeInFlight,
  resolveChatSendInstanceKickoff,
  type ChatInstanceResolverClient,
} from "./chat-instance-resolve.js";
import type { ChatDelivery } from "./config.js";
import {
  ensureOnlineIfNeededKickoff,
  type EnsureOnlineFlightRegistry,
  type EnsureOnlineHookClient,
  type EnsureOnlineSkippedResult,
} from "./ensure-online-hook.js";

export type SpeculativeEnsureOnlineClient = ChatInstanceResolverClient &
  EnsureOnlineHookClient;

export type SpeculativeEnsureOnlineInput = {
  enabled: boolean;
  chatDelivery: ChatDelivery;
  authClient: SpeculativeEnsureOnlineClient;
  tenantId: string;
  userId: string;
  flights?: EnsureOnlineFlightRegistry;
};

export type SpeculativeEnsureOnlineResult =
  | EnsureOnlineSkippedResult
  | { action: "waking"; path: "relay" | "harness" }
  | {
      action: "ensured";
      path: "relay" | "harness";
      already_online: boolean;
      wake_joined: boolean;
      instance_id: string;
    };

/**
 * Start the same ensure_online Send would, without waiting wait_timeout_ms.
 */
export async function kickSpeculativeEnsureOnline(
  input: SpeculativeEnsureOnlineInput,
): Promise<SpeculativeEnsureOnlineResult> {
  if (input.chatDelivery === "harness") {
    const kick = await resolveChatSendInstanceKickoff({
      chatDelivery: "harness",
      sandboxNeed: "toolbox",
      authClient: input.authClient,
      tenantId: input.tenantId,
      userId: input.userId,
      detachWake: true,
      flights: input.flights,
    });
    if (isHarnessWakeInFlight(kick)) {
      return { action: "waking", path: "harness" };
    }
    if (kick.path !== "harness" || kick.sandboxNeed !== "toolbox") {
      return { action: "skipped", reason: "flag_off" };
    }
    return {
      action: "ensured",
      path: "harness",
      already_online: kick.response.already_online,
      wake_joined: kick.response.wake_joined,
      instance_id: kick.instanceId,
    };
  }

  if (!input.enabled) {
    return { action: "skipped", reason: "flag_off" };
  }

  const primary = await input.authClient.getPrimaryGatewayInstance(
    input.tenantId,
  );
  const result = await ensureOnlineIfNeededKickoff({
    enabled: true,
    authClient: input.authClient,
    instanceId: primary.instance_id,
    flights: input.flights,
  });
  if (result.action === "skipped") {
    return result;
  }
  if (result.action === "waking") {
    return { action: "waking", path: "relay" };
  }
  return {
    action: "ensured",
    path: "relay",
    already_online: result.response.already_online,
    wake_joined: result.response.wake_joined,
    instance_id: result.response.instance_id,
  };
}
