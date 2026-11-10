/**
 * Chat document pane domain types and reducer action union.
 *
 * Bead: lp-5q6.12
 * Domain: docs/architecture/portal-document-session-domain-model.md §2.1–§2.4, §2.7
 *
 * Browser-local UI state only — not ACL, CAS, or agent overwrite authority.
 */

// ---------------------------------------------------------------------------
// Shared identity types (camelCase in Portal TS)
// ---------------------------------------------------------------------------

/** Vault-root-relative path; absolute form "/…", no ".." segments. */
export type VaultPath = string;

/**
 * Reference used by pane, artifact events, and later session create.
 * ACL is NOT carried here — always re-checked server-side.
 */
export type VaultArtifactRef = {
  /** Normalized vault path (see pathResolution + vaultPaths helpers). */
  path: VaultPath;
  /** Optional display title (citation title, tool label). */
  title?: string;
  /**
   * Optional stable content id if host exposes one later.
   * Prefer path + revision for Office keys until host content-id exists.
   */
  contentId?: string;
  /**
   * Provenance of the open request (UI / analytics only).
   * Not used for ACL or document.key.
   */
  source?:
    | "citation"
    | "tool_target"
    | "agent_checkpoint"
    | "vault_browser"
    | "user_reload"
    | "deep_link"
    | "artifact_event"
    /** Timeline reopen chip after pane close (lp-a8u.2). */
    | "reopen_chip";
};

/**
 * Host-owned identity of specific bytes at a path.
 * Aligns with domain DocumentRevision and shared ArtifactRevisionWire.
 */
export type DocumentRevision = {
  token: string;
  kind: "etag" | "content_hash" | "host_revision" | "mtime_size_fallback";
  sizeBytes?: number;
  modifiedAt?: string;
};

export type PanelMode = "preview" | "edit";

export type ArtifactPanelStatus =
  | "closed"
  | "opening"
  | "previewing"
  | "editing"
  | "progress"
  | "conflict"
  | "error";

export type ConflictReason =
  | "revision_mismatch"
  | "human_edit_active"
  | "superseded_base"
  | "concurrent_session"
  | "path_retarget_denied";

export type ConflictOfferedAction =
  | "reload"
  | "save_as_conflict_copy"
  | "open_checkpoint"
  | "discard_local"
  | "retry_save";

/** Structured conflict for pane banner — not a free-form string. */
export type ConflictState = {
  reason: ConflictReason;
  path: VaultPath;
  expectedRevision?: DocumentRevision;
  actualRevision?: DocumentRevision;
  alternateRef?: VaultArtifactRef;
  message: string;
  offeredActions: ConflictOfferedAction[];
};

export type ArtifactErrorCode =
  | "not_found"
  | "forbidden"
  | "payload_too_large"
  | "unsupported_type"
  | "revision_mismatch"
  | "human_edit_active"
  | "session_expired"
  | "upstream"
  | "unknown"
  | "invalid_path";

/** Last error for status === "error". */
export type ArtifactPanelError = {
  code: ArtifactErrorCode;
  message: string;
  retryable?: boolean;
  ref?: VaultArtifactRef;
  operationId?: string;
};

export type ArtifactPanelProgress = {
  operationId?: string;
  percent?: number;
  message?: string;
  phase?: string;
};

/**
 * Non-blocking agent checkpoint sibling offered while the pane stays on
 * the canonical (or current) document. Conflict with `open_checkpoint` still
 * covers the dirty human-edit case (lp-5q6.16).
 */
export type CheckpointOffer = {
  ref: VaultArtifactRef;
  revision: DocumentRevision;
  sourcePath?: VaultPath;
  message: string;
};

/**
 * Single source of truth for the chat-side document pane.
 * Prefer this reducer over flags in ChatView / VaultReader.
 */
export type ArtifactPanelState = {
  status: ArtifactPanelStatus;

  /** Current document, if any. */
  ref: VaultArtifactRef | null;

  /** Last known host revision for the open ref (preview or edit base). */
  knownRevision: DocumentRevision | null;

  mode: PanelMode;

  /**
   * Opaque Office session id when status is editing (or conflict mid-edit).
   * Web never reconstructs path authority from this alone for writeback.
   */
  officeSessionId: string | null;

  /** In-flight agent operation label / percent for header strip. */
  progress: ArtifactPanelProgress | null;

  /** Structured conflict when human and external writers diverge. */
  conflict: ConflictState | null;

  /**
   * Soft offer to open an agent checkpoint path without replacing the
   * current buffer (idle preview of a different path).
   */
  checkpointOffer: CheckpointOffer | null;

  /** Last error for status === "error". */
  error: ArtifactPanelError | null;

  /**
   * Local dirty hint from editor host (UX only).
   * Server dirty ownership lives on OfficeDocumentSession.
   */
  localDirty: boolean;

  /** Monotonic open generation so re-click same path re-runs effects. */
  openGeneration: number;
};

// ---------------------------------------------------------------------------
// Domain artifact events (reducer input; wire mapping is separate / lp-5q6.11)
// ---------------------------------------------------------------------------

export type ArtifactOpenEvent = {
  type: "open";
  ref: VaultArtifactRef;
  preferredMode?: PanelMode;
  revision?: DocumentRevision;
  reason?: VaultArtifactRef["source"];
  operationId?: string;
};

export type ArtifactProgressEvent = {
  type: "progress";
  ref?: VaultArtifactRef;
  percent?: number;
  message?: string;
  phase?: string;
  operationId?: string;
};

export type ArtifactUpdatedEvent = {
  type: "updated";
  ref: VaultArtifactRef;
  revision: DocumentRevision;
  writeKind?: "canonical" | "checkpoint" | "conflict_copy";
  sourcePath?: VaultPath;
  operationId?: string;
};

export type ArtifactErrorEvent = {
  type: "error";
  ref?: VaultArtifactRef;
  code: ArtifactErrorCode;
  message: string;
  retryable?: boolean;
  operationId?: string;
};

export type ArtifactCloseEvent = {
  type: "close";
  ref?: VaultArtifactRef;
  reason?: "user" | "thread_change" | "superseded" | "error";
  operationId?: string;
};

export type ArtifactEvent =
  | ArtifactOpenEvent
  | ArtifactProgressEvent
  | ArtifactUpdatedEvent
  | ArtifactErrorEvent
  | ArtifactCloseEvent;

// ---------------------------------------------------------------------------
// Closed action union (do not set status from arbitrary component effects)
// ---------------------------------------------------------------------------

export type ArtifactPanelAction =
  /** User / citation / shell requests open; path must already be resolved. */
  | {
      type: "PANEL_OPEN";
      ref: VaultArtifactRef;
      revision?: DocumentRevision;
      mode?: PanelMode;
    }
  /** Preview host finished loading content for the current openGeneration. */
  | {
      type: "PANEL_PREVIEW_READY";
      openGeneration: number;
      revision?: DocumentRevision;
    }
  /** Preview host failed for the current openGeneration. */
  | {
      type: "PANEL_PREVIEW_ERROR";
      openGeneration: number;
      error: ArtifactPanelError;
    }
  /** Typed artifact event from chat stream / fixtures. */
  | { type: "PANEL_EVENT"; event: ArtifactEvent }
  /** Editor host reports local dirty (UX only). */
  | { type: "PANEL_SET_DIRTY"; dirty: boolean }
  /** BFF created an Office session; bind opaque id (edit path). */
  | { type: "PANEL_SESSION_BOUND"; sessionId: string }
  /** User chose Edit from preview (session create is async after this). */
  | { type: "PANEL_REQUEST_EDIT" }
  /**
   * User left edit mode for view-only preview (lp-5q6.30).
   * Clears Office session id and local dirty; keeps the open ref.
   */
  | { type: "PANEL_EXIT_EDIT" }
  /** Save succeeded; advance known revision. */
  | {
      type: "PANEL_SAVE_SUCCESS";
      revision: DocumentRevision;
      /** When true, remain in editing; otherwise return to previewing. */
      stayEditing?: boolean;
    }
  /** Save CAS fail or external supersede while editing. */
  | { type: "PANEL_CONFLICT"; conflict: ConflictState }
  /**
   * Reload the current ref (conflict "reload", user refresh, retry after error).
   * Bumps openGeneration so preview effects re-run. No-op when closed / no ref.
   */
  | {
      type: "PANEL_RELOAD";
      /** When true, clear localDirty / conflict and re-open as preview. */
      discardLocal?: boolean;
      revision?: DocumentRevision;
    }
  /**
   * Open the agent checkpoint path from conflict.alternateRef or checkpointOffer
   * (lp-5q6.16). Bumps openGeneration and clears the offer/conflict.
   */
  | { type: "PANEL_OPEN_CHECKPOINT" }
  /** Dismiss soft checkpoint offer without changing the open document. */
  | { type: "PANEL_DISMISS_CHECKPOINT" }
  /** Close pane (user, thread change, etc.). */
  | {
      type: "PANEL_CLOSE";
      reason?: "user" | "thread_change" | "superseded" | "error";
    };
