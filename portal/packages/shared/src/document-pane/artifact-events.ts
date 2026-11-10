/**
 * Chat artifact event protocol (wire contract) for the Portal document pane.
 *
 * Bead: lp-5q6.10
 * Domain sketch: docs/architecture/portal-document-session-domain-model.md §2.3
 * Full protocol prose: docs/architecture/portal-chat-artifact-event-protocol.md
 *
 * Parse raw relay / chat metadata at the boundary; trust typed events inside
 * web code. ChatEvent orchestration, relative project path resolution, and
 * history hydrate live in `artifact-normalize.ts` (lp-5q6.11).
 */

// ---------------------------------------------------------------------------
// Constants and closed enums
// ---------------------------------------------------------------------------

/** Discriminated wire kinds (metadata.portal_event). */
export const ARTIFACT_EVENT_KINDS = [
  "artifact.open",
  "artifact.progress",
  "artifact.updated",
  "artifact.error",
  "artifact.close",
] as const;

export type ArtifactEventKind = (typeof ARTIFACT_EVENT_KINDS)[number];

export const ARTIFACT_PRODUCERS = [
  "agent",
  "user",
  "system",
  "gateway",
  "bff",
] as const;

export type ArtifactProducer = (typeof ARTIFACT_PRODUCERS)[number];

/**
 * Lifecycle status on the wire. Variant-specific subsets are enforced by the
 * parser (see VARIANT_STATUS).
 */
export const ARTIFACT_WIRE_STATUSES = [
  "pending",
  "opening",
  "open",
  "running",
  "writing",
  "ready",
  "error",
  "closed",
] as const;

export type ArtifactWireStatus = (typeof ARTIFACT_WIRE_STATUSES)[number];

export const ARTIFACT_PREVIEW_MODES = [
  "auto",
  "markdown",
  "pdf",
  "image",
  "office",
  "text",
  "binary",
  "none",
] as const;

export type ArtifactPreviewMode = (typeof ARTIFACT_PREVIEW_MODES)[number];

export const ARTIFACT_WRITE_KINDS = [
  "canonical",
  "checkpoint",
  "conflict_copy",
] as const;

export type ArtifactWriteKind = (typeof ARTIFACT_WRITE_KINDS)[number];

export const ARTIFACT_REVISION_KINDS = [
  "etag",
  "content_hash",
  "host_revision",
  "mtime_size_fallback",
] as const;

export type ArtifactRevisionKind = (typeof ARTIFACT_REVISION_KINDS)[number];

export const ARTIFACT_ERROR_CODES = [
  "not_found",
  "forbidden",
  "payload_too_large",
  "unsupported_type",
  "revision_mismatch",
  "human_edit_active",
  "session_expired",
  "upstream",
  "unknown",
] as const;

export type ArtifactErrorCode = (typeof ARTIFACT_ERROR_CODES)[number];

export const ARTIFACT_CLOSE_REASONS = [
  "user",
  "thread_change",
  "superseded",
  "error",
] as const;

export type ArtifactCloseReason = (typeof ARTIFACT_CLOSE_REASONS)[number];

const VARIANT_STATUS: Record<ArtifactEventKind, readonly ArtifactWireStatus[]> =
  {
    "artifact.open": ["pending", "opening", "open"],
    "artifact.progress": ["pending", "running", "writing"],
    "artifact.updated": ["ready", "writing"],
    "artifact.error": ["error"],
    "artifact.close": ["closed"],
  };

// ---------------------------------------------------------------------------
// Wire types (snake_case — relay metadata / durable history)
// ---------------------------------------------------------------------------

/**
 * Host revision token as carried on artifact events.
 * Aligns with domain DocumentRevision (lp-5q6.6).
 */
export type ArtifactRevisionWire = {
  token: string;
  kind: ArtifactRevisionKind;
  size_bytes?: number;
  modified_at?: string;
};

/**
 * Required fields shared by every explicit artifact event variant.
 *
 * - `mime_type` **or** `file_type` (at least one) identifies content family
 *   (markdown, PDF, image, Office, …) without requiring ONLYOFFICE.
 * - `revision` is required on `artifact.updated`; optional on others when known.
 */
export type ArtifactEventWireBase = {
  portal_event: ArtifactEventKind;
  thread_id: string;
  artifact_id: string;
  vault_path: string;
  title: string;
  mime_type?: string;
  file_type?: string;
  revision?: ArtifactRevisionWire;
  producer: ArtifactProducer;
  status: ArtifactWireStatus;
  /** ISO-8601 timestamp for ordering and history replay. */
  timestamp: string;

  // Optional shared fields (acceptance + domain)
  progress_label?: string;
  /** 0–100; omit when indeterminate. */
  percent?: number;
  /** High-level operation name, e.g. "writing", "formatting", "uploading". */
  operation?: string;
  additions?: number;
  deletions?: number;
  preview_mode?: ArtifactPreviewMode;
  tool_call_id?: string;
  /** Correlate multi-step agent work across open/progress/updated/close. */
  operation_id?: string;
  write_kind?: ArtifactWriteKind;
  /** When write_kind is checkpoint/conflict_copy, optional canonical path. */
  source_path?: string;
  error_code?: ArtifactErrorCode;
  /** Safe UI/log message; never file bodies or secrets. */
  error_message?: string;
  preferred_mode?: "preview" | "edit";
  close_reason?: ArtifactCloseReason;
};

export type ArtifactOpenEventWire = ArtifactEventWireBase & {
  portal_event: "artifact.open";
  status: "pending" | "opening" | "open";
};

export type ArtifactProgressEventWire = ArtifactEventWireBase & {
  portal_event: "artifact.progress";
  status: "pending" | "running" | "writing";
};

export type ArtifactUpdatedEventWire = ArtifactEventWireBase & {
  portal_event: "artifact.updated";
  status: "ready" | "writing";
  /** Bytes identity after a successful write / checkpoint. */
  revision: ArtifactRevisionWire;
};

export type ArtifactErrorEventWire = ArtifactEventWireBase & {
  portal_event: "artifact.error";
  status: "error";
  error_code: ArtifactErrorCode;
  error_message: string;
};

export type ArtifactCloseEventWire = ArtifactEventWireBase & {
  portal_event: "artifact.close";
  status: "closed";
};

/**
 * Discriminated union of explicit artifact events on the wire.
 * Prefer this over scraping tool chrome for pane open/progress/refresh.
 */
export type ArtifactEventWire =
  | ArtifactOpenEventWire
  | ArtifactProgressEventWire
  | ArtifactUpdatedEventWire
  | ArtifactErrorEventWire
  | ArtifactCloseEventWire;

// ---------------------------------------------------------------------------
// Guards and helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/** True when portal_event is an explicit artifact.* variant. */
export function isArtifactEventKind(
  value: unknown,
): value is ArtifactEventKind {
  return isOneOf(value, ARTIFACT_EVENT_KINDS);
}

/**
 * Normalize vault path for identity: leading `/`, collapse duplicate slashes,
 * reject `..` segments. Returns null when the path is unusable.
 */
/**
 * Extract a filesystem/vault path from file:// or other scheme URLs without
 * relying on the DOM `URL` global (shared package lib is ES2022 only).
 */
function pathFromMaybeUrl(raw: string): string | null {
  const fileMatch = raw.match(/^file:\/\/(.*)$/i);
  if (fileMatch) {
    const rest = fileMatch[1] ?? "";
    // file:///abs → /abs; file://localhost/abs → /abs
    if (rest.startsWith("/")) {
      try {
        return decodeURIComponent(rest);
      } catch {
        return rest;
      }
    }
    const slash = rest.indexOf("/");
    if (slash < 0) return null;
    const pathname = rest.slice(slash);
    try {
      return decodeURIComponent(pathname);
    } catch {
      return pathname;
    }
  }
  const schemeMatch = raw.match(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*(\/[^?#]*)?/i);
  if (schemeMatch) {
    const pathname = schemeMatch[1];
    if (!pathname) return null;
    try {
      return decodeURIComponent(pathname);
    } catch {
      return pathname;
    }
  }
  return raw;
}

export function normalizeArtifactVaultPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const fromUrl = pathFromMaybeUrl(trimmed);
  if (fromUrl === null) return null;
  let path = fromUrl;
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/{2,}/g, "/");
  const segments = path.split("/").filter((s) => s.length > 0);
  if (segments.some((s) => s === ".." || s === ".")) return null;
  return path === "" ? "/" : path;
}

function parseRevision(raw: unknown): ArtifactRevisionWire | null {
  if (!isRecord(raw)) return null;
  const token = asNonEmptyString(raw.token);
  if (!token) return null;
  if (!isOneOf(raw.kind, ARTIFACT_REVISION_KINDS)) return null;
  const revision: ArtifactRevisionWire = {
    token,
    kind: raw.kind,
  };
  if (typeof raw.size_bytes === "number" && Number.isFinite(raw.size_bytes)) {
    revision.size_bytes = raw.size_bytes;
  }
  const modifiedAt = asNonEmptyString(raw.modified_at);
  if (modifiedAt) revision.modified_at = modifiedAt;
  return revision;
}

function parseOptionalPercent(raw: unknown): number | undefined | "invalid" {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return "invalid";
  if (raw < 0 || raw > 100) return "invalid";
  return raw;
}

function parseOptionalNonNegInt(
  raw: unknown,
): number | undefined | "invalid" {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    return "invalid";
  }
  return Math.floor(raw);
}

/**
 * Options when the outer frame already carries thread identity
 * (OutboundAction.chat_id / ChatEvent.chat_id).
 */
export type ParseArtifactEventOptions = {
  /** Fallback when metadata.thread_id is absent. */
  thread_id?: string;
};

/**
 * Parse raw metadata into a typed artifact event.
 *
 * Returns null for non-artifact portal_event values and for malformed
 * artifact.* payloads (fail soft — do not crash the chat stream).
 *
 * Accepts either:
 * - a metadata object (`{ portal_event: "artifact.open", … }`)
 * - a full outbound-like envelope with `.metadata` and optional `.chat_id`
 */
export function parseArtifactEventMetadata(
  raw: unknown,
  options: ParseArtifactEventOptions = {},
): ArtifactEventWire | null {
  let metadata: Record<string, unknown>;
  let envelopeThreadId: string | undefined;

  if (!isRecord(raw)) return null;

  if (isRecord(raw.metadata)) {
    metadata = raw.metadata;
    const chatId = asNonEmptyString(raw.chat_id);
    if (chatId) envelopeThreadId = chatId;
  } else {
    metadata = raw;
  }

  const kindRaw = metadata.portal_event;
  if (!isArtifactEventKind(kindRaw)) return null;

  const threadId =
    asNonEmptyString(metadata.thread_id) ??
    asNonEmptyString(options.thread_id) ??
    envelopeThreadId;
  if (!threadId) return null;

  const artifactId = asNonEmptyString(metadata.artifact_id);
  if (!artifactId) return null;

  const vaultPathRaw = asNonEmptyString(metadata.vault_path);
  if (!vaultPathRaw) return null;
  const vaultPath = normalizeArtifactVaultPath(vaultPathRaw);
  if (!vaultPath) return null;

  const title = asNonEmptyString(metadata.title);
  if (!title) return null;

  const mimeType = asNonEmptyString(metadata.mime_type) ?? undefined;
  const fileType = asNonEmptyString(metadata.file_type) ?? undefined;
  if (!mimeType && !fileType) return null;

  if (!isOneOf(metadata.producer, ARTIFACT_PRODUCERS)) return null;
  const producer = metadata.producer;

  if (!isOneOf(metadata.status, ARTIFACT_WIRE_STATUSES)) return null;
  const status = metadata.status;
  if (!VARIANT_STATUS[kindRaw].includes(status)) return null;

  const timestamp = asNonEmptyString(metadata.timestamp);
  if (!timestamp) return null;

  let revision: ArtifactRevisionWire | undefined;
  if (metadata.revision !== undefined && metadata.revision !== null) {
    const parsed = parseRevision(metadata.revision);
    if (!parsed) return null;
    revision = parsed;
  }

  // revision required on updated
  if (kindRaw === "artifact.updated" && !revision) return null;

  const percent = parseOptionalPercent(metadata.percent);
  if (percent === "invalid") return null;

  const additions = parseOptionalNonNegInt(metadata.additions);
  if (additions === "invalid") return null;
  const deletions = parseOptionalNonNegInt(metadata.deletions);
  if (deletions === "invalid") return null;

  if (
    metadata.preview_mode !== undefined &&
    metadata.preview_mode !== null &&
    !isOneOf(metadata.preview_mode, ARTIFACT_PREVIEW_MODES)
  ) {
    return null;
  }

  if (
    metadata.write_kind !== undefined &&
    metadata.write_kind !== null &&
    !isOneOf(metadata.write_kind, ARTIFACT_WRITE_KINDS)
  ) {
    return null;
  }

  if (
    metadata.error_code !== undefined &&
    metadata.error_code !== null &&
    !isOneOf(metadata.error_code, ARTIFACT_ERROR_CODES)
  ) {
    return null;
  }

  if (
    metadata.close_reason !== undefined &&
    metadata.close_reason !== null &&
    !isOneOf(metadata.close_reason, ARTIFACT_CLOSE_REASONS)
  ) {
    return null;
  }

  if (
    metadata.preferred_mode !== undefined &&
    metadata.preferred_mode !== null &&
    metadata.preferred_mode !== "preview" &&
    metadata.preferred_mode !== "edit"
  ) {
    return null;
  }

  const base: ArtifactEventWireBase = {
    portal_event: kindRaw,
    thread_id: threadId,
    artifact_id: artifactId,
    vault_path: vaultPath,
    title,
    producer,
    status,
    timestamp,
  };
  if (mimeType) base.mime_type = mimeType;
  if (fileType) base.file_type = fileType;
  if (revision) base.revision = revision;

  const progressLabel = asNonEmptyString(metadata.progress_label);
  if (progressLabel) base.progress_label = progressLabel;
  if (percent !== undefined) base.percent = percent;
  const operation = asNonEmptyString(metadata.operation);
  if (operation) base.operation = operation;
  if (additions !== undefined) base.additions = additions;
  if (deletions !== undefined) base.deletions = deletions;
  if (isOneOf(metadata.preview_mode, ARTIFACT_PREVIEW_MODES)) {
    base.preview_mode = metadata.preview_mode;
  }
  const toolCallId = asNonEmptyString(metadata.tool_call_id);
  if (toolCallId) base.tool_call_id = toolCallId;
  const operationId = asNonEmptyString(metadata.operation_id);
  if (operationId) base.operation_id = operationId;
  if (isOneOf(metadata.write_kind, ARTIFACT_WRITE_KINDS)) {
    base.write_kind = metadata.write_kind;
  }
  const sourcePathRaw = asNonEmptyString(metadata.source_path);
  if (sourcePathRaw) {
    const sourcePath = normalizeArtifactVaultPath(sourcePathRaw);
    if (!sourcePath) return null;
    base.source_path = sourcePath;
  }
  if (isOneOf(metadata.error_code, ARTIFACT_ERROR_CODES)) {
    base.error_code = metadata.error_code;
  }
  const errorMessage = asNonEmptyString(metadata.error_message);
  if (errorMessage) base.error_message = errorMessage;
  if (
    metadata.preferred_mode === "preview" ||
    metadata.preferred_mode === "edit"
  ) {
    base.preferred_mode = metadata.preferred_mode;
  }
  if (isOneOf(metadata.close_reason, ARTIFACT_CLOSE_REASONS)) {
    base.close_reason = metadata.close_reason;
  }

  // Variant-specific required extras
  if (kindRaw === "artifact.error") {
    if (!base.error_code || !base.error_message) return null;
    return base as ArtifactErrorEventWire;
  }
  if (kindRaw === "artifact.updated") {
    return base as ArtifactUpdatedEventWire;
  }
  if (kindRaw === "artifact.open") {
    return base as ArtifactOpenEventWire;
  }
  if (kindRaw === "artifact.progress") {
    return base as ArtifactProgressEventWire;
  }
  return base as ArtifactCloseEventWire;
}

// ---------------------------------------------------------------------------
// Legacy promotion (tool_progress / citations → artifact events)
// ---------------------------------------------------------------------------

/**
 * File-like tool names that may imply vault document work.
 * Includes gateway names (`read_file`) and harness aliases (`read`,
 * `write`, `open`, `patch`) so tool-only citations open the pane.
 * Keep in lockstep with AGENT_FILE_TOOL_NAMES in artifact-emit.ts.
 */
export const ARTIFACT_FILE_TOOL_NAMES = new Set([
  "read_file",
  "write_file",
  "edit",
  "edit_file",
  "create_file",
  "apply_patch",
  "patch",
  "search_replace",
  "vault_read",
  "vault_write",
  "vault.read",
  "vault.write",
  "read",
  "write",
  "open",
]);

/**
 * Heuristic: tool_target looks like a vault path (not a bare shell command).
 * Conservative — rejects paths with `..` and non-path-looking strings.
 */
export function looksLikeVaultPath(target: string): boolean {
  const t = target.trim();
  if (!t || t.length > 1024) return false;
  if (t.includes("\n") || t.includes("\0")) return false;
  // Shell-ish commands
  if (/\s/.test(t) && !t.startsWith("/")) return false;
  if (/[|&;<>$`]/.test(t)) return false;
  const normalized = normalizeArtifactVaultPath(
    t.startsWith("/") || t.startsWith("./") || t.includes("/") ? t : `/${t}`,
  );
  if (!normalized || normalized === "/") return false;
  // Prefer paths with an extension or under a known vault root segment
  const base = normalized.split("/").pop() ?? "";
  if (base.includes(".")) return true;
  return (
    normalized.startsWith("/Projects/") ||
    normalized.startsWith("/projects/") ||
    normalized.startsWith("/vault/") ||
    normalized.startsWith("/.lanyard/")
  );
}

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

export type PromoteToolProgressInput = {
  thread_id: string;
  tool_name?: string | null;
  tool_status?: string | null;
  tool_target?: string | null;
  tool_call_id?: string | null;
  tool_label?: string | null;
  additions?: number | null;
  deletions?: number | null;
  error_message?: string | null;
  /** ISO timestamp; defaults to now if omitted. */
  timestamp?: string | null;
  producer?: ArtifactProducer;
};

/**
 * Promote structured `tool_progress` metadata into an artifact event when the
 * tool clearly targets a vault file. Returns null when promotion is unsafe
 * (unknown tool, non-path target, missing ids).
 *
 * Mapping:
 * - running / pending → artifact.progress
 * - complete → artifact.updated **only when** a revision is not required
 *   for CAS; without revision we emit artifact.progress status writing→ready
 *   is **not** used — complete without revision maps to artifact.progress
 *   with status running and progress_label "complete" is wrong.
 *   Instead: complete → artifact.open (refresh hint) so pane can reload
 *   without claiming a known revision. Prefer host emit of artifact.updated
 *   with revision when available (lp-5q6.31).
 * - error → artifact.error
 *
 * tool_progress alone is never vault write authority (domain model §1.2).
 */
export function promoteToolProgressToArtifactEvent(
  input: PromoteToolProgressInput,
): ArtifactEventWire | null {
  const threadId = asNonEmptyString(input.thread_id);
  if (!threadId) return null;

  const toolName = (input.tool_name ?? "").trim().toLowerCase();
  if (!toolName || !ARTIFACT_FILE_TOOL_NAMES.has(toolName)) return null;

  const target = asNonEmptyString(input.tool_target);
  if (!target || !looksLikeVaultPath(target)) return null;
  const vaultPath = normalizeArtifactVaultPath(
    target.startsWith("/") ? target : `/${target}`,
  );
  if (!vaultPath) return null;

  const toolStatusRaw = (input.tool_status ?? "running").trim().toLowerCase();
  // Relay/harness SSE uses "completed"; gateway emit uses "complete".
  const toolStatus = toolStatusRaw === "completed" ? "complete" : toolStatusRaw;
  const timestamp =
    asNonEmptyString(input.timestamp) ?? new Date().toISOString();
  const producer = input.producer ?? "agent";
  const toolCallId = asNonEmptyString(input.tool_call_id) ?? undefined;
  const artifactId =
    toolCallId !== undefined
      ? `tool:${toolCallId}`
      : `path:${vaultPath}`;
  const fileType = guessFileType(vaultPath);
  const mimeType = guessMimeType(fileType);
  const title =
    asNonEmptyString(input.tool_label) ?? basenameTitle(vaultPath);

  const baseFields = {
    thread_id: threadId,
    artifact_id: artifactId,
    vault_path: vaultPath,
    title,
    file_type: fileType,
    ...(mimeType ? { mime_type: mimeType } : {}),
    producer,
    timestamp,
    tool_call_id: toolCallId,
    operation: toolName,
  };

  if (toolStatus === "error") {
    return {
      ...baseFields,
      portal_event: "artifact.error",
      status: "error",
      error_code: "upstream",
      error_message:
        asNonEmptyString(input.error_message) ?? "Tool failed on vault path",
    };
  }

  if (toolStatus === "complete") {
    // Without a host revision we must not claim artifact.updated.
    // Emit open so the pane can re-fetch content (best-effort legacy bridge).
    return {
      ...baseFields,
      portal_event: "artifact.open",
      status: "open",
      progress_label: "updated (legacy tool_progress)",
      ...(typeof input.additions === "number" && input.additions >= 0
        ? { additions: Math.floor(input.additions) }
        : {}),
      ...(typeof input.deletions === "number" && input.deletions >= 0
        ? { deletions: Math.floor(input.deletions) }
        : {}),
    };
  }

  // pending | running | unknown → progress
  return {
    ...baseFields,
    portal_event: "artifact.progress",
    status: toolStatus === "pending" ? "pending" : "running",
    progress_label: title,
  };
}

export type PromoteCitationInput = {
  thread_id: string;
  path: string;
  title?: string | null;
  /** ISO timestamp; defaults to now if omitted. */
  timestamp?: string | null;
  producer?: ArtifactProducer;
  tool_call_id?: string | null;
  mime_type?: string | null;
  file_type?: string | null;
};

/**
 * Promote a vault citation (metadata.citations entry or portal_event citation)
 * into artifact.open for pane hydration / click handling.
 */
export function promoteCitationToArtifactOpen(
  input: PromoteCitationInput,
): ArtifactOpenEventWire | null {
  const threadId = asNonEmptyString(input.thread_id);
  if (!threadId) return null;
  const pathRaw = asNonEmptyString(input.path);
  if (!pathRaw) return null;
  const vaultPath = normalizeArtifactVaultPath(
    pathRaw.startsWith("/") ? pathRaw : `/${pathRaw}`,
  );
  if (!vaultPath) return null;

  const fileType =
    asNonEmptyString(input.file_type) ?? guessFileType(vaultPath);
  const mimeType =
    asNonEmptyString(input.mime_type) ?? guessMimeType(fileType);
  if (!mimeType && !fileType) return null;

  const title = asNonEmptyString(input.title) ?? basenameTitle(vaultPath);
  const timestamp =
    asNonEmptyString(input.timestamp) ?? new Date().toISOString();
  const toolCallId = asNonEmptyString(input.tool_call_id) ?? undefined;

  const event: ArtifactOpenEventWire = {
    portal_event: "artifact.open",
    thread_id: threadId,
    artifact_id: `citation:${vaultPath}`,
    vault_path: vaultPath,
    title,
    file_type: fileType,
    producer: input.producer ?? "agent",
    status: "open",
    timestamp,
    preferred_mode: "preview",
  };
  if (mimeType) event.mime_type = mimeType;
  if (toolCallId) event.tool_call_id = toolCallId;
  return event;
}
