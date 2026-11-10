import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createFsOfficeCallbackVaultWriter } from "../src/office/fs-callback-writer.js";
import type { OfficeDocumentSession } from "../src/office/store.js";

const session = {
  session_id: "sess_1",
  tenant_id: "ten_1",
  user_id: "usr_1",
} as OfficeDocumentSession;

describe("createFsOfficeCallbackVaultWriter", () => {
  it("writes callback bytes under the vault root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "office-vault-"));
    const writer = createFsOfficeCallbackVaultWriter(root);
    const bytes = Buffer.from("edited-docx-bytes");
    const result = await writer({
      session,
      params: {
        path: "/notes/roundtrip.docx",
        mode: "replace_if_match",
        encoding: "base64",
        content: bytes.toString("base64"),
        sizeBytes: bytes.byteLength,
        idempotencyKey: "idem_1",
      },
    });
    const written = await readFile(path.join(root, "notes", "roundtrip.docx"));
    expect(written.equals(bytes)).toBe(true);
    expect(result.path).toBe("/notes/roundtrip.docx");
    expect(result.size_bytes).toBe(bytes.byteLength);
    expect(result.revision.kind).toBe("content_hash");
    expect(result.source).toBe("fs_vault_root");
  });

  it("refuses a path that escapes the vault root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "office-vault-"));
    const writer = createFsOfficeCallbackVaultWriter(root);
    await expect(
      writer({
        session,
        params: {
          path: "/../outside.txt",
          mode: "replace_if_match",
          encoding: "utf-8",
          content: "nope",
          sizeBytes: 4,
          idempotencyKey: "idem_2",
        },
      }),
    ).rejects.toThrow(/Invalid vault path/);
  });
});