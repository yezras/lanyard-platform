/**
 * Side-pane mode reducer (lp-dpr.4).
 *
 * Keeps ActivityPaneMode structured — ChatView dispatches typed actions
 * instead of scattering booleans.
 */

import {
  createInitialActivityPaneState,
  type ActivityPaneAction,
  type ActivityPaneFocus,
  type ActivityPaneState,
} from "./types.js";

export { createInitialActivityPaneState };

function sameFocus(a: ActivityPaneFocus, b: ActivityPaneFocus): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "subagent" && b.kind === "subagent") {
    return a.runId === b.runId;
  }
  if (a.kind === "workflow" && b.kind === "workflow") {
    return a.workflowId === b.workflowId;
  }
  return true;
}

export function activityPaneReducer(
  state: ActivityPaneState,
  action: ActivityPaneAction,
): ActivityPaneState {
  switch (action.type) {
    case "SIDE_PANE_OPEN_DOCUMENT": {
      if (state.mode === "document") {
        return state;
      }
      return {
        ...state,
        mode: "document",
        openGeneration: state.openGeneration + 1,
      };
    }

    case "SIDE_PANE_OPEN_ACTIVITY": {
      // Preserve prior focus when re-opening without an explicit target
      // (e.g. document → activity stacking).
      const focus = action.focus ?? state.focus;
      const already =
        state.mode === "activity" && sameFocus(state.focus, focus);
      if (already) {
        return state;
      }
      return {
        mode: "activity",
        focus,
        openGeneration: state.openGeneration + 1,
      };
    }

    case "SIDE_PANE_SET_ACTIVITY_FOCUS": {
      if (sameFocus(state.focus, action.focus) && state.mode === "activity") {
        return state;
      }
      return {
        ...state,
        mode: "activity",
        focus: action.focus,
        openGeneration:
          state.mode === "activity"
            ? state.openGeneration
            : state.openGeneration + 1,
      };
    }

    case "SIDE_PANE_CLOSE": {
      // Stacking restore: leaving activity restores document when still open.
      if (state.mode === "activity" && action.documentStillOpen) {
        return {
          ...state,
          mode: "document",
          openGeneration: state.openGeneration + 1,
        };
      }
      if (state.mode === "closed") {
        return state;
      }
      return {
        ...state,
        mode: "closed",
      };
    }

    case "SIDE_PANE_RESET": {
      if (state.mode === "closed" && state.focus.kind === "roster") {
        return state;
      }
      return createInitialActivityPaneState();
    }

    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}
