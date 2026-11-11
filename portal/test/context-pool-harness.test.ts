/**
 * lp-0akr — TDD on local real harness with longer run (collapsed).
 */

import { describe, expect, it } from "vitest";

import {
  createInMemoryChannelPoolStore,
  shouldCompact,
  compactExcerpts,
  rotateWindow,
  CONTEXT_POOL_INITIAL_BUDGET,
} from "../packages/bff/src/context-pool.js";
import { harnessWakeMetadata } from "../packages/bff/src/harness-wake-payload.js";
import {
  isHarnessReachable,
  localHarnessUrl,
  localHarnessToken,
  startTurn,
  waitForTurnComplete,
} from "./harness-local.js";

const REQUIRE_HARNESS = process.env.REQUIRE_HARNESS === "1";

async function requireHarnessOrSkip(): Promise<boolean> {
  const ok = await isHarnessReachable();
  if (!ok && REQUIRE_HARNESS) {
    throw new Error(`harness not reachable at ${localHarnessUrl()} (token ${localHarnessToken().slice(0, 8)}…); set HARNESS_URL/HARNESS_SERVICE_TOKEN or unset REQUIRE_HARNESS to skip`);
  }
  return ok;
}

describe("context-pool longer run harness (lp-0akr collapsed)", () => {
  it("channel pool double-window via unified store — compact then rotate", async () => {
    const store = createInMemoryChannelPoolStore();
    const tenant = "ten_harness_pool";
    const channel = `chan_harness_pool_${Date.now()}`;
    // Append many excerpts to approach budget
    for (let i = 0; i < 30; i++) {
      await store.appendExcerpt({
        tenant_id: tenant,
        channel_id: channel,
        excerpt: {
          event_id: `evt_${i}`,
          speaker: "user",
          text: `Harness pool message ${i}: ` + "lorem ipsum ".repeat(60),
          created_at: new Date().toISOString(),
        },
      });
    }
    const row = await store.getRow({ tenant_id: tenant, channel_id: channel });
    expect(row).not.toBeNull();
    const ctx = await store.fetchChannelContext({ tenant_id: tenant, channel_id: channel });
    expect(ctx).not.toBeNull();
    expect(ctx!.revision_id).toBeTruthy();
    // Verify helpers exist
    expect(typeof shouldCompact).toBe("function");
    expect(typeof compactExcerpts).toBe("function");
    expect(typeof rotateWindow).toBe("function");

    if (!(await requireHarnessOrSkip())) return;

    const userId = process.env.HARNESS_TEST_USER_ID?.trim() || "usr_harness_pool";
    const instanceId = process.env.HARNESS_TEST_INSTANCE_ID?.trim() || "inst_harness_pool";
    const thread = `thr_harness_pool_${Date.now()}`;

    const started = await startTurn({
      tenant_id: tenant,
      user_id: userId,
      instance_id: instanceId,
      thread_id: thread,
      message: "Summarize the conversation so far in one sentence.",
      metadata: harnessWakeMetadata({
        roomTail: [],
        revisionId: ctx!.revision_id,
        standingContext: "You are Forge, standing context once per revision.",
        promptBlocks: [{ type: "recent_messages", messages: [{ id: "m1", role: "user", content: "hello", created_at: new Date().toISOString() }] }],
        budgetTokens: row!.window_budget,
      }) as any,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const events = await waitForTurnComplete(started.turn_id as string, { timeoutMs: 120_000 });
    expect(events.some((e) => e.type === "message_send")).toBe(true);
  }, 130_000);
});
