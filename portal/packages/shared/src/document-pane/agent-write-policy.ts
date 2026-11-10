/**
 * Active human edit vs agent write policy (lp-5q6.32).
 *
 * Pure helpers for gateway/BFF/host: decide whether an agent tool may write the
 * canonical vault path, must write a checkpoint sibling, or must refuse.
 *
 * Policy: docs/architecture/portal-active-human-edit-agent-write-policy.md
 * Conflict checkpoint: docs/architecture/portal-document-shared-state-conflict-policy.md §3
 */

import { InvalidVaultPathError, normalizeVaultPath } from "../rbac/path-access.js";

// ---------------------------------------------------------------------------
// UX copy (normative)
// ---------------------------------------------------------------------------

/** Normative product strings for chat / pane / tool surfaces. */
export const AGENT_WRITE_UX_COPY = {
  /** Pane conflict when agent wrote a checkpoint while human dirty-edits. */
  paneCheckpointWhileDirty:
    "Agent wrote a checkpoint while you have an active edit. Open the checkpoint without discarding your buffer.",
  /** Soft offer when preview/clean and agent wrote a checkpoint. */
  paneSoftCheckpointOffer:
    "Agent saved a checkpoint. Open it without leaving your current document.",
  /** artifact.error / tool when refuse (no checkpoint written). */
  toolRefuseHumanEditActive:
    "Human edit session owns this path; agent write blocked",
  /** artifact.error when checkpoint was written instead of canonical. */
  toolCheckpointInsteadOfCanonical:
    "Human edit session owns this path; wrote checkpoint instead",
  /** Tool result summary template; replace {checkpoint_path}. */
  toolSuccessCheckpoint:
    "Saved agent checkpoint at {checkpoint_path} (canonical path has an active human edit).",
  /** Future promote confirm. */
  promoteCheckpointConfirm:
    "Replace the vault file with this checkpoint? Unsaved editor changes must be discarded or saved first.",
} as const;

// ---------------------------------------------------------------------------
// Ownership snapshot (input from BFF session store)
// ---------------------------------------------------------------------------

/**
 * Authoritative path ownership projection for agent write gating.
 * Produced by BFF `findActiveOwnership`; pure policy never reads the store.
 */
export type ActivePathOwnership = {
  /** Normalized vault path. */
  path: string;
  tenant_id: string;
  /** True when a blocking dirty edit session owns the path. */
  dirty: boolean;
  /** Session mode when a session exists. */
  mode: "view" | "edit" | null;
  /** Opaque Office session id (optional; never download tokens). */
  session_id?: string;
  /** Base revision token frozen at open (optional). */
  base_revision_token?: string;
  user_id?: string;
};

/** True when ownership blocks agent overwrite of the canonical path. */
export function isBlockingDirtyOwnership(
  ownership: ActivePathOwnership | null | undefined,
): boolean {
  if (!ownership) return false;
  return ownership.dirty === true && ownership.mode === "edit";
}

// ---------------------------------------------------------------------------
// Checkpoint path
// ---------------------------------------------------------------------------

const RUN_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export class AgentCheckpointPathError extends Error {
  readonly code:
    | "INVALID_PATH"
    | "INVALID_RUN_ID"
    | "EMPTY_BASENAME";

  constructor(code: AgentCheckpointPathError["code"], message: string) {
    super(message);
    this.name = "AgentCheckpointPathError";
    this.code = code;
  }
}

/**
 * Build deterministic agent checkpoint sibling path.
 *
 * `/Projects/Acme/proposal.docx` + `run1`
 *   → `/Projects/Acme/.lanyard/checkpoints/proposal.docx/run1.docx`
 *
 * Extension is preserved on the run file when the canonical basename has one.
 */
export function buildAgentCheckpointPath(
  canonicalPath: string,
  runId: string,
): string {
  let normalized: string;
  try {
    normalized = normalizeVaultPath(canonicalPath);
  } catch (err) {
    if (err instanceof InvalidVaultPathError) {
      throw new AgentCheckpointPathError(
        "INVALID_PATH",
        `Invalid canonical path for checkpoint: ${canonicalPath}`,
      );
    }
    throw err;
  }

  const id = runId?.trim() ?? "";
  if (!id || !RUN_ID_PATTERN.test(id)) {
    throw new AgentCheckpointPathError(
      "INVALID_RUN_ID",
      "run_id must match [A-Za-z0-9._-]+",
    );
  }

  if (normalized === "/") {
    throw new AgentCheckpointPathError(
      "EMPTY_BASENAME",
      "Cannot build checkpoint path for vault root",
    );
  }

  const segments = normalized.split("/").filter((s) => s.length > 0);
  const basename = segments[segments.length - 1]!;
  if (!basename) {
    throw new AgentCheckpointPathError(
      "EMPTY_BASENAME",
      "Cannot build checkpoint path without a file basename",
    );
  }

  const parentSegments = segments.slice(0, -1);
  const dot = basename.lastIndexOf(".");
  const ext = dot > 0 ? basename.slice(dot) : "";
  const runFile = `${id}${ext}`;

  const parts = [
    ...parentSegments,
    ".lanyard",
    "checkpoints",
    basename,
    runFile,
  ];
  return `/${parts.join("/")}`;
}

/** True when path sits under `.../.lanyard/checkpoints/...`. */
export function isAgentCheckpointPath(path: string): boolean {
  try {
    const n = normalizeVaultPath(path);
    return n.includes("/.lanyard/checkpoints/");
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Policy decision
// ---------------------------------------------------------------------------

export type AgentWriteCanonicalMode =
  | "create_new"
  | "replace_if_match"
  | "replace_if_absent";

export type AgentWriteIntent = {
  /** Path the skill wants to create/replace (logical / canonical). */
  intended_path: string;
  /**
   * Whether the intended path already exists on the host.
   * Used only when ownership is non-blocking.
   */
  path_exists?: boolean;
  /**
   * Required for write_checkpoint destination when dirty.
   * Tool/turn/idempotency fragment.
   */
  run_id?: string;
  /**
   * When dirty: default `checkpoint`. Set `refuse` when the tool cannot stage.
   */
  on_dirty?: "checkpoint" | "refuse";
  /**
   * Preferred write mode when allowing canonical replace of an existing file.
   * Default `replace_if_match`.
   */
  replace_mode?: "replace_if_match" | "replace_if_absent";
};

export type AgentWritePolicyDecision =
  | {
      action: "allow_canonical";
      mode: AgentWriteCanonicalMode;
      path: string;
      write_kind: "create" | "replace";
    }
  | {
      action: "write_checkpoint";
      mode: "write_checkpoint";
      /** Destination checkpoint path. */
      path: string;
      /** Canonical source path. */
      source_path: string;
      write_kind: "checkpoint";
      message: string;
      ownership_session_id?: string;
    }
  | {
      action: "refuse";
      error_code: "human_edit_active";
      path: string;
      message: string;
      ownership_session_id?: string;
      /** Host/Brain RPC conflict details projection. */
      conflict_details: {
        path: string;
        reason: "human_edit_active";
        session_id?: string;
      };
    };

/**
 * Resolve agent write behavior given BFF ownership and tool intent.
 *
 * Default: dirty edit → write_checkpoint; clean/none → allow CAS/create.
 */
export function resolveAgentWritePolicy(
  ownership: ActivePathOwnership | null | undefined,
  intent: AgentWriteIntent,
): AgentWritePolicyDecision {
  let intended: string;
  try {
    intended = normalizeVaultPath(intent.intended_path);
  } catch (err) {
    if (err instanceof InvalidVaultPathError) {
      // Treat invalid path as refuse with human_edit_active only if dirty;
      // otherwise still refuse via structured path — callers should validate first.
      // Prefer explicit invalid_path at tool boundary; here rethrow as policy refuse-like.
      throw new AgentCheckpointPathError(
        "INVALID_PATH",
        `Invalid intended_path: ${intent.intended_path}`,
      );
    }
    throw err;
  }

  if (isBlockingDirtyOwnership(ownership)) {
    const onDirty = intent.on_dirty ?? "checkpoint";
    const sessionId = ownership?.session_id;

    if (onDirty === "refuse") {
      return {
        action: "refuse",
        error_code: "human_edit_active",
        path: intended,
        message: AGENT_WRITE_UX_COPY.toolRefuseHumanEditActive,
        ownership_session_id: sessionId,
        conflict_details: {
          path: intended,
          reason: "human_edit_active",
          ...(sessionId ? { session_id: sessionId } : {}),
        },
      };
    }

    const runId = intent.run_id?.trim();
    if (!runId) {
      // Cannot build checkpoint without run_id → fail closed refuse.
      return {
        action: "refuse",
        error_code: "human_edit_active",
        path: intended,
        message: AGENT_WRITE_UX_COPY.toolRefuseHumanEditActive,
        ownership_session_id: sessionId,
        conflict_details: {
          path: intended,
          reason: "human_edit_active",
          ...(sessionId ? { session_id: sessionId } : {}),
        },
      };
    }

    const checkpointPath = buildAgentCheckpointPath(intended, runId);
    return {
      action: "write_checkpoint",
      mode: "write_checkpoint",
      path: checkpointPath,
      source_path: intended,
      write_kind: "checkpoint",
      message: AGENT_WRITE_UX_COPY.toolCheckpointInsteadOfCanonical,
      ownership_session_id: sessionId,
    };
  }

  // Non-blocking: allow canonical write.
  if (intent.path_exists === false) {
    return {
      action: "allow_canonical",
      mode: "create_new",
      path: intended,
      write_kind: "create",
    };
  }

  const replaceMode = intent.replace_mode ?? "replace_if_match";
  return {
    action: "allow_canonical",
    mode: replaceMode,
    path: intended,
    write_kind: "replace",
  };
}

/**
 * Format tool success summary for a checkpoint write.
 */
export function formatCheckpointSuccessMessage(checkpointPath: string): string {
  return AGENT_WRITE_UX_COPY.toolSuccessCheckpoint.replace(
    "{checkpoint_path}",
    checkpointPath,
  );
}
