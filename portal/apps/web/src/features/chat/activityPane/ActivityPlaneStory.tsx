/**
 * Auth-free story for Playwright activity-plane proofs (lp-dpr.8 / epic lp-dpr).
 *
 * Mounted with `?story=activity-plane`.
 * Optional query params:
 *   - `layout=split|drawer` — force desktop split or mobile drawer
 *   - `phase=soft|tools|subagent|nested|artifacts|workflow|all` — which happy path to emphasize
 *     (default `all` shows full fixture: soft-open doc + tools + chips + workflow)
 *     `nested` = focused subagent detail with live nested tool stream (lp-uxy.1)
 *     `artifacts` = n subagents write n vault files; detail chips + final citations (lp-uxy.2)
 *   - `pane=document|activity|closed` — initial side surface (default depends on phase)
 *
 * Uses fixture timeline + preview content — no BFF session required.
 */

import {
  useCallback,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import type { VaultFileContent } from "../../../api/types.js";
import type {
  ChatTimelineAssistantTurn,
  ChatTimelineItem,
  ChatTimelineToolCall,
  ChatTimelineUserItem,
} from "../../../hooks/useChatEvents.js";

import { ChatTimeline } from "../ChatTimeline.js";
import { DocumentPaneHost } from "../documentPane/DocumentPaneHost.js";
import type { DocumentPaneLayoutPreference } from "../documentPane/useDocumentPaneNarrow.js";
import type { ArtifactPanelState } from "../documentPane/types.js";
import {
  collectNestedToolsForSubagent,
  mapSubagentRunFromToolCall,
  type SubagentRun,
} from "../subagentRun.js";
import {
  mapWorkflowRunFromToolCall,
  type WorkflowRun,
} from "../workflowRun.js";

import {
  activityPaneReducer,
  createInitialActivityPaneState,
} from "./activityPaneReducer.js";
import { ActivityPaneHost } from "./ActivityPaneHost.js";
import { SubagentRoster } from "./SubagentRoster.js";
import { WorkflowTree } from "./WorkflowTree.js";
import type { ActivityPaneFocus, ActivityPaneMode } from "./types.js";

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const rootStyle: CSSProperties = {
  height: "100dvh",
  width: "100%",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  containerType: "inline-size",
  containerName: "chat",
};

const splitRowStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "row",
  minHeight: 0,
  minWidth: 0,
  width: "100%",
};

const chatColumnStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: "100%",
  display: "flex",
  flexDirection: "column",
  padding: "var(--spacing-6, 1.5rem)",
  gap: "var(--spacing-3, 0.75rem)",
};

const composerStyle: CSSProperties = {
  marginTop: "auto",
  border: "1px solid var(--border-primary, rgba(0,0,0,0.1))",
  borderRadius: 12,
  padding: "var(--spacing-3, 0.75rem)",
  flexShrink: 0,
};

const timelineScrollStyle: CSSProperties = {
  flex: 1,
  minHeight: 120,
  overflow: "auto",
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OFFICE_PATH = "/Business/Contracts/MSA.docx";
const OFFICE_BASENAME = "MSA.docx";

const FIXTURE_DOC_CONTENT: VaultFileContent = {
  path: OFFICE_PATH,
  mime_type: "text/markdown",
  encoding: "utf-8",
  content:
    "# MSA.docx — soft-open preview\n\n" +
    "This is fixture body content for the chat activity plane proof " +
    "(lp-dpr phases 0–1 / lp-dpr.8). Soft mode A opens this pane when an " +
    "office path is referenced; preview bytes must load (not chrome-only).\n\n" +
    "- Soft open loads content\n" +
    "- Tool rows via ChatToolCalls\n" +
    "- Subagent chip → activity pane\n" +
    "- Workflow stages expand/collapse\n",
};

const CLOSED_DOC: ArtifactPanelState = {
  status: "closed",
  ref: null,
  knownRevision: null,
  mode: "preview",
  officeSessionId: null,
  progress: null,
  conflict: null,
  checkpointOffer: null,
  error: null,
  localDirty: false,
  openGeneration: 0,
};

const OPEN_DOC: ArtifactPanelState = {
  status: "previewing",
  ref: {
    path: OFFICE_PATH,
    title: OFFICE_BASENAME,
    source: "deep_link",
  },
  knownRevision: { token: "etag-activity-story-1", kind: "etag" },
  mode: "preview",
  officeSessionId: null,
  progress: null,
  conflict: null,
  checkpointOffer: null,
  error: null,
  localDirty: false,
  openGeneration: 1,
};

const TOOL_READ: ChatTimelineToolCall = {
  key: "tc-read-1",
  name: "read_file",
  target: OFFICE_PATH,
  status: "complete",
  duration: "0.4s",
  result: "# MSA preview snippet\nParties agree…",
};

const TOOL_SEARCH: ChatTimelineToolCall = {
  key: "tc-search-1",
  name: "vault_search",
  target: "indemnification clause",
  status: "complete",
  duration: "1.1s",
};

const TOOL_RUNNING: ChatTimelineToolCall = {
  key: "tc-bash-1",
  name: "bash",
  target: "summarize contracts",
  status: "running",
};

const SUBAGENT_EXPLORE: ChatTimelineToolCall = {
  key: "sa-explore-1",
  name: "Explore",
  target: "Scan MSA sections",
  status: "running",
  kind: "subagent",
  subagentStatus: "running",
  subagentColor: "#3B82F6",
  subagentIcon: "explore",
  duration: "0:42",
  summary: "Scanning indemnity and liability sections",
};

const SUBAGENT_CODER: ChatTimelineToolCall = {
  key: "sa-coder-1",
  name: "coder",
  target: "Draft summary notes",
  status: "complete",
  kind: "subagent",
  subagentStatus: "done",
  subagentColor: "#10B981",
  subagentIcon: "code",
  duration: "4.1s",
  summary: "Wrote clause summary",
  result: "Indemnity is mutual; cap at 12 months fees.",
};

/** Nested tools under Explore (lp-uxy.1) — host parent_subagent_id attribution. */
const NESTED_READ_RUNNING: ChatTimelineToolCall = {
  key: "tc-nested-read-1",
  name: "read_file",
  target: "/Business/Contracts/MSA.docx",
  status: "running",
  parentSubagentId: "sa-explore-1",
};

const NESTED_SEARCH_COMPLETE: ChatTimelineToolCall = {
  key: "tc-nested-search-1",
  name: "vault_search",
  target: "indemnification",
  status: "complete",
  duration: "0.8s",
  parentSubagentId: "sa-explore-1",
  result: "3 hits in liability sections",
};

/** Nested tools under coder (complete subagent + complete nested stream). */
const NESTED_WRITE_COMPLETE: ChatTimelineToolCall = {
  key: "tc-nested-write-1",
  name: "write_file",
  target: "/Notes/msa-summary.md",
  status: "complete",
  duration: "1.2s",
  parentSubagentId: "sa-coder-1",
  result: "# MSA summary\n\nIndemnity is mutual…",
};

/**
 * Artifacts phase (lp-uxy.2): two complete writer subagents with host
 * artifacts[] + nested writes so detail chips + final citations both work.
 */
const ARTIFACT_PATH_A = "/Notes/explore-findings.md";
const ARTIFACT_PATH_B = "/Notes/coder-report.md";
const ARTIFACT_WEB = "https://example.com/msa-reference";

const SUBAGENT_WRITER_A: ChatTimelineToolCall = {
  key: "sa-writer-a",
  name: "Explore",
  target: "Collect findings",
  status: "complete",
  kind: "subagent",
  subagentStatus: "done",
  subagentColor: "#3B82F6",
  subagentIcon: "explore",
  duration: "3.2s",
  summary: "Wrote explore findings to vault",
  result: `Saved findings to ${ARTIFACT_PATH_A}`,
  artifacts: [
    { path: ARTIFACT_PATH_A, title: "explore-findings.md", kind: "vault" },
    { path: ARTIFACT_WEB, title: "MSA reference", kind: "web" },
  ],
};

const SUBAGENT_WRITER_B: ChatTimelineToolCall = {
  key: "sa-writer-b",
  name: "coder",
  target: "Draft executive report",
  status: "complete",
  kind: "subagent",
  subagentStatus: "done",
  subagentColor: "#10B981",
  subagentIcon: "code",
  duration: "5.0s",
  summary: "Wrote executive report",
  result: "Report ready",
  // No host artifacts[] — Portal harvests from nested write target.
};

const NESTED_WRITE_A: ChatTimelineToolCall = {
  key: "tc-write-a",
  name: "write_file",
  target: ARTIFACT_PATH_A,
  status: "complete",
  duration: "0.9s",
  parentSubagentId: "sa-writer-a",
  result: `# Explore findings\n\nThree indemnity clauses…`,
};

const NESTED_WRITE_B: ChatTimelineToolCall = {
  key: "tc-write-b",
  name: "write_file",
  target: ARTIFACT_PATH_B,
  status: "complete",
  duration: "1.1s",
  parentSubagentId: "sa-writer-b",
  result: `# Executive report\n\nCap at 12 months fees.`,
};

const FIXTURE_ARTIFACT_A: VaultFileContent = {
  path: ARTIFACT_PATH_A,
  mime_type: "text/markdown",
  encoding: "utf-8",
  content:
    "# Explore findings\n\nFixture body for lp-uxy.2 subagent artifact soft-open.\n",
};

const FIXTURE_ARTIFACT_B: VaultFileContent = {
  path: ARTIFACT_PATH_B,
  mime_type: "text/markdown",
  encoding: "utf-8",
  content:
    "# Executive report\n\nFixture body for second subagent write (lp-uxy.2).\n",
};

/** Unattributed tool — must NOT appear in nested list. */
const UNATTRIBUTED_BASH: ChatTimelineToolCall = {
  key: "tc-unattributed-bash",
  name: "bash",
  target: "echo noise",
  status: "complete",
  duration: "0.1s",
};

const WORKFLOW_ONBOARD: ChatTimelineToolCall = {
  key: "wf-onboard-1",
  name: "Contract review",
  status: "running",
  kind: "workflow",
  workflowStatus: "running",
  summary: "Stage-aware review of MSA.docx",
  workflowStages: [
    {
      id: "discover",
      name: "Discover",
      status: "complete",
      duration: "2.1s",
      summary: "Located MSA and related exhibits",
      subagentIds: ["sa-explore-1"],
    },
    {
      id: "analyze",
      name: "Analyze",
      status: "running",
      summary: "Extracting risk clauses",
      subagentIds: ["sa-coder-1"],
    },
    {
      id: "report",
      name: "Report",
      status: "pending",
      summary: "Compose executive summary",
    },
  ],
};

export type ActivityPlanePhase =
  | "soft"
  | "tools"
  | "subagent"
  | "nested"
  | "artifacts"
  | "workflow"
  | "all";

function parsePhase(raw: string | null): ActivityPlanePhase {
  switch (raw) {
    case "soft":
    case "tools":
    case "subagent":
    case "nested":
    case "artifacts":
    case "workflow":
    case "all":
      return raw;
    default:
      return "all";
  }
}

function parseLayout(
  raw: string | null,
): DocumentPaneLayoutPreference {
  if (raw === "split" || raw === "drawer") {
    return raw;
  }
  return "auto";
}

function parsePane(
  raw: string | null,
  phase: ActivityPlanePhase,
): ActivityPaneMode {
  if (raw === "document" || raw === "activity" || raw === "closed") {
    return raw;
  }
  // Defaults per phase for screenshot-friendly entry.
  switch (phase) {
    case "soft":
      return "document";
    case "tools":
      return "closed";
    case "subagent":
    case "nested":
    case "artifacts":
    case "workflow":
      return "activity";
    case "all":
    default:
      return "document";
  }
}

function buildUserMessage(phase: ActivityPlanePhase): ChatTimelineUserItem {
  const soft =
    phase === "soft" || phase === "all"
      ? `What does ${OFFICE_PATH} say about indemnity?`
      : "Review the latest contract packet.";
  return {
    type: "user",
    id: "user-1",
    content: soft,
    status: "sent",
    createdAt: "2026-07-29T12:00:00.000Z",
  };
}

function buildAssistantTurn(phase: ActivityPlanePhase): ChatTimelineAssistantTurn {
  const tools: ChatTimelineToolCall[] = [];
  if (phase === "tools" || phase === "all" || phase === "soft") {
    tools.push(TOOL_READ, TOOL_SEARCH);
  }
  if (phase === "tools") {
    tools.push(TOOL_RUNNING);
  }
  if (
    phase === "subagent" ||
    phase === "nested" ||
    phase === "all" ||
    phase === "workflow"
  ) {
    tools.push(SUBAGENT_EXPLORE, SUBAGENT_CODER);
  }
  if (phase === "nested" || phase === "all") {
    // Dual-emit style: nested tools with parent_subagent_id + one unattributed.
    tools.push(
      NESTED_SEARCH_COMPLETE,
      NESTED_READ_RUNNING,
      NESTED_WRITE_COMPLETE,
      UNATTRIBUTED_BASH,
    );
  }
  if (phase === "artifacts") {
    tools.push(
      SUBAGENT_WRITER_A,
      SUBAGENT_WRITER_B,
      NESTED_WRITE_A,
      NESTED_WRITE_B,
      UNATTRIBUTED_BASH,
    );
  }
  if (phase === "workflow" || phase === "all") {
    tools.push(WORKFLOW_ONBOARD);
  }

  const segments = tools.map((call) => ({
    kind: "tool" as const,
    call,
  }));

  let content = "";
  let citations: ChatTimelineAssistantTurn["citations"];
  if (phase === "soft") {
    content =
      "I opened MSA.docx (soft mode A — path reference without open verb) " +
      "and loaded the preview body.";
  } else if (phase === "tools") {
    content = "Tool calls are rendering with ChatToolCalls lifecycle statuses.";
  } else if (phase === "subagent") {
    content = "Subagent Explore is active — click the chip for the activity pane.";
  } else if (phase === "nested") {
    content =
      "Explore is running nested tools (read + search). Open activity detail " +
      "to see the live nested tool stream; unattributed tools stay out of it.";
  } else if (phase === "artifacts") {
    content =
      "Two subagents wrote vault reports. Open each from activity detail " +
      "chips or the final-report citations below (lp-uxy.2).";
    // Seeded final citations matching host harvest (history-reload proof).
    citations = [
      { path: ARTIFACT_PATH_A, title: "explore-findings.md" },
      { path: ARTIFACT_PATH_B, title: "coder-report.md" },
      { path: ARTIFACT_WEB, title: "MSA reference" },
    ];
  } else if (phase === "workflow") {
    content =
      "Workflow Contract review is running with expand/collapse stages.";
  } else {
    content =
      "Soft-open loaded MSA.docx. Tools, subagents, nested tool streams, and " +
      "the Contract review workflow are visible. Click a chip for nested tools.";
  }

  return {
    type: "assistant_turn",
    id: "turn-1",
    content,
    isStreaming:
      phase === "tools" ||
      phase === "nested" ||
      phase === "workflow" ||
      phase === "all",
    toolCalls: tools,
    segments,
    citations,
    createdAt: "2026-07-29T12:00:05.000Z",
  };
}

function collectSubagents(items: ChatTimelineItem[]): SubagentRun[] {
  const out: SubagentRun[] = [];
  for (const item of items) {
    if (item.type !== "assistant_turn") continue;
    for (const call of item.toolCalls) {
      const run = mapSubagentRunFromToolCall(call);
      if (run) out.push(run);
    }
  }
  return out;
}

function collectWorkflows(items: ChatTimelineItem[]): WorkflowRun[] {
  const out: WorkflowRun[] = [];
  for (const item of items) {
    if (item.type !== "assistant_turn") continue;
    for (const call of item.toolCalls) {
      const run = mapWorkflowRunFromToolCall(call);
      if (run) out.push(run);
    }
  }
  return out;
}

function initialActivityFocus(
  phase: ActivityPlanePhase,
  pane: ActivityPaneMode,
): ActivityPaneFocus {
  if (pane !== "activity") {
    return { kind: "roster" };
  }
  if (phase === "workflow") {
    return { kind: "workflow", workflowId: "wf-onboard-1" };
  }
  if (phase === "subagent" || phase === "nested") {
    return { kind: "subagent", runId: "sa-explore-1" };
  }
  if (phase === "artifacts") {
    return { kind: "subagent", runId: "sa-writer-a" };
  }
  return { kind: "roster" };
}

// ---------------------------------------------------------------------------
// Story
// ---------------------------------------------------------------------------

export function ActivityPlaneStory() {
  const params = useMemo(
    () => new URLSearchParams(window.location.search),
    [],
  );
  const phase = parsePhase(params.get("phase"));
  const layoutPreference = parseLayout(params.get("layout"));
  const initialPane = parsePane(params.get("pane"), phase);

  const rootRef = useRef<HTMLDivElement>(null);
  const [docState, setDocState] = useState<ArtifactPanelState>(() =>
    initialPane === "document" || phase === "soft" || phase === "all"
      ? OPEN_DOC
      : CLOSED_DOC,
  );
  const [sidePane, dispatchSidePane] = useReducer(
    activityPaneReducer,
    undefined,
    () => {
      const base = createInitialActivityPaneState();
      if (initialPane === "activity") {
        return {
          mode: "activity" as const,
          focus: initialActivityFocus(phase, "activity"),
          openGeneration: 1,
        };
      }
      if (initialPane === "document") {
        return {
          ...base,
          mode: "document" as const,
          openGeneration: 1,
        };
      }
      return base;
    },
  );

  const items: ChatTimelineItem[] = useMemo(
    () => [buildUserMessage(phase), buildAssistantTurn(phase)],
    [phase],
  );
  const subagentRuns = useMemo(() => collectSubagents(items), [items]);
  const workflowRuns = useMemo(() => collectWorkflows(items), [items]);
  const focusedNestedTools = useMemo(() => {
    if (sidePane.focus.kind !== "subagent") {
      return [];
    }
    return collectNestedToolsForSubagent(items, sidePane.focus.runId);
  }, [items, sidePane.focus]);

  const docOpen = docState.status !== "closed" && docState.ref != null;
  const content = useMemo(() => {
    if (!docOpen || !docState.ref?.path) return null;
    const path = docState.ref.path;
    if (path === ARTIFACT_PATH_A) return FIXTURE_ARTIFACT_A;
    if (path === ARTIFACT_PATH_B) return FIXTURE_ARTIFACT_B;
    return FIXTURE_DOC_CONTENT;
  }, [docOpen, docState.ref?.path]);

  const openDocument = useCallback(() => {
    setDocState((prev) => ({
      ...OPEN_DOC,
      openGeneration: prev.openGeneration + 1,
    }));
    dispatchSidePane({ type: "SIDE_PANE_OPEN_DOCUMENT" });
  }, []);

  /** Soft-open vault artifact from subagent detail or citation (lp-uxy.2). */
  const openVaultPath = useCallback((path: string) => {
    const trimmed = path.trim();
    if (!trimmed || /^https?:\/\//i.test(trimmed)) {
      return;
    }
    const title =
      trimmed.split("/").filter(Boolean).pop() || trimmed;
    setDocState((prev) => ({
      status: "previewing",
      ref: {
        path: trimmed,
        title,
        source: "citation",
      },
      knownRevision: { token: `etag-${title}`, kind: "etag" },
      mode: "preview",
      officeSessionId: null,
      progress: null,
      conflict: null,
      checkpointOffer: null,
      error: null,
      localDirty: false,
      openGeneration: prev.openGeneration + 1,
    }));
    dispatchSidePane({ type: "SIDE_PANE_OPEN_DOCUMENT" });
  }, []);

  const handleCloseSide = useCallback(() => {
    if (sidePane.mode === "document") {
      setDocState(CLOSED_DOC);
      dispatchSidePane({ type: "SIDE_PANE_CLOSE", reason: "user" });
      return;
    }
    dispatchSidePane({
      type: "SIDE_PANE_CLOSE",
      reason: "user",
      documentStillOpen: docOpen,
    });
  }, [sidePane.mode, docOpen]);

  const handleSubagentSelect = useCallback((run: SubagentRun) => {
    dispatchSidePane({
      type: "SIDE_PANE_OPEN_ACTIVITY",
      focus: { kind: "subagent", runId: run.id },
    });
  }, []);

  const handleWorkflowSelect = useCallback((run: WorkflowRun) => {
    dispatchSidePane({
      type: "SIDE_PANE_OPEN_ACTIVITY",
      focus: { kind: "workflow", workflowId: run.id },
    });
  }, []);

  const handleShowRoster = useCallback(() => {
    dispatchSidePane({
      type: "SIDE_PANE_SET_ACTIVITY_FOCUS",
      focus: { kind: "roster" },
    });
  }, []);

  const handleSelectRun = useCallback((runId: string) => {
    dispatchSidePane({
      type: "SIDE_PANE_SET_ACTIVITY_FOCUS",
      focus: { kind: "subagent", runId },
    });
  }, []);

  const handleSelectWorkflow = useCallback((workflowId: string) => {
    dispatchSidePane({
      type: "SIDE_PANE_SET_ACTIVITY_FOCUS",
      focus: { kind: "workflow", workflowId },
    });
  }, []);

  const activityBody =
    sidePane.focus.kind === "workflow" ? (
      <WorkflowTree
        workflows={workflowRuns}
        subagents={subagentRuns}
        focus={sidePane.focus}
        onSelectWorkflow={handleSelectWorkflow}
        onSelectSubagent={handleSelectRun}
        onShowRoster={handleShowRoster}
      />
    ) : (
      <SubagentRoster
        runs={subagentRuns}
        workflows={workflowRuns}
        focus={sidePane.focus}
        onSelectRun={handleSelectRun}
        onShowRoster={handleShowRoster}
        onSelectWorkflow={handleSelectWorkflow}
        nestedTools={focusedNestedTools}
        onOpenArtifact={openVaultPath}
      />
    );

  return (
    <div
      ref={rootRef}
      style={rootStyle}
      data-testid="activity-plane-story"
      data-phase={phase}
      data-layout-preference={layoutPreference}
      data-side-mode={sidePane.mode}
      data-side-focus={sidePane.focus.kind}
      data-doc-open={docOpen ? "1" : "0"}
    >
      <div style={splitRowStyle}>
        <VStack
          style={chatColumnStyle}
          data-testid="activity-plane-story-chat-column"
        >
          <Heading level={2}>Chat activity plane</Heading>
          <Text type="body" color="secondary">
            Fixture proof for lp-dpr phases 0–6 (lp-dpr.8) + lp-uxy.1 nested
            stream + lp-uxy.2 subagent artifacts: soft open loads document
            content; ChatToolCalls tool rows; subagent chips open the activity
            pane with nested live tools and artifact soft-open chips; final
            report citations; workflow stages expand/collapse.
          </Text>
          <HStack gap={2} style={{ flexWrap: "wrap" }}>
            <Button
              label="Open document (soft)"
              size="sm"
              variant="secondary"
              onClick={openDocument}
            />
            <Button
              label="Open activity roster"
              size="sm"
              variant="secondary"
              onClick={() =>
                dispatchSidePane({
                  type: "SIDE_PANE_OPEN_ACTIVITY",
                  focus: { kind: "roster" },
                })
              }
            />
          </HStack>
          <div
            role="log"
            aria-label="Chat messages"
            style={timelineScrollStyle}
            data-testid="activity-plane-story-messages"
          >
            <ChatTimeline
              items={items}
              toolProgress={null}
              onMcqSelect={() => {}}
              onSubagentSelect={handleSubagentSelect}
              onWorkflowSelect={handleWorkflowSelect}
              onCitationClick={openVaultPath}
            />
          </div>
          <div
            style={composerStyle}
            data-testid="activity-plane-story-composer"
          >
            <Text type="body" color="secondary">
              Message your agent…
            </Text>
          </div>
        </VStack>

        {/* Document host — exclusive when mode is document */}
        <DocumentPaneHost
          state={docState}
          content={content}
          isLoading={false}
          onClose={() => {
            setDocState(CLOSED_DOC);
            dispatchSidePane({ type: "SIDE_PANE_CLOSE", reason: "user" });
          }}
          onReload={() => {}}
          onOpenInVault={() => {}}
          onDownload={() => {}}
          onOpenCheckpoint={() => {}}
          onDismissCheckpoint={() => {}}
          containerRef={rootRef}
          layoutPreference={layoutPreference}
          active={sidePane.mode === "document"}
        />

        {/* Activity host — exclusive when mode is activity */}
        <ActivityPaneHost
          state={sidePane}
          onClose={handleCloseSide}
          containerRef={rootRef}
          layoutPreference={layoutPreference}
        >
          {activityBody}
        </ActivityPaneHost>
      </div>
    </div>
  );
}
