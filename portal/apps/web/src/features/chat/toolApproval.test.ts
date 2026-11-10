import { describe, expect, it } from "vitest";

import type { ChatEvent } from "../../api/types.js";

import { parseToolApprovalEvent } from "./toolApproval.js";

function event(partial: Partial<ChatEvent>): ChatEvent {
  return {
    type: "tool_approval",
    chat_id: "thr-1",
    ...partial,
  };
}

describe("parseToolApprovalEvent", () => {
  it("gmail.draft bubble is Always / Reject", () => {
    const item = parseToolApprovalEvent(
      event({
        approval_id: "appr-draft",
        gate: "sticky",
        action_class: "gmail.draft",
        mapped: true,
        content: "Allow gmail.draft?",
        choices: [
          { id: "always", label: "Always" },
          { id: "reject", label: "Reject" },
        ],
      }),
    );
    expect(item).toMatchObject({
      type: "tool_approval",
      approvalId: "appr-draft",
      gate: "sticky",
      actionClass: "gmail.draft",
    });
    expect(item?.choices.map((c) => c.label)).toEqual(["Always", "Reject"]);
    expect(item?.choices.map((c) => c.id)).not.toContain("approve_this_call");
  });

  it("gmail.send bubble is Approve this call / Reject with no Always", () => {
    const item = parseToolApprovalEvent(
      event({
        approval_id: "appr-send",
        gate: "every_call",
        action_class: "gmail.send",
        mapped: true,
        choices: [
          { id: "approve_this_call", label: "Approve this call" },
          { id: "reject", label: "Reject" },
        ],
      }),
    );
    expect(item?.choices.map((c) => c.label)).toEqual([
      "Approve this call",
      "Reject",
    ]);
    expect(item?.choices.map((c) => c.id)).not.toContain("always");
  });
});
