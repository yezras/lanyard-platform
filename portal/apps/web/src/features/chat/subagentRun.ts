/**
 * SubagentRun domain + identity (lp-dpr.5).
 *
 * Models concurrent agent sub-runs as first-class entities distinct from
 * generic tool_progress rows. Colors/icons are stable per name (or kind)
 * so chips and the activity roster share the same identity.
 *
 * Wire: portal_event "subagent" | tool_kind=subagent | subagent_name present.
 *
 * Artifacts (lp-uxy.2): host may stamp metadata.artifacts[] on subagent
 * complete; Portal also harvests vault paths from nested file tools so
 * SubagentDetail chips and final-report citations remain openable.
 */

import type { ChatEvent, ChatToolCallStatus } from "../../api/types.js";

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

/** Lifecycle for a subagent run (product vocabulary). */
export type SubagentRunStatus =
  | "running"
  | "needs_input"
  | "done"
  | "failed";

/**
 * Vault or web artifact produced by a subagent (lp-uxy.2).
 *
 * - `vault` → document pane soft-open / vault citation chip
 * - `web` → external URL / web citation chip (never vault pane)
 */
export type SubagentArtifactKind = "vault" | "web";

export type SubagentArtifact = {
  /** Vault path (absolute or project-relative) or exact http(s) URL. */
  path: string;
  title?: string;
  kind: SubagentArtifactKind;
};

/**
 * First-class subagent session shown as an inline chip and roster row.
 *
 * `id` is the stable upsert key (`tool_call_id` / `subagent_id` preferred).
 */
export type SubagentRun = {
  id: string;
  name: string;
  status: SubagentRunStatus;
  /** CSS color hex — stable for this name/kind. */
  color: string;
  /**
   * Icon identity key (not a React node) so pure mappers stay serializable.
   * UI maps via {@link subagentIconComponent}.
   */
  icon: SubagentIconKey;
  /** ISO timestamp or epoch-ms string when the run started. */
  startedAt?: string;
  parentToolCallId?: string;
  /** Short work summary / target label. */
  summary?: string;
  /** Host-provided duration when terminal (e.g. "4.1s"). */
  duration?: string;
  /** Expandable result / last progress snippet. */
  result?: string;
  /**
   * Host-stamped artifacts for this run (lp-uxy.2).
   * Prefer these over nested-tool harvest when present.
   */
  artifacts?: SubagentArtifact[];
};

export type SubagentIconKey =
  | "explore"
  | "research"
  | "code"
  | "write"
  | "test"
  | "plan"
  | "browser"
  | "default";

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Map tool_status / host aliases onto SubagentRunStatus.
 * Accepts needs_input / waiting_for_user as a distinct state.
 */
export function normalizeSubagentStatus(
  value: unknown,
  fallback: SubagentRunStatus = "running",
): SubagentRunStatus {
  if (typeof value !== "string") {
    return fallback;
  }
  const raw = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!raw) {
    return fallback;
  }

  if (
    raw === "needs_input" ||
    raw === "need_input" ||
    raw === "awaiting_input" ||
    raw === "waiting_for_user" ||
    raw === "waiting_for_input" ||
    raw === "input_required" ||
    raw === "paused"
  ) {
    return "needs_input";
  }

  if (
    raw === "running" ||
    raw === "in_progress" ||
    raw === "started" ||
    raw === "start" ||
    raw === "active" ||
    raw === "progress" ||
    raw === "executing" ||
    raw === "working" ||
    raw === "pending" ||
    raw === "queued" ||
    raw === "waiting" ||
    raw === "scheduled" ||
    raw === "idle"
  ) {
    return "running";
  }

  if (
    raw === "done" ||
    raw === "complete" ||
    raw === "completed" ||
    raw === "success" ||
    raw === "succeeded" ||
    raw === "ok" ||
    raw === "finished" ||
    raw === "end" ||
    raw === "ended"
  ) {
    return "done";
  }

  if (
    raw === "failed" ||
    raw === "error" ||
    raw === "failure" ||
    raw === "fail" ||
    raw === "cancelled" ||
    raw === "canceled" ||
    raw === "timeout" ||
    raw === "timed_out" ||
    raw === "aborted" ||
    raw === "abort"
  ) {
    return "failed";
  }

  return fallback;
}

/** Map Astryx ChatToolCallStatus → SubagentRunStatus (no needs_input path). */
export function subagentStatusFromToolStatus(
  status: ChatToolCallStatus | undefined,
): SubagentRunStatus {
  switch (status) {
    case "complete":
      return "done";
    case "error":
      return "failed";
    case "pending":
    case "running":
    default:
      return "running";
  }
}

/** True when the subagent run has finished successfully or failed. */
export function isTerminalSubagentStatus(status: SubagentRunStatus): boolean {
  return status === "done" || status === "failed";
}

/**
 * Map a terminal SubagentRunStatus onto ChatToolCallStatus for parent tool rows.
 * Non-terminal statuses return null (do not flip the parent yet).
 */
export function chatToolStatusFromSubagentTerminal(
  status: SubagentRunStatus,
): ChatToolCallStatus | null {
  if (status === "done") {
    return "complete";
  }
  if (status === "failed") {
    return "error";
  }
  return null;
}

/** Human label for chips / roster. */
export function subagentStatusLabel(status: SubagentRunStatus): string {
  switch (status) {
    case "needs_input":
      return "needs input";
    case "done":
      return "done";
    case "failed":
      return "failed";
    case "running":
    default:
      return "running";
  }
}

// ---------------------------------------------------------------------------
// Linked lifecycle: subagent done → parent spawn/wait tool complete (lp-dpr.6)
// ---------------------------------------------------------------------------

/**
 * Heuristic: tool names that are subagent spawn / wait parents in ChatToolCalls.
 * Linking primarily uses `parentToolCallId`; this is for docs / diagnostics.
 */
export function isSubagentSpawnOrWaitToolName(name: string): boolean {
  const n = name.trim().toLowerCase().replace(/[\s-]+/g, "_");
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
    n === "subagent_wait"
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
  return false;
}

/**
 * Minimal tool-call shape required for parent ↔ child lifecycle linking.
 * Matches {@link ChatTimelineToolCall} fields used by the reducer.
 */
export type SubagentLinkedToolCall = {
  key: string;
  name: string;
  status: ChatToolCallStatus;
  duration?: string;
  errorMessage?: string;
  result?: string;
  kind?: "tool" | "subagent";
  subagentStatus?: SubagentRunStatus;
  parentToolCallId?: string;
};

function resolvedSubagentStatus(
  call: SubagentLinkedToolCall,
): SubagentRunStatus {
  if (call.subagentStatus) {
    return call.subagentStatus;
  }
  return subagentStatusFromToolStatus(call.status);
}

/**
 * When every subagent child of a parent tool is terminal, flip the parent
 * ChatToolCalls row from pending/running → complete/error and propagate
 * duration so spawn/wait tools are not stuck "running".
 *
 * Link key: `child.parentToolCallId === parent.key` (wire:
 * `metadata.parent_tool_call_id`).
 *
 * Multi-child: parent completes only when **all** children are terminal;
 * if any child failed, parent status is `error`.
 *
 * Idempotent: already-terminal parents only gain missing duration.
 */
export function applySubagentParentCompletion<T extends SubagentLinkedToolCall>(
  calls: readonly T[],
): T[] {
  if (calls.length === 0) {
    return calls as T[];
  }

  const childrenByParent = new Map<string, T[]>();
  for (const call of calls) {
    if (call.kind !== "subagent" || !call.parentToolCallId?.trim()) {
      continue;
    }
    const parentId = call.parentToolCallId.trim();
    const list = childrenByParent.get(parentId);
    if (list) {
      list.push(call);
    } else {
      childrenByParent.set(parentId, [call]);
    }
  }

  if (childrenByParent.size === 0) {
    return calls as T[];
  }

  type ParentPatch = {
    status: ChatToolCallStatus;
    subagentStatus: SubagentRunStatus;
    duration?: string;
    errorMessage?: string;
    result?: string;
  };
  const patches = new Map<string, ParentPatch>();

  for (const [parentId, children] of childrenByParent) {
    const statuses = children.map(resolvedSubagentStatus);
    if (!statuses.every(isTerminalSubagentStatus)) {
      continue;
    }
    const anyFailed = statuses.some((s) => s === "failed");
    // Prefer the last child that carries a host duration (completion order).
    let duration: string | undefined;
    let errorMessage: string | undefined;
    let result: string | undefined;
    for (const child of children) {
      if (child.duration?.trim()) {
        duration = child.duration.trim();
      }
      if (child.errorMessage?.trim()) {
        errorMessage = child.errorMessage.trim();
      }
      if (child.result?.trim()) {
        result = child.result.trim();
      }
    }
    patches.set(parentId, {
      status: anyFailed ? "error" : "complete",
      subagentStatus: anyFailed ? "failed" : "done",
      duration,
      errorMessage: anyFailed ? errorMessage : undefined,
      result,
    });
  }

  if (patches.size === 0) {
    return calls as T[];
  }

  let changed = false;
  const next = calls.map((call) => {
    const patch = patches.get(call.key);
    if (!patch) {
      return call;
    }
    const open =
      call.status === "pending" || call.status === "running";
    const needsDuration = !call.duration?.trim() && Boolean(patch.duration);
    const needsError =
      patch.status === "error" &&
      !call.errorMessage?.trim() &&
      Boolean(patch.errorMessage);
    const needsResult = !call.result?.trim() && Boolean(patch.result);
    const needsSubagentStatus =
      call.kind === "subagent" &&
      call.subagentStatus !== patch.subagentStatus &&
      (open || call.subagentStatus === undefined);

    if (!open && !needsDuration && !needsError && !needsResult && !needsSubagentStatus) {
      return call;
    }

    changed = true;
    const updated: T = { ...call };
    if (open) {
      updated.status = patch.status;
      if (call.kind === "subagent") {
        updated.subagentStatus = patch.subagentStatus;
      }
    } else if (needsSubagentStatus && call.kind === "subagent") {
      updated.subagentStatus = patch.subagentStatus;
    }
    if (needsDuration && patch.duration) {
      updated.duration = patch.duration;
    }
    if (needsError && patch.errorMessage) {
      updated.errorMessage = patch.errorMessage;
    }
    if (needsResult && patch.result) {
      updated.result = patch.result;
    }
    return updated;
  });

  return changed ? next : (calls as T[]);
}

// ---------------------------------------------------------------------------
// Identity (color + icon) — stable per name/kind
// ---------------------------------------------------------------------------

const SUBAGENT_PALETTE = [
  "#3B82F6", // blue
  "#10B981", // emerald
  "#F59E0B", // amber
  "#8B5CF6", // violet
  "#EC4899", // pink
  "#06B6D4", // cyan
  "#F97316", // orange
  "#14B8A6", // teal
  "#6366F1", // indigo
  "#84CC16", // lime
  "#EF4444", // red
  "#A855F7", // purple
] as const;

function hashIdentity(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * Stable CSS color for a subagent name (or kind). Same input → same color.
 */
export function subagentColor(nameOrKind: string): string {
  const key = nameOrKind.trim().toLowerCase() || "subagent";
  const index = hashIdentity(key) % SUBAGENT_PALETTE.length;
  return SUBAGENT_PALETTE[index] ?? SUBAGENT_PALETTE[0];
}

/**
 * Map name/kind strings onto a stable icon key.
 * Prefer explicit kind; fall back to name heuristics.
 */
export function subagentIconKey(
  name: string,
  kind?: string | null,
): SubagentIconKey {
  const probe = `${kind ?? ""} ${name}`.trim().toLowerCase();
  if (!probe) {
    return "default";
  }
  // Substring match so "Explore", "Researcher", "coder" all resolve.
  if (/explor|brows|web_?fetch|fetch/.test(probe)) {
    return "explore";
  }
  if (/research|search|investigat|scout/.test(probe)) {
    return "research";
  }
  if (/\bcoder?\b|implement|patch|devtools?/.test(probe) || /code/.test(probe)) {
    return "code";
  }
  if (/writ|author|draft|doc/.test(probe)) {
    return "write";
  }
  if (/\btest|qa\b|verify|check/.test(probe)) {
    return "test";
  }
  if (/plan|architect|design/.test(probe)) {
    return "plan";
  }
  if (/browser|navigate|click/.test(probe)) {
    return "browser";
  }
  return "default";
}

// ---------------------------------------------------------------------------
// Detect + map from wire / timeline
// ---------------------------------------------------------------------------

/** True when a ChatEvent should render as a SubagentRun, not a generic tool. */
export function isSubagentEvent(event: ChatEvent): boolean {
  const kind = event.tool_kind?.trim().toLowerCase();
  if (kind === "subagent" || kind === "agent") {
    return true;
  }
  if (event.subagent_name?.trim()) {
    return true;
  }
  const portal =
    typeof event.metadata?.portal_event === "string"
      ? event.metadata.portal_event.trim().toLowerCase()
      : "";
  if (portal === "subagent") {
    return true;
  }
  const metaKind =
    typeof event.metadata?.tool_kind === "string"
      ? event.metadata.tool_kind.trim().toLowerCase()
      : typeof event.metadata?.kind === "string"
        ? event.metadata.kind.trim().toLowerCase()
        : "";
  return metaKind === "subagent" || metaKind === "agent";
}

function readMetaString(
  meta: Record<string, unknown> | undefined,
  ...keys: string[]
): string | undefined {
  if (!meta) {
    return undefined;
  }
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function formatElapsedMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "0:00";
  }
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

/**
 * Elapsed clock for chips: prefer host duration when terminal; otherwise
 * derive m:ss from startedAt vs now (or fixed `nowMs` for tests).
 */
export function formatSubagentElapsed(
  run: Pick<SubagentRun, "status" | "startedAt" | "duration">,
  nowMs: number = Date.now(),
): string | undefined {
  if (run.duration?.trim()) {
    return run.duration.trim();
  }
  if (!run.startedAt) {
    return undefined;
  }
  const start =
    /^\d+$/.test(run.startedAt)
      ? Number(run.startedAt)
      : Date.parse(run.startedAt);
  if (!Number.isFinite(start)) {
    return undefined;
  }
  // Terminal without duration still shows wall elapsed at completion time.
  return formatElapsedMs(nowMs - start);
}

/**
 * Chip / roster title line: `Explore · running 0:42`.
 */
export function formatSubagentChipLabel(
  run: SubagentRun,
  nowMs: number = Date.now(),
): string {
  const status = subagentStatusLabel(run.status);
  const elapsed = formatSubagentElapsed(run, nowMs);
  if (elapsed) {
    return `${run.name} · ${status} ${elapsed}`;
  }
  return `${run.name} · ${status}`;
}

/**
 * Map a tool_progress / subagent ChatEvent onto SubagentRun.
 * Returns null when the event is not a subagent row.
 */
export function mapSubagentRunFromEvent(
  event: ChatEvent,
  options?: { existingId?: string; nowMs?: number },
): SubagentRun | null {
  if (!isSubagentEvent(event)) {
    return null;
  }

  const meta = event.metadata;
  const name =
    event.subagent_name?.trim() ||
    readMetaString(meta, "subagent_name", "agent_name") ||
    event.tool_name?.trim() ||
    event.tool_label?.trim() ||
    "subagent";

  const id =
    event.tool_call_id?.trim() ||
    readMetaString(meta, "subagent_id", "run_id", "agent_id") ||
    options?.existingId ||
    `subagent:${name}`;

  const statusFromFields =
    event.tool_status ??
    readMetaString(meta, "tool_status", "status", "state", "phase");
  const status = normalizeSubagentStatus(statusFromFields, "running");

  const kindHint =
    event.tool_kind?.trim() ||
    readMetaString(meta, "tool_kind", "kind", "subagent_kind");

  const color =
    readMetaString(meta, "subagent_color", "color") || subagentColor(name);
  const iconRaw = readMetaString(meta, "subagent_icon", "icon");
  const icon: SubagentIconKey =
    iconRaw &&
    (
      [
        "explore",
        "research",
        "code",
        "write",
        "test",
        "plan",
        "browser",
        "default",
      ] as const
    ).includes(iconRaw as SubagentIconKey)
      ? (iconRaw as SubagentIconKey)
      : subagentIconKey(name, kindHint);

  const summary =
    event.tool_target?.trim() ||
    event.tool_label?.trim() ||
    readMetaString(meta, "summary", "task", "description") ||
    (event.content?.trim() && event.content.trim() !== name
      ? event.content.trim()
      : undefined);

  const startedAt =
    readMetaString(meta, "started_at", "startedAt", "start_time") ||
    event.created_at ||
    undefined;

  const duration =
    (typeof event.duration === "string" && event.duration.trim()
      ? event.duration.trim()
      : undefined) ||
    readMetaString(meta, "duration") ||
    undefined;

  const parentToolCallId =
    readMetaString(meta, "parent_tool_call_id", "parentToolCallId") ||
    undefined;

  const result =
    (typeof event.result === "string" && event.result.trim()
      ? event.result.trim()
      : undefined) ||
    readMetaString(meta, "result", "result_detail", "output") ||
    undefined;

  const artifacts =
    parseSubagentArtifacts(meta?.artifacts) ||
    parseSubagentArtifacts(meta?.artifact_list) ||
    undefined;

  const run: SubagentRun = {
    id,
    name,
    status,
    color,
    icon,
  };
  if (startedAt) run.startedAt = startedAt;
  if (parentToolCallId) run.parentToolCallId = parentToolCallId;
  if (summary) run.summary = summary;
  if (duration) run.duration = duration;
  if (result) run.result = result;
  if (artifacts?.length) run.artifacts = artifacts;
  return run;
}

/**
 * Build SubagentRun from a hydrated timeline tool call (history / live).
 */
export function mapSubagentRunFromToolCall(call: {
  key: string;
  name: string;
  target?: string;
  status: ChatToolCallStatus;
  duration?: string;
  result?: string;
  kind?: "tool" | "subagent";
  subagentStatus?: SubagentRunStatus;
  subagentColor?: string;
  subagentIcon?: SubagentIconKey;
  startedAt?: string;
  parentToolCallId?: string;
  summary?: string;
  artifacts?: SubagentArtifact[];
}): SubagentRun | null {
  if (call.kind !== "subagent") {
    return null;
  }
  const name = call.name?.trim() || "subagent";
  const run: SubagentRun = {
    id: call.key,
    name,
    status:
      call.subagentStatus ?? subagentStatusFromToolStatus(call.status),
    color: call.subagentColor || subagentColor(name),
    icon: call.subagentIcon || subagentIconKey(name),
  };
  if (call.startedAt) run.startedAt = call.startedAt;
  if (call.parentToolCallId) run.parentToolCallId = call.parentToolCallId;
  if (call.summary || call.target) {
    run.summary = call.summary ?? call.target;
  }
  if (call.duration) run.duration = call.duration;
  if (call.result) run.result = call.result;
  if (call.artifacts?.length) run.artifacts = call.artifacts;
  return run;
}

/**
 * Collect unique SubagentRun rows from timeline items (latest status wins).
 * Active runs first, then recent terminal runs (stable order by first seen).
 */
export function collectSubagentRunsFromTimeline(
  items: ReadonlyArray<{
    type: string;
    toolCalls?: ReadonlyArray<{
      key: string;
      name: string;
      target?: string;
      status: ChatToolCallStatus;
      duration?: string;
      result?: string;
      kind?: "tool" | "subagent";
      subagentStatus?: SubagentRunStatus;
      subagentColor?: string;
      subagentIcon?: SubagentIconKey;
      startedAt?: string;
      parentToolCallId?: string;
      summary?: string;
      artifacts?: SubagentArtifact[];
    }>;
    segments?: ReadonlyArray<{
      kind: string;
      call?: {
        key: string;
        name: string;
        target?: string;
        status: ChatToolCallStatus;
        duration?: string;
        result?: string;
        kind?: "tool" | "subagent";
        subagentStatus?: SubagentRunStatus;
        subagentColor?: string;
        subagentIcon?: SubagentIconKey;
        startedAt?: string;
        parentToolCallId?: string;
        summary?: string;
        artifacts?: SubagentArtifact[];
      };
    }>;
  }>,
): SubagentRun[] {
  const byId = new Map<string, SubagentRun>();
  const order: string[] = [];

  const ingest = (call: {
    key: string;
    name: string;
    target?: string;
    status: ChatToolCallStatus;
    duration?: string;
    result?: string;
    kind?: "tool" | "subagent";
    subagentStatus?: SubagentRunStatus;
    subagentColor?: string;
    subagentIcon?: SubagentIconKey;
    startedAt?: string;
    parentToolCallId?: string;
    summary?: string;
    artifacts?: SubagentArtifact[];
  }) => {
    const run = mapSubagentRunFromToolCall(call);
    if (!run) {
      return;
    }
    if (!byId.has(run.id)) {
      order.push(run.id);
    }
    byId.set(run.id, run);
  };

  for (const item of items) {
    if (item.type !== "assistant_turn" && item.type !== "assistant") {
      continue;
    }
    if (item.segments?.length) {
      for (const seg of item.segments) {
        if (seg.kind === "tool" && seg.call) {
          ingest(seg.call);
        }
      }
    } else if (item.toolCalls?.length) {
      for (const call of item.toolCalls) {
        ingest(call);
      }
    }
  }

  const runs = order
    .map((id) => byId.get(id))
    .filter((r): r is SubagentRun => Boolean(r));

  const rank = (s: SubagentRunStatus): number => {
    switch (s) {
      case "needs_input":
        return 0;
      case "running":
        return 1;
      case "failed":
        return 2;
      case "done":
        return 3;
      default:
        return 4;
    }
  };

  return [...runs].sort((a, b) => {
    const d = rank(a.status) - rank(b.status);
    if (d !== 0) return d;
    return order.indexOf(a.id) - order.indexOf(b.id);
  });
}

// ---------------------------------------------------------------------------
// Nested tools under a SubagentRun (lp-uxy.1)
// ---------------------------------------------------------------------------

/**
 * Minimal tool-call shape for nested-stream filtering.
 * Matches {@link ChatTimelineToolCall} fields used by SubagentDetail.
 */
export type NestedSubagentToolCall = {
  key: string;
  name: string;
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
  kind?: "tool" | "subagent" | "workflow";
  parentSubagentId?: string;
  parentToolCallId?: string;
  summary?: string;
};

/**
 * True when a tool row is attributed to the given SubagentRun id.
 * Unattributed tools never match (nested list ignores them).
 */
export function isNestedToolUnderSubagent(
  call: Pick<NestedSubagentToolCall, "parentSubagentId" | "kind" | "key">,
  subagentRunId: string,
): boolean {
  const runId = subagentRunId.trim();
  if (!runId) {
    return false;
  }
  // Subagent / workflow rows are not nested tool stream entries.
  if (call.kind === "subagent" || call.kind === "workflow") {
    return false;
  }
  // Avoid self-attribution if a host mis-tags the subagent row.
  if (call.key === runId) {
    return false;
  }
  const parent = call.parentSubagentId?.trim();
  return Boolean(parent && parent === runId);
}

/**
 * Collect ordered nested tool rows for one SubagentRun from timeline items.
 * Latest upsert per tool key wins; first-seen order is preserved.
 * Only tools with matching `parentSubagentId` are included (lp-uxy.1).
 */
export function collectNestedToolsForSubagent(
  items: ReadonlyArray<{
    type: string;
    toolCalls?: ReadonlyArray<NestedSubagentToolCall>;
    segments?: ReadonlyArray<{
      kind: string;
      call?: NestedSubagentToolCall;
    }>;
  }>,
  subagentRunId: string,
): NestedSubagentToolCall[] {
  const runId = subagentRunId.trim();
  if (!runId) {
    return [];
  }

  const byKey = new Map<string, NestedSubagentToolCall>();
  const order: string[] = [];

  const ingest = (call: NestedSubagentToolCall) => {
    if (!isNestedToolUnderSubagent(call, runId)) {
      return;
    }
    if (!byKey.has(call.key)) {
      order.push(call.key);
    }
    byKey.set(call.key, call);
  };

  for (const item of items) {
    if (item.type !== "assistant_turn" && item.type !== "assistant") {
      continue;
    }
    if (item.segments?.length) {
      for (const seg of item.segments) {
        if (seg.kind === "tool" && seg.call) {
          ingest(seg.call);
        }
      }
    } else if (item.toolCalls?.length) {
      for (const call of item.toolCalls) {
        ingest(call);
      }
    }
  }

  return order
    .map((key) => byKey.get(key))
    .filter((c): c is NestedSubagentToolCall => Boolean(c));
}

// ---------------------------------------------------------------------------
// Subagent artifacts (lp-uxy.2)
// ---------------------------------------------------------------------------

/** Absolute http(s) URL → web citation chip (never vault pane). */
function isHttpArtifactPath(value: string): boolean {
  return /^https?:\/\/\S+/i.test(value.trim());
}

/**
 * True when a string looks like a safe vault file path for soft-open/citation.
 * Rejects traversal, shell-ish tokens, and bare directories.
 */
export function isSafeVaultArtifactPath(value: string | undefined): boolean {
  if (!value?.trim()) {
    return false;
  }
  const t = value.trim();
  if (isHttpArtifactPath(t)) {
    return false;
  }
  if (t.includes("..") || t.includes("\0")) {
    return false;
  }
  // Shell / multi-arg noise.
  if (/\s/.test(t) || t.includes("|") || t.includes(";") || t.startsWith("-")) {
    return false;
  }
  if (t.startsWith("/")) {
    return t.length > 1 && !t.endsWith("/");
  }
  // Relative file with extension (notes.md, src/foo.ts).
  return /^[\w./-]+\.\w{1,12}$/.test(t);
}

/**
 * Absolute vault-looking paths with a file extension, used when expanding
 * tool result bodies (lp-uxy.2 — soft harvest only; no shell/URLs).
 */
const VAULT_PATH_IN_RESULT_RE =
  /(?:^|[\s"'`(\[{])(\/(?:[\w.-]+\/)+[\w.-]+\.\w{1,12})(?=$|[\s"'`)\]}.,;:!?])/g;

/**
 * Extract safe absolute vault paths from a tool result body.
 * Caps count to avoid spam from large dumps.
 */
export function extractSafeVaultPathsFromToolResult(
  result: string | undefined,
  max = 6,
): string[] {
  if (!result?.trim() || max <= 0) {
    return [];
  }
  // Ignore huge dumps (binary-ish / full file bodies).
  if (result.length > 16_384) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  VAULT_PATH_IN_RESULT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = VAULT_PATH_IN_RESULT_RE.exec(result)) !== null) {
    const path = match[1]?.trim();
    if (!path || !isSafeVaultArtifactPath(path) || seen.has(path)) {
      continue;
    }
    seen.add(path);
    out.push(path);
    if (out.length >= max) {
      break;
    }
  }
  return out;
}

function artifactTitleFromPath(path: string, explicit?: string): string | undefined {
  const t = explicit?.trim();
  if (t && t !== path) {
    return t;
  }
  if (isHttpArtifactPath(path)) {
    try {
      return new URL(path).hostname || undefined;
    } catch {
      return undefined;
    }
  }
  const base = path.split("/").filter(Boolean).pop();
  return base && base !== path ? base : undefined;
}

function normalizeArtifactKind(
  raw: unknown,
  path: string,
): SubagentArtifactKind {
  if (typeof raw === "string") {
    const k = raw.trim().toLowerCase();
    if (k === "web" || k === "url" || k === "http" || k === "https") {
      return "web";
    }
    if (k === "vault" || k === "file" || k === "document" || k === "path") {
      return "vault";
    }
  }
  return isHttpArtifactPath(path) ? "web" : "vault";
}

/**
 * Parse host `metadata.artifacts[]` (or `artifact_list`) into typed entries.
 *
 * Accepted entry shapes:
 * - `{ vault_path, title?, kind? }`
 * - `{ path, title?, kind? }`
 * - `{ url, title?, kind? }` (web)
 * - bare string path / URL
 *
 * Malformed entries are dropped (fail soft).
 */
export function parseSubagentArtifacts(
  raw: unknown,
): SubagentArtifact[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    return undefined;
  }
  const seen = new Set<string>();
  const out: SubagentArtifact[] = [];
  for (const entry of raw) {
    let path = "";
    let title: string | undefined;
    let kindHint: unknown;
    if (typeof entry === "string") {
      path = entry.trim();
    } else if (entry && typeof entry === "object") {
      const rec = entry as Record<string, unknown>;
      const vaultPath =
        typeof rec.vault_path === "string"
          ? rec.vault_path
          : typeof rec.vaultPath === "string"
            ? rec.vaultPath
            : undefined;
      const pathField =
        typeof rec.path === "string"
          ? rec.path
          : typeof rec.file_path === "string"
            ? rec.file_path
            : typeof rec.filePath === "string"
              ? rec.filePath
              : undefined;
      const urlField =
        typeof rec.url === "string"
          ? rec.url
          : typeof rec.href === "string"
            ? rec.href
            : undefined;
      path = (vaultPath ?? pathField ?? urlField ?? "").trim();
      if (typeof rec.title === "string" && rec.title.trim()) {
        title = rec.title.trim();
      } else if (typeof rec.name === "string" && rec.name.trim()) {
        title = rec.name.trim();
      }
      kindHint = rec.kind ?? rec.type;
    } else {
      continue;
    }
    if (!path) {
      continue;
    }
    const kind = normalizeArtifactKind(kindHint, path);
    if (kind === "web") {
      if (!isHttpArtifactPath(path)) {
        continue;
      }
    } else if (!isSafeVaultArtifactPath(path)) {
      continue;
    }
    if (seen.has(path)) {
      continue;
    }
    seen.add(path);
    const resolvedTitle = artifactTitleFromPath(path, title);
    out.push(
      resolvedTitle
        ? { path, title: resolvedTitle, kind }
        : { path, kind },
    );
  }
  return out.length > 0 ? out : undefined;
}

/** Merge artifact lists; first-seen path wins (host order preferred). */
export function mergeSubagentArtifacts(
  ...lists: Array<SubagentArtifact[] | undefined>
): SubagentArtifact[] {
  const seen = new Set<string>();
  const out: SubagentArtifact[] = [];
  for (const list of lists) {
    if (!list?.length) continue;
    for (const a of list) {
      const path = a.path?.trim();
      if (!path || seen.has(path)) continue;
      seen.add(path);
      out.push(a);
    }
  }
  return out;
}

/**
 * Tool name heuristics for nested-tool harvest (write/read/file tools).
 * Keep aligned with useChatEvents FILE_TOOL_NAME_RE loosely.
 */
const ARTIFACT_FILE_TOOL_RE =
  /^(read|read_file|write|write_file|edit|edit_file|create_file|apply_patch|patch|search_replace|cat|open|vault_read|vault_write|vault\.read|vault\.write)$/i;

function bareToolId(name: string | undefined): string {
  const raw = name?.trim() ?? "";
  if (!raw || /\s/.test(raw) || raw.length > 64) return raw;
  const sep = raw.lastIndexOf("__");
  if (sep >= 0 && sep < raw.length - 1) {
    return raw.slice(sep + 2);
  }
  return raw;
}

function toolLooksLikeFileWork(call: {
  name?: string;
  technicalName?: string;
  target?: string;
}): boolean {
  const technical = call.technicalName?.trim();
  const bare =
    bareToolId(technical) || bareToolId(call.name);
  if (ARTIFACT_FILE_TOOL_RE.test(bare) || ARTIFACT_FILE_TOOL_RE.test(call.name ?? "")) {
    return true;
  }
  // Path-like target alone is enough (host used friendly activity label).
  return isSafeVaultArtifactPath(call.target);
}

/**
 * Harvest vault (and web) paths from nested tool rows when the host omits
 * metadata.artifacts. Prefer complete file tools; expand safe paths from
 * result bodies when target is missing (lp-uxy.2).
 */
export function harvestArtifactsFromNestedTools(
  tools: ReadonlyArray<
    Pick<
      NestedSubagentToolCall,
      "name" | "technicalName" | "target" | "result" | "status" | "kind"
    >
  >,
): SubagentArtifact[] {
  const seen = new Set<string>();
  const out: SubagentArtifact[] = [];

  const push = (path: string, kind: SubagentArtifactKind, title?: string) => {
    const p = path.trim();
    if (!p || seen.has(p)) return;
    if (kind === "web") {
      if (!isHttpArtifactPath(p)) return;
    } else if (!isSafeVaultArtifactPath(p)) {
      return;
    }
    seen.add(p);
    const t = artifactTitleFromPath(p, title);
    out.push(t ? { path: p, title: t, kind } : { path: p, kind });
  };

  for (const call of tools) {
    if (call.kind === "subagent" || call.kind === "workflow") {
      continue;
    }
    // Prefer successful/complete/running rows; failed writes do not mint chips.
    if (call.status === "error") {
      continue;
    }
    if (!toolLooksLikeFileWork(call) && !call.result?.trim()) {
      continue;
    }

    const target = call.target?.trim();
    if (target) {
      if (isHttpArtifactPath(target)) {
        push(target, "web");
      } else if (isSafeVaultArtifactPath(target) && toolLooksLikeFileWork(call)) {
        push(target, "vault");
      }
    }

    // Expand tool result paths when safe (target missing or additional paths).
    if (call.result?.trim() && (toolLooksLikeFileWork(call) || !target)) {
      for (const path of extractSafeVaultPathsFromToolResult(call.result)) {
        push(path, "vault");
      }
    }
  }

  return out;
}

/**
 * Resolve the artifact list for SubagentDetail + citation harvest (lp-uxy.2).
 *
 * Host `artifacts[]` wins for ordering; nested-tool harvest fills gaps so
 * durable multi-file access works even when the host only dual-emits tools.
 */
export function resolveSubagentArtifacts(
  hostArtifacts: SubagentArtifact[] | undefined,
  nestedTools: ReadonlyArray<
    Pick<
      NestedSubagentToolCall,
      "name" | "technicalName" | "target" | "result" | "status" | "kind"
    >
  > = [],
): SubagentArtifact[] {
  const harvested = harvestArtifactsFromNestedTools(nestedTools);
  return mergeSubagentArtifacts(hostArtifacts, harvested);
}

/**
 * Project artifacts to citation-shaped entries for final assistant messages.
 * Web URLs keep exact path (= URL); vault paths are left as-is for the
 * citation resolver (projectVaultPath join happens in useChatEvents).
 */
export function citationsFromSubagentArtifacts(
  artifacts: readonly SubagentArtifact[],
): Array<{ path: string; title?: string }> {
  const seen = new Set<string>();
  const out: Array<{ path: string; title?: string }> = [];
  for (const a of artifacts) {
    const path = a.path?.trim();
    if (!path || seen.has(path)) continue;
    if (a.kind === "vault" && !isSafeVaultArtifactPath(path)) continue;
    if (a.kind === "web" && !isHttpArtifactPath(path)) continue;
    seen.add(path);
    out.push(a.title ? { path, title: a.title } : { path });
  }
  return out;
}
