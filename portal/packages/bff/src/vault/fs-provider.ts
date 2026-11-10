import { lstat, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { normalizeVaultPath } from "@lanyard/shared";

import { isTextMime, mimeForPath } from "./mime.js";
import {
  DEFAULT_VAULT_READ_MAX_BYTES,
  isLexicallyUnderRoot,
  resolveContainedRealpath,
} from "./path-security.js";
import type {
  VaultContentProvider,
  VaultEntry,
  VaultFileContent,
  VaultTreeNode,
} from "./types.js";

const DEFAULT_MAX_DEPTH = 8;

export type FsVaultContentProviderOptions = {
  /** Max directory depth from vault root (root = 0). Default 8. */
  maxDepth?: number;
  /**
   * Max bytes for a single vault content read (whole file buffered).
   * Default {@link DEFAULT_VAULT_READ_MAX_BYTES} (10 MiB).
   */
  maxReadBytes?: number;
};

/**
 * Filesystem-backed vault content for local dev when `VAULT_ROOT` is set.
 * Vault paths are POSIX paths relative to the configured root (`/` = root).
 * ACL filtering is applied by {@link VaultService}, not here.
 *
 * Symlink safety: list/stat/read only expose targets whose realpath stays
 * under the realpath of `VAULT_ROOT`. Outside-root symlinks are skipped
 * (list) or refused (read).
 */
export function createFsVaultContentProvider(
  root: string,
  options: FsVaultContentProviderOptions = {},
): VaultContentProvider {
  const absoluteRoot = path.resolve(root);
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxReadBytes = options.maxReadBytes ?? DEFAULT_VAULT_READ_MAX_BYTES;

  function toFsPath(rawVaultPath: string): string {
    const vaultPath = normalizeVaultPath(rawVaultPath);
    if (vaultPath === "/") {
      return absoluteRoot;
    }
    const relative = vaultPath.slice(1);
    const full = path.resolve(absoluteRoot, ...relative.split("/"));
    assertUnderRootLexical(full);
    return full;
  }

  function toVaultPath(fsPath: string): string {
    const relative = path.relative(absoluteRoot, fsPath);
    if (!relative || relative === ".") {
      return "/";
    }
    return `/${relative.split(path.sep).join("/")}`;
  }

  function assertUnderRootLexical(full: string): void {
    if (!isLexicallyUnderRoot(absoluteRoot, full)) {
      throw new Error("Vault path escapes VAULT_ROOT");
    }
  }

  /**
   * Canonical containment: realpath(target) must stay under realpath(root).
   * Returns the resolved path or null when missing / outside root.
   */
  async function resolveSafe(fsPath: string): Promise<string | null> {
    return resolveContainedRealpath(absoluteRoot, fsPath);
  }

  async function listDirectory(fsDir: string): Promise<VaultEntry[]> {
    let names: string[];
    try {
      names = await readdir(fsDir);
    } catch {
      return [];
    }

    const entries: VaultEntry[] = [];
    for (const name of names) {
      if (name.startsWith(".")) {
        continue;
      }
      const full = path.join(fsDir, name);

      // lstat first so we can decide without following the link.
      let linkInfo;
      try {
        linkInfo = await lstat(full);
      } catch {
        continue;
      }

      // Reject symlink targets that escape the vault root.
      const contained = await resolveSafe(full);
      if (contained === null) {
        continue;
      }

      let info;
      try {
        // After containment, use the resolved path (or lstat for non-links).
        info = linkInfo.isSymbolicLink() ? await stat(contained) : linkInfo;
      } catch {
        continue;
      }

      const vaultPath = toVaultPath(full);
      if (info.isDirectory()) {
        entries.push({ name, path: vaultPath, kind: "directory" });
      } else if (info.isFile()) {
        entries.push({
          name,
          path: vaultPath,
          kind: "file",
          mime_type: mimeForPath(name),
        });
      }
    }

    return entries.sort(compareEntries);
  }

  async function buildTree(
    fsDir: string,
    depth: number,
  ): Promise<VaultTreeNode[]> {
    if (depth > maxDepth) {
      return [];
    }

    const entries = await listDirectory(fsDir);
    const nodes: VaultTreeNode[] = [];

    for (const entry of entries) {
      if (entry.kind === "directory") {
        const children =
          depth < maxDepth
            ? await buildTree(toFsPath(entry.path), depth + 1)
            : [];
        nodes.push({
          name: entry.name,
          path: entry.path,
          kind: "directory",
          children,
        });
      } else {
        nodes.push({
          name: entry.name,
          path: entry.path,
          kind: "file",
          mime_type: entry.mime_type,
        });
      }
    }

    return nodes;
  }

  return {
    async listEntries(rawPath: string): Promise<VaultEntry[]> {
      const fsPath = toFsPath(rawPath);
      const contained = await resolveSafe(fsPath);
      if (contained === null) {
        return [];
      }
      let info;
      try {
        info = await stat(contained);
      } catch {
        return [];
      }
      if (!info.isDirectory()) {
        return [];
      }
      // List via the original lexical path so vault paths stay under the root
      // mapping; contained realpath is only used for safety checks.
      return listDirectory(fsPath);
    },

    async readFile(rawPath: string): Promise<VaultFileContent | null> {
      const fsPath = toFsPath(rawPath);
      const contained = await resolveSafe(fsPath);
      if (contained === null) {
        return null;
      }

      let info;
      try {
        info = await stat(contained);
      } catch {
        return null;
      }
      if (!info.isFile()) {
        return null;
      }
      if (info.size > maxReadBytes) {
        return null;
      }

      const mime = mimeForPath(fsPath);
      const vaultPath = toVaultPath(fsPath);

      if (isTextMime(mime)) {
        const content = await readFile(contained, "utf-8");
        return {
          path: vaultPath,
          kind: "file",
          mime_type: mime,
          encoding: "utf-8",
          content,
          size_bytes: Buffer.byteLength(content, "utf-8"),
        };
      }

      const buffer = await readFile(contained);
      return {
        path: vaultPath,
        kind: "file",
        mime_type: mime,
        encoding: "base64",
        content: buffer.toString("base64"),
        size_bytes: buffer.length,
      };
    },

    async getTree(): Promise<VaultTreeNode[]> {
      return buildTree(absoluteRoot, 0);
    },
  };
}

function compareEntries(a: VaultEntry, b: VaultEntry): number {
  if (a.kind !== b.kind) {
    return a.kind === "directory" ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}
