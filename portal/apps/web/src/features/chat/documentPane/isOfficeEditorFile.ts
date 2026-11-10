/**
 * Which vault paths/extensions the ONLYOFFICE host may claim (lp-5q6.27).
 * Markdown/images stay on VaultReader even when the feature flag is on.
 */

import type { OfficeFileType } from "./onlyOfficeTypes.js";

export const OFFICE_EDITOR_FILE_TYPES: ReadonlySet<OfficeFileType> = new Set([
  "docx",
  "xlsx",
  "pptx",
  "pdf",
  "doc",
  "xls",
  "ppt",
  "odt",
  "ods",
  "odp",
]);

export function isOfficeEditorFileType(
  value: string | null | undefined,
): value is OfficeFileType {
  if (!value) return false;
  return OFFICE_EDITOR_FILE_TYPES.has(
    value.trim().toLowerCase() as OfficeFileType,
  );
}

/** Extension from a vault path (last segment after `.`), lowercased. */
export function officeFileTypeFromPath(path: string): OfficeFileType | null {
  const base = path.split("/").filter(Boolean).at(-1) ?? path;
  const dot = base.lastIndexOf(".");
  if (dot < 0 || dot === base.length - 1) {
    return null;
  }
  const ext = base.slice(dot + 1).toLowerCase();
  return isOfficeEditorFileType(ext) ? ext : null;
}

/** True when the path is an Office/PDF type the editor host can open. */
export function isOfficeEditorPath(path: string | null | undefined): boolean {
  if (!path) return false;
  return officeFileTypeFromPath(path) != null;
}
