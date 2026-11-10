/**
 * Activity pane workflow tree tests (lp-dpr.7).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SubagentRun } from "../subagentRun.js";
import type { WorkflowRun } from "../workflowRun.js";

import { WorkflowTree } from "./WorkflowTree.js";

const subagents: SubagentRun[] = [
  {
    id: "sa-1",
    name: "Explore",
    status: "running",
    color: "#3B82F6",
    icon: "explore",
  },
];

const workflows: WorkflowRun[] = [
  {
    id: "wf-1",
    name: "Onboard",
    status: "running",
    stages: [
      {
        id: "s1",
        name: "Discover",
        status: "running",
        subagentIds: ["sa-1"],
      },
    ],
  },
  {
    id: "wf-2",
    name: "Ship",
    status: "complete",
    duration: "1m",
    stages: [{ id: "done", name: "Done", status: "complete" }],
  },
];

describe("WorkflowTree (lp-dpr.7)", () => {
  afterEach(() => {
    cleanup();
  });

  it("lists workflows on non-workflow focus paths via list mode", () => {
    // When focus is roster, ChatView uses SubagentRoster; tree list mode is
    // used for stale workflow ids — still verify list rendering path.
    render(
      <WorkflowTree
        workflows={workflows}
        subagents={subagents}
        focus={{ kind: "roster" }}
        onSelectWorkflow={vi.fn()}
        onSelectSubagent={vi.fn()}
        onShowRoster={vi.fn()}
      />,
    );
    expect(screen.getByTestId("chat-workflow-tree")).toBeTruthy();
    expect(screen.getAllByTestId("chat-workflow-run-tree")).toHaveLength(2);
  });

  it("shows focused workflow detail with stage tree", () => {
    const onShowRoster = vi.fn();
    render(
      <WorkflowTree
        workflows={workflows}
        subagents={subagents}
        focus={{ kind: "workflow", workflowId: "wf-1" }}
        onSelectWorkflow={vi.fn()}
        onSelectSubagent={vi.fn()}
        onShowRoster={onShowRoster}
      />,
    );

    expect(screen.getByTestId("chat-workflow-detail")).toBeTruthy();
    expect(
      screen.getByTestId("chat-workflow-detail").getAttribute("data-workflow-id"),
    ).toBe("wf-1");
    expect(screen.getByTestId("chat-workflow-stage-list")).toBeTruthy();
    // Nested subagent under expanded running stage
    expect(screen.getByTestId("chat-workflow-nested-subagent")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back to roster" }));
    expect(onShowRoster).toHaveBeenCalled();
  });

  it("shows empty state when no workflows", () => {
    render(
      <WorkflowTree
        workflows={[]}
        subagents={[]}
        focus={{ kind: "roster" }}
        onSelectWorkflow={vi.fn()}
        onSelectSubagent={vi.fn()}
        onShowRoster={vi.fn()}
      />,
    );
    expect(screen.getByTestId("chat-workflow-tree-empty")).toBeTruthy();
  });
});
