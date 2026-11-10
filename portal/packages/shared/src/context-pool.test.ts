import { describe, expect, it } from "vitest";

import {
  buildPromptBlocks,
  createStandingContext,
  decideDoubleWindowAction,
  estimateTokens,
  CONTEXT_POOL_INITIAL_BUDGET_TOKENS,
  CONTEXT_POOL_SMALL_BUDGET_TOKENS,
  nextBudgetAfterRotate,
} from "../src/context-pool.js";

describe("context-pool shared API (lp-0akr)", () => {
  it("revision_id on StandingContext", () => {
    const sc = createStandingContext("You are Forge, helpful.");
    expect(sc.revision_id).toMatch(/^rev_/);
    expect(sc.system_prompt).toBe("You are Forge, helpful.");
  });

  it("prompt_blocks shared API — StandingContext once", () => {
    const sc = createStandingContext("system prompt once");
    const blocks = buildPromptBlocks({
      standingContext: sc,
      compactSummary: null,
      messages: [{ id: "1", role: "user", content: "hi", created_at: new Date().toISOString() }],
    });
    expect(blocks[0]).toMatchObject({ type: "standing_context", revision_id: sc.revision_id });
    const blocks2 = buildPromptBlocks({
      standingContext: sc,
      compactSummary: null,
      messages: [{ id: "1", role: "user", content: "hi", created_at: new Date().toISOString() }],
      omitStandingContext: true,
    });
    expect(blocks2.some((b) => b.type === "standing_context")).toBe(false);
  });

  it("double-window: compact at 80% once, rotate at next 80%", () => {
    const budget = CONTEXT_POOL_SMALL_BUDGET_TOKENS; // 4000
    // 70% -> none
    expect(decideDoubleWindowAction({ tokenCount: 2800, budgetTokens: budget, hasCompactedOnce: false })).toBe("none");
    // 80% -> compact (first time)
    expect(decideDoubleWindowAction({ tokenCount: 3200, budgetTokens: budget, hasCompactedOnce: false })).toBe("compact");
    // 85% with compact already done -> rotate
    expect(decideDoubleWindowAction({ tokenCount: 3400, budgetTokens: budget, hasCompactedOnce: true })).toBe("rotate");
    // rotate doubles window
    expect(nextBudgetAfterRotate(budget)).toBe(8000);
    expect(nextBudgetAfterRotate(CONTEXT_POOL_INITIAL_BUDGET_TOKENS)).toBe(16000);
  });

  it("budget small 8/4k grows with compact/rotate", () => {
    expect(CONTEXT_POOL_SMALL_BUDGET_TOKENS).toBe(4000);
    expect(CONTEXT_POOL_INITIAL_BUDGET_TOKENS).toBe(8000);
    // after compact, budget stays but tokenCount drops; after rotate budget doubles
    const doubled = nextBudgetAfterRotate(CONTEXT_POOL_SMALL_BUDGET_TOKENS);
    expect(doubled).toBeGreaterThan(CONTEXT_POOL_SMALL_BUDGET_TOKENS);
  });

  it("estimateTokens roughly 4 chars per token", () => {
    expect(estimateTokens("hello world")).toBe(Math.ceil(11 / 4));
  });
});
