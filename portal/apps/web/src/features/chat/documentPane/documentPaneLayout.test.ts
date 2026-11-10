/**
 * Unit tests for document pane layout tokens (lp-5q6.15).
 */
import { describe, expect, it } from "vitest";

import {
  clampDocumentPaneWidth,
  DOCUMENT_PANE_DEFAULT_WIDTH_PX,
  DOCUMENT_PANE_MAX_WIDTH_PX,
  DOCUMENT_PANE_MIN_WIDTH_PX,
  DOCUMENT_PANE_MOBILE_MAX_WIDTH_PX,
  isDocumentPaneNarrow,
} from "./documentPaneLayout.js";

describe("clampDocumentPaneWidth", () => {
  it("clamps below min to min", () => {
    expect(clampDocumentPaneWidth(100)).toBe(DOCUMENT_PANE_MIN_WIDTH_PX);
  });

  it("clamps above max to max", () => {
    expect(clampDocumentPaneWidth(9999)).toBe(DOCUMENT_PANE_MAX_WIDTH_PX);
  });

  it("passes through values inside the band", () => {
    expect(clampDocumentPaneWidth(440)).toBe(440);
    expect(clampDocumentPaneWidth(DOCUMENT_PANE_MIN_WIDTH_PX)).toBe(
      DOCUMENT_PANE_MIN_WIDTH_PX,
    );
    expect(clampDocumentPaneWidth(DOCUMENT_PANE_MAX_WIDTH_PX)).toBe(
      DOCUMENT_PANE_MAX_WIDTH_PX,
    );
  });

  it("falls back to default for non-finite input", () => {
    expect(clampDocumentPaneWidth(Number.NaN)).toBe(
      DOCUMENT_PANE_DEFAULT_WIDTH_PX,
    );
    expect(clampDocumentPaneWidth(Number.POSITIVE_INFINITY)).toBe(
      DOCUMENT_PANE_DEFAULT_WIDTH_PX,
    );
  });
});

describe("isDocumentPaneNarrow", () => {
  it("is true at and below the mobile max", () => {
    expect(isDocumentPaneNarrow(DOCUMENT_PANE_MOBILE_MAX_WIDTH_PX)).toBe(true);
    expect(isDocumentPaneNarrow(390)).toBe(true);
  });

  it("is false above the mobile max", () => {
    expect(isDocumentPaneNarrow(DOCUMENT_PANE_MOBILE_MAX_WIDTH_PX + 1)).toBe(
      false,
    );
    expect(isDocumentPaneNarrow(1280)).toBe(false);
  });
});
