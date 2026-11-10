/**
 * In-memory inbound queue for spine caller tests (lp-k5c4.6).
 * Exclusive per-room leases; not the production SKIP LOCKED store.
 */
import { randomUUID } from "node:crypto";

import type { InboundWorkItem, TurnId } from "@lanyard/shared";

import type {
  InboundQueueStore,
  InboundRoomKey,
  InboundStoredItem,
} from "../src/inbound-queue.js";

export type MemoryInboundQueue = InboundQueueStore & {
  items: InboundStoredItem[];
  payloads: () => InboundWorkItem[];
};

export function createMemoryInboundQueue(): MemoryInboundQueue {
  const items: InboundStoredItem[] = [];
  const leases = new Map<string, string>();

  function keyOf(tenantId: string, threadId: string): string {
    return `${tenantId}\0${threadId}`;
  }

  return {
    items,
    payloads: () => items.map((row) => row.payload),
    async enqueue(item) {
      const item_id = randomUUID();
      items.push({
        item_id,
        tenant_id: item.tenant_id,
        thread_id: item.thread_id,
        payload: item,
        status: "queued",
        turn_id: null,
        error: null,
      });
      return { item_id };
    },
    async stealUnleasedRooms(input) {
      const rooms: InboundRoomKey[] = [];
      const seen = new Set<string>();
      for (const item of items) {
        if (
          item.status !== "queued" &&
          item.status !== "leased" &&
          item.status !== "started"
        ) {
          continue;
        }
        const key = keyOf(item.tenant_id, item.thread_id);
        if (seen.has(key) || leases.has(key)) continue;
        seen.add(key);
        leases.set(key, input.owner);
        rooms.push({ tenant_id: item.tenant_id, thread_id: item.thread_id });
        if (rooms.length >= input.limit) break;
      }
      return rooms;
    },
    async leaseRoom(input) {
      const key = keyOf(input.tenant_id, input.thread_id);
      const current = leases.get(key);
      if (current && current !== input.owner) return false;
      leases.set(key, input.owner);
      return true;
    },
    async nextItem(room) {
      return (
        items.find(
          (row) =>
            row.tenant_id === room.tenant_id &&
            row.thread_id === room.thread_id &&
            (row.status === "queued" ||
              row.status === "leased" ||
              row.status === "started"),
        ) ?? null
      );
    },
    async markStarted(itemId, turnId: TurnId) {
      const row = items.find((item) => item.item_id === itemId);
      if (row) {
        row.status = "started";
        row.turn_id = turnId;
      }
    },
    async markDone(itemId) {
      const row = items.find((item) => item.item_id === itemId);
      if (row) row.status = "done";
    },
    async markFailed(itemId, error) {
      const row = items.find((item) => item.item_id === itemId);
      if (row) {
        row.status = "failed";
        row.error = error;
      }
    },
    async releaseRoom(room) {
      leases.delete(keyOf(room.tenant_id, room.thread_id));
    },
    async getItem(itemId) {
      return items.find((item) => item.item_id === itemId) ?? null;
    },
    async close() {},
  };
}
