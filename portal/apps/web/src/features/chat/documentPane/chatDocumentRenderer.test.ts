/**
 * Chat document pane renderer selection (lp-5q6.30 / lp-swt.2).
 *
 * Office-only open: when gates pass, OnlyOffice is the sole body renderer
 * regardless of panel mode. No Edit / Back-to-preview dual-mode chrome.
 */
import { describe, expect, it } from "vitest";

import { resolveChatDocumentRenderer } from "./chatDocumentRenderer.js";

const DOCX = "/Projects/A/Proposal.docx";
const XLSX = "/Projects/A/Budget.xlsx";
const PPTX = "/Projects/A/Deck.pptx";
const MD = "/Projects/A/README.md";

describe("resolveChatDocumentRenderer", () => {
  it("opens OnlyOffice immediately for Office path when gates pass (any mode)", () => {
    for (const mode of ["preview", "edit"] as const) {
      const r = resolveChatDocumentRenderer({
        path: DOCX,
        mode,
        canVaultEdit: true,
        editorEnabled: true,
      });
      expect(r.renderer).toBe("onlyoffice");
      expect(r.officeActive).toBe(true);
      expect(r.officeMode).toBe("edit");
      expect(r.showEdit).toBe(false);
      expect(r.showExitEdit).toBe(false);
    }
  });

  it("lp-swt.2: citation/default open mounts OnlyOffice for docx/xlsx/pptx/xls (no Edit chrome)", () => {
    const paths = [DOCX, XLSX, PPTX, "/Projects/A/legacy.xls"];
    for (const path of paths) {
      const r = resolveChatDocumentRenderer({
        path,
        mode: "preview",
        canVaultEdit: true,
        editorEnabled: true,
      });
      expect(r.renderer).toBe("onlyoffice");
      expect(r.officeActive).toBe(true);
      expect(r.fileSupported).toBe(true);
      expect(r.showEdit).toBe(false);
      expect(r.showExitEdit).toBe(false);
    }
  });

  it("OnlyOffice stays off when editorEnabled is false", () => {
    for (const path of [DOCX, XLSX, PPTX]) {
      const r = resolveChatDocumentRenderer({
        path,
        mode: "edit",
        canVaultEdit: true,
        editorEnabled: false,
      });
      expect(r.renderer).toBe("preview");
      expect(r.officeActive).toBe(false);
      expect(r.showEdit).toBe(false);
      expect(r.showExitEdit).toBe(false);
    }
  });

  it("selects ONLYOFFICE when type + flag + vault_edit (mode ignored)", () => {
    const r = resolveChatDocumentRenderer({
      path: DOCX,
      mode: "preview",
      canVaultEdit: true,
      editorEnabled: true,
    });
    expect(r.renderer).toBe("onlyoffice");
    expect(r.officeActive).toBe(true);
    expect(r.officeMode).toBe("edit");
    expect(r.showEdit).toBe(false);
    expect(r.showExitEdit).toBe(false);
  });

  it("falls back to preview when feature flag is off", () => {
    const r = resolveChatDocumentRenderer({
      path: DOCX,
      mode: "edit",
      canVaultEdit: true,
      editorEnabled: false,
    });
    expect(r.renderer).toBe("preview");
    expect(r.officeActive).toBe(false);
    expect(r.showEdit).toBe(false);
    expect(r.showExitEdit).toBe(false);
  });

  it("falls back to preview when ui.can.vault_edit is false or unknown (no dead Edit)", () => {
    for (const canVaultEdit of [false, null, undefined] as const) {
      const r = resolveChatDocumentRenderer({
        path: DOCX,
        mode: "edit",
        canVaultEdit,
        editorEnabled: true,
      });
      expect(r.renderer).toBe("preview");
      expect(r.officeActive).toBe(false);
      expect(r.canVaultEdit).toBe(false);
      expect(r.showEdit).toBe(false);
      expect(r.showExitEdit).toBe(false);
    }
  });

  it("keeps markdown on preview (unsupported type, no Edit)", () => {
    const r = resolveChatDocumentRenderer({
      path: MD,
      mode: "edit",
      canVaultEdit: true,
      editorEnabled: true,
    });
    expect(r.fileSupported).toBe(false);
    expect(r.renderer).toBe("preview");
    expect(r.showEdit).toBe(false);
    expect(r.showExitEdit).toBe(false);
  });

  it("matrix: only all-gates activates Office (mode independent)", () => {
    const cases: Array<{
      path: string;
      mode: "preview" | "edit";
      canVaultEdit: boolean;
      editorEnabled: boolean;
      officeActive: boolean;
    }> = [
      {
        path: DOCX,
        mode: "edit",
        canVaultEdit: true,
        editorEnabled: true,
        officeActive: true,
      },
      {
        path: DOCX,
        mode: "preview",
        canVaultEdit: true,
        editorEnabled: true,
        officeActive: true,
      },
      {
        path: DOCX,
        mode: "edit",
        canVaultEdit: false,
        editorEnabled: true,
        officeActive: false,
      },
      {
        path: DOCX,
        mode: "edit",
        canVaultEdit: true,
        editorEnabled: false,
        officeActive: false,
      },
      {
        path: MD,
        mode: "edit",
        canVaultEdit: true,
        editorEnabled: true,
        officeActive: false,
      },
    ];
    for (const c of cases) {
      const r = resolveChatDocumentRenderer({
        path: c.path,
        mode: c.mode,
        canVaultEdit: c.canVaultEdit,
        editorEnabled: c.editorEnabled,
      });
      expect(r.officeActive).toBe(c.officeActive);
      expect(r.showEdit).toBe(false);
      expect(r.showExitEdit).toBe(false);
    }
  });
});
