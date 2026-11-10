import { describe, expect, it } from "vitest";

import {
  isScheduledTaskWizardToolEvent,
  isWizardCancelText,
  parseCronjobToolResult,
  wizardStepNeedsFreeText,
} from "./scheduledTaskWizardLive.js";

describe("isScheduledTaskWizardToolEvent", () => {
  it("detects cronjob action=setup on completed tool_progress", () => {
    expect(
      isScheduledTaskWizardToolEvent({
        type: "tool_progress",
        tool_name: "cronjob",
        tool_status: "complete",
        metadata: {
          portal_event: "tool_progress",
          tool_name: "cronjob",
          status: "completed",
          result: JSON.stringify({
            action: "setup",
            success: true,
            portal_ui: {
              portal_event: "scheduled_task_wizard",
              step: "start",
            },
          }),
        },
      }),
    ).toBe(true);
  });

  it("detects wizard alias and dedicated portal_event", () => {
    expect(
      isScheduledTaskWizardToolEvent({
        type: "tool_progress",
        tool_name: "cronjob",
        tool_status: "complete",
        metadata: {
          result: JSON.stringify({ action: "wizard", success: true }),
        },
      }),
    ).toBe(true);
    expect(
      isScheduledTaskWizardToolEvent({
        type: "message_send",
        metadata: { portal_event: "scheduled_task_wizard" },
      }),
    ).toBe(true);
  });

  it("ignores list/create and non-cron tools", () => {
    expect(
      isScheduledTaskWizardToolEvent({
        type: "tool_progress",
        tool_name: "cronjob",
        tool_status: "complete",
        metadata: {
          result: JSON.stringify({ action: "list", success: true, count: 2 }),
        },
      }),
    ).toBe(false);
    expect(
      isScheduledTaskWizardToolEvent({
        type: "tool_progress",
        tool_name: "cronjob",
        tool_status: "complete",
        metadata: {
          result: JSON.stringify({
            action: "create",
            success: true,
            job: { id: "x" },
          }),
        },
      }),
    ).toBe(false);
    expect(
      isScheduledTaskWizardToolEvent({
        type: "tool_progress",
        tool_name: "bash",
        tool_status: "complete",
        metadata: {
          result: JSON.stringify({ action: "setup" }),
        },
      }),
    ).toBe(false);
    expect(
      isScheduledTaskWizardToolEvent({
        type: "tool_progress",
        tool_name: "cronjob",
        tool_status: "started",
        metadata: {
          result: JSON.stringify({ action: "setup", success: true }),
        },
      }),
    ).toBe(false);
  });
});

describe("parseCronjobToolResult", () => {
  it("parses JSON string result", () => {
    const r = parseCronjobToolResult({
      result: JSON.stringify({ action: "setup", success: true }),
    });
    expect(r?.action).toBe("setup");
  });
});

describe("isWizardCancelText", () => {
  it("matches cancel-ish one-liners", () => {
    expect(isWizardCancelText("cancel")).toBe(true);
    expect(isWizardCancelText("Never mind")).toBe(true);
    expect(isWizardCancelText("please stop this wizard")).toBe(false);
  });
});

describe("wizardStepNeedsFreeText", () => {
  it("flags text-collection steps only", () => {
    expect(wizardStepNeedsFreeText("instructions_text")).toBe(true);
    expect(wizardStepNeedsFreeText("days_custom")).toBe(true);
    expect(wizardStepNeedsFreeText("time_custom")).toBe(true);
    expect(wizardStepNeedsFreeText("days")).toBe(false);
    expect(wizardStepNeedsFreeText("confirm")).toBe(false);
  });

  it("flags timezone free-text after MCQ other (activeMcq cleared)", () => {
    // No active MCQ → free-text IANA (after "other").
    expect(wizardStepNeedsFreeText("timezone")).toBe(true);
    expect(wizardStepNeedsFreeText("timezone", null)).toBe(true);
    // Still showing timezone chips → not free-text yet.
    expect(
      wizardStepNeedsFreeText("timezone", {
        mcq_id: "st-timezone-sess1",
      }),
    ).toBe(false);
  });
});
