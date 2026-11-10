/**
 * Vault path ACL helpers (portal RBAC slice #10).
 * Paths are vault-root-relative POSIX paths.
 */

export class InvalidVaultPathError extends Error {
  readonly code = "INVALID_VAULT_PATH";

  constructor(path: string) {
    super(`Invalid vault path: ${path}`);
    this.name = "InvalidVaultPathError";
  }
}

/** Normalize to a canonical vault-relative path (leading slash, no `..`). */
export function normalizeVaultPath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.length === 0) {
    throw new InvalidVaultPathError(path);
  }

  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const segments = withSlash.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === "..")) {
    throw new InvalidVaultPathError(path);
  }

  if (segments.length === 0) {
    return "/";
  }

  return `/${segments.join("/")}`;
}

/** True when `path` is under any allowed prefix (prefix match). */
export function isVaultPathAllowed(
  allowedPrefixes: readonly string[],
  path: string,
): boolean {
  if (allowedPrefixes.length === 0) {
    return false;
  }

  const normalized = normalizeVaultPath(path);
  for (const rawPrefix of allowedPrefixes) {
    const prefix =
      rawPrefix.trim() === "" ? "/" : normalizeVaultPath(rawPrefix);
    if (prefix === "/") {
      return true;
    }
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return true;
    }
  }

  return false;
}

/** Union and dedupe path prefixes from role definitions. */
export function mergePathPrefixes(
  groups: readonly (readonly string[])[],
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const group of groups) {
    for (const raw of group) {
      const prefix = normalizeVaultPath(raw);
      if (!seen.has(prefix)) {
        seen.add(prefix);
        merged.push(prefix);
      }
    }
  }
  return merged;
}