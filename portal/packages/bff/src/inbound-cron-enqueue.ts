/**
 * Spine wrapper around scheduled-task harness fire (lp-k5c4.6).
 *
 * Cron shares the room lease: startTurn goes through enqueue, not a
 * private POST /internal/turns. Classifier owns sandbox_need.
 */

import type { TurnId, TurnRequest } from "@lanyard/shared";

import type { ClassifySandboxNeedInput } from "./inbound-sandbox-need.js";
import {
  deliverSpineTurns,
  inboundWorkItemFromClassifiedTurn,
  type InboundQueueStore,
  type SpineDeliverResult,
  type SpineStartTurn,
  type SpineToolboxWakePort,
} from "./inbound-queue.js";

export type EnqueueCronHarnessTurnInput = {
  store: InboundQueueStore;
  startTurn: SpineStartTurn;
  owner: string;
  turn: TurnRequest;
  sandboxCreateProfile?: ClassifySandboxNeedInput["sandboxCreateProfile"];
  wake?: SpineToolboxWakePort;
};

export async function enqueueCronHarnessTurn(
  input: EnqueueCronHarnessTurnInput,
): Promise<SpineDeliverResult> {
  return deliverSpineTurns({
    store: input.store,
    startTurn: input.startTurn,
    items: [
      inboundWorkItemFromClassifiedTurn(input.turn, {
        source: "cron",
        text: input.turn.message,
        sandboxCreateProfile: input.sandboxCreateProfile,
      }),
    ],
    owner: input.owner,
    wake: input.wake,
  });
}

/**
 * Drop-in startTurn for fireScheduledTaskHarnessTurn on spine tenants.
 */
export function spineStartTurnForCron(input: {
  store: InboundQueueStore;
  startTurn: SpineStartTurn;
  owner: string;
  sandboxCreateProfile?: ClassifySandboxNeedInput["sandboxCreateProfile"];
  wake?: SpineToolboxWakePort;
}): (request: TurnRequest) => Promise<{ turn_id: TurnId }> {
  return async (request) => {
    const delivered = await enqueueCronHarnessTurn({
      store: input.store,
      startTurn: input.startTurn,
      owner: input.owner,
      turn: request,
      sandboxCreateProfile: input.sandboxCreateProfile,
      wake: input.wake,
    });
    if (!delivered.ok) {
      throw new Error(delivered.error);
    }
    return { turn_id: delivered.turn_id };
  };
}
