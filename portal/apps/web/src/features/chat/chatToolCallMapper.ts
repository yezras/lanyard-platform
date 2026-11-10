/**
 * Pure mappers for agent tool events → Astryx ChatToolCalls lifecycle (lp-dpr.3).
 *
 * Boundary discipline: accept heterogeneous host shapes (Hermes structured
 * portal_event, Lanyard Agent aliases, chrome-normalized SSE) and emit the
 * canonical ChatToolCallStatus + display fields used by ChatTimeline.
 */

import type { ChatEvent, ChatToolCallStatus } from "../../api/types.js";

import {
  isSubagentEvent,
  normalizeSubagentStatus,
  parseSubagentArtifacts,
  subagentColor,
  subagentIconKey,
  type SubagentArtifact,
  type SubagentIconKey,
  type SubagentRunStatus,
} from "./subagentRun.js";
import {
  bareToolNameKey,
  isWebBrowseToolName,
  isWebSearchToolName,
} from "./webCitations.js";
import {
  chatToolStatusFromWorkflowStatus,
  isWorkflowEvent,
  mapWorkflowRunFromEvent,
  type WorkflowStage,
  type WorkflowStageStatus,
} from "./workflowRun.js";

// Re-export web tool classifiers for consumers / tests (lp-95v.5).
export {
  bareToolNameKey,
  isWebBrowseToolName,
  isWebSearchToolName,
} from "./webCitations.js";

/** Canonical Astryx ChatToolCalls statuses. */
export type { ChatToolCallStatus };

/** Re-export subagent / workflow detect for consumers / tests. */
export { isSubagentEvent, isWorkflowEvent };

/**
 * Normalize host/status strings onto pending | running | complete | error.
 * Accepts common backend aliases (OpenAI/Anthropic/Hermes/Lanyard Agent).
 */
export function normalizeChatToolCallStatus(
  value: unknown,
): ChatToolCallStatus | undefined {
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

/**
 * Resolve tool_status from top-level SSE fields and/or metadata.
 * Defaults to `running` when the host omitted status (live progress chrome).
 */
export function resolveToolStatusFromEvent(
  event: Pick<ChatEvent, "tool_status" | "metadata">,
  fallback: ChatToolCallStatus = "running",
): ChatToolCallStatus {
  const top = normalizeChatToolCallStatus(event.tool_status);
  if (top) {
    return top;
  }
  const meta = event.metadata;
  if (meta && typeof meta === "object") {
    for (const key of [
      "tool_status",
      "status",
      "state",
      "phase",
    ] as const) {
      const next = normalizeChatToolCallStatus(
        (meta as Record<string, unknown>)[key],
      );
      if (next) {
        return next;
      }
    }
  }
  return fallback;
}

/**
 * Tool names that are "context gathering" (reads/searches/lists).
 * Used to collapse noisy consecutive rows into a summary label.
 */
const CONTEXT_GATHERING_NAME_RE =
  /^(read|read_file|cat|open|view|show|head|tail|vault_search|search_files|search|grep|glob|find|list_dir|list|ls|tree|web_search|web_fetch|fetch|browse|get_file|file_read|rg|fd|parse_document|extract_document_text)$/i;

/** Normalize tool ids / kinds to snake_case keys for table lookups. */
export function normalizeToolNameKey(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * True when a string looks like a machine tool id (snake_case or known singleton)
 * rather than a human activity phrase.
 */
export function looksLikeTechnicalToolId(
  value: string | null | undefined,
): boolean {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return false;
  }
  // Multi-word / spaced labels are human (e.g. "Searching vault").
  if (/\s/.test(raw) || raw.includes("…") || raw.includes("...")) {
    return false;
  }
  const key = normalizeToolNameKey(raw);
  if (!key) {
    return false;
  }
  if (key.includes("_")) {
    return true;
  }
  // Known single-token tool ids that would otherwise look like words.
  if (
    key === "bash" ||
    key === "shell" ||
    key === "sh" ||
    key === "zsh" ||
    key === "cmd" ||
    key === "grep" ||
    key === "rg" ||
    key === "fd" ||
    key === "find" ||
    key === "glob" ||
    key === "search" ||
    key === "read" ||
    key === "cat" ||
    key === "open" ||
    key === "view" ||
    key === "show" ||
    key === "head" ||
    key === "tail" ||
    key === "list" ||
    key === "ls" ||
    key === "tree" ||
    key === "write" ||
    key === "edit" ||
    key === "patch" ||
    key === "fetch" ||
    key === "browse" ||
    key === "cron" ||
    key === "cronjob" ||
    key === "jobs" ||
    key === "schedule" ||
    key === "scheduler" ||
    key === "spawn" ||
    key === "task" ||
    key === "wait" ||
    key === "delegate" ||
    key === "terminal" ||
    key === "execute" ||
    key === "subagent"
  ) {
    return true;
  }
  // camelCase tool ids (spawnSubagent) — treat as technical.
  if (/^[a-z]+[A-Z]/.test(raw)) {
    return true;
  }
  return false;
}

/** Helper-agent spawn / wait / poll tools (group under one activity verb). */
export function isHelperAgentToolName(
  toolName: string | null | undefined,
): boolean {
  const n = normalizeToolNameKey(toolName);
  if (!n) {
    return false;
  }
  if (
    n === "task" ||
    n === "spawn" ||
    n === "spawn_subagent" ||
    n === "spawn_agent" ||
    n === "run_subagent" ||
    n === "run_agent" ||
    n === "delegate" ||
    n === "invoke_agent" ||
    n === "agent_task" ||
    n === "wait" ||
    n === "wait_for" ||
    n === "wait_for_subagent" ||
    n === "wait_for_agent" ||
    n === "subagent_wait" ||
    n === "get_subagent_output" ||
    n === "get_subagent" ||
    n === "subagent_output" ||
    n === "check_subagent" ||
    n === "poll_subagent" ||
    n === "read_subagent_output"
  ) {
    return true;
  }
  if (n.includes("spawn") && (n.includes("agent") || n.includes("subagent"))) {
    return true;
  }
  if (
    n.includes("wait") &&
    (n.includes("agent") || n.includes("subagent") || n.includes("task"))
  ) {
    return true;
  }
  if (
    (n.includes("subagent") || n.includes("agent")) &&
    (n.includes("output") || n.includes("result") || n.includes("poll"))
  ) {
    return true;
  }
  return false;
}

/** Shell / terminal tools whose argv must not appear in default ChatToolCalls. */
export function isShellToolName(toolName: string | null | undefined): boolean {
  const n = normalizeToolNameKey(toolName);
  return (
    n === "bash" ||
    n === "shell" ||
    n === "sh" ||
    n === "zsh" ||
    n === "cmd" ||
    n === "terminal" ||
    n === "run_terminal_cmd" ||
    n === "run_terminal_command" ||
    n === "execute" ||
    n === "exec" ||
    n === "run_command" ||
    n === "shell_command"
  );
}

/**
 * True when the default ChatToolCalls row should omit `target` (raw argv /
 * spawn args). Technical detail stays available via `technicalName` + advanced.
 */
export function shouldHideToolTargetInDefaultUi(
  toolName: string | null | undefined,
  options?: { toolKind?: string | null },
): boolean {
  const kind = normalizeToolNameKey(options?.toolKind);
  if (kind === "subagent" || kind === "workflow") {
    return false;
  }
  const n = normalizeToolNameKey(toolName);
  if (!n) {
    return false;
  }
  if (isShellToolName(n) || isHelperAgentToolName(n)) {
    return true;
  }
  return false;
}

export type HumanToolActivityLabelOptions = {
  /** Host tool_kind (subagent / workflow / …). */
  toolKind?: string | null;
  /**
   * Host-provided tool_label when it is already human language
   * (e.g. "Searching vault index"). Prefer over raw tool_name mapping.
   */
  hostLabel?: string | null;
};

/**
 * Map tool_name / tool_kind → high-level activity verb for ChatToolCalls (lp-vnz.9).
 *
 * Default UI must never show raw identifiers like `bash`, `grep`,
 * `spawn_subagent`, or shell argv — only friendly verbs
 * (Searching files, Reading documents, Running a helper agent, …).
 *
 * Idempotent for already-friendly host labels. Subagent identity names and
 * workflow titles are not remapped here (handled by kind-specific paths).
 */
/**
 * Host labels that are real activity chrome (not argv / paths).
 * e.g. "Searching vault index" — yes; "yarn test" / "/Projects/a.md" — no.
 */
function isHumanActivityHostLabel(value: string): boolean {
  const host = value.trim();
  if (!host || looksLikeTechnicalToolId(host)) {
    return false;
  }
  // Absolute / relative paths are targets, not labels.
  if (host.startsWith("/") || /^[\w./-]+\.\w{1,12}$/.test(host)) {
    return false;
  }
  // Shell-ish argv: flags, pipes, &&, or multi-token commands without a verb phrase.
  if (/[|;&]/.test(host) || /\s-{1,2}\w/.test(host)) {
    return false;
  }
  // "skill_view: architect" / "tool: target" host chrome — not user language.
  if (/^[a-z][a-z0-9_]*\s*:/i.test(host)) {
    return false;
  }
  const firstToken = host.split(/\s+/)[0] ?? "";
  if (looksLikeTechnicalToolId(firstToken.replace(/:$/, ""))) {
    return false;
  }
  // Prefer labels that already read as activity language.
  if (
    /^(searching|reading|writing|editing|listing|running|checking|browsing|using|looking|fetching|opening|scanning|reviewing|analyzing|loading|building|testing|deploying|parsing|managing|scheduling|starting)\b/i.test(
      host,
    )
  ) {
    return true;
  }
  // Short multi-word phrases without path separators are OK ("vault index scan").
  if (/\s/.test(host) && !host.includes("/") && host.length <= 48) {
    // Reject obvious command forms: first token is a common binary.
    const first = firstToken.toLowerCase();
    if (
      first === "yarn" ||
      first === "npm" ||
      first === "pnpm" ||
      first === "node" ||
      first === "python" ||
      first === "python3" ||
      first === "pip" ||
      first === "cargo" ||
      first === "go" ||
      first === "make" ||
      first === "docker" ||
      first === "kubectl" ||
      first === "git" ||
      first === "curl" ||
      first === "wget" ||
      first === "ls" ||
      first === "cd" ||
      first === "cat" ||
      first === "echo" ||
      first === "bash" ||
      first === "sh"
    ) {
      return false;
    }
    return true;
  }
  return false;
}

export function humanToolActivityLabel(
  toolName: string | null | undefined,
  options?: HumanToolActivityLabelOptions,
): string {
  const technicalKey = normalizeToolNameKey(toolName);
  // Shell / helper-agent tools: never surface argv or spawn ids as the row label.
  if (isShellToolName(technicalKey)) {
    return "Running a command";
  }
  if (isHelperAgentToolName(technicalKey) || technicalKey === "subagent") {
    return "Running a helper agent";
  }

  const host = options?.hostLabel?.trim() || "";
  if (host && isHumanActivityHostLabel(host)) {
    return host;
  }

  const kind = normalizeToolNameKey(options?.toolKind);
  if (kind === "subagent") {
    // Kind-only hint without a display name — still avoid raw spawn ids.
    const n = normalizeToolNameKey(toolName);
    if (!n || isHelperAgentToolName(n) || n === "subagent") {
      return "Running a helper agent";
    }
    // Named subagent identity (Researcher) — preserve.
    if (!looksLikeTechnicalToolId(toolName)) {
      return toolName!.trim();
    }
  }

  const raw = toolName?.trim() || host;
  if (!raw) {
    return "Working…";
  }
  if (!looksLikeTechnicalToolId(raw)) {
    // Non-technical fallback (label-only chrome) — still reject bare argv.
    if (host && raw === host && !isHumanActivityHostLabel(host)) {
      return "Working…";
    }
    return raw;
  }

  const n = normalizeToolNameKey(raw);

  if (isHelperAgentToolName(n) || n === "subagent") {
    return "Running a helper agent";
  }

  if (isShellToolName(n)) {
    return "Running a command";
  }

  // Schedule / cron / scheduled tasks (lp-su0 + lp-uxy.4 + lp-jzl.6 D1)
  // Backend tool ids stay cron/job; user-facing chrome uses scheduled task language.
  // Prefer start/run verbs over generic "Checking schedule" so running tasks
  // show a clear activity indicator in the chat timeline.
  if (
    n === "start_job" ||
    n === "job_start" ||
    n === "run_job" ||
    n === "job_run" ||
    n === "cron_run" ||
    n === "run_cron" ||
    n === "start_task" ||
    n === "run_task" ||
    n === "task_start" ||
    n === "task_run" ||
    n.endsWith("_start_job") ||
    n.endsWith("_run_job") ||
    n.endsWith("_start_task") ||
    n.endsWith("_run_task")
  ) {
    return "Starting task";
  }
  // Create-oriented names (NL "schedule a daily task") → Scheduling a task
  if (
    n === "cron_create" ||
    n === "create_cron" ||
    n === "cron_add" ||
    n === "add_cron" ||
    n === "schedule_job" ||
    n === "create_job" ||
    n === "job_create" ||
    n === "job_schedule" ||
    n === "schedule_task" ||
    n === "create_task" ||
    n === "task_create" ||
    n === "task_schedule" ||
    (n.includes("cron") &&
      /(create|add|schedule)/.test(n) &&
      !/(list|get|check|view|status|show)/.test(n))
  ) {
    return "Scheduling a task";
  }
  // LA unified tool + manage/update family
  if (
    n === "cronjob" ||
    n === "cron_job" ||
    n === "cron_manage" ||
    n === "manage_cron" ||
    n === "cron_update" ||
    n === "update_cron" ||
    (n.includes("cron") &&
      /(update|delete|remove|save|manage)/.test(n) &&
      !/(list|get|check|view|status|show)/.test(n))
  ) {
    return "Managing scheduled tasks";
  }
  if (
    n === "cron" ||
    n === "schedule" ||
    n === "scheduler" ||
    n === "list_cron" ||
    n === "list_schedule" ||
    n === "check_schedule" ||
    n === "get_schedule" ||
    n === "cron_list" ||
    n === "list_jobs" ||
    n === "jobs" ||
    n.includes("cron") ||
    n.includes("schedule")
  ) {
    return "Checking schedule";
  }

  // Prefer bare id after MCP/server qualification (server__web_search → web_search).
  const bare = bareToolNameKey(n) || n;

  // Web search vs browse vs file search (lp-95v.5 / lp-uxy.7 Firecrawl + X)
  if (isWebSearchToolName(n) || isWebSearchToolName(bare)) {
    return "Searching the web";
  }
  // Firecrawl scrape/crawl keeps browse verb (content extract, not SERP).
  if (isWebBrowseToolName(n) || isWebBrowseToolName(bare)) {
    return "Browsing the web";
  }

  // Office / PDF → Markdown host tool (lp-uxy.10 F4). Prefer host tool_label
  // via isHumanActivityHostLabel above when present; map both locked ids here.
  if (
    bare === "parse_document" ||
    bare === "extract_document_text" ||
    n === "parse_document" ||
    n === "extract_document_text"
  ) {
    return "Parsing a document";
  }

  // File / vault search (after web classifiers so tavily_search is not "files")
  if (
    bare === "grep" ||
    bare === "rg" ||
    bare === "fd" ||
    bare === "find" ||
    bare === "glob" ||
    bare === "search" ||
    bare === "search_files" ||
    bare === "vault_search" ||
    bare === "codebase_search" ||
    bare === "semantic_search" ||
    bare === "file_search" ||
    bare.endsWith("_search") ||
    bare.startsWith("search_")
  ) {
    return "Searching files";
  }

  // Read documents
  if (
    n === "read" ||
    n === "read_file" ||
    n === "cat" ||
    n === "open" ||
    n === "view" ||
    n === "show" ||
    n === "head" ||
    n === "tail" ||
    n === "get_file" ||
    n === "file_read" ||
    n === "open_file" ||
    n.startsWith("read_")
  ) {
    return "Reading documents";
  }

  // List
  if (
    n === "list_dir" ||
    n === "list" ||
    n === "ls" ||
    n === "tree" ||
    n === "listdir" ||
    n === "list_files" ||
    n.startsWith("list_")
  ) {
    return "Listing files";
  }

  // Write / edit
  if (
    n === "write" ||
    n === "write_file" ||
    n === "create_file" ||
    n === "save" ||
    n === "save_file" ||
    n.startsWith("write_")
  ) {
    return "Writing a document";
  }
  if (
    n === "edit" ||
    n === "edit_file" ||
    n === "str_replace" ||
    n === "apply_patch" ||
    n === "patch" ||
    n === "search_replace" ||
    n.startsWith("edit_")
  ) {
    return "Editing a document";
  }

  // Skills
  if (n.startsWith("skill_") || n === "skill" || n === "use_skill") {
    return "Using a skill";
  }

  // Memory
  if (n.includes("memory") || n === "remember" || n === "recall") {
    return "Checking memory";
  }

  // Fallback: prettify snake_case rather than show raw id.
  const pretty = n
    .split("_")
    .filter(Boolean)
    .map((part, i) =>
      i === 0
        ? part.charAt(0).toUpperCase() + part.slice(1)
        : part.toLowerCase(),
    )
    .join(" ");
  return pretty || "Working…";
}

/**
 * Resolve display name + optional technical id for a tool row (lp-vnz.9).
 * Used by mapToolCallFields and ChatTimeline so default UI stays friendly.
 */
export function resolveToolActivityDisplay(input: {
  toolName?: string | null;
  toolLabel?: string | null;
  toolKind?: string | null;
  /** When kind is subagent/workflow, keep identity title as-is. */
  preserveIdentityName?: boolean;
  identityName?: string | null;
}): { name: string; technicalName?: string } {
  if (input.preserveIdentityName) {
    const identity =
      input.identityName?.trim() ||
      input.toolLabel?.trim() ||
      input.toolName?.trim() ||
      "Working…";
    const technical =
      input.toolName?.trim() && looksLikeTechnicalToolId(input.toolName)
        ? input.toolName.trim()
        : undefined;
    return technical && technical !== identity
      ? { name: identity, technicalName: technical }
      : { name: identity };
  }

  const technicalCandidate =
    (input.toolName?.trim() && looksLikeTechnicalToolId(input.toolName)
      ? input.toolName.trim()
      : undefined) ||
    (input.toolLabel?.trim() && looksLikeTechnicalToolId(input.toolLabel)
      ? input.toolLabel.trim()
      : undefined);

  const name = humanToolActivityLabel(input.toolName ?? input.toolLabel, {
    toolKind: input.toolKind,
    hostLabel: input.toolLabel,
  });

  if (technicalCandidate && technicalCandidate !== name) {
    return { name, technicalName: technicalCandidate };
  }
  return { name };
}

/**
 * True when a tool call is a read/search style context-gathering operation.
 * Write/edit/bash/subagent tools are never collapsed under this label.
 * Prefers `technicalName` when present so friendly display labels still collapse.
 */
export function isContextGatheringTool(call: {
  name: string;
  technicalName?: string;
  target?: string;
}): boolean {
  const technical = call.technicalName?.trim() ?? "";
  const name = call.name?.trim() ?? "";
  const probe = technical || name;
  if (!probe) {
    return false;
  }
  // Subagent badge names are not context chrome.
  if (/^subagent$/i.test(probe) || isHelperAgentToolName(probe)) {
    return false;
  }
  if (isShellToolName(probe)) {
    return false;
  }
  if (CONTEXT_GATHERING_NAME_RE.test(probe)) {
    return true;
  }
  // Common "Searching…" / "Reading…" display labels from chrome fallback.
  const lower = name.toLowerCase();
  if (
    lower.startsWith("search") ||
    lower.startsWith("read") ||
    lower.startsWith("list") ||
    lower.startsWith("find") ||
    lower.startsWith("brows") ||
    lower.startsWith("fetch") ||
    lower.startsWith("look") ||
    lower.startsWith("context gathering") ||
    // lp-95v.5 friendly web activity verbs
    lower === "searching the web" ||
    lower === "browsing the web" ||
    // lp-uxy.10 F4 document parse activity verb
    lower === "parsing a document" ||
    lower.startsWith("parsing ")
  ) {
    return true;
  }
  // Web tool technical ids collapse under context gathering too.
  if (isWebSearchToolName(probe) || isWebBrowseToolName(probe)) {
    return true;
  }
  return false;
}

/** Minimum consecutive context tools before using the collapse label. */
export const CONTEXT_GATHERING_COLLAPSE_MIN = 3;

/**
 * Summary label for a consecutive tool group (ChatToolCalls `label` prop).
 * Returns undefined so Astryx uses its default count summary unless the group
 * is a noisy context-gathering batch.
 */
export function toolGroupSummaryLabel(
  calls: ReadonlyArray<{ name: string; target?: string; status?: string }>,
): string | undefined {
  if (calls.length < CONTEXT_GATHERING_COLLAPSE_MIN) {
    return undefined;
  }
  if (!calls.every((c) => isContextGatheringTool(c))) {
    return undefined;
  }
  return `Context gathering (${calls.length})`;
}

/**
 * Whether a tool group should start collapsed.
 * Context-gathering batches default closed once complete; keep open while any
 * call is still pending/running so live work stays visible.
 */
export function toolGroupDefaultExpanded(
  calls: ReadonlyArray<{ status?: string }>,
  options?: { hasAnswer?: boolean; forceExpandWhileRunning?: boolean },
): boolean {
  const anyOpen = calls.some(
    (c) => c.status === "running" || c.status === "pending",
  );
  if (anyOpen && options?.forceExpandWhileRunning !== false) {
    return true;
  }
  // No final answer yet — keep mid-turn tools visible.
  if (options?.hasAnswer === false) {
    return true;
  }
  // Large complete groups collapse by default (Astryx default: false for >3).
  if (calls.length > 3) {
    return false;
  }
  return true;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function formatDurationFromUnknown(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 1000) {
      const seconds = value / 1000;
      const rounded =
        seconds >= 10 ? Math.round(seconds) : Math.round(seconds * 10) / 10;
      return `${rounded}s`;
    }
    return `${Math.round(value)}ms`;
  }
  return undefined;
}

/**
 * Pull expandable tool result text from event fields / metadata.
 * Prefer explicit result fields over generic content (content is often a label).
 */
export function parseToolResult(event: ChatEvent): {
  result?: string;
  resultLanguage?: string;
} {
  const meta = event.metadata;
  const candidates: Array<unknown> = [
    event.result,
    event.result_detail,
    meta?.result,
    meta?.result_detail,
    meta?.output,
    meta?.stdout,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      const language =
        typeof meta?.result_language === "string"
          ? meta.result_language.trim()
          : typeof meta?.language === "string"
            ? meta.language.trim()
            : undefined;
      return { result: candidate, resultLanguage: language || undefined };
    }
    // Hosts may put structured search hits as a JSON object/array (not string).
    if (candidate != null && typeof candidate === "object") {
      try {
        return {
          result: JSON.stringify(candidate),
          resultLanguage: "json",
        };
      } catch {
        // ignore non-serializable
      }
    }
  }

  // Hermes fenced terminal body in content (when not pure chrome labels).
  if (typeof event.content === "string" && event.content.includes("```")) {
    const fenceMatch = event.content.match(/```(?:\w+)?\n([\s\S]*?)```/);
    if (fenceMatch?.[1]?.trim()) {
      return { result: fenceMatch[1].replace(/\n$/, "") };
    }
  }

  // When status is complete/error and content is multi-line (not a short label), use it.
  const status = resolveToolStatusFromEvent(event);
  if (
    (status === "complete" || status === "error") &&
    typeof event.content === "string" &&
    event.content.includes("\n") &&
    event.content.trim().length > 40
  ) {
    return { result: event.content };
  }

  return {};
}

/**
 * Subset of tool_progress metadata that carries structured web results
 * (title/snippet/url) so Portal can render cards without a JSON result body.
 */
export function pickWebSearchMetadata(
  meta: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!meta) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const key of [
    "search_results",
    "web_results",
    "results",
    "citations",
    "provider",
  ] as const) {
    if (meta[key] != null) {
      out[key] = meta[key];
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Core fields for a ChatTimelineToolCall derived from one tool_progress event. */
export type MappedToolCallFields = {
  /** Default UI activity label (friendly verb; never raw bash/spawn ids). */
  name: string;
  /**
   * Machine tool id (e.g. bash, spawn_subagent) for advanced/details.
   * Omitted when `name` is already the only available label.
   */
  technicalName?: string;
  target?: string;
  status: ChatToolCallStatus;
  duration?: string;
  errorMessage?: string;
  additions?: number;
  deletions?: number;
  node?: string;
  result?: string;
  resultLanguage?: string;
  /**
   * Subset of tool_progress metadata for structured web search/crawl hits
   * (search_results / web_results / results / citations) — lp-uxy.7.
   */
  metadata?: Record<string, unknown>;
  /**
   * Discriminator:
   * - subagent → chips (lp-dpr.5)
   * - workflow → stage card (lp-dpr.7)
   */
  kind?: "tool" | "subagent" | "workflow";
  /** Product status including needs_input (broader than ChatToolCallStatus). */
  subagentStatus?: SubagentRunStatus;
  subagentColor?: string;
  subagentIcon?: SubagentIconKey;
  startedAt?: string;
  parentToolCallId?: string;
  /**
   * Parent SubagentRun id for nested tool rows under SubagentDetail (lp-uxy.1).
   * Wire: metadata.parent_subagent_id | subagent_run_id | parent_subagent_run_id.
   */
  parentSubagentId?: string;
  summary?: string;
  /**
   * Host-stamped artifacts for subagent complete (lp-uxy.2).
   * Wire: metadata.artifacts[] | artifact_list.
   */
  artifacts?: SubagentArtifact[];
  /** Workflow overall status (lp-dpr.7). */
  workflowStatus?: WorkflowStageStatus;
  /** Ordered workflow stages (lp-dpr.7). */
  workflowStages?: WorkflowStage[];
};

/**
 * Read parent subagent / run attribution from a tool_progress event (lp-uxy.1).
 *
 * Preferred wire keys (first match wins):
 * - `parent_subagent_id` / `parentSubagentId`
 * - `parent_subagent_run_id` / `parentSubagentRunId`
 * - `subagent_run_id` / `subagentRunId` (on child tools = parent run id)
 *
 * Does **not** use bare `subagent_id` (ambiguous with the subagent's own id).
 */
export function readParentSubagentIdFromEvent(
  event: Pick<ChatEvent, "metadata">,
): string | undefined {
  const meta = event.metadata;
  if (!meta) {
    return undefined;
  }
  const keys = [
    "parent_subagent_id",
    "parentSubagentId",
    "parent_subagent_run_id",
    "parentSubagentRunId",
    "subagent_run_id",
    "subagentRunId",
  ] as const;
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * Map a tool_progress ChatEvent onto ChatTimelineToolCall core fields.
 * Richer optional fields (duration, error, diffs, node, result) are filled when present.
 * Subagent events set `kind: "subagent"` + stable identity (color/icon).
 * Workflow events set `kind: "workflow"` + ordered stages.
 */
export function mapToolCallFields(event: ChatEvent): MappedToolCallFields {
  const label =
    event.tool_label?.trim() ||
    event.tool_name?.trim() ||
    event.subagent_name?.trim() ||
    event.content?.trim() ||
    "Working…";

  const toolKindHint =
    event.tool_kind?.trim() ||
    (typeof event.metadata?.tool_kind === "string"
      ? event.metadata.tool_kind.trim()
      : undefined) ||
    (typeof event.metadata?.kind === "string"
      ? event.metadata.kind.trim()
      : undefined);

  // Workflow takes precedence over subagent when both could match.
  const workflow = isWorkflowEvent(event);
  if (workflow) {
    const run = mapWorkflowRunFromEvent(event);
    if (run) {
      return {
        name: run.name,
        target: run.summary,
        status: chatToolStatusFromWorkflowStatus(run.status),
        duration: run.duration,
        kind: "workflow",
        workflowStatus: run.status,
        workflowStages: run.stages,
        startedAt: run.startedAt,
        summary: run.summary,
      };
    }
  }

  const subagent = isSubagentEvent(event);
  const subagentName =
    event.subagent_name?.trim() ||
    (typeof event.metadata?.subagent_name === "string"
      ? event.metadata.subagent_name.trim()
      : undefined) ||
    (typeof event.metadata?.agent_name === "string"
      ? event.metadata.agent_name.trim()
      : undefined);

  // lp-vnz.9: default name is a friendly activity verb; technical id is optional.
  const activity = subagent
    ? resolveToolActivityDisplay({
        toolName: event.tool_name,
        toolLabel: event.tool_label,
        toolKind: toolKindHint ?? "subagent",
        preserveIdentityName: true,
        identityName:
          subagentName ||
          (event.tool_name?.trim() &&
          !looksLikeTechnicalToolId(event.tool_name) &&
          !isHelperAgentToolName(event.tool_name)
            ? event.tool_name.trim()
            : undefined) ||
          "Helper agent",
      })
    : resolveToolActivityDisplay({
        toolName: event.tool_name,
        toolLabel: event.tool_label?.trim() || (event.tool_name ? undefined : label),
        toolKind: toolKindHint,
      });

  const name = activity.name;

  // Keep raw target in the model (advanced/details); ChatTimeline may hide argv.
  const target = subagent
    ? event.tool_target?.trim() ||
      (event.tool_label?.trim() && !looksLikeTechnicalToolId(event.tool_label)
        ? event.tool_label.trim()
        : undefined) ||
      undefined
    : event.tool_target?.trim() ||
      (event.tool_name ? event.tool_label?.trim() : undefined) ||
      (event.tool_name || event.tool_call_id ? undefined : label) ||
      undefined;

  const status = resolveToolStatusFromEvent(event);

  const errorMessage =
    event.errorMessage?.trim() ||
    event.error_message?.trim() ||
    (typeof event.metadata?.errorMessage === "string"
      ? event.metadata.errorMessage.trim()
      : undefined) ||
    (typeof event.metadata?.error_message === "string"
      ? event.metadata.error_message.trim()
      : undefined) ||
    (typeof event.metadata?.error === "string"
      ? event.metadata.error.trim()
      : undefined) ||
    undefined;

  const duration =
    formatDurationFromUnknown(event.duration) ||
    formatDurationFromUnknown(event.metadata?.duration) ||
    formatDurationFromUnknown(event.metadata?.duration_ms) ||
    formatDurationFromUnknown(event.metadata?.elapsed_ms);

  const additions =
    asOptionalNumber(event.additions) ??
    asOptionalNumber(event.metadata?.additions);
  const deletions =
    asOptionalNumber(event.deletions) ??
    asOptionalNumber(event.metadata?.deletions);

  const node =
    event.node?.trim() ||
    (typeof event.metadata?.node === "string"
      ? event.metadata.node.trim()
      : undefined) ||
    (typeof event.metadata?.sandbox === "string"
      ? event.metadata.sandbox.trim()
      : undefined) ||
    undefined;

  const { result, resultLanguage } = parseToolResult(event);
  const webMeta = pickWebSearchMetadata(event.metadata);

  const base: MappedToolCallFields = {
    name,
    target,
    status,
    duration,
    errorMessage: errorMessage || undefined,
    additions,
    deletions,
    node,
    result,
    resultLanguage,
  };
  if (webMeta) {
    base.metadata = webMeta;
  }
  if (activity.technicalName) {
    base.technicalName = activity.technicalName;
  }

  // Nested tool attribution (lp-uxy.1): child tools under a SubagentRun.
  // Apply to generic tools (and optionally subagents of subagents later).
  const parentSubagentId = readParentSubagentIdFromEvent(event);
  if (parentSubagentId) {
    base.parentSubagentId = parentSubagentId;
  }

  if (!subagent) {
    // Leave kind undefined for generic tools so timeline equality stays stable.
    return base;
  }

  const kindHint = toolKindHint;

  const colorOverride =
    typeof event.metadata?.subagent_color === "string"
      ? event.metadata.subagent_color.trim()
      : typeof event.metadata?.color === "string"
        ? event.metadata.color.trim()
        : undefined;

  base.kind = "subagent";
  // Preserve needs_input which ChatToolCallStatus cannot express.
  const statusProbe =
    event.tool_status ??
    (typeof event.metadata?.tool_status === "string"
      ? event.metadata.tool_status
      : undefined) ??
    (typeof event.metadata?.status === "string"
      ? event.metadata.status
      : undefined);
  base.subagentStatus = normalizeSubagentStatus(statusProbe, "running");
  base.subagentColor = colorOverride || subagentColor(name);
  base.subagentIcon = subagentIconKey(name, kindHint);
  base.summary = target;

  const startedAt =
    (typeof event.metadata?.started_at === "string"
      ? event.metadata.started_at.trim()
      : undefined) ||
    (typeof event.metadata?.startedAt === "string"
      ? event.metadata.startedAt.trim()
      : undefined) ||
    event.created_at ||
    undefined;
  if (startedAt) {
    base.startedAt = startedAt;
  }

  const parentToolCallId =
    typeof event.metadata?.parent_tool_call_id === "string"
      ? event.metadata.parent_tool_call_id.trim()
      : typeof event.metadata?.parentToolCallId === "string"
        ? event.metadata.parentToolCallId.trim()
        : undefined;
  if (parentToolCallId) {
    base.parentToolCallId = parentToolCallId;
  }

  // Host artifacts[] on subagent complete / incremental (lp-uxy.2).
  const artifacts =
    parseSubagentArtifacts(event.metadata?.artifacts) ||
    parseSubagentArtifacts(event.metadata?.artifact_list);
  if (artifacts?.length) {
    base.artifacts = artifacts;
  }

  return base;
}

/**
 * portal_event values that mean "this outbound is a tool lifecycle row".
 * Hosts (Hermes / Lanyard Agent / fixtures) should prefer `tool_progress`.
 * Aliases are accepted for non-Hermes agents that dual-emit adjacent shapes.
 */
export const TOOL_PROGRESS_PORTAL_EVENTS = new Set([
  "tool_progress",
  "subagent",
  "tool",
  "tool_call",
  "tool.start",
  "tool.update",
  "tool.end",
  "tool.error",
  "agent_tool",
  // Workflow progress (lp-dpr.7) — same SSE type tool_progress, distinct kind.
  "workflow_progress",
  "workflow",
  "workflow.start",
  "workflow.update",
  "workflow.end",
  "workflow.error",
]);

/** True when metadata.portal_event is a recognized tool lifecycle shape. */
export function isToolProgressPortalEvent(
  portalEvent: string | undefined | null,
): boolean {
  if (!portalEvent?.trim()) {
    return false;
  }
  const key = portalEvent.trim().toLowerCase();
  if (TOOL_PROGRESS_PORTAL_EVENTS.has(key)) {
    return true;
  }
  // Accept tool.* namespace (future host shapes) except tool approval UI.
  if (
    key.startsWith("tool.") &&
    key !== "tool.approval" &&
    key !== "needs_auth"
  ) {
    return true;
  }
  if (key === "needs_auth" || key === "connector.qr") {
    return false;
  }
  // Accept workflow.* namespace.
  if (key.startsWith("workflow.")) {
    return true;
  }
  return false;
}
