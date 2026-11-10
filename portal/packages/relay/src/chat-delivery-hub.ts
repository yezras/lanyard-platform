import type { McqChoice, OutboundAction } from "@lanyard/shared";
import {
  parseConnectorQrOutboundMetadata,
  parseMcqOutboundMetadata,
} from "@lanyard/shared";

/** Portal-facing outbound events streamed to web chat subscribers. */
export type ChatOutboundEventType =
  | "message_send"
  | "message_edit"
  | "typing"
  | "tool_progress"
  | "reasoning"
  | "mcq"
  | "tool_approval"
  | "connector.qr";

/**
 * Channel mailbox send is a normal `message_send` (plus a wake of `to`).
 * Do not add a `mailbox_*` RelayChatEvent / SSE type.
 */
export const MAILBOX_CHANNEL_SEND_EVENT_TYPE = "message_send" as const;

/**
 * 1:1 hop origin notice is the existing BFF `ChatHistoryEvent` type.
 * app.ts already reads `system_notice` from history (succession ~1788) and
 * SSE `writeSSE` forwards `event.type` — no `mailbox_event` is needed.
 */
export const MAILBOX_ONE_TO_ONE_HOP_NOTICE_EVENT_TYPE = "system_notice" as const;

export type MailboxVisibleKind = "channel_send" | "one_to_one_hop_notice";

/** User-visible mailbox append → existing wire type. Never `mailbox_*`. */
export function mailboxVisibleEventType(
  kind: MailboxVisibleKind,
): "message_send" | "system_notice" {
  return kind === "channel_send"
    ? MAILBOX_CHANNEL_SEND_EVENT_TYPE
    : MAILBOX_ONE_TO_ONE_HOP_NOTICE_EVENT_TYPE;
}

/** Group-room author stamp (same shape as BFF `HistorySpeaker`). */
export type ChatSpeaker = {
  kind: "human" | "persona";
  id: string;
  display_name: string;
};

export type ChatOutboundCitation = {
  path: string;
  title: string;
  /** Optional excerpt for richer web citation cards (lp-uxy.7). */
  snippet?: string;
};

export type ChatToolCallStatus = "pending" | "running" | "complete" | "error";

/**
 * Structural artifact event snapshot (aligned with @lanyard/shared ArtifactEventWire).
 * Prefer shared `normalizeArtifactEventsFromChatEvent` at the consumer boundary;
 * relay retains raw `metadata` on durable history for re-parse (lp-5q6.11).
 */
export type ChatOutboundArtifactEvent = {
  portal_event: string;
  thread_id: string;
  artifact_id: string;
  vault_path: string;
  title: string;
  [key: string]: unknown;
};

export type ChatOutboundEvent = {
  type: ChatOutboundEventType;
  chat_id: string;
  message_id?: string;
  content?: string;
  /**
   * Outbound metadata (tool_progress, mcq, artifact.*, citations, …).
   * Durable history must retain this object for pane hydrate after reload.
   */
  metadata?: Record<string, unknown>;
  /** Set when type is tool_progress (from metadata.tool_label or content prefix). */
  tool_label?: string;
  tool_name?: string;
  tool_call_id?: string;
  tool_status?: ChatToolCallStatus;
  tool_target?: string;
  duration?: string;
  error_message?: string;
  errorMessage?: string;
  additions?: number;
  deletions?: number;
  node?: string;
  tool_kind?: string;
  subagent_name?: string;
  /** Tool result body for expandable ChatToolCalls resultDetail. */
  result?: string;
  /** Set when type is mcq (from metadata.portal_event === "mcq"). */
  mcq_id?: string;
  choices?: McqChoice[];
  /** Set when type is tool_approval (portal_event tool.approval). */
  approval_id?: string;
  gate?: "sticky" | "every_call";
  action_class?: string | null;
  mapped?: boolean;
  /** Set when type is connector.qr (WhatsApp pairing). */
  pairing_id?: string;
  code?: string;
  phase?: string;
  ts?: number;
  connector_id?: string | null;
  model?: string;
  citations?: ChatOutboundCitation[];
  /** Optional pre-parsed artifact events (lp-5q6.11). */
  artifact_events?: ChatOutboundArtifactEvent[];
  /** Set when retained for history (portal-wak.1). */
  created_at?: string;
  /** Group-room author stamp. Absent on 1:1. Also accepted on metadata.speaker. */
  speaker?: ChatSpeaker;
};

export type ChatSubscriber = (event: ChatOutboundEvent) => void;

/** Cap per-chat durable history (oldest dropped). */
const MAX_CHAT_HISTORY_EVENTS = 2_000;

/**
 * In-memory pub/sub keyed by `chat_id` (portal thread id).
 * WebPlatformAdapter publishes gateway outbound actions here before ack.
 *
 * Also retains a ring buffer of durable outbound events (excludes typing)
 * so the portal can hydrate transcripts after reload (portal-wak.1).
 */
export class ChatDeliveryHub {
  private readonly subscribers = new Map<string, Set<ChatSubscriber>>();
  private readonly history = new Map<string, ChatOutboundEvent[]>();

  subscribe(chatId: string, listener: ChatSubscriber): () => void {
    let set = this.subscribers.get(chatId);
    if (!set) {
      set = new Set();
      this.subscribers.set(chatId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) {
        this.subscribers.delete(chatId);
      }
    };
  }

  publish(event: ChatOutboundEvent): void {
    // Always retain durable history even with zero SSE subscribers.
    this.appendHistory(event);

    const set = this.subscribers.get(event.chat_id);
    if (!set) return;
    for (const listener of set) {
      listener(event);
    }
  }

  subscriberCount(chatId: string): number {
    return this.subscribers.get(chatId)?.size ?? 0;
  }

  /** Durable outbound events for reload hydrate (no typing). */
  listHistory(chatId: string): ChatOutboundEvent[] {
    return [...(this.history.get(chatId) ?? [])];
  }

  clearHistory(chatId: string): void {
    this.history.delete(chatId);
  }

  private appendHistory(event: ChatOutboundEvent): void {
    if (event.type === "typing") {
      return;
    }
    // Stamp for merge-ordering with BFF user_message events.
    const withTime: ChatOutboundEvent = {
      ...event,
      created_at: event.created_at ?? new Date().toISOString(),
    };

    const list = this.history.get(event.chat_id) ?? [];
    list.push(withTime);
    if (list.length > MAX_CHAT_HISTORY_EVENTS) {
      list.splice(0, list.length - MAX_CHAT_HISTORY_EVENTS);
    }
    this.history.set(event.chat_id, list);
  }
}

const TOOL_PROGRESS_PREFIX = "🔧 tool:";

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseChatSpeaker(value: unknown): ChatSpeaker | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const rec = value as Record<string, unknown>;
  const kind = rec.kind === "human" || rec.kind === "persona" ? rec.kind : undefined;
  const id = asString(rec.id);
  const displayName = asString(rec.display_name);
  if (!kind || !id || !displayName) {
    return undefined;
  }
  return { kind, id, display_name: displayName };
}

/** Speaker from metadata.speaker, metadata.persona, or metadata.persona_id. */
export function extractChatSpeaker(
  metadata: Record<string, unknown> | undefined,
): ChatSpeaker | undefined {
  if (!metadata) {
    return undefined;
  }
  const fromSpeaker = parseChatSpeaker(metadata.speaker);
  if (fromSpeaker) {
    return fromSpeaker;
  }
  const persona = metadata.persona;
  if (persona && typeof persona === "object" && !Array.isArray(persona)) {
    const rec = persona as Record<string, unknown>;
    const id = asString(rec.persona_id) ?? asString(rec.id);
    if (id) {
      return {
        kind: "persona",
        id,
        display_name: asString(rec.display_name) ?? id,
      };
    }
  }
  const personaId = asString(metadata.persona_id);
  if (personaId) {
    return {
      kind: "persona",
      id: personaId,
      display_name: asString(metadata.display_name) ?? personaId,
    };
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

/** Normalize duration from string or numeric milliseconds. */
export function formatToolDuration(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  const ms = asNumber(value);
  if (ms === undefined) {
    return undefined;
  }
  if (ms >= 1000) {
    const seconds = ms / 1000;
    const rounded =
      seconds >= 10 ? Math.round(seconds) : Math.round(seconds * 10) / 10;
    return `${rounded}s`;
  }
  return `${Math.round(ms)}ms`;
}

/**
 * Normalize host status strings onto pending | running | complete | error.
 * Accepts common backend aliases (Hermes, Lanyard Agent, OpenAI-style).
 * Keep in sync with web `normalizeChatToolCallStatus` (lp-dpr.3).
 */
export function parseToolStatus(value: unknown): ChatToolCallStatus | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const raw = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!raw) {
    return undefined;
  }
  if (
    raw === "pending" ||
    raw === "queued" ||
    raw === "waiting" ||
    raw === "scheduled" ||
    raw === "idle"
  ) {
    return "pending";
  }
  if (
    raw === "running" ||
    raw === "in_progress" ||
    raw === "started" ||
    raw === "start" ||
    raw === "active" ||
    raw === "progress" ||
    raw === "executing" ||
    raw === "working"
  ) {
    return "running";
  }
  if (
    raw === "complete" ||
    raw === "completed" ||
    raw === "done" ||
    raw === "success" ||
    raw === "succeeded" ||
    raw === "ok" ||
    raw === "finished" ||
    raw === "end" ||
    raw === "ended"
  ) {
    return "complete";
  }
  if (
    raw === "error" ||
    raw === "failed" ||
    raw === "failure" ||
    raw === "fail" ||
    raw === "cancelled" ||
    raw === "canceled" ||
    raw === "timeout" ||
    raw === "timed_out" ||
    raw === "aborted" ||
    raw === "abort"
  ) {
    return "error";
  }
  return undefined;
}

function isExplicitSubagentKind(
  metadata: Record<string, unknown> | undefined,
): boolean {
  if (!metadata) {
    return false;
  }
  const kind = asString(metadata.tool_kind) ?? asString(metadata.kind);
  return kind === "subagent" || kind === "agent";
}

function resolveSubagentName(
  metadata: Record<string, unknown> | undefined,
): string | undefined {
  if (!metadata) {
    return undefined;
  }
  return (
    asString(metadata.subagent_name) ??
    asString(metadata.subagent) ??
    asString(metadata.agent_name)
  );
}

export type DetectedToolProgress = {
  tool_label: string;
  tool_name?: string;
  tool_call_id?: string;
  tool_status?: ChatToolCallStatus;
  tool_target?: string;
  duration?: string;
  error_message?: string;
  errorMessage?: string;
  additions?: number;
  deletions?: number;
  node?: string;
  tool_kind?: string;
  subagent_name?: string;
  /** Expandable result body for ChatToolCalls resultDetail. */
  result?: string;
};

function extractRicherToolFields(
  metadata: Record<string, unknown> | undefined,
  opts?: { treatAsSubagent?: boolean },
): Partial<
  Omit<
    DetectedToolProgress,
    "tool_label" | "tool_name" | "tool_call_id" | "tool_status" | "tool_target"
  >
> {
  if (!metadata) {
    return {};
  }
  const errorMessage =
    asString(metadata.error_message) ??
    asString(metadata.errorMessage) ??
    asString(metadata.error);
  const subagentName = resolveSubagentName(metadata);
  const toolKind =
    asString(metadata.tool_kind) ??
    asString(metadata.kind) ??
    (opts?.treatAsSubagent ? "subagent" : undefined);
  const duration =
    formatToolDuration(metadata.duration) ??
    formatToolDuration(metadata.duration_ms) ??
    formatToolDuration(metadata.elapsed_ms);
  const additions = asNumber(metadata.additions);
  const deletions = asNumber(metadata.deletions);
  const node = asString(metadata.node) ?? asString(metadata.sandbox);
  const result =
    asString(metadata.result) ??
    asString(metadata.result_detail) ??
    asString(metadata.output) ??
    asString(metadata.stdout);

  const out: Partial<
    Omit<
      DetectedToolProgress,
      "tool_label" | "tool_name" | "tool_call_id" | "tool_status" | "tool_target"
    >
  > = {};
  if (duration !== undefined) out.duration = duration;
  if (errorMessage !== undefined) {
    out.error_message = errorMessage;
    out.errorMessage = errorMessage;
  }
  if (additions !== undefined) out.additions = additions;
  if (deletions !== undefined) out.deletions = deletions;
  if (node !== undefined) out.node = node;
  if (toolKind !== undefined) out.tool_kind = toolKind;
  if (subagentName !== undefined) out.subagent_name = subagentName;
  if (result !== undefined) out.result = result;
  return out;
}

/** Extract fenced code body from Hermes terminal progress content. */
export function extractFencedResult(content: string): string | undefined {
  const match = content.match(/```(?:\w+)?\n([\s\S]*?)```/);
  const body = match?.[1];
  if (typeof body === "string" && body.trim()) {
    return body.replace(/\n$/, "");
  }
  return undefined;
}

/**
 * Detect tool-progress signals from gateway outbound metadata or content prefix.
 *
 * Convention (documented in portal/README.md):
 * - `metadata.portal_event === "tool_progress"` and optional `metadata.tool_label`
 * - optional richer fields: tool_name, tool_call_id, tool_status, tool_target,
 *   duration, error_message/errorMessage, additions, deletions, node,
 *   tool_kind / subagent_name
 * - `metadata.portal_event === "subagent"` (or tool_kind subagent) maps as a tool row
 * - OR `content` prefixed with `🔧 tool: <label>`
 */
export function detectToolProgress(
  action: OutboundAction,
): DetectedToolProgress | null {
  const metadata = action.metadata;
  const portalEvent = asString(metadata?.portal_event);
  const explicitSubagent =
    portalEvent === "subagent" || isExplicitSubagentKind(metadata);

  // Accept tool_progress + adjacent host shapes (Lanyard Agent / non-Hermes).
  // workflow_progress (lp-dpr.7) dual-emits as the same SSE type with tool_kind=workflow.
  const isWorkflowPortalEvent =
    portalEvent === "workflow_progress" ||
    portalEvent === "workflow" ||
    (typeof portalEvent === "string" && portalEvent.startsWith("workflow."));
  const isToolPortalEvent =
    portalEvent === "tool_progress" ||
    portalEvent === "subagent" ||
    portalEvent === "tool" ||
    portalEvent === "tool_call" ||
    portalEvent === "agent_tool" ||
    isWorkflowPortalEvent ||
    (typeof portalEvent === "string" &&
      portalEvent.startsWith("tool.") &&
      portalEvent !== "tool.approval" &&
      portalEvent !== "needs_auth");

  if (isToolPortalEvent || explicitSubagent) {
    const isSubagent =
      !isWorkflowPortalEvent &&
      (portalEvent === "subagent" ||
        isExplicitSubagentKind(metadata) ||
        Boolean(
          resolveSubagentName(metadata) && portalEvent === "tool_progress",
        ));
    const richer = extractRicherToolFields(metadata, {
      treatAsSubagent: isSubagent,
    });

    const label =
      asString(metadata?.tool_label) ??
      asString(metadata?.workflow_name) ??
      asString(metadata?.task) ??
      asString(metadata?.target) ??
      asString(action.content) ??
      (isWorkflowPortalEvent
        ? "Workflow"
        : isSubagent
          ? "Subagent task"
          : "Working…");

    const subagentName = richer.subagent_name;
    const toolName = isWorkflowPortalEvent
      ? asString(metadata?.workflow_name) ??
        asString(metadata?.tool_name) ??
        "workflow"
      : isSubagent
        ? subagentName ?? asString(metadata?.tool_name) ?? "subagent"
        : asString(metadata?.tool_name);

    const toolTarget = isSubagent
      ? asString(metadata?.tool_target) ??
        asString(metadata?.task) ??
        label
      : asString(metadata?.tool_target) ??
        asString(metadata?.summary) ??
        asString(metadata?.target);

    const result: DetectedToolProgress = {
      tool_label: label,
      tool_status:
        parseToolStatus(metadata?.tool_status) ??
        parseToolStatus(metadata?.workflow_status) ??
        parseToolStatus(metadata?.status) ??
        parseToolStatus(metadata?.state) ??
        parseToolStatus(metadata?.phase) ??
        "running",
      ...richer,
    };
    if (toolName !== undefined) result.tool_name = toolName;
    const callId =
      asString(metadata?.tool_call_id) ??
      asString(metadata?.workflow_id) ??
      asString(metadata?.subagent_id) ??
      asString(metadata?.agent_id);
    if (callId !== undefined) result.tool_call_id = callId;
    if (toolTarget !== undefined) result.tool_target = toolTarget;
    if (isWorkflowPortalEvent) {
      result.tool_kind = "workflow";
    } else if (isSubagent && result.tool_kind === undefined) {
      result.tool_kind = "subagent";
    }
    if (subagentName !== undefined) result.subagent_name = subagentName;
    return result;
  }

  if (
    typeof action.content === "string" &&
    action.content.startsWith(TOOL_PROGRESS_PREFIX)
  ) {
    const label = action.content.slice(TOOL_PROGRESS_PREFIX.length).trim();
    return {
      tool_label: label || "Working…",
      tool_status: "running",
    };
  }

  // Hermes gateway tool chrome (no portal_event): emoji + tool verb/name lines.
  const hermes = detectHermesToolProgressContent(action.content);
  if (hermes) {
    return hermes;
  }

  return null;
}

/**
 * Hermes progress_callback formats tool chrome as plain text, e.g.:
 * - `🔍 Searching the web for "foo"`
 * - `💻 terminal: "ls -la"`
 * - multi-line accumulated progress bubbles (edit path)
 *
 * Treat content as tool progress only when *every non-empty line* looks like
 * tool chrome — never when mixed with assistant prose.
 */
export function detectHermesToolProgressContent(
  content: string | undefined,
): DetectedToolProgress | null {
  if (typeof content !== "string" || !content.trim()) {
    return null;
  }

  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return null;
  }

  // Fenced terminal blocks from Hermes verbose terminal progress:
  // "💻 terminal\n```\ncmd\n```" or "💻 terminal: \"ls\"\n```\noutput\n```"
  if (lines.some((line) => line.startsWith("```"))) {
    // Only lines *before* the first fence are headers; fence body is result.
    const firstFenceIdx = content.indexOf("```");
    const headerSection =
      firstFenceIdx >= 0 ? content.slice(0, firstFenceIdx) : content;
    const headerLines = headerSection
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (headerLines.length === 0 || !headerLines.every(looksLikeHermesToolLine)) {
      // Pure code fence without tool header is not tool chrome.
      return null;
    }
    const header = headerLines[headerLines.length - 1] ?? "Working…";
    const parsed = parseHermesToolLine(header);
    const fenceResult = extractFencedResult(content);
    // Prefer command preview in label as target when present: `terminal: "ls -la"`
    const colonTarget = parsed.label.match(/^[\w.-]+:\s*["'`](.+?)["'`]\s*$/);
    const result: DetectedToolProgress = {
      tool_label: parsed.label,
      tool_name: parsed.name,
      tool_status: fenceResult ? "complete" : "running",
    };
    if (colonTarget?.[1]) {
      result.tool_target = colonTarget[1];
    }
    if (fenceResult !== undefined) {
      result.result = fenceResult;
    }
    return result;
  }

  if (!lines.every(looksLikeHermesToolLine)) {
    return null;
  }

  const last = lines[lines.length - 1] ?? "Working…";
  const parsed = parseHermesToolLine(last);
  return {
    tool_label: parsed.label,
    tool_name: parsed.name,
    tool_status: "running",
  };
}

/** Leading emoji/symbol + rest — Hermes get_tool_emoji prefixes. */
const HERMES_TOOL_LINE =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u2600-\u27BF])(?:\uFE0F)?(?:\u200D(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:\uFE0F)?)*\s+(\S.*)$/u;

/** `tool_name: "preview"` / `tool_name...` without requiring emoji. */
const HERMES_TOOL_NAME_LINE =
  /^([a-zA-Z][\w.-]{0,64})(?:\.\.\.|:\s*["'`].+|:\s*.+|\([^)]*\))$/;

function looksLikeHermesToolLine(line: string): boolean {
  if (HERMES_TOOL_LINE.test(line)) {
    return true;
  }
  // Dedup counter suffix: "… (×3)"
  const withoutCount = line.replace(/\s*\(×\d+\)$/u, "");
  if (HERMES_TOOL_LINE.test(withoutCount)) {
    return true;
  }
  if (HERMES_TOOL_NAME_LINE.test(withoutCount)) {
    return true;
  }
  // Verb-only chrome without preview (e.g. "🔍 Searching")
  if (
    /^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u2600-\u27BF])/u.test(
      line,
    ) &&
    line.length <= 120
  ) {
    return true;
  }
  return false;
}

function parseHermesToolLine(line: string): { name?: string; label: string } {
  const cleaned = line.replace(/\s*\(×\d+\)$/u, "").trim();
  const emojiMatch = cleaned.match(HERMES_TOOL_LINE);
  if (emojiMatch?.[1]) {
    const rest = emojiMatch[1].trim();
    // `terminal: "cmd"` or `read_file: "path"`
    const nameColon = rest.match(/^([a-zA-Z][\w.-]{0,64})(?:\.\.\.|:|\()/);
    if (nameColon?.[1] && !/\s/.test(nameColon[1])) {
      return { name: nameColon[1], label: rest };
    }
    // Verb phrases: use full rest as label; first word as soft name.
    const firstWord = rest.split(/\s+/)[0];
    return {
      name: firstWord && firstWord.length < 40 ? firstWord : undefined,
      label: rest,
    };
  }
  const nameOnly = cleaned.match(HERMES_TOOL_NAME_LINE);
  if (nameOnly?.[1]) {
    return { name: nameOnly[1], label: cleaned };
  }
  return { label: cleaned || "Working…" };
}

/**
 * Detect chain-of-thought / reasoning signals from gateway outbound metadata.
 *
 * Convention:
 * - `metadata.portal_event === "reasoning"`
 * - optional `metadata.reasoning` string; falls back to `action.content`
 */
export function detectReasoning(
  action: OutboundAction,
): { content: string } | null {
  const metadata = action.metadata;
  if (metadata?.portal_event !== "reasoning") {
    return null;
  }

  if (typeof metadata.reasoning === "string" && metadata.reasoning.trim()) {
    return { content: metadata.reasoning };
  }

  if (typeof action.content === "string") {
    return { content: action.content };
  }

  return { content: "" };
}

export function detectMcq(
  action: OutboundAction,
): { mcq_id: string; prompt: string; choices: McqChoice[] } | null {
  return parseMcqOutboundMetadata(action);
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function parseApprovalChoices(value: unknown): McqChoice[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const choices: McqChoice[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const rec = entry as Record<string, unknown>;
    const id = asString(rec.id);
    const label = asString(rec.label);
    if (id && label) {
      choices.push({ id, label });
    }
  }
  return choices;
}

export function detectToolApproval(action: OutboundAction): {
  approval_id: string;
  prompt: string;
  choices: McqChoice[];
  gate: "sticky" | "every_call";
  action_class: string | null;
  mapped: boolean;
  connector_id: string | null;
} | null {
  const metadata = action.metadata;
  const portalEvent = asString(metadata?.portal_event);
  if (portalEvent !== "tool.approval") {
    return null;
  }
  const approval_id =
    asString(metadata?.approval_id) ?? asString(metadata?.approvalId);
  if (!approval_id) {
    return null;
  }
  const gateRaw = asString(metadata?.gate);
  const gate: "sticky" | "every_call" =
    gateRaw === "sticky" ? "sticky" : "every_call";
  const actionClass =
    asString(metadata?.action_class) ?? asString(metadata?.actionClass) ?? null;
  return {
    approval_id,
    prompt:
      asString(metadata?.content) ??
      asString(action.content) ??
      "Approve this command?",
    choices: parseApprovalChoices(metadata?.choices),
    gate,
    action_class: actionClass,
    mapped: asBoolean(metadata?.mapped) ?? false,
    connector_id:
      asString(metadata?.connector_id) ??
      asString(metadata?.connectorId) ??
      null,
  };
}

/** Extract vault citations from metadata.citations or portal_event citation. */
export function extractCitations(
  metadata: Record<string, unknown> | undefined,
): ChatOutboundCitation[] | undefined {
  if (!metadata) {
    return undefined;
  }

  const raw = metadata.citations;
  if (Array.isArray(raw)) {
    const out: ChatOutboundCitation[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const path =
        asString(record.path) ?? asString(record.url) ?? undefined;
      if (!path) {
        continue;
      }
      const title =
        asString(record.title) ?? path.split("/").pop() ?? path;
      const snippet =
        asString(record.snippet) ??
        asString(record.description) ??
        asString(record.summary) ??
        undefined;
      out.push({
        path,
        title,
        ...(snippet ? { snippet } : {}),
      });
    }
    if (out.length > 0) {
      return out;
    }
  }

  if (metadata.portal_event === "citation") {
    const path = asString(metadata.path) ?? asString(metadata.url);
    if (path) {
      const snippet =
        asString(metadata.snippet) ??
        asString(metadata.description) ??
        undefined;
      return [
        {
          path,
          title: asString(metadata.title) ?? path.split("/").pop() ?? path,
          ...(snippet ? { snippet } : {}),
        },
      ];
    }
  }

  return undefined;
}

export function extractModel(
  metadata: Record<string, unknown> | undefined,
): string | undefined {
  if (!metadata) {
    return undefined;
  }
  if (asString(metadata.model)) {
    return asString(metadata.model);
  }
  if (
    metadata.model &&
    typeof metadata.model === "object" &&
    asString((metadata.model as { name?: unknown }).name)
  ) {
    return asString((metadata.model as { name?: unknown }).name);
  }
  return asString(metadata.model_name);
}

/**
 * Hermes gateway setup nudge when the Relay platform has no home channel.
 *
 * Portal chat is multi-thread interactive; cron delivery is Slack-side, so a
 * single Relay home thread is the wrong model. Drop this notice so it never
 * reaches BFF/SSE/UI. Markers match hermes-agent `gateway/run.py`.
 */
export function isHermesHomeChannelSetupNotice(
  content: string | undefined | null,
): boolean {
  if (typeof content !== "string" || !content.trim()) {
    return false;
  }
  const text = content.trim();
  return (
    text.includes("No home channel is set for Relay") &&
    (text.includes("/sethome") ||
      text.includes("make this chat your home channel"))
  );
}

/**
 * Expand multi-line pure Hermes tool chrome into one DetectedToolProgress per line
 * so Portal ChatToolCalls shows every tool, not only the last line.
 */
export function expandHermesToolProgressLines(
  content: string | undefined,
): DetectedToolProgress[] {
  if (typeof content !== "string" || !content.trim()) {
    return [];
  }
  // Only expand pure chrome (same gate as detectHermesToolProgressContent).
  if (!detectHermesToolProgressContent(content)) {
    return [];
  }
  const firstFence = content.indexOf("```");
  const header = firstFence >= 0 ? content.slice(0, firstFence) : content;
  const lines = header
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length <= 1) {
    const single = detectHermesToolProgressContent(content);
    return single ? [single] : [];
  }
  const fenceResult = extractFencedResult(content);
  const out: DetectedToolProgress[] = [];
  lines.forEach((line, index) => {
    const parsed = parseHermesToolLine(line);
    const isLast = index === lines.length - 1;
    const item: DetectedToolProgress = {
      tool_label: parsed.label,
      tool_status:
        isLast && fenceResult !== undefined ? "complete" : "running",
      tool_call_id: `hermes-chrome:${index}:${parsed.name ?? parsed.label}`,
    };
    if (parsed.name) item.tool_name = parsed.name;
    const colonTarget = parsed.label.match(/^[\w.-]+:\s*["'`](.+?)["'`]\s*$/);
    if (colonTarget?.[1]) {
      item.tool_target = colonTarget[1];
    } else if (parsed.name && parsed.label.includes(":")) {
      const after = parsed.label.slice(parsed.label.indexOf(":") + 1).trim();
      if (after) {
        item.tool_target = after.replace(/^["'`]|["'`]$/g, "");
      }
    }
    if (isLast && fenceResult !== undefined) {
      item.result = fenceResult;
    }
    out.push(item);
  });
  return out;
}

function toolProgressToEvent(
  action: OutboundAction,
  toolProgress: DetectedToolProgress,
  messageId?: string,
): ChatOutboundEvent {
  return {
    type: "tool_progress",
    chat_id: action.chat_id!,
    message_id: messageId ?? action.message_id,
    tool_label: toolProgress.tool_label,
    tool_name: toolProgress.tool_name,
    tool_call_id: toolProgress.tool_call_id,
    tool_status: toolProgress.tool_status,
    tool_target: toolProgress.tool_target,
    duration: toolProgress.duration,
    error_message: toolProgress.error_message,
    errorMessage: toolProgress.errorMessage,
    additions: toolProgress.additions,
    deletions: toolProgress.deletions,
    node: toolProgress.node,
    tool_kind: toolProgress.tool_kind,
    subagent_name: toolProgress.subagent_name,
    result: toolProgress.result,
    content: action.content,
    metadata: action.metadata,
  };
}

/** One or more portal SSE events for a single gateway outbound action. */
export function outboundActionToChatEvents(
  action: OutboundAction,
  messageId?: string,
): ChatOutboundEvent[] {
  const single = outboundActionToChatEvent(action, messageId);
  if (!single) {
    return [];
  }
  const portalEvent =
    typeof action.metadata?.portal_event === "string"
      ? action.metadata.portal_event
      : undefined;
  // Structured portal_event already has one row per call — do not re-expand.
  const structuredToolPortal =
    portalEvent === "tool_progress" ||
    portalEvent === "subagent" ||
    portalEvent === "tool" ||
    portalEvent === "tool_call" ||
    portalEvent === "agent_tool" ||
    (typeof portalEvent === "string" &&
      portalEvent.startsWith("tool.") &&
      portalEvent !== "tool.approval" &&
      portalEvent !== "needs_auth");
  if (single.type === "tool_progress" && !structuredToolPortal) {
    const expanded = expandHermesToolProgressLines(action.content);
    if (expanded.length > 1) {
      return expanded.map((tp) => toolProgressToEvent(action, tp, messageId));
    }
  }
  return [single];
}

export function outboundActionToChatEvent(
  action: OutboundAction,
  messageId?: string,
): ChatOutboundEvent | null {
  if (!action.chat_id) return null;

  // Drop Hermes Relay home-channel setup noise before any chat event mapping.
  if (isHermesHomeChannelSetupNotice(action.content)) {
    return null;
  }

  const connectorQr = parseConnectorQrOutboundMetadata(action);
  if (connectorQr) {
    return {
      type: "connector.qr",
      chat_id: action.chat_id,
      message_id: messageId ?? action.message_id,
      content: action.content,
      metadata: action.metadata,
      pairing_id: connectorQr.pairing_id,
      code: connectorQr.code,
      phase: connectorQr.phase,
      ts: connectorQr.ts,
      connector_id: connectorQr.connector_id,
    };
  }

  const toolProgress = detectToolProgress(action);
  if (toolProgress) {
    return {
      type: "tool_progress",
      chat_id: action.chat_id,
      message_id: messageId ?? action.message_id,
      tool_label: toolProgress.tool_label,
      tool_name: toolProgress.tool_name,
      tool_call_id: toolProgress.tool_call_id,
      tool_status: toolProgress.tool_status,
      tool_target: toolProgress.tool_target,
      duration: toolProgress.duration,
      error_message: toolProgress.error_message,
      errorMessage: toolProgress.errorMessage,
      additions: toolProgress.additions,
      deletions: toolProgress.deletions,
      node: toolProgress.node,
      tool_kind: toolProgress.tool_kind,
      subagent_name: toolProgress.subagent_name,
      result: toolProgress.result,
      content: action.content,
      metadata: action.metadata,
    };
  }

  const reasoning = detectReasoning(action);
  if (reasoning) {
    return {
      type: "reasoning",
      chat_id: action.chat_id,
      message_id: messageId ?? action.message_id,
      content: reasoning.content,
      metadata: action.metadata,
    };
  }

  const approval = detectToolApproval(action);
  if (approval) {
    return {
      type: "tool_approval",
      chat_id: action.chat_id,
      message_id: messageId ?? action.message_id,
      content: approval.prompt,
      approval_id: approval.approval_id,
      choices: approval.choices,
      gate: approval.gate,
      action_class: approval.action_class,
      mapped: approval.mapped,
      connector_id: approval.connector_id,
      metadata: action.metadata,
    };
  }

  const mcq = detectMcq(action);
  if (mcq) {
    return {
      type: "mcq",
      chat_id: action.chat_id,
      message_id: messageId,
      content: mcq.prompt,
      mcq_id: mcq.mcq_id,
      choices: mcq.choices,
      metadata: action.metadata,
    };
  }

  const citations = extractCitations(action.metadata);
  const model = extractModel(action.metadata);
  const speaker = extractChatSpeaker(action.metadata);

  switch (action.op) {
    case "send":
      return {
        type: "message_send",
        chat_id: action.chat_id,
        message_id: messageId,
        content: action.content,
        metadata: action.metadata,
        citations,
        model,
        ...(speaker ? { speaker } : {}),
      };
    case "edit":
      return {
        type: "message_edit",
        chat_id: action.chat_id,
        message_id: action.message_id,
        content: action.content,
        metadata: action.metadata,
        citations,
        model,
      };
    case "typing":
      return {
        type: "typing",
        chat_id: action.chat_id,
        metadata: action.metadata,
      };
    default:
      return null;
  }
}
