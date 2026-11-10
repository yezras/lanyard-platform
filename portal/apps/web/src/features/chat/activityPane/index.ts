/**
 * Chat activity side pane: mode state + chrome host (lp-dpr.4 / .5 / .7).
 *
 * Document mode continues to use DocumentPaneHost; activity mode mounts
 * ActivityPaneHost with SubagentRoster + WorkflowTree.
 * ChatView keeps a single ActivityPaneMode for stacking.
 */

export {
  activityPaneReducer,
  createInitialActivityPaneState,
} from "./activityPaneReducer.js";

export {
  ActivityPaneShell,
  isActivityPaneVisible,
  type ActivityPaneLayoutMode,
  type ActivityPaneShellProps,
} from "./ActivityPaneShell.js";

export {
  ActivityPaneHost,
  type ActivityPaneHostProps,
} from "./ActivityPaneHost.js";

export {
  SubagentRoster,
  type SubagentRosterProps,
} from "./SubagentRoster.js";

export {
  WorkflowTree,
  type WorkflowTreeProps,
} from "./WorkflowTree.js";

export {
  isActivityMode,
  isDocumentMode,
  isSidePaneOpen,
  type ActivityPaneAction,
  type ActivityPaneCloseReason,
  type ActivityPaneFocus,
  type ActivityPaneMode,
  type ActivityPaneState,
} from "./types.js";

export { ActivityPlaneStory } from "./ActivityPlaneStory.js";
