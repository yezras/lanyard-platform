/**
 * Composer + attach menu helpers (lp-khq.5 / lp-khq.7).
 *
 * Pure helpers for skill/vault/workflow insert tokens and menu inventory.
 * UI lives in composerAttachMenu.tsx; / typeahead remains the power-user path.
 *
 * lp-khq.7: vault tree folder browse + path-specific Vault tab deep-link.
 */

import type { ChatComposerToken } from "@astryxdesign/core/Chat";

/** Skill row for the + → Skills nested list (snapshot-backed). */
export type AttachMenuSkill = {
  id: string;
  name: string;
  /** One-line summary when host provides it (lp-khq.6). */
  description?: string;
  enabled?: boolean;
};

/**
 * Normalize host skill/workflow descriptions for menu rows and typeahead.
 * Collapses whitespace to a single line and soft-caps length so long or
 * multi-line host text does not break layout (CSS still ellipsizes).
 */
export function oneLineDescription(
  value: string | null | undefined,
  maxLen = 120,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (!collapsed) return undefined;
  if (collapsed.length <= maxLen) return collapsed;
  const slice = collapsed.slice(0, Math.max(1, maxLen - 1));
  const lastSpace = slice.lastIndexOf(" ");
  const base =
    lastSpace > maxLen * 0.55 ? slice.slice(0, lastSpace) : slice;
  return `${base}…`;
}

/** Vault file row for the + → Select from vault list (flat fallback). */
export type AttachMenuVaultFile = {
  /** Absolute vault path (insert form). */
  path: string;
  /** Display basename. */
  name: string;
};

/**
 * Vault tree node for folder-browsing picker (lp-khq.7).
 * Mirrors {@link VaultTreeNode} shape without importing API types here.
 */
export type AttachMenuVaultTreeNode = {
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: AttachMenuVaultTreeNode[];
};

export type AttachMenuPanel = "root" | "skills" | "vault";

/** Serialized skill token — matches buildComposerTriggers `/` onSelect. */
export function skillInsertToken(skill: AttachMenuSkill): ChatComposerToken {
  const name = skill.name.trim() || skill.id.trim();
  const value = `/${name}`;
  return {
    value,
    label: value,
    variant: "yellow" as const,
  };
}

/** Plain text fallback when insertToken is unavailable. */
export function skillInsertText(skill: AttachMenuSkill): string {
  return skillInsertToken(skill).value;
}

/**
 * Path reference inserted into the composer for soft-open / agent resolve.
 * Uses the vault path as-is (leading `/` when present).
 */
export function vaultPathInsertText(file: AttachMenuVaultFile): string {
  const path = file.path.trim();
  if (!path) return file.name.trim();
  return path.startsWith("/") ? path : `/${path}`;
}

/**
 * Append a fragment to composer text with a single separating space when needed.
 */
export function appendComposerFragment(
  current: string,
  fragment: string,
): string {
  const piece = fragment.trim();
  if (!piece) return current;
  if (!current) return piece;
  if (/\s$/.test(current)) return `${current}${piece}`;
  return `${current} ${piece}`;
}

/** Enabled skills only, stable order from snapshot. */
export function attachableSkillsFromSnapshot(
  skills:
    | Array<{
        id: string;
        name: string;
        description?: string;
        enabled?: boolean;
      }>
    | null
    | undefined,
): AttachMenuSkill[] {
  if (!Array.isArray(skills) || skills.length === 0) return [];
  const out: AttachMenuSkill[] = [];
  const seen = new Set<string>();
  for (const row of skills) {
    if (!row || typeof row.id !== "string" || !row.id.trim()) continue;
    if (row.enabled === false) continue;
    const id = row.id.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    const name =
      typeof row.name === "string" && row.name.trim() ? row.name.trim() : id;
    const description = oneLineDescription(row.description);
    out.push({
      id,
      name,
      ...(description ? { description } : {}),
      enabled: true,
    });
  }
  return out;
}

/**
 * Flatten vault tree files into attach-menu rows (same walk as typeahead,
 * higher default limit for picker shell).
 */
export function vaultFilesForAttachMenu(
  nodes: Array<{
    name: string;
    path: string;
    kind: "file" | "directory";
    children?: Array<{
      name: string;
      path: string;
      kind: "file" | "directory";
      children?: unknown[];
    }>;
  }>,
  limit = 100,
): AttachMenuVaultFile[] {
  const items: AttachMenuVaultFile[] = [];

  const walk = (
    list: Array<{
      name: string;
      path: string;
      kind: "file" | "directory";
      children?: Array<{
        name: string;
        path: string;
        kind: "file" | "directory";
        children?: unknown[];
      }>;
    }>,
  ) => {
    for (const node of list) {
      if (items.length >= limit) return;
      if (node.kind === "file") {
        items.push({ path: node.path, name: node.name });
      } else if (node.children?.length) {
        walk(
          node.children as Array<{
            name: string;
            path: string;
            kind: "file" | "directory";
            children?: Array<{
              name: string;
              path: string;
              kind: "file" | "directory";
              children?: unknown[];
            }>;
          }>,
        );
      }
    }
  };

  walk(nodes);
  return items;
}

// ---------------------------------------------------------------------------
// lp-khq.7 — folder browse + Vault tab deep-link helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a vault browse path for comparisons.
 * Root (vault top) is represented as empty string; leading slash kept when present.
 */
export function normalizeVaultBrowsePath(
  path: string | null | undefined,
): string {
  if (path == null) return "";
  const trimmed = path.trim();
  if (!trimmed || trimmed === "/") return "";
  // Collapse trailing slashes but keep absolute form.
  const noTrail = trimmed.replace(/\/+$/, "");
  return noTrail === "/" ? "" : noTrail;
}

/** Sort dirs first, then files; stable by name within kind. */
export function sortVaultEntries(
  nodes: readonly AttachMenuVaultTreeNode[],
): AttachMenuVaultTreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "directory" ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

function pathKey(path: string): string {
  return normalizeVaultBrowsePath(path);
}

/** Find a tree node by absolute path (files or directories). */
export function findVaultTreeNode(
  roots: readonly AttachMenuVaultTreeNode[],
  path: string,
): AttachMenuVaultTreeNode | null {
  const target = pathKey(path);
  if (!target) return null;

  const walk = (
    list: readonly AttachMenuVaultTreeNode[],
  ): AttachMenuVaultTreeNode | null => {
    for (const node of list) {
      if (pathKey(node.path) === target) return node;
      if (node.kind === "directory" && node.children?.length) {
        const hit = walk(node.children);
        if (hit) return hit;
      }
    }
    return null;
  };

  return walk(roots);
}

/**
 * Children of `dirPath` for the folder picker.
 * Empty / `/` → vault roots. Directories first, then files.
 */
export function vaultEntriesAtPath(
  roots: readonly AttachMenuVaultTreeNode[],
  dirPath: string,
): AttachMenuVaultTreeNode[] {
  const target = pathKey(dirPath);
  if (!target) {
    return sortVaultEntries(roots);
  }
  const node = findVaultTreeNode(roots, target);
  if (!node || node.kind !== "directory") return [];
  return sortVaultEntries(node.children ?? []);
}

/**
 * Parent browse path for folder back-navigation.
 * Returns `null` when already at vault roots (caller should leave vault panel).
 * Returns `""` when parent is the vault root listing.
 */
export function vaultParentBrowsePath(dirPath: string): string | null {
  const p = pathKey(dirPath);
  if (!p) return null;
  const idx = p.lastIndexOf("/");
  if (idx <= 0) return "";
  return p.slice(0, idx);
}

/**
 * Path to hand to Vault tab deep-link (`openVaultPath`).
 * Root browse → `"/"`; nested folder keeps absolute path.
 */
export function vaultDeepLinkPath(browsePath: string): string {
  const p = pathKey(browsePath);
  return p || "/";
}

/** True when tree has at least one file or non-empty directory listing. */
export function vaultTreeHasContent(
  roots: readonly AttachMenuVaultTreeNode[] | null | undefined,
): boolean {
  return Array.isArray(roots) && roots.length > 0;
}

/** Display label for the current vault browse location (breadcrumb-ish). */
export function vaultBrowseLabel(browsePath: string): string {
  const p = pathKey(browsePath);
  if (!p) return "Vault root";
  const base = p.split("/").filter(Boolean).pop();
  return base || p;
}
