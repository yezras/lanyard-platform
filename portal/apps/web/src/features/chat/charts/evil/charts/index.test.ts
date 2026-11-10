import { describe, expect, it } from "vitest";

import {
  EvilAreaChart,
  EvilBarChart,
  EvilLineChart,
  EvilPieChart,
} from "./index.js";

/**
 * Smoke for lp-a79.3: all four Evil chart modules resolve from the barrel
 * without runtime registry fetch.
 */
describe("evil/charts barrel", () => {
  it("exports EvilBarChart, EvilLineChart, EvilAreaChart, EvilPieChart", () => {
    expect(typeof EvilBarChart).toBe("function");
    expect(typeof EvilLineChart).toBe("function");
    expect(typeof EvilAreaChart).toBe("function");
    expect(typeof EvilPieChart).toBe("function");
  });
});
