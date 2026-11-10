/**
 * Single-line channel row for the sidenav Channels folder (lp-cxhb.15.1).
 *
 * Channel rows are "#name" only — no avatar, no agent icon glyph, no
 * last-message / recency subtitle. They must not read as agent rows.
 * Owner hover still exposes Rename / Share / Delete via MoreMenu for parity.
 */

import { useState } from "react";

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

import type { ChatThreadSummary } from "../../api/types.js";

import {
  statusDotFromThreadStatus,
  type AgentSideNavStatus,
} from "./threadResponseStatus.js";

export type ChannelSideNavRowProps = {
  thread: ChatThreadSummary;
  isSelected: boolean;
  status: AgentSideNavStatus | undefined;
  canManage: boolean;
  onSelect: () => void;
  onShare: () => void;
  onDelete: () => void;
  onRename?: (nextTitle: string) => void | Promise<void>;
};

export function ChannelSideNavRow({
  thread,
  isSelected,
  status,
  canManage,
  onSelect,
  onShare,
  onDelete,
  onRename,
}: ChannelSideNavRowProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const showMenu = canManage && (isHovered || isMenuOpen);
  const name = thread.title || "New channel";
  const displayName = `#${name}`;
  const statusDot = statusDotFromThreadStatus(status);
  const canRename = Boolean(canManage && onRename);

  let endContent: React.ReactNode;
  if (showMenu) {
    endContent = (
      <MoreMenu
        size="sm"
        label={`Chat actions for ${displayName}`}
        onOpenChange={setIsMenuOpen}
        items={[
          ...(canRename
            ? [
                {
                  label: "Rename",
                  icon: PencilSquareIcon,
                  onClick: () => onRename?.(name),
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
        ]}
      />
    );
  } else {
    endContent = (
      <HStack gap={1} align="center">
        <StatusDot
          variant={statusDot.variant}
          label={statusDot.label}
          isPulsing={statusDot.isPulsing}
        />
      </HStack>
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
        data-channel="true"
        data-selected={isSelected ? "true" : "false"}
        aria-current={isSelected ? "page" : undefined}
        aria-label={displayName}
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
        }}
      >
        <span
          style={{
            minWidth: 0,
            flex: 1,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <span data-testid={`channel-side-nav-name-${thread.thread_id}`}>
            <Text type="label" weight="semibold" maxLines={1}>
              {displayName}
            </Text>
          </span>
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
