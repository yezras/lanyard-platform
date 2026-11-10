/**
 * Chat right-side activity pane shell (lp-dpr.4).
 *
 * Chrome only for activity mode: title, close, Escape, body slot.
 * Subagent roster / workflow detail fill the body in later phases.
 * Desktop split vs mobile drawer layout matches DocumentPaneShell tokens.
 */

import {
  useEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import {
  QueueListIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { Text } from "@astryxdesign/core/Text";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { VStack } from "@astryxdesign/core/VStack";

import {
  documentPaneBodyStyle,
  documentPaneDrawerStyle,
  documentPaneStyle,
  documentPaneWidthVar,
} from "../documentPane/documentPaneLayout.js";

import type { ActivityPaneFocus, ActivityPaneState } from "./types.js";
import { isActivityMode } from "./types.js";

export type ActivityPaneLayoutMode = "split" | "drawer";

export type ActivityPaneShellProps = {
  state: ActivityPaneState;
  onClose: () => void;
  /** Body content — roster / workflow detail (later phases). */
  children?: ReactNode;
  /** Override default width (px or CSS length). Ignored in drawer mode. */
  width?: number | string;
  /**
   * `split` — desktop side column (default).
   * `drawer` — full-screen host (mobile Dialog); fills available space.
   */
  layout?: ActivityPaneLayoutMode;
  /**
   * When true (default), move focus into the pane on open.
   * Desktop: focus the pane region. Mobile Dialog may also autofocus.
   */
  autoFocus?: boolean;
};

/**
 * Shell chrome title. Empty for scheduled_task_config — job name lives in the
 * body (lp-pxr.3); avoid redundant "Scheduled task" chrome.
 */
function focusTitle(focus: ActivityPaneFocus): string {
  switch (focus.kind) {
    case "subagent":
      return "Subagent";
    case "workflow":
      return "Workflow activity";
    case "scheduled_task_config":
      // Neutral chrome: body shows job name (lp-pxr.3).
      return "";
    case "sources":
      return "Sources";
    case "roster":
    default:
      return "Activity";
  }
}

/**
 * Shell chrome subtitle. Empty for scheduled_task_config (lp-pxr.3).
 */
function focusSubtitle(focus: ActivityPaneFocus): string {
  switch (focus.kind) {
    case "subagent":
      return "Run detail";
    case "workflow":
      return `Workflow ${focus.workflowId}`;
    case "scheduled_task_config":
      // No "Schedule & instructions" noise (lp-pxr.3).
      return "";
    case "sources":
      return "Citations";
    case "roster":
    default:
      return "Subagents & workflows";
  }
}

/** True when the activity shell should occupy the right column / drawer. */
export function isActivityPaneVisible(state: ActivityPaneState): boolean {
  return isActivityMode(state);
}

export function ActivityPaneShell({
  state,
  onClose,
  children,
  width,
  layout = "split",
  autoFocus = true,
}: ActivityPaneShellProps) {
  const paneRef = useRef<HTMLElement>(null);
  const visible = isActivityPaneVisible(state);
  const openGeneration = state.openGeneration;

  useEffect(() => {
    if (!visible || !autoFocus) {
      return;
    }
    const id = window.requestAnimationFrame(() => {
      paneRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [visible, openGeneration, autoFocus, layout]);

  if (!visible) {
    return null;
  }

  const isDrawer = layout === "drawer";
  const shellStyle: CSSProperties = isDrawer
    ? documentPaneDrawerStyle
    : {
        ...documentPaneStyle,
        ...documentPaneWidthVar(width),
      };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      event.preventDefault();
      onClose();
    }
  };

  const title = focusTitle(state.focus);
  const subtitle = focusSubtitle(state.focus);
  const hasChromeTitle = Boolean(title || subtitle);

  return (
    <aside
      ref={paneRef}
      className={
        isDrawer
          ? "chat-activity-pane chat-activity-pane--drawer"
          : "chat-activity-pane chat-activity-pane--split"
      }
      data-testid="chat-activity-pane"
      data-layout={layout}
      data-mode={state.mode}
      data-focus-kind={state.focus.kind}
      aria-label="Activity pane"
      role="complementary"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      style={shellStyle}
    >
      <Toolbar
        label="Activity pane actions"
        dividers={["bottom"]}
        startContent={
          hasChromeTitle ? (
            <HStack gap={3} vAlign="center" style={{ minWidth: 0, flex: 1 }}>
              <Icon icon={QueueListIcon} size="sm" color="secondary" />
              <VStack gap={0} style={{ minWidth: 0, flex: 1 }}>
                {title ? (
                  <Text type="label" weight="semibold" maxLines={1}>
                    {title}
                  </Text>
                ) : null}
                {subtitle ? (
                  <Text type="supporting" color="secondary" maxLines={1}>
                    {subtitle}
                  </Text>
                ) : null}
              </VStack>
            </HStack>
          ) : (
            // Minimal chrome for scheduled_task_config (lp-pxr.3): close only.
            <span data-testid="chat-activity-pane-chrome-neutral" />
          )
        }
        endContent={
          <HStack gap={1} vAlign="center" style={{ flexShrink: 0 }}>
            <Button
              label="Close activity pane"
              tooltip="Close"
              variant="ghost"
              size="sm"
              isIconOnly
              icon={<Icon icon={XMarkIcon} size="sm" />}
              onClick={onClose}
            />
          </HStack>
        }
      />

      <div
        className="chat-activity-pane-body"
        data-testid="chat-activity-pane-body"
        style={documentPaneBodyStyle}
      >
        {children ?? (
          <VStack gap={2} data-testid="chat-activity-pane-placeholder">
            <Text type="body" color="secondary">
              Agent activity will appear here — subagent roster and workflow
              stage trees when the host emits progress events.
            </Text>
          </VStack>
        )}
      </div>
    </aside>
  );
}
