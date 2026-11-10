import { describe, expect, it } from "vitest";

import {
  AGENT_NAME_MAX_WORDS,
  canAssignBootstrapTitle,
  canAssignLlmTitle,
  CHAT_SUGGEST_TITLE_PROMPT,
  fixtureAgentNameFromMessage,
  isBootstrapAssignMessage,
  looksLikePromptWordSnippet,
  MOCK_GATEWAY_CANNED_AGENT_NAME,
  OFFLINE_CODENAME_FALLBACKS,
  OFFLINE_FIXTURE_EMPTY_NAME,
  sanitizeAgentName,
  titleFromSuggestTitleResult,
} from "../src/agent-name.js";
import { ChatThreadStore } from "../src/chat-store.js";

describe("canAssignLlmTitle", () => {
  it("allows default and llm", () => {
    expect(canAssignLlmTitle("default")).toBe(true);
    expect(canAssignLlmTitle("llm")).toBe(true);
  });

  it("blocks user and job", () => {
    expect(canAssignLlmTitle("user")).toBe(false);
    expect(canAssignLlmTitle("job")).toBe(false);
  });
});

describe("canAssignBootstrapTitle (lp-lv9.3 eager)", () => {
  it("only allows default", () => {
    expect(canAssignBootstrapTitle("default")).toBe(true);
    expect(canAssignBootstrapTitle("llm")).toBe(false);
    expect(canAssignBootstrapTitle("user")).toBe(false);
    expect(canAssignBootstrapTitle("job")).toBe(false);
  });
});

describe("isBootstrapAssignMessage", () => {
  it("treats empty / whitespace as bootstrap", () => {
    expect(isBootstrapAssignMessage("")).toBe(true);
    expect(isBootstrapAssignMessage("   ")).toBe(true);
    expect(isBootstrapAssignMessage("hello")).toBe(false);
  });
});

describe("sanitizeAgentName (naming policy)", () => {
  it("trims and collapses whitespace", () => {
    expect(sanitizeAgentName("  hello   world  ")).toBe("hello world");
  });

  it("strips wrapping quotes", () => {
    expect(sanitizeAgentName('"Q3 Plan"')).toBe("Q3 Plan");
  });

  it("returns null for empty", () => {
    expect(sanitizeAgentName("   ")).toBeNull();
  });

  it("truncates long names by char max", () => {
    const long = "a".repeat(60);
    const name = sanitizeAgentName(long);
    expect(name).not.toBeNull();
    expect(name!.length).toBeLessThanOrEqual(48);
    expect(name!.endsWith("…")).toBe(true);
  });

  it("caps to codename word budget (1–3 words)", () => {
    const name = sanitizeAgentName("One Two Three Four Five");
    expect(name).toBe("One Two Three");
    expect(name!.split(" ").length).toBeLessThanOrEqual(AGENT_NAME_MAX_WORDS);
  });

  it("drops sentence tail when model returns a full sentence", () => {
    expect(sanitizeAgentName("Hound. A sales agent for outreach.")).toBe(
      "Hound",
    );
  });

  it("strips trailing separators", () => {
    expect(sanitizeAgentName("Night Scout,")).toBe("Night Scout");
  });
});

describe("CHAT_SUGGEST_TITLE_PROMPT (lp-pxr.2 / lp-7st.1)", () => {
  it("asks for a creative codename not a prompt excerpt", () => {
    expect(CHAT_SUGGEST_TITLE_PROMPT.toLowerCase()).toMatch(/codename/);
    expect(CHAT_SUGGEST_TITLE_PROMPT.toLowerCase()).toMatch(/1 to 3 words|1–3/);
    expect(CHAT_SUGGEST_TITLE_PROMPT.toLowerCase()).toMatch(
      /do not paraphrase|not paraphrase|first words/,
    );
  });

  it("does not hard-code product domain keyword examples (Hound/Scout)", () => {
    // Fixed sales→Hound style maps belong to the removed offline rules, not the
    // host brief (lp-7st.1).
    expect(CHAT_SUGGEST_TITLE_PROMPT).not.toMatch(/\bHound\b/);
    expect(CHAT_SUGGEST_TITLE_PROMPT).not.toMatch(/\bScout\b/);
  });
});

describe("fixtureAgentNameFromMessage (lp-7st.1 neutral offline)", () => {
  it("returns fixture empty name for blank input", () => {
    expect(fixtureAgentNameFromMessage("")).toBe(OFFLINE_FIXTURE_EMPTY_NAME);
    expect(fixtureAgentNameFromMessage("   ")).toBe(OFFLINE_FIXTURE_EMPTY_NAME);
  });

  it("does not map sales / pipeline to Hound (no product keyword map)", () => {
    const salesPrompt =
      "I need a new strategy for sales pipeline outreach to enterprise prospects this quarter. Please draft sequences and scoring.";
    const name = fixtureAgentNameFromMessage(salesPrompt);
    expect(name).not.toBe("Hound");
    expect(OFFLINE_CODENAME_FALLBACKS).toContain(name);
    expect(looksLikePromptWordSnippet(name, salesPrompt)).toBe(false);
    // Explicitly not the pre-lp-pxr.2 first-clause × 5 words strategy.
    expect(name.toLowerCase()).not.toBe("i need a new strategy");
    expect(name.split(" ").length).toBeLessThanOrEqual(AGENT_NAME_MAX_WORDS);
  });

  it("does not map research purpose to Scout", () => {
    const name = fixtureAgentNameFromMessage(
      "Please research competitor pricing and summarize findings.",
    );
    expect(name).not.toBe("Scout");
    expect(OFFLINE_CODENAME_FALLBACKS).toContain(name);
  });

  it("does not map code purpose to Forge", () => {
    const name = fixtureAgentNameFromMessage(
      "help me debug this typescript unit test",
    );
    expect(name).not.toBe("Forge");
    expect(OFFLINE_CODENAME_FALLBACKS).toContain(name);
  });

  it("never returns pure first-5-words of a multi-sentence prompt", () => {
    const prompts = [
      "I need a new strategy for sales pipeline outreach. More context here.",
      "Please draft a long blog post about cats and dogs and birds.",
      "Can you analyze the quarterly metrics dashboard for finance tomorrow?",
      "one two three four five six seven eight nine ten",
    ];
    for (const prompt of prompts) {
      const name = fixtureAgentNameFromMessage(prompt);
      expect(looksLikePromptWordSnippet(name, prompt, 5)).toBe(false);
      expect(name.split(" ").length).toBeLessThanOrEqual(AGENT_NAME_MAX_WORDS);
      expect(OFFLINE_CODENAME_FALLBACKS).toContain(name);
    }
  });

  it("uses deterministic neutral pool for all non-empty messages", () => {
    const name = fixtureAgentNameFromMessage("xyzzy plugh unexplained fluff");
    expect(OFFLINE_CODENAME_FALLBACKS).toContain(name);
    expect(looksLikePromptWordSnippet(name, "xyzzy plugh unexplained fluff")).toBe(
      false,
    );
  });

  it("is stable for the same message", () => {
    const msg = "totally unique gibberish prompt without domain cues";
    expect(fixtureAgentNameFromMessage(msg)).toBe(
      fixtureAgentNameFromMessage(msg),
    );
  });
});

describe("titleFromSuggestTitleResult", () => {
  it("reads title or name", () => {
    expect(titleFromSuggestTitleResult({ title: "Atlas" })).toBe("Atlas");
    expect(titleFromSuggestTitleResult({ name: "Beacon" })).toBe("Beacon");
  });

  it("sanitizes creative host names through policy", () => {
    expect(titleFromSuggestTitleResult({ title: '"Night Scout"' })).toBe(
      "Night Scout",
    );
    expect(
      titleFromSuggestTitleResult({
        title: "Pipeline Fox is a great name for this",
      }),
    ).toBe("Pipeline Fox is");
  });

  it("rejects empty", () => {
    expect(titleFromSuggestTitleResult({ title: "  " })).toBeNull();
    expect(titleFromSuggestTitleResult(null)).toBeNull();
  });
});

describe("ChatThreadStore.assignLlmTitle", () => {
  it("applies when title_source is default", () => {
    const store = new ChatThreadStore();
    const thread = store.create({ tenant_id: "t", user_id: "u" });
    expect(thread.title_source).toBe("default");
    const outcome = store.assignLlmTitle(thread.thread_id, "Atlas");
    expect(outcome?.applied).toBe(true);
    expect(outcome?.thread.title).toBe("Atlas");
    expect(outcome?.thread.title_source).toBe("llm");
  });

  it("never overwrites user renames", () => {
    const store = new ChatThreadStore();
    const thread = store.create({ tenant_id: "t", user_id: "u" });
    store.updateTitle(thread.thread_id, "My agent", { title_source: "user" });
    const outcome = store.assignLlmTitle(thread.thread_id, "Should not win");
    expect(outcome?.applied).toBe(false);
    expect(outcome?.thread.title).toBe("My agent");
    expect(outcome?.thread.title_source).toBe("user");
  });

  it("never overwrites job titles", () => {
    const store = new ChatThreadStore();
    const thread = store.create({
      tenant_id: "t",
      user_id: "u",
      title: "Nightly report",
      title_source: "job",
    });
    const outcome = store.assignLlmTitle(thread.thread_id, "LLM");
    expect(outcome?.applied).toBe(false);
    expect(outcome?.thread.title).toBe("Nightly report");
  });

  it("bootstrap mode refuses write when title_source is already llm (lp-lv9.3 TOCTOU)", () => {
    const store = new ChatThreadStore();
    const thread = store.create({ tenant_id: "t", user_id: "u" });
    // Simulate first-message refine winning while bootstrap RPC was in flight.
    const refined = store.assignLlmTitle(thread.thread_id, "Orbit", {
      mode: "refine",
    });
    expect(refined?.applied).toBe(true);
    expect(refined?.thread.title_source).toBe("llm");

    // Late bootstrap write must not clobber refine (mode re-checks at apply).
    const late = store.assignLlmTitle(thread.thread_id, "New agent", {
      mode: "bootstrap",
    });
    expect(late?.applied).toBe(false);
    expect(late?.thread.title).toBe("Orbit");
    expect(late?.thread.title_source).toBe("llm");
  });

  it("bootstrap mode applies only while still default", () => {
    const store = new ChatThreadStore();
    const thread = store.create({ tenant_id: "t", user_id: "u" });
    const outcome = store.assignLlmTitle(thread.thread_id, "Bootstrap Name", {
      mode: "bootstrap",
    });
    expect(outcome?.applied).toBe(true);
    expect(outcome?.thread.title).toBe("Bootstrap Name");
    expect(outcome?.thread.title_source).toBe("llm");
  });

  it("refine mode may overwrite prior llm bootstrap title", () => {
    const store = new ChatThreadStore();
    const thread = store.create({ tenant_id: "t", user_id: "u" });
    store.assignLlmTitle(thread.thread_id, "New agent", { mode: "bootstrap" });
    const refined = store.assignLlmTitle(thread.thread_id, "Orbit", {
      mode: "refine",
    });
    expect(refined?.applied).toBe(true);
    expect(refined?.thread.title).toBe("Orbit");
    expect(refined?.thread.title_source).toBe("llm");
  });
});

describe("mock-gateway canned name constant", () => {
  it("is a short non-empty fixture (not a sales domain keyword)", () => {
    expect(MOCK_GATEWAY_CANNED_AGENT_NAME).toBe("Mock Lab Agent");
    expect(MOCK_GATEWAY_CANNED_AGENT_NAME).not.toBe("Hound");
    expect(MOCK_GATEWAY_CANNED_AGENT_NAME.split(" ").length).toBeLessThanOrEqual(
      AGENT_NAME_MAX_WORDS,
    );
  });
});
