/**
 * Resolve TableSpec link cells into external vs vault destinations.
 *
 * Bead: lp-a79.11
 * Reuses vault path helpers from features/vault/vaultPaths (ChatMessageContent pattern).
 */

import {
  resolveVaultCitationClickPath,
  resolveVaultCitationPath,
} from "../../vault/vaultPaths.js";

export type ResolvedTableLinkExternal = {
  kind: "external";
  href: string;
  /** Default true for external links (open new tab). */
  openInNewTab: boolean;
};

export type ResolvedTableLinkVault = {
  kind: "vault";
  /** Original href from the cell. */
  href: string;
  /** Path to pass to onVaultPath after project join / normalization. */
  path: string;
};

export type ResolvedTableLinkInvalid = {
  kind: "invalid";
  href: string;
  reason: string;
};

export type ResolvedTableLink =
  | ResolvedTableLinkExternal
  | ResolvedTableLinkVault
  | ResolvedTableLinkInvalid;

export type ResolveTableLinkOptions = {
  projectVaultPath?: string | null;
  /**
   * External only. Default true → open in new tab.
   * Vault links always stay in-app (ignore this flag).
   */
  openInNewTab?: boolean;
};

function isHttpHref(href: string): boolean {
  return /^https?:\/\//i.test(href.trim());
}

/**
 * Decide external vs vault for `target: "auto"`.
 * http(s) → external; everything else → vault (paths / file:).
 */
export function inferLinkTarget(
  href: string,
  target: "auto" | "external" | "vault" = "auto",
): "external" | "vault" {
  if (target === "external" || target === "vault") {
    return target;
  }
  return isHttpHref(href) ? "external" : "vault";
}

/**
 * Resolve a table link cell into a navigable external URL or vault path.
 * Never throws; invalid input returns `{ kind: "invalid" }`.
 */
export function resolveTableLink(
  href: string,
  target: "auto" | "external" | "vault" = "auto",
  options: ResolveTableLinkOptions = {},
): ResolvedTableLink {
  const trimmed = typeof href === "string" ? href.trim() : "";
  if (!trimmed) {
    return { kind: "invalid", href: "", reason: "empty href" };
  }

  // Defense in depth — parser already rejects these schemes.
  if (/^\s*(javascript|data|vbscript|blob)\s*:/i.test(trimmed)) {
    return { kind: "invalid", href: trimmed, reason: "disallowed scheme" };
  }

  const resolvedTarget = inferLinkTarget(trimmed, target);
  const openInNewTab = options.openInNewTab !== false;

  if (resolvedTarget === "external") {
    if (!isHttpHref(trimmed)) {
      return {
        kind: "invalid",
        href: trimmed,
        reason: "external link requires http(s) href",
      };
    }
    return {
      kind: "external",
      href: trimmed,
      openInNewTab,
    };
  }

  // Vault: join project root when provided; never full-navigate.
  // Prefer click-path helper for true URLs (same-origin → path); plain paths
  // go through resolveVaultCitationPath so relatives join projectVaultPath.
  let path: string;
  if (isHttpHref(trimmed)) {
    path = resolveVaultCitationClickPath(trimmed, options.projectVaultPath);
  } else {
    path = resolveVaultCitationPath(trimmed, options.projectVaultPath);
  }

  if (!path) {
    return {
      kind: "invalid",
      href: trimmed,
      reason: "could not resolve vault path",
    };
  }

  return {
    kind: "vault",
    href: trimmed,
    path,
  };
}
