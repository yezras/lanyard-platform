/**
 * Shared vault MIME + text detection for filesystem providers.
 */

/** Map a file path (or basename) to a MIME type for vault listings/reads. */
export function mimeForPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot + 1) : "";

  switch (ext) {
    case "md":
    case "markdown":
      return "text/markdown";
    case "txt":
    case "log":
      return "text/plain";
    case "csv":
      return "text/csv";
    case "tsv":
      return "text/tab-separated-values";
    case "json":
      return "application/json";
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "html":
    case "htm":
      return "text/html";
    case "css":
      return "text/css";
    case "js":
    case "mjs":
    case "cjs":
      return "application/javascript";
    case "ts":
    case "tsx":
      return "text/typescript";
    case "jsx":
      return "text/jsx";
    case "py":
      return "text/x-python";
    case "go":
      return "text/x-go";
    case "rs":
      return "text/x-rust";
    case "java":
      return "text/x-java-source";
    case "rb":
      return "text/x-ruby";
    case "php":
      return "text/x-php";
    case "sh":
    case "bash":
    case "zsh":
      return "text/x-shellscript";
    case "yaml":
    case "yml":
      return "text/yaml";
    case "toml":
      return "text/toml";
    case "xml":
      return "application/xml";
    case "sql":
      return "application/sql";
    case "c":
    case "h":
      return "text/x-c";
    case "cpp":
    case "cc":
    case "cxx":
    case "hpp":
    case "hh":
      return "text/x-c++";
    case "swift":
      return "text/x-swift";
    case "kt":
    case "kts":
      return "text/x-kotlin";
    case "vue":
      return "text/x-vue";
    case "svelte":
      return "text/x-svelte";
    case "mdx":
      return "text/mdx";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "doc":
      return "application/msword";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "xls":
      return "application/vnd.ms-excel";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "ppt":
      return "application/vnd.ms-powerpoint";
    default:
      return "application/octet-stream";
  }
}

/**
 * Whether vault should read and return the file as UTF-8 text
 * (vs base64 binary).
 */
export function isTextMime(mime: string): boolean {
  const type = mime.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (type.startsWith("text/")) {
    return true;
  }
  switch (type) {
    case "application/json":
    case "application/javascript":
    case "application/xml":
    case "application/sql":
    case "application/toml":
    case "application/x-yaml":
    case "application/yaml":
      return true;
    default:
      return false;
  }
}
