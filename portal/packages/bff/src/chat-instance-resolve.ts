/**
 * Pick the chat-send instance (lp-oop.20 / lp-vqr0.11 T6).
 *
 * Harness no-tool send (`sandboxNeed: "none"`) does not POST ensure-online.
 * Daytona is the toolbox computer; `bindEnsureOnlineToolbox` wakes it.
 * `sandboxNeed: "toolbox"` still POSTs ensure-online by user with
 * `sandbox_create_profile=tool_only` (lp-oop.28).
 * Relay keeps `getPrimaryGatewayInstance` until cutover.
 */

import type {
  EnsureOnlineByUserResponse,
  EnsureOnlineRequest,
} from "./control-plane-client.js";
import {
  raceImmediate,
  type EnsureOnlineFlightRegistry,
} from "./ensure-online-hook.js";

export type ChatInstanceResolverClient = {
  getPrimaryGatewayInstance(tenantId: string): Promise<{ instance_id: string }>;
  ensureOnlineByUser(
    tenantId: string,
    userId: string,
    body?: EnsureOnlineRequest,
  ): Promise<EnsureOnlineByUserResponse>;
};

/**
 * Whether this harness hop needs a Daytona box.
 * `none` = no-tool chat (no ensure_online). `toolbox` = file/bash wake.
 * Classification is {@link classifySandboxNeed} (plan 0019 §4.2).
 */
export type HarnessSandboxNeed = "none" | "toolbox";

export {
  classifySandboxNeed,
  promptHasFileToolIntent,
  type ClassifySandboxNeedInput,
} from "./inbound-sandbox-need.js";

type ResolveChatSendInstanceBase = {
  authClient: ChatInstanceResolverClient;
  tenantId: string;
  userId: string;
  waitTimeoutMs?: number;
  /**
   * lp-vqr0.8: when true, a slow toolbox ensure-online-by-user does not
   * block. Returns `{ action: "waking" }` so the caller can 202.
   * Ignored when `sandboxNeed` is `none` (there is no wake).
   */
  detachWake?: boolean;
  flights?: EnsureOnlineFlightRegistry;
};

export type ResolveRelayChatSendInstanceInput = ResolveChatSendInstanceBase & {
  chatDelivery: "relay";
};

export type ResolveHarnessChatSendInstanceInput = ResolveChatSendInstanceBase & {
  chatDelivery: "harness";
  sandboxNeed: HarnessSandboxNeed;
};

export type ResolveChatSendInstanceInput =
  | ResolveRelayChatSendInstanceInput
  | ResolveHarnessChatSendInstanceInput;

export type ResolveChatSendInstanceResult =
  | {
      instanceId: string;
      path: "relay";
      source: "primary";
    }
  | {
      instanceId: string;
      path: "harness";
      source: "primary";
      sandboxNeed: "none";
    }
  | {
      instanceId: string;
      path: "harness";
      source: EnsureOnlineByUserResponse["source"];
      sandboxNeed: "toolbox";
      response: EnsureOnlineByUserResponse;
    };

export type HarnessWakeInFlight = {
  path: "harness";
  action: "waking";
  sandboxNeed: "toolbox";
  flight: Promise<EnsureOnlineByUserResponse>;
};

export type ResolveChatSendInstanceKickoffResult =
  | ResolveChatSendInstanceResult
  | HarnessWakeInFlight;

export function isHarnessWakeInFlight(
  result: ResolveChatSendInstanceKickoffResult,
): result is HarnessWakeInFlight {
  return result.path === "harness" && "action" in result;
}

function harnessEnsureOnlineBody(
  waitTimeoutMs: number | undefined,
): EnsureOnlineRequest {
  const body: EnsureOnlineRequest = {
    sandbox_create_profile: "tool_only",
  };
  if (waitTimeoutMs !== undefined) {
    body.wait_timeout_ms = waitTimeoutMs;
  }
  return body;
}

function startHarnessEnsureOnline(
  input: ResolveHarnessChatSendInstanceInput,
): Promise<EnsureOnlineByUserResponse> {
  const start = () =>
    input.authClient.ensureOnlineByUser(
      input.tenantId,
      input.userId,
      harnessEnsureOnlineBody(input.waitTimeoutMs),
    );
  if (!input.flights) {
    return start();
  }
  return input.flights.join(
    `user:${input.tenantId}:${input.userId}`,
    start,
  );
}

async function resolvePrimaryInstance(
  input: ResolveChatSendInstanceBase,
  path: "relay" | "harness",
): Promise<
  | { instanceId: string; path: "relay"; source: "primary" }
  | {
      instanceId: string;
      path: "harness";
      source: "primary";
      sandboxNeed: "none";
    }
> {
  const primary = await input.authClient.getPrimaryGatewayInstance(
    input.tenantId,
  );
  if (path === "relay") {
    return {
      instanceId: primary.instance_id,
      path: "relay",
      source: "primary",
    };
  }
  return {
    instanceId: primary.instance_id,
    path: "harness",
    source: "primary",
    sandboxNeed: "none",
  };
}

export async function resolveChatSendInstance(
  input: ResolveChatSendInstanceInput,
): Promise<ResolveChatSendInstanceResult> {
  if (input.chatDelivery === "relay") {
    return resolvePrimaryInstance(input, "relay");
  }
  if (input.sandboxNeed === "none") {
    return resolvePrimaryInstance(input, "harness");
  }

  const response = await startHarnessEnsureOnline(input);
  return {
    instanceId: response.instance_id,
    path: "harness",
    source: response.source,
    sandboxNeed: "toolbox",
    response,
  };
}

/**
 * Chat POST (lp-vqr0.8). Toolbox wake is started but not awaited past this
 * tick when `detachWake` is set. No-tool harness never starts a wake.
 */
export async function resolveChatSendInstanceKickoff(
  input: ResolveChatSendInstanceInput,
): Promise<ResolveChatSendInstanceKickoffResult> {
  if (input.chatDelivery !== "harness" || input.sandboxNeed === "none") {
    return resolveChatSendInstance(input);
  }
  if (!input.detachWake) {
    return resolveChatSendInstance(input);
  }

  const flight = startHarnessEnsureOnline(input);
  const raced = await raceImmediate(flight);
  if (raced.status === "pending") {
    return {
      path: "harness",
      action: "waking",
      sandboxNeed: "toolbox",
      flight,
    };
  }
  if (raced.status === "rejected") {
    throw raced.error;
  }
  return {
    instanceId: raced.value.instance_id,
    path: "harness",
    source: raced.value.source,
    sandboxNeed: "toolbox",
    response: raced.value,
  };
}
