/**
 * lp-k5c4.4 — toolbox ensure_online at enqueue; none does not wake;
 * burst joins one wake. Fake CP only (no Daytona).
 * lp-k5c4.5 — unbound first toolbox bind still kicks CP; stamp sandbox_id
 * from wake (path=warm_pool). Replenish is not on the Send stack.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import type { InboundWorkItem, TurnId } from "@lanyard/shared";

import {
  createEnsureOnlineFlightRegistry,
} from "../src/ensure-online-hook.js";
import {
  deliverSpineTurns,
  enqueueInbound,
  inboundWorkItemFromTurn,
  processInboundRoom,
  type InboundQueueStore,
} from "../src/inbound-queue.js";
import { createPgInboundQueue } from "../src/inbound-queue-pg.js";
import {
  kickToolboxEnsureOnlineAtEnqueue,
  sandboxIdFromWakeResult,
} from "../src/inbound-toolbox-wake.js";
import type {
  EnsureOnlineResponse,
  InstancePresenceResponse,
  SignalActivityResponse,
} from "../src/control-plane-client.js";

const INSTANCE_ID = "inst-toolbox-wake";
const TENANT_ID = "tenant-toolbox-wake";
const SANDBOX_ID = "sbx-bound-1";

const pgUrl =
  process.env.CONTROL_PLANE_DATABASE_URL?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  "";
const describePg = pgUrl ? describe : describe.skip;

function item(
  overrides: Partial<InboundWorkItem> = {},
): InboundWorkItem {
  return inboundWorkItemFromTurn(
    {
      tenant_id: TENANT_ID,
      user_id: "user-toolbox",
      instance_id: INSTANCE_ID,
      thread_id: "thr-toolbox",
      message: "use bash",
      sandbox_id: SANDBOX_ID,
      ...overrides,
    },
    {
      source: overrides.source ?? "web",
      sandbox_need: overrides.sandbox_need ?? "toolbox",
    },
  );
}

function presence(
  overrides: Partial<InstancePresenceResponse> = {},
): InstancePresenceResponse {
  return {
    instance_id: INSTANCE_ID,
    tenant_id: TENANT_ID,
    presence: "offline",
    sandbox_id: SANDBOX_ID,
    runtime_kind: "daytona",
    agent_snapshot_id: "snap-1",
    s3_vault_prefix: `tenants/${TENANT_ID}/vault/`,
    last_activity_at: null,
    revoked_at: null,
    ...overrides,
  };
}

function ensureResponse(
  overrides: Partial<EnsureOnlineResponse> = {},
): EnsureOnlineResponse {
  return {
    instance_id: INSTANCE_ID,
    tenant_id: TENANT_ID,
    presence: "online",
    sandbox_id: SANDBOX_ID,
    runtime_kind: "daytona",
    already_online: false,
    wake_joined: false,
    ...overrides,
  };
}

function signalResponse(
  overrides: Partial<SignalActivityResponse> = {},
): SignalActivityResponse {
  return {
    instance_id: INSTANCE_ID,
    tenant_id: TENANT_ID,
    presence: "online",
    last_activity_at: new Date().toISOString(),
    mid_turn: false,
    mid_turn_until: null,
    stop_after: null,
    ...overrides,
  };
}

function fakeCp(opts: {
  presence?: InstancePresenceResponse;
  ensureDelayMs?: number;
  ensure?: EnsureOnlineResponse;
}) {
  const ensureOnline = vi.fn(async () => {
    if (opts.ensureDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, opts.ensureDelayMs));
    }
    return opts.ensure ?? ensureResponse();
  });
  const getInstancePresence = vi.fn(async () => opts.presence ?? presence());
  const signalActivity = vi.fn(async () => signalResponse());
  return { getInstancePresence, ensureOnline, signalActivity };
}

describe("kickToolboxEnsureOnlineAtEnqueue (lp-k5c4.4)", () => {
  it("none: ensure_online count 0", async () => {
    const auth = fakeCp({});
    const result = await kickToolboxEnsureOnlineAtEnqueue({
      item: item({ sandbox_need: "none", message: "hi" }),
      authClient: auth,
    });
    expect(result).toEqual({ action: "skipped", reason: "sandbox_need_none" });
    expect(auth.ensureOnline).toHaveBeenCalledTimes(0);
    expect(auth.getInstancePresence).toHaveBeenCalledTimes(0);
    expect(auth.signalActivity).toHaveBeenCalledTimes(0);
  });

  it("toolbox kicks ensure_online and annotates work arrived", async () => {
    const auth = fakeCp({});
    const result = await kickToolboxEnsureOnlineAtEnqueue({
      item: item(),
      authClient: auth,
    });
    expect(result.action).toBe("ensured");
    expect(auth.ensureOnline).toHaveBeenCalledTimes(1);
    expect(auth.signalActivity).toHaveBeenCalledWith(INSTANCE_ID, {
      spine_work_arrived: true,
    });
  });

  it("burst joins one wake", async () => {
    const auth = fakeCp({ ensureDelayMs: 40 });
    const flights = createEnsureOnlineFlightRegistry();
    const work = item();
    const [a, b, c] = await Promise.all([
      kickToolboxEnsureOnlineAtEnqueue({
        item: work,
        authClient: auth,
        flights,
      }),
      kickToolboxEnsureOnlineAtEnqueue({
        item: work,
        authClient: auth,
        flights,
      }),
      kickToolboxEnsureOnlineAtEnqueue({
        item: work,
        authClient: auth,
        flights,
      }),
    ]);
    expect(auth.ensureOnline).toHaveBeenCalledTimes(1);
    expect([a, b, c].every((result) => result.action !== "skipped")).toBe(true);
    const flightsSeen = [a, b, c].filter((result) => result.action === "waking");
    if (flightsSeen.length > 1) {
      const first = flightsSeen[0];
      if (first.action === "waking") {
        expect(
          flightsSeen.every(
            (result) =>
              result.action === "waking" && result.flight === first.flight,
          ),
        ).toBe(true);
      }
    }
  });

  it("unbound toolbox item kicks ensure_online; path=warm_pool stamps sandbox_id", async () => {
    const pooled = "sbx-warm-pool-1";
    const auth = fakeCp({
      presence: presence({ sandbox_id: null }),
      ensure: ensureResponse({
        sandbox_id: pooled,
        already_online: false,
        path: "warm_pool",
      }),
    });
    const work = item({ sandbox_id: undefined });
    expect(work.sandbox_id).toBeUndefined();
    const result = await kickToolboxEnsureOnlineAtEnqueue({
      item: work,
      authClient: auth,
    });
    expect(result.action).toBe("ensured");
    if (result.action === "ensured") {
      expect(result.response.path).toBe("warm_pool");
      expect(result.response.sandbox_id).toBe(pooled);
    }
    expect(await sandboxIdFromWakeResult(result)).toBe(pooled);
    expect(auth.ensureOnline).toHaveBeenCalledTimes(1);
  });

  it("BFF Send/enqueue never replenishes the warm pool", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const wakeSrc = readFileSync(
      join(here, "../src/inbound-toolbox-wake.ts"),
      "utf8",
    );
    const queueSrc = readFileSync(join(here, "../src/inbound-queue.ts"), "utf8");
    const spineSrc = readFileSync(join(here, "../src/inbound-spine.ts"), "utf8");
    for (const src of [wakeSrc, queueSrc, spineSrc]) {
      expect(src).not.toContain("replenishWarmPool");
      expect(src).not.toContain("DAYTONA_WARM_POOL");
      expect(src).not.toContain("createInMemoryWarmPool");
    }
  });
});

describePg("enqueueInbound toolbox wake (lp-k5c4.4)", () => {
  async function withQueue(fn: (store: InboundQueueStore) => Promise<void>) {
    const store = await createPgInboundQueue({
      connectionString: pgUrl,
      schema: `inq_wake_${randomUUID().replace(/-/g, "")}`,
      leaseTtlMs: 5_000,
    });
    try {
      await fn(store);
    } finally {
      await store.close();
    }
  }

  it("persists then kicks toolbox wake; none stays at 0", async () => {
    await withQueue(async (store) => {
      const auth = fakeCp({});
      const none = await enqueueInbound(
        store,
        item({ sandbox_need: "none", message: "hi", thread_id: "thr-none" }),
        { authClient: auth },
      );
      expect(none.wake).toEqual({
        action: "skipped",
        reason: "sandbox_need_none",
      });
      expect(auth.ensureOnline).toHaveBeenCalledTimes(0);

      const toolbox = await enqueueInbound(store, item(), {
        authClient: auth,
      });
      expect(toolbox.wake?.action).toBe("ensured");
      expect(auth.ensureOnline).toHaveBeenCalledTimes(1);
    });
  });

  it("unbound toolbox deliverSpineTurns stamps warm_pool sandbox_id onto startTurn", async () => {
    await withQueue(async (store) => {
      const pooled = "sbx-warm-pool-stamp";
      const auth = fakeCp({
        presence: presence({ sandbox_id: null }),
        ensure: ensureResponse({
          sandbox_id: pooled,
          already_online: false,
          path: "warm_pool",
        }),
      });
      const started: Array<{ sandbox_id?: string }> = [];
      const work = item({
        sandbox_id: undefined,
        thread_id: "thr-unbound-pool",
      });
      const delivered = await deliverSpineTurns({
        store,
        startTurn: async (request) => {
          started.push({ sandbox_id: request.sandbox_id });
          return { ok: true, turn_id: "trn_pool" as TurnId };
        },
        items: [work],
        owner: "pool-stamp",
        wake: { authClient: auth },
      });
      expect(delivered).toEqual({
        ok: true,
        path: "harness",
        turn_id: "trn_pool",
      });
      expect(auth.ensureOnline).toHaveBeenCalledTimes(1);
      expect(started).toEqual([{ sandbox_id: pooled }]);
    });
  });

  it("drain annotates spine_lease_empty", async () => {
    await withQueue(async (store) => {
      const auth = fakeCp({});
      const work = item({ thread_id: "thr-drain" });
      await enqueueInbound(store, work, { authClient: auth });
      const room = { tenant_id: TENANT_ID, thread_id: "thr-drain" };
      expect(
        await store.leaseRoom({
          ...room,
          owner: "drain",
          ttlMs: 5_000,
        }),
      ).toBe(true);
      const T_DRAIN = 1_700_000_000_000;
      await processInboundRoom({
        store,
        startTurn: async () => ({ ok: true, turn_id: "trn_drain" as TurnId }),
        room,
        wake: { authClient: auth },
        now: () => T_DRAIN,
      });
      await store.releaseRoom(room);
      expect(auth.signalActivity).toHaveBeenCalledWith(INSTANCE_ID, {
        at: new Date(T_DRAIN).toISOString(),
        spine_lease_empty: true,
      });
    });
  });
});
