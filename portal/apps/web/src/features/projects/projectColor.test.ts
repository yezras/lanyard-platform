import { describe, expect, it } from "vitest";

import { PROJECT_COLOR_NEUTRAL, projectColor } from "./projectColor.js";

describe("projectColor", () => {
  it("returns neutral for null/empty", () => {
    expect(projectColor(null)).toBe(PROJECT_COLOR_NEUTRAL);
    expect(projectColor(undefined)).toBe(PROJECT_COLOR_NEUTRAL);
    expect(projectColor("")).toBe(PROJECT_COLOR_NEUTRAL);
  });

  it("is stable for the same project id", () => {
    expect(projectColor("proj-a")).toBe(projectColor("proj-a"));
  });

  it("can assign different colors to different ids", () => {
    const colors = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => projectColor(id)),
    );
    expect(colors.size).toBeGreaterThan(1);
  });
});
