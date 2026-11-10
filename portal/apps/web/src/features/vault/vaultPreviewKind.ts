/**
 * Pure VaultReader / chat pane body preview kind (lp-rt5.7).
 *
 * Office client previews (docx / xlsx / pptx) always win over the generic
 * "Unsupported preview" placeholder when extension or mime matches.
 * ONLYOFFICE is a separate edit-mode host — not a preview kind here.
 */

export type VaultPreviewKind =
  | "markdown"
  | "pdf"
  | "image"
  | "docx"
  | "xlsx"
  | "pptx"
  | "html"
  | "csv"
  | "code"
  | "unsupported";

export type VaultPreviewKindInput = {
  path: string;
  mime_type: string;
};

function basename(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? path;
}

function extensionOf(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return "";
  }
  return name.slice(dot + 1).toLowerCase();
}

function isDocx(content: VaultPreviewKindInput): boolean {
  const ext = extensionOf(content.path);
  const mime = content.mime_type.toLowerCase();
  return (
    ext === "docx" ||
    ext === "doc" ||
    mime.includes("wordprocessingml") ||
    mime === "application/msword"
  );
}

function isXlsx(content: VaultPreviewKindInput): boolean {
  const ext = extensionOf(content.path);
  const mime = content.mime_type.toLowerCase();
  return (
    ext === "xlsx" ||
    ext === "xls" ||
    mime.includes("spreadsheetml") ||
    mime.includes("excel") ||
    mime === "application/vnd.ms-excel"
  );
}

function isPptx(content: VaultPreviewKindInput): boolean {
  const ext = extensionOf(content.path);
  const mime = content.mime_type.toLowerCase();
  return (
    ext === "pptx" ||
    ext === "ppt" ||
    mime.includes("presentationml") ||
    mime.includes("powerpoint") ||
    mime === "application/vnd.ms-powerpoint"
  );
}

function isHtml(content: VaultPreviewKindInput): boolean {
  const ext = extensionOf(content.path);
  const mime = content.mime_type.toLowerCase();
  return ext === "html" || ext === "htm" || mime === "text/html";
}

function isCsv(content: VaultPreviewKindInput): boolean {
  const ext = extensionOf(content.path);
  const mime = content.mime_type.toLowerCase();
  return (
    ext === "csv" ||
    ext === "tsv" ||
    mime === "text/csv" ||
    mime === "text/tab-separated-values"
  );
}

function isCodeOrTextPreview(content: VaultPreviewKindInput): boolean {
  const mime = content.mime_type.toLowerCase();
  if (mime.startsWith("text/")) {
    return true;
  }
  if (
    mime === "application/json" ||
    mime === "application/javascript" ||
    mime === "application/xml" ||
    mime === "application/sql" ||
    mime === "application/toml" ||
    mime === "application/yaml" ||
    mime === "application/x-yaml"
  ) {
    return true;
  }
  const ext = extensionOf(content.path);
  const codeExts = new Set([
    "ts",
    "tsx",
    "js",
    "jsx",
    "mjs",
    "cjs",
    "json",
    "css",
    "scss",
    "py",
    "go",
    "rs",
    "java",
    "rb",
    "php",
    "sh",
    "bash",
    "yaml",
    "yml",
    "toml",
    "xml",
    "sql",
    "c",
    "h",
    "cpp",
    "cc",
    "hpp",
    "swift",
    "kt",
    "vue",
    "svelte",
    "mdx",
    "txt",
    "log",
  ]);
  return codeExts.has(ext);
}

/**
 * Classify vault file content into the VaultReader body renderer kind.
 * Office kinds must never fall through to `unsupported`.
 */
export function resolveVaultPreviewKind(
  content: VaultPreviewKindInput,
): VaultPreviewKind {
  const mime = content.mime_type.toLowerCase();
  const pathLower = content.path.toLowerCase();

  if (
    mime === "text/markdown" ||
    pathLower.endsWith(".md") ||
    pathLower.endsWith(".markdown")
  ) {
    return "markdown";
  }

  if (mime === "application/pdf") {
    return "pdf";
  }

  if (mime.startsWith("image/")) {
    return "image";
  }

  // Office client previews — checked before code/text so generic mimes still win.
  if (isDocx(content)) {
    return "docx";
  }
  if (isXlsx(content)) {
    return "xlsx";
  }
  if (isPptx(content)) {
    return "pptx";
  }

  if (isHtml(content)) {
    return "html";
  }

  if (isCsv(content)) {
    return "csv";
  }

  if (isCodeOrTextPreview(content)) {
    return "code";
  }

  return "unsupported";
}

/** True when the kind is an Office client preview (not OnlyOffice edit host). */
export function isOfficeClientPreviewKind(
  kind: VaultPreviewKind,
): kind is "docx" | "xlsx" | "pptx" {
  return kind === "docx" || kind === "xlsx" || kind === "pptx";
}
