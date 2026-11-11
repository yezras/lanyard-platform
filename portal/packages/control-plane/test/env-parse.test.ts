import { describe, expect, it } from "vitest";

import { parsePositiveIntEnv } from "../src/env-parse.js";

describe("parsePositiveIntEnv (lp-kng.6.7)", () => {
  it("parses positive integers, trimming whitespace", () => {
    expect(parsePositiveIntEnv("600")).toBe(600);
    expect(parsePositiveIntEnv("  45 ")).toBe(45);
    expect(parsePositiveIntEnv("1")).toBe(1);
  });

  it("returns undefined for unset / empty / invalid / non-positive values", () => {
    expect(parsePositiveIntEnv(undefined)).toBeUndefined();
    expect(parsePositiveIntEnv("")).toBeUndefined();
    expect(parsePositiveIntEnv("   ")).toBeUndefined();
    expect(parsePositiveIntEnv("abc")).toBeUndefined();
    expect(parsePositiveIntEnv("12.5")).toBeUndefined();
    expect(parsePositiveIntEnv("-5")).toBeUndefined();
    expect(parsePositiveIntEnv("0")).toBeUndefined();
  });
});
