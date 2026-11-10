/**
 * Multi-root filesystem vault provider for Hermes project folders.
 * Vault paths are absolute POSIX paths under one of the configured roots.
 * ACL filtering is applied by {@link VaultService}, not here.
 *
 * Symlink safety: matching and I/O use realpath containment against the
 * configured roots (not only lexical path prefixes). Outside-root symlink
 * targets are skipped on list and refused on read.
 */

import { lstat, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { normalizeVaultPath } from "@lanyard/shared";

import { isTextMime, mimeForPath } from "./mime.js";
import {
  DEFAULT_VAULT_READ_MAX_BYTES,
  findContainingRootRealpath,
  isLexicallyUnderRoot,
  safeRealpath,
} from "./path-security.js";
import type {
  VaultContentProvider,
  VaultEntry,
  VaultFileContent,
  VaultTreeNode,
} from "./types.js";

const DEFAULT_MAX_DEPTH = 8;

export type MultiRootFsRoot = {
  /** Absolute filesystem path of the root folder. */
  absolutePath: string;
  /** Display name (on-disk basename or folder label). */
  name: string;
  /** Supporting text — typically the absolute path. */
  description?: string;
};

export type MultiRootFsVaultContentProviderOptions = {
  maxDepth?: number;
  /**
   * Max bytes for a single vault content read (whole file buffered).
   * Default {@link DEFAULT_VAULT_READ_MAX_BYTES} (10 MiB).
   */
  maxReadBytes?: number;
  /**
   * Resolve roots on each tree/list/read call so Hermes project changes
   * appear without restarting the BFF.
   */
  getRoots: () => MultiRootFsRoot[] | Promise<MultiRootFsRoot[]>;
};

export function createMultiRootFsVaultContentProvider(
  options: MultiRootFsVaultContentProviderOptions,
): VaultContentProvider {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxReadBytes = options.maxReadBytes ?? DEFAULT_VAULT_READ_MAX_BYTES;

  async function resolveRoots(): Promise<
    Array<MultiRootFsRoot & { absolutePath: string }>
  > {
    const roots = await options.getRoots();
    return roots.map((root) => ({
      ...root,
      absolutePath: path.resolve(root.absolutePath),
    }));
  }

  /** Lexical longest-prefix match (fast path / vault path mapping). */
  function findRootLexical(
    roots: Array<MultiRootFsRoot & { absolutePath: string }>,
    fullPath: string,
  ): (MultiRootFsRoot & { absolutePath: string }) | null {
    const normalized = path.resolve(fullPath);
    let best: (MultiRootFsRoot & { absolutePath: string }) | null = null;
    for (const root of roots) {
      if (isLexicallyUnderRoot(root.absolutePath, normalized)) {
        if (
          !best ||
          root.absolutePath.length > best.absolutePath.length
        ) {
          best = root;
        }
      }
    }
    return best;
  }

  function toVaultPath(fsPath: string): string {
    // Absolute multi-root: vault path is the absolute POSIX path.
    return path.resolve(fsPath).split(path.sep).join("/");
  }

  function toFsPath(
    roots: Array<MultiRootFsRoot & { absolutePath: string }>,
    rawVaultPath: string,
  ): string {
    const vaultPath = normalizeVaultPath(rawVaultPath);
    // Map vault path (POSIX absolute) onto the host FS.
    const full =
      path.sep === "/"
        ? vaultPath
        : vaultPath.replace(/\//g, path.sep);
    const resolved = path.resolve(full);
    if (!findRootLexical(roots, resolved)) {
      throw new Error("Vault path is outside configured project roots");
    }
    return resolved;
  }

  /**
   * Canonical multi-root match: realpath(target) must sit under the realpath
   * of at least one configured root (longest-prefix wins).
   */
  async function resolveSafe(
    roots: Array<MultiRootFsRoot & { absolutePath: string }>,
    fsPath: string,
  ): Promise<string | null> {
    const match = await findContainingRootRealpath(roots, fsPath);
    return match?.realPath ?? null;
  }

  async function listDirectory(
    roots: Array<MultiRootFsRoot & { absolutePath: string }>,
    fsDir: string,
  ): Promise<VaultEntry[]> {
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

      let linkInfo;
      try {
        linkInfo = await lstat(full);
      } catch {
        continue;
      }

      // Refuse outside-root symlink targets (and missing/broken links).
      const contained = await resolveSafe(roots, full);
      if (contained === null) {
        continue;
      }

      let info;
      try {
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

  async function buildSubtree(
    roots: Array<MultiRootFsRoot & { absolutePath: string }>,
    fsDir: string,
    depth: number,
  ): Promise<VaultTreeNode[]> {
    if (depth > maxDepth) {
      return [];
    }

    const entries = await listDirectory(roots, fsDir);
    const nodes: VaultTreeNode[] = [];

    for (const entry of entries) {
      if (entry.kind === "directory") {
        const children =
          depth < maxDepth
            ? await buildSubtree(
                roots,
                path.resolve(
                  path.sep === "/"
                    ? entry.path
                    : entry.path.replace(/\//g, path.sep),
                ),
                depth + 1,
              )
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
      const roots = await resolveRoots();
      if (roots.length === 0) {
        return [];
      }

      // Listing "/" returns the project roots as directory entries.
      const vaultPath = normalizeVaultPath(rawPath);
      if (vaultPath === "/") {
        return roots
          .map((root) => ({
            name: root.name,
            path: toVaultPath(root.absolutePath),
            kind: "directory" as const,
          }))
          .sort(compareEntries);
      }

      let fsPath: string;
      try {
        fsPath = toFsPath(roots, vaultPath);
      } catch {
        return [];
      }

      const contained = await resolveSafe(roots, fsPath);
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
      return listDirectory(roots, fsPath);
    },

    async readFile(rawPath: string): Promise<VaultFileContent | null> {
      const roots = await resolveRoots();
      if (roots.length === 0) {
        return null;
      }

      let fsPath: string;
      try {
        fsPath = toFsPath(roots, rawPath);
      } catch {
        return null;
      }

      // Canonical containment — not only lexical path prefixes.
      const contained = await resolveSafe(roots, fsPath);
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
      const roots = await resolveRoots();
      const nodes: VaultTreeNode[] = [];

      for (const root of roots) {
        const rootReal = await safeRealpath(root.absolutePath);
        if (rootReal === null) {
          // Missing folder still shows as an empty project root.
          nodes.push({
            name: root.name,
            path: toVaultPath(root.absolutePath),
            kind: "directory",
            description: root.description ?? toVaultPath(root.absolutePath),
            children: [],
          });
          continue;
        }

        let info;
        try {
          info = await stat(rootReal);
        } catch {
          nodes.push({
            name: root.name,
            path: toVaultPath(root.absolutePath),
            kind: "directory",
            description: root.description ?? toVaultPath(root.absolutePath),
            children: [],
          });
          continue;
        }

        if (!info.isDirectory()) {
          continue;
        }

        const children = await buildSubtree(roots, root.absolutePath, 0);
        nodes.push({
          name: root.name,
          path: toVaultPath(root.absolutePath),
          kind: "directory",
          description: root.description ?? toVaultPath(root.absolutePath),
          children,
        });
      }

      return nodes;
    },
  };
}

function compareEntries(a: VaultEntry, b: VaultEntry): number {
  if (a.kind !== b.kind) {
    return a.kind === "directory" ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}
