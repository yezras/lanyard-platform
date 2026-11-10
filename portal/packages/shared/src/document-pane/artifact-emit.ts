/**
 * Host / gateway emission helpers for chat artifact events (lp-5q6.31).
 *
 * Pure builders: turn agent file-tool lifecycle into **metadata-only**
 * `artifact.*` wire events (+ dual `tool_progress` for timeline rows).
 * Payloads never carry file bodies; the pane refreshes from vault APIs.
 *
 * Consumers:
 * - Hermes-Lanyard / gateway (Python or other host) should match this shape
 * - Mock gateways and replay fixtures inject events before the host lands
 * - Tests prove ordering and leak resistance without a live backend
 *
 * Protocol: docs/architecture/portal-chat-artifact-event-protocol.md
 * Host guide: docs/architecture/portal-host-artifact-event-emission.md
 */

import {
  ARTIFACT_FILE_TOOL_NAMES,
  type ArtifactErrorCode,
  type ArtifactEventWire,
  type ArtifactOpenEventWire,
  type ArtifactProducer,
  type ArtifactProgressEventWire,
  type ArtifactRevisionWire,
  type ArtifactUpdatedEventWire,
  type ArtifactWriteKind,
  looksLikeVaultPath,
  normalizeArtifactVaultPath,
} from "./artifact-events.js";

// ---------------------------------------------------------------------------
// Tool sets
// ---------------------------------------------------------------------------

/**
 * File tools that may open a path as the active work artifact (read or write).
 * Same set as {@link ARTIFACT_FILE_TOOL_NAMES} (harness `read` included).
 */
export const AGENT_FILE_TOOL_NAMES = ARTIFACT_FILE_TOOL_NAMES;

/** Subset that mutates vault bytes (drives open/progress → updated/error). */
export const AGENT_FILE_WRITE_TOOL_NAMES = new Set([
  "write_file",
  "edit",
  "edit_file",
  "create_file",
  "apply_patch",
  "patch",
  "search_replace",
  "vault_write",
  "vault.write",
  "write",
]);

// ---------------------------------------------------------------------------
// Error message sanitization (never leak file bodies)
// ---------------------------------------------------------------------------

/** Max safe length for artifact.error error_message on the wire. */
export const ARTIFACT_ERROR_MESSAGE_MAX_CHARS = 280;

/**
 * Strip content that looks like a file body or secret-bearing dump.
 * Hosts must pass tool failures through this before stamping metadata.
 */
export function sanitizeArtifactErrorMessage(
  raw: string | null | undefined,
  fallback = "Agent file work failed",
): string {
  if (typeof raw !== "string") return fallback;
  let msg = raw.replace(/\r\n/g, "\n").trim();
  if (!msg) return fallback;

  // Drop fenced code / large dumps (common when tools echo content on error).
  msg = msg.replace(/```[\s\S]*?```/g, "[redacted]");
  // Collapse multi-line bodies to a single line summary.
  const firstLine = msg.split("\n").find((ln) => ln.trim().length > 0) ?? msg;
  msg = firstLine.trim();

  // Reject obviously body-like single lines (very long continuous prose/code).
  if (msg.length > ARTIFACT_ERROR_MESSAGE_MAX_CHARS) {
    msg = `${msg.slice(0, ARTIFACT_ERROR_MESSAGE_MAX_CHARS - 1)}…`;
  }

  // Never allow base64-looking blobs or data URLs in error text.
  if (/^data:[^;]+;base64,/i.test(msg) || /^(?:[A-Za-z0-9+/]{40,}={0,2})$/.test(msg)) {
    return fallback;
  }

  return msg || fallback;
}

// ---------------------------------------------------------------------------
// Shared identity helpers
// ---------------------------------------------------------------------------

function basenameTitle(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function guessFileType(path: string): string {
  const base = basenameTitle(path);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "binary";
  return base.slice(dot + 1).toLowerCase();
}

function guessMimeType(fileType: string): string | undefined {
  const map: Record<string, string> = {
    md: "text/markdown",
    markdown: "text/markdown",
    txt: "text/plain",
    json: "application/json",
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    doc: "application/msword",
    xls: "application/vnd.ms-excel",
    ppt: "application/vnd.ms-powerpoint",
    csv: "text/csv",
    html: "text/html",
    htm: "text/html",
  };
  return map[fileType];
}

function resolveVaultPath(raw: string): string | null {
  const t = raw.trim();
  if (!t || !looksLikeVaultPath(t)) return null;
  return normalizeArtifactVaultPath(t.startsWith("/") ? t : `/${t}`);
}

function artifactIdForTool(
  toolCallId: string | undefined,
  vaultPath: string,
  operationId?: string,
): string {
  if (operationId?.trim()) return `op:${operationId.trim()}`;
  if (toolCallId?.trim()) return `tool:${toolCallId.trim()}`;
  return `path:${vaultPath}`;
}

// ---------------------------------------------------------------------------
// Input / plan types
// ---------------------------------------------------------------------------

/**
 * Lifecycle phase for one agent file-tool invocation.
 *
 * - `started` — path becomes the active work artifact
 * - `progress` — in-flight update (optional mid-tool ticks)
 * - `succeeded` — write/read finished; prefer `revision` on writes
 * - `failed` — structured failure for the pane banner
 */
export type AgentFileWorkPhase =
  | "started"
  | "progress"
  | "succeeded"
  | "failed";

export type BuildAgentFileWorkEmitInput = {
  thread_id: string;
  phase: AgentFileWorkPhase;
  /** Tool name (write_file, patch, read_file, …). */
  tool_name: string;
  /** Vault-root-relative absolute path (or project-relative; normalized). */
  vault_path: string;
  tool_call_id?: string | null;
  /** Multi-step operation id spanning open → updated. */
  operation_id?: string | null;
  title?: string | null;
  progress_label?: string | null;
  percent?: number | null;
  /** Override operation label; defaults to tool_name. */
  operation?: string | null;
  /**
   * Host revision after a successful write. Required to emit
   * `artifact.updated`; without it, success maps to open (refresh hint only).
   */
  revision?: ArtifactRevisionWire | null;
  write_kind?: ArtifactWriteKind | null;
  source_path?: string | null;
  additions?: number | null;
  deletions?: number | null;
  error_code?: ArtifactErrorCode | null;
  /** Safe UI text; sanitized. Never pass file bodies. */
  error_message?: string | null;
  timestamp?: string | null;
  producer?: ArtifactProducer;
  mime_type?: string | null;
  file_type?: string | null;
};

/** Structured tool_progress metadata (timeline rows; independent of pane). */
export type ToolProgressEmitMetadata = {
  portal_event: "tool_progress";
  tool_name: string;
  tool_status: "pending" | "running" | "complete" | "error";
  tool_target: string;
  tool_label: string;
  tool_call_id?: string;
  error_message?: string;
  additions?: number;
  deletions?: number;
};

/**
 * Emission plan for one lifecycle phase.
 * Hosts stamp each entry as a separate outbound `metadata` (or edit) frame.
 * Order within `artifact_events` is stable and intentional.
 */
export type AgentFileWorkEmitPlan = {
  /** Explicit artifact events (metadata-only; no file bytes). */
  artifact_events: ArtifactEventWire[];
  /**
   * Dual tool_progress row so ChatToolCalls keep working.
   * Emit as a separate outbound with portal_event tool_progress.
   */
  tool_progress: ToolProgressEmitMetadata | null;
  /** Why the planner produced this plan (for tests / host logs). */
  reason: string;
};

// ---------------------------------------------------------------------------
// Core planner
// ---------------------------------------------------------------------------

function isFileTool(name: string): boolean {
  return AGENT_FILE_TOOL_NAMES.has(name.trim().toLowerCase());
}

function isWriteTool(name: string): boolean {
  return AGENT_FILE_WRITE_TOOL_NAMES.has(name.trim().toLowerCase());
}

function toolStatusForPhase(
  phase: AgentFileWorkPhase,
): ToolProgressEmitMetadata["tool_status"] {
  switch (phase) {
    case "started":
      return "running";
    case "progress":
      return "running";
    case "succeeded":
      return "complete";
    case "failed":
      return "error";
  }
}

function baseFields(input: {
  threadId: string;
  vaultPath: string;
  title: string;
  fileType: string;
  mimeType?: string;
  producer: ArtifactProducer;
  timestamp: string;
  toolCallId?: string;
  operationId?: string;
  operation: string;
  artifactId: string;
}): Omit<
  ArtifactEventWire,
  "portal_event" | "status" | "error_code" | "error_message" | "revision"
> & { artifact_id: string } {
  const out = {
    thread_id: input.threadId,
    artifact_id: input.artifactId,
    vault_path: input.vaultPath,
    title: input.title,
    file_type: input.fileType,
    producer: input.producer,
    timestamp: input.timestamp,
    operation: input.operation,
  } as Omit<
    ArtifactEventWire,
    "portal_event" | "status" | "error_code" | "error_message" | "revision"
  > & { artifact_id: string };
  if (input.mimeType) {
    (out as { mime_type?: string }).mime_type = input.mimeType;
  }
  if (input.toolCallId) {
    (out as { tool_call_id?: string }).tool_call_id = input.toolCallId;
  }
  if (input.operationId) {
    (out as { operation_id?: string }).operation_id = input.operationId;
  }
  return out;
}

/**
 * Plan artifact (+ dual tool_progress) emissions for one agent file-tool phase.
 *
 * Returns null when the tool/path is not eligible (non-file tool, bad path).
 * Never includes file body content on any field.
 *
 * Mapping (acceptance lp-5q6.31):
 * - started (write) → artifact.open + artifact.progress; tool_progress running
 * - started (read)  → artifact.open; tool_progress running
 * - progress        → artifact.progress; tool_progress running
 * - succeeded + revision → artifact.updated (vault_path, revision, tool_call_id)
 * - succeeded without revision → artifact.open (refresh hint only)
 * - failed → artifact.error (sanitized message, no body)
 */
export function planAgentFileWorkEmit(
  input: BuildAgentFileWorkEmitInput,
): AgentFileWorkEmitPlan | null {
  const toolName = (input.tool_name ?? "").trim().toLowerCase();
  if (!toolName || !isFileTool(toolName)) return null;

  const threadId = (input.thread_id ?? "").trim();
  if (!threadId) return null;

  const vaultPath = resolveVaultPath(input.vault_path);
  if (!vaultPath) return null;

  const timestamp =
    (typeof input.timestamp === "string" && input.timestamp.trim()) ||
    new Date().toISOString();
  const producer = input.producer ?? "agent";
  const toolCallId =
    typeof input.tool_call_id === "string" && input.tool_call_id.trim()
      ? input.tool_call_id.trim()
      : undefined;
  const operationId =
    typeof input.operation_id === "string" && input.operation_id.trim()
      ? input.operation_id.trim()
      : undefined;
  const fileType =
    (typeof input.file_type === "string" && input.file_type.trim()) ||
    guessFileType(vaultPath);
  const mimeType =
    (typeof input.mime_type === "string" && input.mime_type.trim()) ||
    guessMimeType(fileType);
  const title =
    (typeof input.title === "string" && input.title.trim()) ||
    basenameTitle(vaultPath);
  const operation =
    (typeof input.operation === "string" && input.operation.trim()) ||
    toolName;
  const artifactId = artifactIdForTool(toolCallId, vaultPath, operationId);
  const writeTool = isWriteTool(toolName);

  const base = baseFields({
    threadId,
    vaultPath,
    title,
    fileType,
    mimeType,
    producer,
    timestamp,
    toolCallId,
    operationId,
    operation,
    artifactId,
  });

  const progressLabel =
    (typeof input.progress_label === "string" &&
      input.progress_label.trim()) ||
    undefined;
  const percent =
    typeof input.percent === "number" &&
    Number.isFinite(input.percent) &&
    input.percent >= 0 &&
    input.percent <= 100
      ? input.percent
      : undefined;

  const toolProgressBase = (): ToolProgressEmitMetadata => {
    const meta: ToolProgressEmitMetadata = {
      portal_event: "tool_progress",
      tool_name: toolName,
      tool_status: toolStatusForPhase(input.phase),
      tool_target: vaultPath,
      tool_label: progressLabel ?? title,
    };
    if (toolCallId) meta.tool_call_id = toolCallId;
    if (
      typeof input.additions === "number" &&
      Number.isFinite(input.additions) &&
      input.additions >= 0
    ) {
      meta.additions = Math.floor(input.additions);
    }
    if (
      typeof input.deletions === "number" &&
      Number.isFinite(input.deletions) &&
      input.deletions >= 0
    ) {
      meta.deletions = Math.floor(input.deletions);
    }
    return meta;
  };

  switch (input.phase) {
    case "started": {
      const events: ArtifactEventWire[] = [];
      const open: ArtifactOpenEventWire = {
        ...base,
        portal_event: "artifact.open",
        status: writeTool ? "opening" : "open",
        preferred_mode: "preview",
      };
      events.push(open);
      if (writeTool) {
        const progress: ArtifactProgressEventWire = {
          ...base,
          portal_event: "artifact.progress",
          status: "writing",
          progress_label: progressLabel ?? `Writing ${title}`,
          ...(percent !== undefined ? { percent } : {}),
        };
        events.push(progress);
      }
      return {
        artifact_events: events,
        tool_progress: toolProgressBase(),
        reason: writeTool
          ? "write tool started → open + progress"
          : "read tool started → open",
      };
    }
    case "progress": {
      const progress: ArtifactProgressEventWire = {
        ...base,
        portal_event: "artifact.progress",
        status: writeTool ? "writing" : "running",
        progress_label: progressLabel ?? title,
        ...(percent !== undefined ? { percent } : {}),
      };
      return {
        artifact_events: [progress],
        tool_progress: toolProgressBase(),
        reason: "mid-tool progress",
      };
    }
    case "succeeded": {
      const revision = input.revision ?? null;
      const writeKind = input.write_kind ?? undefined;
      const sourcePathRaw =
        typeof input.source_path === "string" ? input.source_path : null;
      const sourcePath = sourcePathRaw
        ? resolveVaultPath(sourcePathRaw) ?? undefined
        : undefined;

      if (writeTool && revision && revision.token && revision.kind) {
        const updated: ArtifactUpdatedEventWire = {
          ...base,
          portal_event: "artifact.updated",
          status: "ready",
          revision: {
            token: revision.token,
            kind: revision.kind,
            ...(typeof revision.size_bytes === "number"
              ? { size_bytes: revision.size_bytes }
              : {}),
            ...(revision.modified_at
              ? { modified_at: revision.modified_at }
              : {}),
          },
          ...(writeKind ? { write_kind: writeKind } : {}),
          ...(sourcePath ? { source_path: sourcePath } : {}),
          ...(typeof input.additions === "number" && input.additions >= 0
            ? { additions: Math.floor(input.additions) }
            : {}),
          ...(typeof input.deletions === "number" && input.deletions >= 0
            ? { deletions: Math.floor(input.deletions) }
            : {}),
        };
        return {
          artifact_events: [updated],
          tool_progress: toolProgressBase(),
          reason: "write succeeded with revision → updated",
        };
      }

      // No revision: refresh hint only (must not claim artifact.updated).
      const open: ArtifactOpenEventWire = {
        ...base,
        portal_event: "artifact.open",
        status: "open",
        progress_label: writeTool
          ? "updated (no host revision)"
          : progressLabel,
        preferred_mode: "preview",
        ...(typeof input.additions === "number" && input.additions >= 0
          ? { additions: Math.floor(input.additions) }
          : {}),
        ...(typeof input.deletions === "number" && input.deletions >= 0
          ? { deletions: Math.floor(input.deletions) }
          : {}),
      };
      return {
        artifact_events: [open],
        tool_progress: toolProgressBase(),
        reason: writeTool
          ? "write succeeded without revision → open refresh hint"
          : "read succeeded → open",
      };
    }
    case "failed": {
      const errorMessage = sanitizeArtifactErrorMessage(
        input.error_message,
        "Agent file work failed",
      );
      const errorCode = input.error_code ?? "upstream";
      const errorEvent: ArtifactEventWire = {
        ...base,
        portal_event: "artifact.error",
        status: "error",
        error_code: errorCode,
        error_message: errorMessage,
      };
      const tp = toolProgressBase();
      tp.error_message = errorMessage;
      return {
        artifact_events: [errorEvent],
        tool_progress: tp,
        reason: "tool failed → artifact.error (sanitized)",
      };
    }
  }
}

/**
 * Flatten a plan into ordered metadata objects for outbound frames.
 * tool_progress is emitted **before** artifact events so timeline rows
 * appear first; pane then follows (matches dual-bind UX).
 */
export function flattenEmitPlanMetadata(
  plan: AgentFileWorkEmitPlan,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  if (plan.tool_progress) {
    out.push({ ...plan.tool_progress });
  }
  for (const ev of plan.artifact_events) {
    out.push({ ...ev });
  }
  return out;
}

/**
 * Convenience: plan one phase and return flattened metadata list.
 * Returns [] when the tool/path is ineligible.
 */
export function emitMetadataForAgentFileWork(
  input: BuildAgentFileWorkEmitInput,
): Array<Record<string, unknown>> {
  const plan = planAgentFileWorkEmit(input);
  if (!plan) return [];
  return flattenEmitPlanMetadata(plan);
}
