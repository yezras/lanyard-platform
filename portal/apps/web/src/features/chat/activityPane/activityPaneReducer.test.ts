/**
 * Unit tests for side-pane mode reducer (lp-dpr.4).
 */
import { describe, expect, it } from "vitest";

import {
  activityPaneReducer,
  createInitialActivityPaneState,
} from "./activityPaneReducer.js";
import {
  isActivityMode,
  isDocumentMode,
  isSidePaneOpen,
} from "./types.js";

describe("activityPaneReducer (lp-dpr.4)", () => {
  it("starts closed", () => {
    const state = createInitialActivityPaneState();
    expect(state.mode).toBe("closed");
    expect(state.focus).toEqual({ kind: "roster" });
    expect(isSidePaneOpen(state)).toBe(false);
    expect(isActivityMode(state)).toBe(false);
    expect(isDocumentMode(state)).toBe(false);
  });

  it("opens document mode independently", () => {
    const state = activityPaneReducer(createInitialActivityPaneState(), {
      type: "SIDE_PANE_OPEN_DOCUMENT",
    });
    expect(state.mode).toBe("document");
    expect(state.openGeneration).toBe(1);
    expect(isDocumentMode(state)).toBe(true);
    expect(isSidePaneOpen(state)).toBe(true);
  });

  it("opens activity mode independently of document", () => {
    const closed = createInitialActivityPaneState();
    const activity = activityPaneReducer(closed, {
      type: "SIDE_PANE_OPEN_ACTIVITY",
    });
    expect(activity.mode).toBe("activity");
    expect(activity.focus).toEqual({ kind: "roster" });
    expect(activity.openGeneration).toBe(1);
    expect(isActivityMode(activity)).toBe(true);

    // Can open activity while document mode is active (switches mode).
    const fromDoc = activityPaneReducer(
      activityPaneReducer(closed, { type: "SIDE_PANE_OPEN_DOCUMENT" }),
      {
        type: "SIDE_PANE_OPEN_ACTIVITY",
        focus: { kind: "subagent", runId: "run-1" },
      },
    );
    expect(fromDoc.mode).toBe("activity");
    expect(fromDoc.focus).toEqual({ kind: "subagent", runId: "run-1" });
  });

  it("switches between document and activity without losing focus", () => {
    let state = createInitialActivityPaneState();
    state = activityPaneReducer(state, {
      type: "SIDE_PANE_OPEN_ACTIVITY",
      focus: { kind: "workflow", workflowId: "wf-9" },
    });
    expect(state.focus).toEqual({ kind: "workflow", workflowId: "wf-9" });

    state = activityPaneReducer(state, { type: "SIDE_PANE_OPEN_DOCUMENT" });
    expect(state.mode).toBe("document");
    // Focus retained for when activity re-opens / restore.
    expect(state.focus).toEqual({ kind: "workflow", workflowId: "wf-9" });

    state = activityPaneReducer(state, { type: "SIDE_PANE_OPEN_ACTIVITY" });
    expect(state.mode).toBe("activity");
    expect(state.focus).toEqual({ kind: "workflow", workflowId: "wf-9" });
  });

  it("restores document mode when closing activity with documentStillOpen", () => {
    let state = createInitialActivityPaneState();
    state = activityPaneReducer(state, { type: "SIDE_PANE_OPEN_DOCUMENT" });
    state = activityPaneReducer(state, {
      type: "SIDE_PANE_OPEN_ACTIVITY",
      focus: { kind: "roster" },
    });
    expect(state.mode).toBe("activity");

    state = activityPaneReducer(state, {
      type: "SIDE_PANE_CLOSE",
      reason: "user",
      documentStillOpen: true,
    });
    expect(state.mode).toBe("document");
  });

  it("fully closes activity when no document is open", () => {
    let state = createInitialActivityPaneState();
    state = activityPaneReducer(state, {
      type: "SIDE_PANE_OPEN_ACTIVITY",
    });
    state = activityPaneReducer(state, {
      type: "SIDE_PANE_CLOSE",
      reason: "user",
      documentStillOpen: false,
    });
    expect(state.mode).toBe("closed");
  });

  it("closes document mode to closed", () => {
    let state = createInitialActivityPaneState();
    state = activityPaneReducer(state, { type: "SIDE_PANE_OPEN_DOCUMENT" });
    state = activityPaneReducer(state, {
      type: "SIDE_PANE_CLOSE",
      reason: "user",
    });
    expect(state.mode).toBe("closed");
  });

  it("resets on thread change", () => {
    let state = createInitialActivityPaneState();
    state = activityPaneReducer(state, {
      type: "SIDE_PANE_OPEN_ACTIVITY",
      focus: { kind: "subagent", runId: "x" },
    });
    state = activityPaneReducer(state, { type: "SIDE_PANE_RESET" });
    expect(state).toEqual(createInitialActivityPaneState());
  });

  it("is idempotent for same activity focus", () => {
    let state = createInitialActivityPaneState();
    state = activityPaneReducer(state, {
      type: "SIDE_PANE_OPEN_ACTIVITY",
      focus: { kind: "roster" },
    });
    const gen = state.openGeneration;
    const next = activityPaneReducer(state, {
      type: "SIDE_PANE_OPEN_ACTIVITY",
      focus: { kind: "roster" },
    });
    expect(next).toBe(state);
    expect(next.openGeneration).toBe(gen);
  });

  it("opens scheduled_task_config focus (lp-lv9.5)", () => {
    let state = createInitialActivityPaneState();
    state = activityPaneReducer(state, {
      type: "SIDE_PANE_OPEN_ACTIVITY",
      focus: { kind: "scheduled_task_config" },
    });
    expect(state.mode).toBe("activity");
    expect(state.focus).toEqual({ kind: "scheduled_task_config" });
    expect(isActivityMode(state)).toBe(true);
  });
});
