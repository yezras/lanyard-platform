import { describe, expect, it } from "vitest";

import { decideSpeculativeEnsureOnlineKick } from "./speculativeEnsureOnline.js";

describe("decideSpeculativeEnsureOnlineKick (lp-vqr0.9 T7)", () => {
  it("does not kick while Chat is keep-alive hidden", () => {
    expect(
      decideSpeculativeEnsureOnlineKick({
        isActive: false,
        alreadyKicked: false,
      }),
    ).toEqual({ kick: false, reason: "inactive" });
  });

  it("kicks once when Chat becomes the active tab", () => {
    expect(
      decideSpeculativeEnsureOnlineKick({
        isActive: true,
        alreadyKicked: false,
      }),
    ).toEqual({ kick: true });
  });

  it("does not kick a second time on the same mount", () => {
    expect(
      decideSpeculativeEnsureOnlineKick({
        isActive: true,
        alreadyKicked: true,
      }),
    ).toEqual({ kick: false, reason: "already_kicked" });
  });
});
