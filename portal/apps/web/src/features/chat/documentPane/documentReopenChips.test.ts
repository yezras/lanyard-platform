import { describe, expect, it } from "vitest";

import {
  DOCUMENT_REOPEN_CHIP_MAX,
  documentReopenChipFromRef,
  shouldRecordDocumentReopenChip,
  upsertDocumentReopenChip,
  type DocumentReopenChip,
} from "./documentReopenChips.js";
import type { VaultArtifactRef } from "./types.js";

const REF: VaultArtifactRef = {
  path: "/Projects/A/memo.docx",
  title: "memo.docx",
  source: "deep_link",
};

describe("shouldRecordDocumentReopenChip", () => {
  it("records previewing / editing / progress / conflict with a path", () => {
    for (const status of [
      "previewing",
      "editing",
      "progress",
      "conflict",
    ] as const) {
      expect(shouldRecordDocumentReopenChip(status, REF)).toBe(true);
    }
  });

  it("does not record opening / error / closed (no orphan chips)", () => {
    for (const status of ["opening", "error", "closed"] as const) {
      expect(shouldRecordDocumentReopenChip(status, REF)).toBe(false);
    }
  });

  it("does not record without a path", () => {
    expect(shouldRecordDocumentReopenChip("previewing", null)).toBe(false);
    expect(
      shouldRecordDocumentReopenChip("previewing", { path: "  " }),
    ).toBe(false);
  });
});

describe("upsertDocumentReopenChip", () => {
  it("appends a new path", () => {
    const next = upsertDocumentReopenChip([], {
      path: "/a.md",
      title: "a",
    });
    expect(next).toEqual([{ path: "/a.md", title: "a" }]);
  });

  it("dedupes by path and moves to end (most recent)", () => {
    const base: DocumentReopenChip[] = [
      { path: "/a.md" },
      { path: "/b.md", title: "b" },
    ];
    const next = upsertDocumentReopenChip(base, {
      path: "/a.md",
      title: "A updated",
    });
    expect(next).toEqual([
      { path: "/b.md", title: "b" },
      { path: "/a.md", title: "A updated" },
    ]);
  });

  it("caps at max, dropping oldest", () => {
    let chips: DocumentReopenChip[] = [];
    for (let i = 0; i < DOCUMENT_REOPEN_CHIP_MAX + 2; i += 1) {
      chips = upsertDocumentReopenChip(chips, { path: `/f${i}.md` });
    }
    expect(chips).toHaveLength(DOCUMENT_REOPEN_CHIP_MAX);
    expect(chips[0]?.path).toBe("/f2.md");
    expect(chips[chips.length - 1]?.path).toBe(
      `/f${DOCUMENT_REOPEN_CHIP_MAX + 1}.md`,
    );
  });

  it("ignores empty path", () => {
    expect(upsertDocumentReopenChip([{ path: "/a.md" }], { path: "" })).toEqual(
      [{ path: "/a.md" }],
    );
  });
});

describe("documentReopenChipFromRef", () => {
  it("copies path and optional title", () => {
    expect(documentReopenChipFromRef(REF)).toEqual({
      path: "/Projects/A/memo.docx",
      title: "memo.docx",
    });
    expect(documentReopenChipFromRef({ path: "/x.md" })).toEqual({
      path: "/x.md",
    });
  });
});
