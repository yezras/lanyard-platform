/**
 * Activity pane shell chrome tests (lp-a8u.1).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ActivityPaneShell } from "./ActivityPaneShell.js";

describe("ActivityPaneShell (lp-a8u.1)", () => {
  afterEach(() => {
    cleanup();
  });

  it("does not show raw runId/tool_call_id as subagent subtitle", () => {
    const runId = "call_tool_abc123xyz";
    render(
      <ActivityPaneShell
        state={{
          mode: "activity",
          focus: { kind: "subagent", runId },
          openGeneration: 1,
        }}
        onClose={() => {}}
        autoFocus={false}
      />,
    );

    const pane = screen.getByTestId("chat-activity-pane");
    expect(pane.getAttribute("data-focus-kind")).toBe("subagent");
    expect(pane.textContent).toMatch(/Subagent/);
    expect(pane.textContent).toMatch(/Run detail/);
    expect(pane.textContent).not.toContain(runId);
  });

  it("keeps roster subtitle for roster focus", () => {
    render(
      <ActivityPaneShell
        state={{
          mode: "activity",
          focus: { kind: "roster" },
          openGeneration: 1,
        }}
        onClose={() => {}}
        autoFocus={false}
      />,
    );

    const pane = screen.getByTestId("chat-activity-pane");
    expect(pane.textContent).toMatch(/Activity/);
    expect(pane.textContent).toMatch(/Subagents & workflows/);
  });

  it("neutralizes scheduled-task config chrome (lp-pxr.3)", () => {
    render(
      <ActivityPaneShell
        state={{
          mode: "activity",
          focus: { kind: "scheduled_task_config" },
          openGeneration: 1,
        }}
        onClose={() => {}}
        autoFocus={false}
      />,
    );

    const pane = screen.getByTestId("chat-activity-pane");
    expect(pane.getAttribute("data-focus-kind")).toBe("scheduled_task_config");
    // No redundant shell title/subtitle (job name lives in the body).
    expect(pane.textContent).not.toMatch(/Scheduled task/i);
    expect(pane.textContent).not.toMatch(/Schedule & instructions/i);
    expect(screen.getByTestId("chat-activity-pane-chrome-neutral")).toBeTruthy();
    // Close control still present.
    expect(
      screen.getByRole("button", { name: "Close activity pane" }),
    ).toBeTruthy();
  });
});
