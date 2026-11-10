/**
 * Path helpers for Settings detail bodies (lp-a8u.8 / lp-75r.4).
 * Skill inventory paths are usually directories; body lives in SKILL.md.
 */

/**
 * Resolve a skill inventory path (directory or file) to the content path to fetch.
 */
export function resolveSkillContentPath(skillPath: string): string {
  const trimmed = skillPath.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!trimmed) return "SKILL.md";
  if (/skill\.md$/i.test(trimmed)) return trimmed;
  if (/\.(md|ya?ml|json|txt)$/i.test(trimmed)) return trimmed;
  return `${trimmed}/SKILL.md`;
}

/**
 * Resolve a skill inventory path to its pack directory (for sibling listing).
 * File paths use the parent directory; directory paths are returned as-is.
 */
export function resolveSkillDirectoryPath(skillPath: string): string {
  const trimmed = skillPath.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/\.(md|ya?ml|json|txt)$/i.test(trimmed)) {
    const idx = trimmed.lastIndexOf("/");
    return idx > 0 ? trimmed.slice(0, idx) : "";
  }
  return trimmed;
}

/**
 * Whether the inventory path looks usable for a host content fetch.
 */
export function hasSettingsFilePath(path: string | null | undefined): boolean {
  return typeof path === "string" && path.trim().length > 0;
}

/**
 * Whether a skill inventory path looks vault-root-relative (optional Open in Vault).
 * Host-home skill packs (`skills/…`) are not vault-visible.
 */
export function isVaultVisibleSettingsPath(
  path: string | null | undefined,
): boolean {
  if (typeof path !== "string") return false;
  const trimmed = path.trim().replace(/\\/g, "/");
  if (!trimmed) return false;
  // Vault API paths are typically rooted: /Projects/…, /Clients/…
  if (trimmed.startsWith("/")) return true;
  // Bare top-level vault segments (no leading slash) occasionally appear
  return /^(Projects|Clients|Archive|Shared|Personal|Home)\//i.test(trimmed);
}

/** Honest empty copy when snapshot omits a host path. */
export const NO_FILE_PATH_MESSAGE =
  "No file path on host for this item";

/** Honest empty when host home / content is unavailable (fixture or missing file). */
export const NO_HOST_CONTENT_MESSAGE =
  "Host file content is not available for this item";

/** Honest empty when skill-pack directory listing is unavailable. */
export const NO_HOST_DIRECTORY_MESSAGE =
  "Host skill directory is not available for this item";
