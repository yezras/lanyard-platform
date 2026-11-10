/**
 * WorkflowRun domain + wire mapping (lp-dpr.7).
 *
 * Models host workflow progress as first-class chat activity:
 * ordered stages (name, status, duration), nested subagents per stage,
 * and peer tool call ids. Inline card + activity pane tree share this shape.
 *
 * Wire: portal_event "workflow_progress" | "workflow" | tool_kind=workflow.
 * Full stage snapshots preferred; partial stage_* fields merge into existing.
 * Sibling tools and result.agents reduce onto stages when the host omits nest.
 */

import type { ChatEvent, ChatToolCallStatus } from "../../api/types.js";

import {
  mapSubagentRunFromToolCall,
  subagentColor,
  subagentIconKey,
  type SubagentRun,
  type SubagentRunStatus,
  type SubagentIconKey,
} from "./subagentRun.js";

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

/** Lifecycle for a workflow stage / overall run. */
export type WorkflowStageStatus =
  | "pending"
  | "running"
  | "complete"
  | "error"
  | "skipped";

/**
 * One ordered stage within a WorkflowRun.
 * Nested subagents / tools appear under the stage when expanded.
 */
export type WorkflowStage = {
  id: string;
  name: string;
  status: WorkflowStageStatus;
  /** Host-provided duration when terminal (e.g. "2.1s"). */
  duration?: string;
  /** Short work label for the stage. */
  summary?: string;
  /** Nested subagent run ids linked to this stage. */
  subagentIds?: string[];
  /** Peer tool_call_ids under this stage (not subagents). */
  toolCallIds?: string[];
};

/**
 * First-class workflow session shown as an inline card and activity tree.
 *
 * `id` is the stable upsert key (`workflow_id` / `tool_call_id` preferred).
 */
export type WorkflowRun = {
  id: string;
  name: string;
  status: WorkflowStageStatus;
  stages: WorkflowStage[];
  startedAt?: string;
  duration?: string;
  summary?: string;
};

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Map host status strings onto WorkflowStageStatus.
 * Accepts tool-style aliases plus skipped / cancelled-as-error.
 */
export function normalizeWorkflowStatus(
  value: unknown,
  fallback: WorkflowStageStatus = "running",
): WorkflowStageStatus {
  if (typeof value !== "string") {
    return fallback;
  }
  const raw = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!raw) {
    return fallback;
  }

  if (
    raw === "pending" ||
    raw === "queued" ||
    raw === "waiting" ||
    raw === "scheduled" ||
    raw === "idle" ||
    raw === "not_started"
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
    raw === "skipped" ||
    raw === "skip" ||
    raw === "omitted" ||
    raw === "not_applicable" ||
    raw === "n_a"
  ) {
    return "skipped";
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

  return fallback;
}

/** Map ChatToolCallStatus → WorkflowStageStatus. */
export function workflowStatusFromToolStatus(
  status: ChatToolCallStatus | undefined,
): WorkflowStageStatus {
  switch (status) {
    case "complete":
      return "complete";
    case "error":
      return "error";
    case "pending":
      return "pending";
    case "running":
    default:
      return "running";
  }
}

/** Map WorkflowStageStatus → ChatToolCallStatus for timeline storage. */
export function chatToolStatusFromWorkflowStatus(
  status: WorkflowStageStatus,
): ChatToolCallStatus {
  switch (status) {
    case "complete":
    case "skipped":
      return "complete";
    case "error":
      return "error";
    case "pending":
      return "pending";
    case "running":
    default:
      return "running";
  }
}

export function isTerminalWorkflowStatus(status: WorkflowStageStatus): boolean {
  return status === "complete" || status === "error" || status === "skipped";
}

export function workflowStatusLabel(status: WorkflowStageStatus): string {
  switch (status) {
    case "pending":
      return "pending";
    case "complete":
      return "complete";
    case "error":
      return "failed";
    case "skipped":
      return "skipped";
    case "running":
    default:
      return "running";
  }
}

/**
 * Derive overall run status from ordered stages when host omitted top-level.
 * Priority: any error → error; any running → running; all pending → pending;
 * all terminal complete/skipped → complete; mixed → running.
 */
export function deriveWorkflowStatusFromStages(
  stages: readonly WorkflowStage[],
): WorkflowStageStatus {
  if (stages.length === 0) {
    return "running";
  }
  if (stages.some((s) => s.status === "error")) {
    return "error";
  }
  if (stages.some((s) => s.status === "running")) {
    return "running";
  }
  if (stages.every((s) => s.status === "pending")) {
    return "pending";
  }
  if (
    stages.every(
      (s) =>
        s.status === "complete" ||
        s.status === "skipped" ||
        s.status === "error",
    )
  ) {
    // error already handled above
    return "complete";
  }
  return "running";
}

// ---------------------------------------------------------------------------
// Detect + map from wire
// ---------------------------------------------------------------------------

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

function readStringIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const ids = value
    .map((item) => {
      if (typeof item === "string" && item.trim()) {
        return item.trim();
      }
      if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        for (const k of ["id", "tool_call_id", "subagent_id", "run_id"]) {
          const v = rec[k];
          if (typeof v === "string" && v.trim()) {
            return v.trim();
          }
        }
      }
      return undefined;
    })
    .filter((id): id is string => Boolean(id));
  return ids.length > 0 ? ids : undefined;
}

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function assignIfMissing(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (target[key] != null) {
    return;
  }
  if (value === undefined || value === null) {
    return;
  }
  if (typeof value === "string" && !value.trim()) {
    return;
  }
  target[key] = value;
}

function liftWorkflowFieldsFromNested(
  target: Record<string, unknown>,
  nested: Record<string, unknown>,
): void {
  assignIfMissing(
    target,
    "stages",
    nested.stages ?? nested.workflow_stages ?? nested.workflowStages,
  );
  assignIfMissing(target, "workflow_id", nested.workflow_id ?? nested.workflowId);
  assignIfMissing(
    target,
    "workflow_name",
    nested.workflow_name ?? nested.workflowName,
  );
  assignIfMissing(
    target,
    "workflow_status",
    nested.workflow_status ?? nested.workflowStatus,
  );
  assignIfMissing(target, "summary", nested.summary);
  assignIfMissing(target, "started_at", nested.started_at ?? nested.startedAt);
  assignIfMissing(target, "duration", nested.duration);
  assignIfMissing(target, "agents", nested.agents);

  const run = nested.run;
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    return;
  }
  const rec = run as Record<string, unknown>;
  assignIfMissing(target, "workflow_id", rec.run_id ?? rec.workflow_id);
  assignIfMissing(
    target,
    "workflow_name",
    rec.display_name ?? rec.workflow_name ?? rec.name,
  );
  assignIfMissing(target, "workflow_status", rec.status);
  assignIfMissing(target, "agents", rec.agents);
}

/**
 * Lift workflow_id / stages off a nested JSON `result` when the host only
 * stringified the progress snapshot (lp-oop.38.21). First-class fields win.
 */
export function unwrapWorkflowMetadata(
  meta: Record<string, unknown> | undefined,
  result?: unknown,
): Record<string, unknown> | undefined {
  const nested = parseJsonObject(meta?.result) ?? parseJsonObject(result);
  if (!nested) {
    return meta;
  }
  const out: Record<string, unknown> = meta ? { ...meta } : {};
  liftWorkflowFieldsFromNested(out, nested);
  return out;
}

/** Stable WorkflowRun id from first-class metadata or nested result JSON. */
export function readWorkflowIdFromEvent(event: ChatEvent): string | undefined {
  const meta = unwrapWorkflowMetadata(event.metadata, event.result);
  return readMetaString(meta, "workflow_id", "workflowId");
}

function readWorkflowDisplayName(
  event: ChatEvent,
  meta: Record<string, unknown> | undefined,
  existing?: string,
): string {
  const fromMeta = readMetaString(meta, "workflow_name", "workflowName");
  if (fromMeta) {
    return fromMeta;
  }
  const label = event.tool_label?.trim();
  if (label) {
    return label;
  }
  const toolName = event.tool_name?.trim();
  if (toolName && toolName.toLowerCase() !== "workflow") {
    return toolName;
  }
  const metaName = readMetaString(meta, "name");
  if (metaName && metaName.toLowerCase() !== "workflow") {
    return metaName;
  }
  return existing || event.content?.trim() || "Workflow";
}

function parseStageObject(
  raw: unknown,
  index: number,
): WorkflowStage | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const rec = raw as Record<string, unknown>;
  const name =
    (typeof rec.name === "string" && rec.name.trim()) ||
    (typeof rec.stage_name === "string" && rec.stage_name.trim()) ||
    (typeof rec.label === "string" && rec.label.trim()) ||
    `Stage ${index + 1}`;
  const id =
    (typeof rec.id === "string" && rec.id.trim()) ||
    (typeof rec.stage_id === "string" && rec.stage_id.trim()) ||
    `stage-${index + 1}`;
  const status = normalizeWorkflowStatus(
    rec.status ?? rec.stage_status ?? rec.state ?? rec.phase,
    "pending",
  );
  const stage: WorkflowStage = { id, name, status };
  const duration =
    (typeof rec.duration === "string" && rec.duration.trim()) ||
    (typeof rec.duration_ms === "number"
      ? `${rec.duration_ms}ms`
      : undefined) ||
    undefined;
  if (duration) stage.duration = duration;
  const summary =
    (typeof rec.summary === "string" && rec.summary.trim()) ||
    (typeof rec.description === "string" && rec.description.trim()) ||
    (typeof rec.task === "string" && rec.task.trim()) ||
    undefined;
  if (summary) stage.summary = summary;
  const subagentIds =
    readStringIds(rec.subagent_ids) ??
    readStringIds(rec.subagentIds) ??
    readStringIds(rec.subagents);
  if (subagentIds) stage.subagentIds = subagentIds;
  const toolCallIds =
    readStringIds(rec.tool_call_ids) ??
    readStringIds(rec.toolCallIds) ??
    readStringIds(rec.tools);
  if (toolCallIds) stage.toolCallIds = toolCallIds;
  return stage;
}

/**
 * Parse ordered stages from metadata.stages / workflow_stages or a single
 * partial stage_* update envelope.
 */
export function parseWorkflowStages(
  meta: Record<string, unknown> | undefined,
): WorkflowStage[] {
  const envelope = unwrapWorkflowMetadata(meta);
  if (!envelope) {
    return [];
  }
  const list =
    envelope.stages ?? envelope.workflow_stages ?? envelope.workflowStages;
  if (Array.isArray(list)) {
    const stages: WorkflowStage[] = [];
    list.forEach((item, index) => {
      const stage = parseStageObject(item, index);
      if (stage) {
        stages.push(stage);
      }
    });
    return nestAgentsOntoWorkflowStages(
      stages,
      envelope.agents,
      readMetaString(envelope, "workflow_id", "workflowId"),
    );
  }

  // Partial single-stage update
  const stageId = readMetaString(envelope, "stage_id", "stageId");
  const stageName = readMetaString(envelope, "stage_name", "stageName");
  if (stageId || stageName) {
    const stage = parseStageObject(
      {
        id: stageId,
        name: stageName,
        status: envelope.stage_status ?? envelope.stageStatus ?? envelope.status,
        duration: envelope.stage_duration ?? envelope.duration,
        summary: envelope.stage_summary ?? envelope.summary,
        subagent_ids: envelope.stage_subagent_ids ?? envelope.subagent_ids,
        tool_call_ids: envelope.stage_tool_call_ids ?? envelope.tool_call_ids,
      },
      0,
    );
    return stage
      ? nestAgentsOntoWorkflowStages(
          [stage],
          envelope.agents,
          readMetaString(envelope, "workflow_id", "workflowId"),
        )
      : [];
  }

  return nestAgentsOntoWorkflowStages(
    [],
    envelope.agents,
    readMetaString(envelope, "workflow_id", "workflowId"),
  );
}

/**
 * Host nest/summary win when non-empty. Otherwise keep reduced nest from
 * sibling tools / agents so a later snapshot cannot wipe Plan/Explore work.
 */
function mergeStageRecord(
  prev: WorkflowStage | undefined,
  incoming: WorkflowStage,
): WorkflowStage {
  const next: WorkflowStage = {
    id: incoming.id,
    name: incoming.name || prev?.name || incoming.id,
    status: incoming.status,
  };
  if (incoming.duration ?? prev?.duration) {
    next.duration = incoming.duration ?? prev?.duration;
  }
  const summary = incoming.summary?.trim() || prev?.summary;
  if (summary) next.summary = summary;
  const subagentIds =
    incoming.subagentIds && incoming.subagentIds.length > 0
      ? incoming.subagentIds
      : prev?.subagentIds;
  if (subagentIds?.length) next.subagentIds = [...subagentIds];
  const toolCallIds =
    incoming.toolCallIds && incoming.toolCallIds.length > 0
      ? incoming.toolCallIds
      : prev?.toolCallIds;
  if (toolCallIds?.length) next.toolCallIds = [...toolCallIds];
  return next;
}

/**
 * Merge a partial stage list into existing stages (by id).
 * Unknown stage ids append; known ids upsert fields without dropping nested ids
 * unless the update provides new non-empty lists.
 */
export function mergeWorkflowStages(
  existing: readonly WorkflowStage[],
  incoming: readonly WorkflowStage[],
): WorkflowStage[] {
  if (incoming.length === 0) {
    return [...existing];
  }
  if (incoming.length > 1) {
    const prevById = new Map(existing.map((stage) => [stage.id, stage]));
    return incoming.map((stage) => mergeStageRecord(prevById.get(stage.id), stage));
  }
  const patch = incoming[0]!;
  const idx = existing.findIndex((s) => s.id === patch.id);
  if (idx < 0) {
    return [...existing, mergeStageRecord(undefined, patch)];
  }
  const copy = existing.map((s) => ({ ...s }));
  copy[idx] = mergeStageRecord(existing[idx], patch);
  return copy;
}

/** True when a ChatEvent should render as a WorkflowRun card. */
export function isWorkflowEvent(event: ChatEvent): boolean {
  const kind = event.tool_kind?.trim().toLowerCase();
  if (kind === "workflow") {
    return true;
  }
  const portal =
    typeof event.metadata?.portal_event === "string"
      ? event.metadata.portal_event.trim().toLowerCase()
      : "";
  if (
    portal === "workflow_progress" ||
    portal === "workflow" ||
    portal === "workflow.start" ||
    portal === "workflow.update" ||
    portal === "workflow.end" ||
    portal === "workflow.error"
  ) {
    return true;
  }
  const metaKind =
    typeof event.metadata?.tool_kind === "string"
      ? event.metadata.tool_kind.trim().toLowerCase()
      : typeof event.metadata?.kind === "string"
        ? event.metadata.kind.trim().toLowerCase()
        : "";
  if (metaKind === "workflow") {
    return true;
  }
  // Explicit workflow_id + stages snapshot (without portal_event).
  const meta = unwrapWorkflowMetadata(event.metadata, event.result);
  if (
    meta &&
    readMetaString(meta, "workflow_id", "workflowId") &&
    (Array.isArray(meta.stages) ||
      Array.isArray(meta.workflow_stages) ||
      Array.isArray(meta.workflowStages))
  ) {
    return true;
  }
  return false;
}

/**
 * Map a workflow ChatEvent onto WorkflowRun.
 * Returns null when the event is not a workflow row.
 */
export function mapWorkflowRunFromEvent(
  event: ChatEvent,
  options?: { existing?: WorkflowRun },
): WorkflowRun | null {
  if (!isWorkflowEvent(event) && !options?.existing) {
    return null;
  }
  // Allow merge path only when existing provided even if detect is weak.
  if (!isWorkflowEvent(event) && options?.existing) {
    return options.existing;
  }

  const meta = unwrapWorkflowMetadata(event.metadata, event.result);
  const name = readWorkflowDisplayName(event, meta, options?.existing?.name);

  const id =
    readMetaString(meta, "workflow_id", "workflowId") ||
    event.tool_call_id?.trim() ||
    options?.existing?.id ||
    `workflow:${name}`;

  const incomingStages = parseWorkflowStages(meta);
  const stages =
    options?.existing?.stages?.length && incomingStages.length > 0
      ? mergeWorkflowStages(options.existing.stages, incomingStages)
      : incomingStages.length > 0
        ? incomingStages
        : (options?.existing?.stages ?? []);

  const statusProbe =
    readMetaString(
      meta,
      "workflow_status",
      "workflowStatus",
      "tool_status",
      "status",
      "state",
      "phase",
    ) ?? event.tool_status;
  const status = statusProbe
    ? normalizeWorkflowStatus(statusProbe, "running")
    : stages.length > 0
      ? deriveWorkflowStatusFromStages(stages)
      : (options?.existing?.status ?? "running");

  const startedAt =
    readMetaString(meta, "started_at", "startedAt", "start_time") ||
    event.created_at ||
    options?.existing?.startedAt;

  const duration =
    (typeof event.duration === "string" && event.duration.trim()
      ? event.duration.trim()
      : undefined) ||
    readMetaString(meta, "duration") ||
    options?.existing?.duration;

  const summary =
    event.tool_target?.trim() ||
    readMetaString(meta, "summary", "description", "task") ||
    options?.existing?.summary;

  const run: WorkflowRun = {
    id,
    name,
    status,
    stages,
  };
  if (startedAt) run.startedAt = startedAt;
  if (duration) run.duration = duration;
  if (summary) run.summary = summary;
  return run;
}

/**
 * Build WorkflowRun from a hydrated timeline tool call (history / live).
 */
export function mapWorkflowRunFromToolCall(call: {
  key: string;
  name: string;
  target?: string;
  status: ChatToolCallStatus;
  duration?: string;
  result?: string;
  kind?: "tool" | "subagent" | "workflow";
  summary?: string;
  startedAt?: string;
  workflowStatus?: WorkflowStageStatus;
  workflowStages?: WorkflowStage[];
}): WorkflowRun | null {
  if (call.kind !== "workflow") {
    return null;
  }
  const stages = call.workflowStages ?? [];
  const status =
    call.workflowStatus ??
    (stages.length > 0
      ? deriveWorkflowStatusFromStages(stages)
      : workflowStatusFromToolStatus(call.status));
  const run: WorkflowRun = {
    id: call.key,
    name: call.name?.trim() || "Workflow",
    status,
    stages: stages.map((s) => ({ ...s })),
  };
  if (call.startedAt) run.startedAt = call.startedAt;
  if (call.duration) run.duration = call.duration;
  if (call.summary || call.target) {
    run.summary = call.summary ?? call.target;
  }
  return run;
}

/**
 * Attach a subagent id onto a stage (by stage_id) when the host links via
 * metadata.workflow_id + stage_id on subagent events.
 */
export function attachSubagentToWorkflowStage(
  run: WorkflowRun,
  stageId: string,
  subagentId: string,
): WorkflowRun {
  const stages = run.stages.map((stage) => {
    if (stage.id !== stageId) {
      return stage;
    }
    const existing = stage.subagentIds ?? [];
    if (existing.includes(subagentId)) {
      return stage;
    }
    return { ...stage, subagentIds: [...existing, subagentId] };
  });
  return { ...run, stages };
}

/** Wire roster row from workflow result / state.agents. */
export type WorkflowAgentWire = {
  id?: string;
  label?: string;
  name?: string;
  status?: string;
  summary?: string;
  phase?: string;
};

/** Sibling timeline activity reduced onto a running workflow stage. */
export type WorkflowPeerActivity = {
  key: string;
  name: string;
  kind?: "tool" | "subagent" | "workflow";
  summary?: string;
  parentSubagentId?: string;
  parentToolCallId?: string;
  stageId?: string;
};

function parseAgentWire(raw: unknown): WorkflowAgentWire | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const rec = raw as Record<string, unknown>;
  const id =
    typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : undefined;
  const label =
    (typeof rec.label === "string" && rec.label.trim()) ||
    (typeof rec.name === "string" && rec.name.trim()) ||
    undefined;
  const summary =
    typeof rec.summary === "string" && rec.summary.trim()
      ? rec.summary.trim()
      : undefined;
  const phase =
    (typeof rec.phase === "string" && rec.phase.trim()) ||
    (typeof rec.stage_id === "string" && rec.stage_id.trim()) ||
    (typeof rec.stageId === "string" && rec.stageId.trim()) ||
    undefined;
  const status =
    typeof rec.status === "string" && rec.status.trim()
      ? rec.status.trim()
      : undefined;
  if (!id && !label && !summary && !phase) {
    return null;
  }
  return { id, label, name: label, status, summary, phase };
}

function stageKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function matchStageForAgent(
  stages: readonly WorkflowStage[],
  agent: WorkflowAgentWire,
): WorkflowStage | undefined {
  const phase = agent.phase?.trim();
  if (phase) {
    const key = stageKey(phase);
    const hit = stages.find(
      (stage) => stageKey(stage.id) === key || stageKey(stage.name) === key,
    );
    if (hit) return hit;
  }
  return (
    stages.find((stage) => stage.status === "running") ??
    [...stages]
      .reverse()
      .find((stage) => stage.status === "complete" || stage.status === "error")
  );
}

function helperIdForAgent(
  agent: WorkflowAgentWire,
  workflowId?: string,
): string | undefined {
  if (agent.id?.trim()) return agent.id.trim();
  const label = (agent.label ?? agent.name)?.trim();
  if (!label) return undefined;
  const wf = workflowId?.trim();
  return wf ? `${wf}:${label}` : label;
}

function appendUniqueId(ids: readonly string[] | undefined, id: string): string[] {
  if (ids?.includes(id)) return [...(ids ?? [])];
  return [...(ids ?? []), id];
}

function appendUniqueSummary(
  existing: string | undefined,
  addition: string,
): string {
  const next = addition.trim();
  if (!next) return existing ?? "";
  const parts = (existing ?? "")
    .split(" · ")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.some((part) => part.toLowerCase() === next.toLowerCase())) {
    parts.push(next);
  }
  return parts.slice(0, 4).join(" · ");
}

/**
 * Map `state.agents` / result.agents onto stages. Host `subagentIds` stay.
 * Empty agents stay empty — does not invent helpers.
 */
export function nestAgentsOntoWorkflowStages(
  stages: readonly WorkflowStage[],
  agents: unknown,
  workflowId?: string,
): WorkflowStage[] {
  if (stages.length === 0) {
    return [];
  }
  if (!Array.isArray(agents) || agents.length === 0) {
    return stages.map((stage) => ({ ...stage }));
  }
  const parsed = agents
    .map(parseAgentWire)
    .filter((row): row is WorkflowAgentWire => Boolean(row));
  if (parsed.length === 0) {
    return stages.map((stage) => ({ ...stage }));
  }

  const next = stages.map((stage) => ({ ...stage }));
  for (const agent of parsed) {
    const target = matchStageForAgent(next, agent);
    if (!target) continue;
    const idx = next.findIndex((stage) => stage.id === target.id);
    if (idx < 0) continue;
    const stage = next[idx]!;
    const helperId = helperIdForAgent(agent, workflowId);
    const subagentIds = helperId
      ? appendUniqueId(stage.subagentIds, helperId)
      : stage.subagentIds;
    const summary = stage.summary?.trim() || agent.summary;
    next[idx] = {
      ...stage,
      ...(subagentIds?.length ? { subagentIds } : {}),
      ...(summary ? { summary } : {}),
    };
  }
  return next;
}

function pickStageForPeer(
  stages: readonly WorkflowStage[],
  activity: WorkflowPeerActivity,
): WorkflowStage | undefined {
  const hinted = activity.stageId?.trim();
  if (hinted) {
    const key = stageKey(hinted);
    const hit = stages.find(
      (stage) => stageKey(stage.id) === key || stageKey(stage.name) === key,
    );
    if (hit) return hit;
  }
  return (
    stages.find((stage) => stage.status === "running") ??
    [...stages]
      .reverse()
      .find((stage) => stage.status === "complete" || stage.status === "error")
  );
}

function stageClaimsActivity(stage: WorkflowStage, key: string): boolean {
  return Boolean(
    stage.toolCallIds?.includes(key) || stage.subagentIds?.includes(key),
  );
}

/**
 * Reduce one sibling tool/subagent onto the running (or hinted) stage.
 * Idempotent. Does not invent rows when the activity key is empty.
 */
export function applyPeerActivityToWorkflowStages(
  stages: readonly WorkflowStage[],
  activity: WorkflowPeerActivity,
  options?: { workflowId?: string },
): WorkflowStage[] {
  if (stages.length === 0) {
    return [];
  }
  if (activity.kind === "workflow") {
    return stages.map((stage) => ({ ...stage }));
  }
  const key = activity.key.trim();
  if (!key) {
    return stages.map((stage) => ({ ...stage }));
  }
  if (stages.some((stage) => stageClaimsActivity(stage, key))) {
    return stages.map((stage) => ({ ...stage }));
  }
  const workflowId = options?.workflowId?.trim();
  const parent = activity.parentToolCallId?.trim();
  if (
    workflowId &&
    parent &&
    parent !== workflowId &&
    !activity.stageId &&
    !activity.parentSubagentId
  ) {
    return stages.map((stage) => ({ ...stage }));
  }
  const target = pickStageForPeer(stages, activity);
  if (!target) {
    return stages.map((stage) => ({ ...stage }));
  }

  const helperId =
    activity.kind === "subagent"
      ? key
      : activity.parentSubagentId?.trim() || undefined;
  const toolName = activity.name.trim();
  const derived =
    activity.summary?.trim() ||
    (toolName && activity.kind !== "subagent" ? toolName : undefined);

  return stages.map((stage) => {
    if (stage.id !== target.id) {
      return stage;
    }
    const subagentIds = helperId
      ? appendUniqueId(stage.subagentIds, helperId)
      : stage.subagentIds;
    const toolCallIds =
      activity.kind === "subagent"
        ? stage.toolCallIds
        : appendUniqueId(stage.toolCallIds, key);
    let summary = stage.summary;
    if (derived) {
      if (!summary) {
        summary = derived;
      } else if ((stage.toolCallIds?.length ?? 0) > 0) {
        summary = appendUniqueSummary(summary, derived);
      }
    }
    const next: WorkflowStage = { ...stage };
    if (subagentIds?.length) next.subagentIds = subagentIds;
    if (toolCallIds?.length) next.toolCallIds = toolCallIds;
    if (summary) next.summary = summary;
    return next;
  });
}

function humanizeHelperId(id: string): string {
  const trimmed = id.trim();
  const tail = trimmed.split(/[:/]/).filter(Boolean).pop() ?? trimmed;
  return tail.trim() || "helper";
}

function placeholderSubagentForStage(
  id: string,
  stage: WorkflowStage,
): SubagentRun {
  const name = humanizeHelperId(id);
  const status: SubagentRunStatus =
    stage.status === "error"
      ? "failed"
      : stage.status === "running" || stage.status === "pending"
        ? "running"
        : "done";
  const run: SubagentRun = {
    id,
    name,
    status,
    color: subagentColor(name),
    icon: subagentIconKey(name),
  };
  if (stage.summary) run.summary = stage.summary;
  return run;
}

/**
 * Resolve nested helpers for a stage. Host roster rows win; unresolved
 * `subagentIds` materialize from the id so completed research-lite stages
 * still show helper name + status when dual-emit was missing.
 */
export function materializeStageSubagents(
  stage: WorkflowStage,
  allStages: readonly WorkflowStage[],
  runs: readonly SubagentRun[],
  options?: { workflowId?: string },
): SubagentRun[] {
  const nested = resolveStageSubagentsWithFallback(
    stage,
    allStages,
    runs,
    options,
  );
  if (nested.length > 0) {
    return nested;
  }
  if (!stage.subagentIds?.length) {
    return [];
  }
  const byId = new Map(runs.map((run) => [run.id, run]));
  return stage.subagentIds.map(
    (id) => byId.get(id) ?? placeholderSubagentForStage(id, stage),
  );
}

/**
 * Collect unique WorkflowRun rows from timeline items (latest status wins).
 * Active runs first, then recent terminal (stable first-seen order).
 */
export function collectWorkflowRunsFromTimeline(
  items: ReadonlyArray<{
    type: string;
    toolCalls?: ReadonlyArray<{
      key: string;
      name: string;
      target?: string;
      status: ChatToolCallStatus;
      duration?: string;
      result?: string;
      kind?: "tool" | "subagent" | "workflow";
      summary?: string;
      startedAt?: string;
      workflowStatus?: WorkflowStageStatus;
      workflowStages?: WorkflowStage[];
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
        kind?: "tool" | "subagent" | "workflow";
        summary?: string;
        startedAt?: string;
        workflowStatus?: WorkflowStageStatus;
        workflowStages?: WorkflowStage[];
      };
    }>;
  }>,
): WorkflowRun[] {
  const byId = new Map<string, WorkflowRun>();
  const order: string[] = [];

  const ingest = (call: {
    key: string;
    name: string;
    target?: string;
    status: ChatToolCallStatus;
    duration?: string;
    result?: string;
    kind?: "tool" | "subagent" | "workflow";
    summary?: string;
    startedAt?: string;
    workflowStatus?: WorkflowStageStatus;
    workflowStages?: WorkflowStage[];
  }) => {
    const run = mapWorkflowRunFromToolCall(call);
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
    .filter((r): r is WorkflowRun => Boolean(r));

  const rank = (s: WorkflowStageStatus): number => {
    switch (s) {
      case "running":
        return 0;
      case "pending":
        return 1;
      case "error":
        return 2;
      case "complete":
        return 3;
      case "skipped":
        return 4;
      default:
        return 5;
    }
  };

  return [...runs].sort((a, b) => {
    const d = rank(a.status) - rank(b.status);
    if (d !== 0) return d;
    return order.indexOf(a.id) - order.indexOf(b.id);
  });
}

/**
 * Resolve nested subagent runs for a stage from a roster (by id).
 * Missing ids are omitted (stale links after thread cleanup).
 */
export function resolveStageSubagents(
  stage: WorkflowStage,
  runs: readonly SubagentRun[],
): SubagentRun[] {
  if (!stage.subagentIds?.length) {
    return [];
  }
  const byId = new Map(runs.map((r) => [r.id, r]));
  return stage.subagentIds
    .map((id) => byId.get(id))
    .filter((r): r is SubagentRun => Boolean(r));
}

/** Active subagent statuses eligible for client nest fallback. */
function isActiveSubagentForFallback(run: SubagentRun): boolean {
  // Wire "pending" / "queued" normalize to "running" on SubagentRun.
  // needs_input is still mid-flight nested work.
  return run.status === "running" || run.status === "needs_input";
}

/**
 * Host-claimed subagent ids across all stages (non-empty stage.subagentIds).
 */
export function collectClaimedStageSubagentIds(
  stages: readonly WorkflowStage[],
): Set<string> {
  const claimed = new Set<string>();
  for (const stage of stages) {
    for (const id of stage.subagentIds ?? []) {
      if (id) claimed.add(id);
    }
  }
  return claimed;
}

/**
 * Free-floating SubagentRun rows eligible for client fallback nest:
 * currently active (running / needs_input), and not listed on any stage's
 * host `subagentIds`. Does not invent rows when the roster is empty.
 *
 * When `workflowId` is set and at least one candidate links via
 * `parentToolCallId === workflowId`, prefer those linked runs only.
 */
export function listFreeFloatingSubagents(
  stages: readonly WorkflowStage[],
  runs: readonly SubagentRun[],
  options?: { workflowId?: string },
): SubagentRun[] {
  if (runs.length === 0) {
    return [];
  }
  const claimed = collectClaimedStageSubagentIds(stages);
  let candidates = runs.filter(
    (run) => isActiveSubagentForFallback(run) && !claimed.has(run.id),
  );
  const workflowId = options?.workflowId?.trim();
  if (workflowId) {
    const linked = candidates.filter(
      (run) => run.parentToolCallId?.trim() === workflowId,
    );
    if (linked.length > 0) {
      candidates = linked;
    }
  }
  return candidates;
}

/**
 * Resolve nested subagents for a stage with client-side fallback (lp-a8u.5).
 *
 * - Host `stage.subagentIds` always wins when non-empty (no double-count with
 *   free-floaters).
 * - When the stage is `running` and the host nested list is empty, attach
 *   free-floating active SubagentRun rows not claimed by another stage.
 * - Only the first running stage (in order) with an empty host list receives
 *   free-floaters, so multi-stage runs do not double-render the same chips.
 * - Does not invent fake subagents when the roster has no free-floaters.
 */
export function resolveStageSubagentsWithFallback(
  stage: WorkflowStage,
  allStages: readonly WorkflowStage[],
  runs: readonly SubagentRun[],
  options?: { workflowId?: string },
): SubagentRun[] {
  // Host ids win: resolve only those, never mix free-floaters.
  if (stage.subagentIds?.length) {
    return resolveStageSubagents(stage, runs);
  }
  // Fallback only for an active running stage with an empty host nest list.
  if (stage.status !== "running") {
    return [];
  }
  const firstEmptyRunning = allStages.find(
    (s) => s.status === "running" && !(s.subagentIds?.length),
  );
  if (!firstEmptyRunning || firstEmptyRunning.id !== stage.id) {
    return [];
  }
  return listFreeFloatingSubagents(allStages, runs, options);
}

/**
 * Attach free-floating active subagents onto the first running stage that
 * lacks host `subagentIds`. Host-provided nest lists are never modified.
 * Uses {@link attachSubagentToWorkflowStage}; pure / non-mutating of input.
 */
export function applySubagentFallbackToWorkflow(
  run: WorkflowRun,
  roster: readonly SubagentRun[],
): WorkflowRun {
  const freeFloating = listFreeFloatingSubagents(run.stages, roster, {
    workflowId: run.id,
  });
  if (freeFloating.length === 0) {
    return run;
  }
  const target = run.stages.find(
    (s) => s.status === "running" && !(s.subagentIds?.length),
  );
  if (!target) {
    return run;
  }
  let next = run;
  for (const sa of freeFloating) {
    next = attachSubagentToWorkflowStage(next, target.id, sa.id);
  }
  return next;
}

/**
 * Collect subagent runs from the same timeline for nesting under stages.
 * Thin re-export shape for UI convenience without importing subagent module
 * in every consumer — callers with full roster should pass that instead.
 */
export function collectNestedSubagentsForWorkflow(
  run: WorkflowRun,
  items: ReadonlyArray<{
    type: string;
    toolCalls?: ReadonlyArray<{
      key: string;
      name: string;
      target?: string;
      status: ChatToolCallStatus;
      duration?: string;
      result?: string;
      kind?: "tool" | "subagent" | "workflow";
      subagentStatus?: SubagentRunStatus;
      subagentColor?: string;
      subagentIcon?: SubagentIconKey;
      startedAt?: string;
      parentToolCallId?: string;
      summary?: string;
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
        kind?: "tool" | "subagent" | "workflow";
        subagentStatus?: SubagentRunStatus;
        subagentColor?: string;
        subagentIcon?: SubagentIconKey;
        startedAt?: string;
        parentToolCallId?: string;
        summary?: string;
      };
    }>;
  }>,
): SubagentRun[] {
  const wanted = new Set<string>();
  for (const stage of run.stages) {
    for (const id of stage.subagentIds ?? []) {
      wanted.add(id);
    }
  }
  if (wanted.size === 0) {
    return [];
  }

  const found: SubagentRun[] = [];
  const seen = new Set<string>();

  const ingest = (call: {
    key: string;
    name: string;
    target?: string;
    status: ChatToolCallStatus;
    duration?: string;
    result?: string;
    kind?: "tool" | "subagent" | "workflow";
    subagentStatus?: SubagentRunStatus;
    subagentColor?: string;
    subagentIcon?: SubagentIconKey;
    startedAt?: string;
    parentToolCallId?: string;
    summary?: string;
  }) => {
    if (!wanted.has(call.key) || seen.has(call.key)) {
      return;
    }
    const mapped = mapSubagentRunFromToolCall(call);
    if (!mapped) {
      return;
    }
    seen.add(call.key);
    found.push(mapped);
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

  return found;
}

/** Card / tree title: `Onboard · running · 2/4 stages`. */
export function formatWorkflowCardLabel(run: WorkflowRun): string {
  const status = workflowStatusLabel(run.status);
  const total = run.stages.length;
  if (total === 0) {
    return run.duration
      ? `${run.name} · ${status} ${run.duration}`
      : `${run.name} · ${status}`;
  }
  const done = run.stages.filter(
    (s) => s.status === "complete" || s.status === "skipped",
  ).length;
  const progress = `${done}/${total}`;
  if (run.duration) {
    return `${run.name} · ${status} ${progress} · ${run.duration}`;
  }
  return `${run.name} · ${status} · ${progress}`;
}

/**
 * Default expand set for stages: running stages open; if none running,
 * expand the first incomplete; if all terminal, collapse all (user can open).
 */
export function defaultExpandedStageIds(run: WorkflowRun): string[] {
  const running = run.stages.filter((s) => s.status === "running");
  if (running.length > 0) {
    return running.map((s) => s.id);
  }
  const pending = run.stages.find((s) => s.status === "pending");
  if (pending) {
    return [pending.id];
  }
  // All terminal — leave collapsed for a clean card.
  return [];
}
