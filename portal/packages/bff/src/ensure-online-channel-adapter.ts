/**
 * Channel adapter inbound path — ensure_online before deliver (lp-kng.2.9 +
 * lp-e23).
 *
 * Platform messaging adapters (Slack / email / Telegram / WhatsApp / etc.)
 * that deliver inbound events to a tenant agent must call this (or the
 * shared `ensureOnlineIfNeeded`) **before** relay deliver-inbound.
 *
 * Composed deliver path (resolve primary instance → ensure_online → deliver):
 * {@link ./channel-adapter-deliver.ts} (`deliverChannelAdapterInbound`).
 *
 * **Identity (lp-e23):** one agent per tenant. Adapters pass the tenant
 * **primary** gateway `instance_id` — never a per-channel gateway or sandbox
 * id. Adapter kind is metrics/logging only and does not select compute.
 *
 * Env: `ENSURE_ONLINE_ON_CHANNEL_ADAPTER`
 * (bindings.ensureOnlineOnChannelAdapter) — **default off**.
 *
 * Same gate pattern as chat (`lp-kng.2.8`): flag → presence → ensure-online
 * only when `runtime_kind === "daytona"`. No live Daytona when flag off.
 *
 * @see ./channel-adapter-deliver.ts
 * @see ./ensure-online-hook.ts
 * @see docs/plans/0008-daytona-agent-sandboxes/cp-internal-orchestrator-api.md
 * @see docs/plans/0008-daytona-agent-sandboxes/identity-model.md
 */

import {
  ensureOnlineIfNeeded,
  type EnsureOnlineHookClient,
  type EnsureOnlineHookResult,
  type EnsureOnlineIfNeededInput,
} from "./ensure-online-hook.js";

/** Channel adapter kinds that may wake a sandbox on inbound. */
export type ChannelAdapterKind =
  | "slack"
  | "email"
  | "telegram"
  | "whatsapp"
  | "discord"
  | "web"
  | "other";

export type EnsureOnlineChannelAdapterClient = EnsureOnlineHookClient;

export type EnsureOnlineChannelAdapterHookResult = EnsureOnlineHookResult;

export type EnsureOnlineBeforeChannelInboundInput = EnsureOnlineIfNeededInput & {
  /**
   * Which adapter is about to deliver inbound (logging/metrics only).
   * Does **not** select gateway identity or sandbox — one agent per tenant.
   * Representative: `"slack"` | `"email"`.
   */
  adapter?: ChannelAdapterKind;
};

/**
 * Maybe wake the sandbox before a channel adapter delivers inbound to the agent.
 *
 * Pure helper with the same gates as BFF chat/brain_rpc.
 * Does **not** catch ControlPlaneRequestError — callers map status / retry.
 * Prefer {@link deliverChannelAdapterInbound} for the full resolve→wake→deliver path.
 */
export async function ensureOnlineBeforeChannelInbound(
  input: EnsureOnlineBeforeChannelInboundInput,
): Promise<EnsureOnlineChannelAdapterHookResult> {
  // adapter is reserved for metrics; gates and instance_id are path-agnostic.
  void input.adapter;
  return ensureOnlineIfNeeded({
    enabled: input.enabled,
    authClient: input.authClient,
    instanceId: input.instanceId,
    waitTimeoutMs: input.waitTimeoutMs,
  });
}
