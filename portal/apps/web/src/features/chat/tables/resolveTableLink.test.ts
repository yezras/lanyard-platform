/**
 * Unit tests for resolveTableLink (lp-a79.11).
 */

import { describe, expect, it } from "vitest";

import { inferLinkTarget, resolveTableLink } from "./resolveTableLink.js";

describe("inferLinkTarget", () => {
  it("honors explicit targets", () => {
    expect(inferLinkTarget("https://x.com", "vault")).toBe("vault");
    expect(inferLinkTarget("docs/a.md", "external")).toBe("external");
  });

  it("auto: http(s) → external, else vault", () => {
    expect(inferLinkTarget("https://example.com/a")).toBe("external");
    expect(inferLinkTarget("http://example.com/a")).toBe("external");
    expect(inferLinkTarget("docs/runbook.md")).toBe("vault");
    expect(inferLinkTarget("/Projects/A/README.md")).toBe("vault");
    expect(inferLinkTarget("./local.md")).toBe("vault");
  });
});

describe("resolveTableLink", () => {
  it("external defaults openInNewTab true", () => {
    expect(
      resolveTableLink("https://example.com", "external"),
    ).toEqual({
      kind: "external",
      href: "https://example.com",
      openInNewTab: true,
    });
  });

  it("external respects openInNewTab false", () => {
    expect(
      resolveTableLink("https://example.com", "auto", {
        openInNewTab: false,
      }),
    ).toEqual({
      kind: "external",
      href: "https://example.com",
      openInNewTab: false,
    });
  });

  it("vault joins projectVaultPath for relative hrefs", () => {
    const resolved = resolveTableLink("src/foo.ts", "vault", {
      projectVaultPath: "/home/u/Core",
    });
    expect(resolved.kind).toBe("vault");
    if (resolved.kind !== "vault") return;
    expect(resolved.path).toMatch(/foo\.ts$/);
    // Path should be under project or project-relative after projection.
    expect(resolved.path.includes("foo.ts")).toBe(true);
  });

  it("returns invalid for empty and dangerous schemes", () => {
    expect(resolveTableLink("").kind).toBe("invalid");
    expect(resolveTableLink("   ").kind).toBe("invalid");
    expect(resolveTableLink("javascript:void(0)").kind).toBe("invalid");
    expect(resolveTableLink("data:text/html,hi").kind).toBe("invalid");
  });

  it("external target rejects non-http href", () => {
    const resolved = resolveTableLink("docs/a.md", "external");
    expect(resolved.kind).toBe("invalid");
  });
});
