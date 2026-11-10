import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Button } from "@astryxdesign/core/Button";
import {
  Dialog,
  DialogHeader,
} from "@astryxdesign/core/Dialog";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import {
  Layout,
  LayoutFooter,
} from "@astryxdesign/core/Layout";
import {
  SideNav,
  SideNavItem,
  useSideNavCollapse,
} from "@astryxdesign/core/SideNav";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import {
  CalendarIcon,
  ChatBubbleLeftRightIcon,
  PlusIcon,
  UserGroupIcon,
  UserIcon,
} from "@heroicons/react/24/outline";

import type { ChatThreadSummary } from "../../api/types.js";

import { useOptionalSettingsSnapshot } from "../settings/SettingsSnapshotContext.js";
import { AgentSideNavRow } from "./AgentSideNavRow.js";
import { ChannelSideNavRow } from "./ChannelSideNavRow.js";
import { useChatThread } from "./ChatThreadContext.js";
import {
  indexCronsByJobId,
  resolveScheduledTaskSideNavStatus,
} from "./scheduledTaskStatus.js";
import { NewChannelDialog } from "./NewChannelDialog.js";
import { ShareThreadDialog } from "./ShareThreadDialog.js";
import {
  isChannelThread,
  isScheduledTaskThread,
  visibleScheduledTaskThreads,
  type ThreadGroupKind,
  type ThreadProjectGroup,
} from "./threadGroups.js";

/**
 * Confirm copy for agent project soft-archive (Brain RPC projects.delete).
 * Must match host semantics: registry unlist only; workspace/vault files stay
 * on agent disk (lp-uxy.5). No purge/rmtree wording.
 */
export function projectSoftArchiveConfirmMessage(projectName: string): string {
  return (
    `Remove project “${projectName}” from Directory? ` +
    `This only archives the project registry entry — it leaves the list. ` +
    `Workspace and vault files stay on the agent disk (not deleted).`
  );
}

/** Owner-only actions (Share / Delete). Shared-with-me threads use read/collaborate. */
function isOwnerAccess(access: ChatThreadSummary["access"]): boolean {
  return access === undefined || access === "owner" || access === null;
}

const SIDE_NAV_RESIZE = {
  defaultWidth: 260,
  minWidth: 200,
  maxWidth: 360,
} as const;

type ChatHistorySideNavProps = {
  /** When true, omit collapsible/resizable (mobile drawer content). */
  embedded?: boolean;
};

/**
 * Confirm chat delete (replaces window.confirm). Cancel closes without
 * calling delete; Delete runs the context/API delete path (lp-pxr.1).
 */
function DeleteChatDialog({
  isOpen,
  onOpenChange,
  threadTitle,
  onConfirm,
  isDeleting = false,
  isChannel = false,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  threadTitle?: string;
  onConfirm: () => void;
  isDeleting?: boolean;
  isChannel?: boolean;
}) {
  const title = isChannel ? "Delete channel?" : "Delete agent?";
  const subtitle = isChannel
    ? threadTitle
      ? `“${threadTitle}” will be removed. Agents and their 1:1s stay.`
      : "This channel will be removed. Agents and their 1:1s stay."
    : threadTitle
      ? `“${threadTitle}” will be permanently removed. They leave every channel (a channel left with fewer than two members is deleted), and their scheduled tasks are unbound. This cannot be undone.`
      : "This agent will be permanently removed. They leave every channel (a channel left with fewer than two members is deleted), and their scheduled tasks are unbound. This cannot be undone.";

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      purpose="form"
      width={400}
    >
      <Layout
        header={
          <DialogHeader
            title={title}
            subtitle={subtitle}
            onOpenChange={onOpenChange}
          />
        }
        footer={
          <LayoutFooter>
            <HStack gap={2} hAlign="end">
              <Button
                label="Cancel"
                variant="secondary"
                size="sm"
                isDisabled={isDeleting}
                onClick={() => onOpenChange(false)}
              />
              <Button
                label="Delete"
                variant="destructive"
                size="sm"
                isLoading={isDeleting}
                onClick={onConfirm}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}

/**
 * Unified create control: single + opens menu with Agent / Channel.
 * Agents create schedules via tools; Jack does not (lp-v62i.2.1).
 * Accessible name is "New Agent".
 */
function CreateMenuButton({
  isCreatingThread,
  startNewThread,
  onNewChannel,
}: {
  isCreatingThread: boolean;
  startNewThread: () => Promise<void>;
  onNewChannel: () => void;
}) {
  return (
    <DropdownMenu
      data-testid="create-menu"
      hasChevron={false}
      button={{
        label: "New Agent",
        variant: "secondary",
        size: "sm",
        isIconOnly: true,
        icon: <Icon icon={PlusIcon} size="sm" />,
        isLoading: isCreatingThread,
        "aria-label": "New Agent",
      }}
      items={[
        {
          label: "Agent",
          onClick: () => {
            // Catalog + the one 1:1 (lp-cxhb.4). Does not clone an existing person.
            void startNewThread();
          },
        },
        {
          label: "Channel",
          onClick: onNewChannel,
        },
      ]}
    />
  );
}

function ChatSideNavTopContent({
  forceExpanded = false,
}: {
  forceExpanded?: boolean;
}) {
  const {
    startNewThread,
    isCreatingThread,
    refreshThreads,
    selectThread,
  } = useChatThread();
  const { isCollapsed } = useSideNavCollapse();
  const collapsed = forceExpanded ? false : isCollapsed;
  const [channelOpen, setChannelOpen] = useState(false);

  const createMenu = (
    <CreateMenuButton
      isCreatingThread={isCreatingThread}
      startNewThread={startNewThread}
      onNewChannel={() => setChannelOpen(true)}
    />
  );

  const channelDialog = (
    <NewChannelDialog
      isOpen={channelOpen}
      onOpenChange={setChannelOpen}
      onCreated={async (channel) => {
        await refreshThreads();
        selectThread(channel.thread_id);
      }}
    />
  );

  if (collapsed) {
    return (
      <VStack gap={2} align="center">
        {createMenu}
        {channelDialog}
      </VStack>
    );
  }

  return (
    <VStack gap={2}>
      {createMenu}
      {channelDialog}
    </VStack>
  );
}

function folderGlyph(
  testId: string,
  icon: typeof UserIcon,
): ReactNode {
  return (
    <span data-testid={testId} style={{ display: "inline-flex" }} aria-hidden>
      <Icon icon={icon} size="sm" />
    </span>
  );
}

function groupFolderIcon(group: ThreadProjectGroup) {
  if (group.kind === "scheduled_tasks") {
    return folderGlyph("scheduled-tasks-folder-icon", CalendarIcon);
  }
  if (group.kind === "channels") {
    return folderGlyph("channels-folder-icon", UserGroupIcon);
  }
  return folderGlyph("agents-folder-icon", UserIcon);
}

function groupHref(group: ThreadProjectGroup): string {
  if (group.kind === "scheduled_tasks") {
    return "#scheduled-tasks";
  }
  if (group.kind === "channels") {
    return "#channels";
  }
  return "#agents";
}

function groupTestId(group: ThreadProjectGroup): string {
  if (group.kind === "scheduled_tasks") {
    return "scheduled-tasks-folder";
  }
  if (group.kind === "channels") {
    return "channels-folder";
  }
  return "agents-folder";
}

function groupEmptyLabel(group: ThreadProjectGroup): string {
  if (group.kind === "scheduled_tasks") {
    return "No scheduled tasks yet";
  }
  if (group.kind === "channels") {
    return "No channels yet";
  }
  return "No agents yet";
}

/**
 * Whether a sidenav group row should appear selected.
 * Scheduled Tasks highlights when the active thread is a job stream.
 * Channels highlights for `kind=group`. Agents highlights for 1:1s.
 */
export function isThreadGroupSelected(
  group: Pick<ThreadProjectGroup, "kind">,
  activeThread: ChatThreadSummary | null | undefined,
): boolean {
  if (group.kind === "scheduled_tasks") {
    return Boolean(activeThread && isScheduledTaskThread(activeThread));
  }
  if (group.kind === "channels") {
    return Boolean(activeThread && isChannelThread(activeThread));
  }
  if (
    activeThread &&
    (isScheduledTaskThread(activeThread) || isChannelThread(activeThread))
  ) {
    return false;
  }
  return Boolean(activeThread);
}

/**
 * IA section folder row (Channels / Agents / Scheduled Tasks).
 * No project delete. ⋯ is not shown on folders.
 */
function ProjectSideNavItem({
  label,
  href,
  icon,
  isSelected,
  onSelect,
  children,
  testId,
  collapsible = true,
}: {
  label: string;
  groupKind: ThreadGroupKind;
  href: string;
  icon: ReactNode;
  isSelected: boolean;
  onSelect: () => void;
  children: ReactNode;
  testId?: string;
  collapsible?:
    | boolean
    | {
        defaultIsCollapsed?: boolean;
        isCollapsed?: boolean;
        onCollapsedChange?: (isCollapsed: boolean) => void;
      };
}) {
  return (
    <SideNavItem
      label={label}
      icon={icon}
      collapsible={collapsible}
      isSelected={isSelected}
      href={href}
      data-testid={testId}
      onClick={(event) => {
        event.preventDefault();
        onSelect();
      }}
    >
      {children}
    </SideNavItem>
  );
}

export function ChatHistorySideNav({ embedded = false }: ChatHistorySideNavProps) {
  const {
    threadId,
    threads,
    threadGroups,
    selectThread,
    isLoadingThreads,
    statusMessage,
    deleteThread,
    renameThread,
    threadResponseStatuses,
    threadActivityPreviews,
    scheduledTasksFolderExpandRequestId,
  } = useChatThread();
  const settingsSnapshot = useOptionalSettingsSnapshot();
  const cronsById = useMemo(
    () => indexCronsByJobId(settingsSnapshot?.snapshot?.crons),
    [settingsSnapshot?.snapshot?.crons],
  );
  const [shareThread, setShareThread] = useState<ChatThreadSummary | null>(
    null,
  );
  const [deleteThreadTarget, setDeleteThreadTarget] =
    useState<ChatThreadSummary | null>(null);
  const [isDeletingThread, setIsDeletingThread] = useState(false);
  const [scheduledTasksCollapsed, setScheduledTasksCollapsed] = useState(false);

  useEffect(() => {
    if (scheduledTasksFolderExpandRequestId > 0) {
      setScheduledTasksCollapsed(false);
    }
  }, [scheduledTasksFolderExpandRequestId]);

  useEffect(() => {
    if (!threadId) {
      return;
    }
    const active = threads.find((thread) => thread.thread_id === threadId);
    if (active && isScheduledTaskThread(active)) {
      setScheduledTasksCollapsed(false);
    }
  }, [threadId, threads]);

  useEffect(() => {
    if (!threadId) {
      return;
    }
    const active = threads.find((thread) => thread.thread_id === threadId);
    if (!active || !isScheduledTaskThread(active)) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const el = document.querySelector(
        `[data-testid="agent-side-nav-row-${threadId}"]`,
      );
      if (el && "scrollIntoView" in el) {
        (el as HTMLElement).scrollIntoView({ block: "nearest" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [threadId, threads]);

  const handleRequestDeleteThread = (thread: ChatThreadSummary) => {
    setDeleteThreadTarget(thread);
  };

  const handleConfirmDeleteThread = () => {
    if (!deleteThreadTarget) {
      return;
    }
    const id = deleteThreadTarget.thread_id;
    setIsDeletingThread(true);
    void deleteThread(id).finally(() => {
      setIsDeletingThread(false);
      setDeleteThreadTarget(null);
    });
  };

  const activeThread =
    threads.find((thread) => thread.thread_id === threadId) ?? null;

  const selectedAgentId =
    activeThread && !isChannelThread(activeThread)
      ? activeThread.agent_id ?? null
      : null;

  const groups = threadGroups.map((group) => {
    const isScheduled = group.kind === "scheduled_tasks";
    const emptyLabel = groupEmptyLabel(group);
    const rows = isScheduled
      ? visibleScheduledTaskThreads(group.threads, selectedAgentId)
      : group.threads;
    return (
      <ProjectSideNavItem
        key={group.key}
        label={group.name}
        groupKind={group.kind}
        href={groupHref(group)}
        icon={groupFolderIcon(group)}
        isSelected={isThreadGroupSelected(group, activeThread)}
        collapsible={
          isScheduled
            ? {
                isCollapsed: scheduledTasksCollapsed,
                onCollapsedChange: setScheduledTasksCollapsed,
              }
            : true
        }
        testId={groupTestId(group)}
        onSelect={() => {
          // IA folders are not vault projects — clicking does not rebind cwd.
        }}
      >
        {rows.length === 0 ? (
          <SideNavItem
            label={emptyLabel}
            isDisabled
            icon={isScheduled ? undefined : ChatBubbleLeftRightIcon}
          />
        ) : (
          rows.map((thread) => {
            const canManage = isOwnerAccess(thread.access);
            const liveStatus = threadResponseStatuses[thread.thread_id];
            // lp-cxhb.15.1: channels render as "#name" only — no avatar,
            // no recency subtitle. Agent / scheduled-task rows unchanged.
            if (isChannelThread(thread)) {
              return (
                <ChannelSideNavRow
                  key={thread.thread_id}
                  thread={thread}
                  isSelected={thread.thread_id === threadId}
                  status={liveStatus}
                  canManage={canManage}
                  onSelect={() => selectThread(thread.thread_id)}
                  onShare={() => setShareThread(thread)}
                  onDelete={() => handleRequestDeleteThread(thread)}
                  onRename={
                    canManage
                      ? (nextTitle) => renameThread(thread.thread_id, nextTitle)
                      : undefined
                  }
                />
              );
            }
            const status = isScheduledTaskThread(thread)
              ? resolveScheduledTaskSideNavStatus({
                  liveStatus,
                  scheduledJobId: thread.scheduled_job_id,
                  cronsById,
                })
              : liveStatus;
            return (
              <AgentSideNavRow
                key={thread.thread_id}
                thread={thread}
                isSelected={thread.thread_id === threadId}
                status={status}
                canManage={canManage}
                onSelect={() => selectThread(thread.thread_id)}
                onShare={() => setShareThread(thread)}
                onDelete={() => handleRequestDeleteThread(thread)}
                onRename={
                  canManage
                    ? (nextTitle) => renameThread(thread.thread_id, nextTitle)
                    : undefined
                }
                lastActivity={
                  threadActivityPreviews[thread.thread_id] ?? null
                }
              />
            );
          })
        )}
      </ProjectSideNavItem>
    );
  });

  const body = (
    <>
      {isLoadingThreads && threads.length === 0 ? (
        <Text type="supporting" color="secondary">
          Loading chats…
        </Text>
      ) : null}
      {groups}
      {statusMessage ? (
        <Text type="supporting" color="secondary" aria-live="polite">
          {statusMessage}
        </Text>
      ) : null}
    </>
  );

  const dialog = (
    <>
      <ShareThreadDialog
        isOpen={shareThread !== null}
        onOpenChange={(open) => {
          if (!open) {
            setShareThread(null);
          }
        }}
        threadId={shareThread?.thread_id ?? ""}
        threadTitle={shareThread?.title || undefined}
      />
      <DeleteChatDialog
        isOpen={deleteThreadTarget !== null}
        onOpenChange={(open) => {
          if (!open && !isDeletingThread) {
            setDeleteThreadTarget(null);
          }
        }}
        threadTitle={deleteThreadTarget?.title || undefined}
        onConfirm={handleConfirmDeleteThread}
        isDeleting={isDeletingThread}
        isChannel={Boolean(
          deleteThreadTarget && isChannelThread(deleteThreadTarget),
        )}
      />
    </>
  );

  if (embedded) {
    return (
      <>
        <VStack gap={3}>
          <ChatSideNavTopContent forceExpanded />
          <SideNav aria-label="Chat history">{body}</SideNav>
        </VStack>
        {dialog}
      </>
    );
  }

  return (
    <>
      <SideNav
        collapsible
        resizable={SIDE_NAV_RESIZE}
        aria-label="Chat history"
        topContent={<ChatSideNavTopContent />}
      >
        {body}
      </SideNav>
      {dialog}
    </>
  );
}
