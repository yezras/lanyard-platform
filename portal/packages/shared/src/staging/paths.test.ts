import { describe, expect, it } from "vitest";

import {
  STAGING_UPLOADS_ROOT,
  assertStagingUploadDestination,
  buildStagingUploadPath,
  isStagingPathAllowed,
  sanitizeUploadFilename,
} from "./paths.js";

describe("staging paths (#14)", () => {
  it("sanitizes unsafe filenames", () => {
    expect(sanitizeUploadFilename("../../evil.pdf")).toBe("evil.pdf");
    expect(sanitizeUploadFilename("my doc (1).txt")).toBe("my_doc_1_.txt");
  });

  it("builds project-scoped upload paths", () => {
    expect(buildStagingUploadPath("/Projects/A", "notes.md")).toBe(
      `${STAGING_UPLOADS_ROOT}/Projects/A/notes.md`,
    );
    expect(buildStagingUploadPath(null, "notes.md")).toBe(
      `${STAGING_UPLOADS_ROOT}/_inbox/notes.md`,
    );
  });

  it("enforces ACL on destination paths", () => {
    const allowedA = assertStagingUploadDestination(
      ["/Projects/A"],
      "/Projects/A",
      "brief.pdf",
    );
    expect(allowedA.path).toBe(`${STAGING_UPLOADS_ROOT}/Projects/A/brief.pdf`);

    expect(() =>
      assertStagingUploadDestination(["/Projects/A"], "/Projects/B", "x.md"),
    ).toThrow(/not permitted/i);
  });

  it("allows full-access users to use inbox", () => {
    const path = buildStagingUploadPath(null, "shared.txt");
    expect(isStagingPathAllowed(["/"], path)).toBe(true);
    expect(isStagingPathAllowed(["/Projects/A"], path)).toBe(false);
  });
});