/**
 * Unit tests for SubagentRun domain + identity (lp-dpr.5).
 */
import { describe, expect, it } from "vitest";

import {
  applySubagentParentCompletion,
  chatToolStatusFromSubagentTerminal,
  citationsFromSubagentArtifacts,
  collectNestedToolsForSubagent,
  collectSubagentRunsFromTimeline,
  extractSafeVaultPathsFromToolResult,
  formatSubagentChipLabel,
  formatSubagentElapsed,
  harvestArtifactsFromNestedTools,
  isNestedToolUnderSubagent,
  isSafeVaultArtifactPath,
  isSubagentEvent,
  isSubagentSpawnOrWaitToolName,
  isTerminalSubagentStatus,
  mapSubagentRunFromEvent,
  mapSubagentRunFromToolCall,
  mergeSubagentArtifacts,
  normalizeSubagentStatus,
  parseSubagentArtifacts,
  resolveSubagentArtifacts,
  subagentColor,
  subagentIconKey,
  subagentStatusFromToolStatus,
  subagentStatusLabel,
  type SubagentLinkedToolCall,
} from "./subagentRun.js";

describe("normalizeSubagentStatus", () => {
  it("maps product + host aliases", () => {
    expect(normalizeSubagentStatus("running")).toBe("running");
    expect(normalizeSubagentStatus("in_progress")).toBe("running");
    expect(normalizeSubagentStatus("pending")).toBe("running");
    expect(normalizeSubagentStatus("needs_input")).toBe("needs_input");
    expect(normalizeSubagentStatus("waiting_for_user")).toBe("needs_input");
    expect(normalizeSubagentStatus("done")).toBe("done");
    expect(normalizeSubagentStatus("complete")).toBe("done");
    expect(normalizeSubagentStatus("failed")).toBe("failed");
    expect(normalizeSubagentStatus("error")).toBe("failed");
    expect(normalizeSubagentStatus("cancelled")).toBe("failed");
  });

  it("falls back for unknown values", () => {
    expect(normalizeSubagentStatus("maybe")).toBe("running");
    expect(normalizeSubagentStatus(null)).toBe("running");
  });
});

describe("subagent identity", () => {
  it("returns stable colors for the same name", () => {
    const a = subagentColor("Explore");
    const b = subagentColor("explore");
    const c = subagentColor("Explore");
    expect(a).toBe(c);
    // case-normalized
    expect(a).toBe(b);
    expect(a).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("picks distinct icons by name heuristics", () => {
    expect(subagentIconKey("Explore")).toBe("explore");
    expect(subagentIconKey("Researcher")).toBe("research");
    expect(subagentIconKey("coder")).toBe("code");
    expect(subagentIconKey("Writer")).toBe("write");
    expect(subagentIconKey("TestRunner")).toBe("test");
    expect(subagentIconKey("Architect")).toBe("plan");
    expect(subagentIconKey("Helper")).toBe("default");
  });

  it("prefers kind hint over ambiguous name", () => {
    expect(subagentIconKey("Worker", "explore")).toBe("explore");
  });
});

describe("isSubagentEvent / mapSubagentRunFromEvent", () => {
  it("detects tool_kind, portal_event, and subagent_name", () => {
    expect(
      isSubagentEvent({
        type: "tool_progress",
        chat_id: "c",
        tool_kind: "subagent",
      }),
    ).toBe(true);
    expect(
      isSubagentEvent({
        type: "tool_progress",
        chat_id: "c",
        subagent_name: "Explore",
      }),
    ).toBe(true);
    expect(
      isSubagentEvent({
        type: "tool_progress",
        chat_id: "c",
        metadata: { portal_event: "subagent" },
      }),
    ).toBe(true);
    expect(
      isSubagentEvent({
        type: "tool_progress",
        chat_id: "c",
        tool_name: "read_file",
      }),
    ).toBe(false);
  });

  it("maps a full subagent run with identity", () => {
    const run = mapSubagentRunFromEvent({
      type: "tool_progress",
      chat_id: "c1",
      tool_kind: "subagent",
      subagent_name: "Explore",
      tool_call_id: "sa-42",
      tool_status: "running",
      tool_target: "Scan vault policies",
      created_at: "2026-07-29T12:00:00.000Z",
      metadata: {
        portal_event: "subagent",
        parent_tool_call_id: "parent-1",
      },
    });
    expect(run).toMatchObject({
      id: "sa-42",
      name: "Explore",
      status: "running",
      icon: "explore",
      summary: "Scan vault policies",
      parentToolCallId: "parent-1",
      startedAt: "2026-07-29T12:00:00.000Z",
    });
    expect(run?.color).toBe(subagentColor("Explore"));
  });

  it("maps needs_input and failed terminals", () => {
    expect(
      mapSubagentRunFromEvent({
        type: "tool_progress",
        chat_id: "c",
        tool_kind: "subagent",
        subagent_name: "coder",
        tool_call_id: "x",
        tool_status: "needs_input",
      })?.status,
    ).toBe("needs_input");

    expect(
      mapSubagentRunFromEvent({
        type: "tool_progress",
        chat_id: "c",
        tool_kind: "subagent",
        subagent_name: "coder",
        tool_call_id: "y",
        tool_status: "error",
      })?.status,
    ).toBe("failed");
  });

  it("returns null for generic tools", () => {
    expect(
      mapSubagentRunFromEvent({
        type: "tool_progress",
        chat_id: "c",
        tool_name: "bash",
        tool_status: "running",
      }),
    ).toBeNull();
  });
});

describe("chip labels + elapsed", () => {
  it("formats Explore · running 0:42 style", () => {
    const run = {
      id: "1",
      name: "Explore",
      status: "running" as const,
      color: "#3B82F6",
      icon: "explore" as const,
      startedAt: "2026-07-29T12:00:00.000Z",
    };
    const now = Date.parse("2026-07-29T12:00:42.000Z");
    expect(formatSubagentChipLabel(run, now)).toBe("Explore · running 0:42");
    expect(formatSubagentElapsed(run, now)).toBe("0:42");
  });

  it("prefers host duration when present", () => {
    const run = {
      id: "1",
      name: "coder",
      status: "done" as const,
      color: "#000",
      icon: "code" as const,
      duration: "4.1s",
    };
    expect(formatSubagentChipLabel(run)).toBe("coder · done 4.1s");
  });

  it("labels needs_input without requiring elapsed", () => {
    expect(
      formatSubagentChipLabel({
        id: "1",
        name: "Writer",
        status: "needs_input",
        color: "#000",
        icon: "write",
      }),
    ).toBe("Writer · needs input");
  });
});

describe("mapSubagentRunFromToolCall / collectSubagentRunsFromTimeline", () => {
  it("maps only kind=subagent tool calls", () => {
    expect(
      mapSubagentRunFromToolCall({
        key: "t1",
        name: "read_file",
        status: "complete",
        kind: "tool",
      }),
    ).toBeNull();

    expect(
      mapSubagentRunFromToolCall({
        key: "sa-1",
        name: "Researcher",
        target: "Find APIs",
        status: "running",
        kind: "subagent",
        subagentColor: "#111111",
        subagentIcon: "research",
      }),
    ).toMatchObject({
      id: "sa-1",
      name: "Researcher",
      status: "running",
      color: "#111111",
      icon: "research",
      summary: "Find APIs",
    });
  });

  it("collects concurrent runs with active-first order", () => {
    const runs = collectSubagentRunsFromTimeline([
      {
        type: "assistant_turn",
        toolCalls: [
          {
            key: "sa-done",
            name: "Explore",
            status: "complete",
            kind: "subagent",
            duration: "1s",
          },
          {
            key: "sa-run",
            name: "coder",
            status: "running",
            kind: "subagent",
          },
          {
            key: "tool-1",
            name: "bash",
            status: "complete",
          },
          {
            key: "sa-input",
            name: "Writer",
            status: "running",
            kind: "subagent",
            // needs_input only via event path; tool status stays running here
          },
        ],
      },
    ]);
    expect(runs.map((r) => r.id)).toEqual(["sa-run", "sa-input", "sa-done"]);
    expect(runs.every((r) => r.color && r.icon)).toBe(true);
  });

  it("maps tool status bridge", () => {
    expect(subagentStatusFromToolStatus("complete")).toBe("done");
    expect(subagentStatusFromToolStatus("error")).toBe("failed");
    expect(subagentStatusFromToolStatus("running")).toBe("running");
    expect(subagentStatusLabel("needs_input")).toBe("needs input");
  });
});

describe("linked lifecycle: subagent complete → parent tool (lp-dpr.6)", () => {
  it("classifies spawn/wait tool names", () => {
    expect(isSubagentSpawnOrWaitToolName("Task")).toBe(true);
    expect(isSubagentSpawnOrWaitToolName("spawn_subagent")).toBe(true);
    expect(isSubagentSpawnOrWaitToolName("wait_for_agent")).toBe(true);
    expect(isSubagentSpawnOrWaitToolName("read_file")).toBe(false);
  });

  it("maps terminal subagent statuses onto ChatToolCallStatus", () => {
    expect(isTerminalSubagentStatus("done")).toBe(true);
    expect(isTerminalSubagentStatus("failed")).toBe(true);
    expect(isTerminalSubagentStatus("running")).toBe(false);
    expect(isTerminalSubagentStatus("needs_input")).toBe(false);
    expect(chatToolStatusFromSubagentTerminal("done")).toBe("complete");
    expect(chatToolStatusFromSubagentTerminal("failed")).toBe("error");
    expect(chatToolStatusFromSubagentTerminal("running")).toBeNull();
  });

  it("flips parent spawn/wait tool to complete + duration when child is done", () => {
    const calls: SubagentLinkedToolCall[] = [
      {
        key: "parent-1",
        name: "Task",
        status: "running",
      },
      {
        key: "sa-1",
        name: "Explore",
        status: "complete",
        kind: "subagent",
        subagentStatus: "done",
        parentToolCallId: "parent-1",
        duration: "4.1s",
        result: "found 3 files",
      },
    ];
    const next = applySubagentParentCompletion(calls);
    expect(next[0]).toMatchObject({
      key: "parent-1",
      name: "Task",
      status: "complete",
      duration: "4.1s",
      result: "found 3 files",
    });
    // Child unchanged.
    expect(next[1]).toEqual(calls[1]);
  });

  it("flips parent to error when child fails", () => {
    const calls: SubagentLinkedToolCall[] = [
      {
        key: "wait-1",
        name: "wait_for_subagent",
        status: "pending",
      },
      {
        key: "sa-err",
        name: "coder",
        status: "error",
        kind: "subagent",
        subagentStatus: "failed",
        parentToolCallId: "wait-1",
        duration: "1.2s",
        errorMessage: "patch rejected",
      },
    ];
    const next = applySubagentParentCompletion(calls);
    expect(next[0]).toMatchObject({
      key: "wait-1",
      status: "error",
      duration: "1.2s",
      errorMessage: "patch rejected",
    });
  });

  it("does not flip parent while any sibling child is still running", () => {
    const calls: SubagentLinkedToolCall[] = [
      { key: "parent-1", name: "spawn_agent", status: "running" },
      {
        key: "sa-done",
        name: "Explore",
        status: "complete",
        kind: "subagent",
        subagentStatus: "done",
        parentToolCallId: "parent-1",
        duration: "2s",
      },
      {
        key: "sa-run",
        name: "coder",
        status: "running",
        kind: "subagent",
        subagentStatus: "running",
        parentToolCallId: "parent-1",
      },
    ];
    const next = applySubagentParentCompletion(calls);
    expect(next[0]?.status).toBe("running");
    expect(next[0]?.duration).toBeUndefined();
  });

  it("completes parent only after all children terminal; any failure → error", () => {
    const calls: SubagentLinkedToolCall[] = [
      { key: "parent-1", name: "Task", status: "running" },
      {
        key: "sa-a",
        name: "Explore",
        status: "complete",
        kind: "subagent",
        subagentStatus: "done",
        parentToolCallId: "parent-1",
        duration: "1s",
      },
      {
        key: "sa-b",
        name: "coder",
        status: "error",
        kind: "subagent",
        subagentStatus: "failed",
        parentToolCallId: "parent-1",
        duration: "3s",
        errorMessage: "boom",
      },
    ];
    const next = applySubagentParentCompletion(calls);
    expect(next[0]).toMatchObject({
      key: "parent-1",
      status: "error",
      duration: "3s",
      errorMessage: "boom",
    });
  });

  it("is a no-op without parentToolCallId link", () => {
    const calls: SubagentLinkedToolCall[] = [
      { key: "parent-1", name: "Task", status: "running" },
      {
        key: "sa-1",
        name: "Explore",
        status: "complete",
        kind: "subagent",
        subagentStatus: "done",
        duration: "1s",
      },
    ];
    expect(applySubagentParentCompletion(calls)).toBe(calls);
  });

  it("fills missing duration on already-terminal parent without rewriting status", () => {
    const calls: SubagentLinkedToolCall[] = [
      {
        key: "parent-1",
        name: "Task",
        status: "complete",
      },
      {
        key: "sa-1",
        name: "Explore",
        status: "complete",
        kind: "subagent",
        subagentStatus: "done",
        parentToolCallId: "parent-1",
        duration: "9s",
      },
    ];
    const next = applySubagentParentCompletion(calls);
    expect(next[0]).toMatchObject({
      status: "complete",
      duration: "9s",
    });
  });

  it("updates parent subagentStatus when parent is also kind=subagent", () => {
    const calls: SubagentLinkedToolCall[] = [
      {
        key: "outer",
        name: "Orchestrator",
        status: "running",
        kind: "subagent",
        subagentStatus: "running",
      },
      {
        key: "inner",
        name: "Explore",
        status: "complete",
        kind: "subagent",
        subagentStatus: "done",
        parentToolCallId: "outer",
        duration: "2s",
      },
    ];
    const next = applySubagentParentCompletion(calls);
    expect(next[0]).toMatchObject({
      key: "outer",
      status: "complete",
      subagentStatus: "done",
      duration: "2s",
    });
  });
});

describe("collectNestedToolsForSubagent (lp-uxy.1)", () => {
  it("matches only tools attributed to the parent subagent run", () => {
    expect(
      isNestedToolUnderSubagent(
        { key: "tc-1", parentSubagentId: "sa-1" },
        "sa-1",
      ),
    ).toBe(true);
    expect(
      isNestedToolUnderSubagent(
        { key: "tc-1", parentSubagentId: "sa-other" },
        "sa-1",
      ),
    ).toBe(false);
    expect(isNestedToolUnderSubagent({ key: "tc-1" }, "sa-1")).toBe(false);
    expect(
      isNestedToolUnderSubagent(
        { key: "sa-1", kind: "subagent", parentSubagentId: "sa-1" },
        "sa-1",
      ),
    ).toBe(false);
  });

  it("collects ordered nested tools and ignores unattributed peers", () => {
    const nested = collectNestedToolsForSubagent(
      [
        {
          type: "assistant_turn",
          toolCalls: [
            {
              key: "sa-1",
              name: "Explore",
              status: "running",
              kind: "subagent",
            },
            {
              key: "tc-a",
              name: "read_file",
              status: "complete",
              parentSubagentId: "sa-1",
              duration: "0.3s",
            },
            {
              key: "tc-noise",
              name: "bash",
              status: "complete",
              // no parentSubagentId
            },
            {
              key: "tc-b",
              name: "vault_search",
              status: "running",
              parentSubagentId: "sa-1",
            },
            {
              key: "tc-other",
              name: "write_file",
              status: "complete",
              parentSubagentId: "sa-other",
            },
          ],
        },
      ],
      "sa-1",
    );
    expect(nested.map((t) => t.key)).toEqual(["tc-a", "tc-b"]);
    expect(nested[0]?.duration).toBe("0.3s");
  });

  it("upserts by key when the same nested tool progresses", () => {
    const nested = collectNestedToolsForSubagent(
      [
        {
          type: "assistant_turn",
          segments: [
            {
              kind: "tool",
              call: {
                key: "tc-1",
                name: "read_file",
                status: "running",
                parentSubagentId: "sa-1",
              },
            },
            {
              kind: "tool",
              call: {
                key: "tc-1",
                name: "read_file",
                status: "complete",
                duration: "1.1s",
                parentSubagentId: "sa-1",
                result: "body",
              },
            },
          ],
        },
      ],
      "sa-1",
    );
    expect(nested).toHaveLength(1);
    expect(nested[0]).toMatchObject({
      key: "tc-1",
      status: "complete",
      duration: "1.1s",
      result: "body",
    });
  });
});

describe("subagent artifacts (lp-uxy.2)", () => {
  it("parseSubagentArtifacts accepts vault_path / path / url shapes", () => {
    const parsed = parseSubagentArtifacts([
      { vault_path: "/Notes/a.md", title: "a.md", kind: "vault" },
      { path: "/Notes/b.md" },
      { url: "https://example.com/x", title: "X", kind: "web" },
      "/Notes/c.md",
      { vault_path: "../escape.md" }, // rejected
      { path: "rm -rf /" }, // rejected
      null,
    ]);
    expect(parsed).toEqual([
      { path: "/Notes/a.md", title: "a.md", kind: "vault" },
      { path: "/Notes/b.md", title: "b.md", kind: "vault" },
      { path: "https://example.com/x", title: "X", kind: "web" },
      { path: "/Notes/c.md", title: "c.md", kind: "vault" },
    ]);
  });

  it("mapSubagentRunFromEvent reads metadata.artifacts", () => {
    const run = mapSubagentRunFromEvent({
      type: "tool_progress",
      chat_id: "c",
      tool_kind: "subagent",
      tool_call_id: "sa-1",
      subagent_name: "coder",
      tool_status: "complete",
      metadata: {
        portal_event: "subagent",
        artifacts: [
          { vault_path: "/Notes/report.md", title: "report.md", kind: "vault" },
        ],
      },
    });
    expect(run?.artifacts).toEqual([
      { path: "/Notes/report.md", title: "report.md", kind: "vault" },
    ]);
  });

  it("mapSubagentRunFromToolCall preserves artifacts for history reload", () => {
    const run = mapSubagentRunFromToolCall({
      key: "sa-1",
      name: "coder",
      status: "complete",
      kind: "subagent",
      subagentStatus: "done",
      artifacts: [
        { path: "/Notes/report.md", title: "report.md", kind: "vault" },
      ],
    });
    expect(run?.artifacts?.[0]?.path).toBe("/Notes/report.md");
  });

  it("harvests nested write targets and safe result paths", () => {
    const harvested = harvestArtifactsFromNestedTools([
      {
        name: "write_file",
        target: "/Notes/from-target.md",
        status: "complete",
      },
      {
        name: "write_file",
        status: "complete",
        result: "Wrote /Notes/from-result.md successfully",
      },
      {
        name: "bash",
        target: "echo hi",
        status: "complete",
        result: "noise /Notes/should-not.md",
      },
      {
        name: "write_file",
        target: "/Notes/failed.md",
        status: "error",
      },
    ]);
    expect(harvested.map((a) => a.path)).toEqual([
      "/Notes/from-target.md",
      "/Notes/from-result.md",
    ]);
  });

  it("resolveSubagentArtifacts prefers host order and fills nested gaps", () => {
    const resolved = resolveSubagentArtifacts(
      [{ path: "/Notes/host.md", kind: "vault", title: "host.md" }],
      [
        {
          name: "write_file",
          target: "/Notes/host.md",
          status: "complete",
        },
        {
          name: "write_file",
          target: "/Notes/nested.md",
          status: "complete",
        },
      ],
    );
    expect(resolved.map((a) => a.path)).toEqual([
      "/Notes/host.md",
      "/Notes/nested.md",
    ]);
  });

  it("extractSafeVaultPathsFromToolResult ignores traversal and huge dumps", () => {
    expect(
      extractSafeVaultPathsFromToolResult("Saved /Projects/A/notes.md ok"),
    ).toEqual(["/Projects/A/notes.md"]);
    expect(extractSafeVaultPathsFromToolResult("see /tmp/../etc/passwd")).toEqual(
      [],
    );
    expect(isSafeVaultArtifactPath("/ok/file.md")).toBe(true);
    expect(isSafeVaultArtifactPath("../x.md")).toBe(false);
  });

  it("citationsFromSubagentArtifacts keeps web URLs distinct from vault", () => {
    expect(
      citationsFromSubagentArtifacts([
        { path: "/Notes/a.md", kind: "vault", title: "a.md" },
        { path: "https://example.com/x", kind: "web", title: "X" },
      ]),
    ).toEqual([
      { path: "/Notes/a.md", title: "a.md" },
      { path: "https://example.com/x", title: "X" },
    ]);
  });

  it("mergeSubagentArtifacts dedupes by path", () => {
    expect(
      mergeSubagentArtifacts(
        [{ path: "/a.md", kind: "vault" }],
        [{ path: "/a.md", kind: "vault", title: "A" }, { path: "/b.md", kind: "vault" }],
      ).map((a) => a.path),
    ).toEqual(["/a.md", "/b.md"]);
  });
});
