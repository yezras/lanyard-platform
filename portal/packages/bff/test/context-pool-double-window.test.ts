import { describe, expect, it } from "vitest";

import { CONTEXT_POOL_SMALL_BUDGET_TOKENS } from "@lanyard/shared";

import {
  createInMemoryContextPoolStore,
  contextPoolKey,
} from "../src/context-pool-store.js";
import { applyDoubleWindowPolicy } from "../src/context-pool-rotate.js";
import { resolveContextPoolForTurn } from "../src/context-pool-live.js";
import { harnessWakeMetadata } from "../src/harness-wake-payload.js";

describe("context-pool BFF live fetch + double-window rotate (lp-0akr)", () => {
  it("BFF live fetch from context_pool table, revision_id on wire, StandingContext once", async () => {
    const store = createInMemoryContextPoolStore();
    const seen = new Map<string, string>();
    const tenant = "ten_pool_live";
    const thread = "thr_pool_live";

    const first = await resolveContextPoolForTurn({ store, seenRevisions: seen }, {
      tenant_id: tenant,
      thread_id: thread,
      standingContextPrompt: "You are Forge, standing context once.",
      budgetTokens: CONTEXT_POOL_SMALL_BUDGET_TOKENS,
    });
    expect(first.revision_id).toBeTruthy();
    expect(first.standing_context).not.toBeNull();
    expect(first.prompt_blocks.some((b: any) => b.type === "standing_context")).toBe(true);

    // Second live fetch with same revision should omit StandingContext (harness delta)
    const second = await resolveContextPoolForTurn({ store, seenRevisions: seen }, {
      tenant_id: tenant,
      thread_id: thread,
      budgetTokens: CONTEXT_POOL_SMALL_BUDGET_TOKENS,
    });
    expect(second.revision_id).toBe(first.revision_id);
    expect(second.standing_context).toBeNull();
    expect(second.prompt_blocks.some((b: any) => b.type === "standing_context")).toBe(false);

    // harnessWakeMetadata puts revision_id on wire
    const meta = harnessWakeMetadata({
      roomTail: [],
      revisionId: first.revision_id,
      standingContext: first.standing_context,
      promptBlocks: first.prompt_blocks as unknown[],
      budgetTokens: first.budget_tokens,
    });
    expect((meta as any).revision_id).toBe(first.revision_id);
    expect((meta as any).prompt_blocks).toBeDefined();
  });

  it("double-window: 30 msgs force compact then rotate, budget doubles", async () => {
    const store = createInMemoryContextPoolStore();
    const tenant = "ten_pool_30";
    const thread = "thr_pool_30";
    const key = contextPoolKey(tenant, thread);

    await store.createOrFetch({
      tenant_id: tenant,
      thread_id: thread,
      standing_context: {
        revision_id: "rev_init",
        system_prompt: "You are Forge.",
        created_at: new Date().toISOString(),
      },
      budget_tokens: CONTEXT_POOL_SMALL_BUDGET_TOKENS, // 4000
    });

    let compacted = false;
    let rotated = false;
    let lastRevision = "rev_init";

    // 30 msgs each ~200 chars => ~50 tokens each => 1500 tokens total + overhead
    // To force thresholds, use larger msgs: 500 chars => ~125 tokens => 30*125=3750 > 80% of 4000
    for (let i = 0; i < 30; i++) {
      const msg = {
        id: `msg_${i}`,
        role: "user" as const,
        content: `message ${i} ` + "x".repeat(900),
        created_at: new Date().toISOString(),
      };
      let rec = await store.appendMessage(key, msg);
      const result = await applyDoubleWindowPolicy(store, rec);
      rec = result.record;
      if (result.action === "compact") compacted = true;
      if (result.action === "rotate") rotated = true;
      lastRevision = rec.revision_id;
    }

    const final = await store.fetch(key);
    expect(final).not.toBeNull();
    expect(compacted).toBe(true);
    expect(rotated).toBe(true);
    expect(final!.budget_tokens).toBe(CONTEXT_POOL_SMALL_BUDGET_TOKENS * 2);
    expect(final!.has_compacted_once).toBe(true);
    expect(final!.compact_summary).toBeTruthy();
    expect(final!.revision_id).not.toBe("rev_init");
    // After compact then rotate, tokenCount should be under new budget
    expect(final!.token_count).toBeLessThan(final!.budget_tokens);
    await store.close();
  });

  it("prompt_blocks shared API builds compact_summary + recent_messages", async () => {
    const store = createInMemoryContextPoolStore();
    const tenant = "ten_blocks";
    const thread = "thr_blocks";
    const key = contextPoolKey(tenant, thread);
    await store.createOrFetch({
      tenant_id: tenant,
      thread_id: thread,
      standing_context: {
        revision_id: "rev_blocks",
        system_prompt: "standing",
        created_at: new Date().toISOString(),
      },
      budget_tokens: CONTEXT_POOL_SMALL_BUDGET_TOKENS,
    });

    // Force compact by filling pool
    for (let i = 0; i < 16; i++) {
      await store.appendMessage(key, {
        id: `m${i}`,
        role: "user",
        content: "y".repeat(900),
        created_at: new Date().toISOString(),
      });
    }
    let rec = (await store.fetch(key))!;
    const policy = await applyDoubleWindowPolicy(store, rec);
    rec = policy.record;
    expect(policy.action).toBe("compact");
    expect(rec.compact_summary).toBeTruthy();

    const live = await resolveContextPoolForTurn(
      { store, seenRevisions: new Map() },
      { tenant_id: tenant, thread_id: thread },
    );
    expect(live.prompt_blocks.some((b: any) => b.type === "compact_summary")).toBe(true);
    expect(live.prompt_blocks.some((b: any) => b.type === "recent_messages")).toBe(true);
    await store.close();
  });
});
