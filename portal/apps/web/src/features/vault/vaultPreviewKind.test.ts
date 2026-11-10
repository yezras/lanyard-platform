/**
 * Office inline client preview kinds (lp-rt5.7).
 *
 * docx / xlsx / pptx must never resolve to `unsupported`, including edge mimes
 * where only the extension or only the Office mime family is present.
 */
import { describe, expect, it } from "vitest";

import {
  isOfficeClientPreviewKind,
  resolveVaultPreviewKind,
  type VaultPreviewKind,
} from "./vaultPreviewKind.js";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

describe("resolveVaultPreviewKind — Office client previews (lp-rt5.7)", () => {
  const officeCases: Array<{
    label: string;
    path: string;
    mime_type: string;
    kind: VaultPreviewKind;
  }> = [
    // DOCX
    {
      label: "docx by extension + openxml mime",
      path: "/Projects/A/Proposal.docx",
      mime_type: DOCX_MIME,
      kind: "docx",
    },
    {
      label: "docx by extension with generic octet-stream mime",
      path: "/Projects/A/notes.docx",
      mime_type: "application/octet-stream",
      kind: "docx",
    },
    {
      label: "docx by wordprocessingml mime with odd path",
      path: "/Projects/A/memo.bin",
      mime_type: DOCX_MIME,
      kind: "docx",
    },
    {
      label: "legacy doc by extension",
      path: "/Projects/A/legacy.doc",
      mime_type: "application/octet-stream",
      kind: "docx",
    },
    {
      label: "legacy msword mime",
      path: "/Projects/A/legacy.bin",
      mime_type: "application/msword",
      kind: "docx",
    },
    // XLSX
    {
      label: "xlsx by extension + openxml mime",
      path: "/Projects/A/Budget.xlsx",
      mime_type: XLSX_MIME,
      kind: "xlsx",
    },
    {
      label: "xlsx by extension with generic mime",
      path: "/Projects/A/data.xlsx",
      mime_type: "application/octet-stream",
      kind: "xlsx",
    },
    {
      label: "xlsx by spreadsheetml mime only",
      path: "/Projects/A/sheet.bin",
      mime_type: XLSX_MIME,
      kind: "xlsx",
    },
    {
      label: "xls by extension",
      path: "/Projects/A/old.xls",
      mime_type: "application/octet-stream",
      kind: "xlsx",
    },
    {
      label: "ms-excel mime",
      path: "/Projects/A/book.bin",
      mime_type: "application/vnd.ms-excel",
      kind: "xlsx",
    },
    // PPTX
    {
      label: "pptx by extension + openxml mime",
      path: "/Projects/A/Deck.pptx",
      mime_type: PPTX_MIME,
      kind: "pptx",
    },
    {
      label: "pptx by extension with generic mime",
      path: "/Projects/A/slides.pptx",
      mime_type: "application/octet-stream",
      kind: "pptx",
    },
    {
      label: "pptx by presentationml mime only",
      path: "/Projects/A/deck.bin",
      mime_type: PPTX_MIME,
      kind: "pptx",
    },
    {
      label: "ppt by extension",
      path: "/Projects/A/old.ppt",
      mime_type: "application/octet-stream",
      kind: "pptx",
    },
    {
      label: "ms-powerpoint mime",
      path: "/Projects/A/pres.bin",
      mime_type: "application/vnd.ms-powerpoint",
      kind: "pptx",
    },
  ];

  it.each(officeCases)(
    "routes $label → $kind (never unsupported)",
    ({ path, mime_type, kind }) => {
      const resolved = resolveVaultPreviewKind({ path, mime_type });
      expect(resolved).toBe(kind);
      expect(resolved).not.toBe("unsupported");
      expect(isOfficeClientPreviewKind(resolved)).toBe(true);
    },
  );

  it("keeps unknown binary on unsupported (non-Office control)", () => {
    expect(
      resolveVaultPreviewKind({
        path: "/blob.bin",
        mime_type: "application/octet-stream",
      }),
    ).toBe("unsupported");
  });

  it("does not let text/* steal Office extension paths", () => {
    // Extension wins — generic text mime must not force code preview.
    expect(
      resolveVaultPreviewKind({
        path: "/Projects/A/Proposal.docx",
        mime_type: "text/plain",
      }),
    ).toBe("docx");
    expect(
      resolveVaultPreviewKind({
        path: "/Projects/A/Budget.xlsx",
        mime_type: "text/plain",
      }),
    ).toBe("xlsx");
    expect(
      resolveVaultPreviewKind({
        path: "/Projects/A/Deck.pptx",
        mime_type: "text/plain",
      }),
    ).toBe("pptx");
  });

  /** lp-upc: .xls has defined client-preview behavior (xlsx renderer). */
  it("maps .xls to xlsx client preview (never unsupported)", () => {
    expect(
      resolveVaultPreviewKind({
        path: "/Projects/A/legacy.xls",
        mime_type: "application/vnd.ms-excel",
      }),
    ).toBe("xlsx");
    expect(
      resolveVaultPreviewKind({
        path: "/Projects/A/legacy.xls",
        mime_type: "application/octet-stream",
      }),
    ).toBe("xlsx");
    expect(
      isOfficeClientPreviewKind(
        resolveVaultPreviewKind({
          path: "/a.xls",
          mime_type: "application/octet-stream",
        }),
      ),
    ).toBe(true);
  });
});
