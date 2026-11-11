import { describe, expect, it } from "vitest";

import {
  ACTION_CLASSES,
  APPROVAL_LABEL_ALWAYS,
  APPROVAL_LABEL_APPROVE_THIS_CALL,
  APPROVAL_LABEL_REJECT,
  HIGH_GATE_ACTION_CLASSES,
  IllegalApprovalDecisionError,
  IllegalStickyError,
  applyApprovalDecision,
  approvalChoices,
  connectorIdForArgv,
  evaluateToolApproval,
  parseApprovalDecision,
  parseConnectorSticky,
  setStickyFlag,
} from "../src/index.js";

const DRAFT_ARGV = ["gws", "gmail", "users", "drafts", "create"] as const;
const SEND_ARGV = ["gws", "gmail", "users", "messages", "send"] as const;
const UNMAPPED_GWS = ["gws", "gmail", "users", "messages", "batchDelete"] as const;

describe("evaluateToolApproval", () => {
  it("prompts Always / Reject on the first gmail.draft", () => {
    const evaluation = evaluateToolApproval(DRAFT_ARGV, {});
    expect(evaluation).toMatchObject({
      outcome: "prompt",
      gate: "sticky",
      action_class: "gmail.draft",
      mapped: true,
      connector_id: "google",
      run: false,
    });
    expect(evaluation.outcome === "prompt" && evaluation.choices).toEqual([
      { id: "always", label: APPROVAL_LABEL_ALWAYS },
      { id: "reject", label: APPROVAL_LABEL_REJECT },
    ]);
    if (evaluation.outcome === "prompt") {
      expect(evaluation.choices.map((c) => c.label)).not.toContain(
        APPROVAL_LABEL_APPROVE_THIS_CALL,
      );
    }
  });

  it("skips later gmail.draft chats when sticky is set", () => {
    expect(
      evaluateToolApproval(DRAFT_ARGV, { "gmail.draft": true }),
    ).toEqual({
      outcome: "allow",
      reason: "sticky",
      action_class: "gmail.draft",
      gate: "sticky",
      mapped: true,
      connector_id: "google",
      run: true,
    });
  });

  it("gmail.draft sticky does not allow gmail.send", () => {
    const evaluation = evaluateToolApproval(SEND_ARGV, {
      "gmail.draft": true,
      "gmail.read": true,
    });
    expect(evaluation).toMatchObject({
      outcome: "prompt",
      gate: "every_call",
      action_class: "gmail.send",
      mapped: true,
      run: false,
    });
    if (evaluation.outcome === "prompt") {
      expect(evaluation.choices).toEqual([
        { id: "approve_this_call", label: APPROVAL_LABEL_APPROVE_THIS_CALL },
        { id: "reject", label: APPROVAL_LABEL_REJECT },
      ]);
      expect(evaluation.choices.map((c) => c.id)).not.toContain("always");
    }
  });

  it("gmail.send always prompts Approve this call / Reject", () => {
    const evaluation = evaluateToolApproval(SEND_ARGV, {});
    expect(evaluation.outcome).toBe("prompt");
    if (evaluation.outcome === "prompt") {
      expect(evaluation.choices.map((c) => c.label)).toEqual([
        APPROVAL_LABEL_APPROVE_THIS_CALL,
        APPROVAL_LABEL_REJECT,
      ]);
    }
  });

  it("does not run an unmapped gws subcommand", () => {
    const evaluation = evaluateToolApproval(UNMAPPED_GWS, {
      "gmail.draft": true,
      "gmail.read": true,
    });
    expect(evaluation).toMatchObject({
      outcome: "prompt",
      gate: "every_call",
      action_class: null,
      mapped: false,
      connector_id: "google",
      run: false,
    });
  });

  it("classifies from argv and sticky only", () => {
    expect(evaluateToolApproval.length).toBe(2);
    const src = evaluateToolApproval.toString();
    expect(src).not.toMatch(/\b(llm|openai|anthropic|completion)\b/i);
  });
});

describe("applyApprovalDecision", () => {
  it("Always on gmail.draft persists sticky and runs", () => {
    const prompt = evaluateToolApproval(DRAFT_ARGV, {});
    expect(
      applyApprovalDecision(prompt, "always"),
    ).toEqual({
      outcome: "allow",
      run: true,
      persist_sticky: "gmail.draft",
      disconnect: false,
    });
  });

  it("Reject skips the tool and does not Disconnect", () => {
    const prompt = evaluateToolApproval(DRAFT_ARGV, {});
    expect(applyApprovalDecision(prompt, "reject")).toEqual({
      outcome: "skip",
      run: false,
      persist_sticky: null,
      disconnect: false,
    });
    const send = evaluateToolApproval(SEND_ARGV, {});
    expect(applyApprovalDecision(send, "reject").disconnect).toBe(false);
  });

  it("rejects Always on gmail.send and other high-gates", () => {
    const send = evaluateToolApproval(SEND_ARGV, {});
    expect(() => applyApprovalDecision(send, "always")).toThrow(
      IllegalApprovalDecisionError,
    );
    for (const actionClass of HIGH_GATE_ACTION_CLASSES) {
      expect(ACTION_CLASSES).toContain(actionClass);
    }
  });

  it("approve_this_call on unmapped gws runs once without sticky", () => {
    const prompt = evaluateToolApproval(UNMAPPED_GWS, {});
    expect(applyApprovalDecision(prompt, "approve_this_call")).toEqual({
      outcome: "allow",
      run: true,
      persist_sticky: null,
      disconnect: false,
    });
  });

  it("rejects Always on unmapped commands", () => {
    const prompt = evaluateToolApproval(UNMAPPED_GWS, {});
    expect(() => applyApprovalDecision(prompt, "always")).toThrow(
      IllegalApprovalDecisionError,
    );
  });
});

describe("sticky map", () => {
  it("cannot store every_call classes", () => {
    expect(() => parseConnectorSticky({ "gmail.send": true })).toThrow(
      IllegalStickyError,
    );
    expect(() =>
      setStickyFlag({}, "gmail.send", true),
    ).toThrow(IllegalStickyError);
  });

  it("clears one class without touching the rest", () => {
    const next = setStickyFlag(
      { "gmail.read": true, "gmail.draft": true },
      "gmail.draft",
      false,
    );
    expect(next).toEqual({ "gmail.read": true });
  });
});

describe("parseApprovalDecision", () => {
  it("accepts the closed decision set", () => {
    expect(parseApprovalDecision("always")).toBe("always");
    expect(parseApprovalDecision("approve_this_call")).toBe("approve_this_call");
    expect(parseApprovalDecision("reject")).toBe("reject");
    expect(() => parseApprovalDecision("yolo")).toThrow(
      IllegalApprovalDecisionError,
    );
  });
});

describe("connectorIdForArgv", () => {
  it("binds unmapped gws to google", () => {
    expect(connectorIdForArgv([...UNMAPPED_GWS])).toBe("google");
    expect(connectorIdForArgv(["wacli", "auth"])).toBe("whatsapp");
    expect(connectorIdForArgv(["curl", "https://example.com"])).toBeNull();
  });
});

describe("approvalChoices", () => {
  it("never offers Always on every_call", () => {
    expect(approvalChoices("every_call").map((c) => c.id)).toEqual([
      "approve_this_call",
      "reject",
    ]);
    expect(approvalChoices("sticky").map((c) => c.id)).toEqual([
      "always",
      "reject",
    ]);
  });
});
