import { describe, expect, it } from "vitest";

import {
  InvalidVaultPathError,
  isVaultPathAllowed,
  mergePathPrefixes,
  normalizeVaultPath,
} from "./path-access.js";

describe("normalizeVaultPath", () => {
  it("normalizes relative segments", () => {
    expect(normalizeVaultPath("Projects/A")).toBe("/Projects/A");
    expect(normalizeVaultPath("/Projects/A/")).toBe("/Projects/A");
  });

  it("rejects traversal", () => {
    expect(() => normalizeVaultPath("/Projects/../secret")).toThrow(
      InvalidVaultPathError,
    );
  });
});

describe("isVaultPathAllowed", () => {
  it("matches prefix boundaries", () => {
    const prefixes = ["/Projects/A"];
    expect(isVaultPathAllowed(prefixes, "/Projects/A/note.md")).toBe(true);
    expect(isVaultPathAllowed(prefixes, "/Projects/AB")).toBe(false);
    expect(isVaultPathAllowed(prefixes, "/Projects/B/x")).toBe(false);
  });

  it("root prefix allows all", () => {
    expect(isVaultPathAllowed(["/"], "/any/deep/path")).toBe(true);
  });

  it("fails closed with empty prefixes", () => {
    expect(isVaultPathAllowed([], "/Projects/A")).toBe(false);
  });
});

describe("mergePathPrefixes", () => {
  it("dedupes merged role prefixes", () => {
    expect(
      mergePathPrefixes([
        ["/Projects/A", "/Shared"],
        ["/Shared", "/Projects/B"],
      ]),
    ).toEqual(["/Projects/A", "/Shared", "/Projects/B"]);
  });
});