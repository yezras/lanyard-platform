import { describe, expect, it } from "vitest";

import { canSubmitBindScheduledTask } from "./createScheduledTaskDraft.js";

describe("canSubmitBindScheduledTask (lp-cxhb.11 I14)", () => {
  it("rejects a missing agent", () => {
    expect(canSubmitBindScheduledTask({ agentId: null })).toBe(false);
    expect(canSubmitBindScheduledTask({ agentId: "  " })).toBe(false);
  });

  it("accepts exactly one agent id", () => {
    expect(canSubmitBindScheduledTask({ agentId: "agent-legal" })).toBe(true);
  });
});
