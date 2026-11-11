/**
 * In-process warm pool of pre-created stopped sandbox ids (lp-vqr0.10 / T2).
 *
 * One CP task owns the map. It is not `gateway_instances`. Claim copies
 * `sandbox_id` onto the instance, then start. Replenish is off the
 * ensure_online stack. Tests inject real harness — never the paid API.
 *
 * MockLab cap is 1–2 boxes. Live org enable stays residual.
 */

import type { DaytonaClient } from "./daytona-client.js";

/** Default in-process pool size when the flag is on. */
export const DEFAULT_WARM_POOL_SIZE = 2;

/** MockLab spend ceiling. Env values above this clamp down. */
export const MAX_WARM_POOL_SIZE = 2;

/** Daytona label marking a pool-owned (not yet bound) sandbox. */
export const WARM_POOL_LABEL_KEY = "pool";
export const WARM_POOL_LABEL_VALUE = "warm";

export type WarmPoolEntry = {
  snapshotId: string;
  sandboxId: string;
};

export type WarmPoolClaimResult =
  | { outcome: "hit"; sandboxId: string }
  | { outcome: "miss" };

export type WarmPool = {
  readonly cap: number;
  claim(snapshotId: string): WarmPoolClaimResult;
  offer(entry: WarmPoolEntry): boolean;
  size(snapshotId?: string): number;
};

export type WarmPoolReplenishResult = {
  created: number;
  offered: number;
};

export function createInMemoryWarmPool(options?: {
  cap?: number;
}): WarmPool {
  const requested = options?.cap ?? DEFAULT_WARM_POOL_SIZE;
  const cap = clampWarmPoolSize(requested);
  const bySnapshot = new Map<string, string[]>();
  const owned = new Set<string>();

  return {
    cap,
    claim(snapshotId: string): WarmPoolClaimResult {
      const key = snapshotId.trim();
      if (!key) return { outcome: "miss" };
      const queue = bySnapshot.get(key);
      if (!queue || queue.length === 0) return { outcome: "miss" };
      const sandboxId = queue.shift();
      if (!sandboxId) return { outcome: "miss" };
      owned.delete(sandboxId);
      if (queue.length === 0) bySnapshot.delete(key);
      return { outcome: "hit", sandboxId };
    },
    offer(entry: WarmPoolEntry): boolean {
      const snapshotId = entry.snapshotId.trim();
      const sandboxId = entry.sandboxId.trim();
      if (!snapshotId || !sandboxId) return false;
      if (owned.has(sandboxId)) return false;
      if (owned.size >= cap) return false;
      const queue = bySnapshot.get(snapshotId) ?? [];
      queue.push(sandboxId);
      bySnapshot.set(snapshotId, queue);
      owned.add(sandboxId);
      return true;
    },
    size(snapshotId?: string): number {
      if (snapshotId === undefined) return owned.size;
      const key = snapshotId.trim();
      return bySnapshot.get(key)?.length ?? 0;
    },
  };
}

/** Clamp to the MockLab 0–2 window. */
export function clampWarmPoolSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_WARM_POOL_SIZE;
  return Math.max(0, Math.min(MAX_WARM_POOL_SIZE, Math.floor(n)));
}

/**
 * Create stopped sandboxes for `snapshotId` until the pool is at cap.
 * Extra boxes that lose the offer race are archived so spend does not leak.
 */
export async function replenishWarmPool(input: {
  daytona: DaytonaClient;
  pool: WarmPool;
  snapshotId: string;
  region?: string;
}): Promise<WarmPoolReplenishResult> {
  const snapshotId = input.snapshotId.trim();
  if (!snapshotId || input.pool.cap <= 0) {
    return { created: 0, offered: 0 };
  }

  let created = 0;
  let offered = 0;
  while (input.pool.size() < input.pool.cap) {
    const sandbox = await input.daytona.create({
      snapshotId,
      region: input.region,
      labels: {
        [WARM_POOL_LABEL_KEY]: WARM_POOL_LABEL_VALUE,
        snapshot_id: snapshotId,
      },
    });
    created += 1;
    if (sandbox.state === "started") {
      await input.daytona.stop(sandbox.sandboxId);
    }
    if (input.pool.offer({ snapshotId, sandboxId: sandbox.sandboxId })) {
      offered += 1;
      continue;
    }
    try {
      await input.daytona.archive(sandbox.sandboxId);
    } catch {
      // best-effort: do not throw into ensure_online
    }
    break;
  }
  return { created, offered };
}

/**
 * Default scheduler: refill after the current ensure_online stack.
 * Inject a collector in tests so Send-path create counts stay 0 on a hit.
 */
export function scheduleWarmPoolReplenishOffStack(
  task: () => Promise<void>,
): void {
  setImmediate(() => {
    void task().catch(() => {
      // Replenish never fails the wake.
    });
  });
}
