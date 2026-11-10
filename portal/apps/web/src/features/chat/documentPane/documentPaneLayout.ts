import type { CSSProperties } from "react";

/**
 * Layout tokens for the chat-side document pane.
 *
 * lp-5q6.13: default split width and body styles.
 * lp-5q6.15: stable min/max resize, mobile full-screen drawer breakpoint.
 */

/** Default desktop pane width (px). CSS var may override. */
export const DOCUMENT_PANE_DEFAULT_WIDTH_PX = 440;

/** Minimum desktop pane width (px) while resizing. */
export const DOCUMENT_PANE_MIN_WIDTH_PX = 320;

/** Maximum desktop pane width (px) while resizing. */
export const DOCUMENT_PANE_MAX_WIDTH_PX = 720;

/**
 * Collapse desktop split at or below this chat-root width (container query +
 * JS measurement). Matches the Astryx ai-chat template breakpoint.
 */
export const DOCUMENT_PANE_MOBILE_MAX_WIDTH_PX = 767;

/** localStorage key for persisted desktop pane width. */
export const DOCUMENT_PANE_RESIZE_AUTO_SAVE_ID = "chat-document-pane";

/** True when the chat container should host a full-screen drawer, not a split. */
export function isDocumentPaneNarrow(containerWidthPx: number): boolean {
  return containerWidthPx <= DOCUMENT_PANE_MOBILE_MAX_WIDTH_PX;
}

/** Clamp a raw width into the desktop pane min/max band. */
export function clampDocumentPaneWidth(widthPx: number): number {
  if (!Number.isFinite(widthPx)) {
    return DOCUMENT_PANE_DEFAULT_WIDTH_PX;
  }
  return Math.min(
    DOCUMENT_PANE_MAX_WIDTH_PX,
    Math.max(DOCUMENT_PANE_MIN_WIDTH_PX, Math.round(widthPx)),
  );
}

export const documentPaneStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
  minWidth: 0,
  flexShrink: 0,
  width: `var(--chat-document-pane-width, ${DOCUMENT_PANE_DEFAULT_WIDTH_PX}px)`,
  overflow: "hidden",
  borderInlineStart: "1px solid var(--border-primary, rgba(0,0,0,0.08))",
  background: "var(--surface-primary, transparent)",
};

/** Full-screen drawer layout (mobile) — fills dialog / host, no side border. */
export const documentPaneDrawerStyle: CSSProperties = {
  ...documentPaneStyle,
  width: "100%",
  flex: 1,
  flexShrink: 1,
  borderInlineStart: "none",
};

export const documentPaneBodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: "auto",
  display: "flex",
  flexDirection: "column",
  padding: "var(--spacing-4, 1rem)",
};

/**
 * Body styles when ONLYOFFICE is the renderer (lp-5q6.30).
 * No padding so Document Server chrome fills the frame; progress strip stays
 * outside this box so agent progress never covers editor controls.
 */
export const documentPaneEditorBodyStyle: CSSProperties = {
  ...documentPaneBodyStyle,
  padding: 0,
  overflow: "hidden",
  position: "relative",
  zIndex: 0,
};

export const documentPaneWidthVar = (
  size: number | string = DOCUMENT_PANE_DEFAULT_WIDTH_PX,
): CSSProperties =>
  ({
    "--chat-document-pane-width":
      typeof size === "number" ? `${size}px` : size,
  }) as CSSProperties;
