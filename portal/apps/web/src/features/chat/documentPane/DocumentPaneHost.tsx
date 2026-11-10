/**
 * Responsive document pane host (lp-5q6.15).
 *
 * Desktop: resizable split column with Astryx ResizeHandle.
 * Mobile / narrow chat root: full-screen Dialog drawer (not squeezed beside chat).
 * Restores focus to the element that opened the pane when it closes.
 */

import {
  useCallback,
  useEffect,
  useRef,
  type RefObject,
} from "react";

import { Dialog } from "@astryxdesign/core/Dialog";
import { ResizeHandle, useResizable } from "@astryxdesign/core/Resizable";

import {
  DocumentPaneShell,
  type DocumentPaneShellProps,
} from "./DocumentPaneShell.js";
import {
  DOCUMENT_PANE_DEFAULT_WIDTH_PX,
  DOCUMENT_PANE_MAX_WIDTH_PX,
  DOCUMENT_PANE_MIN_WIDTH_PX,
  DOCUMENT_PANE_RESIZE_AUTO_SAVE_ID,
  clampDocumentPaneWidth,
} from "./documentPaneLayout.js";
import {
  useDocumentPaneNarrow,
  type DocumentPaneLayoutPreference,
} from "./useDocumentPaneNarrow.js";

export type DocumentPaneHostProps = Omit<
  DocumentPaneShellProps,
  "layout" | "width" | "autoFocus"
> & {
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
   * When false, hide chrome even if the artifact panel is still open
   * (e.g. activity mode exclusive side column — lp-dpr.4).
   *
   * Keep the host mounted in ChatView so `visible` can transition false and
   * run focus restore (lp-5q6.15). Default true.
   */
  active?: boolean;
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

export function DocumentPaneHost({
  state,
  content,
  isLoading,
  onClose,
  onReload,
  onOpenInVault,
  onDownload,
  onOpenCheckpoint,
  onDismissCheckpoint,
  onDiscardLocal,
  officeEditor = null,
  editControls = null,
  currentnessChrome = null,
  containerRef,
  layoutPreference = "auto",
  active = true,
}: DocumentPaneHostProps) {
  const isNarrow = useDocumentPaneNarrow(containerRef, layoutPreference);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const wasVisibleRef = useRef(false);

  const paneResize = useResizable({
    defaultSize: DOCUMENT_PANE_DEFAULT_WIDTH_PX,
    minSizePx: DOCUMENT_PANE_MIN_WIDTH_PX,
    maxSizePx: DOCUMENT_PANE_MAX_WIDTH_PX,
    autoSaveId: DOCUMENT_PANE_RESIZE_AUTO_SAVE_ID,
  });

  const visible =
    active && state.status !== "closed" && state.ref != null;

  // Capture the focused element when the pane first becomes visible; restore on close.
  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      const active = document.activeElement;
      // Prefer the opener, not the pane itself (shell may already autofocus).
      if (
        active instanceof HTMLElement &&
        active.getAttribute("data-testid") !== "chat-document-pane"
      ) {
        returnFocusRef.current = active;
      }
    }
    if (!visible && wasVisibleRef.current) {
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      // Defer so Dialog unmount / shell teardown finish first.
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

  const shellProps = {
    state,
    content,
    isLoading,
    onClose: handleClose,
    onReload,
    onOpenInVault,
    onDownload,
    onOpenCheckpoint,
    onDismissCheckpoint,
    onDiscardLocal,
    officeEditor,
    editControls,
    currentnessChrome,
  };

  if (isNarrow) {
    return (
      <Dialog
        isOpen
        onOpenChange={handleDrawerOpenChange}
        purpose="info"
        variant="fullscreen"
        data-testid="chat-document-pane-drawer"
        aria-label="Document pane"
      >
        <DocumentPaneShell
          {...shellProps}
          layout="drawer"
          // Dialog manages initial focus; shell Escape still closes.
          autoFocus={false}
        />
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
        label="Resize document pane"
        className="chat-document-pane-resize-handle"
        data-testid="chat-document-pane-resize-handle"
      />
      <DocumentPaneShell
        {...shellProps}
        layout="split"
        width={width}
        autoFocus
      />
    </>
  );
}
