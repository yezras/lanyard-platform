/**
 * 2-line agent row for chat history SideNav (lp-fn5.3.2 / lp-fn5.3.3).
 *
 * SideNavItem is single-label only — this custom row shows:
 *   line 1: agent display name (ellipsis; double-click / MoreMenu rename)
 *   line 2: subtitle (last activity preview or truncated activity proxy)
 * Owned agents use DitherAvatar from avatar_seed (no chat bubble icon).
 */

import { useCallback, useState, type ReactNode } from "react";

import { Badge } from "@astryxdesign/core/Badge";
import { HStack } from "@astryxdesign/core/HStack";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { Stack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import {
  PencilSquareIcon,
  ShareIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";

import { resolveAvatarSeed } from "../../api/threadMeta.js";
import type { ChatThreadSummary } from "../../api/types.js";
import { DitherAvatar } from "../chat/DitherAvatar.js";

import { AgentTitleEditor } from "./AgentTitleEditor.js";
import {
  isChannelThread,
  isScheduledTaskThread,
  truncateThreadTitle,
} from "./threadGroups.js";
import {
  statusDotFromThreadStatus,
  type AgentSideNavStatus,
} from "./threadResponseStatus.js";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * Format created_at as a short UTC activity proxy ("Jul 1") for line 2 when
 * no last-message preview is available on the summary yet.
 */
export function formatCreatedActivitySubtitle(createdAt: string): string {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * Subtitle for agent rows: prefer last activity / message preview when
 * provided; otherwise fall back to truncated created activity.
 * Uses the same truncation helper as auto titles.
 */
export function agentSideNavSubtitle(
  thread: Pick<ChatThreadSummary, "created_at">,
  lastActivity?: string | null,
): string {
  const activity = lastActivity?.trim();
  if (activity) {
    return truncateThreadTitle(activity);
  }
  return formatCreatedActivitySubtitle(thread.created_at);
}

export type AgentSideNavRowProps = {
  thread: ChatThreadSummary;
  isSelected: boolean;
  /**
   * Session or composite status. Scheduled-task rows may receive `"off"`
   * (disabled job) from the composite mapper (lp-lv9.2).
   */
  status: AgentSideNavStatus | undefined;
  canManage: boolean;
  onSelect: () => void;
  onShare: () => void;
  onDelete: () => void;
  /**
   * Explicit user rename (sidebar double-click / MoreMenu).
   * Caller PATCHes with title_source=user.
   */
  onRename?: (nextTitle: string) => void | Promise<void>;
  /**
   * Optional last user-message / activity preview for line 2.
   * When omitted, uses created_at activity proxy.
   */
  lastActivity?: string | null;
};

function sharedAccessLabel(
  access: ChatThreadSummary["access"],
): string | null {
  if (access === "read") {
    return "Read";
  }
  if (access === "collaborate") {
    return "Collaborate";
  }
  return null;
}

/**
 * Custom agent SideNav row: dither (owned) or share icon (invitee) + 2-line text.
 * Job streams under Scheduled Tasks omit the leading glyph (lp-fn5.5.2).
 */
export function AgentSideNavRow({
  thread,
  isSelected,
  status,
  canManage,
  onSelect,
  onShare,
  onDelete,
  onRename,
  lastActivity,
}: AgentSideNavRowProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [requestEdit, setRequestEdit] = useState(false);
  const showMenu = canManage && (isHovered || isMenuOpen);
  const title = thread.title || "New chat";
  const subtitle = agentSideNavSubtitle(thread, lastActivity);
  const statusDot = statusDotFromThreadStatus(status);
  const isShared = !canManage;
  const accessLabel = isShared ? sharedAccessLabel(thread.access) : null;
  const seed = resolveAvatarSeed(thread);
  const canRename = Boolean(canManage && onRename);
  const isJobStream = isScheduledTaskThread(thread);
  /** Explicit Off: dim the row so disabled jobs never read as failed (lp-lv9.2). */
  const isJobOff = isJobStream && status === "off";

  const handleRequestEditConsumed = useCallback(() => {
    setRequestEdit(false);
  }, []);

  // lp-fn5.5.2: job stream chats under Scheduled Tasks have no row icon
  // (calendar only on the folder). Interactive agents keep dither / share.
  let leading: ReactNode = null;
  if (!isJobStream) {
    if (isShared) {
      leading = (
        <span
          data-testid="agent-side-nav-share-icon"
          style={{
            width: 20,
            height: 20,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            color: "var(--color-text-secondary, #64748b)",
          }}
          aria-hidden
        >
          <ShareIcon width={18} height={18} />
        </span>
      );
    } else {
      // lp-lv9.8: subtle dither motion while the thread/job turn is generating.
      // Composite status already maps host "running" → "generating"; Off stays static.
      leading = (
        <DitherAvatar
          seed={seed}
          size="sm"
          isRunning={status === "generating"}
          data-testid={`agent-dither-${thread.thread_id}`}
        />
      );
    }
  }

  const isChannel = isChannelThread(thread);
  const menuItems = [
    ...(canRename
      ? [
          {
            label: "Rename",
            icon: PencilSquareIcon,
            onClick: () => {
              setRequestEdit(true);
            },
          },
        ]
      : []),
    {
      label: "Share",
      icon: ShareIcon,
      onClick: onShare,
    },
    {
      label: "Delete",
      icon: TrashIcon,
      onClick: onDelete,
    },
  ];

  let endContent: ReactNode;
  if (showMenu) {
    endContent = (
      <MoreMenu
        size="sm"
        label={`Chat actions for ${title}`}
        onOpenChange={setIsMenuOpen}
        items={menuItems}
      />
    );
  } else if (isShared && accessLabel) {
    endContent = (
      <HStack gap={1} align="center">
        <Badge
          label={accessLabel}
          variant={thread.access === "collaborate" ? "purple" : "neutral"}
        />
        <StatusDot
          variant={statusDot.variant}
          label={statusDot.label}
          isPulsing={statusDot.isPulsing}
        />
      </HStack>
    );
  } else {
    endContent = (
      <StatusDot
        variant={statusDot.variant}
        label={statusDot.label}
        isPulsing={statusDot.isPulsing}
      />
    );
  }

  return (
    <Stack
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <a
        href={`#thread/${thread.thread_id}`}
        data-testid={`agent-side-nav-row-${thread.thread_id}`}
        data-channel="false"
        data-selected={isSelected ? "true" : "false"}
        data-owned={canManage ? "true" : "false"}
        data-job-stream={isJobStream ? "true" : "false"}
        data-channel={isChannel ? "true" : "false"}
        data-job-off={isJobOff ? "true" : "false"}
        data-status={status ?? "neutral"}
        aria-current={isSelected ? "page" : undefined}
        aria-label={
          isJobOff
            ? subtitle
              ? `${title}. Off. ${subtitle}`
              : `${title}. Off`
            : subtitle
              ? `${title}. ${subtitle}`
              : title
        }
        onClick={(event) => {
          event.preventDefault();
          onSelect();
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "6px 8px",
          borderRadius: 8,
          border: isSelected
            ? "1px solid hsl(220 14% 86%)"
            : "1px solid transparent",
          background: isSelected ? "hsl(220 14% 96%)" : "transparent",
          cursor: "pointer",
          textAlign: "left",
          textDecoration: "none",
          color: "inherit",
          boxSizing: "border-box",
          opacity: isJobOff ? 0.55 : 1,
        }}
      >
        {leading}
        <span
          style={{
            minWidth: 0,
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 1,
          }}
        >
          <AgentTitleEditor
            title={title}
            canRename={canRename}
            onRename={onRename}
            requestEdit={requestEdit}
            onRequestEditConsumed={handleRequestEditConsumed}
            testId={`agent-side-nav-title-${thread.thread_id}`}
            display={
              <Text type="label" weight="semibold" maxLines={1}>
                {title}
              </Text>
            }
          />
          {subtitle ? (
            <span data-testid={`agent-side-nav-subtitle-${thread.thread_id}`}>
              <Text type="supporting" color="secondary" maxLines={1}>
                {subtitle}
              </Text>
            </span>
          ) : null}
        </span>
        <span
          style={{
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          {endContent}
        </span>
      </a>
    </Stack>
  );
}
