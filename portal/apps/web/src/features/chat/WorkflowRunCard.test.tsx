/**
 * Inline workflow card UI tests (lp-dpr.7 / lp-khq.9).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SubagentRun } from "./subagentRun.js";
import { WorkflowRunCard } from "./WorkflowRunCard.js";
import type { WorkflowRun } from "./workflowRun.js";

const subagents: SubagentRun[] = [
  {
    id: "sa-1",
    name: "Explore",
    status: "done",
    color: "#3B82F6",
    icon: "explore",
    summary: "Scan vault",
    duration: "2.1s",
  },
  {
    id: "sa-2",
    name: "coder",
    status: "running",
    color: "#10B981",
    icon: "code",
    summary: "Apply patch",
  },
];

const run: WorkflowRun = {
  id: "wf-1",
  name: "Onboard project",
  status: "running",
  summary: "Discover → implement",
  stages: [
    {
      id: "discover",
      name: "Discover",
      status: "complete",
      duration: "2.1s",
      subagentIds: ["sa-1"],
    },
    {
      id: "implement",
      name: "Implement",
      status: "running",
      subagentIds: ["sa-2"],
    },
    {
      id: "verify",
      name: "Verify",
      status: "pending",
    },
  ],
};

function nestedBtns() {
  return screen.getAllByTestId("chat-workflow-nested-subagent-btn");
}

describe("WorkflowRunCard (lp-dpr.7 / lp-khq.9)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders workflow with ordered stage list", () => {
    render(<WorkflowRunCard run={run} subagents={subagents} />);

    expect(screen.getByTestId("chat-workflow-run-card")).toBeTruthy();
    expect(
      screen.getByTestId("chat-workflow-run-card").getAttribute("data-workflow-id"),
    ).toBe("wf-1");
    const stages = screen.getAllByTestId("chat-workflow-stage");
    expect(stages).toHaveLength(3);
    expect(stages[0]?.getAttribute("data-stage-id")).toBe("discover");
    expect(stages[1]?.getAttribute("data-status")).toBe("running");
  });

  it("expands running stage by default and shows nested dither subagents", () => {
    render(<WorkflowRunCard run={run} subagents={subagents} />);

    // Running stage expanded → nested coder with dither avatar visible.
    const nested = screen.getAllByTestId("chat-workflow-nested-subagent");
    expect(nested.length).toBeGreaterThanOrEqual(1);
    const btn = screen.getByTestId("chat-workflow-nested-subagent-btn");
    expect(btn.getAttribute("data-run-id")).toBe("sa-2");
    // Dither avatar seed aligns with roster (run.name); no legacy chip.
    const avatar = screen.getByTestId("dither-avatar-sa-2");
    expect(avatar.getAttribute("data-avatar-seed")).toBe("coder");
    expect(avatar.getAttribute("data-running")).toBe("true");
    expect(screen.queryByTestId("chat-subagent-run-chip")).toBeNull();
  });

  it("toggles stage expand/collapse", () => {
    render(<WorkflowRunCard run={run} subagents={subagents} />);

    const toggles = screen.getAllByTestId("chat-workflow-stage-toggle");
    // Collapse the running stage
    fireEvent.click(toggles[1]!);
    expect(
      screen
        .getAllByTestId("chat-workflow-stage")
        .find((el) => el.getAttribute("data-stage-id") === "implement")
        ?.getAttribute("data-expanded"),
    ).toBe("false");

    // Expand discover (was collapsed by default when not running)
    fireEvent.click(toggles[0]!);
    expect(
      screen
        .getAllByTestId("chat-workflow-stage")
        .find((el) => el.getAttribute("data-stage-id") === "discover")
        ?.getAttribute("data-expanded"),
    ).toBe("true");
    // Nested Explore dither for discover stage
    const btns = nestedBtns();
    expect(btns.some((c) => c.getAttribute("data-run-id") === "sa-1")).toBe(
      true,
    );
    expect(screen.getByTestId("dither-avatar-sa-1").getAttribute("data-avatar-seed")).toBe(
      "Explore",
    );
  });

  it("header click selects workflow", () => {
    const onSelect = vi.fn();
    render(
      <WorkflowRunCard run={run} subagents={subagents} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByTestId("chat-workflow-run-header"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ id: "wf-1" });
  });

  it("nested dither click selects subagent (activity focus)", () => {
    const onSubagentSelect = vi.fn();
    render(
      <WorkflowRunCard
        run={run}
        subagents={subagents}
        onSubagentSelect={onSubagentSelect}
      />,
    );
    fireEvent.click(screen.getByTestId("chat-workflow-nested-subagent-btn"));
    expect(onSubagentSelect).toHaveBeenCalledTimes(1);
    expect(onSubagentSelect.mock.calls[0]?.[0]).toMatchObject({ id: "sa-2" });
  });

  it("fallback: free-floating running subagent appears under empty running stage", () => {
    const lagRun: WorkflowRun = {
      id: "wf-lag",
      name: "Laggy host",
      status: "running",
      stages: [
        { id: "discover", name: "Discover", status: "complete" },
        { id: "implement", name: "Implement", status: "running" },
      ],
    };
    const free: SubagentRun[] = [
      {
        id: "sa-free",
        name: "coder",
        status: "running",
        color: "#10B981",
        icon: "code",
      },
    ];
    render(<WorkflowRunCard run={lagRun} subagents={free} />);

    // Running stage expanded by default → free-floating dither row visible.
    const nested = screen.getAllByTestId("chat-workflow-nested-subagent");
    expect(nested).toHaveLength(1);
    const btn = screen.getByTestId("chat-workflow-nested-subagent-btn");
    expect(btn.getAttribute("data-run-id")).toBe("sa-free");
    expect(btn.getAttribute("data-status")).toBe("running");
    expect(screen.getByTestId("dither-avatar-sa-free")).toBeTruthy();
    // Empty copy only when truly no nest
    expect(screen.queryByText("No nested activity yet")).toBeNull();
  });

  it("host wins: does not double-count free-floaters when subagentIds present", () => {
    const freeAlso: SubagentRun[] = [
      ...subagents,
      {
        id: "sa-extra",
        name: "extra",
        status: "running",
        color: "#EF4444",
        icon: "default",
      },
    ];
    render(<WorkflowRunCard run={run} subagents={freeAlso} />);
    // Running implement stage has host id sa-2 only
    const btns = nestedBtns();
    expect(btns.map((c) => c.getAttribute("data-run-id"))).toEqual(["sa-2"]);
    expect(btns.some((c) => c.getAttribute("data-run-id") === "sa-extra")).toBe(
      false,
    );
  });

  it("shows empty nest copy only when truly empty", () => {
    const emptyRun: WorkflowRun = {
      id: "wf-empty",
      name: "Empty",
      status: "running",
      stages: [{ id: "s1", name: "Solo", status: "running" }],
    };
    render(<WorkflowRunCard run={emptyRun} subagents={[]} />);
    expect(screen.getByText("No nested activity yet")).toBeTruthy();
  });

  it("expanded completed stages show helpers or summary, not empty nest copy (lp-oop.38.25.1)", () => {
    const research: WorkflowRun = {
      id: "wf_249e3bb7c677e399",
      name: "research-lite",
      status: "complete",
      summary: "Plan → Explore → Synthesize",
      duration: "48s",
      stages: [
        {
          id: "plan",
          name: "Plan",
          status: "complete",
          summary: "Inspect vault layout first",
          subagentIds: ["wf_249e3bb7c677e399:plan"],
        },
        {
          id: "explore",
          name: "Explore",
          status: "complete",
          summary: "Packages under portal/ · Harness turn runner binds workflow",
          subagentIds: [
            "wf_249e3bb7c677e399:explore-structure",
            "wf_249e3bb7c677e399:explore-behavior",
          ],
        },
        {
          id: "synthesize",
          name: "Synthesize",
          status: "complete",
          summary: "Research-lite found a short cited brief",
          subagentIds: ["wf_249e3bb7c677e399:synthesize"],
        },
      ],
    };
    const helpers: SubagentRun[] = [
      {
        id: "wf_249e3bb7c677e399:plan",
        name: "plan",
        status: "done",
        color: "#3B82F6",
        icon: "plan",
        summary: "Inspect vault layout first",
        parentToolCallId: "wf_249e3bb7c677e399",
      },
      {
        id: "wf_249e3bb7c677e399:explore-structure",
        name: "explore-structure",
        status: "done",
        color: "#10B981",
        icon: "explore",
        parentToolCallId: "wf_249e3bb7c677e399",
      },
      {
        id: "wf_249e3bb7c677e399:explore-behavior",
        name: "explore-behavior",
        status: "done",
        color: "#F59E0B",
        icon: "explore",
        parentToolCallId: "wf_249e3bb7c677e399",
      },
      {
        id: "wf_249e3bb7c677e399:synthesize",
        name: "synthesize",
        status: "done",
        color: "#8B5CF6",
        icon: "research",
        parentToolCallId: "wf_249e3bb7c677e399",
      },
    ];
    render(<WorkflowRunCard run={research} subagents={helpers} />);

    const toggles = screen.getAllByTestId("chat-workflow-stage-toggle");
    expect(toggles).toHaveLength(3);
    for (const toggle of toggles) {
      fireEvent.click(toggle);
    }
    expect(screen.queryByText("No nested activity yet")).toBeNull();
    const summaries = screen.getAllByTestId("chat-workflow-stage-summary");
    expect(summaries.map((el) => el.textContent)).toEqual(
      expect.arrayContaining([
        "Inspect vault layout first",
        "Packages under portal/ · Harness turn runner binds workflow",
        "Research-lite found a short cited brief",
      ]),
    );
    const nested = nestedBtns();
    expect(nested.map((btn) => btn.getAttribute("data-run-id"))).toEqual([
      "wf_249e3bb7c677e399:plan",
      "wf_249e3bb7c677e399:explore-structure",
      "wf_249e3bb7c677e399:explore-behavior",
      "wf_249e3bb7c677e399:synthesize",
    ]);
    expect(nested[0]?.textContent).toMatch(/plan/);
    expect(nested[1]?.textContent).toMatch(/explore-structure/);
  });

  it("live emit gap: completed stages show helper or summary from reduced nest", () => {
    const liveGap: WorkflowRun = {
      id: "wf_e93399d99080dc60",
      name: "research-lite",
      status: "complete",
      stages: [
        {
          id: "plan",
          name: "Plan",
          status: "complete",
          summary: "Listing files",
          toolCallIds: ["tc-ls"],
        },
        {
          id: "explore",
          name: "Explore",
          status: "complete",
          summary: "Searching files · Reading documents",
          subagentIds: ["wf_e93399d99080dc60:explore-structure"],
        },
        {
          id: "synthesize",
          name: "Synthesize",
          status: "complete",
          summary: "Cited brief for the parent",
        },
      ],
    };
    render(<WorkflowRunCard run={liveGap} subagents={[]} />);
    const toggles = screen.getAllByTestId("chat-workflow-stage-toggle");
    for (const toggle of toggles) {
      fireEvent.click(toggle);
    }
    expect(screen.queryByText("No nested activity yet")).toBeNull();
    expect(
      screen.getAllByTestId("chat-workflow-stage-summary").map((el) => el.textContent),
    ).toEqual(
      expect.arrayContaining([
        "Listing files",
        "Searching files · Reading documents",
        "Cited brief for the parent",
      ]),
    );
    expect(screen.getByText(/explore-structure/)).toBeTruthy();
  });

  it("completed stage with only a summary hides empty nest copy", () => {
    const summaryOnly: WorkflowRun = {
      id: "wf-sum",
      name: "research-lite",
      status: "complete",
      stages: [
        {
          id: "plan",
          name: "Plan",
          status: "complete",
          summary: "Outline the research pass",
        },
      ],
    };
    render(<WorkflowRunCard run={summaryOnly} subagents={[]} />);
    fireEvent.click(screen.getByTestId("chat-workflow-stage-toggle"));
    expect(screen.getByText("Outline the research pass")).toBeTruthy();
    expect(screen.queryByText("No nested activity yet")).toBeNull();
  });
});
