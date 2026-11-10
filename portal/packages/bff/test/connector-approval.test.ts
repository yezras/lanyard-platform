import { describe, expect, it } from "vitest";

import {
  PendingConnectorUseStore,
  decideResult,
  evaluatePendingCommand,
} from "../src/connector-approval.js";
import { applyApprovalDecision } from "@lanyard/connectors";

describe("PendingConnectorUseStore", () => {
  it("expires rows after TTL", () => {
    let now = 1_000;
    const store = new PendingConnectorUseStore(10, () => now);
    const row = store.put({
      tenant_id: "t1",
      user_id: "u1",
      thread_id: "thr-1",
      argv: ["gws", "gmail", "users", "drafts", "create"],
      tool_name: null,
      tool_call_id: null,
      action_class: "gmail.draft",
      gate: "sticky",
      mapped: true,
      connector_id: "google",
    });
    expect(store.get(row.approval_id)?.argv[2]).toBe("users");
    now = 1_011;
    expect(store.get(row.approval_id)).toBeNull();
  });
});

describe("connector approval gate", () => {
  it("marks reject as skip without disconnect", () => {
    const prompt = evaluatePendingCommand(
      ["gws", "gmail", "users", "messages", "send"],
      {},
    );
    const applied = applyApprovalDecision(prompt, "reject");
    expect(decideResult(applied)).toEqual({
      outcome: "skip",
      run: false,
      disconnected: false,
      persist_sticky: null,
    });
  });
});
