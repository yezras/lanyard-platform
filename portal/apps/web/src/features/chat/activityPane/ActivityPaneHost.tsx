/**
 * Responsive activity pane host (lp-dpr.4).
 *
 * Reuses DocumentPaneHost patterns:
 * - Desktop: resizable split column with Astryx ResizeHandle.
 * - Mobile / narrow chat root: full-screen Dialog drawer.
 * - Shared width band + persisted width (same chrome as document pane).
 * - Restores focus to the element that opened the pane when it closes.
 */

import {
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";

import { Dialog } from "@astryxdesign/core/Dialog";
import { ResizeHandle, useResizable } from "@astryxdesign/core/Resizable";

import {
  clampDocumentPaneWidth,
  DOCUMENT_PANE_DEFAULT_WIDTH_PX,
  DOCUMENT_PANE_MAX_WIDTH_PX,
  DOCUMENT_PANE_MIN_WIDTH_PX,
  DOCUMENT_PANE_RESIZE_AUTO_SAVE_ID,
} from "../documentPane/documentPaneLayout.js";
import {
  useDocumentPaneNarrow,
  type DocumentPaneLayoutPreference,
} from "../documentPane/useDocumentPaneNarrow.js";

import {
  ActivityPaneShell,
  isActivityPaneVisible,
} from "./ActivityPaneShell.js";
import type { ActivityPaneState } from "./types.js";

export type ActivityPaneHostProps = {
  state: ActivityPaneState;
  onClose: () => void;
  /**
   * Chat-root element used for the narrow (drawer) breakpoint.
   * Should be the same container that has `container-name: chat`.
   */
  containerRef: RefObject<HTMLElement | null>;
  /**
   * Force layout for tests / stories. Default `auto` follows container width.
   */
  layoutPreference?: DocumentPaneLayoutPreference;
  /**
   * When false, hide chrome even if activity mode is still open
   * (e.g. Portal keep-alive Chat tab inactive — lp-vnz.1).
   *
   * Keep the host mounted so `visible` can transition false and release
   * Dialog showModal / focus trap without wiping activity state. Default true.
   */
  active?: boolean;
  /** Optional body (roster / workflow). Default shell placeholder when omitted. */
  children?: ReactNode;
};

/**
 * True when focus can safely return to `el`.
 * Skips restore into CSS-hidden keep-alive panes (lp-vnz.1) without relying on
 * layout APIs that jsdom often leaves empty.
 */
function isFocusRestoreTargetVisible(el: HTMLElement): boolean {
  if (!document.contains(el)) {
    return false;
  }
  let node: HTMLElement | null = el;
  while (node) {
    if (node.hidden) {
      return false;
    }
    // Inline styles used by PortalShell KeepAlivePane when inactive.
    const inlineDisplay = node.style.display;
    const inlineVisibility = node.style.visibility;
    if (inlineDisplay === "none" || inlineVisibility === "hidden") {
      return false;
    }
    if (typeof window.getComputedStyle === "function") {
      const computed = window.getComputedStyle(node);
      if (computed.display === "none" || computed.visibility === "hidden") {
        return false;
      }
    }
    node = node.parentElement;
  }
  return true;
}

export function ActivityPaneHost({
  state,
  onClose,
  containerRef,
  layoutPreference = "auto",
  active = true,
  children,
}: ActivityPaneHostProps) {
  const isNarrow = useDocumentPaneNarrow(containerRef, layoutPreference);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const wasVisibleRef = useRef(false);

  const paneResize = useResizable({
    defaultSize: DOCUMENT_PANE_DEFAULT_WIDTH_PX,
    minSizePx: DOCUMENT_PANE_MIN_WIDTH_PX,
    maxSizePx: DOCUMENT_PANE_MAX_WIDTH_PX,
    // Share width persistence with document pane — one chrome.
    autoSaveId: DOCUMENT_PANE_RESIZE_AUTO_SAVE_ID,
  });

  const visible = active && isActivityPaneVisible(state);

  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      const activeEl = document.activeElement;
      if (
        activeEl instanceof HTMLElement &&
        activeEl.getAttribute("data-testid") !== "chat-activity-pane"
      ) {
        returnFocusRef.current = activeEl;
      }
    }
    if (!visible && wasVisibleRef.current) {
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      // Do not steal focus into a keep-alive-hidden Chat root (lp-vnz.1).
      window.requestAnimationFrame(() => {
        if (target && isFocusRestoreTargetVisible(target)) {
          target.focus({ preventScroll: true });
        }
      });
    }
    wasVisibleRef.current = visible;
  }, [visible]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleDrawerOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        handleClose();
      }
    },
    [handleClose],
  );

  if (!visible) {
    return null;
  }

  if (isNarrow) {
    return (
      <Dialog
        isOpen
        onOpenChange={handleDrawerOpenChange}
        purpose="info"
        variant="fullscreen"
        data-testid="chat-activity-pane-drawer"
        aria-label="Activity pane"
      >
        <ActivityPaneShell
          state={state}
          onClose={handleClose}
          layout="drawer"
          autoFocus={false}
        >
          {children}
        </ActivityPaneShell>
      </Dialog>
    );
  }

  const width = clampDocumentPaneWidth(paneResize.size);

  return (
    <>
      <ResizeHandle
        direction="horizontal"
        resizable={paneResize.props}
        isReversed
        pillPlacement="start"
        hasDivider
        label="Resize activity pane"
        className="chat-activity-pane-resize-handle"
        data-testid="chat-activity-pane-resize-handle"
      />
      <ActivityPaneShell
        state={state}
        onClose={handleClose}
        layout="split"
        width={width}
        autoFocus
      >
        {children}
      </ActivityPaneShell>
    </>
  );
}
