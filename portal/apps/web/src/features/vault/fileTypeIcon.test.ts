import { describe, expect, it } from "vitest";

import {
  fileTypeIcon,
  fileTypeIconDataUrl,
  fileTypeKind,
} from "./fileTypeIcon.js";

describe("fileTypeKind / fileTypeIcon", () => {
  it("classifies common extensions", () => {
    expect(fileTypeKind("notes.md")).toBe("text");
    expect(fileTypeKind("app.ts")).toBe("code");
    expect(fileTypeKind("photo.png")).toBe("image");
    expect(fileTypeKind("sheet.csv")).toBe("spreadsheet");
    expect(fileTypeKind("deck.pptx")).toBe("presentation");
    expect(fileTypeKind("doc.pdf")).toBe("pdf");
  });

  it("returns distinct Heroicons per kind", () => {
    expect(fileTypeIcon("a.ts")).not.toBe(fileTypeIcon("a.md"));
    expect(fileTypeIcon("a.png")).not.toBe(fileTypeIcon("a.pdf"));
  });
});

describe("fileTypeIconDataUrl", () => {
  it("returns svg data URIs that differ by kind", () => {
    const md = fileTypeIconDataUrl("notes.md");
    const ts = fileTypeIconDataUrl("src/foo.ts");
    expect(md.startsWith("data:image/svg+xml,")).toBe(true);
    expect(ts.startsWith("data:image/svg+xml,")).toBe(true);
    expect(md).not.toBe(ts);
  });
});
