/**
 * Web-side document key / revision invalidation policy (lp-5q6.24).
 *
 * Pure helpers for pane reload vs conflict when host revision advances.
 * BFF owns document.key mint; web never invents keys or path authority.
 *
 * Policy: docs/architecture/portal-document-key-invalidation.md
 */

import type {
  ConflictState,
  DocumentRevision,
  VaultPath,
} from "./types.js";

/** Decision when comparing base vs current content revision. */
export type DocumentKeyInvalidationAction = "none" | "reload" | "conflict";

export type DocumentKeyInvalidationDecision =
  | {
      action: "none";
      autoRefresh: false;
      revisionsMatch: true;
    }
  | {
      action: "reload";
      autoRefresh: true;
      revisionsMatch: false;
      reason: "external_revision_advance";
    }
  | {
      action: "conflict";
      autoRefresh: false;
      revisionsMatch: false;
      reason: "superseded_base";
      conflict: ConflictState;
    };

export type EvaluateDocumentKeyInvalidationInput = {
  /** Revision frozen at open / last clean save (pane knownRevision). */
  baseRevisionToken: string | null | undefined;
  /** Latest host revision token for the path. */
  currentRevisionToken: string | null | undefined;
  /**
   * Human dirty buffer or active edit session.
   * When true, never auto-refresh / auto-swap Office key material.
   */
  dirty: boolean;
  /** Path for conflict banner (canonical open path). */
  path: VaultPath;
  /** Optional structured revisions for ConflictState. */
  baseRevision?: DocumentRevision | null;
  currentRevision?: DocumentRevision | null;
};

const SUPERSEDED_BANNER_MESSAGE =
  "Document changed while you were editing. Reload or save a conflict copy.";

/**
 * Build structured conflict for external revision advance under dirty edit.
 */
export function buildSupersededBaseConflict(input: {
  path: VaultPath;
  expectedRevision?: DocumentRevision | null;
  actualRevision?: DocumentRevision | null;
  message?: string;
}): ConflictState {
  return {
    reason: "superseded_base",
    path: input.path,
    expectedRevision: input.expectedRevision ?? undefined,
    actualRevision: input.actualRevision ?? undefined,
    message: input.message ?? SUPERSEDED_BANNER_MESSAGE,
    offeredActions: ["reload", "save_as_conflict_copy", "discard_local"],
  };
}

/**
 * Decide reload vs conflict when host revision may have advanced.
 *
 * - Equal / missing current → none
 * - Differ + not dirty → reload (autoRefresh true; next edit mint gets new key)
 * - Differ + dirty → conflict (autoRefresh false; show banner)
 */
export function evaluateDocumentKeyInvalidation(
  input: EvaluateDocumentKeyInvalidationInput,
): DocumentKeyInvalidationDecision {
  const base = input.baseRevisionToken?.trim() ?? "";
  const current = input.currentRevisionToken?.trim() ?? "";

  if (!current || (base && base === current)) {
    return {
      action: "none",
      autoRefresh: false,
      revisionsMatch: true,
    };
  }

  if (!base) {
    return {
      action: "none",
      autoRefresh: false,
      revisionsMatch: true,
    };
  }

  if (input.dirty) {
    return {
      action: "conflict",
      autoRefresh: false,
      revisionsMatch: false,
      reason: "superseded_base",
      conflict: buildSupersededBaseConflict({
        path: input.path,
        expectedRevision: input.baseRevision,
        actualRevision: input.currentRevision,
      }),
    };
  }

  return {
    action: "reload",
    autoRefresh: true,
    revisionsMatch: false,
    reason: "external_revision_advance",
  };
}

/**
 * Whether the pane may auto-apply a new host revision (preview reload).
 * Dirty human edit always returns false.
 */
export function shouldAutoRefreshOnRevisionAdvance(input: {
  dirty: boolean;
  baseRevisionToken: string | null | undefined;
  currentRevisionToken: string | null | undefined;
}): boolean {
  const decision = evaluateDocumentKeyInvalidation({
    baseRevisionToken: input.baseRevisionToken,
    currentRevisionToken: input.currentRevisionToken,
    dirty: input.dirty,
    path: "/",
  });
  return decision.action === "reload" && decision.autoRefresh === true;
}
