import { isVaultPathAllowed, normalizeVaultPath } from "@lanyard/shared";

import type { VaultEntry, VaultTreeNode } from "./types.js";

export function filterEntriesByAcl(
  allowedPrefixes: readonly string[],
  entries: readonly VaultEntry[],
): VaultEntry[] {
  return entries.filter((entry) =>
    isVaultPathAllowed(allowedPrefixes, entry.path),
  );
}

export function filterTreeByAcl(
  allowedPrefixes: readonly string[],
  nodes: readonly VaultTreeNode[],
): VaultTreeNode[] {
  const result: VaultTreeNode[] = [];

  for (const node of nodes) {
    const normalized = normalizeVaultPath(node.path);
    const allowed = isVaultPathAllowed(allowedPrefixes, normalized);

    if (!allowed) {
      continue;
    }

    const children = node.children
      ? filterTreeByAcl(allowedPrefixes, node.children)
      : undefined;

    result.push({
      ...node,
      path: normalized,
      description: node.description,
      children: children && children.length > 0 ? children : undefined,
    });
  }

  return result;
}

/** Roots for the tree UI: one node per allowed prefix with pruned subtree. */
export function buildAclRoots(
  allowedPrefixes: readonly string[],
  fullTree: readonly VaultTreeNode[],
): VaultTreeNode[] {
  const filtered = filterTreeByAcl(allowedPrefixes, fullTree);
  const roots: VaultTreeNode[] = [];
  const seen = new Set<string>();

  for (const prefix of allowedPrefixes) {
    const normalizedPrefix = normalizeVaultPath(prefix);

    // Full vault access: return filtered top-level nodes as-is (fixture tree
    // under `/Projects/...`, or multi-root Hermes absolute project paths).
    if (normalizedPrefix === "/") {
      for (const node of filtered) {
        if (!seen.has(node.path)) {
          seen.add(node.path);
          roots.push(node);
        }
      }
      continue;
    }

    const match = findSubtree(filtered, normalizedPrefix);
    if (match) {
      if (!seen.has(match.path)) {
        seen.add(match.path);
        roots.push(match);
      }
      continue;
    }

    if (isVaultPathAllowed(allowedPrefixes, normalizedPrefix)) {
      if (!seen.has(normalizedPrefix)) {
        seen.add(normalizedPrefix);
        roots.push({
          name: segmentName(normalizedPrefix),
          path: normalizedPrefix,
          kind: "directory",
          children: [],
        });
      }
    }
  }

  return roots;
}

function findSubtree(
  nodes: readonly VaultTreeNode[],
  path: string,
): VaultTreeNode | null {
  for (const node of nodes) {
    if (node.path === path) {
      return node;
    }
    if (node.children) {
      const found = findSubtree(node.children, path);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function segmentName(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? path;
}