import { describe, expect, it } from "vitest";

import type { ChatEvent } from "../../api/types.js";

import {
  CONTEXT_GATHERING_COLLAPSE_MIN,
  humanToolActivityLabel,
  isContextGatheringTool,
  isHelperAgentToolName,
  isShellToolName,
  isToolProgressPortalEvent,
  looksLikeTechnicalToolId,
  mapToolCallFields,
  normalizeChatToolCallStatus,
  parseToolResult,
  readParentSubagentIdFromEvent,
  resolveToolActivityDisplay,
  resolveToolStatusFromEvent,
  shouldHideToolTargetInDefaultUi,
  toolGroupDefaultExpanded,
  toolGroupSummaryLabel,
} from "./chatToolCallMapper.js";
import { groupSegmentsForRender } from "./chatTimelineGrouping.js";

describe("normalizeChatToolCallStatus", () => {
  it("maps canonical statuses", () => {
    expect(normalizeChatToolCallStatus("pending")).toBe("pending");
    expect(normalizeChatToolCallStatus("running")).toBe("running");
    expect(normalizeChatToolCallStatus("complete")).toBe("complete");
    expect(normalizeChatToolCallStatus("error")).toBe("error");
  });

  it("maps common host aliases", () => {
    expect(normalizeChatToolCallStatus("in_progress")).toBe("running");
    expect(normalizeChatToolCallStatus("in-progress")).toBe("running");
    expect(normalizeChatToolCallStatus("started")).toBe("running");
    expect(normalizeChatToolCallStatus("queued")).toBe("pending");
    expect(normalizeChatToolCallStatus("done")).toBe("complete");
    expect(normalizeChatToolCallStatus("completed")).toBe("complete");
    expect(normalizeChatToolCallStatus("success")).toBe("complete");
    expect(normalizeChatToolCallStatus("failed")).toBe("error");
    expect(normalizeChatToolCallStatus("cancelled")).toBe("error");
    expect(normalizeChatToolCallStatus("timed_out")).toBe("error");
  });

  it("returns undefined for unknown values", () => {
    expect(normalizeChatToolCallStatus("maybe")).toBeUndefined();
    expect(normalizeChatToolCallStatus(null)).toBeUndefined();
    expect(normalizeChatToolCallStatus(42)).toBeUndefined();
  });
});

describe("resolveToolStatusFromEvent", () => {
  it("prefers top-level tool_status", () => {
    expect(
      resolveToolStatusFromEvent({
        tool_status: "complete",
        metadata: { tool_status: "running" },
      }),
    ).toBe("complete");
  });

  it("falls back to metadata status aliases", () => {
    expect(
      resolveToolStatusFromEvent({
        metadata: { status: "in_progress" },
      }),
    ).toBe("running");
    expect(
      resolveToolStatusFromEvent({
        metadata: { phase: "failed" },
      }),
    ).toBe("error");
  });

  it("defaults to running when omitted", () => {
    expect(resolveToolStatusFromEvent({})).toBe("running");
  });
});

describe("humanToolActivityLabel (lp-vnz.9)", () => {
  it("maps common technical tool ids to friendly verbs", () => {
    expect(humanToolActivityLabel("bash")).toBe("Running a command");
    expect(humanToolActivityLabel("grep")).toBe("Searching files");
    expect(humanToolActivityLabel("vault_search")).toBe("Searching files");
    expect(humanToolActivityLabel("read_file")).toBe("Reading documents");
    expect(humanToolActivityLabel("spawn_subagent")).toBe(
      "Running a helper agent",
    );
    expect(humanToolActivityLabel("get_subagent_output")).toBe(
      "Running a helper agent",
    );
    expect(humanToolActivityLabel("wait_for_agent")).toBe(
      "Running a helper agent",
    );
    expect(humanToolActivityLabel("cron")).toBe("Checking schedule");
    expect(humanToolActivityLabel("list_schedule")).toBe("Checking schedule");
    // lp-su0 / lp-jzl.6: LA start-job / cronjob UI path — scheduled task language (D1)
    expect(humanToolActivityLabel("cronjob")).toBe("Managing scheduled tasks");
    expect(humanToolActivityLabel("start_job")).toBe("Starting task");
    expect(humanToolActivityLabel("run_job")).toBe("Starting task");
    expect(humanToolActivityLabel("cron_run")).toBe("Starting task");
    // lp-uxy.4: Hermes/LA NL create path
    expect(humanToolActivityLabel("create_job")).toBe("Scheduling a task");
    expect(humanToolActivityLabel("schedule_job")).toBe("Scheduling a task");
    expect(humanToolActivityLabel("cron_create")).toBe("Scheduling a task");
    expect(humanToolActivityLabel("web_search")).toBe("Searching the web");
    expect(humanToolActivityLabel("web_fetch")).toBe("Browsing the web");
    expect(humanToolActivityLabel("write_file")).toBe("Writing a document");
    expect(humanToolActivityLabel("edit_file")).toBe("Editing a document");
    expect(humanToolActivityLabel("list_dir")).toBe("Listing files");
    expect(humanToolActivityLabel("skill_view")).toBe("Using a skill");
  });

  it("lp-95v.5: MCP-qualified web tools label as Searching/Browsing the web", () => {
    expect(humanToolActivityLabel("server__web_search")).toBe(
      "Searching the web",
    );
    expect(humanToolActivityLabel("mcp__tavily__tavily_search")).toBe(
      "Searching the web",
    );
    expect(humanToolActivityLabel("brave__web_search")).toBe(
      "Searching the web",
    );
    expect(humanToolActivityLabel("google_search")).toBe("Searching the web");
    // lp-uxy.7 Firecrawl / X
    expect(humanToolActivityLabel("firecrawl_search")).toBe(
      "Searching the web",
    );
    expect(humanToolActivityLabel("x_search")).toBe("Searching the web");
    expect(humanToolActivityLabel("firecrawl_scrape")).toBe(
      "Browsing the web",
    );
    expect(humanToolActivityLabel("firecrawl_crawl")).toBe("Browsing the web");
    expect(humanToolActivityLabel("server__browse_page")).toBe(
      "Browsing the web",
    );
    expect(humanToolActivityLabel("open_page")).toBe("Browsing the web");
    // File search stays file, not web.
    expect(humanToolActivityLabel("vault_search")).toBe("Searching files");
    expect(humanToolActivityLabel("codebase_search")).toBe("Searching files");
  });

  it("lp-uxy.10 F4: parse_document / extract_document_text → Parsing a document", () => {
    expect(humanToolActivityLabel("parse_document")).toBe("Parsing a document");
    expect(humanToolActivityLabel("extract_document_text")).toBe(
      "Parsing a document",
    );
    // MCP/server-qualified ids use bare tool key.
    expect(humanToolActivityLabel("server__parse_document")).toBe(
      "Parsing a document",
    );
    expect(humanToolActivityLabel("mcp__host__extract_document_text")).toBe(
      "Parsing a document",
    );
    // Hyphenated host chrome normalizes to snake_case keys.
    expect(humanToolActivityLabel("parse-document")).toBe("Parsing a document");
    // Prefer host tool_label when already human activity language.
    expect(
      humanToolActivityLabel("parse_document", {
        hostLabel: "Parsing a document",
      }),
    ).toBe("Parsing a document");
    expect(
      humanToolActivityLabel("parse_document", {
        hostLabel: "Parsing report.pdf",
      }),
    ).toBe("Parsing report.pdf");
    // Technical host labels must not override the friendly map.
    expect(
      humanToolActivityLabel("parse_document", {
        hostLabel: "parse_document",
      }),
    ).toBe("Parsing a document");
  });

  it("prefers host human labels over raw tool ids", () => {
    expect(
      humanToolActivityLabel("vault_search", {
        hostLabel: "Searching vault index",
      }),
    ).toBe("Searching vault index");
  });

  it("is idempotent for already-friendly phrases", () => {
    expect(humanToolActivityLabel("Searching files")).toBe("Searching files");
    expect(humanToolActivityLabel("Running a helper agent")).toBe(
      "Running a helper agent",
    );
    expect(humanToolActivityLabel("Managing scheduled tasks")).toBe(
      "Managing scheduled tasks",
    );
    expect(humanToolActivityLabel("Scheduling a task")).toBe(
      "Scheduling a task",
    );
    expect(humanToolActivityLabel("Starting task")).toBe("Starting task");
  });

  it("lp-jzl.6: scheduled task vocabulary for cron/job tool ids", () => {
    // Manage family
    expect(humanToolActivityLabel("cronjob")).toBe("Managing scheduled tasks");
    expect(humanToolActivityLabel("cron_job")).toBe("Managing scheduled tasks");
    expect(humanToolActivityLabel("cron_manage")).toBe(
      "Managing scheduled tasks",
    );
    expect(humanToolActivityLabel("cron_update")).toBe(
      "Managing scheduled tasks",
    );
    // Create family (backend still writes cron jobs.json)
    expect(humanToolActivityLabel("schedule_job")).toBe("Scheduling a task");
    expect(humanToolActivityLabel("cron_create")).toBe("Scheduling a task");
    expect(humanToolActivityLabel("create_job")).toBe("Scheduling a task");
    expect(humanToolActivityLabel("job_create")).toBe("Scheduling a task");
    // Start/run family
    expect(humanToolActivityLabel("start_job")).toBe("Starting task");
    expect(humanToolActivityLabel("run_job")).toBe("Starting task");
    expect(humanToolActivityLabel("cron_run")).toBe("Starting task");
    // List/check family unchanged
    expect(humanToolActivityLabel("cron")).toBe("Checking schedule");
    expect(humanToolActivityLabel("list_schedule")).toBe("Checking schedule");
    expect(humanToolActivityLabel("list_jobs")).toBe("Checking schedule");
  });

  it("classifies shell / helper tools and argv-hide policy", () => {
    expect(isShellToolName("bash")).toBe(true);
    expect(isShellToolName("read_file")).toBe(false);
    expect(isHelperAgentToolName("spawn_subagent")).toBe(true);
    expect(isHelperAgentToolName("get_subagent_output")).toBe(true);
    expect(isHelperAgentToolName("grep")).toBe(false);
    expect(shouldHideToolTargetInDefaultUi("bash")).toBe(true);
    expect(shouldHideToolTargetInDefaultUi("spawn_subagent")).toBe(true);
    expect(shouldHideToolTargetInDefaultUi("read_file")).toBe(false);
    expect(looksLikeTechnicalToolId("bash")).toBe(true);
    expect(looksLikeTechnicalToolId("Searching vault")).toBe(false);
  });

  it("resolveToolActivityDisplay keeps technicalName for advanced UI", () => {
    expect(
      resolveToolActivityDisplay({ toolName: "spawn_subagent" }),
    ).toEqual({
      name: "Running a helper agent",
      technicalName: "spawn_subagent",
    });
    // Argv-like tool_label must not become the default row label.
    expect(
      resolveToolActivityDisplay({
        toolName: "bash",
        toolLabel: "yarn test",
      }),
    ).toEqual({
      name: "Running a command",
      technicalName: "bash",
    });
    expect(
      resolveToolActivityDisplay({
        toolName: "bash",
      }),
    ).toEqual({
      name: "Running a command",
      technicalName: "bash",
    });
    expect(
      resolveToolActivityDisplay({
        toolName: "vault_search",
        toolLabel: "Searching vault index",
      }),
    ).toEqual({
      name: "Searching vault index",
      technicalName: "vault_search",
    });
    // lp-uxy.10 F4
    expect(
      resolveToolActivityDisplay({ toolName: "parse_document" }),
    ).toEqual({
      name: "Parsing a document",
      technicalName: "parse_document",
    });
    expect(
      resolveToolActivityDisplay({
        toolName: "parse_document",
        toolLabel: "Parsing a document",
      }),
    ).toEqual({
      name: "Parsing a document",
      technicalName: "parse_document",
    });
  });
});

describe("mapToolCallFields", () => {
  it("maps pending → running → complete lifecycle fields", () => {
    const base: ChatEvent = {
      type: "tool_progress",
      chat_id: "c1",
      tool_name: "read_file",
      tool_call_id: "tc-1",
      tool_target: "/Projects/a.md",
      tool_status: "pending",
    };
    expect(mapToolCallFields(base)).toMatchObject({
      name: "Reading documents",
      technicalName: "read_file",
      target: "/Projects/a.md",
      status: "pending",
    });
    expect(
      mapToolCallFields({
        ...base,
        tool_status: undefined,
        metadata: { status: "in_progress" },
      }),
    ).toMatchObject({ status: "running" });
    expect(
      mapToolCallFields({
        ...base,
        tool_status: "complete",
        duration: "1250",
        result: "file body",
      }),
    ).toMatchObject({
      status: "complete",
      duration: "1250",
      result: "file body",
    });
    // Numeric duration_ms from metadata formats as ms/s.
    expect(
      mapToolCallFields({
        ...base,
        tool_status: "complete",
        metadata: { duration_ms: 1250 },
      }),
    ).toMatchObject({ status: "complete", duration: "1.3s" });
  });

  it("maps error with friendly name + technicalName and node badge", () => {
    const fields = mapToolCallFields({
      type: "tool_progress",
      chat_id: "c1",
      tool_name: "bash",
      tool_call_id: "tc-err",
      tool_target: "ls -la /tmp",
      tool_status: undefined,
      metadata: { status: "failed" },
      error_message: "exit 1",
      node: "cli:sandbox",
    });
    expect(fields).toMatchObject({
      name: "Running a command",
      technicalName: "bash",
      // raw target retained for advanced/details; UI hides argv
      target: "ls -la /tmp",
      status: "error",
      errorMessage: "exit 1",
      node: "cli:sandbox",
    });
  });

  it("maps spawn/get_subagent tools under helper-agent language", () => {
    expect(
      mapToolCallFields({
        type: "tool_progress",
        chat_id: "c1",
        tool_name: "spawn_subagent",
        tool_call_id: "tc-spawn",
        tool_target: "researcher --depth 3",
        tool_status: "running",
      }),
    ).toMatchObject({
      name: "Running a helper agent",
      technicalName: "spawn_subagent",
      target: "researcher --depth 3",
    });
    expect(
      mapToolCallFields({
        type: "tool_progress",
        chat_id: "c1",
        tool_name: "get_subagent_output",
        tool_call_id: "tc-out",
        tool_status: "running",
      }),
    ).toMatchObject({
      name: "Running a helper agent",
      technicalName: "get_subagent_output",
    });
  });

  it("maps subagent rows with badge name + identity (lp-dpr.5)", () => {
    const fields = mapToolCallFields({
      type: "tool_progress",
      chat_id: "c1",
      tool_kind: "subagent",
      subagent_name: "Researcher",
      tool_target: "Find APIs",
      tool_status: "running",
      tool_call_id: "sa-1",
    });
    expect(fields).toMatchObject({
      name: "Researcher",
      target: "Find APIs",
      status: "running",
      kind: "subagent",
      subagentStatus: "running",
      subagentIcon: "research",
      summary: "Find APIs",
    });
    expect(fields.subagentColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("maps workflow rows with ordered stages (lp-dpr.7)", () => {
    const fields = mapToolCallFields({
      type: "tool_progress",
      chat_id: "c1",
      tool_call_id: "wf-1",
      metadata: {
        portal_event: "workflow_progress",
        workflow_id: "wf-1",
        workflow_name: "Onboard project",
        workflow_status: "running",
        stages: [
          {
            id: "discover",
            name: "Discover",
            status: "complete",
            duration: "2.1s",
            subagent_ids: ["sa-1"],
          },
          { id: "implement", name: "Implement", status: "running" },
        ],
      },
    });
    expect(fields).toMatchObject({
      name: "Onboard project",
      status: "running",
      kind: "workflow",
      workflowStatus: "running",
    });
    expect(fields.workflowStages).toHaveLength(2);
    expect(fields.workflowStages?.[0]?.subagentIds).toEqual(["sa-1"]);
    expect(isToolProgressPortalEvent("workflow_progress")).toBe(true);
    expect(isToolProgressPortalEvent("workflow.update")).toBe(true);
  });

  it("maps workflow stages from nested result JSON (lp-oop.38.21)", () => {
    const snapshot = {
      workflow_id: "wf_1",
      workflow_name: "research-lite",
      workflow_status: "complete",
      stages: [
        { id: "plan", name: "Plan", status: "complete" },
        { id: "explore", name: "Explore", status: "complete" },
        { id: "synthesize", name: "Synthesize", status: "complete" },
      ],
    };
    const fields = mapToolCallFields({
      type: "tool_progress",
      chat_id: "c1",
      tool_name: "workflow",
      tool_call_id: "wf_1",
      tool_kind: "workflow",
      tool_label: "research-lite",
      result: JSON.stringify(snapshot),
      metadata: {
        portal_event: "workflow_progress",
        tool_kind: "workflow",
        result: JSON.stringify(snapshot),
      },
    });
    expect(fields).toMatchObject({
      name: "research-lite",
      kind: "workflow",
      workflowStatus: "complete",
    });
    expect(fields.workflowStages?.map((s) => s.name)).toEqual([
      "Plan",
      "Explore",
      "Synthesize",
    ]);
  });

  it("maps nested run.agents onto stages when snapshot omits subagent_ids (lp-oop.38.25.1)", () => {
    const snapshot = {
      workflow_id: "wf_1",
      workflow_name: "research-lite",
      workflow_status: "complete",
      stages: [
        { id: "plan", name: "Plan", status: "complete" },
        { id: "explore", name: "Explore", status: "complete" },
        { id: "synthesize", name: "Synthesize", status: "complete" },
      ],
      run: {
        run_id: "wf_1",
        agents: [
          {
            id: "wf_1:plan",
            label: "plan",
            summary: "Inspect vault layout first",
            phase: "plan",
          },
        ],
      },
    };
    const fields = mapToolCallFields({
      type: "tool_progress",
      chat_id: "c1",
      tool_call_id: "wf_1",
      result: JSON.stringify(snapshot),
      metadata: {
        portal_event: "workflow_progress",
        result: JSON.stringify(snapshot),
      },
    });
    expect(fields.workflowStages?.[0]).toMatchObject({
      summary: "Inspect vault layout first",
      subagentIds: ["wf_1:plan"],
    });
    expect(fields.workflowStages?.[1]?.subagentIds).toBeUndefined();
  });

  it("maps research-lite stage summaries and nested helper ids (lp-oop.38.25.1)", () => {
    const fields = mapToolCallFields({
      type: "tool_progress",
      chat_id: "c1",
      tool_call_id: "wf_1",
      metadata: {
        portal_event: "workflow_progress",
        workflow_id: "wf_1",
        workflow_name: "research-lite",
        workflow_status: "complete",
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
            subagentIds: ["wf_1:explore-structure"],
          },
          {
            id: "synthesize",
            name: "Synthesize",
            status: "complete",
            summary: "Cited brief for the parent",
            subagent_ids: ["wf_1:synthesize"],
          },
        ],
      },
    });
    expect(fields.workflowStages?.[0]).toMatchObject({
      summary: "Inspect vault layout first",
      subagentIds: ["wf_1:plan"],
    });
    expect(fields.workflowStages?.[1]?.subagentIds).toEqual([
      "wf_1:explore-structure",
    ]);
    expect(fields.workflowStages?.[2]?.summary).toBe("Cited brief for the parent");
  });

  it("preserves needs_input on subagentStatus", () => {
    const fields = mapToolCallFields({
      type: "tool_progress",
      chat_id: "c1",
      tool_kind: "subagent",
      subagent_name: "Writer",
      tool_call_id: "sa-2",
      tool_status: "needs_input",
    });
    expect(fields.kind).toBe("subagent");
    expect(fields.subagentStatus).toBe("needs_input");
    // ChatToolCallStatus falls back to running for unknown aliases.
    expect(fields.status).toBe("running");
  });

  it("maps parent_subagent_id attribution for nested tools (lp-uxy.1)", () => {
    expect(
      readParentSubagentIdFromEvent({
        metadata: { parent_subagent_id: "sa-explore-1" },
      }),
    ).toBe("sa-explore-1");
    expect(
      readParentSubagentIdFromEvent({
        metadata: { subagent_run_id: "sa-run-2" },
      }),
    ).toBe("sa-run-2");
    expect(readParentSubagentIdFromEvent({ metadata: {} })).toBeUndefined();

    const fields = mapToolCallFields({
      type: "tool_progress",
      chat_id: "c1",
      tool_name: "read_file",
      tool_call_id: "tc-nested-1",
      tool_status: "running",
      tool_target: "/Notes/a.md",
      metadata: {
        portal_event: "tool_progress",
        parent_subagent_id: "sa-explore-1",
      },
    });
    expect(fields).toMatchObject({
      name: "Reading documents",
      technicalName: "read_file",
      status: "running",
      parentSubagentId: "sa-explore-1",
    });
    // Generic tools stay kind-less.
    expect(fields.kind).toBeUndefined();
  });

  it("maps metadata.artifacts on subagent complete (lp-uxy.2)", () => {
    const fields = mapToolCallFields({
      type: "tool_progress",
      chat_id: "c1",
      tool_kind: "subagent",
      tool_call_id: "sa-1",
      subagent_name: "coder",
      tool_status: "complete",
      metadata: {
        portal_event: "subagent",
        artifacts: [
          {
            vault_path: "/Notes/report.md",
            title: "report.md",
            kind: "vault",
          },
        ],
      },
    });
    expect(fields.kind).toBe("subagent");
    expect(fields.artifacts).toEqual([
      { path: "/Notes/report.md", title: "report.md", kind: "vault" },
    ]);
  });

  it("pulls resultDetail-rich fields from metadata", () => {
    const fields = mapToolCallFields({
      type: "tool_progress",
      chat_id: "c1",
      tool_name: "terminal",
      tool_status: "complete",
      metadata: {
        result: "ls -la\ntotal 0",
        result_language: "bash",
        duration_ms: 340,
        additions: 2,
        deletions: 1,
      },
    });
    expect(fields).toMatchObject({
      status: "complete",
      result: "ls -la\ntotal 0",
      resultLanguage: "bash",
      duration: "340ms",
      additions: 2,
      deletions: 1,
    });
  });

  it("lp-uxy.7: plumbs search_results metadata for structured web cards", () => {
    const fields = mapToolCallFields({
      type: "tool_progress",
      chat_id: "c1",
      tool_name: "firecrawl_search",
      tool_call_id: "tc-fc",
      tool_status: "complete",
      metadata: {
        provider: "firecrawl",
        search_results: [
          {
            url: "https://en.wikipedia.org/wiki/A",
            title: "Article A",
            snippet: "Summary of A",
          },
        ],
        // Unrelated keys must not leak onto the tool row.
        error: undefined,
        sandbox: "cli:remote",
      },
    });
    expect(fields).toMatchObject({
      name: "Searching the web",
      technicalName: "firecrawl_search",
      status: "complete",
      metadata: {
        provider: "firecrawl",
        search_results: [
          {
            url: "https://en.wikipedia.org/wiki/A",
            title: "Article A",
            snippet: "Summary of A",
          },
        ],
      },
    });
    expect(fields.metadata).not.toHaveProperty("sandbox");
  });

  it("lp-uxy.7: serializes object result bodies for JSON parse", () => {
    const fields = mapToolCallFields({
      type: "tool_progress",
      chat_id: "c1",
      tool_name: "web_search",
      tool_status: "complete",
      metadata: {
        result: {
          results: [
            {
              url: "https://example.com/a",
              title: "A",
              snippet: "About A",
            },
          ],
        },
      },
    });
    expect(fields.resultLanguage).toBe("json");
    expect(fields.result).toContain("https://example.com/a");
    expect(JSON.parse(fields.result ?? "{}")).toMatchObject({
      results: [{ title: "A" }],
    });
  });

  it("lp-uxy.10 F4: parse_document tool_progress → friendly label + lifecycle", () => {
    const base: ChatEvent = {
      type: "tool_progress",
      chat_id: "c1",
      tool_name: "parse_document",
      tool_call_id: "tc-parse-1",
      tool_target: "/staging/uploads/u1/report.pdf",
      tool_status: "running",
    };
    expect(mapToolCallFields(base)).toMatchObject({
      name: "Parsing a document",
      technicalName: "parse_document",
      target: "/staging/uploads/u1/report.pdf",
      status: "running",
    });
    // Prefer host tool_label when dual-emitted.
    expect(
      mapToolCallFields({
        ...base,
        tool_label: "Parsing a document",
        tool_status: "complete",
        result: "# Report\n\nExtracted body…",
      }),
    ).toMatchObject({
      name: "Parsing a document",
      technicalName: "parse_document",
      status: "complete",
      result: "# Report\n\nExtracted body…",
    });
    // Alias tool id
    expect(
      mapToolCallFields({
        type: "tool_progress",
        chat_id: "c1",
        tool_name: "extract_document_text",
        tool_call_id: "tc-parse-2",
        tool_target: "/Projects/deck.pptx",
        tool_status: "running",
      }),
    ).toMatchObject({
      name: "Parsing a document",
      technicalName: "extract_document_text",
      target: "/Projects/deck.pptx",
      status: "running",
    });
    // Error lifecycle keeps friendly name (path_denied / etc. from host).
    expect(
      mapToolCallFields({
        ...base,
        tool_status: "error",
        error_message: "path_denied",
      }),
    ).toMatchObject({
      name: "Parsing a document",
      technicalName: "parse_document",
      status: "error",
      errorMessage: "path_denied",
    });
  });
});

describe("parseToolResult", () => {
  it("prefers explicit result over content label", () => {
    expect(
      parseToolResult({
        type: "tool_progress",
        chat_id: "c1",
        content: "read_file",
        result: "BODY",
        tool_status: "complete",
      }),
    ).toEqual({ result: "BODY", resultLanguage: undefined });
  });
});

describe("isContextGatheringTool / toolGroupSummaryLabel", () => {
  it("classifies read/search tools as context gathering", () => {
    expect(isContextGatheringTool({ name: "read_file" })).toBe(true);
    expect(isContextGatheringTool({ name: "vault_search" })).toBe(true);
    expect(isContextGatheringTool({ name: "grep" })).toBe(true);
    expect(isContextGatheringTool({ name: "write_file" })).toBe(false);
    expect(isContextGatheringTool({ name: "bash" })).toBe(false);
    expect(isContextGatheringTool({ name: "subagent" })).toBe(false);
  });

  it("lp-uxy.10 F4: parse_document is context gathering (collapses with reads)", () => {
    expect(isContextGatheringTool({ name: "parse_document" })).toBe(true);
    expect(isContextGatheringTool({ name: "extract_document_text" })).toBe(
      true,
    );
    // Friendly display name still collapses when technicalName is the tool id.
    expect(
      isContextGatheringTool({
        name: "Parsing a document",
        technicalName: "parse_document",
      }),
    ).toBe(true);
    expect(
      isContextGatheringTool({
        name: "Parsing a document",
      }),
    ).toBe(true);

    const many = [
      { name: "read_file", target: "a.md" },
      {
        name: "Parsing a document",
        technicalName: "parse_document",
        target: "/staging/uploads/u1/report.pdf",
      },
      { name: "vault_search", target: "q" },
    ];
    expect(toolGroupSummaryLabel(many)).toBe("Context gathering (3)");
  });

  it("labels only when many consecutive context tools", () => {
    const two = [
      { name: "read_file", target: "a.md" },
      { name: "read_file", target: "b.md" },
    ];
    expect(toolGroupSummaryLabel(two)).toBeUndefined();

    const many = [
      { name: "read_file", target: "a.md" },
      { name: "vault_search", target: "q" },
      { name: "grep", target: "TODO" },
    ];
    expect(many.length).toBeGreaterThanOrEqual(CONTEXT_GATHERING_COLLAPSE_MIN);
    expect(toolGroupSummaryLabel(many)).toBe("Context gathering (3)");

    const mixed = [
      { name: "read_file", target: "a.md" },
      { name: "bash", target: "ls" },
      { name: "read_file", target: "b.md" },
    ];
    expect(toolGroupSummaryLabel(mixed)).toBeUndefined();
  });
});

describe("toolGroupDefaultExpanded", () => {
  it("expands while any tool is running", () => {
    expect(
      toolGroupDefaultExpanded([
        { status: "complete" },
        { status: "running" },
      ]),
    ).toBe(true);
  });

  it("collapses large complete groups when answer is present", () => {
    expect(
      toolGroupDefaultExpanded(
        [
          { status: "complete" },
          { status: "complete" },
          { status: "complete" },
          { status: "complete" },
        ],
        { hasAnswer: true },
      ),
    ).toBe(false);
  });
});

describe("isToolProgressPortalEvent", () => {
  it("accepts tool_progress and adjacent host shapes", () => {
    expect(isToolProgressPortalEvent("tool_progress")).toBe(true);
    expect(isToolProgressPortalEvent("subagent")).toBe(true);
    expect(isToolProgressPortalEvent("tool")).toBe(true);
    expect(isToolProgressPortalEvent("tool_call")).toBe(true);
    expect(isToolProgressPortalEvent("tool.start")).toBe(true);
    expect(isToolProgressPortalEvent("tool.approval")).toBe(false);
    expect(isToolProgressPortalEvent("needs_auth")).toBe(false);
    expect(isToolProgressPortalEvent("connector.qr")).toBe(false);
    expect(isToolProgressPortalEvent("mcq")).toBe(false);
  });
});

describe("groupSegmentsForRender", () => {
  it("groups consecutive tools and splits on reasoning", () => {
    const groups = groupSegmentsForRender(
      [
        {
          kind: "tool",
          call: {
            key: "t1",
            name: "read_file",
            target: "a.md",
            status: "complete",
          },
        },
        {
          kind: "tool",
          call: {
            key: "t2",
            name: "read_file",
            target: "b.md",
            status: "complete",
          },
        },
        {
          kind: "reasoning",
          key: "r1",
          content: "think",
          isStreaming: false,
        },
        {
          kind: "tool",
          call: {
            key: "t3",
            name: "bash",
            target: "ls",
            status: "complete",
          },
        },
      ],
      { hasAnswer: true },
    );

    expect(groups).toHaveLength(3);
    expect(groups[0]).toMatchObject({ kind: "tools" });
    if (groups[0]?.kind === "tools") {
      expect(groups[0].calls.map((c) => c.key)).toEqual(["t1", "t2"]);
      expect(groups[0].label).toBeUndefined(); // only 2 context tools
    }
    expect(groups[1]).toMatchObject({ kind: "reasoning", key: "r1" });
    expect(groups[2]).toMatchObject({ kind: "tools" });
  });

  it("applies Context gathering label for many consecutive reads", () => {
    const groups = groupSegmentsForRender(
      [
        {
          kind: "tool",
          call: {
            key: "a",
            name: "read_file",
            target: "1.md",
            status: "complete",
          },
        },
        {
          kind: "tool",
          call: {
            key: "b",
            name: "read_file",
            target: "2.md",
            status: "complete",
          },
        },
        {
          kind: "tool",
          call: {
            key: "c",
            name: "vault_search",
            target: "notes",
            status: "complete",
          },
        },
        {
          kind: "tool",
          call: {
            key: "d",
            name: "grep",
            target: "TODO",
            status: "complete",
          },
        },
      ],
      { hasAnswer: true },
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      kind: "tools",
      label: "Context gathering (4)",
      defaultIsExpanded: false,
    });
  });

  it("hides empty workflow cards when a staged sibling exists (lp-oop.38.23)", () => {
    const groups = groupSegmentsForRender(
      [
        {
          kind: "tool",
          call: {
            key: "wf_1850",
            name: "research-lite",
            status: "running",
            kind: "workflow",
            workflowStages: [
              { id: "plan", name: "Plan", status: "running" },
            ],
          },
        },
        {
          kind: "tool",
          call: {
            key: "call-extra",
            name: "workflow",
            status: "running",
            kind: "workflow",
          },
        },
      ],
      { hasAnswer: false },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: "workflow" });
    if (groups[0]?.kind === "workflow") {
      expect(groups[0].call.key).toBe("wf_1850");
    }
  });

  it("emits first-class subagent groups separate from tools (lp-dpr.5)", () => {
    const groups = groupSegmentsForRender(
      [
        {
          kind: "tool",
          call: {
            key: "t1",
            name: "read_file",
            target: "a.md",
            status: "complete",
          },
        },
        {
          kind: "tool",
          call: {
            key: "sa-1",
            name: "Explore",
            target: "Scan",
            status: "running",
            kind: "subagent",
            subagentStatus: "running",
            subagentColor: "#3B82F6",
            subagentIcon: "explore",
          },
        },
        {
          kind: "tool",
          call: {
            key: "t2",
            name: "bash",
            target: "ls",
            status: "complete",
          },
        },
      ],
      { hasAnswer: false },
    );

    expect(groups.map((g) => g.kind)).toEqual(["tools", "subagent", "tools"]);
    expect(groups[1]).toMatchObject({
      kind: "subagent",
      call: { key: "sa-1", name: "Explore", kind: "subagent" },
    });
  });
});
