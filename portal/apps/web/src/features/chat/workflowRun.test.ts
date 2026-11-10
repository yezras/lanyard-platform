import { describe, expect, it } from "vitest";

import type { ChatEvent } from "../../api/types.js";

import type { SubagentRun } from "./subagentRun.js";
import {
  applyPeerActivityToWorkflowStages,
  applySubagentFallbackToWorkflow,
  attachSubagentToWorkflowStage,
  collectWorkflowRunsFromTimeline,
  defaultExpandedStageIds,
  deriveWorkflowStatusFromStages,
  formatWorkflowCardLabel,
  isWorkflowEvent,
  listFreeFloatingSubagents,
  mapWorkflowRunFromEvent,
  mapWorkflowRunFromToolCall,
  materializeStageSubagents,
  mergeWorkflowStages,
  nestAgentsOntoWorkflowStages,
  normalizeWorkflowStatus,
  parseWorkflowStages,
  readWorkflowIdFromEvent,
  resolveStageSubagents,
  resolveStageSubagentsWithFallback,
  unwrapWorkflowMetadata,
  type WorkflowRun,
  type WorkflowStage,
} from "./workflowRun.js";

describe("normalizeWorkflowStatus", () => {
  it("maps canonical and alias statuses", () => {
    expect(normalizeWorkflowStatus("pending")).toBe("pending");
    expect(normalizeWorkflowStatus("queued")).toBe("pending");
    expect(normalizeWorkflowStatus("running")).toBe("running");
    expect(normalizeWorkflowStatus("in_progress")).toBe("running");
    expect(normalizeWorkflowStatus("complete")).toBe("complete");
    expect(normalizeWorkflowStatus("done")).toBe("complete");
    expect(normalizeWorkflowStatus("failed")).toBe("error");
    expect(normalizeWorkflowStatus("error")).toBe("error");
    expect(normalizeWorkflowStatus("skipped")).toBe("skipped");
    expect(normalizeWorkflowStatus("skip")).toBe("skipped");
  });
});

describe("parseWorkflowStages / mergeWorkflowStages", () => {
  it("parses ordered stages with nested subagent ids", () => {
    const stages = parseWorkflowStages({
      stages: [
        {
          id: "discover",
          name: "Discover",
          status: "complete",
          duration: "2.1s",
          subagent_ids: ["sa-1"],
        },
        {
          id: "implement",
          name: "Implement",
          status: "running",
          subagents: [{ id: "sa-2" }],
        },
      ],
    });
    expect(stages).toHaveLength(2);
    expect(stages[0]).toMatchObject({
      id: "discover",
      status: "complete",
      duration: "2.1s",
      subagentIds: ["sa-1"],
    });
    expect(stages[1]?.subagentIds).toEqual(["sa-2"]);
  });

  it("parses stage summaries and nest ids from research-lite progress (lp-oop.38.25.1)", () => {
    const stages = parseWorkflowStages({
      stages: [
        {
          id: "plan",
          name: "Plan",
          status: "complete",
          summary: "Inspect vault layout first",
          subagent_ids: ["wf_1:plan"],
        },
        {
          id: "explore",
          name: "Explore",
          status: "complete",
          summary: "Packages under portal/",
          subagentIds: ["wf_1:explore-structure", "wf_1:explore-behavior"],
        },
        {
          id: "synthesize",
          name: "Synthesize",
          status: "complete",
          summary: "Cited brief for the parent",
        },
      ],
    });
    expect(stages.map((s) => s.summary)).toEqual([
      "Inspect vault layout first",
      "Packages under portal/",
      "Cited brief for the parent",
    ]);
    expect(stages[0]?.subagentIds).toEqual(["wf_1:plan"]);
    expect(stages[1]?.subagentIds).toEqual([
      "wf_1:explore-structure",
      "wf_1:explore-behavior",
    ]);
  });

  it("parses partial stage_* update envelope", () => {
    const stages = parseWorkflowStages({
      stage_id: "implement",
      stage_name: "Implement",
      stage_status: "complete",
      stage_duration: "4s",
    });
    expect(stages).toEqual([
      {
        id: "implement",
        name: "Implement",
        status: "complete",
        duration: "4s",
      },
    ]);
  });

  it("merges single-stage patches by id", () => {
    const existing: WorkflowStage[] = [
      { id: "a", name: "A", status: "complete", subagentIds: ["sa-1"] },
      { id: "b", name: "B", status: "running" },
    ];
    const merged = mergeWorkflowStages(existing, [
      {
        id: "b",
        name: "B",
        status: "complete",
        duration: "1s",
        subagentIds: ["sa-2"],
      },
    ]);
    expect(merged[0]?.subagentIds).toEqual(["sa-1"]);
    expect(merged[1]).toMatchObject({
      status: "complete",
      duration: "1s",
      subagentIds: ["sa-2"],
    });
  });

  it("parses stages nested in result JSON (lp-oop.38.21)", () => {
    const stages = parseWorkflowStages({
      result: JSON.stringify({
        workflow_id: "wf_1",
        workflow_name: "research-lite",
        workflow_status: "running",
        stages: [
          { id: "plan", name: "Plan", status: "complete" },
          { id: "explore", name: "Explore", status: "running" },
          { id: "synthesize", name: "Synthesize", status: "pending" },
        ],
      }),
    });
    expect(stages.map((s) => s.name)).toEqual([
      "Plan",
      "Explore",
      "Synthesize",
    ]);
    expect(stages[0]?.status).toBe("complete");
    expect(stages[1]?.status).toBe("running");
  });

  it("prefers first-class stages over nested result JSON", () => {
    const stages = parseWorkflowStages({
      stages: [{ id: "a", name: "A", status: "complete" }],
      result: JSON.stringify({
        stages: [{ id: "b", name: "B", status: "running" }],
      }),
    });
    expect(stages).toHaveLength(1);
    expect(stages[0]?.name).toBe("A");
  });

  it("replaces with full multi-stage snapshot", () => {
    const existing: WorkflowStage[] = [
      { id: "a", name: "A", status: "running" },
    ];
    const next = mergeWorkflowStages(existing, [
      { id: "a", name: "A", status: "complete" },
      { id: "b", name: "B", status: "running" },
    ]);
    expect(next).toHaveLength(2);
    expect(next[0]?.status).toBe("complete");
  });

  it("keeps reduced nest when a later snapshot omits subagent_ids/summary", () => {
    const existing: WorkflowStage[] = [
      {
        id: "plan",
        name: "Plan",
        status: "complete",
        summary: "Listing files",
        toolCallIds: ["tc-ls-1"],
        subagentIds: ["wf_1:plan"],
      },
      { id: "explore", name: "Explore", status: "running" },
    ];
    const next = mergeWorkflowStages(existing, [
      { id: "plan", name: "Plan", status: "complete" },
      { id: "explore", name: "Explore", status: "complete" },
      { id: "synthesize", name: "Synthesize", status: "complete" },
    ]);
    expect(next[0]).toMatchObject({
      status: "complete",
      summary: "Listing files",
      toolCallIds: ["tc-ls-1"],
      subagentIds: ["wf_1:plan"],
    });
    expect(next[1]?.status).toBe("complete");
    expect(next[2]?.id).toBe("synthesize");
  });

  it("maps result.agents onto stage nest and summaries (lp-oop.38.25.1)", () => {
    const stages = parseWorkflowStages({
      workflow_id: "wf_1",
      stages: [
        { id: "plan", name: "Plan", status: "complete" },
        { id: "explore", name: "Explore", status: "complete" },
        { id: "synthesize", name: "Synthesize", status: "complete" },
      ],
      agents: [
        {
          id: "wf_1:plan",
          label: "plan",
          status: "completed",
          summary: "Inspect vault layout first",
          phase: "plan",
        },
        {
          label: "explore-structure",
          status: "completed",
          summary: "Packages under portal/",
          phase: "explore",
        },
        {
          label: "explore-behavior",
          status: "completed",
          phase: "explore",
        },
        {
          label: "synthesize",
          status: "completed",
          summary: "Cited brief for the parent",
          phase: "synthesize",
        },
      ],
    });
    expect(stages[0]).toMatchObject({
      subagentIds: ["wf_1:plan"],
      summary: "Inspect vault layout first",
    });
    expect(stages[1]?.subagentIds).toEqual([
      "wf_1:explore-structure",
      "wf_1:explore-behavior",
    ]);
    expect(stages[1]?.summary).toBe("Packages under portal/");
    expect(stages[2]).toMatchObject({
      subagentIds: ["wf_1:synthesize"],
      summary: "Cited brief for the parent",
    });
  });
});

describe("applyPeerActivityToWorkflowStages / materializeStageSubagents", () => {
  it("attaches sibling tools to the running stage and fills a summary", () => {
    const stages: WorkflowStage[] = [
      { id: "plan", name: "Plan", status: "running" },
      { id: "explore", name: "Explore", status: "pending" },
    ];
    const afterLs = applyPeerActivityToWorkflowStages(stages, {
      key: "tc-ls",
      name: "Listing files",
    });
    const afterGrep = applyPeerActivityToWorkflowStages(afterLs, {
      key: "tc-grep",
      name: "Searching files",
    });
    expect(afterGrep[0]).toMatchObject({
      toolCallIds: ["tc-ls", "tc-grep"],
      summary: "Listing files · Searching files",
    });
    expect(afterGrep[1]?.toolCallIds).toBeUndefined();
    expect(
      applyPeerActivityToWorkflowStages(afterGrep, {
        key: "tc-ls",
        name: "Listing files",
      })[0]?.toolCallIds,
    ).toEqual(["tc-ls", "tc-grep"]);
  });

  it("does not invent nest when no peer activity ran", () => {
    const stages: WorkflowStage[] = [
      { id: "plan", name: "Plan", status: "complete" },
    ];
    expect(
      nestAgentsOntoWorkflowStages(stages, [], "wf_1")[0]?.subagentIds,
    ).toBeUndefined();
    expect(
      applyPeerActivityToWorkflowStages(stages, { key: "", name: "noop" })[0]
        ?.summary,
    ).toBeUndefined();
  });

  it("materializes helper name/status from unresolved subagent ids", () => {
    const stages: WorkflowStage[] = [
      {
        id: "plan",
        name: "Plan",
        status: "complete",
        subagentIds: ["wf_1:plan"],
        summary: "Inspect vault layout first",
      },
    ];
    const nested = materializeStageSubagents(stages[0]!, stages, []);
    expect(nested).toHaveLength(1);
    expect(nested[0]).toMatchObject({
      id: "wf_1:plan",
      name: "plan",
      status: "done",
    });
  });
});

describe("isWorkflowEvent / mapWorkflowRunFromEvent", () => {
  it("detects portal_event workflow_progress", () => {
    const event: ChatEvent = {
      type: "tool_progress",
      chat_id: "c1",
      metadata: {
        portal_event: "workflow_progress",
        workflow_id: "wf-1",
        workflow_name: "Onboard",
        workflow_status: "running",
        stages: [
          { id: "s1", name: "Discover", status: "complete", duration: "1s" },
          { id: "s2", name: "Implement", status: "running" },
        ],
      },
    };
    expect(isWorkflowEvent(event)).toBe(true);
    const run = mapWorkflowRunFromEvent(event);
    expect(run).toMatchObject({
      id: "wf-1",
      name: "Onboard",
      status: "running",
    });
    expect(run?.stages).toHaveLength(2);
    expect(formatWorkflowCardLabel(run!)).toMatch(/Onboard · running · 1\/2/);
  });

  it("detects tool_kind workflow", () => {
    const event: ChatEvent = {
      type: "tool_progress",
      chat_id: "c1",
      tool_call_id: "wf-2",
      tool_kind: "workflow",
      tool_name: "Review",
      tool_status: "complete",
      metadata: {
        stages: [{ id: "done", name: "Done", status: "complete" }],
      },
    };
    expect(isWorkflowEvent(event)).toBe(true);
    expect(mapWorkflowRunFromEvent(event)?.status).toBe("complete");
  });

  it("does not treat plain subagent as workflow", () => {
    const event: ChatEvent = {
      type: "tool_progress",
      chat_id: "c1",
      tool_kind: "subagent",
      subagent_name: "Explore",
      metadata: { portal_event: "subagent" },
    };
    expect(isWorkflowEvent(event)).toBe(false);
  });

  it("maps nested result JSON onto workflow_id and stages (lp-oop.38.21)", () => {
    const snapshot = {
      workflow_id: "wf_03e3",
      workflow_name: "research-lite",
      workflow_status: "running",
      stages: [
        { id: "plan", name: "Plan", status: "complete" },
        { id: "explore", name: "Explore", status: "running" },
        { id: "synthesize", name: "Synthesize", status: "pending" },
      ],
    };
    const event: ChatEvent = {
      type: "tool_progress",
      chat_id: "c1",
      tool_name: "workflow",
      tool_call_id: "wf_03e3",
      tool_kind: "workflow",
      tool_label: "research-lite",
      result: JSON.stringify(snapshot),
      metadata: {
        portal_event: "workflow_progress",
        tool_name: "workflow",
        tool_call_id: "wf_03e3",
        status: "running",
        tool_kind: "workflow",
        result: JSON.stringify(snapshot),
      },
    };
    expect(readWorkflowIdFromEvent(event)).toBe("wf_03e3");
    const run = mapWorkflowRunFromEvent(event);
    expect(run).toMatchObject({
      id: "wf_03e3",
      name: "research-lite",
      status: "running",
    });
    expect(run?.stages.map((s) => s.name)).toEqual([
      "Plan",
      "Explore",
      "Synthesize",
    ]);
  });

  it("lifts workflow_id from launch result run.run_id", () => {
    const event: ChatEvent = {
      type: "tool_progress",
      chat_id: "c1",
      tool_name: "workflow",
      tool_call_id: "call-abc",
      tool_kind: "workflow",
      tool_label: "research-lite",
      tool_status: "complete",
      metadata: {
        portal_event: "workflow_progress",
        status: "completed",
        result: JSON.stringify({
          action: "launch",
          success: true,
          run: {
            run_id: "wf_03e3",
            display_name: "research-lite",
            status: "running",
          },
        }),
      },
    };
    expect(readWorkflowIdFromEvent(event)).toBe("wf_03e3");
    expect(unwrapWorkflowMetadata(event.metadata)?.workflow_status).toBe(
      "running",
    );
    expect(mapWorkflowRunFromEvent(event)?.status).toBe("running");
    expect(mapWorkflowRunFromEvent(event)?.name).toBe("research-lite");
  });

  it("uses tool_label instead of generic tool_name workflow", () => {
    const event: ChatEvent = {
      type: "tool_progress",
      chat_id: "c1",
      tool_name: "workflow",
      tool_call_id: "call-abc",
      tool_kind: "workflow",
      tool_label: "research-lite",
      metadata: {
        portal_event: "workflow_progress",
        tool_kind: "workflow",
      },
    };
    expect(mapWorkflowRunFromEvent(event)?.name).toBe("research-lite");
  });

  it("merges partial stage update onto existing run", () => {
    const existing: WorkflowRun = {
      id: "wf-1",
      name: "Onboard",
      status: "running",
      stages: [
        { id: "s1", name: "Discover", status: "complete" },
        { id: "s2", name: "Implement", status: "running" },
      ],
    };
    const event: ChatEvent = {
      type: "tool_progress",
      chat_id: "c1",
      metadata: {
        portal_event: "workflow_progress",
        workflow_id: "wf-1",
        stage_id: "s2",
        stage_name: "Implement",
        stage_status: "complete",
        stage_duration: "3s",
      },
    };
    const run = mapWorkflowRunFromEvent(event, { existing });
    expect(run?.stages[1]).toMatchObject({
      status: "complete",
      duration: "3s",
    });
  });
});

describe("deriveWorkflowStatusFromStages / defaultExpandedStageIds", () => {
  it("derives overall status from stages", () => {
    expect(
      deriveWorkflowStatusFromStages([
        { id: "a", name: "A", status: "complete" },
        { id: "b", name: "B", status: "error" },
      ]),
    ).toBe("error");
    expect(
      deriveWorkflowStatusFromStages([
        { id: "a", name: "A", status: "complete" },
        { id: "b", name: "B", status: "running" },
      ]),
    ).toBe("running");
    expect(
      deriveWorkflowStatusFromStages([
        { id: "a", name: "A", status: "complete" },
        { id: "b", name: "B", status: "skipped" },
      ]),
    ).toBe("complete");
  });

  it("expands running stages by default", () => {
    const run: WorkflowRun = {
      id: "wf",
      name: "W",
      status: "running",
      stages: [
        { id: "a", name: "A", status: "complete" },
        { id: "b", name: "B", status: "running" },
        { id: "c", name: "C", status: "pending" },
      ],
    };
    expect(defaultExpandedStageIds(run)).toEqual(["b"]);
  });
});

describe("mapWorkflowRunFromToolCall / collectWorkflowRunsFromTimeline", () => {
  it("maps timeline calls and collects active first", () => {
    const runs = collectWorkflowRunsFromTimeline([
      {
        type: "assistant_turn",
        toolCalls: [
          {
            key: "wf-done",
            name: "Old",
            status: "complete",
            kind: "workflow",
            workflowStatus: "complete",
            workflowStages: [{ id: "s", name: "S", status: "complete" }],
          },
          {
            key: "wf-run",
            name: "Live",
            status: "running",
            kind: "workflow",
            workflowStatus: "running",
            workflowStages: [
              { id: "s1", name: "S1", status: "running", subagentIds: ["sa-1"] },
            ],
          },
          {
            key: "sa-1",
            name: "Explore",
            status: "running",
            kind: "subagent",
          },
        ],
      },
    ]);
    expect(runs.map((r) => r.id)).toEqual(["wf-run", "wf-done"]);
    
    expect(runs[0]?.stages[0]?.subagentIds).toEqual(["sa-1"]);
  });

  it("attachSubagentToWorkflowStage appends without dupes", () => {
    const run: WorkflowRun = {
      id: "wf",
      name: "W",
      status: "running",
      stages: [{ id: "s1", name: "S1", status: "running", subagentIds: ["a"] }],
    };
    const next = attachSubagentToWorkflowStage(run, "s1", "b");
    expect(next.stages[0]?.subagentIds).toEqual(["a", "b"]);
    expect(attachSubagentToWorkflowStage(next, "s1", "a").stages[0]?.subagentIds).toEqual([
      "a",
      "b",
    ]);
  });
});

const freeFloatingRoster: SubagentRun[] = [
  {
    id: "sa-host",
    name: "HostLinked",
    status: "running",
    color: "#3B82F6",
    icon: "explore",
  },
  {
    id: "sa-free",
    name: "FreeFloating",
    status: "running",
    color: "#10B981",
    icon: "code",
  },
  {
    id: "sa-done",
    name: "Done",
    status: "done",
    color: "#6B7280",
    icon: "default",
  },
  {
    id: "sa-needs",
    name: "NeedsInput",
    status: "needs_input",
    color: "#F59E0B",
    icon: "write",
    parentToolCallId: "wf-1",
  },
];

describe("resolveStageSubagentsWithFallback (lp-a8u.5)", () => {
  it("host subagent_ids win — no free-floaters mixed in", () => {
    const stages: WorkflowStage[] = [
      {
        id: "implement",
        name: "Implement",
        status: "running",
        subagentIds: ["sa-host"],
      },
    ];
    const nested = resolveStageSubagentsWithFallback(
      stages[0]!,
      stages,
      freeFloatingRoster,
      { workflowId: "wf-1" },
    );
    expect(nested.map((r) => r.id)).toEqual(["sa-host"]);
    // Same as pure host resolve
    expect(resolveStageSubagents(stages[0]!, freeFloatingRoster).map((r) => r.id)).toEqual(
      ["sa-host"],
    );
  });

  it("falls back to free-floating active runs when host nest is empty on running stage", () => {
    const stages: WorkflowStage[] = [
      { id: "discover", name: "Discover", status: "complete" },
      { id: "implement", name: "Implement", status: "running" },
    ];
    const nested = resolveStageSubagentsWithFallback(
      stages[1]!,
      stages,
      freeFloatingRoster,
    );
    // Active free-floaters only (running / needs_input); done excluded
    expect(nested.map((r) => r.id).sort()).toEqual(
      ["sa-free", "sa-host", "sa-needs"].sort(),
    );
  });

  it("does not attach free-floaters already claimed by another stage", () => {
    const stages: WorkflowStage[] = [
      {
        id: "discover",
        name: "Discover",
        status: "complete",
        subagentIds: ["sa-host"],
      },
      { id: "implement", name: "Implement", status: "running" },
    ];
    const nested = resolveStageSubagentsWithFallback(
      stages[1]!,
      stages,
      freeFloatingRoster,
    );
    expect(nested.map((r) => r.id).sort()).toEqual(
      ["sa-free", "sa-needs"].sort(),
    );
    expect(nested.some((r) => r.id === "sa-host")).toBe(false);
  });

  it("does not fall back for non-running stages", () => {
    const stages: WorkflowStage[] = [
      { id: "pending", name: "Pending", status: "pending" },
      { id: "done", name: "Done", status: "complete" },
    ];
    expect(
      resolveStageSubagentsWithFallback(stages[0]!, stages, freeFloatingRoster),
    ).toEqual([]);
    expect(
      resolveStageSubagentsWithFallback(stages[1]!, stages, freeFloatingRoster),
    ).toEqual([]);
  });

  it("does not invent subagents when roster is empty", () => {
    const stages: WorkflowStage[] = [
      { id: "implement", name: "Implement", status: "running" },
    ];
    expect(
      resolveStageSubagentsWithFallback(stages[0]!, stages, []),
    ).toEqual([]);
    expect(listFreeFloatingSubagents(stages, [])).toEqual([]);
  });

  it("prefers parentToolCallId-linked free-floaters when workflowId matches", () => {
    const stages: WorkflowStage[] = [
      { id: "implement", name: "Implement", status: "running" },
    ];
    const nested = resolveStageSubagentsWithFallback(
      stages[0]!,
      stages,
      freeFloatingRoster,
      { workflowId: "wf-1" },
    );
    // Only sa-needs has parentToolCallId === wf-1
    expect(nested.map((r) => r.id)).toEqual(["sa-needs"]);
  });

  it("attaches free-floaters only to the first empty running stage", () => {
    const stages: WorkflowStage[] = [
      { id: "a", name: "A", status: "running" },
      { id: "b", name: "B", status: "running" },
    ];
    const onA = resolveStageSubagentsWithFallback(
      stages[0]!,
      stages,
      freeFloatingRoster,
    );
    const onB = resolveStageSubagentsWithFallback(
      stages[1]!,
      stages,
      freeFloatingRoster,
    );
    expect(onA.length).toBeGreaterThan(0);
    expect(onB).toEqual([]);
  });

  it("applySubagentFallbackToWorkflow uses attachSubagentToWorkflowStage", () => {
    const run: WorkflowRun = {
      id: "wf-1",
      name: "Onboard",
      status: "running",
      stages: [
        { id: "discover", name: "Discover", status: "complete", subagentIds: ["sa-host"] },
        { id: "implement", name: "Implement", status: "running" },
      ],
    };
    const next = applySubagentFallbackToWorkflow(run, freeFloatingRoster);
    // Host stage unchanged
    expect(next.stages[0]?.subagentIds).toEqual(["sa-host"]);
    // Linked free-floater preferred via workflowId
    expect(next.stages[1]?.subagentIds).toEqual(["sa-needs"]);
    // Original run not mutated
    expect(run.stages[1]?.subagentIds).toBeUndefined();
  });
});
