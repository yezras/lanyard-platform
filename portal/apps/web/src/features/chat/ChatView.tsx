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

/**
 * Per-thread side-pane snapshot (lp-vnz.2).
 * Restored when the user switches back to that thread; cleared on explicit
 * user close of the visible surface (with no stacking restore left).
 */
export type ThreadSidePaneSnapshot = {
  mode: Exclude<ActivityPaneMode, "closed">;
  focus: ActivityPaneFocus;
  /** Document ref when document mode is open or retained under activity. */
  documentRef: VaultArtifactRef | null;
};

/** Capture live side-pane + artifact panel into a thread-local snapshot. */
export function captureThreadSidePaneSnapshot(
  sidePane: ActivityPaneState,
  panel: ArtifactPanelState,
): ThreadSidePaneSnapshot | null {
  const documentRef =
    panel.status !== "closed" && panel.ref != null ? panel.ref : null;
  if (sidePane.mode === "closed") {
    // Stacking edge: document still held but mode closed → treat as document.
    if (documentRef) {
      return {
        mode: "document",
        focus: sidePane.focus,
        documentRef,
      };
    }
    return null;
  }
  return {
    mode: sidePane.mode,
    focus: sidePane.focus,
    documentRef,
  };
}

/** Local-part of email for composer greeting (dev@demo.local → dev). */
export function displayNameFromEmail(email: string): string {
  return email.split("@")[0] || email;
}

/** External request to open a vault path in the chat document pane. */
export type DocumentOpenRequest = {
  path: string;
  /** Monotonic key so re-open of the same path re-runs the open effect. */
  key: number;
  title?: string;
  source?: VaultArtifactRef["source"];
};

/**
 * External request to open the activity side pane (lp-dpr.4).
 * Used by tests and later subagent chip clicks (lp-dpr.5).
 */
export type ActivityOpenRequest = {
  /** Monotonic key so re-open of the same focus re-runs the open effect. */
  key: number;
  focus?: ActivityPaneFocus;
};

export type ChatViewProps = {
  /**
   * Optional auth user for the composer greeting (`Hello, {localPart}.`).
   * Pass from PortalShell when available; falls back when omitted (merge-safe).
   */
  user?: Pick<AuthUser, "email">;
  /**
   * Legacy vault-tab navigation. Citation clicks now open the chat document
   * pane (lp-5q6.14). Still used as fallback for "Open in Vault" when
   * {@link onOpenInVault} is omitted.
   */
  onCitationNavigate?: (path: string) => void;
  /**
   * Secondary control: open path in the full Vault tab for deeper browsing.
   * Used by the pane toolbar "Open in Vault" button.
   * Falls back to {@link onCitationNavigate} when omitted.
   */
  onOpenInVault?: (path: string) => void;
  /**
   * Open a document in the chat-side preview pane (lp-5q6.13 / lp-5q6.14).
   * Used by shell wiring, tests, and progressive integration.
   */
  documentOpenRequest?: DocumentOpenRequest | null;
  /**
   * Open the activity side pane (lp-dpr.4). Independent of document pane;
   * stacking policy lives in activityPaneReducer.
   */
  activityOpenRequest?: ActivityOpenRequest | null;
  /**
   * Override ui.can.vault_edit (tests). When omitted, read from GET /api/context.
   * Fail-closed while loading / unknown (lp-5q6.30).
   */
  canVaultEdit?: boolean | null;
  /** Override ONLYOFFICE feature flag (tests). */
  onlyOfficeEditorEnabled?: boolean;
  /**
   * Force side-pane split vs drawer layout (tests / stories).
   * Default `auto` follows the chat-root container width (lp-5q6.15).
   */
  sidePaneLayoutPreference?: DocumentPaneLayoutPreference;
  /**
   * Whether Chat is the active Portal tab. Keep-alive mounts ChatView while
   * Vault/Settings are shown; when false, side-pane hosts hide chrome so
   * Dialog showModal / focus traps do not freeze the other tabs (lp-vnz.1).
   * Pane state is retained so returning to Chat restores the open surface.
   * Default true (standalone / tests / stories).
   */
  isActive?: boolean;
};

export function ChatView({
  user,
  onCitationNavigate,
  onOpenInVault,
  documentOpenRequest = null,
  activityOpenRequest = null,
  canVaultEdit: canVaultEditProp,
  onlyOfficeEditorEnabled,
  sidePaneLayoutPreference = "auto",
  isActive = true,
}: ChatViewProps = {}) {
  const speculativeKickedRef = useRef(false);
  useEffect(() => {
    const decision = decideSpeculativeEnsureOnlineKick({
      isActive,
      alreadyKicked: speculativeKickedRef.current,
    });
    if (!decision.kick) {
      return;
    }
    speculativeKickedRef.current = true;
    void kickSpeculativeEnsureOnline().catch(() => {
      // Best-effort; Send still uses the lazy ensure_online path.
    });
  }, [isActive]);

  const {
    threadId,
    threads,
    selectedProjectId,
    projects,
    isCreatingThread,
    renameThread,
    renameThreadFromFirstMessage,
    updateThreadSystemPrompt,
    maybeAssignSystemPromptFromTurns,
    setThreadResponseStatus,
    setThreadActivityPreview,
    ensureAndSelectJobStream,
    refreshThreads,
  } = useChatThread();

  const [panelState, dispatchPanel] = useReducer(
    artifactPanelReducer,
    undefined,
    createInitialArtifactPanelState,
  );
  /** Shared side surface mode: document | activity | closed (lp-dpr.4). */
  const [sidePane, dispatchSidePane] = useReducer(
    activityPaneReducer,
    undefined,
    createInitialActivityPaneState,
  );
  const { content: paneContent, isLoading: paneLoading } =
    useDocumentPanePreview(panelState, dispatchPanel);
  const paneCurrentness = useDocumentPaneCurrentness(
    panelState,
    dispatchPanel,
  );

  const documentStillOpen =
    panelState.status !== "closed" && panelState.ref != null;

  /** From GET /api/context when prop not injected. null = unknown (fail closed). */
  const [contextVaultEdit, setContextVaultEdit] = useState<boolean | null>(
    canVaultEditProp === undefined ? null : canVaultEditProp,
  );

  useEffect(() => {
    if (canVaultEditProp !== undefined) {
      setContextVaultEdit(canVaultEditProp);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const ctx = await fetchPortalContext();
        if (!cancelled) {
          setContextVaultEdit(canVaultEditFromPortalContext(ctx));
        }
      } catch {
        if (!cancelled) {
          setContextVaultEdit(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canVaultEditProp]);

  const canVaultEdit =
    canVaultEditProp !== undefined ? canVaultEditProp : contextVaultEdit;

  // Preview vs ONLYOFFICE from type, capability, and flag (lp-5q6.30 / lp-swt.2).
  // Office-only: gates alone activate OnlyOffice — no dual-mode Edit/Back chrome.
  const rendererDecision = useMemo(
    () =>
      resolveChatDocumentRenderer({
        path: panelState.ref?.path,
        mode: panelState.mode,
        canVaultEdit,
        editorEnabled: onlyOfficeEditorEnabled,
      }),
    [
      panelState.ref?.path,
      panelState.mode,
      canVaultEdit,
      onlyOfficeEditorEnabled,
    ],
  );

  // Mint ONLYOFFICE when the renderer decision says so (gates pass).
  // Gates fail → VaultReader fallback; enabled:false forces inactive.
  const officeEditor = useOfficeEditorSession({
    state: panelState,
    dispatch: dispatchPanel,
    enabled: rendererDecision.officeActive
      ? onlyOfficeEditorEnabled
      : false,
  });
  const handlePaneDirty = useCallback(
    (dirty: boolean) => {
      dispatchPanel({ type: "PANEL_SET_DIRTY", dirty });
    },
    [dispatchPanel],
  );
  // Kept for non-office dual-mode remnants / tests; office-only never surfaces
  // Edit / Back controls (rendererDecision.showEdit/showExitEdit are false).
  const handlePaneRequestEdit = useCallback(() => {
    dispatchPanel({ type: "PANEL_REQUEST_EDIT" });
  }, []);
  const handlePaneExitEdit = useCallback(() => {
    dispatchPanel({ type: "PANEL_EXIT_EDIT" });
  }, []);
  const handleBackgroundThreadItems = useCallback(
    (id: string, threadItems: ChatTimelineItem[]) => {
      const status = deriveThreadResponseStatus(threadItems);
      if (status) {
        setThreadResponseStatus(id, status);
      }
      // SideNav line-2 subtitle: latest user/assistant text (ellipsis in row).
      const preview = latestActivityTextFromItems(threadItems);
      if (preview) {
        setThreadActivityPreview(id, preview);
      }
    },
    [setThreadActivityPreview, setThreadResponseStatus],
  );

  const activeThread = useMemo(
    () => threads.find((thread) => thread.thread_id === threadId) ?? null,
    [threads, threadId],
  );

  // Prefer thread-bound vault path; fall back to selected project for new chats.
  // Resolved before useChatEvents so tool-target citation fallbacks join correctly.
  const selectedProjectVaultPath = useMemo(() => {
    if (!selectedProjectId) {
      return null;
    }
    return (
      projects.find((project) => project.project_id === selectedProjectId)
        ?.vault_path ?? null
    );
  }, [projects, selectedProjectId]);

  const projectVaultPath = activeThread
    ? activeThread.project_vault_path
    : selectedProjectVaultPath;

  // Shared settings: skills + active model; inventory refresh after chat tools (lp-a8u.7).
  const {
    snapshot: settingsSnapshot,
    setSnapshot: setSettingsSnapshot,
    refreshSnapshot,
    scheduleInventoryRefresh,
  } = useSettingsSnapshot();

  /** Job stream bound to the active chat (lp-lv9.5 config pane). */
  const scheduledJobId = useMemo(() => {
    const raw = activeThread?.scheduled_job_id;
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    return null;
  }, [activeThread?.scheduled_job_id]);

  const scheduledTaskCron = useMemo((): SettingsCron | null => {
    if (!scheduledJobId || !settingsSnapshot?.crons?.length) return null;
    return (
      settingsSnapshot.crons.find((c) => c.id === scheduledJobId) ?? null
    );
  }, [scheduledJobId, settingsSnapshot?.crons]);

  const honesty = useOptionalPortalHonesty();

  /** Filled after wizard helpers exist — starts Portal MCQ create flow. */
  const startScheduledTaskWizardRef = useRef<((id: string) => void) | null>(
    null,
  );
  /**
   * Confirm pending workflow wizard create from host tool events (lp-khq.12.2).
   * Filled after processWorkflowWizardResult helpers exist.
   */
  const confirmWorkflowCreateFromEventRef = useRef<
    ((event: {
      type?: string | null;
      tool_name?: string | null;
      tool_label?: string | null;
      tool_status?: string | null;
      result?: string | null;
      result_detail?: string | null;
      error_message?: string | null;
      errorMessage?: string | null;
      metadata?: Record<string, unknown> | null;
    }) => void) | null
  >(null);
  const startConnectorChatWizardRef = useRef<
    ((id: string, argv: string[]) => void) | null
  >(null);

  /**
   * Live artifact.open / file tool_target → pane (citations are click-only).
   * Completed skill/workflow/cron tools debounce-refresh Settings inventory.
   * cronjob action=setup opens the scheduled-task wizard (lp-fn5.4.1 / lp-jzl.9.1).
   * Workflow create/save tool completion confirms Portal wizard success (lp-khq.12.2).
   */
  const handleActiveThreadChatEvent = useCallback(
    (event: Parameters<typeof panelActionsFromChatEvent>[0]) => {
      const actions = panelActionsFromChatEvent(event, {
        thread_id: threadId ?? undefined,
        project_vault_path: projectVaultPath,
      });
      for (const action of actions) {
        dispatchPanel(action);
      }
      if (isInventoryMutatingToolEvent(event)) {
        scheduleInventoryRefresh();
      }
      // lp-v62i.23: agent scheduled_task.create bound the job stream — refetch
      // sidenav without a Settings round-trip.
      const createToolName = (
        (typeof event.tool_name === "string" && event.tool_name) ||
        (typeof event.tool_label === "string" && event.tool_label) ||
        ""
      ).trim();
      if (
        event.type === "tool_progress" &&
        (createToolName === "scheduled_task.create" ||
          createToolName === "cron.create" ||
          Boolean(
            event.metadata &&
              typeof event.metadata === "object" &&
              (event.metadata as { scheduled_task?: unknown }).scheduled_task,
          ))
      ) {
        void refreshThreads();
      }
      // Agent-started interactive create: cronjob action=setup (or alias).
      if (
        threadId &&
        isScheduledTaskWizardToolEvent(
          event as {
            type?: string;
            tool_name?: string;
            tool_label?: string;
            tool_status?: string;
            metadata?: Record<string, unknown> | null;
          },
        )
      ) {
        // Defer so timeline has absorbed the tool row first.
        queueMicrotask(() => {
          startScheduledTaskWizardRef.current?.(threadId);
        });
      }
      // Pending workflow wizard: only claim success after host create/save.
      confirmWorkflowCreateFromEventRef.current?.(
        event as {
          type?: string | null;
          tool_name?: string | null;
          tool_label?: string | null;
          tool_status?: string | null;
          result?: string | null;
          result_detail?: string | null;
          error_message?: string | null;
          errorMessage?: string | null;
          metadata?: Record<string, unknown> | null;
        },
      );
      const googleArgv = googleToolArgvFromChatEvent(
        event as {
          tool_name?: string | null;
          tool_label?: string | null;
          tool_target?: string | null;
          error_message?: string | null;
          errorMessage?: string | null;
          metadata?: Record<string, unknown> | null;
        },
      );
      if (threadId && googleArgv) {
        queueMicrotask(() => {
          startConnectorChatWizardRef.current?.(threadId, googleArgv);
        });
      }
    },
    [projectVaultPath, refreshThreads, scheduleInventoryRefresh, threadId],
  );

  const {
    items,
    toolProgress,
    connectionStatus,
    agentWakeStatus,
    clearAgentWakeStatus,
    noteAgentStarting,
    appendUserMessage,
    updateUserMessageStatus,
    markMcqSelected,
    setMcqDisabled,
    markToolApprovalSelected,
    setToolApprovalDisabled,
    appendLocalAssistantTurn,
    appendLocalMcq,
    upsertConnectorOAuth,
    retainThreadStream,
    haltOpenAssistantTurn,
  } = useChatEvents({
    threadId,
    onThreadItemsChange: handleBackgroundThreadItems,
    onActiveThreadChatEvent: handleActiveThreadChatEvent,
    projectVaultPath,
  });
  const sendChatAndNoteStarting = useCallback(
    async (input: Parameters<typeof sendChatMessage>[0]) => {
      const result = await sendChatMessage(input);
      if (result?.agentStarting) {
        noteAgentStarting(result.message);
      }
    },
    [noteAgentStarting],
  );
  const [messageText, setMessageText] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);
  const [failureBanner, setFailureBanner] = useState<FailureBanner | null>(
    null,
  );
  const [isSending, setIsSending] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [pendingStagingPaths, setPendingStagingPaths] = useState<string[]>([]);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  /** Portal-owned scheduled-task create wizard (lp-fn5.4.1), keyed by thread. */
  const scheduledTaskWizardByThreadRef = useRef(
    new Map<string, ScheduledTaskWizardSession>(),
  );
  /** Portal-owned workflow create wizard (lp-khq.8), keyed by thread. */
  const workflowWizardByThreadRef = useRef(
    new Map<string, WorkflowWizardSession>(),
  );
  const connectorWizardByThreadRef = useRef(
    new Map<string, ConnectorChatWizardSession>(),
  );

  const getScheduledTaskWizard = useCallback(
    (id: string): ScheduledTaskWizardSession | null =>
      scheduledTaskWizardByThreadRef.current.get(id) ?? null,
    [],
  );

  const setScheduledTaskWizard = useCallback(
    (id: string, session: ScheduledTaskWizardSession | null) => {
      if (
        !session ||
        session.step === "done" ||
        session.step === "cancelled"
      ) {
        scheduledTaskWizardByThreadRef.current.delete(id);
        return;
      }
      scheduledTaskWizardByThreadRef.current.set(id, session);
    },
    [],
  );

  const emitWizardMcq = useCallback(
    (prompt: ScheduledTaskWizardMcqPrompt | WorkflowWizardMcqPrompt) => {
      appendLocalMcq({
        mcqId: prompt.mcq_id,
        content: prompt.content,
        choices: prompt.choices,
        messageId: `local-${prompt.mcq_id}`,
      });
    },
    [appendLocalMcq],
  );

  const getWorkflowWizard = useCallback(
    (id: string): WorkflowWizardSession | null =>
      workflowWizardByThreadRef.current.get(id) ?? null,
    [],
  );

  const setWorkflowWizard = useCallback(
    (id: string, session: WorkflowWizardSession | null) => {
      if (
        !session ||
        session.step === "done" ||
        session.step === "cancelled"
      ) {
        workflowWizardByThreadRef.current.delete(id);
        return;
      }
      workflowWizardByThreadRef.current.set(id, session);
    },
    [],
  );

  const processScheduledTaskWizardResult = useCallback(
    async (id: string, result: WizardApplyResult): Promise<void> => {
      if (!result.ok) {
        setScheduledTaskWizard(id, result.session);
        appendLocalAssistantTurn(result.error);
        return;
      }

      let session = result.session;

      if (result.shouldCreate && session.createBody) {
        try {
          const created = await createSettingsCron(session.createBody);
          session = markWizardCreateSucceeded(session, created.cron.id);
          appendLocalAssistantTurn(
            `Created scheduled task **${created.cron.name}** (${humanizeSchedule(created.cron.schedule)}). Opening its stream under Scheduled Tasks.`,
          );
          scheduleInventoryRefresh();
          // lp-lv9.7: ensure job stream row, select it, expand ST folder.
          // Config pane auto-opens via isScheduledTaskThread effect.
          // lp-pxr.3: seed thread purpose from job instructions when empty.
          const jobInstructions =
            (typeof session.createBody.prompt === "string" &&
            session.createBody.prompt.trim()
              ? session.createBody.prompt
              : null) ??
            (typeof session.createBody.instructions === "string" &&
            session.createBody.instructions.trim()
              ? session.createBody.instructions
              : null) ??
            (typeof created.cron.prompt === "string" ? created.cron.prompt : null);
          await ensureAndSelectJobStream({
            jobId: created.cron.id,
            name: created.cron.name,
            instructions: jobInstructions,
          });
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Create failed";
          session = markWizardCreateFailed(session, message);
          appendLocalAssistantTurn(`Create failed: ${message}`);
          // Re-emit confirm chips so the user can retry / edit / cancel.
          if (session.activeMcq) {
            emitWizardMcq(session.activeMcq);
          }
        }
        setScheduledTaskWizard(id, session);
        return;
      }

      if (result.nextMcq) {
        emitWizardMcq(result.nextMcq);
        setScheduledTaskWizard(id, session);
        return;
      }

      if (session.step === "cancelled") {
        appendLocalAssistantTurn("Cancelled — no scheduled task created.");
        setScheduledTaskWizard(id, session);
        return;
      }

      if (wizardStepNeedsFreeText(session.step, session.activeMcq)) {
        appendLocalAssistantTurn(session.statusMessage);
        setScheduledTaskWizard(id, session);
        return;
      }

      setScheduledTaskWizard(id, session);
    },
    [
      appendLocalAssistantTurn,
      emitWizardMcq,
      ensureAndSelectJobStream,
      scheduleInventoryRefresh,
      setScheduledTaskWizard,
    ],
  );

  /**
   * Start wizard after agent calls cronjob action=setup (no NL hardcoding).
   * Product chrome does not start this wizard (lp-v62i.2.1).
   */
  const startScheduledTaskWizardLive = useCallback(
    (id: string) => {
      if (getScheduledTaskWizard(id)) {
        return;
      }
      const skillInventory = settingsSnapshot?.skills ?? [];
      const { session, firstMcq } = createScheduledTaskWizardSession({
        skillInventory,
      });
      setScheduledTaskWizard(id, session);
      haltOpenAssistantTurn("Scheduled task wizard started");
      setIsSending(false);
      appendLocalAssistantTurn(
        "I'll help you create a **scheduled task** with interactive steps — no cron expressions needed.",
      );
      if (firstMcq) {
        emitWizardMcq(firstMcq);
      }
    },
    [
      appendLocalAssistantTurn,
      emitWizardMcq,
      getScheduledTaskWizard,
      haltOpenAssistantTurn,
      setScheduledTaskWizard,
      settingsSnapshot?.skills,
    ],
  );
  startScheduledTaskWizardRef.current = startScheduledTaskWizardLive;

  const getConnectorWizard = useCallback(
    (id: string): ConnectorChatWizardSession | null =>
      connectorWizardByThreadRef.current.get(id) ?? null,
    [],
  );

  const setConnectorWizard = useCallback(
    (id: string, session: ConnectorChatWizardSession | null) => {
      if (
        !session ||
        session.step === "done" ||
        session.step === "cancelled" ||
        session.step === "expired"
      ) {
        connectorWizardByThreadRef.current.delete(id);
        return;
      }
      connectorWizardByThreadRef.current.set(id, session);
    },
    [],
  );

  const startConnectorChatWizardLive = useCallback(
    (id: string, argv: string[]) => {
      const existing = getConnectorWizard(id);
      if (
        existing &&
        (existing.step === "needs_auth" || existing.step === "waiting_oauth")
      ) {
        return;
      }
      void (async () => {
        try {
          const result = await beginConnectorChatUse("google", {
            thread_id: id,
            args: argv,
          });
          if (result.kind !== "needs_auth") {
            return;
          }
          const session = createConnectorChatWizardSession({
            connectorId: "google",
            threadId: id,
            tool: result.pending.tool,
            args: result.pending.args,
            expiresAt: result.pending.expires_at,
            content: result.wizard.content,
          });
          setConnectorWizard(id, session);
          haltOpenAssistantTurn("Connect wizard started");
          setIsSending(false);
          appendLocalMcq({
            mcqId: result.wizard.mcq_id || session.sessionId,
            content: result.wizard.content || session.statusMessage,
            choices:
              result.wizard.choices.length > 0
                ? result.wizard.choices
                : [
                    { id: "connect", label: "Connect Google" },
                    { id: "cancel", label: "Cancel" },
                  ],
            messageId: `local-${session.sessionId}`,
          });
        } catch {
          // Fail closed without a dead 403 bubble; user can still use Connectors.
        }
      })();
    },
    [
      appendLocalMcq,
      getConnectorWizard,
      haltOpenAssistantTurn,
      setConnectorWizard,
    ],
  );
  startConnectorChatWizardRef.current = startConnectorChatWizardLive;

  const processConnectorWizardResult = useCallback(
    async (
      id: string,
      result: ReturnType<typeof applyConnectorWizardChoice>,
    ): Promise<void> => {
      if (!result.ok) {
        setConnectorWizard(id, result.session);
        appendLocalAssistantTurn(result.error);
        return;
      }
      let session = result.session;
      setConnectorWizard(id, session);
      if (result.assistantMessage) {
        appendLocalAssistantTurn(result.assistantMessage);
      }
      if (result.shouldCancelPending) {
        try {
          await cancelPendingConnectorUse(session.connectorId);
        } catch {
          // Pending TTL will drop it.
        }
        setConnectorWizard(id, null);
        return;
      }
      if (result.shouldOpenOAuth) {
        try {
          const started = await startConnectorOAuth(session.connectorId, {
            thread_id: id,
          });
          const opened = openConnectorOAuthTab(started.url);
          session = markConnectorOAuthOpened(session, {
            url: started.url,
            opened: opened.opened,
          });
          setConnectorWizard(id, session);
          if (!opened.opened) {
            appendLocalAssistantTurn(
              `Pop-up blocked. [Open Google](${started.url}) — new tab; this thread stays.`,
            );
          }
        } catch (error) {
          appendLocalAssistantTurn(
            error instanceof Error ? error.message : "Google connect failed",
          );
        }
      }
    },
    [appendLocalAssistantTurn, setConnectorWizard],
  );

  const finishConnectorOAuthSuccess = useCallback(
    async (id: string, accountLabel?: string | null) => {
      const wizard = getConnectorWizard(id);
      if (!wizard) {
        return;
      }
      const result = applyConnectorOAuthSuccess(wizard);
      if (!result.ok) {
        return;
      }
      // lp-xhf4.19: the BFF callback does not emit connector.oauth SSE —
      // paint the Connected chip from the postMessage in wizard flows too
      // (same upsert as #622; dedupes into one card per connector).
      if (wizard.connectorId === "google" || wizard.connectorId === "hubspot") {
        upsertConnectorOAuth({
          connectorId: wizard.connectorId,
          phase: "connected",
          accountLabel,
        });
      }
      if (result.assistantMessage) {
        appendLocalAssistantTurn(result.assistantMessage);
      }
      if (!result.shouldResume) {
        if (result.shouldCancelPending) {
          try {
            await cancelPendingConnectorUse(wizard.connectorId);
          } catch {
            // ignore
          }
        }
        setConnectorWizard(id, markConnectorResumeFinished(result.session, false));
        return;
      }
      try {
        const resumed = await resumePendingConnectorUse(wizard.connectorId);
        if (resumed.kind !== "resume") {
          appendLocalAssistantTurn(
            resumed.message || "Google connected. The pending tool was not sent.",
          );
          setConnectorWizard(id, markConnectorResumeFinished(result.session, false));
          return;
        }
        setConnectorWizard(id, markConnectorResumeFinished(result.session, true));
        retainThreadStream(id);
        await sendChatAndNoteStarting({
          threadId: id,
          text: formatConnectorResumePrompt(resumed.tool, resumed.args),
        });
      } catch (error) {
        appendLocalAssistantTurn(
          error instanceof Error ? error.message : "Could not resume Google tool",
        );
      }
    },
    [
      appendLocalAssistantTurn,
      getConnectorWizard,
      retainThreadStream,
      sendChatAndNoteStarting,
      setConnectorWizard,
      upsertConnectorOAuth,
    ],
  );

  /**
   * lp-xhf4.16: in-chat OAuth — composer Connectors group. Statuses come from
   * GET /api/connectors (fetch once on mount; refetch after OAuth success).
   * Fetch errors fail closed to an empty group, never a retry loop.
   */
  const [connectorStatuses, setConnectorStatuses] = useState<
    SpaConnectorStatus[]
  >([]);
  const refreshConnectorStatuses = useCallback(() => {
    void fetchConnectors()
      .then(({ connectors }) => {
        setConnectorStatuses(connectors);
      })
      .catch(() => {
        setConnectorStatuses([]);
      });
  }, []);
  useEffect(() => {
    refreshConnectorStatuses();
  }, [refreshConnectorStatuses]);

  /** Entitled + role-granted + not-yet-connected rows for the + menu. */
  const connectorActions = useMemo(
    () =>
      connectorStatuses
        .filter(
          (row) => row.entitled && row.role_granted && row.status !== "connected",
        )
        .map((row) => ({
          connectorId: row.connector_id,
          label: `Connect ${CONNECTOR_LABELS[row.connector_id]}`,
        })),
    [connectorStatuses],
  );

  /**
   * lp-xhf4.16: composer Connect → OAuth tab (Google/HubSpot) or WhatsApp QR
   * pairing. No pending tool here — never beginConnectorChatUse. threadId may
   * be null on the new-thread composer; pass it through only when present.
   */
  const handleComposerConnectConnector = useCallback(
    (id: ConnectorId) => {
      void (async () => {
        if (id === "whatsapp") {
          try {
            await startWhatsAppPair(threadId ? { threadId } : undefined);
            // Honest status only — the QR bubble arrives via connector.qr SSE.
            appendLocalAssistantTurn(
              "Connecting WhatsApp… scan the QR code below to link this device.",
            );
          } catch (error) {
            appendLocalAssistantTurn(
              error instanceof Error ? error.message : "WhatsApp pairing failed",
            );
          }
          return;
        }
        try {
          const started = await startConnectorOAuth(
            id,
            threadId ? { thread_id: threadId } : undefined,
          );
          // lp-xhf4.19: paint the in-thread OAuth card on start (phase
          // connect). The BFF never SSEs connector.oauth for composer
          // connects, so ChatView owns the local upsert (same item shape as
          // #622); the postMessage success handler replaces it with connected.
          if (
            threadId &&
            (id === "google" || id === "hubspot")
          ) {
            upsertConnectorOAuth({ connectorId: id, phase: "connect" });
          }
          const opened = openConnectorOAuthTab(started.url);
          appendLocalAssistantTurn(
            opened.opened
              ? `Connecting ${CONNECTOR_LABELS[id]}… finish in the opened tab.`
              : `Pop-up blocked. [Open ${CONNECTOR_LABELS[id]}](${started.url}) — this thread stays here.`,
          );
        } catch (error) {
          appendLocalAssistantTurn(
            error instanceof Error
              ? error.message
              : `${CONNECTOR_LABELS[id]} connect failed`,
          );
        }
      })();
    },
    [appendLocalAssistantTurn, threadId, upsertConnectorOAuth],
  );

  /**
   * Persist workflow via agent `workflow` tool (create/save) — host maps stages
   * → IR. Portal sends a structured free-text request (no user IR paste).
   *
   * lp-khq.12.2: do **not** claim Settings / `$` success until the host tool
   * completes create/save and inventory can list the name (see
   * confirmWorkflowCreateFromEventRef).
   */
  const processWorkflowWizardResult = useCallback(
    async (id: string, result: WorkflowWizardApplyResult): Promise<void> => {
      if (!result.ok) {
        setWorkflowWizard(id, result.session);
        appendLocalAssistantTurn(result.error);
        return;
      }

      let session = result.session;

      if (result.shouldCreate && session.createBody) {
        const body = session.createBody;
        // Agent instruction may include structured fields; user transcript shows
        // plain-language progress only (lp-khq.12.1 — no IR/JSON/tool jargon).
        const requestText = formatWorkflowCreateAgentRequest(body);
        try {
          appendLocalAssistantTurn(formatWorkflowCreateUserProgress(body));
          // Host path: agent `workflow` action=create (lp-khq.10 / lac-bwe).
          retainThreadStream(id);
          await sendChatAndNoteStarting({
            threadId: id,
            text: requestText,
          });
          // Stay on "creating" until tool completion confirms save.
          session = {
            ...session,
            step: "creating",
            activeMcq: null,
            readyToCreate: true,
            createBody: body,
            statusMessage: formatWorkflowCreatePendingMessage(body),
            error: null,
          };
          appendLocalAssistantTurn(formatWorkflowCreatePendingMessage(body));
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Create request failed";
          session = markWorkflowWizardCreateFailed(session, message);
          appendLocalAssistantTurn(`Create failed: ${message}`);
          if (session.activeMcq) {
            emitWizardMcq(session.activeMcq);
          }
        }
        setWorkflowWizard(id, session);
        return;
      }

      if (result.nextMcq) {
        emitWizardMcq(result.nextMcq);
        setWorkflowWizard(id, session);
        return;
      }

      if (session.step === "cancelled") {
        appendLocalAssistantTurn("Cancelled — no workflow created.");
        setWorkflowWizard(id, session);
        return;
      }

      if (
        workflowWizardStepNeedsFreeText(session.step, session.activeMcq)
      ) {
        appendLocalAssistantTurn(session.statusMessage);
        setWorkflowWizard(id, session);
        return;
      }

      setWorkflowWizard(id, session);
    },
    [
      appendLocalAssistantTurn,
      emitWizardMcq,
      retainThreadStream,
      sendChatAndNoteStarting,
      setWorkflowWizard,
    ],
  );

  /**
   * When a pending workflow wizard create is open, confirm success/failure from
   * host `workflow` create/save tool events, force inventory refresh, and only
   * then claim Tools → Workflows / `$` availability (lp-khq.12.2).
   */
  const confirmWorkflowCreateFromEvent = useCallback(
    (event: {
      type?: string | null;
      tool_name?: string | null;
      tool_label?: string | null;
      tool_status?: string | null;
      result?: string | null;
      result_detail?: string | null;
      error_message?: string | null;
      errorMessage?: string | null;
      metadata?: Record<string, unknown> | null;
    }) => {
      if (!threadId) return;
      const session = getWorkflowWizard(threadId);
      if (!session || session.step !== "creating" || !session.createBody) {
        return;
      }
      const outcome = interpretWorkflowAuthoringToolEvent(event);
      if (outcome.kind === "ignore") return;

      const expectedName = session.createBody.name;
      const launchAfter = Boolean(session.createBody.launchAfter);

      if (outcome.kind === "error") {
        const failed = markWorkflowWizardCreateFailed(session, outcome.error);
        setWorkflowWizard(threadId, failed);
        appendLocalAssistantTurn(`Create failed: ${outcome.error}`);
        if (failed.activeMcq) {
          emitWizardMcq(failed.activeMcq);
        }
        return;
      }

      // success
      const confirmedName = outcome.name?.trim() || expectedName;
      if (
        outcome.name &&
        outcome.name.trim().toLowerCase() !== expectedName.toLowerCase()
      ) {
        // Host saved a different name — still accept but surface it.
      }

      const path = outcome.path;
      // Optimistic inventory so Tools → Workflows / $ typeahead update immediately.
      setSettingsSnapshot((prev) =>
        upsertWorkflowInSnapshot(prev, {
          name: confirmedName,
          path,
          description: session.createBody?.description,
        }),
      );

      const done = markWorkflowWizardCreateSucceeded(session, confirmedName);
      setWorkflowWizard(threadId, done);
      appendLocalAssistantTurn(
        formatWorkflowCreateSucceededMessage({
          name: confirmedName,
          path,
          launchAfter,
          inventoryConfirmed: true,
        }),
      );

      // Force inventory refresh; re-upsert if host snapshot lags slightly.
      void (async () => {
        try {
          const snap = await refreshSnapshot();
          if (!workflowInventoryIncludesName(snap, confirmedName)) {
            setSettingsSnapshot((prev) =>
              upsertWorkflowInSnapshot(prev, {
                name: confirmedName,
                path,
                description: session.createBody?.description,
              }),
            );
          }
        } catch {
          // Optimistic row already applied; schedule debounced retry.
          scheduleInventoryRefresh();
        }
      })();
    },
    [
      appendLocalAssistantTurn,
      emitWizardMcq,
      getWorkflowWizard,
      refreshSnapshot,
      scheduleInventoryRefresh,
      setSettingsSnapshot,
      setWorkflowWizard,
      threadId,
    ],
  );
  confirmWorkflowCreateFromEventRef.current = confirmWorkflowCreateFromEvent;

  const showFailureBanner = useCallback((title: string, description?: string) => {
    setFailureBanner({
      title,
      ...(description ? { description } : {}),
    });
    setComposerError(null);
  }, []);

  /** Map chat send failures; wake errors use dedicated title + retry copy (lp-6ty / lp-mrh). */
  const showSendFailure = useCallback(
    (error: unknown, fallbackTitle = "Send failed") => {
      clearAgentWakeStatus();
      if (isWakeSendError(error)) {
        showFailureBanner(
          wakeFailureBannerTitle(error.code),
          error.message,
        );
        return;
      }
      const message =
        error instanceof Error ? error.message : "Send failed";
      showFailureBanner(fallbackTitle, message);
    },
    [clearAgentWakeStatus, showFailureBanner],
  );

  // Surface wake failure that arrives on SSE (same connection as agent_starting).
  useEffect(() => {
    if (agentWakeStatus?.kind !== "error") {
      return;
    }
    showFailureBanner(
      wakeFailureBannerTitle(agentWakeStatus.code),
      agentWakeStatus.message,
    );
    clearAgentWakeStatus();
  }, [agentWakeStatus, clearAgentWakeStatus, showFailureBanner]);
  const skillItems = useMemo(
    () =>
      settingsSnapshot
        ? skillsToSearchItems(settingsSnapshot.skills)
        : [],
    [settingsSnapshot],
  );

  /** `$` typeahead from shared settings snapshot (incl. optimistic create upsert). */
  const workflowItems = useMemo(
    () =>
      settingsSnapshot?.workflows
        ? workflowsToSearchItems(settingsSnapshot.workflows)
        : [],
    [settingsSnapshot?.workflows],
  );

  /** + attach menu skills (name + optional description from snapshot). */
  const attachSkills = useMemo(
    () => attachableSkillsFromSnapshot(settingsSnapshot?.skills),
    [settingsSnapshot?.skills],
  );

  /**
   * Controlled append for + attach menu inserts (lp-khq.5).
   * Must update React state — Astryx insertToken/insertText do not emitChange,
   * so Send (`canSend` from controlled value) would stay disabled otherwise.
   */
  const handleAttachComposerChange = useCallback((next: string) => {
    setMessageText(next);
  }, []);

  /** + → Attach file opens the hidden local upload input (lp-khq.12.3). */
  const handleAttachFileFromMenu = useCallback(() => {
    uploadInputRef.current?.click();
  }, []);

  // Session-local sidebar StatusDot: report active thread response phase.
  useEffect(() => {
    if (!threadId) {
      return;
    }
    const status = deriveThreadResponseStatus(items, {
      isSending,
      hasSendError: Boolean(composerError),
    });
    if (status) {
      setThreadResponseStatus(threadId, status);
    }
  }, [threadId, items, isSending, composerError, setThreadResponseStatus]);

  // lp-vnz.2: persist side pane (mode / focus / document path) per threadId.
  // On switch: snapshot the leaving thread, restore the entering thread.
  // Explicit user close clears that thread's stored entry (see handlers below).
  // Do not wipe on null → first thread (initial create) so open requests survive mount.
  const prevThreadIdRef = useRef<string | null | undefined>(undefined);
  const sidePaneByThreadRef = useRef(new Map<string, ThreadSidePaneSnapshot>());
  const sidePaneRef = useRef(sidePane);
  sidePaneRef.current = sidePane;
  const panelStateRef = useRef(panelState);
  panelStateRef.current = panelState;
  /**
   * When restoring activity with a retained document, PANEL_OPEN would otherwise
   * promote mode to document via the openGeneration effect — skip that once.
   */
  const skipDocModePromoteRef = useRef(false);

  /**
   * Durable reopen chips per thread (lp-a8u.2). Survive pane close so soft-open
   * / agent / citation opens leave an inline control to reopen preview.
   */
  const [documentReopenChips, setDocumentReopenChips] = useState<
    DocumentReopenChip[]
  >([]);
  const documentReopenChipsRef = useRef(documentReopenChips);
  documentReopenChipsRef.current = documentReopenChips;
  const reopenChipsByThreadRef = useRef(
    new Map<string, DocumentReopenChip[]>(),
  );

  useEffect(() => {
    if (prevThreadIdRef.current === undefined) {
      prevThreadIdRef.current = threadId;
      return;
    }
    const prev = prevThreadIdRef.current;
    prevThreadIdRef.current = threadId;
    if (!prev || prev === threadId) {
      return;
    }

    const leaving = captureThreadSidePaneSnapshot(
      sidePaneRef.current,
      panelStateRef.current,
    );
    if (leaving) {
      sidePaneByThreadRef.current.set(prev, leaving);
    } else {
      sidePaneByThreadRef.current.delete(prev);
    }
    // Persist reopen chips for the leaving thread (independent of pane open).
    const leavingChips = documentReopenChipsRef.current;
    if (leavingChips.length > 0) {
      reopenChipsByThreadRef.current.set(prev, leavingChips);
    } else {
      reopenChipsByThreadRef.current.delete(prev);
    }
    setDocumentReopenChips(
      threadId != null
        ? (reopenChipsByThreadRef.current.get(threadId) ?? [])
        : [],
    );

    const incoming =
      threadId != null
        ? sidePaneByThreadRef.current.get(threadId)
        : undefined;

    if (!incoming) {
      dispatchPanel({ type: "PANEL_CLOSE", reason: "thread_change" });
      dispatchSidePane({ type: "SIDE_PANE_RESET" });
      return;
    }

    if (incoming.documentRef) {
      if (incoming.mode === "activity") {
        skipDocModePromoteRef.current = true;
      }
      dispatchPanel({ type: "PANEL_OPEN", ref: incoming.documentRef });
    } else {
      dispatchPanel({ type: "PANEL_CLOSE", reason: "thread_change" });
    }

    if (incoming.mode === "activity") {
      dispatchSidePane({
        type: "SIDE_PANE_OPEN_ACTIVITY",
        focus: incoming.focus,
      });
    } else {
      dispatchSidePane({ type: "SIDE_PANE_OPEN_DOCUMENT" });
    }
  }, [threadId]);

  // Mint reopen chips only after a successful open (not opening/error).
  useEffect(() => {
    if (
      !shouldRecordDocumentReopenChip(panelState.status, panelState.ref)
    ) {
      return;
    }
    const ref = panelState.ref;
    if (!ref) {
      return;
    }
    setDocumentReopenChips((prev) =>
      upsertDocumentReopenChip(prev, documentReopenChipFromRef(ref)),
    );
  }, [
    panelState.status,
    panelState.ref,
    panelState.openGeneration,
  ]);

  // When a document is (re)opened, promote side pane to document mode (lp-dpr.4).
  // openGeneration bumps on PANEL_OPEN so activity → document switches correctly.
  // Skipped once after thread restore of activity+document (lp-vnz.2).
  const prevDocOpenGenRef = useRef(0);
  useEffect(() => {
    if (documentStillOpen && panelState.openGeneration !== prevDocOpenGenRef.current) {
      prevDocOpenGenRef.current = panelState.openGeneration;
      if (skipDocModePromoteRef.current) {
        skipDocModePromoteRef.current = false;
        return;
      }
      dispatchSidePane({ type: "SIDE_PANE_OPEN_DOCUMENT" });
      return;
    }
    if (!documentStillOpen) {
      prevDocOpenGenRef.current = 0;
      // Artifact panel closed while we were in document mode → close side surface.
      if (sidePane.mode === "document") {
        dispatchSidePane({ type: "SIDE_PANE_CLOSE", reason: "programmatic" });
      }
    }
  }, [
    documentStillOpen,
    panelState.openGeneration,
    sidePane.mode,
  ]);

  // External open request (tests / shell / future citation routing).
  useEffect(() => {
    if (!documentOpenRequest?.path) {
      return;
    }
    const resolved = resolvePaneArtifactRef(documentOpenRequest.path, {
      projectVaultPath,
      source: documentOpenRequest.source ?? "deep_link",
      title: documentOpenRequest.title,
    });
    if (!resolved.ok) {
      return;
    }
    dispatchPanel({ type: "PANEL_OPEN", ref: resolved.ref });
  }, [
    documentOpenRequest?.key,
    documentOpenRequest?.path,
    documentOpenRequest?.source,
    documentOpenRequest?.title,
    projectVaultPath,
  ]);

  // External activity open (tests / subagent chips — lp-dpr.4 / lp-dpr.5).
  useEffect(() => {
    if (activityOpenRequest == null) {
      return;
    }
    dispatchSidePane({
      type: "SIDE_PANE_OPEN_ACTIVITY",
      focus: activityOpenRequest.focus,
    });
    // key is the open trigger; focus is read for that open only.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activityOpenRequest.key
  }, [activityOpenRequest?.key]);

  const handleOpenInVault = useCallback(
    (path: string) => {
      const open = onOpenInVault ?? onCitationNavigate;
      open?.(path);
    },
    [onCitationNavigate, onOpenInVault],
  );

  /**
   * Primary citation UX (lp-5q6.14): open the right-side document pane while
   * remaining on the Chat tab. Secondary "Open in Vault" still deep-links.
   */
  const handleCitationClick = useCallback(
    (path: string) => {
      const action = openDocumentPathAction(path, {
        projectVaultPath,
        source: "citation",
      });
      if (action) {
        dispatchPanel(action);
        return;
      }
      // Unresolvable path: fall back to vault tab so the user is not stuck.
      handleOpenInVault(path);
    },
    [handleOpenInVault, projectVaultPath],
  );

  /**
   * Timeline reopen chip (lp-a8u.2): always preview-first after close.
   * Edit remains the existing toolbar flow when gates pass.
   */
  const handleDocumentReopenClick = useCallback(
    (path: string) => {
      const action = openDocumentPathAction(path, {
        projectVaultPath,
        source: "reopen_chip",
        mode: "preview",
      });
      if (action) {
        dispatchPanel(action);
      }
    },
    [projectVaultPath],
  );

  const handlePaneDownload = useCallback(
    (path: string) => {
      void downloadVaultFile(path).catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : "Failed to download file";
        showFailureBanner("Download failed", message);
      });
    },
    [showFailureBanner],
  );

  const handlePaneClose = useCallback(() => {
    dispatchPanel({ type: "PANEL_CLOSE", reason: "user" });
    dispatchSidePane({ type: "SIDE_PANE_CLOSE", reason: "user" });
    // Explicit user close clears this thread's stored pane (lp-vnz.2).
    if (threadId) {
      sidePaneByThreadRef.current.delete(threadId);
    }
  }, [threadId]);

  const handleActivityPaneClose = useCallback(() => {
    const documentStillOpenOnClose =
      panelState.status !== "closed" && panelState.ref != null;
    dispatchSidePane({
      type: "SIDE_PANE_CLOSE",
      reason: "user",
      documentStillOpen: documentStillOpenOnClose,
    });
    // Full close (no stacking restore) clears stored pane; stacking leaves
    // document open in live state so the next switch re-captures correctly.
    if (threadId && !documentStillOpenOnClose) {
      sidePaneByThreadRef.current.delete(threadId);
    }
  }, [panelState.ref, panelState.status, threadId]);

  /**
   * Full job update (instructions) when host advertises cron manage / features.cron.
   * Enable toggle always uses cron.set_enabled and does not require this gate.
   */
  const canEditCronInstructions = useMemo(() => {
    const ui = honesty.ui;
    const caps = honesty.backendCapabilities;
    if (ui?.can?.cron_manage === true) return true;
    if (ui?.affordances?.cron_manager === "supported") return true;
    if (caps?.ui_affordances?.cron_manager === "supported") return true;
    if (caps?.features?.cron === true) return true;
    const methods = caps?.brain_rpc_methods ?? [];
    if (
      methods.includes("cron.update") ||
      methods.includes("cron.patch") ||
      methods.includes("cron.create")
    ) {
      return true;
    }
    // Unknown caps → fail closed for edit (read-only instructions).
    return false;
  }, [honesty.backendCapabilities, honesty.ui]);

  const handleScheduledTaskCronUpdated = useCallback(
    (cron: SettingsCron) => {
      setSettingsSnapshot((prev) => {
        if (!prev) {
          return {
            exported_at: new Date().toISOString(),
            skills: [],
            crons: [cron],
            mcp_servers: [],
            models: [],
            integrations: [],
          };
        }
        const crons = prev.crons.some((c) => c.id === cron.id)
          ? prev.crons.map((c) => (c.id === cron.id ? { ...c, ...cron } : c))
          : [...prev.crons, cron];
        return { ...prev, crons };
      });
    },
    [setSettingsSnapshot],
  );

  /**
   * Open scheduled-task config pane by default when selecting a job stream
   * (lp-lv9.5). Collapsible via side-pane close. Does not re-open after the
   * user collapses while staying on the same thread. Restored activity/document
   * snapshots win over the default.
   */
  useEffect(() => {
    if (!threadId || !activeThread) return;
    if (!isScheduledTaskThread(activeThread)) return;

    const frame = window.requestAnimationFrame(() => {
      if (sidePaneRef.current.mode !== "closed") return;
      dispatchSidePane({
        type: "SIDE_PANE_OPEN_ACTIVITY",
        focus: { kind: "scheduled_task_config" },
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    threadId,
    activeThread?.kind,
    activeThread?.scheduled_job_id,
    activeThread,
  ]);

  /** Concurrent/recent subagent runs for roster + chip identity (lp-dpr.5). */
  const subagentRuns = useMemo(
    () => collectSubagentRunsFromTimeline(items),
    [items],
  );

  /** Concurrent/recent workflow runs for cards + activity tree (lp-dpr.7). */
  const workflowRuns = useMemo(
    () => collectWorkflowRunsFromTimeline(items),
    [items],
  );

  /**
   * Nested tools for the focused subagent detail stream (lp-uxy.1).
   * Only host-attributed tools (parent_subagent_id / subagent_run_id) appear.
   */
  const focusedNestedTools = useMemo(() => {
    if (sidePane.focus.kind !== "subagent") {
      return [];
    }
    return collectNestedToolsForSubagent(items, sidePane.focus.runId);
  }, [items, sidePane.focus]);

  /** Chip click → open activity pane focused on that subagent run. */
  const handleSubagentSelect = useCallback((run: SubagentRun) => {
    dispatchSidePane({
      type: "SIDE_PANE_OPEN_ACTIVITY",
      focus: { kind: "subagent", runId: run.id },
    });
  }, []);

  const handleSourceSelect = useCallback((sources: StackedSource[], selectedUrl?: string) => {
    dispatchSidePane({
      type: "SIDE_PANE_OPEN_ACTIVITY",
      focus: { kind: "sources", sources, selectedUrl },
    });
  }, []);

  /** Workflow card click → open activity pane focused on that workflow. */
  const handleWorkflowSelect = useCallback((run: WorkflowRun) => {
    dispatchSidePane({
      type: "SIDE_PANE_OPEN_ACTIVITY",
      focus: { kind: "workflow", workflowId: run.id },
    });
  }, []);

  const handleRosterSelectRun = useCallback((runId: string) => {
    dispatchSidePane({
      type: "SIDE_PANE_SET_ACTIVITY_FOCUS",
      focus: { kind: "subagent", runId },
    });
  }, []);

  const handleRosterSelectWorkflow = useCallback((workflowId: string) => {
    dispatchSidePane({
      type: "SIDE_PANE_SET_ACTIVITY_FOCUS",
      focus: { kind: "workflow", workflowId },
    });
  }, []);

  const handleShowRoster = useCallback(() => {
    dispatchSidePane({
      type: "SIDE_PANE_SET_ACTIVITY_FOCUS",
      focus: { kind: "roster" },
    });
  }, []);

  const handlePaneReload = useCallback(() => {
    dispatchPanel({ type: "PANEL_RELOAD" });
  }, []);

  /** Open agent checkpoint path (lp-5q6.16). */
  const handlePaneOpenCheckpoint = useCallback(() => {
    dispatchPanel({ type: "PANEL_OPEN_CHECKPOINT" });
  }, []);

  const handlePaneDismissCheckpoint = useCallback(() => {
    dispatchPanel({ type: "PANEL_DISMISS_CHECKPOINT" });
  }, []);

  const handlePaneDiscardLocal = useCallback(() => {
    dispatchPanel({ type: "PANEL_RELOAD", discardLocal: true });
  }, []);

  /** Chat root for container-query-aligned narrow detection (lp-5q6.15). */
  const chatRootRef = useRef<HTMLDivElement>(null);
  // @ contexts: host agents (when advertised) + optional vault file paths.
  // Never seed researcher/writer agent stubs (lp-rt5.6 / grill Q4).
  const [contextItems, setContextItems] = useState<SearchableItem[]>([]);
  /** Full vault tree for soft mode A basename resolve (lp-dpr.2). */
  const [vaultRoots, setVaultRoots] = useState<VaultTreeNode[]>([]);
  const vaultRootsRef = useRef(vaultRoots);
  vaultRootsRef.current = vaultRoots;

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        !isConnectorOAuthMessage(
          event.origin,
          window.location.origin,
          event.data,
        )
      ) {
        return;
      }
      if (event.data.status !== "connected" || !threadId) {
        return;
      }
      // lp-xhf4.16: composer Connect has no wizard session — acknowledge the
      // OAuth success locally and refresh statuses. No-wizard messages with no
      // open thread stay ignored here (SettingsView owns its own listener).
      if (!getConnectorWizard(threadId)) {
        // lp-xhf4.19: no SSE/history carries connector.oauth for this flow —
        // paint the Connected chip straight from the BFF callback postMessage.
        if (
          event.data.connector_id === "google" ||
          event.data.connector_id === "hubspot"
        ) {
          upsertConnectorOAuth({
            connectorId: event.data.connector_id,
            phase: "connected",
            accountLabel: event.data.account_label,
          });
        }
        appendLocalAssistantTurn(
          `${CONNECTOR_LABELS[event.data.connector_id]} connected.`,
        );
        refreshConnectorStatuses();
        return;
      }
      void finishConnectorOAuthSuccess(threadId, event.data.account_label);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [
    appendLocalAssistantTurn,
    finishConnectorOAuthSuccess,
    getConnectorWizard,
    refreshConnectorStatuses,
    threadId,
    upsertConnectorOAuth,
  ]);

  useEffect(() => {
    let cancelled = false;
    void fetchVaultTree()
      .then(({ roots }) => {
        if (cancelled) {
          return;
        }
        // Product-local vault path contexts only — no fake agent stubs.
        setVaultRoots(roots);
        setContextItems(vaultPathsToSearchItems(roots));
      })
      .catch(() => {
        // Vault tree optional; empty inventory means no @ menu (honest empty).
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** + attach menu vault file rows from the loaded tree. */
  const attachVaultFiles = useMemo(
    () => vaultFilesForAttachMenu(vaultRoots),
    [vaultRoots],
  );

  const mailboxMentionTrigger = useMemo(() => {
    const isChannel = activeThread?.kind === "group";
    return buildMailboxMentionTrigger({
      roomKind: isChannel ? "channel" : "dm",
      roomParticipants: isChannel ? (activeThread?.participants ?? []) : [],
      currentAgentId: isChannel ? null : (activeThread?.agent_id ?? null),
      tenantAgents: tenantAgentsFromThreads(threads),
      connectors: connectorStatuses,
    });
  }, [activeThread, connectorStatuses, threads]);

  const composerTriggers = useMemo(
    () =>
      mergeMailboxMentionTrigger(
        buildComposerTriggers({
          skills: skillItems,
          workflows: workflowItems,
        }),
        mailboxMentionTrigger,
      ),
    [skillItems, workflowItems, mailboxMentionTrigger],
  );

  const composerPlaceholder = user?.email
    ? `Hello, ${displayNameFromEmail(user.email)}.`
    : "Message your agent…";

  /** HTTP in flight or open assistant turn — spinner on send, no double-submit. */
  const isResponsePending = useMemo(
    () =>
      isChatResponsePending(items, isSending, {
        // SSE drop used to leave a trailing `sent` user and block Enter forever.
        streamLive: !connectionStatus,
      }),
    [connectionStatus, items, isSending],
  );

  /** Disable composer input when no thread / creating; pending only blocks submit. */
  const composerDisabled = !threadId || isCreatingThread;

  const handleMcqSelect = useCallback(
    async (input: {
      mcqId: string;
      choice: McqChoice;
      promptMessageId?: string;
    }) => {
      if (!threadId) {
        return;
      }

      if (isConnectorChatWizardMcqId(input.mcqId)) {
        const wizard = getConnectorWizard(threadId);
        if (wizard) {
          setMcqDisabled(input.mcqId, true);
          markMcqSelected(input.mcqId, input.choice.id);
          const userId = appendUserMessage(input.choice.label);
          updateUserMessageStatus(userId, "sent");
          setComposerError(null);
          setIsSending(true);
          try {
            const result = applyConnectorWizardChoice(wizard, {
              mcq_id: input.mcqId,
              choice_id: input.choice.id,
            });
            await processConnectorWizardResult(threadId, result);
          } finally {
            setIsSending(false);
          }
          return;
        }
      }

      // Portal-owned scheduled-task wizard (local MCQ — do not forward to agent).
      if (isScheduledTaskWizardMcqId(input.mcqId)) {
        const wizard = getScheduledTaskWizard(threadId);
        if (wizard) {
          setMcqDisabled(input.mcqId, true);
          markMcqSelected(input.mcqId, input.choice.id);
          const userId = appendUserMessage(input.choice.label);
          updateUserMessageStatus(userId, "sent");
          setComposerError(null);
          setIsSending(true);
          try {
            const result = applyWizardMcqSelection(wizard, {
              mcq_id: input.mcqId,
              choice_id: input.choice.id,
              choice_label: input.choice.label,
            });
            await processScheduledTaskWizardResult(threadId, result);
          } finally {
            setIsSending(false);
          }
          return;
        }
      }

      // Portal-owned workflow wizard (lp-khq.8 — local MCQ; create via agent tool).
      if (isWorkflowWizardMcqId(input.mcqId)) {
        const wizard = getWorkflowWizard(threadId);
        if (wizard) {
          setMcqDisabled(input.mcqId, true);
          markMcqSelected(input.mcqId, input.choice.id);
          const userId = appendUserMessage(input.choice.label);
          updateUserMessageStatus(userId, "sent");
          setComposerError(null);
          setIsSending(true);
          try {
            const result = applyWorkflowWizardMcqSelection(wizard, {
              mcq_id: input.mcqId,
              choice_id: input.choice.id,
              choice_label: input.choice.label,
            });
            await processWorkflowWizardResult(threadId, result);
          } finally {
            setIsSending(false);
          }
          return;
        }
      }

      setMcqDisabled(input.mcqId, true);
      markMcqSelected(input.mcqId, input.choice.id);
      retainThreadStream(threadId);
      const userId = appendUserMessage(input.choice.label);
      setComposerError(null);

      try {
        await sendMcqSelection({
          threadId,
          mcqId: input.mcqId,
          choice: input.choice,
          promptMessageId: input.promptMessageId,
        });
        updateUserMessageStatus(userId, "sent");
      } catch (error) {
        setMcqDisabled(input.mcqId, false);
        updateUserMessageStatus(userId, "error");
        showSendFailure(error, "Send failed");
      }
    },
    [
      appendUserMessage,
      getConnectorWizard,
      getScheduledTaskWizard,
      getWorkflowWizard,
      markMcqSelected,
      processConnectorWizardResult,
      processScheduledTaskWizardResult,
      processWorkflowWizardResult,
      retainThreadStream,
      setMcqDisabled,
      showSendFailure,
      threadId,
      updateUserMessageStatus,
    ],
  );

  const handleToolApprovalSelect = useCallback(
    async (input: { approvalId: string; choice: McqChoice }) => {
      const decision = input.choice.id;
      if (
        decision !== "always" &&
        decision !== "approve_this_call" &&
        decision !== "reject"
      ) {
        return;
      }
      markToolApprovalSelected(input.approvalId, input.choice.id);
      try {
        await sendToolApprovalDecision({
          approvalId: input.approvalId,
          decision,
        });
      } catch (error) {
        setToolApprovalDisabled(input.approvalId, false);
        showSendFailure(error, "Approval failed");
      }
    },
    [
      markToolApprovalSelected,
      setToolApprovalDisabled,
      showSendFailure,
    ],
  );

  const handleUpload = useCallback(
    async (file: File) => {
      setComposerError(null);
      try {
        const record = await uploadStagingFile({
          file,
          projectVaultPath: projectVaultPath ?? undefined,
        });
        setPendingStagingPaths((current) => [...current, record.path]);
      } catch (error) {
        setComposerError(
          error instanceof Error ? error.message : "Upload failed",
        );
      }
    },
    [projectVaultPath],
  );

  /** Resend a failed user message without duplicating the bubble. */
  const handleRetryUserMessage = useCallback(
    async (userMessageId: string) => {
      if (!threadId || isResponsePending) {
        return;
      }
      const userItem = items.find(
        (item) => item.type === "user" && item.id === userMessageId,
      );
      if (!userItem || userItem.type !== "user") {
        return;
      }
      if (userItem.status !== "error") {
        return;
      }

      setComposerError(null);
      setIsSending(true);
      updateUserMessageStatus(userMessageId, "sending");
      retainThreadStream(threadId);
      try {
        await sendChatAndNoteStarting({ threadId, text: userItem.content });
        updateUserMessageStatus(userMessageId, "sent");
      } catch (error) {
        updateUserMessageStatus(userMessageId, "error");
        showSendFailure(error, "Send failed");
      } finally {
        setIsSending(false);
      }
    },
    [
      isResponsePending,
      items,
      retainThreadStream,
      sendChatAndNoteStarting,
      showSendFailure,
      threadId,
      updateUserMessageStatus,
    ],
  );

  const handleCancelResponse = useCallback(async () => {
    if (!threadId || isCancelling || !isResponsePending) {
      return;
    }
    setIsCancelling(true);
    try {
      await cancelChatRequest(threadId);
      haltOpenAssistantTurn("Cancelled");
      setIsSending(false);
    } catch (error) {
      // Still halt local UI so the spinner does not stick forever.
      haltOpenAssistantTurn("Cancelled");
      setIsSending(false);
      const message =
        error instanceof Error ? error.message : "Cancel failed";
      showFailureBanner("Could not stop Hermes", message);
    } finally {
      setIsCancelling(false);
    }
  }, [
    haltOpenAssistantTurn,
    isCancelling,
    isResponsePending,
    showFailureBanner,
    threadId,
  ]);

  const handleComposerSubmit = useCallback(
    async (text: string) => {
      if (!text || !threadId) {
        return;
      }

      // While a Portal wizard is open, free-text steps / cancel take priority.
      const activeScheduledWizard = getScheduledTaskWizard(threadId);
      const activeWorkflowWizard = getWorkflowWizard(threadId);
      const activeWizard = activeScheduledWizard ?? activeWorkflowWizard;
      if (!activeWizard && isResponsePending) {
        return;
      }

      setComposerError(null);

      // --- Scheduled-task wizard steps (Portal-owned; tool action=setup) ---
      if (activeScheduledWizard) {
        setMessageText("");
        const userId = appendUserMessage(text);
        updateUserMessageStatus(userId, "sent");

        if (isWizardCancelText(text)) {
          setScheduledTaskWizard(threadId, {
            ...activeScheduledWizard,
            step: "cancelled",
            activeMcq: null,
            statusMessage: "Cancelled",
          });
          appendLocalAssistantTurn("Cancelled — no scheduled task created.");
          return;
        }

        if (
          wizardStepNeedsFreeText(
            activeScheduledWizard.step,
            activeScheduledWizard.activeMcq,
          )
        ) {
          setIsSending(true);
          try {
            const result = applyWizardTextInput(activeScheduledWizard, text);
            await processScheduledTaskWizardResult(threadId, result);
          } finally {
            setIsSending(false);
          }
          return;
        }

        // Waiting on MCQ chips — free text is not a schedule input.
        appendLocalAssistantTurn(
          "Please choose one of the options above, or type **cancel** to exit the wizard.",
        );
        return;
      }

      // --- Workflow wizard steps (unreachable from product chrome; lp-v62i.2.1) ---
      if (activeWorkflowWizard) {
        setMessageText("");
        const userId = appendUserMessage(text);
        updateUserMessageStatus(userId, "sent");

        if (isWizardCancelText(text)) {
          setWorkflowWizard(threadId, {
            ...activeWorkflowWizard,
            step: "cancelled",
            activeMcq: null,
            statusMessage: "Cancelled",
          });
          appendLocalAssistantTurn("Cancelled — no workflow created.");
          return;
        }

        if (
          workflowWizardStepNeedsFreeText(
            activeWorkflowWizard.step,
            activeWorkflowWizard.activeMcq,
          )
        ) {
          setIsSending(true);
          try {
            const result = applyWorkflowWizardTextInput(
              activeWorkflowWizard,
              text,
            );
            await processWorkflowWizardResult(threadId, result);
          } finally {
            setIsSending(false);
          }
          return;
        }

        appendLocalAssistantTurn(
          "Please choose one of the options above, or type **cancel** to exit the wizard.",
        );
        return;
      }
      // ---------------------------------------------------------------------

      setMessageText("");
      setIsSending(true);
      // Keep SSE open if the user switches chats while this response streams.
      retainThreadStream(threadId);
      // lp-bhcg.20: omit a user-chosen model. LiteLLM routing stays server-side.
      const userId = appendUserMessage(text);

      // Soft mode A (lp-dpr.2): first office path/basename reference opens the
      // chat document pane without requiring open/work verbs (e.g. Summarize
      // /Business/.../MSA.docx). Unique basenames resolve via vault tree.
      // Structured citation lists still skip auto-open (skipCitationAutoOpen).
      const intent = detectChatOpenDocumentIntent(text);
      let rootsForResolve = vaultRootsRef.current;
      if (intent?.isBasename && rootsForResolve.length === 0) {
        try {
          const tree = await fetchVaultTree();
          rootsForResolve = tree.roots;
          setVaultRoots(tree.roots);
          setContextItems(vaultPathsToSearchItems(tree.roots));
        } catch {
          // Leave empty — basename resolve fails closed (no pane open).
        }
      }
      const openIntentAction = openDocumentIntentFromUserMessage(text, {
        projectVaultPath,
        source: "deep_link",
        resolveBasename: (name) => findVaultTreeFilePath(rootsForResolve, name),
      });
      if (openIntentAction) {
        dispatchPanel(openIntentAction);
      }

      const stagingPaths = [...pendingStagingPaths];
      try {
        await sendChatAndNoteStarting({
          threadId,
          text,
          stagingPaths,
        });
        setPendingStagingPaths([]);
        updateUserMessageStatus(userId, "sent");
        void renameThreadFromFirstMessage(text);
        // lp-lv9.4: purpose auto-generate after early interactive turns.
        void maybeAssignSystemPromptFromTurns([text]);
      } catch (error) {
        updateUserMessageStatus(userId, "error");
        showSendFailure(error, "Send failed");
      } finally {
        setIsSending(false);
      }
    },
    [
      appendLocalAssistantTurn,
      appendUserMessage,
      getScheduledTaskWizard,
      getWorkflowWizard,
      isResponsePending,
      pendingStagingPaths,
      processScheduledTaskWizardResult,
      processWorkflowWizardResult,
      projectVaultPath,
      renameThreadFromFirstMessage,
      maybeAssignSystemPromptFromTurns,
      retainThreadStream,
      sendChatAndNoteStarting,
      setScheduledTaskWizard,
      setWorkflowWizard,
      showSendFailure,
      threadId,
      updateUserMessageStatus,
    ],
  );

  const composer = (
    <ChatComposer
      value={messageText}
      onChange={(next) => {
        setMessageText(next);
      }}
      onSubmit={(value) => void handleComposerSubmit(value)}
      placeholder={composerPlaceholder}
      isDisabled={composerDisabled}
      density="spacious"
      status={
        composerError
          ? { type: "error", message: composerError }
          : connectionStatus
            ? { type: "error", message: connectionStatus }
            : undefined
      }
      drawer={
        pendingStagingPaths.length > 0 ? (
          <ChatComposerDrawer
            count={pendingStagingPaths.length}
            label="Attachments"
          >
            <HStack gap={1} wrap="wrap">
              {pendingStagingPaths.map((path) => {
                const name = path.split("/").pop() ?? path;
                return (
                  <Token
                    key={path}
                    label={name}
                    icon={
                      <Icon icon={fileTypeIcon(name)} size="xsm" />
                    }
                  />
                );
              })}
            </HStack>
          </ChatComposerDrawer>
        ) : undefined
      }
      footerActions={
        <>
          <input
            ref={uploadInputRef}
            type="file"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) {
                void handleUpload(file);
              }
            }}
          />
          {/* lp-khq.12.3: single + in former paperclip slot; Attach file is in menu */}
          <ComposerAttachMenu
            skills={attachSkills}
            vaultFiles={attachVaultFiles}
            vaultTree={vaultRoots}
            composerValue={messageText}
            onComposerChange={handleAttachComposerChange}
            onAttachFile={handleAttachFileFromMenu}
            // lp-xhf4.16: Connectors group — in-chat OAuth / WhatsApp QR.
            connectorActions={connectorActions}
            onConnectConnector={handleComposerConnectConnector}
            isDisabled={composerDisabled}
          />
        </>
      }
      input={<ChatComposerInput triggers={composerTriggers} />}
      sendButton={
        <ChatSendButton
          // Keep send control enabled while pending so spinner is not faded by
          // disabled styles; submit still gated by isResponsePending.
          // isStopShown + onStop = Hermes Esc equivalent (interrupt_inbound).
          isDisabled={
            composerDisabled ||
            isCancelling ||
            (!isResponsePending && !messageText.trim())
          }
          isStopShown={isResponsePending}
          onStop={() => {
            void handleCancelResponse();
          }}
          stopIcon={
            <Spinner
              size="sm"
              shade="inherit"
              aria-label="Waiting for response — click to stop"
            />
          }
        />
      }
    />
  );

  return (
    <div
      ref={chatRootRef}
      style={chatRootStyle}
      data-testid="chat-document-pane-root"
    >
      <VStack style={{ height: "100%", minHeight: 0, width: "100%" }}>
        <Layout
          height="fill"
          content={
            <LayoutContent padding={0}>
              <HStack style={chatSplitRowStyle} height="100%">
                <VStack style={chatColumnStyle}>
                  {activeThread ? (
                    <AgentChatHeader
                      thread={activeThread}
                      canRename={
                        activeThread.access === undefined ||
                        activeThread.access === "owner" ||
                        activeThread.access === null
                      }
                      onRename={(nextTitle) =>
                        renameThread(activeThread.thread_id, nextTitle)
                      }
                      canEditSystemPrompt={
                        activeThread.kind !== "scheduled_task" &&
                        // Channels keep lead/members/purposes behind the
                        // header title sheet, not the editor (lp-cxhb.15.2).
                        activeThread.kind !== "group" &&
                        (activeThread.access === undefined ||
                          activeThread.access === "owner" ||
                          activeThread.access === null)
                      }
                      onSaveSystemPrompt={(nextPrompt) =>
                        updateThreadSystemPrompt(
                          activeThread.thread_id,
                          nextPrompt,
                        )
                      }
                    />
                  ) : null}
                  <ChatLayout
                    density="spacious"
                    style={chatLayoutStyle}
                    composer={composer}
                    emptyState={
                      <Text type="body" color="secondary">
                        {isCreatingThread
                          ? "Creating chat thread…"
                          : "Send a message to start the conversation."}
                      </Text>
                    }
                  >
                    <ChatTimeline
                      items={items}
                      toolProgress={toolProgress}
                      threadKind={activeThread?.kind}
                      agentStarting={agentWakeStatus?.kind === "starting"}
                      agentStartingMessage={
                        agentWakeStatus?.kind === "starting"
                          ? agentWakeStatus.message
                          : AGENT_STARTING_MESSAGE
                      }
                      onMcqSelect={(input) => void handleMcqSelect(input)}
                      onToolApprovalSelect={(input) =>
                        void handleToolApprovalSelect(input)
                      }
                      onCitationClick={handleCitationClick}
                      onRetryUserMessage={(id) => void handleRetryUserMessage(id)}
                      onSubagentSelect={handleSubagentSelect}
                      onWorkflowSelect={handleWorkflowSelect}
                      onSourceSelect={handleSourceSelect}
                      projectVaultPath={projectVaultPath}
                      documentReopenChips={documentReopenChips}
                      onDocumentReopenClick={handleDocumentReopenClick}
                    />
                  </ChatLayout>
                </VStack>
                {/*
                  Single side chrome (lp-dpr.4): document | activity | closed.
                  Hosts stay mounted so visible→false runs focus restore
                  (lp-5q6.15). Document chrome is gated via `active` while
                  artifact panel state is retained for stacking restore.
                  Portal keep-alive also gates both hosts with isActive so
                  drawer Dialogs release showModal when leaving Chat (lp-vnz.1).
                */}
                <DocumentPaneHost
                  state={panelState}
                  content={paneContent}
                  isLoading={paneLoading}
                  active={isActive && sidePane.mode === "document"}
                  onClose={handlePaneClose}
                  onReload={handlePaneReload}
                  onOpenInVault={handleOpenInVault}
                  onDownload={handlePaneDownload}
                  onOpenCheckpoint={handlePaneOpenCheckpoint}
                  onDismissCheckpoint={handlePaneDismissCheckpoint}
                  onDiscardLocal={handlePaneDiscardLocal}
                  currentnessChrome={{
                    currentness: paneCurrentness.currentness,
                    staleDecision: paneCurrentness.staleDecision,
                    historyOpen: paneCurrentness.historyOpen,
                    onToggleHistory: () =>
                      paneCurrentness.setHistoryOpen(
                        !paneCurrentness.historyOpen,
                      ),
                    historyEvents: paneCurrentness.historyEvents,
                    historyLoading: paneCurrentness.isLoadingHistory,
                    historyError: paneCurrentness.historyError,
                    historyUnavailable: paneCurrentness.historyUnavailable,
                    historyTruncated: paneCurrentness.history?.truncated,
                  }}
                  officeEditor={
                    officeEditor.active
                      ? {
                          active: true,
                          session: officeEditor.session,
                          error: officeEditor.error,
                          isLoading: officeEditor.isLoading,
                          onDirtyChange: handlePaneDirty,
                          // Office-only: editor close dismisses the pane (no Back to preview).
                          onRequestClose: handlePaneClose,
                        }
                      : null
                  }
                  editControls={
                    // Office-only (lp-swt.2): showEdit/showExitEdit always false when
                    // OnlyOffice is active or gates fail — no dual-mode chrome.
                    rendererDecision.showEdit ||
                    rendererDecision.showExitEdit
                      ? {
                          showEdit: rendererDecision.showEdit,
                          showExitEdit: rendererDecision.showExitEdit,
                          onRequestEdit: handlePaneRequestEdit,
                          onExitEdit: handlePaneExitEdit,
                        }
                      : null
                  }
                  containerRef={chatRootRef}
                  layoutPreference={sidePaneLayoutPreference}
                />
                <ActivityPaneHost
                  state={sidePane}
                  active={isActive}
                  onClose={handleActivityPaneClose}
                  containerRef={chatRootRef}
                  layoutPreference={sidePaneLayoutPreference}
                >
                  {sidePane.focus.kind === "scheduled_task_config" ? (
                    <ScheduledTaskConfigPane
                      jobId={scheduledJobId ?? ""}
                      cron={scheduledTaskCron}
                      canEditInstructions={canEditCronInstructions}
                      onCronUpdated={handleScheduledTaskCronUpdated}
                    />
                  ) : sidePane.focus.kind === "workflow" ? (
                    <WorkflowTree
                      workflows={workflowRuns}
                      subagents={subagentRuns}
                      focus={sidePane.focus}
                      onSelectWorkflow={handleRosterSelectWorkflow}
                      onSelectSubagent={handleRosterSelectRun}
                      onShowRoster={handleShowRoster}
                    />
                  ) : sidePane.focus.kind === "sources" ? (
                    <SourcesRoster
                      sources={sidePane.focus.sources}
                      selectedUrl={sidePane.focus.selectedUrl}
                      onBack={handleShowRoster}
                      onSelect={(url) =>
                        dispatchSidePane({
                          type: "SIDE_PANE_SET_ACTIVITY_FOCUS",
                          focus: { kind: "sources", sources: sidePane.focus.kind === "sources" ? sidePane.focus.sources : [], selectedUrl: url },
                        })
                      }
                    />
                  ) : (
                    <SubagentRoster
                      runs={subagentRuns}
                      workflows={workflowRuns}
                      focus={sidePane.focus}
                      onSelectRun={handleRosterSelectRun}
                      onSelectWorkflow={handleRosterSelectWorkflow}
                      onShowRoster={handleShowRoster}
                      nestedTools={focusedNestedTools}
                      onOpenArtifact={handleCitationClick}
                      projectVaultPath={projectVaultPath}
                    />
                  )}
                </ActivityPaneHost>
              </HStack>
            </LayoutContent>
          }
        />
        {failureBanner ? (
          <div className="chat-failure-banner" role="status">
            <Banner
              status="error"
              title={failureBanner.title}
              description={failureBanner.description}
              isDismissable
              onDismiss={() => setFailureBanner(null)}
            />
          </div>
        ) : null}
      </VStack>
    </div>
  );
}
