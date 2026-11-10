import type { CSSProperties } from "react";

/** Fills the PortalShell content area and enables container queries for chat. */
export const chatRootStyle: CSSProperties = {
  height: "100%",
  width: "100%",
  minHeight: 0,
  flex: 1,
  containerType: "inline-size",
  containerName: "chat",
};

/**
 * Primary chat column. When the document pane is open the column flexes to the
 * remaining width; minWidth keeps the composer readable on desktop.
 */
export const chatColumnStyle: CSSProperties = {
  flex: 1,
  width: "100%",
  minWidth: 0,
  height: "100%",
  minHeight: 0,
};

/** Row that hosts the chat column + optional document pane. */
export const chatSplitRowStyle: CSSProperties = {
  height: "100%",
  width: "100%",
  minHeight: 0,
  minWidth: 0,
};

/** ChatLayout flex child inside the column. */
export const chatLayoutStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
};
