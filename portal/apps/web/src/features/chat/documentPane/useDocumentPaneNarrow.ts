/**
 * Measure a chat-root container and report whether the document pane should
 * use the full-screen drawer (lp-5q6.15). Aligns with the CSS container query
 * on the same breakpoint.
 */

import { useEffect, useState, type RefObject } from "react";

import {
  DOCUMENT_PANE_MOBILE_MAX_WIDTH_PX,
  isDocumentPaneNarrow,
} from "./documentPaneLayout.js";

export type DocumentPaneLayoutPreference = "auto" | "split" | "drawer";

/**
 * Observe `containerRef` width and return whether the pane is in the narrow
 * (drawer) band. When `preference` is not `auto`, returns a forced value.
 */
export function useDocumentPaneNarrow(
  containerRef: RefObject<HTMLElement | null>,
  preference: DocumentPaneLayoutPreference = "auto",
): boolean {
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    if (preference === "split") {
      setIsNarrow(false);
      return;
    }
    if (preference === "drawer") {
      setIsNarrow(true);
      return;
    }

    const el = containerRef.current;
    if (!el) {
      // Fall back to viewport when the container is not mounted yet.
      setIsNarrow(isDocumentPaneNarrow(window.innerWidth));
      return;
    }

    const measure = () => {
      setIsNarrow(isDocumentPaneNarrow(el.getBoundingClientRect().width));
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === "number") {
        setIsNarrow(isDocumentPaneNarrow(width));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef, preference]);

  if (preference === "split") {
    return false;
  }
  if (preference === "drawer") {
    return true;
  }
  return isNarrow;
}

/** Media query string matching {@link DOCUMENT_PANE_MOBILE_MAX_WIDTH_PX}. */
export const DOCUMENT_PANE_NARROW_MEDIA_QUERY = `(max-width: ${DOCUMENT_PANE_MOBILE_MAX_WIDTH_PX}px)`;
