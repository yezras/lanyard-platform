export { AgentChatHeader } from "./AgentChatHeader.js";
export {
  buildChannelMemberRows,
  findChannelForThread,
  isChannelSheetEligible,
  type ChannelMemberRow,
} from "./channelHeaderSheet.js";
export { ChannelHeaderSheet } from "./ChannelHeaderSheet.js";
export {
  ChatView,
  type ActivityOpenRequest,
  type ChatViewProps,
  type DocumentOpenRequest,
} from "./ChatView.js";
export {
  DitherAvatar,
  DitherPattern,
  hashSeed,
  hueForName,
  hueFromSeed,
  type DitherAvatarProps,
  type DitherAvatarSize,
  type DitherPatternProps,
} from "./DitherAvatar.js";
export { DitherAvatarRoster } from "./DitherAvatarRoster.js";
export * from "./documentPane/index.js";
export * from "./activityPane/index.js";
export * from "./scheduledTaskConfig/index.js";
// charts/* is intentionally not re-exported from this barrel — PortalShell
// imports ChatView from here; keep recharts/motion out of the main shell until
// lp-a79.5/8 wire lazy chart chunks. Import from `./charts/` or story routes.
export {
  citationsFromSubagentArtifacts,
  collectNestedToolsForSubagent,
  collectSubagentRunsFromTimeline,
  extractSafeVaultPathsFromToolResult,
  formatSubagentChipLabel,
  harvestArtifactsFromNestedTools,
  isNestedToolUnderSubagent,
  isSafeVaultArtifactPath,
  isSubagentEvent,
  mapSubagentRunFromEvent,
  mapSubagentRunFromToolCall,
  mergeSubagentArtifacts,
  normalizeSubagentStatus,
  parseSubagentArtifacts,
  resolveSubagentArtifacts,
  subagentColor,
  subagentIconKey,
  type NestedSubagentToolCall,
  type SubagentArtifact,
  type SubagentArtifactKind,
  type SubagentIconKey,
  type SubagentRun,
  type SubagentRunStatus,
} from "./subagentRun.js";
export {
  SubagentRunChip,
  SubagentRunChipFromCall,
  subagentIconComponent,
} from "./SubagentRunChip.js";
export {
  applyPeerActivityToWorkflowStages,
  applySubagentFallbackToWorkflow,
  attachSubagentToWorkflowStage,
  collectClaimedStageSubagentIds,
  collectWorkflowRunsFromTimeline,
  defaultExpandedStageIds,
  deriveWorkflowStatusFromStages,
  formatWorkflowCardLabel,
  isWorkflowEvent,
  listFreeFloatingSubagents,
  mapWorkflowRunFromEvent,
  mapWorkflowRunFromToolCall,
  materializeStageSubagents,
  mergeWorkflowStages,
  nestAgentsOntoWorkflowStages,
  normalizeWorkflowStatus,
  parseWorkflowStages,
  readWorkflowIdFromEvent,
  resolveStageSubagents,
  resolveStageSubagentsWithFallback,
  unwrapWorkflowMetadata,
  workflowStatusLabel,
  type WorkflowAgentWire,
  type WorkflowPeerActivity,
  type WorkflowRun,
  type WorkflowStage,
  type WorkflowStageStatus,
} from "./workflowRun.js";
export {
  WorkflowRunCard,
  WorkflowRunCardFromCall,
} from "./WorkflowRunCard.js";
export {
  shouldShowThinkingPulse,
  THINKING_PULSE_KEYWORDS,
  THINKING_PULSE_ROTATE_MS,
  ThinkingPulse,
  type ThinkingPulseKeyword,
  type ThinkingPulseProps,
} from "./ThinkingPulse.js";

export {
  applyConnectorOAuthSuccess,
  applyConnectorWizardChoice,
  createConnectorChatWizardSession,
  formatConnectorResumePrompt,
  googleToolArgvFromChatEvent,
  isConnectorChatWizardMcqId,
  openConnectorOAuthTab,
  type ConnectorChatWizardSession,
  type ConnectorChatWizardStep,
  type ConnectorWizardApplyResult,
} from "./connectorChatWizard.js";
export {
  applyWizardMcqSelection,
  applyWizardTextInput,
  buildScheduledTaskCreateBody,
  buildWizardMcqId,
  createScheduledTaskWizardSession,
  detectBrowserTimezone,
  isScheduledTaskWizardMcqId,
  markWizardCreateFailed,
  markWizardCreateSucceeded,
  parseHumanDaysInput,
  parseHumanTimeInput,
  parseWizardMcqId,
  wizardMcqToPortalMetadata,
  wizardSelectionToInboundMetadata,
  type McqSelectionInput,
  type ScheduledTaskCreateBody,
  type ScheduledTaskWizardDraft,
  type ScheduledTaskWizardMcqPrompt,
  type ScheduledTaskWizardSession,
  type ScheduledTaskWizardStep,
  type WizardApplyResult,
} from "./scheduledTaskChatWizard.js";
export {
  isScheduledTaskWizardToolEvent,
  isWizardCancelText,
  parseCronjobToolResult,
  wizardStepNeedsFreeText,
  SCHEDULED_TASK_WIZARD_PORTAL_EVENT,
} from "./scheduledTaskWizardLive.js";
export {
  applyWorkflowWizardMcqSelection,
  applyWorkflowWizardTextInput,
  buildWorkflowCreateBody,
  buildWorkflowWizardMcqId,
  createWorkflowWizardSession,
  formatWorkflowCreateAgentRequest,
  formatWorkflowCreateUserProgress,
  extractWorkflowNameFromProse,
  isValidWorkflowWizardName,
  isWorkflowWizardMcqId,
  looksLikeMultiPhaseProse,
  markWorkflowWizardCreateFailed,
  markWorkflowWizardCreateSucceeded,
  normalizeWorkflowWizardName,
  parseStagesFreeText,
  parseWorkflowNaturalLanguage,
  parseWorkflowWizardMcqId,
  workflowWizardStepNeedsFreeText,
  type WorkflowAuthoredAgent,
  type WorkflowAuthoredStage,
  type WorkflowCreateBody,
  type WorkflowMcqSelectionInput,
  type WorkflowWizardApplyResult,
  type WorkflowWizardDraft,
  type WorkflowWizardMcqPrompt,
  type WorkflowWizardMode,
  type WorkflowWizardSession,
  type WorkflowWizardStep,
} from "./workflowChatWizard.js";
export {
  formatWorkflowCreatePendingMessage,
  formatWorkflowCreateSucceededMessage,
  interpretWorkflowAuthoringToolEvent,
  parseWorkflowToolResult,
  upsertWorkflowInSnapshot,
  workflowInventoryIncludesName,
  type WorkflowAuthoringToolOutcome,
} from "./workflowWizardLive.js";
