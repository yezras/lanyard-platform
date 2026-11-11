import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import { Banner } from "@astryxdesign/core/Banner";
import {
  ChatComposer,
  ChatComposerDrawer,
  ChatComposerInput,
  ChatLayout,
  ChatSendButton,
} from "@astryxdesign/core/Chat";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { VStack } from "@astryxdesign/core/VStack";
import type { SearchableItem } from "@astryxdesign/core/Typeahead";

import {
  cancelChatRequest,
  ChatSendError,
  kickSpeculativeEnsureOnline,
  sendChatMessage,
  sendMcqSelection,
  uploadStagingFile,
} from "../../api/chat.js";
import { sendToolApprovalDecision } from "../../api/connectors.js";

/** True when send failed with mapped ensure_online / wake body (lp-mrh). */
function isWakeSendError(
  error: unknown,
): error is ChatSendError & { isWakeFailure: true } {
  if (!error || typeof error !== "object") {
    return false;
  }
  if ((error as { isWakeFailure?: unknown }).isWakeFailure !== true) {
    return false;
  }
  return error instanceof Error;
}
import {
  beginConnectorChatUse,
  cancelPendingConnectorUse,
  fetchConnectors,
  isConnectorOAuthMessage,
  resumePendingConnectorUse,
  startConnectorOAuth,
  startWhatsAppPair,
} from "../../api/connectors.js";
import { fetchPortalContext } from "../../api/context.js";
import { createSettingsCron } from "../../api/settings.js";
import type {
  AuthUser,
  McqChoice,
  SettingsCron,
  VaultTreeNode,
} from "../../api/types.js";
import { downloadVaultFile, fetchVaultTree } from "../../api/vault.js";
import {
  isChatResponsePending,
  useChatEvents,
  type ChatTimelineItem,
} from "../../hooks/useChatEvents.js";
import { useOptionalPortalHonesty } from "../honesty/index.js";
import { useChatThread } from "../projects/ChatThreadContext.js";
import { latestActivityTextFromItems } from "../projects/threadActivityPreview.js";
import { deriveThreadResponseStatus } from "../projects/threadResponseStatus.js";
import {
  isInventoryMutatingToolEvent,
  useSettingsSnapshot,
} from "../settings/SettingsSnapshotContext.js";
import { humanizeSchedule } from "../settings/settingsFormat.js";
import {
  CONNECTOR_LABELS,
  type ConnectorId,
  type SpaConnectorStatus,
} from "../settings/connectorsCatalog.js";
import { fileTypeIcon } from "../vault/fileTypeIcon.js";
import { findVaultTreeFilePath } from "../vault/vaultTree.js";
import { canVaultEditFromPortalContext } from "../vault/vaultEditGating.js";

import { AgentChatHeader } from "./AgentChatHeader.js";
import { decideSpeculativeEnsureOnlineKick } from "./speculativeEnsureOnline.js";
import {
  AGENT_STARTING_MESSAGE,
  wakeFailureBannerTitle,
} from "./agentStarting.js";
import {
  buildComposerTriggers,
  skillsToSearchItems,
  workflowsToSearchItems,
  vaultPathsToSearchItems,
} from "./chatComposerTriggers.js";
import {
  buildMailboxMentionTrigger,
  mergeMailboxMentionTrigger,
  tenantAgentsFromThreads,
} from "./composerMailboxPicker.js";
import { ChatTimeline } from "./ChatTimeline.js";
import {
  ComposerAttachMenu,
  attachableSkillsFromSnapshot,
  vaultFilesForAttachMenu,
} from "./composerAttachMenu.js";
import {
  chatColumnStyle,
  chatLayoutStyle,
  chatRootStyle,
  chatSplitRowStyle,
} from "./chatLayout.js";
import {
  applyWizardMcqSelection,
  applyWizardTextInput,
  createScheduledTaskWizardSession,
  isScheduledTaskWizardMcqId,
  markWizardCreateFailed,
  markWizardCreateSucceeded,
  type ScheduledTaskWizardMcqPrompt,
  type ScheduledTaskWizardSession,
  type WizardApplyResult,
} from "./scheduledTaskChatWizard.js";
import {
  isScheduledTaskWizardToolEvent,
  isWizardCancelText,
  wizardStepNeedsFreeText,
} from "./scheduledTaskWizardLive.js";
import {
  applyWorkflowWizardMcqSelection,
  applyWorkflowWizardTextInput,
  formatWorkflowCreateAgentRequest,
  formatWorkflowCreateUserProgress,
  isWorkflowWizardMcqId,
  markWorkflowWizardCreateFailed,
  markWorkflowWizardCreateSucceeded,
  workflowWizardStepNeedsFreeText,
  type WorkflowWizardApplyResult,
  type WorkflowWizardMcqPrompt,
  type WorkflowWizardSession,
} from "./workflowChatWizard.js";
import {
  formatWorkflowCreatePendingMessage,
  formatWorkflowCreateSucceededMessage,
  interpretWorkflowAuthoringToolEvent,
  upsertWorkflowInSnapshot,
  workflowInventoryIncludesName,
} from "./workflowWizardLive.js";
import {
  applyConnectorOAuthSuccess,
  applyConnectorWizardChoice,
  createConnectorChatWizardSession,
  formatConnectorResumePrompt,
  googleToolArgvFromChatEvent,
  isConnectorChatWizardMcqId,
  markConnectorOAuthOpened,
  markConnectorResumeFinished,
  openConnectorOAuthTab,
  type ConnectorChatWizardSession,
} from "./connectorChatWizard.js";
import {
  isScheduledTaskThread,
  ScheduledTaskConfigPane,
} from "./scheduledTaskConfig/index.js";
import {
  activityPaneReducer,
  ActivityPaneHost,
  createInitialActivityPaneState,
  SubagentRoster,
  WorkflowTree,
  type ActivityPaneFocus,
  type ActivityPaneMode,
  type ActivityPaneState,
} from "./activityPane/index.js";
import { SourcesRoster } from "./activityPane/SourcesRoster.js";
import type { StackedSource } from "./SourceStack.js";
import {
  collectNestedToolsForSubagent,
  collectSubagentRunsFromTimeline,
  type SubagentRun,
} from "./subagentRun.js";
import {
  collectWorkflowRunsFromTimeline,
  type WorkflowRun,
} from "./workflowRun.js";
import {
  artifactPanelReducer,
  createInitialArtifactPanelState,
  detectChatOpenDocumentIntent,
  documentReopenChipFromRef,
  DocumentPaneHost,
  openDocumentIntentFromUserMessage,
  openDocumentPathAction,
  panelActionsFromChatEvent,
  resolveChatDocumentRenderer,
  resolvePaneArtifactRef,
  shouldRecordDocumentReopenChip,
  upsertDocumentReopenChip,
  useDocumentPaneCurrentness,
  useDocumentPanePreview,
  useOfficeEditorSession,
  type ArtifactPanelState,
  type DocumentPaneLayoutPreference,
  type DocumentReopenChip,
  type VaultArtifactRef,
} from "./documentPane/index.js";
import "./chat.css";

type FailureBanner = {
  title: string;
  description?: string;
};
