import type { CSSProperties } from "react";

/** Fills the PortalShell content area for shell-nav Layout + SideNav. */
export const vaultRootStyle: CSSProperties = {
  height: "100%",
  width: "100%",
  minHeight: 0,
  flex: 1,
};

/**
 * PDF preview iframe — fill remaining reader pane height (not a fixed ~half page).
 * Parent must be a flex column with a bounded height (VStack height 100% + StackItem fill).
 */
export const vaultPdfStyle: CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
  minHeight: 0,
  flex: 1,
  border: "none",
  borderRadius: 8,
  background: "#fff",
};

/** Reader column that fills LayoutContent so embedded previews can stretch. */
export const vaultReaderFillStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
  width: "100%",
};

/**
 * Vault main LayoutContent is always padding 0 so OnlyOffice can sit edge-to-edge
 * (lp-75r.2 / documentPaneEditorBodyStyle). Preview/markdown pad themselves.
 */
export const VAULT_LAYOUT_CONTENT_PADDING = 0 as const;

/**
 * OnlyOffice body — zero content margin so Document Server chrome fills the
 * vault main pane (matches chat documentPaneEditorBodyStyle).
 */
export const vaultEditorBodyStyle: CSSProperties = {
  ...vaultReaderFillStyle,
  flex: 1,
  minHeight: 0,
  padding: 0,
  overflow: "hidden",
  position: "relative",
  zIndex: 0,
};

/**
 * Lightweight VaultReader body — keep internal pad after LayoutContent went to 0.
 * Matches prior LayoutContent padding={6} (~1.5rem).
 */
export const vaultPreviewBodyStyle: CSSProperties = {
  ...vaultReaderFillStyle,
  flex: 1,
  minHeight: 0,
  padding: "var(--spacing-6, 1.5rem)",
  boxSizing: "border-box",
  overflow: "auto",
};

/** Vault image preview — responsive within reader pane. */
export const vaultImageStyle: CSSProperties = {
  maxWidth: "100%",
  borderRadius: 8,
};

/** DOCX preview host — scrollable, fits the vault reader pane. */
export const vaultDocxStyle: CSSProperties = {
  overflow: "auto",
  maxWidth: "100%",
  width: "100%",
};

/** Sandboxed HTML preview iframe. */
export const vaultHtmlStyle: CSSProperties = {
  width: "100%",
  minHeight: 480,
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  background: "#fff",
};

