/**
 * Pure ArtifactPanelState reducer for the chat document pane.
 *
 * Beads: lp-5q6.12 (state machine), lp-5q6.16 (progress strip + checkpoint offer),
 * lp-swt.2 (office-only open — Office paths enter edit without PANEL_REQUEST_EDIT)
 * Domain transitions: docs/architecture/portal-document-session-domain-model.md §2.4
 *
 * Status machine (domain naming; acceptance "updating" ≡ status `progress`):
 * closed | opening | previewing | editing | progress | conflict | error
 *
 * Components dispatch actions only; they must not set `status` via effects.
 * No Document Server JWT/key/callback logic belongs here.
 */

import { isOfficeEditorPath } from "./isOfficeEditorFile.js";
import {
  normalizePaneVaultPath,
  sameDocumentRevision,
  samePaneArtifactPath,
} from "./pathResolution.js";
import type {
  ArtifactEvent,
  ArtifactPanelAction,
  ArtifactPanelProgress,
  ArtifactPanelState,
  CheckpointOffer,
  ConflictState,
  DocumentRevision,
  VaultArtifactRef,
} from "./types.js";

/**
 * Open mode for a vault path (lp-swt.2).
 * Office-eligible files always open in edit so OnlyOffice session mint binds
 * without a separate PANEL_REQUEST_EDIT. Non-office keeps the requested mode.
 */
function resolveOpenMode(
  path: string | null | undefined,
  requested: "preview" | "edit" = "preview",
): "preview" | "edit" {
  if (isOfficeEditorPath(path)) return "edit";
  return requested;
}

/** Initial closed pane. */
export function createInitialArtifactPanelState(): ArtifactPanelState {
  return {
    status: "closed",
    ref: null,
    knownRevision: null,
    mode: "preview",
    officeSessionId: null,
    progress: null,
    conflict: null,
    checkpointOffer: null,
    error: null,
    localDirty: false,
    openGeneration: 0,
  };
}

function closedState(
  openGeneration: number,
): ArtifactPanelState {
  return {
    ...createInitialArtifactPanelState(),
    openGeneration,
  };
}

function withRef(
  ref: VaultArtifactRef,
  extras: Partial<VaultArtifactRef> = {},
): VaultArtifactRef {
  return { ...ref, ...extras };
}

/**
 * True when two progress payloads are identical for strip purposes.
 * Used to avoid re-render spam from repeated agent progress frames.
 */
export function samePanelProgress(
  a: ArtifactPanelProgress | null | undefined,
  b: ArtifactPanelProgress | null | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.operationId === b.operationId &&
    a.percent === b.percent &&
    a.message === b.message &&
    a.phase === b.phase
  );
}

/**
 * Enter opening for a resolved ref. Always bumps openGeneration so re-click
 * of the same path re-runs preview effects (domain gotcha).
 */
function openToOpening(
  state: ArtifactPanelState,
  ref: VaultArtifactRef,
  opts: {
    revision?: DocumentRevision;
    mode?: "preview" | "edit";
  } = {},
): ArtifactPanelState {
  const mode = opts.mode ?? "preview";
  return {
    status: "opening",
    ref: withRef(ref),
    knownRevision: opts.revision ?? null,
    mode,
    officeSessionId: null,
    progress: null,
    conflict: null,
    checkpointOffer: null,
    error: null,
    localDirty: false,
    openGeneration: state.openGeneration + 1,
  };
}

function externalUpdateConflict(
  state: ArtifactPanelState,
  ref: VaultArtifactRef,
  actualRevision: DocumentRevision,
): ConflictState {
  return {
    reason: "superseded_base",
    path: ref.path,
    expectedRevision: state.knownRevision ?? undefined,
    actualRevision,
    message:
      "Document changed while you were editing. Reload or save a conflict copy.",
    offeredActions: ["reload", "save_as_conflict_copy", "discard_local"],
  };
}

function applyArtifactEvent(
  state: ArtifactPanelState,
  event: ArtifactEvent,
): ArtifactPanelState {
  switch (event.type) {
    case "open": {
      const preferred = event.preferredMode ?? "preview";
      // Office-only (lp-swt.2): Office paths open straight into edit so the
      // session binds without PANEL_REQUEST_EDIT. Non-office stays preview-first
      // (legacy preferred=edit still opens preview for non-office types).
      const mode = resolveOpenMode(
        event.ref.path,
        preferred === "edit" ? "preview" : preferred,
      );
      return openToOpening(state, event.ref, {
        revision: event.revision,
        mode,
      });
    }

    case "progress": {
      if (state.status === "closed") {
        // Progress without an open pane: if we have a ref, open into progress.
        if (!event.ref) return state;
        const opened = openToOpening(state, event.ref);
        return {
          ...opened,
          status: "progress",
          progress: {
            operationId: event.operationId,
            percent: event.percent,
            message: event.message,
            phase: event.phase,
          },
        };
      }

      // Ignore progress for a different path while another doc is open.
      if (
        event.ref &&
        state.ref &&
        !samePaneArtifactPath(event.ref, state.ref)
      ) {
        return state;
      }

      const progress: ArtifactPanelProgress = {
        operationId: event.operationId,
        percent: event.percent,
        message: event.message,
        phase: event.phase,
      };

      // Duplicate frames: keep reference-equal state to avoid strip spam.
      if (samePanelProgress(state.progress, progress)) {
        if (
          state.status === "progress" ||
          state.status === "editing" ||
          state.status === "conflict"
        ) {
          return state;
        }
        // Already have this strip payload but status is idle — only flip status.
        if (state.status === "previewing" || state.status === "opening") {
          return { ...state, status: "progress", error: null };
        }
      }

      // While editing/conflict, only update the progress strip — do not leave.
      if (state.status === "editing" || state.status === "conflict") {
        return { ...state, progress };
      }

      return {
        ...state,
        status: "progress",
        progress,
        error: null,
      };
    }

    case "updated": {
      if (state.status === "closed" && !event.ref) return state;

      const nextRef = event.ref;
      const samePath =
        !state.ref || samePaneArtifactPath(state.ref, nextRef);

      // Checkpoint / conflict_copy updates on a different path: surface as
      // alternate conflict option when human is dirty-editing canonical.
      if (
        !samePath &&
        (state.status === "editing" || state.localDirty) &&
        (event.writeKind === "checkpoint" ||
          event.writeKind === "conflict_copy")
      ) {
        const conflict: ConflictState = {
          reason: "human_edit_active",
          path: state.ref!.path,
          alternateRef: nextRef,
          actualRevision: event.revision,
          message:
            "Agent wrote a checkpoint while you have an active edit. Open the checkpoint without discarding your buffer.",
          offeredActions: ["open_checkpoint", "discard_local"],
        };
        return {
          ...state,
          status: "conflict",
          conflict,
          checkpointOffer: null,
          progress: null,
        };
      }

      // Idle / non-dirty: soft offer to open agent checkpoint without swap.
      if (
        !samePath &&
        state.status !== "closed" &&
        (event.writeKind === "checkpoint" ||
          event.writeKind === "conflict_copy")
      ) {
        const offer: CheckpointOffer = {
          ref: withRef(nextRef, { source: "agent_checkpoint" }),
          revision: event.revision,
          sourcePath: event.sourcePath,
          message:
            event.writeKind === "conflict_copy"
              ? "Agent saved a conflict copy. Open it in the pane without leaving your current document."
              : "Agent wrote a checkpoint. Open it in the pane without leaving your current document.",
        };
        // Identical offer → no-op (spam guard).
        if (
          state.checkpointOffer &&
          samePaneArtifactPath(state.checkpointOffer.ref, offer.ref) &&
          sameDocumentRevision(state.checkpointOffer.revision, offer.revision)
        ) {
          return {
            ...state,
            progress: null,
          };
        }
        return {
          ...state,
          progress: null,
          checkpointOffer: offer,
        };
      }

      if (!samePath && state.status !== "closed") {
        // Different path update while another doc is open — ignore.
        return state;
      }

      // Dirty edit / editing: external revision on same path → conflict.
      // Never auto-swap Office key material while dirty (domain §5.1).
      if (
        (state.status === "editing" || state.localDirty) &&
        samePath &&
        !sameDocumentRevision(state.knownRevision, event.revision)
      ) {
        return {
          ...state,
          status: "conflict",
          ref: state.ref ?? nextRef,
          knownRevision: state.knownRevision,
          conflict: externalUpdateConflict(
            state,
            state.ref ?? nextRef,
            event.revision,
          ),
          checkpointOffer: null,
          progress: null,
        };
      }

      const revisionChanged = !sameDocumentRevision(
        state.knownRevision,
        event.revision,
      );

      // Idle preview / progress / opening / error: accept new revision.
      // Stay in `opening` until useDocumentPanePreview dispatches READY so the
      // shell does not paint path chrome with an empty body (lp-dpr.1).
      if (state.status === "closed") {
        return {
          ...openToOpening(state, nextRef, { revision: event.revision }),
          knownRevision: event.revision,
          progress: null,
          error: null,
          checkpointOffer: null,
        };
      }

      // Same revision re-emit: stable openGeneration (no reload spam).
      if (!revisionChanged && samePath) {
        return {
          ...state,
          status:
            state.status === "editing" || state.status === "conflict"
              ? state.status
              : "previewing",
          progress: null,
          error: null,
          conflict:
            state.status === "conflict" ? state.conflict : null,
        };
      }

      return {
        ...state,
        status:
          state.status === "editing" || state.status === "conflict"
            ? state.status
            : "previewing",
        ref: samePath ? (state.ref ?? nextRef) : nextRef,
        knownRevision: event.revision,
        progress: null,
        error: null,
        conflict:
          state.status === "conflict" ? state.conflict : null,
        checkpointOffer: null,
        // Reload preview bytes when idle revision advances (lp-5q6.16).
        openGeneration:
          state.status === "editing" || state.status === "conflict"
            ? state.openGeneration
            : state.openGeneration + 1,
      };
    }

    case "error": {
      // Path mismatch: ignore errors for other documents.
      if (
        event.ref &&
        state.ref &&
        !samePaneArtifactPath(event.ref, state.ref)
      ) {
        return state;
      }

      const ref = event.ref ?? state.ref;
      return {
        ...state,
        status: "error",
        ref,
        progress: null,
        error: {
          code: event.code,
          message: event.message,
          retryable: event.retryable,
          ref: ref ?? undefined,
          operationId: event.operationId,
        },
      };
    }

    case "close": {
      // Optional: only close if event targets current ref (or no ref on event).
      if (
        event.ref &&
        state.ref &&
        !samePaneArtifactPath(event.ref, state.ref)
      ) {
        return state;
      }
      return closedState(state.openGeneration);
    }

    default: {
      // Exhaustiveness: unknown events leave state unchanged.
      const _exhaustive: never = event;
      void _exhaustive;
      return state;
    }
  }
}

/**
 * Pure reducer. Pass only {@link ArtifactPanelAction}; never mutate state.
 */
export function artifactPanelReducer(
  state: ArtifactPanelState,
  action: ArtifactPanelAction,
): ArtifactPanelState {
  switch (action.type) {
    case "PANEL_OPEN": {
      // Reject empty path defensively (callers should use resolvePaneArtifactRef).
      const path = normalizePaneVaultPath(action.ref.path);
      if (!path) {
        return {
          ...state,
          status: "error",
          error: {
            code: "invalid_path",
            message: "Cannot open document pane: invalid vault path",
            retryable: false,
            ref: action.ref,
          },
          openGeneration: state.openGeneration + 1,
        };
      }
      // Office paths force edit mode so session mint binds without REQUEST_EDIT.
      const mode = resolveOpenMode(path, action.mode ?? "preview");
      return openToOpening(
        state,
        { ...action.ref, path },
        { revision: action.revision, mode },
      );
    }

    case "PANEL_PREVIEW_READY": {
      // Stale response from a previous open — ignore.
      if (action.openGeneration !== state.openGeneration) return state;
      if (state.status !== "opening" && state.status !== "progress") {
        // Allow ready to settle error → previewing on retry of same generation.
        if (state.status !== "error") return state;
      }
      // Keep agent progress strip while content has loaded under it.
      const keepProgress = state.progress != null;
      return {
        ...state,
        status: keepProgress ? "progress" : "previewing",
        knownRevision: action.revision ?? state.knownRevision,
        error: null,
        progress: keepProgress ? state.progress : null,
      };
    }

    case "PANEL_PREVIEW_ERROR": {
      if (action.openGeneration !== state.openGeneration) return state;
      if (state.status === "closed") return state;
      return {
        ...state,
        status: "error",
        error: action.error,
        progress: null,
      };
    }

    case "PANEL_EVENT":
      return applyArtifactEvent(state, action.event);

    case "PANEL_SET_DIRTY":
      if (state.status === "closed") return state;
      return { ...state, localDirty: action.dirty };

    case "PANEL_REQUEST_EDIT": {
      if (
        state.status !== "previewing" &&
        state.status !== "progress" &&
        state.status !== "error"
      ) {
        return state;
      }
      if (!state.ref) return state;
      // Enter opening in edit mode; session bind completes the transition.
      return {
        ...state,
        status: "opening",
        mode: "edit",
        officeSessionId: null,
        error: null,
        conflict: null,
        progress: null,
        openGeneration: state.openGeneration + 1,
      };
    }

    case "PANEL_EXIT_EDIT": {
      // Return to view-only preview without closing the pane (lp-5q6.30).
      if (!state.ref || state.status === "closed") return state;
      // Office-only (lp-swt.2): no dual-mode preview — ignore exit for Office paths.
      if (isOfficeEditorPath(state.ref.path)) return state;
      if (state.mode !== "edit" && state.status !== "editing") {
        return state;
      }
      return {
        ...state,
        status: state.progress != null ? "progress" : "previewing",
        mode: "preview",
        officeSessionId: null,
        localDirty: false,
        conflict: null,
        error: null,
        // Keep openGeneration so preview bytes already loaded stay mounted;
        // Office session unmounts via mode change in useOfficeEditorSession.
      };
    }

    case "PANEL_SESSION_BOUND": {
      if (!state.ref) return state;
      if (state.mode !== "edit" && state.status !== "opening") {
        // Allow bind only when we intended edit, or already editing.
        if (state.status !== "editing") return state;
      }
      return {
        ...state,
        status: "editing",
        mode: "edit",
        officeSessionId: action.sessionId,
        error: null,
        progress: null,
      };
    }

    case "PANEL_SAVE_SUCCESS": {
      if (state.status !== "editing" && state.status !== "conflict") {
        return state;
      }
      // Office-only: stay in edit after save (no dual-mode drop to preview).
      if (
        action.stayEditing ||
        isOfficeEditorPath(state.ref?.path)
      ) {
        return {
          ...state,
          status: "editing",
          mode: "edit",
          knownRevision: action.revision,
          localDirty: false,
          conflict: null,
          error: null,
        };
      }
      return {
        ...state,
        status: "previewing",
        mode: "preview",
        officeSessionId: null,
        knownRevision: action.revision,
        localDirty: false,
        conflict: null,
        error: null,
      };
    }

    case "PANEL_CONFLICT": {
      if (state.status === "closed") return state;
      return {
        ...state,
        status: "conflict",
        conflict: action.conflict,
        progress: null,
      };
    }

    case "PANEL_RELOAD": {
      if (!state.ref || state.status === "closed") return state;
      const requestedMode =
        action.discardLocal || state.status === "conflict"
          ? "preview"
          : state.mode;
      // Office paths re-open in edit so OnlyOffice remounts without REQUEST_EDIT.
      const mode = resolveOpenMode(state.ref.path, requestedMode);
      const opened = openToOpening(state, state.ref, {
        revision: action.revision ?? state.knownRevision ?? undefined,
        mode,
      });
      // Conflict reload / discard_local: clear dirty + Office session id so
      // content re-fetches; Office remints via openGeneration + edit mode.
      if (action.discardLocal || state.status === "conflict") {
        return {
          ...opened,
          mode: resolveOpenMode(state.ref.path, "preview"),
          officeSessionId: null,
          localDirty: false,
        };
      }
      return opened;
    }

    case "PANEL_OPEN_CHECKPOINT": {
      const fromConflict = state.conflict?.alternateRef;
      const fromOffer = state.checkpointOffer?.ref;
      const ref = fromConflict ?? fromOffer;
      if (!ref) return state;
      const revision =
        state.conflict?.actualRevision ??
        state.checkpointOffer?.revision ??
        undefined;
      return openToOpening(
        state,
        withRef(ref, { source: "agent_checkpoint" }),
        { revision, mode: resolveOpenMode(ref.path, "preview") },
      );
    }

    case "PANEL_DISMISS_CHECKPOINT": {
      if (!state.checkpointOffer) return state;
      return { ...state, checkpointOffer: null };
    }

    case "PANEL_CLOSE":
      return closedState(state.openGeneration);

    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}
