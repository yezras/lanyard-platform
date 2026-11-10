/**
 * Pane path resolution for chat document open targets.
 *
 * Bead: lp-5q6.12
 * Shares project/citation join rules with vaultPaths.ts (HOW path identity).
 *
 * Empty / traversal / non-path inputs fail closed at the open boundary so the
 * reducer never receives an unusable ref.
 */

import {
  resolveVaultCitationClickPath,
  resolveVaultCitationPath,
} from "../../vault/vaultPaths.js";

import type { VaultArtifactRef, VaultPath } from "./types.js";

export type PanePathResolveOptions = {
  /** Active chat project vault root (POSIX). Joins relative citation paths. */
  projectVaultPath?: string | null;
  /** Provenance for analytics / UI only. */
  source?: VaultArtifactRef["source"];
  /** Optional display title when input has none. */
  title?: string | null;
};

export type PanePathResolveSuccess = {
  ok: true;
  ref: VaultArtifactRef;
  /** Path after citation/project join, before final normalization. */
  resolvedPath: VaultPath;
};

export type PanePathResolveFailure = {
  ok: false;
  code: "empty" | "invalid_path";
  message: string;
  raw: string;
};

export type PanePathResolveResult =
  | PanePathResolveSuccess
  | PanePathResolveFailure;

/**
 * Normalize a vault path for pane identity: leading `/`, collapse `//`,
 * reject empty and `..` / `.` segments. Returns null when unusable.
 *
 * Mirrors shared `normalizeArtifactVaultPath` so pane and event paths agree.
 */
export function normalizePaneVaultPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let path = trimmed.replace(/^file:\/\//i, "");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return null;
    }
  }

  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/{2,}/g, "/");
  // Drop trailing slash except for root
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }

  const segments = path.split("/").filter((s) => s.length > 0);
  if (segments.some((s) => s === ".." || s === ".")) return null;
  if (segments.length === 0) return null;

  return `/${segments.join("/")}`;
}

function basenameTitle(path: VaultPath): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

/**
 * Resolve a raw citation, tool target, or deep-link path into a
 * {@link VaultArtifactRef} suitable for PANEL_OPEN.
 *
 * Uses {@link resolveVaultCitationPath} / {@link resolveVaultCitationClickPath}
 * so multi-root project join rules stay shared with Vault/chat citations.
 */
export function resolvePaneArtifactRef(
  pathOrHref: string,
  options: PanePathResolveOptions = {},
): PanePathResolveResult {
  const raw = pathOrHref.trim();
  if (!raw) {
    return {
      ok: false,
      code: "empty",
      message: "Path is empty",
      raw: pathOrHref,
    };
  }

  // Reject obvious traversal before join so we never open a parent path.
  if (/(^|\/)\.\.(\/|$)/.test(raw.replace(/^file:\/\//i, ""))) {
    return {
      ok: false,
      code: "invalid_path",
      message: "Path must not contain '..' segments",
      raw,
    };
  }

  const projectRoot = options.projectVaultPath;
  const joined = /^https?:\/\//i.test(raw)
    ? resolveVaultCitationClickPath(raw, projectRoot)
    : resolveVaultCitationPath(raw, projectRoot);

  if (!joined || !joined.trim()) {
    return {
      ok: false,
      code: "invalid_path",
      message: "Could not resolve path for document pane",
      raw,
    };
  }

  const normalized = normalizePaneVaultPath(joined);
  if (!normalized) {
    return {
      ok: false,
      code: "invalid_path",
      message: "Resolved path is not a valid vault path",
      raw,
    };
  }

  const title =
    (options.title?.trim() ? options.title.trim() : undefined) ??
    basenameTitle(normalized);

  const ref: VaultArtifactRef = {
    path: normalized,
    title,
  };
  if (options.source) ref.source = options.source;

  return { ok: true, ref, resolvedPath: normalized };
}

/**
 * True when two refs point at the same vault document for pane identity.
 * Compares normalized paths only (title/source are not identity).
 */
export function samePaneArtifactPath(
  a: VaultArtifactRef | null | undefined,
  b: VaultArtifactRef | null | undefined,
): boolean {
  if (!a?.path || !b?.path) return false;
  const na = normalizePaneVaultPath(a.path);
  const nb = normalizePaneVaultPath(b.path);
  return na != null && nb != null && na === nb;
}

/**
 * Compare revision tokens for equality (opaque string compare).
 * Host CAS may use constant-time equality; UI only needs presence match.
 */
export function sameDocumentRevision(
  a: { token: string } | null | undefined,
  b: { token: string } | null | undefined,
): boolean {
  if (!a?.token || !b?.token) return false;
  return a.token === b.token;
}
