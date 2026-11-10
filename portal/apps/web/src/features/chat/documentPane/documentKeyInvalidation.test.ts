/**
 * lp-5q6.24 — Web revision invalidation / conflict banner policy.
 */
import { describe, expect, it } from "vitest";

import {
  buildSupersededBaseConflict,
  evaluateDocumentKeyInvalidation,
  shouldAutoRefreshOnRevisionAdvance,
} from "./documentKeyInvalidation.js";
import type { DocumentRevision } from "./types.js";

const PATH = "/Projects/Acme/proposal.docx";
const REV_1: DocumentRevision = { token: "etag-1", kind: "etag" };
const REV_2: DocumentRevision = { token: "etag-2", kind: "etag" };

describe("evaluateDocumentKeyInvalidation", () => {
  it("none when revisions match", () => {
    const d = evaluateDocumentKeyInvalidation({
      baseRevisionToken: REV_1.token,
      currentRevisionToken: REV_1.token,
      dirty: false,
      path: PATH,
    });
    expect(d.action).toBe("none");
    expect(d.revisionsMatch).toBe(true);
  });

  it("reload (autoRefresh) when clean and external revision advances", () => {
    const d = evaluateDocumentKeyInvalidation({
      baseRevisionToken: REV_1.token,
      currentRevisionToken: REV_2.token,
      dirty: false,
      path: PATH,
      baseRevision: REV_1,
      currentRevision: REV_2,
    });
    expect(d.action).toBe("reload");
    if (d.action !== "reload") return;
    expect(d.autoRefresh).toBe(true);
    expect(d.reason).toBe("external_revision_advance");
  });

  it("conflict banner when dirty human edit and external revision advances", () => {
    const d = evaluateDocumentKeyInvalidation({
      baseRevisionToken: REV_1.token,
      currentRevisionToken: REV_2.token,
      dirty: true,
      path: PATH,
      baseRevision: REV_1,
      currentRevision: REV_2,
    });
    expect(d.action).toBe("conflict");
    if (d.action !== "conflict") return;
    expect(d.autoRefresh).toBe(false);
    expect(d.conflict.reason).toBe("superseded_base");
    expect(d.conflict.path).toBe(PATH);
    expect(d.conflict.expectedRevision).toEqual(REV_1);
    expect(d.conflict.actualRevision).toEqual(REV_2);
    expect(d.conflict.offeredActions).toContain("reload");
    expect(d.conflict.message.toLowerCase()).toMatch(/changed|reload/);
  });
});

describe("shouldAutoRefreshOnRevisionAdvance", () => {
  it("blocks auto-refresh when dirty", () => {
    expect(
      shouldAutoRefreshOnRevisionAdvance({
        dirty: true,
        baseRevisionToken: REV_1.token,
        currentRevisionToken: REV_2.token,
      }),
    ).toBe(false);
  });

  it("allows auto-refresh when clean and revision advanced", () => {
    expect(
      shouldAutoRefreshOnRevisionAdvance({
        dirty: false,
        baseRevisionToken: REV_1.token,
        currentRevisionToken: REV_2.token,
      }),
    ).toBe(true);
  });
});

describe("buildSupersededBaseConflict", () => {
  it("offers reload and discard_local", () => {
    const c = buildSupersededBaseConflict({
      path: PATH,
      expectedRevision: REV_1,
      actualRevision: REV_2,
    });
    expect(c.reason).toBe("superseded_base");
    expect(c.offeredActions).toEqual(
      expect.arrayContaining(["reload", "discard_local", "save_as_conflict_copy"]),
    );
  });
});
