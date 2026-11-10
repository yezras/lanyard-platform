import { describe, expect, it } from "vitest";

import { portalViewFromPathname } from "./portalView.js";

describe("portalViewFromPathname", () => {
  it("reads the last segment", () => {
    expect(portalViewFromPathname("/chat")).toBe("chat");
    expect(portalViewFromPathname("/vault")).toBe("vault");
    expect(portalViewFromPathname("/settings")).toBe("settings");
    expect(portalViewFromPathname("/acme/chat")).toBe("chat");
  });

  it("defaults unknown paths to chat", () => {
    expect(portalViewFromPathname("/")).toBe("chat");
    expect(portalViewFromPathname("/nope")).toBe("chat");
  });
});
