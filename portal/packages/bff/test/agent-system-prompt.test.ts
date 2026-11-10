import { describe, expect, it } from "vitest";

import {
  canAssignLlmSystemPrompt,
  chatSystemPromptMetadata,
  countCompletedUserTurns,
  fixtureSystemPromptFromMessages,
  formatPurposeBlock,
  OFFLINE_FIXTURE_EMPTY_SYSTEM_PROMPT,
  purposeFromSuggestResult,
  sanitizeSystemPrompt,
  shouldGenerateSystemPrompt,
  SYSTEM_PROMPT_MAX_CHARS,
  SYSTEM_PROMPT_MAX_LINES,
} from "../src/agent-system-prompt.js";
import { ChatThreadStore } from "../src/chat-store.js";

describe("canAssignLlmSystemPrompt", () => {
  it("allows only default (generate once)", () => {
    expect(canAssignLlmSystemPrompt("default")).toBe(true);
    expect(canAssignLlmSystemPrompt("llm")).toBe(false);
    expect(canAssignLlmSystemPrompt("user")).toBe(false);
  });
});

describe("shouldGenerateSystemPrompt", () => {
  it("requires interactive chat, default source, and ≥1 turn", () => {
    expect(
      shouldGenerateSystemPrompt({
        kind: "chat",
        system_prompt_source: "default",
        completedTurnCount: 1,
      }),
    ).toBe(true);
    expect(
      shouldGenerateSystemPrompt({
        kind: "chat",
        system_prompt_source: "default",
        completedTurnCount: 2,
      }),
    ).toBe(true);
    expect(
      shouldGenerateSystemPrompt({
        kind: "chat",
        system_prompt_source: "default",
        completedTurnCount: 0,
      }),
    ).toBe(false);
  });

  it("skips user-owned, llm-owned, and scheduled_task kind", () => {
    expect(
      shouldGenerateSystemPrompt({
        kind: "chat",
        system_prompt_source: "user",
        completedTurnCount: 2,
      }),
    ).toBe(false);
    expect(
      shouldGenerateSystemPrompt({
        kind: "chat",
        system_prompt_source: "llm",
        completedTurnCount: 2,
      }),
    ).toBe(false);
    expect(
      shouldGenerateSystemPrompt({
        kind: "scheduled_task",
        system_prompt_source: "default",
        completedTurnCount: 2,
      }),
    ).toBe(false);
  });
});

describe("sanitizeSystemPrompt", () => {
  it("trims and caps lines/chars", () => {
    expect(sanitizeSystemPrompt("  hello purpose  ")).toBe("hello purpose");
    const manyLines = Array.from(
      { length: SYSTEM_PROMPT_MAX_LINES + 5 },
      (_, i) => `line ${i}`,
    ).join("\n");
    const capped = sanitizeSystemPrompt(manyLines);
    expect(capped).not.toBeNull();
    expect(capped!.split("\n").length).toBeLessThanOrEqual(
      SYSTEM_PROMPT_MAX_LINES,
    );

    const long = "a".repeat(SYSTEM_PROMPT_MAX_CHARS + 50);
    const truncated = sanitizeSystemPrompt(long);
    expect(truncated!.length).toBeLessThanOrEqual(SYSTEM_PROMPT_MAX_CHARS);
    expect(truncated!.endsWith("…")).toBe(true);
  });

  it("returns null for empty", () => {
    expect(sanitizeSystemPrompt("   ")).toBeNull();
    expect(sanitizeSystemPrompt("\n\n")).toBeNull();
  });
});

describe("fixtureSystemPromptFromMessages", () => {
  it("returns empty fixture for blank input", () => {
    expect(fixtureSystemPromptFromMessages([])).toBe(
      OFFLINE_FIXTURE_EMPTY_SYSTEM_PROMPT,
    );
    expect(fixtureSystemPromptFromMessages(["  ", ""])).toBe(
      OFFLINE_FIXTURE_EMPTY_SYSTEM_PROMPT,
    );
  });

  it("derives purpose from first message", () => {
    const purpose = fixtureSystemPromptFromMessages([
      "draft a Q3 plan for sales. more text later",
    ]);
    expect(purpose.startsWith("Help the user with:")).toBe(true);
    expect(purpose.toLowerCase()).toContain("draft");
  });
});

describe("purposeFromSuggestResult", () => {
  it("reads system_prompt, purpose, or prompt", () => {
    expect(
      purposeFromSuggestResult({ system_prompt: "Track pipeline" }),
    ).toBe("Track pipeline");
    expect(purposeFromSuggestResult({ purpose: "Plan Q3" })).toBe("Plan Q3");
    expect(purposeFromSuggestResult({ prompt: "Research" })).toBe("Research");
  });

  it("rejects empty", () => {
    expect(purposeFromSuggestResult({ system_prompt: "  " })).toBeNull();
    expect(purposeFromSuggestResult(null)).toBeNull();
  });
});

describe("inject shape (purpose block + metadata)", () => {
  it("formats purpose block and metadata", () => {
    expect(formatPurposeBlock("Help with sales")).toBe(
      "## Chat purpose\nHelp with sales",
    );
    expect(chatSystemPromptMetadata("Help with sales")).toEqual({
      system_prompt: "Help with sales",
      purpose_block: "## Chat purpose\nHelp with sales",
    });
    expect(chatSystemPromptMetadata("")).toBeUndefined();
    expect(chatSystemPromptMetadata(null)).toBeUndefined();
  });
});

describe("countCompletedUserTurns", () => {
  it("counts user_message events", () => {
    expect(
      countCompletedUserTurns([
        { type: "user_message" },
        { type: "message_send" },
        { type: "user_message" },
      ]),
    ).toBe(2);
  });
});

describe("ChatThreadStore system_prompt ownership", () => {
  it("defaults system_prompt empty + source default", () => {
    const store = new ChatThreadStore();
    const thread = store.create({
      tenant_id: "t1",
      user_id: "u1",
    });
    expect(thread.system_prompt).toBe("");
    expect(thread.system_prompt_source).toBe("default");
  });

  it("assignLlmSystemPrompt applies once then skips", () => {
    const store = new ChatThreadStore();
    const thread = store.create({
      tenant_id: "t1",
      user_id: "u1",
    });
    const first = store.assignLlmSystemPrompt(
      thread.thread_id,
      "Help with pipeline",
    );
    expect(first?.applied).toBe(true);
    expect(first?.thread.system_prompt_source).toBe("llm");
    expect(first?.thread.system_prompt).toBe("Help with pipeline");

    const second = store.assignLlmSystemPrompt(
      thread.thread_id,
      "Should not replace",
    );
    expect(second?.applied).toBe(false);
    expect(second?.thread.system_prompt).toBe("Help with pipeline");
  });

  it("never overwrites user-owned prompt", () => {
    const store = new ChatThreadStore();
    const thread = store.create({
      tenant_id: "t1",
      user_id: "u1",
    });
    store.updateSystemPrompt(thread.thread_id, "User purpose", {
      system_prompt_source: "user",
    });
    const outcome = store.assignLlmSystemPrompt(
      thread.thread_id,
      "LLM purpose",
    );
    expect(outcome?.applied).toBe(false);
    expect(outcome?.thread.system_prompt).toBe("User purpose");
    expect(outcome?.thread.system_prompt_source).toBe("user");
  });

  it("skips scheduled_task kind", () => {
    const store = new ChatThreadStore();
    const thread = store.create({
      tenant_id: "t1",
      user_id: "u1",
      kind: "scheduled_task",
      scheduled_job_id: "job-1",
      title: "Daily digest",
      title_source: "job",
    });
    const outcome = store.assignLlmSystemPrompt(
      thread.thread_id,
      "Should skip",
    );
    expect(outcome?.applied).toBe(false);
    expect(outcome?.thread.system_prompt).toBe("");
    expect(outcome?.thread.system_prompt_source).toBe("default");
  });
});
