import type { ComponentType, SVGProps } from "react";

import {
  CodeBracketIcon,
  DocumentIcon,
  DocumentTextIcon,
  PhotoIcon,
  PresentationChartBarIcon,
  TableCellsIcon,
} from "@heroicons/react/24/outline";

export type HeroIcon = ComponentType<SVGProps<SVGSVGElement>>;

/** Logical file-type buckets shared by Heroicon + citation data-URI icons. */
export type FileTypeKind =
  | "image"
  | "spreadsheet"
  | "presentation"
  | "pdf"
  | "code"
  | "text";

function extensionOf(pathOrName: string): string {
  const base = pathOrName.split("/").pop() ?? pathOrName;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) {
    return "";
  }
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Classify a vault/chat file path, name, or mime type into a display bucket.
 */
export function fileTypeKind(
  pathOrName: string,
  mimeType?: string | null,
): FileTypeKind {
  const ext = extensionOf(pathOrName);
  const mime = (mimeType ?? "").toLowerCase();

  if (
    mime.startsWith("image/") ||
    ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].includes(ext)
  ) {
    return "image";
  }

  if (
    mime.includes("spreadsheet") ||
    mime.includes("excel") ||
    ["xlsx", "xls", "csv", "tsv"].includes(ext)
  ) {
    return "spreadsheet";
  }

  if (
    mime.includes("presentation") ||
    mime.includes("powerpoint") ||
    ["pptx", "ppt", "key"].includes(ext)
  ) {
    return "presentation";
  }

  if (mime === "application/pdf" || ext === "pdf") {
    return "pdf";
  }

  if (
    [
      "ts",
      "tsx",
      "js",
      "jsx",
      "mjs",
      "cjs",
      "py",
      "rs",
      "go",
      "java",
      "json",
      "yml",
      "yaml",
      "toml",
      "css",
      "scss",
      "html",
      "sh",
    ].includes(ext)
  ) {
    return "code";
  }

  if (
    mime.startsWith("text/") ||
    mime.includes("wordprocessing") ||
    ["md", "markdown", "txt", "log", "docx", "doc", "rtf"].includes(ext)
  ) {
    return "text";
  }

  return "text";
}

/**
 * Heroicon component for a vault/chat file path, name, or mime type.
 */
export function fileTypeIcon(
  pathOrName: string,
  mimeType?: string | null,
): HeroIcon {
  switch (fileTypeKind(pathOrName, mimeType)) {
    case "image":
      return PhotoIcon;
    case "spreadsheet":
      return TableCellsIcon;
    case "presentation":
      return PresentationChartBarIcon;
    case "pdf":
      return DocumentIcon;
    case "code":
      return CodeBracketIcon;
    case "text":
    default:
      return DocumentTextIcon;
  }
}

/**
 * Compact outline SVGs for Astryx Citation `source.icon` (string URL / data-URI).
 * Gray stroke so chips stay readable on the light Lanyard theme.
 */
// Use raw # in stroke — encodeURIComponent handles it once (pre-encoded %23
// would become %2523 and break the data-URI image).
const FILE_TYPE_SVG: Record<FileTypeKind, string> = {
  image:
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="#6b7280"><path stroke-linecap="round" stroke-linejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z"/></svg>',
  spreadsheet:
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="#6b7280"><path stroke-linecap="round" stroke-linejoin="round" d="M3.375 3h17.25C21.246 3 21.75 3.504 21.75 4.125v15.75c0 .621-.504 1.125-1.125 1.125H3.375A1.125 1.125 0 0 1 2.25 19.875V4.125C2.25 3.504 2.754 3 3.375 3ZM9 8.25h6M9 12h6m-6 3.75h6"/></svg>',
  presentation:
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="#6b7280"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5"/></svg>',
  pdf: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="#6b7280"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"/></svg>',
  code: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="#6b7280"><path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5"/></svg>',
  text: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="#6b7280"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"/></svg>',
};

/**
 * Data-URI icon for Astryx Citation chips (`source.icon` is an image URL).
 * Kind mapping matches {@link fileTypeIcon}.
 */
export function fileTypeIconDataUrl(
  pathOrName: string,
  mimeType?: string | null,
): string {
  const kind = fileTypeKind(pathOrName, mimeType);
  const svg = FILE_TYPE_SVG[kind];
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
