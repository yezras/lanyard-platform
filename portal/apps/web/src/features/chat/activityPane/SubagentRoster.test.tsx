/**
 * Subagent roster UI tests (lp-dpr.5 / lp-a8u.1 / lp-uxy.1).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatTimelineToolCall } from "../../../hooks/useChatEvents.js";
import type { SubagentRun } from "../subagentRun.js";

import { SubagentRoster } from "./SubagentRoster.js";

const runs: SubagentRun[] = [
  {
    id: "sa-run",
    name: "Explore",
    status: "running",
    color: "#3B82F6",
    icon: "explore",
    summary: "Scan vault",
    duration: "0:12",
  },
  {
    id: "sa-done",
    name: "coder",
    status: "done",
    color: "#10B981",
    icon: "code",
    summary: "Apply patch",
    duration: "4.1s",
  },
];

const nestedRunning: ChatTimelineToolCall[] = [
  {
    key: "tc-nested-1",
    name: "read_file",
    target: "/Policies/ACL.md",
    status: "running",
    parentSubagentId: "sa-run",
  },
  {
    key: "tc-nested-2",
    name: "vault_search",
    target: "access control",
    status: "complete",
    duration: "0.5s",
    parentSubagentId: "sa-run",
  },
];

const nestedComplete: ChatTimelineToolCall[] = [
  {
    key: "tc-nested-done",
    name: "write_file",
    target: "/Notes/patch.md",
    status: "complete",
    duration: "1.0s",
    parentSubagentId: "sa-done",
    result: "Applied 3 hunks",
  },
];

describe("SubagentRoster (lp-dpr.5)", () => {
  afterEach(() => {
    cleanup();
  });

  it("lists concurrent subagents with identity on roster focus", () => {
    const onSelectRun = vi.fn();
    render(
      <SubagentRoster
        runs={runs}
        focus={{ kind: "roster" }}
        onSelectRun={onSelectRun}
        onShowRoster={vi.fn()}
      />,
    );

    expect(screen.getByTestId("chat-subagent-roster")).toBeTruthy();
    const rows = screen.getAllByTestId("chat-subagent-roster-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute("data-run-id")).toBe("sa-run");
    expect(rows[0]?.getAttribute("data-status")).toBe("running");
    expect(rows[1]?.getAttribute("data-run-id")).toBe("sa-done");

    fireEvent.click(rows[0]!);
    expect(onSelectRun).toHaveBeenCalledWith("sa-run");
  });

  it("shows focused run detail when focus is subagent", () => {
    const onShowRoster = vi.fn();
    render(
      <SubagentRoster
        runs={runs}
        focus={{ kind: "subagent", runId: "sa-run" }}
        onSelectRun={vi.fn()}
        onShowRoster={onShowRoster}
      />,
    );

    expect(screen.getByTestId("chat-subagent-detail")).toBeTruthy();
    expect(screen.getByTestId("chat-subagent-detail-status").textContent).toMatch(
      /running/i,
    );
    expect(
      screen.getByTestId("chat-subagent-detail-summary").textContent,
    ).toMatch(/Scan vault/);

    fireEvent.click(screen.getByRole("button", { name: "Back to roster" }));
    expect(onShowRoster).toHaveBeenCalled();
  });

  it("renders result and summary as Markdown (lp-a8u.1)", () => {
    const markdownRuns: SubagentRun[] = [
      {
        id: "call_abc123xyz",
        name: "Researcher",
        status: "done",
        color: "#8B5CF6",
        icon: "explore",
        summary: "Found **three** options:\n\n- alpha\n- beta",
        result:
          "## Outcome\n\nShipped with **bold** and a list:\n\n1. first\n2. second",
        duration: "2.0s",
      },
    ];

    render(
      <SubagentRoster
        runs={markdownRuns}
        focus={{ kind: "subagent", runId: "call_abc123xyz" }}
        onSelectRun={vi.fn()}
        onShowRoster={vi.fn()}
      />,
    );

    const detail = screen.getByTestId("chat-subagent-detail");
    expect(detail.getAttribute("data-run-id")).toBe("call_abc123xyz");
    expect(detail.textContent).toMatch(/Researcher/);

    const summary = screen.getByTestId("chat-subagent-detail-summary");
    expect(summary.querySelector("strong")).toBeTruthy();
    expect(summary.querySelector("strong")?.textContent).toBe("three");
    expect(summary.querySelector("li")).toBeTruthy();
    expect(summary.textContent).not.toMatch(/\*\*three\*\*/);

    const result = screen.getByTestId("chat-subagent-detail-result");
    expect(result.querySelector("strong")).toBeTruthy();
    expect(result.querySelector("strong")?.textContent).toBe("bold");
    expect(result.querySelector("ol, ul")).toBeTruthy();
    // Heading markdown should not remain raw markers.
    expect(result.textContent).not.toMatch(/^## Outcome/m);
    expect(result.textContent).toMatch(/Outcome/);
  });

  it("softens stale focus notice without embedding raw runId (lp-a8u.1)", () => {
    render(
      <SubagentRoster
        runs={runs}
        focus={{ kind: "subagent", runId: "call_missing_999" }}
        onSelectRun={vi.fn()}
        onShowRoster={vi.fn()}
      />,
    );

    const notice = screen.getByTestId("chat-subagent-stale-focus");
    expect(notice.textContent).toMatch(/no longer in this thread/i);
    expect(notice.textContent).not.toContain("call_missing_999");
    expect(screen.getByTestId("chat-subagent-roster").textContent).not.toContain(
      "call_missing_999",
    );
  });

  it("shows empty state when no runs", () => {
    render(
      <SubagentRoster
        runs={[]}
        focus={{ kind: "roster" }}
        onSelectRun={vi.fn()}
        onShowRoster={vi.fn()}
      />,
    );
    expect(screen.getByTestId("chat-subagent-roster-empty")).toBeTruthy();
  });

  it("shows empty-running nested tool placeholder when running without tools (lp-uxy.1)", () => {
    render(
      <SubagentRoster
        runs={runs}
        focus={{ kind: "subagent", runId: "sa-run" }}
        onSelectRun={vi.fn()}
        onShowRoster={vi.fn()}
        nestedTools={[]}
      />,
    );
    expect(
      screen.getByTestId("chat-subagent-nested-tools-empty-running"),
    ).toBeTruthy();
    expect(screen.queryByTestId("chat-subagent-nested-tool-stream")).toBeNull();
    // Legacy placeholder removed.
    expect(screen.queryByText(/Tool stream for this subagent will appear/i)).toBeNull();
  });

  it("shows live nested tool stream while subagent is running (lp-uxy.1)", () => {
    render(
      <SubagentRoster
        runs={runs}
        focus={{ kind: "subagent", runId: "sa-run" }}
        onSelectRun={vi.fn()}
        onShowRoster={vi.fn()}
        nestedTools={nestedRunning}
      />,
    );

    expect(screen.getByTestId("chat-subagent-nested-tools")).toBeTruthy();
    const stream = screen.getByTestId("chat-subagent-nested-tool-stream");
    expect(stream).toBeTruthy();
    expect(stream.textContent).toMatch(/read|Reading|ACL|access|search/i);
    expect(
      screen.queryByTestId("chat-subagent-nested-tools-empty-running"),
    ).toBeNull();
  });

  it("keeps completed nested tools visible after subagent finishes (lp-uxy.1)", () => {
    render(
      <SubagentRoster
        runs={runs}
        focus={{ kind: "subagent", runId: "sa-done" }}
        onSelectRun={vi.fn()}
        onShowRoster={vi.fn()}
        nestedTools={nestedComplete}
      />,
    );

    expect(screen.getByTestId("chat-subagent-nested-tool-stream")).toBeTruthy();
    expect(
      screen.getByTestId("chat-subagent-detail-status").textContent,
    ).toMatch(/done/i);
    // Completed nested write remains in the stream after terminal status.
    expect(
      screen.getByTestId("chat-subagent-nested-tool-stream").textContent,
    ).toMatch(/Writing a document|write_file|patch\.md/i);
    expect(
      screen.queryByTestId("chat-subagent-nested-tools-empty-complete"),
    ).toBeNull();
  });

  it("shows empty-complete copy when finished with no nested tools (lp-uxy.1)", () => {
    render(
      <SubagentRoster
        runs={runs}
        focus={{ kind: "subagent", runId: "sa-done" }}
        onSelectRun={vi.fn()}
        onShowRoster={vi.fn()}
        nestedTools={[]}
      />,
    );
    expect(
      screen.getByTestId("chat-subagent-nested-tools-empty-complete"),
    ).toBeTruthy();
  });

  it("renders host artifacts as soft-open chips (lp-uxy.2)", () => {
    const onOpenArtifact = vi.fn();
    const withArtifacts: SubagentRun[] = [
      {
        id: "sa-art",
        name: "coder",
        status: "done",
        color: "#10B981",
        icon: "code",
        artifacts: [
          {
            path: "/Notes/report.md",
            title: "report.md",
            kind: "vault",
          },
          {
            path: "https://example.com/spec",
            title: "spec",
            kind: "web",
          },
        ],
      },
    ];

    render(
      <SubagentRoster
        runs={withArtifacts}
        focus={{ kind: "subagent", runId: "sa-art" }}
        onSelectRun={vi.fn()}
        onShowRoster={vi.fn()}
        onOpenArtifact={onOpenArtifact}
      />,
    );

    expect(screen.getByTestId("chat-subagent-artifacts")).toBeTruthy();
    const vaultChip = screen.getByTestId("chat-subagent-artifact-vault-1");
    expect(vaultChip.getAttribute("data-artifact-path")).toBe(
      "/Notes/report.md",
    );
    fireEvent.click(vaultChip);
    expect(onOpenArtifact).toHaveBeenCalledWith("/Notes/report.md");

    // Web chip must not soft-open the vault pane.
    const webChip = screen.getByTestId("chat-subagent-artifact-web-2");
    expect(webChip.getAttribute("data-artifact-kind")).toBe("web");
    fireEvent.click(webChip);
    expect(onOpenArtifact).toHaveBeenCalledTimes(1);
  });

  it("harvests nested write targets into artifact chips when host omits artifacts[] (lp-uxy.2)", () => {
    const onOpenArtifact = vi.fn();
    render(
      <SubagentRoster
        runs={runs}
        focus={{ kind: "subagent", runId: "sa-done" }}
        onSelectRun={vi.fn()}
        onShowRoster={vi.fn()}
        nestedTools={nestedComplete}
        onOpenArtifact={onOpenArtifact}
      />,
    );

    const chip = screen.getByTestId("chat-subagent-artifact-vault-1");
    expect(chip.getAttribute("data-artifact-path")).toBe("/Notes/patch.md");
    fireEvent.click(chip);
    expect(onOpenArtifact).toHaveBeenCalledWith("/Notes/patch.md");
  });
});
