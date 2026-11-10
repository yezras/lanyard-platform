import { describe, expect, it } from "vitest";

import { latestActivityTextFromItems } from "./threadActivityPreview.js";

describe("latestActivityTextFromItems (lp-lv9.3)", () => {
  it("returns null for empty timeline", () => {
    expect(latestActivityTextFromItems([])).toBeNull();
  });

  it("prefers the latest user or assistant content", () => {
    expect(
      latestActivityTextFromItems([
        { type: "user", content: "Hello" },
        { type: "assistant_turn", content: "Hi there" },
        { type: "user", content: "Quarterly forecast notes" },
      ]),
    ).toBe("Quarterly forecast notes");
  });

  it("skips empty assistant content and tools", () => {
    expect(
      latestActivityTextFromItems([
        { type: "user", content: "Draft the plan" },
        { type: "assistant_turn", content: "   " },
        { type: "tool", content: "should ignore" },
      ]),
    ).toBe("Draft the plan");
  });

  it("collapses whitespace", () => {
    expect(
      latestActivityTextFromItems([
        { type: "assistant", content: "line one\n\n  line two" },
      ]),
    ).toBe("line one line two");
  });
});
