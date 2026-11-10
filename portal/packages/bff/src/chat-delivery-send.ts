/**
 * Dual-run chat send + interrupt (plan 0015 / lp-oop.15 / lp-oop.16 / lp-oop.35).
 *
 * Daytona harness hop (`ChatDelivery=harness`) is a distinct input variant
 * and cannot call Relay `deliverInbound` / `interruptInbound`. EC2/guest
 * dual-run stays on the `relay` variant until those tenants move.
 */

import type { TurnId, TurnRequest } from "@lanyard/shared";

import type { HarnessClient } from "./harness-client.js";
import type { RelayClient } from "./relay-client.js";

export type ChatTurnRelayDelivery = {
  instanceId: string;
  tenantId: string;
  event: Parameters<RelayClient["deliverInbound"]>[0]["event"];
};

/** Daytona target hop: Browser → BFF → Harness. No Relay client. */
export type DeliverHarnessChatTurnInput = {
  chatDelivery: "harness";
  harnessClient?: Pick<HarnessClient, "startTurn">;
  turn: TurnRequest;
};

/** EC2 / guest-gateway dual-run until those tenants move. */
export type DeliverRelayChatTurnInput = {
  chatDelivery: "relay";
  relayClient: Pick<RelayClient, "deliverInbound">;
  relay: ChatTurnRelayDelivery;
};

export type DeliverChatTurnInput =
  | DeliverHarnessChatTurnInput
  | DeliverRelayChatTurnInput;

export type DeliverChatTurnResult =
  | { ok: true; path: "relay" }
  | { ok: true; path: "harness"; turn_id: TurnId }
  | { ok: false; status: number; error: string };

/** User-visible text sent as TurnRequest.message on the harness path. */
export function harnessTurnMessage(input: {
  text: string;
  mcqLabel?: string;
}): string {
  const text = input.text.trim();
  if (text) return text;
  return input.mcqLabel?.trim() ?? "";
}

export async function deliverChatTurn(
  input: DeliverChatTurnInput,
): Promise<DeliverChatTurnResult> {
  if (input.chatDelivery === "harness") {
    if (!input.harnessClient) {
      return {
        ok: false,
        status: 503,
        error:
          "Chat delivery is harness but no harness client is configured (set HARNESS_URL)",
      };
    }
    const message = input.turn.message.trim();
    if (!message) {
      return {
        ok: false,
        status: 400,
        error: "Harness turn requires a non-empty message",
      };
    }
    const started = await input.harnessClient.startTurn({
      ...input.turn,
      message,
    });
    if (!started.ok) {
      return {
        ok: false,
        status: started.status,
        error: started.error,
      };
    }
    return { ok: true, path: "harness", turn_id: started.turn_id };
  }

  const delivered = await input.relayClient.deliverInbound({
    instanceId: input.relay.instanceId,
    tenantId: input.relay.tenantId,
    event: input.relay.event,
  });
  if (!delivered.ok) {
    return {
      ok: false,
      status: delivered.status,
      error: delivered.error,
    };
  }
  return { ok: true, path: "relay" };
}

/**
 * lp-znef.1: sequential persona fan-out for the harness path. Each channel
 * wake target gets its own turn (persona metadata rides inside the turn).
 * Starts are serialized; turns run server-side. Returns the last turn id.
 */
export async function deliverHarnessPersonaTurns(input: {
  harnessClient: Pick<HarnessClient, "startTurn">;
  turns: TurnRequest[];
  remember: (turnId: TurnId) => void | Promise<void>;
}): Promise<
  | { ok: true; path: "harness"; turn_id: TurnId }
  | { ok: false; status: number; error: string }
> {
  let last: TurnId | undefined;
  for (const turn of input.turns) {
    const result = await deliverChatTurn({
      chatDelivery: "harness",
      harnessClient: input.harnessClient,
      turn,
    });
    if (!result.ok) return result;
    if (result.path === "harness") {
      // Remember EVERY persona turn at start time — the SSE proxy drains the
      // registry, so a turn that is only remembered at the end (previous
      // behavior) never streams (lp-znef.1 live-QA finding).
      await input.remember(result.turn_id);
      last = result.turn_id;
    }
  }
  if (!last) {
    return { ok: false, status: 400, error: "No harness turns to deliver" };
  }
  return { ok: true, path: "harness", turn_id: last };
}

/** Sequential fan-out for group-room wake stamps (one deliver per target persona). */
export async function deliverRelayChatTurns(input: {
  relayClient: Pick<RelayClient, "deliverInbound">;
  instanceId: string;
  tenantId: string;
  events: ChatTurnRelayDelivery["event"][];
}): Promise<DeliverChatTurnResult> {
  let last: DeliverChatTurnResult = { ok: true, path: "relay" };
  for (const event of input.events) {
    last = await deliverChatTurn({
      chatDelivery: "relay",
      relayClient: input.relayClient,
      relay: {
        instanceId: input.instanceId,
        tenantId: input.tenantId,
        event,
      },
    });
    if (!last.ok) return last;
  }
  return last;
}

export type InterruptHarnessChatTurnInput = {
  chatDelivery: "harness";
  harnessClient?: Pick<HarnessClient, "interruptTurn">;
  turnId?: TurnId;
};

export type InterruptRelayChatTurnInput = {
  chatDelivery: "relay";
  relayClient: Pick<RelayClient, "interruptInbound">;
  relay: {
    instanceId: string;
    sessionKey: string;
    chatId: string;
  };
};

export type InterruptChatTurnInput =
  | InterruptHarnessChatTurnInput
  | InterruptRelayChatTurnInput;

export type InterruptChatTurnResult =
  | { ok: true; path: "relay" }
  | { ok: true; path: "harness"; interrupted: boolean }
  | { ok: false; status: number; error: string };

/**
 * Relay 502/503 when the guest gateway is not on the bus yet.
 * That is agent-not-ready (T4), not a hard Send failure.
 */
export const RELAY_GATEWAY_READY_RETRY_MS = 200;
export const RELAY_GATEWAY_READY_RETRY_BUDGET_MS = 10_000;

const GATEWAY_NOT_READY_RE =
  /gateway not connected|handshake incomplete|gateway unreachable/i;

export function isRelayGatewayNotReady(input: {
  status: number;
  error: string;
}): boolean {
  if (input.status !== 502 && input.status !== 503) {
    return false;
  }
  return GATEWAY_NOT_READY_RE.test(input.error);
}

/**
 * Harness interrupt uses the remembered turn id only. Missing turn is
 * a no-op (200) so stop-before-send matches Relay's silent miss. EC2/guest
 * dual-run still calls `interruptInbound`.
 */
export async function interruptChatTurn(
  input: InterruptChatTurnInput,
): Promise<InterruptChatTurnResult> {
  if (input.chatDelivery === "harness") {
    if (!input.harnessClient) {
      return {
        ok: false,
        status: 503,
        error:
          "Chat delivery is harness but no harness client is configured (set HARNESS_URL)",
      };
    }
    if (!input.turnId) {
      return { ok: true, path: "harness", interrupted: false };
    }
    const interrupted = await input.harnessClient.interruptTurn(input.turnId);
    if (!interrupted.ok) {
      return {
        ok: false,
        status: interrupted.status,
        error: interrupted.error,
      };
    }
    return { ok: true, path: "harness", interrupted: true };
  }

  const delivered = await input.relayClient.interruptInbound({
    instanceId: input.relay.instanceId,
    sessionKey: input.relay.sessionKey,
    chatId: input.relay.chatId,
  });
  if (!delivered.ok) {
    return {
      ok: false,
      status: delivered.status,
      error: delivered.error,
    };
  }
  return { ok: true, path: "relay" };
}
