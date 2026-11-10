import { afterEach, describe, expect, it } from "vitest";

import {
  canVaultEditFromPortalContext,
  resolveVaultEditAffordance,
} from "./vaultEditGating.js";

afterEach(() => {
  delete window.__LANYARD_FEATURE_FLAGS__;
});

describe("resolveVaultEditAffordance", () => {
  it("shows edit only when flag + supported type + vault_edit", () => {
    expect(
      resolveVaultEditAffordance({
        path: "/Projects/A/Proposal.docx",
        canVaultEdit: true,
        editorEnabled: true,
      }),
    ).toEqual({
      fileSupported: true,
      editorEnabled: true,
      canVaultEdit: true,
      showEdit: true,
    });
  });

  it("hides edit when ui.can.vault_edit is false (view-only user)", () => {
    const r = resolveVaultEditAffordance({
      path: "/Projects/A/Proposal.docx",
      canVaultEdit: false,
      editorEnabled: true,
    });
    expect(r.showEdit).toBe(false);
    expect(r.fileSupported).toBe(true);
    expect(r.canVaultEdit).toBe(false);
  });

  it("hides edit when capability is unknown (fail closed)", () => {
    expect(
      resolveVaultEditAffordance({
        path: "/Projects/A/Proposal.docx",
        canVaultEdit: null,
        editorEnabled: true,
      }).showEdit,
    ).toBe(false);
    expect(
      resolveVaultEditAffordance({
        path: "/Projects/A/Proposal.docx",
        canVaultEdit: undefined,
        editorEnabled: true,
      }).showEdit,
    ).toBe(false);
  });

  it("hides edit for unsupported file types even when vault_edit is true", () => {
    for (const path of [
      "/Projects/A/README.md",
      "/Projects/A/notes.txt",
      "/Projects/A/photo.png",
      "/Projects/A/data.csv",
      null,
      undefined,
      "",
    ]) {
      expect(
        resolveVaultEditAffordance({
          path,
          canVaultEdit: true,
          editorEnabled: true,
        }).showEdit,
        path ?? "(null)",
      ).toBe(false);
    }
  });

  it("hides edit when feature flag is off", () => {
    expect(
      resolveVaultEditAffordance({
        path: "/Projects/A/Proposal.docx",
        canVaultEdit: true,
        editorEnabled: false,
      }).showEdit,
    ).toBe(false);
  });

  it("supports xlsx/pptx/pdf office family", () => {
    for (const path of [
      "/a.xlsx",
      "/b.pptx",
      "/c.pdf",
      "/d.doc",
      "/e.odt",
    ]) {
      expect(
        resolveVaultEditAffordance({
          path,
          canVaultEdit: true,
          editorEnabled: true,
        }).showEdit,
      ).toBe(true);
    }
  });

  it("flag matrix: all false combinations hide edit", () => {
    const cases: Array<{
      path: string;
      canVaultEdit: boolean;
      editorEnabled: boolean;
    }> = [
      {
        path: "/a.docx",
        canVaultEdit: false,
        editorEnabled: false,
      },
      {
        path: "/a.docx",
        canVaultEdit: true,
        editorEnabled: false,
      },
      {
        path: "/a.docx",
        canVaultEdit: false,
        editorEnabled: true,
      },
      {
        path: "/a.md",
        canVaultEdit: true,
        editorEnabled: true,
      },
    ];
    for (const c of cases) {
      expect(resolveVaultEditAffordance(c).showEdit).toBe(false);
    }
  });
});

describe("canVaultEditFromPortalContext", () => {
  it("reads nested ui.can.vault_edit", () => {
    expect(
      canVaultEditFromPortalContext({
        ui: { can: { vault_edit: true } },
      }),
    ).toBe(true);
    expect(
      canVaultEditFromPortalContext({
        ui: { can: { vault_edit: false } },
      }),
    ).toBe(false);
  });

  it("accepts flat can_vault_edit fallback", () => {
    expect(canVaultEditFromPortalContext({ can_vault_edit: true })).toBe(true);
  });

  it("fail-closed on missing/null", () => {
    expect(canVaultEditFromPortalContext(null)).toBe(false);
    expect(canVaultEditFromPortalContext(undefined)).toBe(false);
    expect(canVaultEditFromPortalContext({})).toBe(false);
    expect(canVaultEditFromPortalContext({ ui: {} })).toBe(false);
    expect(canVaultEditFromPortalContext({ ui: { can: {} } })).toBe(false);
  });
});
