/**
 * lp-5q6.24 — Document key mint and revision invalidation.
 *
 * Acceptance:
 * - key includes tenant, stable path identity, content revision
 * - key conforms to ONLYOFFICE charset/length
 * - external write → new key or reload when clean; conflict when dirty
 * - same content stable key; changed content new key; cross-tenant unique; long paths
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  buildDocumentKeyMaterial,
  DOCUMENT_KEY_HEX_LENGTH,
  DocumentKeyMintError,
  evaluateDocumentKeyInvalidation,
  isValidOnlyOfficeDocumentKey,
  mintDocumentKey,
  ONLYOFFICE_DOCUMENT_KEY_MAX_LENGTH,
} from "../src/office/document-key.js";
import type { DocumentRevision } from "../src/office/types.js";

const REV_1: DocumentRevision = {
  token: "etag-abc123",
  kind: "etag",
  size_bytes: 1024,
};

const REV_2: DocumentRevision = {
  token: "etag-def456",
  kind: "etag",
  size_bytes: 2048,
};

const BASE_MINT = {
  tenant_id: "tenant-a",
  path: "/Projects/Acme/proposal.docx",
  revision: REV_1,
  mode: "edit" as const,
};

describe("mintDocumentKey", () => {
  it("is stable for the same tenant + path + revision + mode", () => {
    const a = mintDocumentKey(BASE_MINT);
    const b = mintDocumentKey({ ...BASE_MINT });
    expect(a).toBe(b);
    expect(isValidOnlyOfficeDocumentKey(a)).toBe(true);
  });

  it("includes tenant, normalized path, and revision in material", () => {
    const material = buildDocumentKeyMaterial(BASE_MINT);
    expect(material).toBe(
      "v1|tenant-a|/Projects/Acme/proposal.docx|etag-abc123|edit",
    );
    const expected = createHash("sha256").update(material, "utf8").digest("hex");
    expect(mintDocumentKey(BASE_MINT)).toBe(expected);
  });

  it("produces a new key when content revision changes", () => {
    const k1 = mintDocumentKey(BASE_MINT);
    const k2 = mintDocumentKey({ ...BASE_MINT, revision: REV_2 });
    expect(k1).not.toBe(k2);
  });

  it("produces different keys for different tenants (same path + revision)", () => {
    const kA = mintDocumentKey(BASE_MINT);
    const kB = mintDocumentKey({ ...BASE_MINT, tenant_id: "tenant-b" });
    expect(kA).not.toBe(kB);
  });

  it("hashes long paths (never uses raw path as key)", () => {
    const longSegment = "seg-".repeat(80);
    const longPath = `/Projects/${longSegment}/deep/file.docx`;
    expect(longPath.length).toBeGreaterThan(ONLYOFFICE_DOCUMENT_KEY_MAX_LENGTH);

    const key = mintDocumentKey({
      ...BASE_MINT,
      path: longPath,
    });
    expect(key.length).toBe(DOCUMENT_KEY_HEX_LENGTH);
    expect(key.length).toBeLessThanOrEqual(ONLYOFFICE_DOCUMENT_KEY_MAX_LENGTH);
    expect(key).not.toContain("/");
    expect(key).not.toContain("Projects");
    expect(isValidOnlyOfficeDocumentKey(key)).toBe(true);
  });

  it("normalizes path so equivalent paths share a key", () => {
    const withSlash = mintDocumentKey(BASE_MINT);
    const withoutLeading = mintDocumentKey({
      ...BASE_MINT,
      path: "Projects/Acme/proposal.docx",
    });
    expect(withSlash).toBe(withoutLeading);
  });

  it("differs for view vs edit mode (permission bleed hardening)", () => {
    const edit = mintDocumentKey(BASE_MINT);
    const view = mintDocumentKey({ ...BASE_MINT, mode: "view" });
    expect(edit).not.toBe(view);
  });

  it("conforms to ONLYOFFICE character and length constraints", () => {
    const key = mintDocumentKey(BASE_MINT);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key.length).toBeLessThanOrEqual(ONLYOFFICE_DOCUMENT_KEY_MAX_LENGTH);
    expect(isValidOnlyOfficeDocumentKey(key)).toBe(true);
    expect(isValidOnlyOfficeDocumentKey("not-a-hex-key!!")).toBe(false);
    expect(isValidOnlyOfficeDocumentKey("ab")).toBe(false);
  });

  it("fails closed without tenant, path, or revision token", () => {
    expect(() =>
      mintDocumentKey({ ...BASE_MINT, tenant_id: "" }),
    ).toThrow(DocumentKeyMintError);
    expect(() =>
      mintDocumentKey({ ...BASE_MINT, path: "" }),
    ).toThrow(DocumentKeyMintError);
    expect(() =>
      mintDocumentKey({ ...BASE_MINT, revision: { token: "" } }),
    ).toThrow(DocumentKeyMintError);
    expect(() =>
      mintDocumentKey({ ...BASE_MINT, path: "/Projects/../secret.docx" }),
    ).toThrow(DocumentKeyMintError);
  });
});

describe("evaluateDocumentKeyInvalidation", () => {
  it("returns none when revisions match", () => {
    const d = evaluateDocumentKeyInvalidation({
      base_revision_token: REV_1.token,
      current_revision_token: REV_1.token,
      dirty: false,
    });
    expect(d.action).toBe("none");
    expect(d.revisions_match).toBe(true);
  });

  it("returns reload with new key when clean and revision advanced (agent write)", () => {
    const d = evaluateDocumentKeyInvalidation({
      base_revision_token: REV_1.token,
      current_revision_token: REV_2.token,
      dirty: false,
      mint: { ...BASE_MINT, revision: REV_1 },
    });
    expect(d.action).toBe("reload");
    if (d.action !== "reload") return;
    expect(d.auto_refresh).toBe(true);
    expect(d.new_document_key).toBe(
      mintDocumentKey({ ...BASE_MINT, revision: REV_2 }),
    );
    expect(d.new_document_key).not.toBe(mintDocumentKey(BASE_MINT));
  });

  it("returns conflict without auto-refresh when dirty (human edit)", () => {
    const d = evaluateDocumentKeyInvalidation({
      base_revision_token: REV_1.token,
      current_revision_token: REV_2.token,
      dirty: true,
    });
    expect(d.action).toBe("conflict");
    if (d.action !== "conflict") return;
    expect(d.auto_refresh).toBe(false);
    expect(d.session_lifecycle).toBe("superseded_base");
    expect(d.banner_message.toLowerCase()).toContain("changed");
    expect(d.offered_actions).toContain("reload");
    expect(d.offered_actions).toContain("discard_local");
  });
});
