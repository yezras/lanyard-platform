import { useCallback, useEffect, useRef, useState } from "react";

import { fetchThreadHistory } from "../api/chat.js";
import type {
  ChatCitation,
  ChatEvent,
  ChatHistoryEvent,
  ChatToolCallStatus,
  HistorySpeaker,
  McqChoice,
} from "../api/types.js";
import {
  speakerFromChatEvent,
  speakerKey,
} from "../api/groupRoom.js";
import {
  parseToolApprovalEvent,
  type ChatTimelineToolApprovalItem,
} from "../features/chat/toolApproval.js";
import { withApiBase } from "../api/tenantBase.js";
import {
  AGENT_STARTING_MESSAGE,
  AGENT_WAKE_SSE_EVENT_TYPES,
  agentWakeUiStatusFromLiveEvent,
  parseAgentWakeLiveEvent,
  type AgentWakeUiStatus,
} from "../features/chat/agentStarting.js";
import { mapToolCallFields } from "../features/chat/chatToolCallMapper.js";
import { parseConnectorQrEvent } from "../features/chat/connectorQr.js";
import {
  parseConnectorCliEvent,
  parseConnectorOAuthEvent,
} from "../features/chat/connectorStreamCards.js";
import {
  applySubagentParentCompletion,
  citationsFromSubagentArtifacts,
  harvestArtifactsFromNestedTools,
  mergeSubagentArtifacts,
  resolveSubagentArtifacts,
  type SubagentArtifact,
  type SubagentIconKey,
  type SubagentRunStatus,
} from "../features/chat/subagentRun.js";
import {
  applyPeerActivityToWorkflowStages,
  chatToolStatusFromWorkflowStatus,
  isWorkflowEvent,
  mergeWorkflowStages,
  readWorkflowIdFromEvent,
  type WorkflowPeerActivity,
  type WorkflowStage,
  type WorkflowStageStatus,
} from "../features/chat/workflowRun.js";
import { resolveVaultCitationPath } from "../features/vault/vaultPaths.js";
import {
  isHttpUrl,
  webCitationTitle,
  webCitationsFromContent,
  webCitationsFromToolCalls,
} from "../features/chat/webCitations.js";

// Re-export pure mapper helpers for tests / consumers (lp-dpr.3 / lp-dpr.5 / lp-dpr.6).
export {
  isContextGatheringTool,
  isSubagentEvent,
  isToolProgressPortalEvent,
  mapToolCallFields,
  normalizeChatToolCallStatus,
  parseToolResult,
  resolveToolStatusFromEvent,
  toolGroupDefaultExpanded,
  toolGroupSummaryLabel,
} from "../features/chat/chatToolCallMapper.js";

export {
  applySubagentParentCompletion,
  chatToolStatusFromSubagentTerminal,
  isSubagentSpawnOrWaitToolName,
  isTerminalSubagentStatus,
} from "../features/chat/subagentRun.js";

export type ChatTimelineToolCall = {
  key: string;
  /** Default UI activity label (friendly verb; not raw bash/spawn ids). */
  name: string;
  /**
   * Machine tool id for advanced/details (e.g. bash, spawn_subagent).
   * Omitted when unavailable or identical to the display name.
   */
  technicalName?: string;
  target?: string;
  status: ChatToolCallStatus;
  /** Duration string (e.g. "1.2s", "340ms") when complete. */
  duration?: string;
  /** Error detail when status is error. */
  errorMessage?: string;
  /** Diff stats for edit-style tools. */
  additions?: number;
  deletions?: number;
  /** Sandbox / node badge. */
  node?: string;
  /** Expandable result body for ChatToolCalls resultDetail (CodeBlock). */
  result?: string;
  /** Optional language hint for CodeBlock (diff, bash, …). */
  resultLanguage?: string;
  /**
   * Subset of tool_progress metadata used for structured web results
   * (search_results / web_results / results / citations) — lp-uxy.7.
   */
  metadata?: Record<string, unknown>;
  /**
   * Discriminator for first-class activity rows:
   * - `"subagent"` → SubagentRunChip (lp-dpr.5)
   * - `"workflow"` → WorkflowRunCard (lp-dpr.7)
   * Generic tools omit kind or use `"tool"`.
   */
  kind?: "tool" | "subagent" | "workflow";
  /** Product status including needs_input (broader than ChatToolCallStatus). */
  subagentStatus?: SubagentRunStatus;
  /** Stable identity color for subagent chips / roster. */
  subagentColor?: string;
  /** Stable icon key for subagent identity. */
  subagentIcon?: SubagentIconKey;
  /** Wall-clock start for elapsed display. */
  startedAt?: string;
  parentToolCallId?: string;
  /**
   * Parent SubagentRun id when this tool is nested under a subagent (lp-uxy.1).
   * Wire: metadata.parent_subagent_id | subagent_run_id | …
   */
  parentSubagentId?: string;
  summary?: string;
  /**
   * Host-stamped artifacts for this subagent run (lp-uxy.2).
   * Wire: metadata.artifacts[] on portal_event subagent complete.
   */
  artifacts?: SubagentArtifact[];
  /** Workflow overall status (lp-dpr.7). */
  workflowStatus?: WorkflowStageStatus;
  /** Ordered workflow stages (lp-dpr.7). */
  workflowStages?: WorkflowStage[];
};

export type ChatTimelineCitation = ChatCitation;

export type ChatMessageDeliveryStatus = "sending" | "sent" | "error";

export type ChatTimelineUserItem = {
  type: "user";
  id: string;
  content: string;
  status?: ChatMessageDeliveryStatus;
  createdAt?: string;
  /**
   * Model label stamped when the message was created (immutable).
   * Do not re-bind from live settings — provider switches must not rewrite history.
   */
  model?: string;
  /** Group-room author. Absent on 1:1. */
  speaker?: HistorySpeaker;
};

/**
 * Ordered mid-turn narrative segments (tool | reasoning).
 * Source of truth for chronological CoT interleaved with tools (portal-0q7.9).
 */
export type ChatTimelineTurnSegment =
  | { kind: "tool"; call: ChatTimelineToolCall }
  | { kind: "reasoning"; key: string; content: string; isStreaming: boolean };

/**
 * Continuous assistant turn: ordered segments → final answer.
 * `segments` is the ordered mid-turn narrative; `toolCalls` and `reasoning`
 * are derived convenience views for citations/status helpers and legacy UI.
 */
export type ChatTimelineAssistantTurn = {
  type: "assistant_turn";
  id: string;
  /** Ordered tool/reasoning segments as events arrived mid-turn. */
  segments?: ChatTimelineTurnSegment[];
  /** Derived: last/combined reasoning for backward compat. */
  reasoning?: { content: string; isStreaming: boolean };
  /** Derived: all tool segments in order (upsert-by-key still works). */
  toolCalls: ChatTimelineToolCall[];
  content: string;
  isStreaming?: boolean;
  citations?: ChatTimelineCitation[];
  model?: string;
  createdAt?: string;
  /** Group-room persona stamp. Absent on 1:1. */
  speaker?: HistorySpeaker;
  /**
   * 1:1 mailbox hop inbound (lp-v62i.20.2). ChatTimeline restyles this turn
   * as a Received band; do not invent a second event type.
   */
  mailboxInbound?: { from_display_name: string };
};

/** @deprecated Prefer assistant_turn; kept only for typing narrowers during migration. */
export type ChatTimelineAssistantItem = {
  type: "assistant";
  id: string;
  content: string;
  isStreaming?: boolean;
  toolCalls?: ChatTimelineToolCall[];
  citations?: ChatTimelineCitation[];
  model?: string;
  createdAt?: string;
};

/** @deprecated Folded into assistant_turn.reasoning. */
export type ChatTimelineReasoningItem = {
  type: "reasoning";
  id: string;
  content: string;
  isStreaming: boolean;
};

export type ChatTimelineMcqItem = {
  type: "mcq";
  mcqId: string;
  messageId?: string;
  content: string;
  choices: McqChoice[];
  selectedChoiceId: string | null;
  disabled: boolean;
};

export type ChatTimelineConnectorQrItem = {
  type: "connector.qr";
  pairingId: string;
  code: string;
  phase: "code" | "complete" | "failed" | "needs_reauth";
  ts: number;
  message?: string;
};

export type ChatTimelineConnectorOAuthItem = {
  type: "connector.oauth";
  connectorId: "google" | "hubspot";
  phase: "connect" | "connected";
  accountLabel?: string;
  ts: number;
};

export type ChatTimelineConnectorCliItem = {
  type: "connector.cli";
  connectorId: "github";
  deviceCode: string;
  command: string;
  status: "waiting" | "authorized";
  ts: number;
};

/** Ops-plain room line (lead succession, 1:1 hop, fuse trip). Not a card. */
export type ChatTimelineSystemNoticeItem = {
  type: "system_notice";
  id: string;
  content: string;
  createdAt?: string;
};

export type ChatTimelineItem =
  | ChatTimelineUserItem
  | ChatTimelineAssistantTurn
  | ChatTimelineMcqItem
  | ChatTimelineToolApprovalItem
  | ChatTimelineConnectorQrItem
  | ChatTimelineConnectorOAuthItem
  | ChatTimelineConnectorCliItem
  | ChatTimelineSystemNoticeItem
  // Legacy shapes still accepted by the timeline renderer during transition.
  | ChatTimelineAssistantItem
  | ChatTimelineReasoningItem;

export type UseChatEventsOptions = {
  threadId: string | null;
  eventSourceFactory?: (url: string) => EventSource;
  /**
   * Fired whenever any thread's timeline changes (including background streams).
   * Used by ChatView to keep sidebar StatusDots accurate for concurrent chats.
   */
  onThreadItemsChange?: (
    threadId: string,
    items: ChatTimelineItem[],
  ) => void;
  /**
   * Live SSE payload for the active thread only (lp-5q6.14 document pane).
   * Not fired for background retained streams or while history hydrate buffers.
   * Callers should normalize artifact metadata via @lanyard/shared.
   */
  onActiveThreadChatEvent?: (event: ChatEvent) => void;
  /**
   * Override history fetch (tests). Default: GET /api/chat/threads/:id/history.
   * Return durable events used to seed an empty session cache after reload.
   */
  historyFetcher?: (threadId: string) => Promise<ChatHistoryEvent[]>;
  /**
   * Hermes project working directory (absolute). Used when promoting tool-call
   * targets to vault citations so relatives join the multi-root project path.
   */
  projectVaultPath?: string | null;
};

export type UseChatEventsResult = {
  items: ChatTimelineItem[];
  /** Ephemeral label for in-flight tools with no open turn (rare). Prefer turn.toolCalls. */
  toolProgress: string | null;
  connectionStatus: string | null;
  /**
   * Cold-wake status from BFF live SSE (lp-6ty / lp-u7z).
   * `starting` while ensure_online runs; `error` on wake failure; null otherwise.
   */
  agentWakeStatus: AgentWakeUiStatus | null;
  /** Clear agent wake status (e.g. after the UI surfaces an HTTP wake error). */
  clearAgentWakeStatus: () => void;
  /**
   * Show the Agent starting chip from chat POST 202 (lp-vqr0.8). SSE
   * agent_starting / agent_ready still own later transitions.
   */
  noteAgentStarting: (message?: string) => void;
  /**
   * Appends a user bubble (status: sending) and returns its id.
   * Optional `model` is stamped at create time and never updated later.
   */
  appendUserMessage: (
    content: string,
    options?: { model?: string },
  ) => string;
  updateUserMessageStatus: (
    id: string,
    status: ChatMessageDeliveryStatus,
  ) => void;
  markMcqSelected: (mcqId: string, choiceId: string) => void;
  setMcqDisabled: (mcqId: string, disabled: boolean) => void;
  markToolApprovalSelected: (approvalId: string, choiceId: string) => void;
  setToolApprovalDisabled: (approvalId: string, disabled: boolean) => void;
  /**
   * Append a local (non-SSE) assistant turn — Portal-owned flows such as the
   * scheduled-task create wizard (lp-jzl.9.1 live wire).
   */
  appendLocalAssistantTurn: (content: string, options?: { id?: string }) => string;
  /**
   * Append a local MCQ bubble and disable prior MCQs on the active thread.
   */
  appendLocalMcq: (input: {
    mcqId: string;
    content: string;
    choices: McqChoice[];
    messageId?: string;
  }) => void;
  /**
   * Truncate timeline after the user message that produced `assistantTurnId`
   * and return that user content + id for re-send. Returns null when not found.
   */
  prepareRegenerate: (
    assistantTurnId: string,
  ) => { userId: string; content: string } | null;
  /** Keep SSE open for this thread until its response settles (multi-chat). */
  retainThreadStream: (threadId: string) => void;
  /**
   * Locally finalize an open assistant turn (cancel / Hermes halt).
   * Marks streaming complete and running tools as error so the spinner clears.
   */
  haltOpenAssistantTurn: (reason?: string) => void;
  /**
   * Upsert a connector.oauth card locally (lp-xhf4.19).
   * Reuses the same upsertConnectorOAuthItem as SSE/history (#622).
   * Used for Composer Connect (phase connect) and OAuth postMessage success
   * (phase connected with account_label). No SSE involved.
   */
  upsertConnectorOAuth: (input: {
    connectorId: "google" | "hubspot";
    phase: "connect" | "connected";
    accountLabel?: string | null;
  }) => void;
  reset: () => void;
};

export type { AgentWakeUiStatus };

/** Max simultaneous EventSource connections (active + background). Browser HTTP/1.1 caps ~6/host. */
const MAX_SSE_STREAMS = 5;
/** EventSource.CLOSED — numeric so jsdom tests without a global EventSource still run. */
const EVENT_SOURCE_CLOSED = 2;

const CHAT_EVENT_TYPES = [
  "message_send",
  "message_edit",
  "tool_progress",
  "reasoning",
  "mcq",
  "tool_approval",
  "connector.qr",
  "connector.oauth",
  "connector.cli",
  "typing",
  "system_notice",
] as const;

function nowIso(): string {
  return new Date().toISOString();
}

function parseCitations(event: ChatEvent): ChatCitation[] | undefined {
  if (event.citations?.length) {
    return event.citations;
  }
  const meta = event.metadata;
  if (!meta) {
    return undefined;
  }
  const raw = meta.citations;
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const out: ChatCitation[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const path =
      typeof record.path === "string"
        ? record.path
        : typeof record.url === "string"
          ? record.url
          : null;
    if (!path) {
      continue;
    }
    const title =
      typeof record.title === "string" && record.title.trim()
        ? record.title
        : path.split("/").pop() || path;
    const snippetRaw =
      typeof record.snippet === "string"
        ? record.snippet
        : typeof record.description === "string"
          ? record.description
          : typeof record.summary === "string"
            ? record.summary
            : undefined;
    const snippet = snippetRaw?.trim() || undefined;
    out.push({
      path,
      title,
      ...(snippet ? { snippet } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Rewrite citation paths to multi-root vault ids (absolute under project
 * primary_path) so Vault deep-links match tree nodes.
 * http(s) web citations are left as exact source URLs (lp-95v.5).
 */
function resolveCitationList(
  citations: ChatCitation[] | undefined,
  projectVaultPath?: string | null,
): ChatCitation[] | undefined {
  if (!citations?.length) {
    return citations;
  }
  return citations.map((citation) => {
    const rawPath = citation.path?.trim() ?? "";
    const snippet = citation.snippet?.trim() || undefined;
    // Exact web source URLs must not go through vault path join (lp-95v.5).
    // Preserve snippet for rich web cards (lp-uxy.7).
    if (isHttpUrl(rawPath)) {
      return {
        path: rawPath,
        title: webCitationTitle(rawPath, citation.title),
        ...(snippet ? { snippet } : {}),
      };
    }
    const path = resolveVaultCitationPath(citation.path, projectVaultPath);
    return {
      path,
      title:
        citation.title?.trim() && citation.title !== citation.path
          ? citation.title
          : path.split("/").pop() || path,
      ...(snippet ? { snippet } : {}),
    };
  });
}

/**
 * Tool names that typically act on vault/file paths.
 * Keep aligned with @lanyard/shared AGENT_FILE_TOOL_NAMES / FILE_TOOL_NAMES
 * plus common Lanyard Agent / Hermes aliases (lp-vnz.8).
 * Matched against bare tool id; qualified `server__tool` is reduced first.
 * Also recognize friendly activity labels from lp-vnz.9.
 */
const FILE_TOOL_NAME_RE =
  /^(read|read_file|write|write_file|edit|edit_file|create_file|apply_patch|patch|search_replace|cat|open|vault_read|vault_write|vault\.read|vault\.write|vault_search|search_files|glob|grep)$/i;

/**
 * Bare tool id for citation heuristics (`server__read_file` → `read_file`).
 * Human activity labels (spaces / long phrases) are not treated as tool ids.
 */
export function bareToolNameForCitations(name: string | undefined): string {
  const raw = name?.trim() ?? "";
  if (!raw) return "";
  // Friendly UI labels are not tool ids (lp-vnz.9 human tool activity).
  if (/\s/.test(raw) || raw.length > 64) return raw;
  const sep = raw.lastIndexOf("__");
  if (sep >= 0 && sep < raw.length - 1) {
    return raw.slice(sep + 2);
  }
  return raw;
}

/** Friendly activity labels that imply a file/document target. */
const FILE_ACTIVITY_LABEL_RE =
  /^(reading documents|writing a document|editing a document|searching files)$/i;

/**
 * True when a tool target looks like a vault/file path (not a shell command).
 * Absolute vault paths (/Projects/…) or file-like relative paths with an extension.
 */
export function isVaultFileToolTarget(target: string | undefined): boolean {
  if (!target?.trim()) {
    return false;
  }
  const t = target.trim();
  // Shell commands / queries are not vault paths.
  if (/\s/.test(t) || t.includes("|") || t.startsWith("-")) {
    return false;
  }
  if (t.startsWith("/")) {
    // Absolute path; require a filename segment (not just "/").
    return t.length > 1 && !t.endsWith("/");
  }
  // Relative file with extension (notes.md, AGENTS.md, src/foo.ts).
  return /^[\w./-]+\.\w{1,12}$/.test(t);
}

/**
 * Derive vault citations from durable tool rows when the gateway omits
 * metadata.citations. Prefer explicit event citations over this fallback.
 * Relative targets are joined with `projectVaultPath` when provided.
 *
 * Covers all path-like file reads (not only pure `read_file`) so vault file
 * reads always surface `vault-citation-N` chips for document-pane open (lp-vnz.8).
 */
export function citationsFromToolCalls(
  toolCalls: ChatTimelineToolCall[],
  projectVaultPath?: string | null,
): ChatCitation[] | undefined {
  const seen = new Set<string>();
  const out: ChatCitation[] = [];
  for (const call of toolCalls) {
    const target = call.target?.trim();
    if (!target) {
      continue;
    }
    // Prefer technicalName when human labels replaced display name (lp-vnz.9).
    const technical =
      typeof call.technicalName === "string" && call.technicalName.trim()
        ? call.technicalName.trim()
        : undefined;
    const bare =
      bareToolNameForCitations(technical) || bareToolNameForCitations(call.name);
    const nameLooksFile =
      FILE_TOOL_NAME_RE.test(bare) ||
      FILE_TOOL_NAME_RE.test(call.name) ||
      FILE_ACTIVITY_LABEL_RE.test(call.name);
    if (!nameLooksFile && !isVaultFileToolTarget(target)) {
      continue;
    }
    // Path-like target required (absolute or file-with-extension relative).
    if (!isVaultFileToolTarget(target)) {
      continue;
    }
    // Join relatives against project root — do not invent leading `/` first.
    const path = resolveVaultCitationPath(target, projectVaultPath);
    // Dedup by resolved path so AGENTS.md + /AGENTS.md collapse.
    if (seen.has(path)) {
      continue;
    }
    seen.add(path);
    out.push({
      path,
      title: path.split("/").pop() || path,
    });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Harvest vault/web paths produced by subagents into final-report citations
 * (lp-uxy.2). Prefer host artifacts[] on subagent rows; fill gaps from nested
 * file-tool targets and safe result-body paths.
 */
export function citationsFromSubagentToolCalls(
  toolCalls: ChatTimelineToolCall[],
  projectVaultPath?: string | null,
): ChatCitation[] | undefined {
  if (!toolCalls.length) {
    return undefined;
  }

  // Index nested tools by parent subagent id for harvest.
  const nestedByParent = new Map<string, ChatTimelineToolCall[]>();
  for (const call of toolCalls) {
    const parent = call.parentSubagentId?.trim();
    if (!parent || call.kind === "subagent" || call.kind === "workflow") {
      continue;
    }
    const list = nestedByParent.get(parent);
    if (list) {
      list.push(call);
    } else {
      nestedByParent.set(parent, [call]);
    }
  }

  const seen = new Set<string>();
  const out: ChatCitation[] = [];

  const pushCitation = (pathRaw: string, title?: string) => {
    const raw = pathRaw.trim();
    if (!raw) return;
    if (isHttpUrl(raw)) {
      if (seen.has(raw)) return;
      seen.add(raw);
      out.push({
        path: raw,
        title: webCitationTitle(raw, title),
      });
      return;
    }
    const path = resolveVaultCitationPath(raw, projectVaultPath);
    if (seen.has(path)) return;
    seen.add(path);
    out.push({
      path,
      title:
        title?.trim() && title !== raw
          ? title
          : path.split("/").pop() || path,
    });
  };

  for (const call of toolCalls) {
    if (call.kind !== "subagent") {
      continue;
    }
    const nested = nestedByParent.get(call.key) ?? [];
    const artifacts = resolveSubagentArtifacts(call.artifacts, nested);
    for (const c of citationsFromSubagentArtifacts(artifacts)) {
      pushCitation(c.path, c.title);
    }
  }

  // Also harvest un-parented nested paths that still look like subagent
  // children only when no subagent rows existed but artifacts were stamped
  // nowhere — covered above. Extra: any tool with explicit artifacts[].
  for (const call of toolCalls) {
    if (call.kind === "subagent" || !call.artifacts?.length) {
      continue;
    }
    for (const c of citationsFromSubagentArtifacts(call.artifacts)) {
      pushCitation(c.path, c.title);
    }
  }

  // Expand safe vault paths from generic file-tool results when target empty
  // (lp-uxy.2) — complements citationsFromToolCalls target harvest.
  for (const call of toolCalls) {
    if (call.kind === "subagent" || call.kind === "workflow") {
      continue;
    }
    if (call.target?.trim()) {
      continue;
    }
    if (!call.result?.trim()) {
      continue;
    }
    const harvested = harvestArtifactsFromNestedTools([call]);
    for (const a of harvested) {
      pushCitation(a.path, a.title);
    }
  }

  return out.length > 0 ? out : undefined;
}

// Re-export for tests / consumers that need artifact merge without UI.
export {
  mergeSubagentArtifacts,
  resolveSubagentArtifacts,
  citationsFromSubagentArtifacts,
};

function mergeCitations(
  primary: ChatCitation[] | undefined,
  fallback: ChatCitation[] | undefined,
): ChatCitation[] | undefined {
  if (!primary?.length && !fallback?.length) {
    return undefined;
  }
  if (!primary?.length) {
    return fallback;
  }
  if (!fallback?.length) {
    return primary;
  }
  const seen = new Set(primary.map((c) => c.path));
  const merged = [...primary];
  for (const c of fallback) {
    if (!seen.has(c.path)) {
      seen.add(c.path);
      merged.push(c);
    }
  }
  return merged;
}

function parseModel(event: ChatEvent): string | undefined {
  if (typeof event.model === "string" && event.model.trim()) {
    return event.model.trim();
  }
  const meta = event.metadata;
  if (!meta) {
    return undefined;
  }
  if (typeof meta.model === "string" && meta.model.trim()) {
    return meta.model.trim();
  }
  if (
    meta.model &&
    typeof meta.model === "object" &&
    typeof (meta.model as { name?: unknown }).name === "string"
  ) {
    return ((meta.model as { name: string }).name || "").trim() || undefined;
  }
  if (typeof meta.model_name === "string" && meta.model_name.trim()) {
    return meta.model_name.trim();
  }
  return undefined;
}

/**
 * When host outbound omits model, inherit the model stamped on the preceding
 * user bubble (immutable per send). Search items before `beforeIndex`.
 */
function precedingUserModel(
  items: ChatTimelineItem[],
  beforeIndex: number,
): string | undefined {
  for (let i = beforeIndex - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item?.type === "user") {
      const model = item.model?.trim();
      return model || undefined;
    }
  }
  return undefined;
}

/**
 * Whether an assistant turn is still in progress (streaming answer/reasoning,
 * tools running, or empty answer awaiting final message_send).
 * Exported for ChatView pending-state and tests.
 */
export function isAssistantTurnOpen(turn: ChatTimelineAssistantTurn): boolean {
  if (turn.isStreaming) {
    return true;
  }
  if (turn.reasoning?.isStreaming) {
    return true;
  }
  if (
    turn.segments?.some(
      (seg) => seg.kind === "reasoning" && seg.isStreaming,
    )
  ) {
    return true;
  }
  const tools = turn.toolCalls.length
    ? turn.toolCalls
    : toolCallsFromSegments(turn.segments);
  if (
    tools.some(
      (call) => call.status === "running" || call.status === "pending",
    )
  ) {
    return true;
  }
  // Empty answer with prior activity still open until message_send finalizes.
  if (!turn.content) {
    return true;
  }
  return false;
}

/**
 * True while the HTTP send is in flight, the latest assistant turn is open,
 * or we are awaiting the first assistant events after a user send.
 * Used to show the composer send-button spinner and block double-submit.
 *
 * `sent` without an assistant is the live HTTP→SSE gap. If the EventSource
 * is down (`streamLive: false`) that gap never closes — do not keep the
 * composer in Stop forever (Enter would be silently dropped).
 */
export function isChatResponsePending(
  items: ChatTimelineItem[],
  isSending: boolean,
  options?: { streamLive?: boolean },
): boolean {
  if (isSending) {
    return true;
  }
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item?.type === "assistant_turn") {
      return isAssistantTurnOpen(item);
    }
    if (item?.type === "user") {
      // Gap between HTTP send settling and first SSE: keep spinner until
      // an assistant turn appears (or the user message failed).
      if (item.status === "error") {
        return false;
      }
      if (item.status === "sending") {
        return true;
      }
      if (item.status === "sent") {
        return options?.streamLive !== false;
      }
      return false;
    }
    if (
      item?.type === "mcq" ||
      item?.type === "tool_approval" ||
      item?.type === "connector.qr" ||
      item?.type === "connector.oauth" ||
      item?.type === "connector.cli"
    ) {
      return false;
    }
  }
  return false;
}

function findOpenAssistantTurnIndex(
  items: ChatTimelineItem[],
  speaker?: HistorySpeaker,
): number {
  const want = speaker ? speakerKey(speaker) : undefined;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item?.type === "assistant_turn") {
      if (want && (!item.speaker || speakerKey(item.speaker) !== want)) {
        continue;
      }
      return isAssistantTurnOpen(item) ? i : -1;
    }
    if (
      item?.type === "user" ||
      item?.type === "mcq" ||
      item?.type === "tool_approval" ||
      item?.type === "connector.qr" ||
      item?.type === "connector.oauth" ||
      item?.type === "connector.cli"
    ) {
      return -1;
    }
  }
  return -1;
}

function findTurnIndexById(
  items: ChatTimelineItem[],
  id: string,
): number {
  return items.findIndex(
    (item) => item.type === "assistant_turn" && item.id === id,
  );
}

/** Extract tool calls from ordered segments (convenience view). */
export function toolCallsFromSegments(
  segments: ChatTimelineTurnSegment[] | undefined,
): ChatTimelineToolCall[] {
  if (!segments?.length) {
    return [];
  }
  const out: ChatTimelineToolCall[] = [];
  for (const segment of segments) {
    if (segment.kind === "tool") {
      out.push(segment.call);
    }
  }
  return out;
}

/**
 * Derived reasoning bag for backward compat / isAssistantTurnOpen.
 * Prefer the last reasoning segment; when multiple exist, join content and
 * report streaming if any segment is still streaming.
 */
export function reasoningFromSegments(
  segments: ChatTimelineTurnSegment[] | undefined,
): { content: string; isStreaming: boolean } | undefined {
  if (!segments?.length) {
    return undefined;
  }
  const reasoningSegs = segments.filter(
    (s): s is Extract<ChatTimelineTurnSegment, { kind: "reasoning" }> =>
      s.kind === "reasoning",
  );
  if (reasoningSegs.length === 0) {
    return undefined;
  }
  if (reasoningSegs.length === 1) {
    const only = reasoningSegs[0]!;
    return { content: only.content, isStreaming: only.isStreaming };
  }
  return {
    content: reasoningSegs.map((s) => s.content).join("\n\n"),
    isStreaming: reasoningSegs.some((s) => s.isStreaming),
  };
}

/** Sync toolCalls + reasoning convenience fields from segments. */
function withSegmentViews(
  turn: ChatTimelineAssistantTurn,
  segments: ChatTimelineTurnSegment[],
): ChatTimelineAssistantTurn {
  const reasoning = reasoningFromSegments(segments);
  const next: ChatTimelineAssistantTurn = {
    ...turn,
    segments,
    toolCalls: toolCallsFromSegments(segments),
  };
  if (reasoning) {
    next.reasoning = reasoning;
  } else {
    delete next.reasoning;
  }
  return next;
}

/** Normalize turn segments (legacy turns may only have toolCalls/reasoning). */
function turnSegments(turn: ChatTimelineAssistantTurn): ChatTimelineTurnSegment[] {
  if (turn.segments) {
    return turn.segments;
  }
  const segments: ChatTimelineTurnSegment[] = [];
  if (turn.reasoning?.content) {
    segments.push({
      kind: "reasoning",
      key: "legacy-reasoning",
      content: turn.reasoning.content,
      isStreaming: turn.reasoning.isStreaming,
    });
  }
  for (const call of turn.toolCalls) {
    segments.push({ kind: "tool", call });
  }
  return segments;
}

function withTurnSpeaker(
  turn: ChatTimelineAssistantTurn,
  speaker?: HistorySpeaker,
): ChatTimelineAssistantTurn {
  if (!speaker || turn.speaker) {
    return turn;
  }
  return { ...turn, speaker };
}

function ensureOpenTurn(
  items: ChatTimelineItem[],
  messageId?: string,
  speaker?: HistorySpeaker,
): { items: ChatTimelineItem[]; index: number } {
  if (messageId) {
    const byId = findTurnIndexById(items, messageId);
    if (byId >= 0) {
      const existing = items[byId];
      if (existing?.type === "assistant_turn" && speaker && !existing.speaker) {
        return {
          items: items.map((item, i) =>
            i === byId ? { ...existing, speaker } : item,
          ),
          index: byId,
        };
      }
      return { items, index: byId };
    }
  }

  const openIndex = findOpenAssistantTurnIndex(items, speaker);
  if (openIndex >= 0) {
    const open = items[openIndex];
    if (open?.type === "assistant_turn") {
      let next = open;
      if (messageId && open.id === "streaming") {
        next = { ...next, id: messageId };
      }
      next = withTurnSpeaker(next, speaker);
      if (next !== open) {
        return {
          items: items.map((item, i) => (i === openIndex ? next : item)),
          index: openIndex,
        };
      }
      return { items, index: openIndex };
    }
    return { items, index: openIndex };
  }

  const turn: ChatTimelineAssistantTurn = {
    type: "assistant_turn",
    id: messageId ?? "streaming",
    segments: [],
    toolCalls: [],
    content: "",
    isStreaming: true,
    ...(speaker ? { speaker } : {}),
  };
  return { items: [...items, turn], index: items.length };
}

function updateTurnAt(
  items: ChatTimelineItem[],
  index: number,
  updater: (turn: ChatTimelineAssistantTurn) => ChatTimelineAssistantTurn,
): ChatTimelineItem[] {
  return items.map((item, i) => {
    if (i !== index || item.type !== "assistant_turn") {
      return item;
    }
    return updater(item);
  });
}

function looksLikeModelToolCallId(key: string): boolean {
  return /^call[-_]/i.test(key.trim());
}

function workflowNamesCompatible(existing: string, incoming: string): boolean {
  const a = existing.trim().toLowerCase();
  const b = incoming.trim().toLowerCase();
  if (!a || !b) {
    return true;
  }
  if (a === b) {
    return true;
  }
  return a === "workflow" || b === "workflow";
}

function toolCallKeyFromEvent(event: ChatEvent, existingCount: number): string {
  // WorkflowRun id is workflow_id, not the LiteLLM call-* that starts the tool.
  if (isWorkflowEvent(event)) {
    const workflowId = readWorkflowIdFromEvent(event);
    if (workflowId) {
      return workflowId;
    }
  }
  if (event.tool_call_id?.trim()) {
    return event.tool_call_id.trim();
  }
  // Workflow upsert key when host omits tool_call_id (lp-dpr.7).
  const workflowId =
    typeof event.metadata?.workflow_id === "string"
      ? event.metadata.workflow_id.trim()
      : typeof event.metadata?.workflowId === "string"
        ? event.metadata.workflowId.trim()
        : "";
  if (workflowId) {
    return workflowId;
  }
  if (event.tool_name?.trim()) {
    return `name:${event.tool_name.trim()}`;
  }
  if (event.subagent_name?.trim()) {
    return `subagent:${event.subagent_name.trim()}`;
  }
  if (event.tool_label?.trim()) {
    return `label:${event.tool_label.trim()}`;
  }
  if (event.content?.trim()) {
    return `content:${event.content.trim()}`;
  }
  return `tool-${existingCount}`;
}

function findToolSegmentIndex(
  segments: ChatTimelineTurnSegment[],
  event: ChatEvent,
  key: string,
): number {
  const exact = segments.findIndex(
    (seg) => seg.kind === "tool" && seg.call.key === key,
  );
  if (exact >= 0 || !isWorkflowEvent(event)) {
    return exact;
  }

  const callId = event.tool_call_id?.trim();
  if (callId && callId !== key) {
    const byCall = segments.findIndex(
      (seg) =>
        seg.kind === "tool" &&
        seg.call.kind === "workflow" &&
        seg.call.key === callId,
    );
    if (byCall >= 0) {
      return byCall;
    }
  }

  const incomingName =
    (typeof event.metadata?.workflow_name === "string"
      ? event.metadata.workflow_name.trim()
      : "") ||
    event.tool_label?.trim() ||
    "";

  let placeholder = -1;
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    if (seg?.kind !== "tool" || seg.call.kind !== "workflow") {
      continue;
    }
    if (!looksLikeModelToolCallId(seg.call.key)) {
      continue;
    }
    if (seg.call.workflowStages && seg.call.workflowStages.length > 0) {
      continue;
    }
    if (!workflowNamesCompatible(seg.call.name, incomingName)) {
      continue;
    }
    placeholder = i;
  }
  if (placeholder >= 0) {
    return placeholder;
  }

  // Extra LiteLLM workflow call-* after launch (no workflow_id / stages).
  // Fold into the staged wf_* card instead of a second "Waiting for stages…" row.
  if (!readWorkflowIdFromEvent(event)) {
    let staged = -1;
    let running = -1;
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      if (seg?.kind !== "tool" || seg.call.kind !== "workflow") {
        continue;
      }
      running = i;
      if ((seg.call.workflowStages?.length ?? 0) > 0) {
        staged = i;
      }
    }
    if (staged >= 0) {
      return staged;
    }
    if (running >= 0) {
      return running;
    }
  }
  return -1;
}

function mergeToolCall(
  previous: ChatTimelineToolCall | undefined,
  next: Omit<ChatTimelineToolCall, "key"> & { key?: string },
  key: string,
): ChatTimelineToolCall {
  const merged: ChatTimelineToolCall = {
    key,
    name: next.name,
    status: next.status,
  };
  const technicalName = next.technicalName ?? previous?.technicalName;
  const target = next.target ?? previous?.target;
  const duration = next.duration ?? previous?.duration;
  const errorMessage = next.errorMessage ?? previous?.errorMessage;
  const additions = next.additions ?? previous?.additions;
  const deletions = next.deletions ?? previous?.deletions;
  const node = next.node ?? previous?.node;
  const result = next.result ?? previous?.result;
  const resultLanguage = next.resultLanguage ?? previous?.resultLanguage;
  const metadata = next.metadata ?? previous?.metadata;
  const kind = next.kind ?? previous?.kind;
  const subagentStatus = next.subagentStatus ?? previous?.subagentStatus;
  const subagentColor = next.subagentColor ?? previous?.subagentColor;
  const subagentIcon = next.subagentIcon ?? previous?.subagentIcon;
  const startedAt = next.startedAt ?? previous?.startedAt;
  const parentToolCallId = next.parentToolCallId ?? previous?.parentToolCallId;
  const parentSubagentId = next.parentSubagentId ?? previous?.parentSubagentId;
  const summary = next.summary ?? previous?.summary;
  // Artifacts: merge host lists (next first, then previous) so incremental
  // writes accumulate without dropping earlier paths (lp-uxy.2).
  const artifacts =
    next.artifacts || previous?.artifacts
      ? mergeSubagentArtifacts(next.artifacts, previous?.artifacts)
      : undefined;
  // Workflow stages: empty next (launch tool complete) must not wipe a snapshot.
  let workflowStatus = previous?.workflowStatus ?? next.workflowStatus;
  let workflowStages = previous?.workflowStages;
  const nextHasStages = (next.workflowStages?.length ?? 0) > 0;
  if (nextHasStages) {
    workflowStages =
      previous?.workflowStages && previous.workflowStages.length > 0
        ? mergeWorkflowStages(previous.workflowStages, next.workflowStages ?? [])
        : next.workflowStages;
    workflowStatus = next.workflowStatus ?? previous?.workflowStatus;
  } else if (
    next.workflowStatus &&
    next.workflowStatus !== "complete"
  ) {
    workflowStatus = next.workflowStatus;
  } else if (!previous?.workflowStatus) {
    workflowStatus = next.workflowStatus;
  }
  if (!workflowStages) {
    workflowStages = next.workflowStages;
  }
  if (technicalName !== undefined) merged.technicalName = technicalName;
  if (target !== undefined) merged.target = target;
  if (duration !== undefined) merged.duration = duration;
  if (errorMessage !== undefined) merged.errorMessage = errorMessage;
  if (additions !== undefined) merged.additions = additions;
  if (deletions !== undefined) merged.deletions = deletions;
  if (node !== undefined) merged.node = node;
  if (result !== undefined) merged.result = result;
  if (resultLanguage !== undefined) merged.resultLanguage = resultLanguage;
  if (metadata !== undefined) merged.metadata = metadata;
  if (kind !== undefined) merged.kind = kind;
  if (subagentStatus !== undefined) merged.subagentStatus = subagentStatus;
  if (subagentColor !== undefined) merged.subagentColor = subagentColor;
  if (subagentIcon !== undefined) merged.subagentIcon = subagentIcon;
  if (startedAt !== undefined) merged.startedAt = startedAt;
  if (parentToolCallId !== undefined) {
    merged.parentToolCallId = parentToolCallId;
  }
  if (parentSubagentId !== undefined) {
    merged.parentSubagentId = parentSubagentId;
  }
  if (summary !== undefined) merged.summary = summary;
  if (artifacts !== undefined && artifacts.length > 0) {
    merged.artifacts = artifacts;
  }
  if (workflowStatus !== undefined) merged.workflowStatus = workflowStatus;
  if (workflowStages !== undefined) merged.workflowStages = workflowStages;
  if (kind === "workflow" && workflowStatus !== undefined) {
    merged.status = chatToolStatusFromWorkflowStatus(workflowStatus);
  }
  return merged;
}

/**
 * After tool upsert, flip linked parent spawn/wait rows when all child
 * subagents are terminal (lp-dpr.6). Preserves segment order/keys.
 */
function propagateSubagentParentCompletionInSegments(
  segments: ChatTimelineTurnSegment[],
): ChatTimelineTurnSegment[] {
  const toolCalls = toolCallsFromSegments(segments);
  if (toolCalls.length === 0) {
    return segments;
  }
  const nextCalls = applySubagentParentCompletion(toolCalls);
  if (nextCalls === toolCalls) {
    return segments;
  }
  const byKey = new Map(nextCalls.map((c) => [c.key, c]));
  let changed = false;
  const next = segments.map((seg) => {
    if (seg.kind !== "tool") {
      return seg;
    }
    const updated = byKey.get(seg.call.key);
    if (!updated || updated === seg.call) {
      return seg;
    }
    // Identity check: only replace when fields actually differ.
    if (
      updated.status === seg.call.status &&
      updated.duration === seg.call.duration &&
      updated.errorMessage === seg.call.errorMessage &&
      updated.result === seg.call.result &&
      updated.subagentStatus === seg.call.subagentStatus
    ) {
      return seg;
    }
    changed = true;
    return { kind: "tool" as const, call: updated };
  });
  return changed ? next : segments;
}

function readStageIdFromEvent(event: ChatEvent): string | undefined {
  const meta = event.metadata;
  if (!meta || typeof meta !== "object") {
    return undefined;
  }
  for (const key of ["stage_id", "stageId", "workflow_stage_id"] as const) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function peerActivityFromToolCall(
  call: ChatTimelineToolCall,
  stageId?: string,
): WorkflowPeerActivity {
  const activity: WorkflowPeerActivity = {
    key: call.key,
    name: call.name,
  };
  if (call.kind) activity.kind = call.kind;
  if (call.summary) activity.summary = call.summary;
  if (call.parentSubagentId) activity.parentSubagentId = call.parentSubagentId;
  if (call.parentToolCallId) activity.parentToolCallId = call.parentToolCallId;
  if (stageId) activity.stageId = stageId;
  return activity;
}

/**
 * Nested spawn_agent work lands as ordinary timeline tools. Reduce those
 * peers onto the running workflow stage so completed Plan/Explore/Synthesize
 * keep helper ids / a short summary after later snapshots.
 */
function reduceWorkflowPeerActivityInSegments(
  segments: ChatTimelineTurnSegment[],
  event: ChatEvent,
): ChatTimelineTurnSegment[] {
  const incomingStageId = readStageIdFromEvent(event);
  const peers: WorkflowPeerActivity[] = [];
  for (const seg of segments) {
    if (seg.kind !== "tool") continue;
    if (seg.call.kind === "workflow") continue;
    const hinted =
      event.tool_call_id?.trim() && seg.call.key === event.tool_call_id.trim()
        ? incomingStageId
        : undefined;
    peers.push(peerActivityFromToolCall(seg.call, hinted));
  }
  if (peers.length === 0) {
    return segments;
  }

  return segments.map((seg) => {
    if (seg.kind !== "tool" || seg.call.kind !== "workflow") {
      return seg;
    }
    const stages = seg.call.workflowStages;
    if (!stages?.length) {
      return seg;
    }
    let reduced = stages;
    for (const peer of peers) {
      reduced = applyPeerActivityToWorkflowStages(reduced, peer, {
        workflowId: seg.call.key,
      });
    }
    return {
      kind: "tool" as const,
      call: { ...seg.call, workflowStages: reduced },
    };
  });
}

function finishToolSegments(
  segments: ChatTimelineTurnSegment[],
  event: ChatEvent,
): ChatTimelineTurnSegment[] {
  return reduceWorkflowPeerActivityInSegments(
    propagateSubagentParentCompletionInSegments(segments),
    event,
  );
}

/**
 * Upsert a tool_progress event into ordered segments.
 * Same key updates the existing tool segment in place (does not reorder).
 * New keys append a new tool segment at the end.
 * Subagent terminal status also completes linked parent spawn/wait tools (lp-dpr.6).
 */
function upsertToolInSegments(
  segments: ChatTimelineTurnSegment[],
  event: ChatEvent,
): ChatTimelineTurnSegment[] {
  const fields = mapToolCallFields(event);
  const label =
    event.tool_label?.trim() ||
    event.tool_name?.trim() ||
    event.content?.trim() ||
    "Working…";

  const hasWorkflowId = Boolean(
    (typeof event.metadata?.workflow_id === "string" &&
      event.metadata.workflow_id.trim()) ||
      (typeof event.metadata?.workflowId === "string" &&
        event.metadata.workflowId.trim()),
  );
  const hasStableId = Boolean(
    event.tool_call_id?.trim() ||
      event.tool_name?.trim() ||
      event.subagent_name?.trim() ||
      hasWorkflowId,
  );

  const toolCount = segments.filter((s) => s.kind === "tool").length;

  // Last tool segment (may not be the last segment overall — reasoning can follow).
  let lastToolIndex = -1;
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (segments[i]?.kind === "tool") {
      lastToolIndex = i;
      break;
    }
  }

  let next: ChatTimelineTurnSegment[];

  if (!hasStableId) {
    // Label-only progress: update last running tool segment if same label, else complete + append.
    if (lastToolIndex >= 0) {
      const lastSeg = segments[lastToolIndex];
      if (lastSeg?.kind === "tool") {
        const last = lastSeg.call;
        if (last.status === "running" || last.status === "pending") {
          if (
            last.name === fields.name ||
            last.target === label ||
            last.key === `label:${label}`
          ) {
            next = segments.map((seg, i) =>
              i === lastToolIndex && seg.kind === "tool"
                ? {
                    kind: "tool" as const,
                    call: mergeToolCall(seg.call, fields, seg.call.key),
                  }
                : seg,
            );
            return finishToolSegments(next, event);
          }
          const completedPrior = segments.map((seg, i) =>
            i === lastToolIndex &&
            seg.kind === "tool" &&
            (seg.call.status === "running" || seg.call.status === "pending")
              ? {
                  kind: "tool" as const,
                  call: { ...seg.call, status: "complete" as const },
                }
              : seg,
          );
          const key = toolCallKeyFromEvent(event, toolCount);
          next = [
            ...completedPrior,
            { kind: "tool" as const, call: mergeToolCall(undefined, fields, key) },
          ];
          return finishToolSegments(next, event);
        }
      }
    }
  }

  const key = toolCallKeyFromEvent(event, toolCount);
  const existingIndex = findToolSegmentIndex(segments, event, key);
  if (existingIndex >= 0) {
    const prev = segments[existingIndex];
    const incomingId = isWorkflowEvent(event)
      ? readWorkflowIdFromEvent(event)
      : undefined;
    const incomingEmpty =
      (fields.workflowStages?.length ?? 0) === 0 && !incomingId;
    if (
      incomingEmpty &&
      prev?.kind === "tool" &&
      prev.call.kind === "workflow" &&
      (prev.call.workflowStages?.length ?? 0) > 0
    ) {
      return segments;
    }
    const mergeKey = incomingId || (prev?.kind === "tool" ? prev.call.key : key);
    next = segments.map((seg, i) =>
      i === existingIndex && seg.kind === "tool"
        ? {
            kind: "tool" as const,
            call: mergeToolCall(seg.call, fields, mergeKey),
          }
        : seg,
    );
    return finishToolSegments(next, event);
  }

  next = [
    ...segments,
    { kind: "tool" as const, call: mergeToolCall(undefined, fields, key) },
  ];
  return finishToolSegments(next, event);
}

function completeRunningTools(
  toolCalls: ChatTimelineToolCall[],
): ChatTimelineToolCall[] {
  return toolCalls.map((call) =>
    call.status === "running" || call.status === "pending"
      ? { ...call, status: "complete" as const }
      : call,
  );
}

/** Complete running/pending tools and stop streaming reasoning segments. */
function finalizeSegments(
  segments: ChatTimelineTurnSegment[],
  options: { completeTools: boolean; stopReasoning: boolean },
): ChatTimelineTurnSegment[] {
  return segments.map((seg) => {
    if (seg.kind === "tool" && options.completeTools) {
      if (seg.call.status === "running" || seg.call.status === "pending") {
        return {
          kind: "tool" as const,
          call: { ...seg.call, status: "complete" as const },
        };
      }
      return seg;
    }
    if (seg.kind === "reasoning" && options.stopReasoning) {
      return { ...seg, isStreaming: false };
    }
    return seg;
  });
}

/**
 * Append or update a reasoning segment.
 * If the last segment is still-streaming reasoning, replace its content in place
 * (keeps the existing React key). Otherwise append a new reasoning segment with a
 * unique key so multi-tool turns with interleaved CoT do not collide (portal-0q7.9).
 */
function upsertReasoningInSegments(
  segments: ChatTimelineTurnSegment[],
  content: string,
  keyHint?: string,
): ChatTimelineTurnSegment[] {
  const last = segments[segments.length - 1];
  if (last?.kind === "reasoning" && last.isStreaming) {
    return segments.map((seg, i) =>
      i === segments.length - 1 && seg.kind === "reasoning"
        ? { ...seg, content, isStreaming: true }
        : seg,
    );
  }
  // message_id is stable for the whole turn — index makes each CoT block unique.
  const reasoningIndex = segments.filter((s) => s.kind === "reasoning").length;
  const base = keyHint?.trim() || "r";
  const key = `${base}-${reasoningIndex}`;
  return [
    ...segments,
    { kind: "reasoning", key, content, isStreaming: true },
  ];
}

/**
 * Defense-in-depth denylist mirroring Hermes
 * ``gateway/relay/portal_metadata.should_emit_portal_tool_progress``
 * (portal-0q7.11). Hides self-improve skill family from ChatToolCalls.
 */
const HIDDEN_SKILL_PROGRESS_TOOLS = new Set([
  "skill_view",
  "skill_manage",
  "skills_list",
]);

function normalizeSkillName(name: string): string {
  return name.trim().toLowerCase().replace(/_/g, "-");
}

function isSelfImproveSkillSegment(segment: string): boolean {
  const normalized = normalizeSkillName(segment);
  if (!normalized) return false;
  if (
    normalized === "self-improve" ||
    normalized === "self-improve-operations"
  ) {
    return true;
  }
  // Prefix cover for renames: self-improv* / self_improv*
  return normalized.startsWith("self-improv");
}

/**
 * True when *name* is in the self-improve skill family (portal-0q7.11).
 * Matches the whole string or any path segment (split on `/` and `:`) so
 * path-qualified names still hide, e.g. `software-development/self-improve-operations`,
 * `plugin:self-improve`. Non-family basenames stay visible (`…/architect`).
 */
function isSelfImproveSkillName(name: string | undefined | null): boolean {
  if (!name) return false;
  if (isSelfImproveSkillSegment(name)) return true;
  for (const segment of name.split(/[\/:]/)) {
    if (segment && isSelfImproveSkillSegment(segment)) return true;
  }
  return false;
}

function skillNameCandidatesFromEvent(event: ChatEvent): string[] {
  const out: string[] = [];
  const push = (raw: string | undefined | null) => {
    if (!raw?.trim()) return;
    let value = raw.trim().replace(/^["'`]+|["'`]+$/g, "");
    if (value.includes(":")) {
      value = value.split(":").slice(1).join(":").trim();
      value = value.replace(/^["'`]+|["'`]+$/g, "");
    }
    const token = value.split(/\s+/)[0] ?? value;
    if (token) out.push(token);
    if (raw.trim()) out.push(raw.trim());
  };
  push(event.tool_target);
  push(event.tool_label);
  push(event.content);
  const meta = event.metadata;
  if (meta && typeof meta === "object") {
    for (const key of ["name", "skill", "skill_name", "tool_target"] as const) {
      const val = (meta as Record<string, unknown>)[key];
      if (typeof val === "string") push(val);
    }
  }
  return out;
}

function isMailboxSendToolProgress(event: ChatEvent): boolean {
  const name = (event.tool_name ?? "").trim().toLowerCase();
  if (name === "mailbox.send" || name === "mailbox_send") return true;
  const meta = event.metadata;
  return Boolean(meta && typeof meta === "object" && "mailbox_send" in meta);
}

function mailboxInboundFromEvent(
  event: ChatEvent,
): { from_display_name: string } | undefined {
  const raw = event.metadata?.mailbox_inbound;
  if (!raw || typeof raw !== "object") return undefined;
  const rec = raw as Record<string, unknown>;
  const fromName =
    typeof rec.from_display_name === "string" ? rec.from_display_name.trim() : "";
  if (fromName) return { from_display_name: fromName };
  const speakerName = event.speaker?.display_name?.trim();
  return speakerName ? { from_display_name: speakerName } : undefined;
}

/** True when this tool_progress must not grow ChatToolCalls (self-improve*). */
function isHiddenSelfImproveSkillTool(event: ChatEvent): boolean {
  const toolName = (event.tool_name ?? "").trim().toLowerCase();
  if (!HIDDEN_SKILL_PROGRESS_TOOLS.has(toolName)) {
    return false;
  }
  const candidates = skillNameCandidatesFromEvent(event);
  const matched = candidates.some((c) => isSelfImproveSkillName(c));
  if (toolName === "skills_list") {
    // Only hide when clearly scoped to self-improve (same contract as Hermes).
    return matched;
  }
  return matched;
}

function applyToolProgress(
  items: ChatTimelineItem[],
  event: ChatEvent,
): ChatTimelineItem[] {
  // mailbox.send stays in history/activity; not a chat-transcript tool row.
  if (isMailboxSendToolProgress(event)) {
    return items;
  }
  // Hermes should not emit these; skip if they arrive anyway (portal-0q7.11).
  if (isHiddenSelfImproveSkillTool(event)) {
    return items;
  }

  // Re-open a closed turn when tools arrive after interim text.
  const speaker = speakerFromChatEvent(event);
  const want = speaker ? speakerKey(speaker) : undefined;
  let base = items;
  const openIndex = findOpenAssistantTurnIndex(items, speaker);
  if (openIndex < 0) {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (item?.type === "assistant_turn") {
        if (want && (!item.speaker || speakerKey(item.speaker) !== want)) {
          continue;
        }
        base = updateTurnAt(items, i, (turn) => ({
          ...turn,
          isStreaming: true,
        }));
        break;
      }
      if (
        item?.type === "user" ||
        item?.type === "mcq" ||
        item?.type === "tool_approval" ||
        item?.type === "connector.qr"
      ) {
        break;
      }
    }
  }

  const ensured = ensureOpenTurn(base, event.message_id, speaker);
  return updateTurnAt(ensured.items, ensured.index, (turn) => {
    const segments = upsertToolInSegments(turnSegments(turn), event);
    return withSegmentViews({ ...turn, isStreaming: true }, segments);
  });
}

function applyReasoning(
  items: ChatTimelineItem[],
  event: ChatEvent,
): ChatTimelineItem[] {
  const content = event.content ?? "";
  const ensured = ensureOpenTurn(
    items,
    event.message_id,
    speakerFromChatEvent(event),
  );
  return updateTurnAt(ensured.items, ensured.index, (turn) => {
    const segments = upsertReasoningInSegments(
      turnSegments(turn),
      content,
      event.message_id,
    );
    return withSegmentViews({ ...turn, isStreaming: true }, segments);
  });
}

/**
 * Whether this assistant message event should keep the turn open (still streaming).
 * Progressive Hermes edits and explicit non-final metadata stay open.
 */
export function isNonFinalAssistantEvent(
  event: ChatEvent,
  eventType: ChatEvent["type"],
): boolean {
  if (eventType === "message_edit") {
    // Final edit may carry finalize=true; intermediate edits stay open.
    const meta = event.metadata;
    if (meta?.finalize === true || meta?.final === true) {
      return false;
    }
    if (meta?.finalize === false || meta?.final === false) {
      return true;
    }
    if (meta?.streaming === true) {
      return true;
    }
    // Default: progressive edits keep the turn open.
    return true;
  }

  if (eventType === "message_send") {
    const meta = event.metadata;
    if (meta?.finalize === false || meta?.final === false) {
      return true;
    }
    if (meta?.streaming === true) {
      return true;
    }
    if (meta?.finalize === true || meta?.final === true) {
      return false;
    }
    // Default: message_send finalizes the answer segment.
    return false;
  }

  return false;
}

function applyAssistantMessage(
  items: ChatTimelineItem[],
  event: ChatEvent,
  eventType: ChatEvent["type"] = "message_send",
  projectVaultPath?: string | null,
): ChatTimelineItem[] {
  if (!event.content && !event.message_id) {
    return items;
  }

  const key = event.message_id ?? "streaming";
  const citations = resolveCitationList(
    parseCitations(event),
    projectVaultPath,
  );
  const model = parseModel(event);
  const createdAt = nowIso();
  const keepOpen = isNonFinalAssistantEvent(event, eventType);

  const speaker = speakerFromChatEvent(event);
  const byId = findTurnIndexById(items, key);
  // Prefer matching turn by id, else open streaming turn.
  // Only re-open a *closed* turn when this event is non-final (progressive stream).
  // Final message_send with a new id starts a new turn (separate answer).
  // Harness turn ids reset on LA restart (`msg_turn_3` reused). A later user
  // message means this id is a new answer, not an edit of the old bubble —
  // otherwise hydrate overwrites the earlier turn and the composer hangs
  // on a trailing `sent` user with no assistant after it.
  const byIdStillCurrent =
    byId >= 0 &&
    !items.slice(byId + 1).some((item) => item.type === "user")
      ? byId
      : -1;
  let openIndex =
    byIdStillCurrent >= 0
      ? byIdStillCurrent
      : findOpenAssistantTurnIndex(items, speaker);
  if (openIndex < 0 && keepOpen) {
    // Re-open last assistant turn after the most recent user (mid-turn segments).
    const want = speaker ? speakerKey(speaker) : undefined;
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (item?.type === "assistant_turn") {
        if (want && (!item.speaker || speakerKey(item.speaker) !== want)) {
          continue;
        }
        openIndex = i;
        break;
      }
      if (
        item?.type === "user" ||
        item?.type === "mcq" ||
        item?.type === "tool_approval" ||
        item?.type === "connector.qr"
      ) {
        break;
      }
    }
  }

  if (openIndex >= 0) {
    return updateTurnAt(items, openIndex, (turn) => {
      const baseSegments = turnSegments(turn);
      const segments = keepOpen
        ? baseSegments
        : finalizeSegments(baseSegments, {
            completeTools: true,
            stopReasoning: true,
          });
      const toolCalls = keepOpen
        ? toolCallsFromSegments(segments)
        : completeRunningTools(toolCallsFromSegments(segments));
      // Explicit gateway citations win; on finalize also promote file tool
      // targets + web tool / prose http(s) URLs as citation chips (lp-95v.5)
      // and subagent artifacts / nested vault paths (lp-uxy.2).
      // Never invent tool rows — only enrich citations from real tool streams
      // and/or URLs already present in the final answer.
      let nextCitations = citations ?? turn.citations;
      if (!keepOpen) {
        const fromFileTools = citationsFromToolCalls(
          toolCalls,
          projectVaultPath,
        );
        const fromSubagentArtifacts = citationsFromSubagentToolCalls(
          toolCalls,
          projectVaultPath,
        );
        const fromWebTools = webCitationsFromToolCalls(toolCalls);
        const fromContent = webCitationsFromContent(
          event.content ?? turn.content,
        );
        nextCitations =
          mergeCitations(
            mergeCitations(
              mergeCitations(
                mergeCitations(citations, fromFileTools),
                fromSubagentArtifacts,
              ),
              fromWebTools,
            ),
            fromContent,
          ) ?? turn.citations;
      }
      // Prefer host model; else keep prior turn stamp; else user-send model.
      const resolvedModel =
        model ?? turn.model ?? precedingUserModel(items, openIndex);
      const inbound = mailboxInboundFromEvent(event);
      const next: ChatTimelineAssistantTurn = {
        ...turn,
        id: key === "streaming" ? turn.id : key,
        content: event.content ?? turn.content,
        isStreaming: keepOpen ? true : false,
        citations: nextCitations,
        model: resolvedModel,
        createdAt: keepOpen
          ? turn.createdAt
          : (turn.createdAt ?? createdAt),
        ...(speaker && !turn.speaker ? { speaker } : {}),
        ...(inbound && !turn.mailboxInbound ? { mailboxInbound: inbound } : {}),
      };
      return withSegmentViews(next, segments);
    });
  }

  const inheritedModel = model ?? precedingUserModel(items, items.length);
  // New turn with no prior tool segments: still promote http(s) URLs from the
  // answer body so Sources lists become clickable chips (lp-95v.5).
  const seededCitations = keepOpen
    ? citations
    : mergeCitations(
        citations,
        webCitationsFromContent(event.content ?? ""),
      );
  const reusedId = items.some(
    (item) => item.type === "assistant_turn" && item.id === key,
  );
  const inbound = mailboxInboundFromEvent(event);
  return [
    ...items,
    {
      type: "assistant_turn",
      id: reusedId ? `${key}#${items.length}` : key,
      segments: [],
      toolCalls: [],
      content: event.content ?? "",
      isStreaming: keepOpen,
      citations: seededCitations,
      model: inheritedModel,
      createdAt: keepOpen ? undefined : createdAt,
      ...(speaker ? { speaker } : {}),
      ...(inbound ? { mailboxInbound: inbound } : {}),
    },
  ];
}

function upsertConnectorQrItem(
  items: ChatTimelineItem[],
  event: ChatEvent,
): ChatTimelineItem[] {
  const parsed = parseConnectorQrEvent(event);
  if (!parsed) {
    return items;
  }
  const nextItem: ChatTimelineConnectorQrItem = {
    type: "connector.qr",
    pairingId: parsed.pairing_id,
    code: parsed.code,
    phase: parsed.phase,
    ts: parsed.ts,
    ...(parsed.message ? { message: parsed.message } : {}),
  };
  const index = items.findIndex(
    (item) =>
      item.type === "connector.qr" && item.pairingId === parsed.pairing_id,
  );
  if (index >= 0) {
    const copy = items.slice();
    copy[index] = nextItem;
    return copy;
  }
  return [...items, nextItem];
}

export function upsertConnectorOAuthItem(
  items: ChatTimelineItem[],
  event: ChatEvent,
): ChatTimelineItem[] {
  const parsed = parseConnectorOAuthEvent(event);
  if (!parsed) return items;
  const nextItem: ChatTimelineConnectorOAuthItem = {
    type: "connector.oauth",
    connectorId: parsed.connector_id,
    phase: parsed.phase,
    ts: parsed.ts,
    ...(parsed.account_label ? { accountLabel: parsed.account_label } : {}),
  };
  // Success replaces connect for same connector (single card per connector).
  const index = items.findIndex(
    (item) => item.type === "connector.oauth" && item.connectorId === parsed.connector_id,
  );
  if (index >= 0) {
    const copy = items.slice();
    // Keep newer ts? Always replace with latest.
    copy[index] = nextItem;
    return copy;
  }
  return [...items, nextItem];
}

function upsertConnectorCliItem(
  items: ChatTimelineItem[],
  event: ChatEvent,
): ChatTimelineItem[] {
  const parsed = parseConnectorCliEvent(event);
  if (!parsed) return items;
  const nextItem: ChatTimelineConnectorCliItem = {
    type: "connector.cli",
    connectorId: "github",
    deviceCode: parsed.device_code,
    command: parsed.command,
    status: parsed.status,
    ts: parsed.ts,
  };
  const index = items.findIndex((item) => item.type === "connector.cli");
  if (index >= 0) {
    const copy = items.slice();
    copy[index] = nextItem;
    return copy;
  }
  return [...items, nextItem];
}

function appendMcqItem(
  items: ChatTimelineItem[],
  event: ChatEvent,
): ChatTimelineItem[] {
  if (!event.mcq_id || !event.choices?.length) {
    return items;
  }
  if (items.some((item) => item.type === "mcq" && item.mcqId === event.mcq_id)) {
    return items;
  }
  return [
    ...items,
    {
      type: "mcq",
      mcqId: event.mcq_id,
      messageId: event.message_id,
      content: event.content ?? "Choose one:",
      choices: event.choices,
      selectedChoiceId: null,
      disabled: false,
    },
  ];
}

function appendToolApprovalItem(
  items: ChatTimelineItem[],
  event: ChatEvent,
): ChatTimelineItem[] {
  const parsed = parseToolApprovalEvent(event);
  if (!parsed) {
    return items;
  }
  if (
    items.some(
      (item) =>
        item.type === "tool_approval" && item.approvalId === parsed.approvalId,
    )
  ) {
    return items;
  }
  return [...items, parsed];
}

export function applyChatEvent(
  items: ChatTimelineItem[],
  event: ChatEvent,
  projectVaultPath?: string | null,
): ChatTimelineItem[] {
  // Per-event isolation (lp-uxy.11): one corrupt tool_progress / message must not
  // wipe the whole timeline for live SSE or history hydrate.
  try {
    if (event.type === "system_notice") {
      const content =
        typeof event.content === "string" ? event.content.trim() : "";
      if (!content) {
        return items;
      }
      const messageId =
        typeof event.message_id === "string" && event.message_id.trim()
          ? event.message_id.trim()
          : `system-${items.length}`;
      if (
        items.some(
          (item) => item.type === "system_notice" && item.id === messageId,
        )
      ) {
        return items;
      }
      const createdAt =
        typeof event.created_at === "string" ? event.created_at : undefined;
      return [
        ...items,
        {
          type: "system_notice" as const,
          id: messageId,
          content,
          ...(createdAt ? { createdAt } : {}),
        },
      ];
    }
    if (event.type === "mcq") {
      return appendMcqItem(items, event);
    }
    if (
      event.type === "tool_approval" ||
      event.metadata?.portal_event === "tool.approval"
    ) {
      return appendToolApprovalItem(items, event);
    }
    if (
      event.type === "connector.qr" ||
      event.metadata?.portal_event === "connector.qr"
    ) {
      return upsertConnectorQrItem(items, event);
    }
    if (
      event.type === "connector.oauth" ||
      event.metadata?.portal_event === "connector.oauth" ||
      (typeof event.metadata?.portal_event === "string" &&
        event.metadata.portal_event.startsWith("connector.oauth"))
    ) {
      return upsertConnectorOAuthItem(items, event);
    }
    if (
      event.type === "connector.cli" ||
      event.metadata?.portal_event === "connector.cli" ||
      (typeof event.metadata?.portal_event === "string" &&
        event.metadata.portal_event.startsWith("connector.cli"))
    ) {
      return upsertConnectorCliItem(items, event);
    }
    if (event.type === "tool_progress") {
      return applyToolProgress(items, event);
    }
    if (event.type === "reasoning") {
      return applyReasoning(items, event);
    }
    if (event.type === "message_send" || event.type === "message_edit") {
      // Citation-only portal_event may arrive as message_send with citations metadata.
      // message_edit keeps the turn open (Hermes progressive stream); message_send finalizes
      // unless metadata marks the segment as non-final.
      return applyAssistantMessage(items, event, event.type, projectVaultPath);
    }
    if (event.type === "typing") {
      // Typing keeps pending UI alive without creating content.
      const speaker = speakerFromChatEvent(event);
      const want = speaker ? speakerKey(speaker) : undefined;
      const openIndex = findOpenAssistantTurnIndex(items, speaker);
      if (openIndex >= 0) {
        return updateTurnAt(items, openIndex, (turn) =>
          withTurnSpeaker({ ...turn, isStreaming: true }, speaker),
        );
      }
      // After a closed turn, re-open for more output.
      for (let i = items.length - 1; i >= 0; i -= 1) {
        const item = items[i];
        if (item?.type === "assistant_turn") {
          if (want && (!item.speaker || speakerKey(item.speaker) !== want)) {
            continue;
          }
          return updateTurnAt(items, i, (turn) =>
            withTurnSpeaker({ ...turn, isStreaming: true }, speaker),
          );
        }
        if (
          item?.type === "user" ||
          item?.type === "mcq" ||
          item?.type === "tool_approval" ||
          item?.type === "connector.qr" ||
          item?.type === "connector.oauth" ||
          item?.type === "connector.cli"
        ) {
          break;
        }
      }
    }
    return items;
  } catch {
    return items;
  }
}

/**
 * Max tool result body retained when hydrating durable history (lp-uxy.11).
 * Huge multi-MB tool outputs can OOM / blank ChatToolCalls CodeBlock on reload.
 */
export const MAX_HISTORY_TOOL_RESULT_CHARS = 48_000;

/**
 * Truncate a tool result string for history hydrate. Returns undefined for
 * non-strings so callers can leave the field unset.
 */
export function truncateHistoryToolResult(
  value: unknown,
  maxChars: number = MAX_HISTORY_TOOL_RESULT_CHARS,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (value.length <= maxChars) {
    return value;
  }
  const omitted = value.length - maxChars;
  return `${value.slice(0, maxChars)}\n…[truncated ${omitted} chars]`;
}

/**
 * Shrink oversized tool result bodies on history rows before reduce (lp-uxy.11).
 * Live SSE keeps full results; only durable hydrate is size-capped.
 */
export function sanitizeHistoryEventForHydrate(
  event: ChatHistoryEvent,
): ChatHistoryEvent {
  if (!event || typeof event !== "object") {
    return event;
  }
  if (event.type !== "tool_progress") {
    return event;
  }

  const patch: Partial<ChatEvent> = {};
  if (typeof event.result === "string") {
    const next = truncateHistoryToolResult(event.result);
    if (next !== undefined && next !== event.result) {
      patch.result = next;
    }
  }
  if (typeof event.result_detail === "string") {
    const next = truncateHistoryToolResult(event.result_detail);
    if (next !== undefined && next !== event.result_detail) {
      patch.result_detail = next;
    }
  }
  if (event.metadata && typeof event.metadata === "object") {
    let metaChanged = false;
    const nextMeta: Record<string, unknown> = { ...event.metadata };
    for (const key of ["result", "result_detail", "output", "stdout"] as const) {
      const raw = nextMeta[key];
      if (typeof raw === "string") {
        const next = truncateHistoryToolResult(raw);
        if (next !== undefined && next !== raw) {
          nextMeta[key] = next;
          metaChanged = true;
        }
      }
    }
    if (metaChanged) {
      patch.metadata = nextMeta;
    }
  }

  if (Object.keys(patch).length === 0) {
    return event;
  }
  return { ...event, ...patch };
}

/**
 * Map durable BFF/relay history events into timeline items for empty-cache hydrate.
 * Replays the same reducer as live SSE so tools/citations/reasoning reconstruct.
 *
 * Per-event try/catch (lp-uxy.11): a single corrupt history row must not fail
 * the whole thread hydrate or leave an empty/blank chat after hard reload.
 */
export function historyEventsToTimelineItems(
  events: ChatHistoryEvent[],
  projectVaultPath?: string | null,
): ChatTimelineItem[] {
  let items: ChatTimelineItem[] = [];
  if (!Array.isArray(events)) {
    return items;
  }
  for (const raw of events) {
    try {
      if (!raw || typeof raw !== "object") {
        continue;
      }
      const event = sanitizeHistoryEventForHydrate(raw);
      if (!event || typeof event !== "object" || !("type" in event)) {
        continue;
      }
      if (event.type === "user_message") {
        const messageId =
          typeof event.message_id === "string" && event.message_id.trim()
            ? event.message_id.trim()
            : `user-hist-${items.length}`;
        const content =
          typeof event.content === "string"
            ? event.content
            : event.content == null
              ? ""
              : String(event.content);
        const userModel =
          typeof event.model === "string" && event.model.trim()
            ? event.model.trim()
            : undefined;
        const createdAt =
          typeof event.created_at === "string" ? event.created_at : undefined;
        const speaker = speakerFromChatEvent(event);
        items = [
          ...items,
          {
            type: "user",
            id: messageId,
            content,
            status: "sent",
            ...(createdAt ? { createdAt } : {}),
            ...(userModel ? { model: userModel } : {}),
            ...(speaker ? { speaker } : {}),
          },
        ];
        continue;
      }
      if (event.type === "typing") {
        continue;
      }
      // applyChatEvent also isolates; outer catch covers sanitize/user_message.
      items = applyChatEvent(items, event, projectVaultPath);
    } catch {
      // Skip corrupt history row; keep partial timeline (lp-uxy.11).
      continue;
    }
  }
  return items;
}

export function useChatEvents({
  threadId,
  eventSourceFactory,
  onThreadItemsChange,
  onActiveThreadChatEvent,
  historyFetcher,
  projectVaultPath,
}: UseChatEventsOptions): UseChatEventsResult {
  const [items, setItems] = useState<ChatTimelineItem[]>([]);
  const [toolProgress, setToolProgress] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null);
  /** Active-thread only: cold wake "Agent starting…" / wake error (lp-6ty). */
  const [agentWakeStatus, setAgentWakeStatus] =
    useState<AgentWakeUiStatus | null>(null);
  const eventSourceFactoryRef = useRef(eventSourceFactory);
  const onThreadItemsChangeRef = useRef(onThreadItemsChange);
  const onActiveThreadChatEventRef = useRef(onActiveThreadChatEvent);
  const historyFetcherRef = useRef(historyFetcher);
  const projectVaultPathRef = useRef(projectVaultPath);
  const userMessageCounter = useRef(0);
  /** Session-local timeline cache so switching threads does not wipe history. */
  const timelineCacheRef = useRef(new Map<string, ChatTimelineItem[]>());
  const activeThreadIdRef = useRef<string | null>(null);
  /** Open SSE streams by thread id — active + any still-generating chats. */
  const sourcesRef = useRef(new Map<string, EventSource>());
  /** Threads that must keep SSE open until their response settles. */
  const retainStreamsRef = useRef(new Set<string>());
  /** Insertion order for eviction when over MAX_SSE_STREAMS. */
  const sourceOrderRef = useRef<string[]>([]);
  /** Threads currently hydrating from durable history API. */
  const hydratingRef = useRef(new Set<string>());
  /** SSE events buffered while history hydrate is in flight. */
  const hydrateBufferRef = useRef(new Map<string, ChatEvent[]>());
  /** Monotonic token so stale history responses do not overwrite newer state. */
  const hydrateGenerationRef = useRef(new Map<string, number>());
  /**
   * After halt/cancel, drop live SSE for the thread until the next user send.
   * Prevents late tool_progress / message_send from reopening a cancelled turn.
   */
  const ignoreEventsUntilNextUserSendRef = useRef(new Set<string>());

  eventSourceFactoryRef.current = eventSourceFactory;
  onThreadItemsChangeRef.current = onThreadItemsChange;
  onActiveThreadChatEventRef.current = onActiveThreadChatEvent;
  historyFetcherRef.current = historyFetcher;
  projectVaultPathRef.current = projectVaultPath;

  const publishThreadItems = useCallback(
    (id: string, next: ChatTimelineItem[]) => {
      timelineCacheRef.current.set(id, next);
      onThreadItemsChangeRef.current?.(id, next);
      if (activeThreadIdRef.current === id) {
        setItems(next);
      }
    },
    [],
  );

  const setItemsForThread = useCallback(
    (
      updater:
        | ChatTimelineItem[]
        | ((current: ChatTimelineItem[]) => ChatTimelineItem[]),
    ) => {
      const id = activeThreadIdRef.current;
      if (!id) {
        setItems((current) =>
          typeof updater === "function" ? updater(current) : updater,
        );
        return;
      }
      const current = timelineCacheRef.current.get(id) ?? [];
      const next =
        typeof updater === "function" ? updater(current) : updater;
      publishThreadItems(id, next);
    },
    [publishThreadItems],
  );

  const closeStream = useCallback((id: string) => {
    const source = sourcesRef.current.get(id);
    if (source) {
      source.close();
      sourcesRef.current.delete(id);
    }
    sourceOrderRef.current = sourceOrderRef.current.filter((x) => x !== id);
  }, []);

  const closeIdleStreams = useCallback(() => {
    const active = activeThreadIdRef.current;
    for (const id of [...sourcesRef.current.keys()]) {
      if (id === active) {
        continue;
      }
      if (retainStreamsRef.current.has(id)) {
        const cached = timelineCacheRef.current.get(id) ?? [];
        if (isChatResponsePending(cached, false)) {
          continue;
        }
        // Response settled — drop retain + stream.
        retainStreamsRef.current.delete(id);
      }
      closeStream(id);
    }
  }, [closeStream]);

  const ensureStream = useCallback(
    (id: string) => {
      const existing = sourcesRef.current.get(id);
      if (existing) {
        // Native EventSource goes CLOSED after a fatal error and will not
        // reconnect. Replace it so the next send/open is not stuck on a
        // dead handle while isChatResponsePending blocks Enter.
        if (existing.readyState !== EVENT_SOURCE_CLOSED) {
          return;
        }
        existing.close();
        sourcesRef.current.delete(id);
        sourceOrderRef.current = sourceOrderRef.current.filter((x) => x !== id);
      }

      // Evict idle background streams first if at cap.
      if (sourcesRef.current.size >= MAX_SSE_STREAMS) {
        closeIdleStreams();
      }
      if (sourcesRef.current.size >= MAX_SSE_STREAMS) {
        // Evict oldest non-active retain (still better than blocking new).
        for (const candidate of sourceOrderRef.current) {
          if (candidate === activeThreadIdRef.current) {
            continue;
          }
          closeStream(candidate);
          retainStreamsRef.current.delete(candidate);
          if (sourcesRef.current.size < MAX_SSE_STREAMS) {
            break;
          }
        }
      }

      const createEventSource =
        eventSourceFactoryRef.current ??
        ((url: string) => new EventSource(url, { withCredentials: true }));
      const eventSource = createEventSource(
        withApiBase(`/api/chat/threads/${id}/events`),
      );
      sourcesRef.current.set(id, eventSource);
      sourceOrderRef.current = [
        ...sourceOrderRef.current.filter((x) => x !== id),
        id,
      ];

      const onPayload = (raw: string) => {
        try {
          const parsed: unknown = JSON.parse(raw);

          // lp-u7z / lp-6ty: BFF wake frames on the same SSE connection.
          // Handle before cancel-suppress so a wake error still clears UI.
          const wakeEvent = parseAgentWakeLiveEvent(parsed);
          if (wakeEvent) {
            if (activeThreadIdRef.current === id) {
              setAgentWakeStatus(agentWakeUiStatusFromLiveEvent(wakeEvent));
              if (wakeEvent.type === "agent_starting") {
                setConnectionStatus(null);
              }
            }
            return;
          }

          const event = parsed as ChatEvent;

          // Cancelled generation: ignore late SSE until the user sends again.
          if (ignoreEventsUntilNextUserSendRef.current.has(id)) {
            return;
          }

          // While history hydrate is in flight, buffer live events and apply
          // them after the durable base is seeded (do not wipe hydrated items).
          if (hydratingRef.current.has(id)) {
            const buffered = hydrateBufferRef.current.get(id) ?? [];
            buffered.push(event);
            hydrateBufferRef.current.set(id, buffered);
            return;
          }

          // First normal chat frame after wake: clear starting chip.
          if (activeThreadIdRef.current === id) {
            setAgentWakeStatus((prev) =>
              prev?.kind === "starting" ? null : prev,
            );
          }

          const base = timelineCacheRef.current.get(id) ?? [];
          const next = applyChatEvent(
            base,
            event,
            projectVaultPathRef.current,
          );
          publishThreadItems(id, next);

          // Document pane routing: only the visible thread (lp-5q6.14).
          if (activeThreadIdRef.current === id) {
            onActiveThreadChatEventRef.current?.(event);
          }

          // Drop retain once the turn settles so we can close idle streams.
          if (
            retainStreamsRef.current.has(id) &&
            !isChatResponsePending(next, false)
          ) {
            retainStreamsRef.current.delete(id);
            if (activeThreadIdRef.current !== id) {
              // Defer close slightly so trailing final events aren't missed.
              window.setTimeout(() => {
                if (
                  activeThreadIdRef.current !== id &&
                  !retainStreamsRef.current.has(id)
                ) {
                  closeStream(id);
                }
              }, 2_000);
            }
          }

          if (activeThreadIdRef.current === id) {
            setToolProgress(null);
          }
        } catch {
          // Ignore malformed SSE payloads.
        }
      };

      for (const type of CHAT_EVENT_TYPES) {
        eventSource.addEventListener(type, (ev) => {
          const message = ev as MessageEvent;
          if (typeof message.data === "string") {
            onPayload(message.data);
          }
        });
      }

      // Named BFF wake events (event: agent_starting | agent_ready).
      for (const type of AGENT_WAKE_SSE_EVENT_TYPES) {
        eventSource.addEventListener(type, (ev) => {
          const message = ev as MessageEvent;
          if (typeof message.data === "string") {
            onPayload(message.data);
          }
        });
      }

      // BFF may emit wake failures as `event: error` (MessageEvent with data).
      // Connection-level errors are generic Events without data — show disconnect.
      eventSource.addEventListener("error", (ev) => {
        const message = ev as MessageEvent;
        if (typeof message.data === "string" && message.data.length > 0) {
          onPayload(message.data);
          return;
        }
        if (activeThreadIdRef.current === id) {
          setConnectionStatus(
            "SSE disconnected — retry by sending another message or refresh.",
          );
        }
        if (eventSource.readyState === EVENT_SOURCE_CLOSED) {
          closeStream(id);
          if (
            activeThreadIdRef.current === id ||
            retainStreamsRef.current.has(id)
          ) {
            window.setTimeout(() => {
              if (
                activeThreadIdRef.current === id ||
                retainStreamsRef.current.has(id)
              ) {
                ensureStream(id);
              }
            }, 500);
          }
        }
      });

      eventSource.onopen = () => {
        if (activeThreadIdRef.current === id) {
          setConnectionStatus(null);
        }
      };

      eventSource.onmessage = (ev) => {
        if (ev.data) {
          onPayload(ev.data);
        }
      };
    },
    [closeIdleStreams, closeStream, publishThreadItems],
  );

  const retainThreadStream = useCallback(
    (id: string) => {
      // Resume accepting SSE after halt/cancel. Retry reuses the user bubble
      // and never calls appendUserMessage, so clear suppress here too.
      ignoreEventsUntilNextUserSendRef.current.delete(id);
      retainStreamsRef.current.add(id);
      ensureStream(id);
    },
    [ensureStream],
  );

  const haltOpenAssistantTurn = useCallback(
    (reason = "Cancelled") => {
      const activeId = activeThreadIdRef.current;
      // Suppress late SSE before mutating timeline so re-open races cannot win.
      if (activeId) {
        ignoreEventsUntilNextUserSendRef.current.add(activeId);
        retainStreamsRef.current.delete(activeId);
        // Drop any SSE buffered during history hydrate for this turn.
        hydrateBufferRef.current.set(activeId, []);
      }
      setItemsForThread((current) => {
        const openIdx = findOpenAssistantTurnIndex(current);
        if (openIdx < 0) {
          // Mark last sending/sent user as not awaiting if no turn yet.
          return current.map((item, index) => {
            if (
              index === current.length - 1 &&
              item.type === "user" &&
              (item.status === "sending" || item.status === "sent")
            ) {
              return { ...item, status: "error" as const };
            }
            return item;
          });
        }
        const turn = current[openIdx];
        if (!turn || turn.type !== "assistant_turn") {
          return current;
        }
        const haltedSegments = turnSegments(turn).map((seg) => {
          if (seg.kind === "reasoning") {
            return { ...seg, isStreaming: false };
          }
          if (
            seg.call.status === "running" ||
            seg.call.status === "pending"
          ) {
            return {
              kind: "tool" as const,
              call: {
                ...seg.call,
                status: "error" as const,
                errorMessage: seg.call.errorMessage ?? reason,
              },
            };
          }
          return seg;
        });
        const next = [...current];
        next[openIdx] = withSegmentViews(
          {
            ...turn,
            isStreaming: false,
            content: turn.content?.trim()
              ? turn.content
              : `_(${reason})_`,
            createdAt: turn.createdAt ?? nowIso(),
          },
          haltedSegments,
        );
        return next;
      });
      setToolProgress(null);
    },
    [setItemsForThread],
  );

  const clearAgentWakeStatus = useCallback(() => {
    setAgentWakeStatus(null);
  }, []);

  const noteAgentStarting = useCallback((message?: string) => {
    const label =
      typeof message === "string" && message.trim()
        ? message.trim()
        : AGENT_STARTING_MESSAGE;
    setAgentWakeStatus({ kind: "starting", message: label });
    setConnectionStatus(null);
  }, []);

  const reset = useCallback(() => {
    const id = activeThreadIdRef.current;
    if (id) {
      timelineCacheRef.current.delete(id);
      retainStreamsRef.current.delete(id);
      ignoreEventsUntilNextUserSendRef.current.delete(id);
    }
    setItems([]);
    setToolProgress(null);
    setConnectionStatus(null);
    setAgentWakeStatus(null);
    userMessageCounter.current = 0;
  }, []);

  const appendUserMessage = useCallback(
    (content: string, options?: { model?: string }): string => {
      userMessageCounter.current += 1;
      const id = `user-${userMessageCounter.current}`;
      const activeId = activeThreadIdRef.current;
      if (activeId) {
        // New user turn resumes accepting SSE for this thread.
        ignoreEventsUntilNextUserSendRef.current.delete(activeId);
        retainStreamsRef.current.add(activeId);
        ensureStream(activeId);
      }
      const model = options?.model?.trim() || undefined;
      setItemsForThread((current) => [
        ...current,
        {
          type: "user",
          id,
          content,
          status: "sending",
          createdAt: nowIso(),
          ...(model ? { model } : {}),
        },
      ]);
      return id;
    },
    [ensureStream, setItemsForThread],
  );

  const updateUserMessageStatus = useCallback(
    (id: string, status: ChatMessageDeliveryStatus) => {
      setItemsForThread((current) =>
        current.map((item) => {
          if (item.type !== "user" || item.id !== id) {
            return item;
          }
          // Late HTTP resolve after cancel must not promote error → sent
          // (would hide Retry and stick isChatResponsePending).
          if (status === "sent" && item.status !== "sending") {
            return item;
          }
          return { ...item, status };
        }),
      );
    },
    [setItemsForThread],
  );

  const markMcqSelected = useCallback(
    (mcqId: string, choiceId: string) => {
      setItemsForThread((current) =>
        current.map((item) =>
          item.type === "mcq" && item.mcqId === mcqId
            ? { ...item, selectedChoiceId: choiceId, disabled: true }
            : item,
        ),
      );
    },
    [setItemsForThread],
  );

  const setMcqDisabled = useCallback(
    (mcqId: string, disabled: boolean) => {
      setItemsForThread((current) =>
        current.map((item) =>
          item.type === "mcq" && item.mcqId === mcqId
            ? { ...item, disabled }
            : item,
        ),
      );
    },
    [setItemsForThread],
  );

  const markToolApprovalSelected = useCallback(
    (approvalId: string, choiceId: string) => {
      setItemsForThread((current) =>
        current.map((item) =>
          item.type === "tool_approval" && item.approvalId === approvalId
            ? { ...item, selectedChoiceId: choiceId, disabled: true }
            : item,
        ),
      );
    },
    [setItemsForThread],
  );

  const setToolApprovalDisabled = useCallback(
    (approvalId: string, disabled: boolean) => {
      setItemsForThread((current) =>
        current.map((item) =>
          item.type === "tool_approval" && item.approvalId === approvalId
            ? { ...item, disabled }
            : item,
        ),
      );
    },
    [setItemsForThread],
  );

  const localBubbleCounter = useRef(0);

  const appendLocalAssistantTurn = useCallback(
    (content: string, options?: { id?: string }): string => {
      localBubbleCounter.current += 1;
      const id = options?.id?.trim() || `local-assistant-${localBubbleCounter.current}`;
      setItemsForThread((current) => [
        ...current,
        {
          type: "assistant_turn",
          id,
          segments: [],
          toolCalls: [],
          content,
          isStreaming: false,
          citations: [],
          createdAt: nowIso(),
        },
      ]);
      return id;
    },
    [setItemsForThread],
  );

  const appendLocalMcq = useCallback(
    (input: {
      mcqId: string;
      content: string;
      choices: McqChoice[];
      messageId?: string;
    }) => {
      const mcqId = input.mcqId.trim();
      if (!mcqId || !input.choices.length) {
        return;
      }
      setItemsForThread((current) => {
        const disabledPrior = current.map((item) =>
          item.type === "mcq" ? { ...item, disabled: true } : item,
        );
        if (
          disabledPrior.some(
            (item) => item.type === "mcq" && item.mcqId === mcqId && !item.disabled,
          )
        ) {
          // Active bubble for this id already present.
          return disabledPrior;
        }
        // Replace duplicate same mcq_id if any.
        const withoutDup = disabledPrior.filter(
          (item) => !(item.type === "mcq" && item.mcqId === mcqId),
        );
        return [
          ...withoutDup,
          {
            type: "mcq" as const,
            mcqId,
            ...(input.messageId ? { messageId: input.messageId } : {}),
            content: input.content,
            choices: input.choices,
            selectedChoiceId: null,
            disabled: false,
          },
        ];
      });
    },
    [setItemsForThread],
  );

  const upsertConnectorOAuth = useCallback(
    (input: {
      connectorId: "google" | "hubspot";
      phase: "connect" | "connected";
      accountLabel?: string | null;
    }) => {
      // Reuse the same parser-backed upsert as SSE/history (#622) via a synthetic event.
      const accountLabel = input.accountLabel?.trim() || undefined;
      const ts = Date.now();
      const event = {
        type: "connector.oauth" as const,
        connector_id: input.connectorId,
        phase: input.phase,
        ts,
        ...(accountLabel ? { account_label: accountLabel } : {}),
        metadata: {
          portal_event: "connector.oauth" as const,
          connector_id: input.connectorId,
          phase: input.phase,
          ts,
          ...(accountLabel ? { account_label: accountLabel } : {}),
        },
      } as unknown as ChatEvent;
      setItemsForThread((current) => upsertConnectorOAuthItem(current, event));
    },
    [setItemsForThread],
  );

  const prepareRegenerate = useCallback(
    (
      assistantTurnId: string,
    ): { userId: string; content: string } | null => {
      const turnIndex = items.findIndex(
        (item) =>
          (item.type === "assistant_turn" || item.type === "assistant") &&
          item.id === assistantTurnId,
      );
      if (turnIndex < 0) {
        return null;
      }

      let userId: string | null = null;
      let content: string | null = null;
      let truncateAfter = -1;
      for (let i = turnIndex - 1; i >= 0; i -= 1) {
        const item = items[i];
        if (item?.type === "user") {
          userId = item.id;
          content = item.content;
          truncateAfter = i;
          break;
        }
      }
      if (truncateAfter < 0 || !userId || !content) {
        return null;
      }

      // Keep user message; drop assistant turn and everything after.
      // Mark user as sending again so spinner stays pending until re-send settles.
      setItemsForThread(
        items.slice(0, truncateAfter + 1).map((item, index) =>
          index === truncateAfter && item.type === "user"
            ? { ...item, status: "sending" as const }
            : item,
        ),
      );

      return { userId, content };
    },
    [items, setItemsForThread],
  );

  useEffect(() => {
    const previousId = activeThreadIdRef.current;
    activeThreadIdRef.current = threadId;

    if (!threadId) {
      setItems([]);
      setToolProgress(null);
      setConnectionStatus(null);
      // Keep retained background streams alive so multi-chat can finish.
      closeIdleStreams();
      return;
    }

    // Load cached timeline for the newly selected thread (may include
    // background stream updates that arrived while another chat was focused).
    const cached = timelineCacheRef.current.get(threadId);
    setItems(cached ? [...cached] : []);
    setToolProgress(null);
    setConnectionStatus(null);
    // Wake status is active-thread only (not cached across switches).
    setAgentWakeStatus(null);

    // Empty session cache (hard reload / first open): hydrate from durable API.
    // Key presence means we already hydrated or wrote session items this SPA life.
    // Session-local cache remains the layer on top when already populated.
    const needsHydrate =
      !timelineCacheRef.current.has(threadId) &&
      !hydratingRef.current.has(threadId);
    if (needsHydrate) {
      hydratingRef.current.add(threadId);
      hydrateBufferRef.current.set(threadId, []);
      const generation =
        (hydrateGenerationRef.current.get(threadId) ?? 0) + 1;
      hydrateGenerationRef.current.set(threadId, generation);

      const fetchHistory =
        historyFetcherRef.current ?? fetchThreadHistory;

      void fetchHistory(threadId)
        .then((events) => {
          if (hydrateGenerationRef.current.get(threadId) !== generation) {
            return;
          }
          // Cancelled mid-hydrate: keep durable base only; drop buffered SSE.
          const suppressLive =
            ignoreEventsUntilNextUserSendRef.current.has(threadId);
          const buffered = suppressLive
            ? []
            : (hydrateBufferRef.current.get(threadId) ?? []);
          const current = timelineCacheRef.current.get(threadId) ?? [];

          // Empty history + no live events: mark cache known-empty (do not wipe
          // optimistic items if the user already sent while hydrate was in flight).
          if (events.length === 0 && buffered.length === 0) {
            if (!timelineCacheRef.current.has(threadId)) {
              timelineCacheRef.current.set(threadId, []);
            }
            return;
          }

          // No durable history but session already has items: only fold in SSE.
          if (events.length === 0 && current.length > 0) {
            let merged = current;
            for (const event of buffered) {
              merged = applyChatEvent(
                merged,
                event,
                projectVaultPathRef.current,
              );
              if (activeThreadIdRef.current === threadId) {
                onActiveThreadChatEventRef.current?.(event);
              }
            }
            publishThreadItems(threadId, merged);
            return;
          }

          // Seed from durable history, then replay any SSE that arrived mid-fetch.
          let next = historyEventsToTimelineItems(
            events,
            projectVaultPathRef.current,
          );
          for (const event of buffered) {
            next = applyChatEvent(
              next,
              event,
              projectVaultPathRef.current,
            );
            if (activeThreadIdRef.current === threadId) {
              onActiveThreadChatEventRef.current?.(event);
            }
          }
          publishThreadItems(threadId, next);
        })
        .catch(() => {
          if (hydrateGenerationRef.current.get(threadId) !== generation) {
            return;
          }
          // History unavailable — still apply buffered live SSE onto current cache
          // unless this generation was cancelled.
          if (ignoreEventsUntilNextUserSendRef.current.has(threadId)) {
            if (!timelineCacheRef.current.has(threadId)) {
              timelineCacheRef.current.set(threadId, []);
            }
            return;
          }
          let next = timelineCacheRef.current.get(threadId) ?? [];
          const buffered = hydrateBufferRef.current.get(threadId) ?? [];
          for (const event of buffered) {
            next = applyChatEvent(
              next,
              event,
              projectVaultPathRef.current,
            );
            if (activeThreadIdRef.current === threadId) {
              onActiveThreadChatEventRef.current?.(event);
            }
          }
          if (buffered.length > 0) {
            publishThreadItems(threadId, next);
          } else if (!timelineCacheRef.current.has(threadId)) {
            // Avoid re-fetching forever when the API is down.
            timelineCacheRef.current.set(threadId, []);
          }
        })
        .finally(() => {
          if (hydrateGenerationRef.current.get(threadId) === generation) {
            hydratingRef.current.delete(threadId);
            hydrateBufferRef.current.delete(threadId);
          }
        });
    }

    ensureStream(threadId);

    // Previous active chat: keep SSE if still generating; otherwise prune later.
    if (previousId && previousId !== threadId) {
      const prevItems = timelineCacheRef.current.get(previousId) ?? [];
      if (isChatResponsePending(prevItems, false)) {
        retainStreamsRef.current.add(previousId);
      }
      closeIdleStreams();
    }

    return () => {
      // Unmount only: close everything. Thread switches re-run effect without unmounting.
    };
  }, [threadId, ensureStream, closeIdleStreams, publishThreadItems]);

  // Unmount cleanup — close every SSE.
  useEffect(() => {
    return () => {
      for (const id of [...sourcesRef.current.keys()]) {
        closeStream(id);
      }
      retainStreamsRef.current.clear();
    };
  }, [closeStream]);

  return {
    items,
    toolProgress,
    connectionStatus,
    agentWakeStatus,
    clearAgentWakeStatus,
    noteAgentStarting,
    appendUserMessage,
    updateUserMessageStatus,
    markMcqSelected,
    setMcqDisabled,
    markToolApprovalSelected,
    setToolApprovalDisabled,
    appendLocalAssistantTurn,
    appendLocalMcq,
    upsertConnectorOAuth,
    prepareRegenerate,
    retainThreadStream,
    haltOpenAssistantTurn,
    reset,
  };
}
