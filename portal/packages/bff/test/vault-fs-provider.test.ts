import { mkdtemp, mkdir, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFsVaultContentProvider } from "../src/vault/fs-provider.js";
import { DEFAULT_VAULT_READ_MAX_BYTES } from "../src/vault/path-security.js";

describe("createFsVaultContentProvider", () => {
  let root: string;
  let outside: string | undefined;

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
    }
    if (outside) {
      await rm(outside, { recursive: true, force: true });
      outside = undefined;
    }
  });

  it("lists and reads files under VAULT_ROOT as vault paths", async () => {
    root = await mkdtemp(path.join(tmpdir(), "vault-fs-"));
    await mkdir(path.join(root, "Projects", "A"), { recursive: true });
    await writeFile(
      path.join(root, "Projects", "A", "README.md"),
      "# Hello\n",
      "utf-8",
    );
    await writeFile(path.join(root, "notes.txt"), "top-level\n", "utf-8");
    // Hidden entries are skipped
    await writeFile(path.join(root, ".secret"), "nope\n", "utf-8");

    const provider = createFsVaultContentProvider(root);

    const rootEntries = await provider.listEntries("/");
    const rootPaths = rootEntries.map((e) => e.path);
    expect(rootPaths).toContain("/Projects");
    expect(rootPaths).toContain("/notes.txt");
    expect(rootPaths).not.toContain("/.secret");

    const tree = await provider.getTree();
    expect(tree.some((n) => n.path === "/Projects")).toBe(true);
    const projects = tree.find((n) => n.path === "/Projects");
    expect(projects?.kind).toBe("directory");
    expect(
      projects?.children?.some((c) => c.path === "/Projects/A"),
    ).toBe(true);

    const file = await provider.readFile("/Projects/A/README.md");
    expect(file).not.toBeNull();
    expect(file?.mime_type).toBe("text/markdown");
    expect(file?.encoding).toBe("utf-8");
    expect(file?.content).toContain("# Hello");
  });

  it("returns null for missing files and empty list for missing dirs", async () => {
    root = await mkdtemp(path.join(tmpdir(), "vault-fs-empty-"));
    const provider = createFsVaultContentProvider(root);

    expect(await provider.readFile("/missing.md")).toBeNull();
    expect(await provider.listEntries("/no-such-dir")).toEqual([]);
  });

  it("refuses symlink breakout on read and omits outside-root links from list", async () => {
    root = await mkdtemp(path.join(tmpdir(), "vault-fs-sym-"));
    outside = await mkdtemp(path.join(tmpdir(), "vault-fs-out-"));
    const secretPath = path.join(outside, "secret.txt");
    await writeFile(secretPath, "HOST_SECRET\n", "utf-8");
    await writeFile(path.join(root, "safe.md"), "inside\n", "utf-8");

    // File symlink pointing outside the vault root.
    await symlink(secretPath, path.join(root, "escape.txt"));
    // Directory symlink pointing outside the vault root.
    await symlink(outside, path.join(root, "escape-dir"));

    const provider = createFsVaultContentProvider(root);

    expect(await provider.readFile("/escape.txt")).toBeNull();
    expect(await provider.readFile("/escape-dir/secret.txt")).toBeNull();

    const entries = await provider.listEntries("/");
    const names = entries.map((e) => e.name);
    expect(names).toContain("safe.md");
    expect(names).not.toContain("escape.txt");
    expect(names).not.toContain("escape-dir");

    const tree = await provider.getTree();
    const treeNames = tree.map((n) => n.name);
    expect(treeNames).toContain("safe.md");
    expect(treeNames).not.toContain("escape.txt");
    expect(treeNames).not.toContain("escape-dir");

    // In-root symlink to an allowed file is still readable.
    await symlink(path.join(root, "safe.md"), path.join(root, "alias.md"));
    const alias = await provider.readFile("/alias.md");
    expect(alias?.content).toContain("inside");
  });

  it("refuses reads larger than the documented max byte cap", async () => {
    root = await mkdtemp(path.join(tmpdir(), "vault-fs-cap-"));
    const cap = 64;
    await writeFile(path.join(root, "big.txt"), "x".repeat(cap + 1), "utf-8");
    await writeFile(path.join(root, "ok.txt"), "y".repeat(cap), "utf-8");

    const provider = createFsVaultContentProvider(root, { maxReadBytes: cap });
    expect(await provider.readFile("/big.txt")).toBeNull();
    expect((await provider.readFile("/ok.txt"))?.content).toBe("y".repeat(cap));
    // Documented default exists and is finite.
    expect(DEFAULT_VAULT_READ_MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  it("maps expanded text/code mime types and returns utf-8 encoding", async () => {
    root = await mkdtemp(path.join(tmpdir(), "vault-fs-mime-"));
    const samples: Array<{ name: string; mime: string; body: string }> = [
      { name: "data.csv", mime: "text/csv", body: "a,b\n1,2\n" },
      { name: "data.tsv", mime: "text/tab-separated-values", body: "a\tb\n" },
      { name: "page.html", mime: "text/html", body: "<p>hi</p>" },
      { name: "app.ts", mime: "text/typescript", body: "const x = 1;\n" },
      { name: "app.tsx", mime: "text/typescript", body: "export const X = 1;\n" },
      { name: "cfg.json", mime: "application/json", body: '{"a":1}\n' },
      { name: "main.py", mime: "text/x-python", body: "print(1)\n" },
      { name: "main.go", mime: "text/x-go", body: "package main\n" },
      { name: "lib.rs", mime: "text/x-rust", body: "fn main() {}\n" },
      { name: "run.sh", mime: "text/x-shellscript", body: "#!/bin/sh\n" },
      { name: "cfg.yaml", mime: "text/yaml", body: "a: 1\n" },
      { name: "cfg.toml", mime: "text/toml", body: "a = 1\n" },
      { name: "doc.xml", mime: "application/xml", body: "<a/>\n" },
      { name: "q.sql", mime: "application/sql", body: "SELECT 1;\n" },
    ];

    for (const sample of samples) {
      await writeFile(path.join(root, sample.name), sample.body, "utf-8");
    }

    const provider = createFsVaultContentProvider(root);

    for (const sample of samples) {
      const file = await provider.readFile(`/${sample.name}`);
      expect(file, sample.name).not.toBeNull();
      expect(file?.mime_type, sample.name).toBe(sample.mime);
      expect(file?.encoding, sample.name).toBe("utf-8");
      expect(file?.content, sample.name).toBe(sample.body);
    }

    const entries = await provider.listEntries("/");
    const csv = entries.find((e) => e.name === "data.csv");
    expect(csv?.mime_type).toBe("text/csv");
  });
});
