/**
 * Inbound work spine enqueue + keyed room lease (plan 0019 §4.3 / lp-k5c4.3).
 *
 * Durable store is Postgres SKIP LOCKED (see inbound-queue-pg.ts). Capacity is
 * min(ready_rooms, harness_slots). Steal unleased keys only.
 *
 * Toolbox enqueue kicks CP ensure_online (singleflight). Room drain annotates
 * stop_after for the CP idle reaper (lp-k5c4.4). Leaser never calls Daytona.
 *
 * Per-tenant inflight cap is a follow-up (same idea as ENSURE_ONLINE_TENANT_MAX_WAKES).
 */

import { randomUUID } from "node:crypto";

import {
  parseInboundWorkItem,
  type InboundSandboxNeed,
  type InboundWorkItem,
  type InboundWorkSource,
  type TurnId,
  type TurnRequest,
} from "@lanyard/shared";

import {
  classifySandboxNeed,
  type ClassifySandboxNeedInput,
} from "./inbound-sandbox-need.js";

import {
  annotateSpineLeaseEmpty,
  kickToolboxEnsureOnlineAtEnqueue,
  sandboxIdFromWakeResult,
  type SpineToolboxWakePort,
  type ToolboxEnqueueWakeResult,
} from "./inbound-toolbox-wake.js";

export const DEFAULT_INBOUND_LEASE_TTL_MS = 30_000;
export const DEFAULT_HARNESS_SLOTS = 8;
export const DEFAULT_INBOUND_DRAIN_TIMEOUT_MS = 30_000;

export type InboundRoomKey = {
  tenant_id: string;
  thread_id: string;
};

export type InboundItemStatus =
  | "queued"
  | "leased"
  | "started"
  | "done"
  | "failed";

export type InboundStoredItem = {
  item_id: string;
  tenant_id: string;
  thread_id: string;
  payload: InboundWorkItem;
  status: InboundItemStatus;
  turn_id: TurnId | null;
  error: string | null;
};

export type InboundEnqueueResult = {
  item_id: string;
  wake?: ToolboxEnqueueWakeResult;
};

export type { SpineToolboxWakePort };

export type SpineStartTurn = (
  request: TurnRequest,
) => Promise<
  | { ok: true; turn_id: TurnId }
  | { ok: false; status: number; error: string }
>;

export type SpineDeliverResult =
  | { ok: true; path: "harness"; turn_id: TurnId }
  | { ok: false; status: number; error: string };

/**
 * Arm (`true`) or clear (`false`) CP mid_turn for a spine work item.
 * Best-effort: callers swallow CP errors inside signalActivityIfNeeded.
 */
export type SpineMidTurnSignal = (
  item: InboundWorkItem,
  midTurn: boolean,
) => Promise<void>;

/**
 * Toolbox work items use the always-arm `toolbox` source; everything else is
 * a message send (web/slack/email/cron/mailbox with sandbox_need=none).
 */
export function inboundActivitySource(
  item: Pick<InboundWorkItem, "sandbox_need">,
): "message" | "toolbox" {
  return item.sandbox_need === "toolbox" ? "toolbox" : "message";
}

export type InboundQueueStore = {
  enqueue(item: InboundWorkItem): Promise<InboundEnqueueResult>;
  stealUnleasedRooms(input: {
    owner: string;
    limit: number;
    ttlMs: number;
  }): Promise<InboundRoomKey[]>;
  leaseRoom(input: {
    tenant_id: string;
    thread_id: string;
    owner: string;
    ttlMs: number;
  }): Promise<boolean>;
  nextItem(room: InboundRoomKey): Promise<InboundStoredItem | null>;
  markStarted(itemId: string, turnId: TurnId): Promise<void>;
  markDone(itemId: string): Promise<void>;
  markFailed(itemId: string, error: string): Promise<void>;
  releaseRoom(room: InboundRoomKey): Promise<void>;
  getItem(itemId: string): Promise<InboundStoredItem | null>;
  close(): Promise<void>;
};

export function turnRequestFromInbound(item: InboundWorkItem): TurnRequest {
  return {
    tenant_id: item.tenant_id,
    user_id: item.user_id,
    instance_id: item.instance_id,
    thread_id: item.thread_id,
    message: item.message,
    ...(item.sandbox_id ? { sandbox_id: item.sandbox_id } : {}),
    ...(item.metadata ? { metadata: item.metadata } : {}),
  };
}

export function inboundWorkItemFromTurn(
  turn: TurnRequest,
  extra: {
    source: InboundWorkSource;
    sandbox_need: InboundSandboxNeed;
    correlation_id?: string;
    enqueue_at?: number;
  },
): InboundWorkItem {
  return parseInboundWorkItem({
    ...turn,
    source: extra.source,
    sandbox_need: extra.sandbox_need,
    correlation_id: extra.correlation_id ?? randomUUID(),
    enqueue_at: extra.enqueue_at ?? Date.now(),
  });
}

/**
 * Build a work item after §4.2 classification. Callers pass source + facts,
 * not sandbox_need.
 */
export function inboundWorkItemFromClassifiedTurn(
  turn: TurnRequest,
  signals: ClassifySandboxNeedInput & {
    correlation_id?: string;
    enqueue_at?: number;
  },
): InboundWorkItem {
  return inboundWorkItemFromTurn(turn, {
    source: signals.source,
    sandbox_need: classifySandboxNeed({
      ...signals,
      text: signals.text ?? turn.message,
    }),
    correlation_id: signals.correlation_id,
    enqueue_at: signals.enqueue_at,
  });
}

export async function enqueueInbound(
  store: InboundQueueStore,
  item: InboundWorkItem,
  wake?: SpineToolboxWakePort,
): Promise<InboundEnqueueResult> {
  const parsed = parseInboundWorkItem(item);
  const result = await store.enqueue(parsed);
  if (!wake) {
    return result;
  }
  const kicked = await kickToolboxEnsureOnlineAtEnqueue({
    item: parsed,
    authClient: wake.authClient,
    flights: wake.flights,
    waitTimeoutMs: wake.waitTimeoutMs,
  });
  return { ...result, wake: kicked };
}

export async function processInboundRoom(input: {
  store: InboundQueueStore;
  startTurn: SpineStartTurn;
  room: InboundRoomKey;
  remember?: (threadId: string, turnId: TurnId) => void | Promise<void>;
  wake?: SpineToolboxWakePort;
  resolveSandboxId?: (item: InboundWorkItem) => Promise<string | undefined>;
  now?: () => number;
  /**
   * lp-k5c4.7 — POST signal-activity {mid_turn:true} before startTurn, and
   * clear on startTurn failure so a dead kickoff cannot pin the box.
   */
  signalMidTurn?: SpineMidTurnSignal;
}): Promise<SpineDeliverResult | null> {
  let lastTurnId: TurnId | undefined;
  let toolboxDrained = false;
  let toolboxInstanceId: string | undefined;
  const now = input.now ?? Date.now;
  for (;;) {
    const item = await input.store.nextItem(input.room);
    if (!item) {
      break;
    }
    if (item.payload.sandbox_need === "toolbox") {
      toolboxDrained = true;
      toolboxInstanceId = item.payload.instance_id;
    }
    if (item.turn_id) {
      await input.store.markDone(item.item_id);
      await input.remember?.(item.thread_id, item.turn_id);
      lastTurnId = item.turn_id;
      continue;
    }
    await input.signalMidTurn?.(item.payload, true);
    const request = turnRequestFromInbound(item.payload);
    const stamped =
      request.sandbox_id ??
      (item.payload.sandbox_need === "toolbox"
        ? await input.resolveSandboxId?.(item.payload)
        : undefined);
    const started = await input.startTurn(
      stamped ? { ...request, sandbox_id: stamped } : request,
    );
    if (!started.ok) {
      await input.signalMidTurn?.(item.payload, false);
      await input.store.markFailed(item.item_id, started.error);
      return started;
    }
    await input.store.markStarted(item.item_id, started.turn_id);
    await input.store.markDone(item.item_id);
    await input.remember?.(item.thread_id, started.turn_id);
    lastTurnId = started.turn_id;
  }
  if (toolboxDrained && toolboxInstanceId && input.wake) {
    await annotateSpineLeaseEmpty(
      input.wake.authClient,
      toolboxInstanceId,
      now(),
    );
  }
  if (!lastTurnId) {
    return null;
  }
  return { ok: true, path: "harness", turn_id: lastTurnId };
}

/**
 * Steal up to harnessSlots unleased rooms and process them in parallel.
 * One room is serial; many rooms run at once.
 */
export async function dispatchInboundWork(input: {
  store: InboundQueueStore;
  startTurn: SpineStartTurn;
  owner: string;
  harnessSlots: number;
  ttlMs?: number;
  remember?: (threadId: string, turnId: TurnId) => void | Promise<void>;
  wake?: SpineToolboxWakePort;
  now?: () => number;
  signalMidTurn?: SpineMidTurnSignal;
}): Promise<SpineDeliverResult[]> {
  const limit = Math.max(0, Math.floor(input.harnessSlots));
  if (limit === 0) {
    return [];
  }
  const rooms = await input.store.stealUnleasedRooms({
    owner: input.owner,
    limit,
    ttlMs: input.ttlMs ?? DEFAULT_INBOUND_LEASE_TTL_MS,
  });
  return Promise.all(
    rooms.map(async (room): Promise<SpineDeliverResult> => {
      try {
        const result = await processInboundRoom({
          store: input.store,
          startTurn: input.startTurn,
          room,
          remember: input.remember,
          wake: input.wake,
          now: input.now,
          signalMidTurn: input.signalMidTurn,
        });
        if (!result) {
          return {
            ok: false,
            status: 500,
            error: "Leased inbound room had no work",
          };
        }
        return result;
      } finally {
        await input.store.releaseRoom(room);
      }
    }),
  );
}

export async function deliverSpineTurns(input: {
  store: InboundQueueStore;
  startTurn: SpineStartTurn;
  items: InboundWorkItem[];
  owner: string;
  remember?: (threadId: string, turnId: TurnId) => void | Promise<void>;
  ttlMs?: number;
  drainTimeoutMs?: number;
  wake?: SpineToolboxWakePort;
  now?: () => number;
  signalMidTurn?: SpineMidTurnSignal;
}): Promise<SpineDeliverResult> {
  if (input.items.length === 0) {
    return { ok: false, status: 400, error: "No inbound work items to enqueue" };
  }
  const parsed = input.items.map((item) => parseInboundWorkItem(item));
  const enqueued: string[] = [];
  const sandboxByInstance = new Map<string, Promise<string | undefined>>();
  for (const item of parsed) {
    const { item_id, wake } = await enqueueInbound(
      input.store,
      item,
      input.wake,
    );
    enqueued.push(item_id);
    if (wake && item.sandbox_need === "toolbox") {
      sandboxByInstance.set(item.instance_id, sandboxIdFromWakeResult(wake));
    }
  }

  const rooms = uniqueRooms(parsed);
  const ttlMs = input.ttlMs ?? DEFAULT_INBOUND_LEASE_TTL_MS;
  const drainResults = await Promise.all(
    rooms.map(async (room) => {
      const got = await input.store.leaseRoom({
        ...room,
        owner: input.owner,
        ttlMs,
      });
      if (!got) {
        return { ok: true as const, skipped: true as const };
      }
      try {
        const processed = await processInboundRoom({
          store: input.store,
          startTurn: input.startTurn,
          room,
          remember: input.remember,
          wake: input.wake,
          now: input.now,
          resolveSandboxId: async (work) => {
            const pending = sandboxByInstance.get(work.instance_id);
            return pending ? pending : undefined;
          },
          signalMidTurn: input.signalMidTurn,
        });
        if (!processed) {
          return { ok: true as const, skipped: true as const };
        }
        return processed;
      } finally {
        await input.store.releaseRoom(room);
      }
    }),
  );
  for (const result of drainResults) {
    if ("skipped" in result) continue;
    if (!result.ok) return result;
  }

  let lastTurnId: TurnId | undefined;
  const timeoutMs = input.drainTimeoutMs ?? DEFAULT_INBOUND_DRAIN_TIMEOUT_MS;
  for (const itemId of enqueued) {
    const finished = await waitForInboundItem(input.store, itemId, timeoutMs);
    if (!finished) {
      return {
        ok: false,
        status: 504,
        error: "Inbound work item did not complete",
      };
    }
    if (finished.status === "failed") {
      return {
        ok: false,
        status: 502,
        error: finished.error ?? "Inbound startTurn failed",
      };
    }
    if (!finished.turn_id) {
      return {
        ok: false,
        status: 502,
        error: "Inbound work item completed without turn_id",
      };
    }
    await input.remember?.(finished.thread_id, finished.turn_id);
    lastTurnId = finished.turn_id;
  }
  if (!lastTurnId) {
    return { ok: false, status: 400, error: "No harness turns to deliver" };
  }
  return { ok: true, path: "harness", turn_id: lastTurnId };
}

function uniqueRooms(items: InboundWorkItem[]): InboundRoomKey[] {
  const seen = new Set<string>();
  const rooms: InboundRoomKey[] = [];
  for (const item of items) {
    const key = `${item.tenant_id}\0${item.thread_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rooms.push({ tenant_id: item.tenant_id, thread_id: item.thread_id });
  }
  return rooms;
}

async function waitForInboundItem(
  store: InboundQueueStore,
  itemId: string,
  timeoutMs: number,
): Promise<InboundStoredItem | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const item = await store.getItem(itemId);
    if (item && (item.status === "done" || item.status === "failed")) {
      return item;
    }
    if (Date.now() >= deadline) {
      return item ?? null;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
