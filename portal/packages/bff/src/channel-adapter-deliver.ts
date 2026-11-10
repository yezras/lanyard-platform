/**
 * Channel adapter inbound deliver path — ensure_online then relay deliver
 * (lp-e23 / Phase 5 wake integration).
 *
 * Spine (lp-k5c4.6): when `spine.enabled`, Slack/email/WhatsApp enqueue
 * with §4.2 classifier. Callers do not choose sandbox_need. Harness
 * tenants never call Relay deliverInbound on this path.
 *
 * Non-Portal channels (Slack, email, Telegram, …) share the **same** tenant
 * primary gateway `instance_id` as Portal chat and Brain RPC. There is **no**
 * per-channel gateway identity and **no** per-channel sandbox: one agent per
 * tenant wakes via Control Plane `ensure_online`, then Relay
 * `deliver-inbound` targets that permanent `instance_id`.
 *
 * Full Slack/email adapter runtimes (OAuth, webhook verify, MIME) may live
 * outside this package; they **must** call {@link deliverChannelAdapterInbound}
 * (or the same order: resolve primary → ensure_online → deliver) so cold
 * Daytona sandboxes wake before the agent receives inbound.
 *
 * Env: `ENSURE_ONLINE_ON_CHANNEL_ADAPTER` (bindings.ensureOnlineOnChannelAdapter)
 * — **default off**. Same gates as chat/brain_rpc: flag → presence →
 * ensure-online only when `runtime_kind === "daytona"`.
 *
 * @see ./ensure-online-channel-adapter.ts
 * @see ./ensure-online-hook.ts
 * @see docs/plans/0008-daytona-agent-sandboxes/cp-internal-orchestrator-api.md
 * @see docs/plans/0008-daytona-agent-sandboxes/identity-model.md
 */

import type {
  InboundSandboxNeed,
  InboundWorkSource,
  MessageEvent,
  TurnId,
  TurnRequest,
} from "@lanyard/shared";

import { ControlPlaneRequestError } from "./control-plane-client.js";
import {
  ensureOnlineBeforeChannelInbound,
  type ChannelAdapterKind,
  type EnsureOnlineChannelAdapterClient,
  type EnsureOnlineChannelAdapterHookResult,
} from "./ensure-online-channel-adapter.js";
import {
  mapControlPlaneWakeFailure,
  type WakeFailureCode,
} from "./ensure-online-errors.js";
import {
  deliverSpineTurns,
  inboundWorkItemFromClassifiedTurn,
  type InboundQueueStore,
  type SpineStartTurn,
  type SpineToolboxWakePort,
} from "./inbound-queue.js";
import type { RelayClient } from "./relay-client.js";

/** CP surface needed to resolve the tenant primary gateway (not per-channel). */
export type ChannelAdapterInstanceResolver = {
  getPrimaryGatewayInstance(
    tenantId: string,
  ): Promise<{ instance_id: string }>;
};

export type ChannelAdapterDeliverAuthClient = EnsureOnlineChannelAdapterClient &
  ChannelAdapterInstanceResolver;

export type ChannelAdapterSpinePort = {
  enabled: boolean;
  store: InboundQueueStore;
  startTurn: SpineStartTurn;
  owner: string;
  /** Portal user stamped on the work item. */
  userId: string;
  wake?: SpineToolboxWakePort;
};

export type ChannelAdapterDeliverDeps = {
  /**
   * When true, call CP ensure_online before deliver-inbound (daytona only).
   * Must stay false offline / default. Ignored on the spine path.
   */
  ensureOnlineEnabled: boolean;
  authClient: ChannelAdapterDeliverAuthClient;
  relayClient: Pick<RelayClient, "deliverInbound">;
  /** Plan 0019 spine. When enabled, enqueue; never deliverInbound. */
  spine?: ChannelAdapterSpinePort;
};

export type ChannelAdapterDeliverInput = {
  tenantId: string;
  /**
   * Which adapter is delivering (logging/metrics only — never selects a
   * different gateway identity).
   */
  adapter: ChannelAdapterKind;
  /** Normalized inbound event (platform string lives on event.source). */
  event: MessageEvent;
  /** Optional wait_timeout_ms forwarded to ensure-online. */
  waitTimeoutMs?: number;
  /**
   * Optional explicit instance_id. When omitted, resolves the tenant
   * **primary** gateway — adapters must not invent per-channel ids.
   */
  instanceId?: string;
};

export type ChannelAdapterDeliverResult =
  | {
      ok: true;
      path: "relay";
      instanceId: string;
      ensure: EnsureOnlineChannelAdapterHookResult;
    }
  | {
      ok: true;
      path: "spine";
      instanceId: string;
      source: InboundWorkSource;
      sandbox_need: InboundSandboxNeed;
      turn_id: TurnId;
    }
  | {
      ok: false;
      status: number;
      error: string;
      instanceId?: string;
      phase: "resolve_instance" | "ensure_online" | "deliver";
      /** lp-mrh: stable wake code when phase is ensure_online (or resolve). */
      code?: WakeFailureCode;
      retryable?: boolean;
      retry_guidance?: string;
      message?: string;
    };

export function inboundSourceForChannelAdapter(
  adapter: ChannelAdapterKind,
): InboundWorkSource | null {
  switch (adapter) {
    case "slack":
    case "email":
    case "whatsapp":
    case "web":
      return adapter;
    case "telegram":
    case "discord":
    case "other":
      return null;
  }
}

export function channelAdapterHasAttachment(event: MessageEvent): boolean {
  if (event.media_urls && event.media_urls.length > 0) return true;
  return event.message_type !== "text";
}

export function channelAdapterTurnRequest(input: {
  tenantId: string;
  userId: string;
  instanceId: string;
  event: MessageEvent;
}): TurnRequest | { error: string } {
  const threadId =
    input.event.source.thread_id?.trim() || input.event.source.chat_id.trim();
  if (!threadId) {
    return { error: "Channel adapter inbound requires a thread_id or chat_id" };
  }
  const userId = input.userId.trim() || input.event.source.user_id?.trim() || "";
  if (!userId) {
    return { error: "Channel adapter inbound requires a user_id" };
  }
  const text = input.event.text?.trim() ?? "";
  const message =
    text ||
    (channelAdapterHasAttachment(input.event) ? "[attachment]" : "");
  if (!message) {
    return { error: "Channel adapter inbound requires a non-empty message" };
  }
  return {
    tenant_id: input.tenantId,
    user_id: userId,
    instance_id: input.instanceId,
    thread_id: threadId,
    message,
  };
}

/**
 * Map adapter kind → default MessageEvent `source.platform` when callers need
 * a convention. Does **not** affect instance resolution.
 */
export function channelAdapterPlatform(adapter: ChannelAdapterKind): string {
  switch (adapter) {
    case "slack":
      return "slack";
    case "email":
      return "email";
    case "telegram":
      return "telegram";
    case "whatsapp":
      return "whatsapp";
    case "discord":
      return "discord";
    case "web":
      return "web";
    case "other":
      return "other";
  }
}

/**
 * Resolve the gateway instance for a channel adapter inbound.
 *
 * Always the tenant primary gateway (or an explicit override for tests).
 * Never derives identity from adapter kind, channel id, or mailbox.
 */
export async function resolveChannelAdapterInstanceId(
  authClient: ChannelAdapterInstanceResolver,
  input: { tenantId: string; instanceId?: string },
): Promise<string> {
  if (input.instanceId) {
    return input.instanceId;
  }
  const primary = await authClient.getPrimaryGatewayInstance(input.tenantId);
  return primary.instance_id;
}

/**
 * Wake (if needed) then deliver inbound for a non-Portal channel adapter.
 *
 * Order (lp-e23):
 * 1. Resolve tenant primary `instance_id` (no per-channel gateway identity)
 * 2. Spine tenants: classify + enqueue. Never deliverInbound.
 * 3. Else `ensureOnlineBeforeChannelInbound` when flag on + daytona
 * 4. Relay `deliverInbound` with that same `instance_id`
 *
 * Propagates ControlPlaneRequestError as `{ ok: false, phase }` for adapters
 * that map status → HTTP/retry without throwing.
 */
export async function deliverChannelAdapterInbound(
  deps: ChannelAdapterDeliverDeps,
  input: ChannelAdapterDeliverInput,
): Promise<ChannelAdapterDeliverResult> {
  let instanceId: string;
  try {
    instanceId = await resolveChannelAdapterInstanceId(deps.authClient, {
      tenantId: input.tenantId,
      instanceId: input.instanceId,
    });
  } catch (error) {
    if (error instanceof ControlPlaneRequestError) {
      const mapped = mapControlPlaneWakeFailure(error);
      return {
        ok: false,
        status: mapped.httpStatus,
        error: mapped.error,
        message: mapped.message,
        code: mapped.code,
        retryable: mapped.retryable,
        retry_guidance: mapped.retryGuidance,
        phase: "resolve_instance",
      };
    }
    throw error;
  }

  if (deps.spine?.enabled) {
    return deliverChannelAdapterSpine(deps.spine, input, instanceId);
  }

  let ensure: EnsureOnlineChannelAdapterHookResult;
  try {
    ensure = await ensureOnlineBeforeChannelInbound({
      enabled: deps.ensureOnlineEnabled,
      authClient: deps.authClient,
      instanceId,
      waitTimeoutMs: input.waitTimeoutMs,
      adapter: input.adapter,
    });
  } catch (error) {
    if (error instanceof ControlPlaneRequestError) {
      // lp-mrh: map timeout / Daytona down / vault mount → user-visible codes
      const mapped = mapControlPlaneWakeFailure(error);
      return {
        ok: false,
        status: mapped.httpStatus,
        error: mapped.error,
        message: mapped.message,
        code: mapped.code,
        retryable: mapped.retryable,
        retry_guidance: mapped.retryGuidance,
        instanceId,
        phase: "ensure_online",
      };
    }
    throw error;
  }

  const delivered = await deps.relayClient.deliverInbound({
    instanceId,
    tenantId: input.tenantId,
    event: input.event,
  });

  if (!delivered.ok) {
    return {
      ok: false,
      status: delivered.status,
      error: delivered.error,
      instanceId,
      phase: "deliver",
    };
  }

  return { ok: true, path: "relay", instanceId, ensure };
}

async function deliverChannelAdapterSpine(
  spine: ChannelAdapterSpinePort,
  input: ChannelAdapterDeliverInput,
  instanceId: string,
): Promise<ChannelAdapterDeliverResult> {
  const source = inboundSourceForChannelAdapter(input.adapter);
  if (!source) {
    return {
      ok: false,
      status: 400,
      error: `Spine does not enqueue channel adapter '${input.adapter}'`,
      instanceId,
      phase: "deliver",
    };
  }
  const turn = channelAdapterTurnRequest({
    tenantId: input.tenantId,
    userId: spine.userId,
    instanceId,
    event: input.event,
  });
  if ("error" in turn) {
    return {
      ok: false,
      status: 400,
      error: turn.error,
      instanceId,
      phase: "deliver",
    };
  }
  const item = inboundWorkItemFromClassifiedTurn(turn, {
    source,
    text: turn.message,
    hasAttachment: channelAdapterHasAttachment(input.event),
  });
  const delivered = await deliverSpineTurns({
    store: spine.store,
    startTurn: spine.startTurn,
    items: [item],
    owner: spine.owner,
    wake: spine.wake,
  });
  if (!delivered.ok) {
    return {
      ok: false,
      status: delivered.status,
      error: delivered.error,
      instanceId,
      phase: "deliver",
    };
  }
  return {
    ok: true,
    path: "spine",
    instanceId,
    source: item.source,
    sandbox_need: item.sandbox_need,
    turn_id: delivered.turn_id,
  };
}
