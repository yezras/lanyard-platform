import { describe, expect, it } from "vitest";

import {
  CHANNEL_MIN_MEMBERS,
  canRemoveChannelMember,
  canSubmitCreateChannel,
  uniqueMemberIds,
} from "./createChannelDraft.js";

describe("canSubmitCreateChannel (lp-cxhb.5 I4)", () => {
  it("is false without a name", () => {
    expect(
      canSubmitCreateChannel({
        name: "  ",
        memberAgentIds: ["a", "b"],
      }),
    ).toBe(false);
  });

  it("is false with fewer than two members", () => {
    expect(
      canSubmitCreateChannel({ name: "Room", memberAgentIds: [] }),
    ).toBe(false);
    expect(
      canSubmitCreateChannel({ name: "Room", memberAgentIds: ["a"] }),
    ).toBe(false);
    expect(CHANNEL_MIN_MEMBERS).toBe(2);
  });

  it("is true with a name and two unique members", () => {
    expect(
      canSubmitCreateChannel({
        name: "Deal room",
        memberAgentIds: ["a", "b"],
      }),
    ).toBe(true);
  });

  it("dedupes member ids before counting", () => {
    expect(uniqueMemberIds(["a", "a", "b"])).toEqual(["a", "b"]);
    expect(
      canSubmitCreateChannel({
        name: "Room",
        memberAgentIds: ["a", "a"],
      }),
    ).toBe(false);
  });
});

describe("canRemoveChannelMember (lp-cxhb.6 I7)", () => {
  it("is false at the floor of two", () => {
    expect(canRemoveChannelMember(2)).toBe(false);
    expect(canRemoveChannelMember(1)).toBe(false);
    expect(canRemoveChannelMember(0)).toBe(false);
  });

  it("is true above two", () => {
    expect(canRemoveChannelMember(3)).toBe(true);
  });
});
