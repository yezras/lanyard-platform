import { InvalidVaultPathError, isVaultPathAllowed, normalizeVaultPath } from "../rbac/path-access.js";

/** Customer brain ingest drop zone (vault-root-relative). */
export const STAGING_UPLOADS_ROOT = "/staging/uploads";

/** Default max upload size (25 MiB) when env is unset. */
export const DEFAULT_STAGING_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const FILENAME_UNSAFE = /[^a-zA-Z0-9._-]+/g;

/** Strip path components and unsafe characters from an upload filename. */
export function sanitizeUploadFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop()?.trim() ?? "upload";
  const cleaned = base.replace(FILENAME_UNSAFE, "_").replace(/^\.+/, "");
  if (cleaned.length === 0) {
    return "upload";
  }
  return cleaned.slice(0, 200);
}

/** True when `path` is under the staging uploads root. */
export function isStagingUploadPath(path: string): boolean {
  const normalized = normalizeVaultPath(path);
  return (
    normalized === STAGING_UPLOADS_ROOT ||
    normalized.startsWith(`${STAGING_UPLOADS_ROOT}/`)
  );
}

/**
 * Map a staging upload path back to the vault ACL prefix it belongs under.
 * `/staging/uploads/Projects/A/foo.pdf` → `/Projects/A`
 */
export function stagingPathToVaultPrefix(path: string): string | null {
  const normalized = normalizeVaultPath(path);
  if (!isStagingUploadPath(normalized)) {
    return null;
  }

  const remainder = normalized.slice(STAGING_UPLOADS_ROOT.length);
  if (remainder.length === 0) {
    return STAGING_UPLOADS_ROOT;
  }

  const segments = remainder.split("/").filter(Boolean);
  if (segments.length === 0) {
    return STAGING_UPLOADS_ROOT;
  }

  if (segments[0] === "_inbox") {
    return STAGING_UPLOADS_ROOT;
  }

  if (segments.length === 1) {
    return `/${segments[0]}`;
  }

  return `/${segments.slice(0, -1).join("/")}`;
}

/** True when the user may read/write the staging object at `path`. */
export function isStagingPathAllowed(
  allowedPrefixes: readonly string[],
  path: string,
): boolean {
  const normalized = normalizeVaultPath(path);
  if (!isStagingUploadPath(normalized)) {
    return false;
  }

  if (normalized === STAGING_UPLOADS_ROOT) {
    return allowedPrefixes.some((prefix) => isVaultPathAllowed([prefix], "/"));
  }

  const vaultPrefix = stagingPathToVaultPrefix(normalized);
  if (!vaultPrefix || vaultPrefix === STAGING_UPLOADS_ROOT) {
    return allowedPrefixes.some((prefix) => isVaultPathAllowed([prefix], "/"));
  }

  return isVaultPathAllowed(allowedPrefixes, vaultPrefix);
}

/**
 * Build the destination path for a browser upload.
 * Scoped users land under `/staging/uploads/<vaultSubpath>/`.
 * Full-access users without a project use `/staging/uploads/_inbox/`.
 */
export function buildStagingUploadPath(
  vaultSubpath: string | null | undefined,
  filename: string,
): string {
  const safeName = sanitizeUploadFilename(filename);
  if (!vaultSubpath?.trim()) {
    return `${STAGING_UPLOADS_ROOT}/_inbox/${safeName}`;
  }

  const normalized = normalizeVaultPath(vaultSubpath);
  return `${STAGING_UPLOADS_ROOT}${normalized}/${safeName}`;
}

export class StagingPathNotAllowedError extends Error {
  readonly code = "STAGING_PATH_NOT_ALLOWED";

  constructor(path: string) {
    super(`Staging path not permitted for user role: ${path}`);
    this.name = "StagingPathNotAllowedError";
  }
}

export function assertStagingUploadDestination(
  allowedPrefixes: readonly string[],
  vaultSubpath: string | null | undefined,
  filename: string,
): { path: string } {
  if (!filename.trim()) {
    throw new InvalidVaultPathError(filename);
  }

  const path = buildStagingUploadPath(vaultSubpath, filename);
  if (!isStagingPathAllowed(allowedPrefixes, path)) {
    throw new StagingPathNotAllowedError(path);
  }

  return { path };
}