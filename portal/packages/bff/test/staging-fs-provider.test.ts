import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createFsStagingStorageProvider } from "../src/staging/fs-provider.js";

describe("createFsStagingStorageProvider (lp-uxy.21.5)", () => {
  it("writes logical /staging/uploads paths under fsRoot", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "staging-fs-"));
    const provider = createFsStagingStorageProvider(root);
    const logical = "/staging/uploads/Clients/sample.docx";
    const bytes = new TextEncoder().encode("hello-staging");
    const record = await provider.writeFile({
      path: logical,
      filename: "sample.docx",
      mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes,
    });
    expect(record.path).toBe(logical);
    expect(record.size_bytes).toBe(bytes.byteLength);

    const disk = path.join(root, "Clients", "sample.docx");
    expect(await readFile(disk, "utf8")).toBe("hello-staging");

    const listed = await provider.listFiles();
    expect(listed.map((f) => f.path)).toContain(logical);

    const read = await provider.readFile(logical);
    expect(read?.size_bytes).toBe(bytes.byteLength);
  });

  it("refuses path escape", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "staging-fs-"));
    const provider = createFsStagingStorageProvider(root);
    await expect(
      provider.writeFile({
        path: "/etc/passwd",
        filename: "passwd",
        mime_type: "text/plain",
        bytes: new Uint8Array([1]),
      }),
    ).rejects.toThrow(/under \/staging\/uploads/);
  });
});
