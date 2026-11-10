/**
 * Chat activity side pane domain types (lp-dpr.4).
 *
 * Models the single side surface next to chat as a structured mode, not
 * ad-hoc booleans. Document mode reuses DocumentPaneHost; activity mode hosts
 * subagent roster / workflow detail (content filled in later phases).
 *
 * ## Stacking policy
 *
 * - One chrome (open/close, resize, narrow drawer) hosts either document or
 *   activity — never both side-by-side (exclusive side column).
 * - Opening document → mode `document` (existing artifact panel state drives body).
 * - Opening activity → mode `activity` independently of whether a document is
 *   still held in the artifact panel store.
 * - Closing the visible surface:
 *   - From activity: if a document is still open in the artifact store, restore
 *     mode `document`; otherwise `closed`.
 *   - From document: mode `closed` (artifact panel closes as today).
 * - Thread change (lp-vnz.2): ChatView persists mode/focus/document path per
 *   threadId and restores on return; explicit user close clears that thread's
 *   stored snapshot. Reducer still supports SIDE_PANE_RESET for hard clear.
 * - Mounting: ChatView keeps DocumentPaneHost + ActivityPaneHost mounted so
 *   each host can run visible→false focus restore (lp-5q6.15). Document chrome
 *   is gated with DocumentPaneHost `active={isActive && mode === "document"}`;
 *   activity with `active={isActive}` and visibility `mode === "activity"`.
 *   Portal keep-alive sets `isActive` false off the Chat tab so drawer Dialogs
 *   release showModal / focus trap without wiping pane state (lp-vnz.1).
 *   Artifact panel state is retained while activity is exclusive so document
 *   can restore without re-open.
 */

// ---------------------------------------------------------------------------
// Mode & focus
// ---------------------------------------------------------------------------

/**
 * Which side surface is mounted next to chat.
 * `closed` = no side chrome; chat column is full width.
 */
export type ActivityPaneMode = "closed" | "document" | "activity";

/**
 * What activity mode should highlight (roster by default).
 * lp-dpr.5: subagent roster + drill-in; lp-dpr.7: workflow tree detail.
 */
export type ActivityPaneFocus =
  | { kind: "roster" }
  | { kind: "subagent"; runId: string }
  | { kind: "workflow"; workflowId: string }
  | { kind: "sources"; sources: import("../SourceStack.js").StackedSource[]; selectedUrl?: string }
  /**
   * Scheduled-task ops config (lp-lv9.5): schedule, last/next, On/Off, instructions.
   * Opened by default when selecting a kind=scheduled_task stream.
   */
  | { kind: "scheduled_task_config" };

export type ActivityPaneCloseReason =
  | "user"
  | "thread_change"
  | "escape"
  | "programmatic";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type ActivityPaneState = {
  mode: ActivityPaneMode;
  /** Activity body focus; retained when switching to document mode. */
  focus: ActivityPaneFocus;
  /**
   * Monotonic counter bumped whenever the side surface opens or the activity
   * focus changes while already open — drives autofocus.
   */
  openGeneration: number;
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type ActivityPaneAction =
  /** Show document mode (shared chrome; body is DocumentPaneHost). */
  | { type: "SIDE_PANE_OPEN_DOCUMENT" }
  /**
   * Show activity mode. Opens independently of document pane state.
   * Optional focus defaults to roster.
   */
  | {
      type: "SIDE_PANE_OPEN_ACTIVITY";
      focus?: ActivityPaneFocus;
    }
  /** Update activity focus without leaving activity mode. */
  | { type: "SIDE_PANE_SET_ACTIVITY_FOCUS"; focus: ActivityPaneFocus }
  /**
   * Close the currently visible side surface.
   * When closing activity and `documentStillOpen` is true, restore document mode
   * instead of fully closing (stacking restore).
   */
  | {
      type: "SIDE_PANE_CLOSE";
      reason?: ActivityPaneCloseReason;
      /** True when artifact panel still holds an open document ref. */
      documentStillOpen?: boolean;
    }
  /** Hard reset (thread change). */
  | { type: "SIDE_PANE_RESET" };

export function createInitialActivityPaneState(): ActivityPaneState {
  return {
    mode: "closed",
    focus: { kind: "roster" },
    openGeneration: 0,
  };
}

/** True when the shared side chrome should occupy the right column / drawer. */
export function isSidePaneOpen(state: ActivityPaneState): boolean {
  return state.mode !== "closed";
}

export function isActivityMode(state: ActivityPaneState): boolean {
  return state.mode === "activity";
}

export function isDocumentMode(state: ActivityPaneState): boolean {
  return state.mode === "document";
}
