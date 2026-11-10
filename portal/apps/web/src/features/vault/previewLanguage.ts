/** Map a vault file path extension to an Astryx CodeBlock language id. */
export function languageFromPath(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return "plaintext";
  }
  const ext = name.slice(dot + 1).toLowerCase();

  switch (ext) {
    case "ts":
    case "tsx":
    case "mts":
    case "cts":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "json":
      return "json";
    case "css":
      return "css";
    case "scss":
    case "sass":
      return "scss";
    case "html":
    case "htm":
      return "html";
    case "xml":
      return "xml";
    case "py":
      return "python";
    case "go":
      return "go";
    case "rs":
      return "rust";
    case "java":
      return "java";
    case "rb":
      return "ruby";
    case "php":
      return "php";
    case "sh":
    case "bash":
    case "zsh":
      return "bash";
    case "yaml":
    case "yml":
      return "yaml";
    case "toml":
      return "toml";
    case "sql":
      return "sql";
    case "c":
    case "h":
      return "c";
    case "cpp":
    case "cc":
    case "cxx":
    case "hpp":
    case "hh":
      return "cpp";
    case "swift":
      return "swift";
    case "kt":
    case "kts":
      return "kotlin";
    case "vue":
      return "vue";
    case "svelte":
      return "svelte";
    case "mdx":
      return "markdown";
    case "md":
    case "markdown":
      return "markdown";
    case "txt":
    case "log":
      return "plaintext";
    default:
      return "plaintext";
  }
}
