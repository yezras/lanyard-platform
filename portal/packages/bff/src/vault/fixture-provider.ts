import { normalizeVaultPath } from "@lanyard/shared";

import type {
  VaultContentProvider,
  VaultEntry,
  VaultFileContent,
  VaultTreeNode,
} from "./types.js";

type FixtureFile = {
  mime_type: string;
  encoding: "utf-8" | "base64";
  content: string;
};

/** Minimal valid PDF (one blank page) for client preview smoke tests. */
const MINIMAL_PDF_BASE64 =
  "JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEKPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovTWVkaWFCb3ggWzAgMCA2MTIgNzkyXQo+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDQKL1Jvb3QgMSAwIFIKPj4Kc3RhcnR4cmVmCjIwNQolJUVPRg==";

/** 1×1 transparent PNG. */
const MINIMAL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const FIXTURE_FILES: Record<string, FixtureFile> = {
  "/Projects/A/README.md": {
    mime_type: "text/markdown",
    encoding: "utf-8",
    content: "# Team A\n\nWelcome to the **Team A** vault slice.\n",
  },
  "/Projects/A/notes.md": {
    mime_type: "text/markdown",
    encoding: "utf-8",
    content: "## Notes\n\n- Kickoff complete\n- Next: vault browser (#12)\n",
  },
  "/Projects/A/Subfolder/detail.md": {
    mime_type: "text/markdown",
    encoding: "utf-8",
    content: "### Detail\n\nNested markdown under Team A.\n",
  },
  "/Projects/A/overview.pdf": {
    mime_type: "application/pdf",
    encoding: "base64",
    content: MINIMAL_PDF_BASE64,
  },
  "/Projects/A/logo.png": {
    mime_type: "image/png",
    encoding: "base64",
    content: MINIMAL_PNG_BASE64,
  },
  "/Projects/B/secret.md": {
    mime_type: "text/markdown",
    encoding: "utf-8",
    content: "# Secret\n\nTeam B only.\n",
  },
  "/Projects/B/plan.md": {
    mime_type: "text/markdown",
    encoding: "utf-8",
    content: "# Plan B\n\nRoadmap for team B.\n",
  },
  "/Projects/C/hidden.md": {
    mime_type: "text/markdown",
    encoding: "utf-8",
    content: "Should never appear for A/B test roles.\n",
  },
};

function mimeForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".tsv")) return "text/tab-separated-values";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "text/typescript";
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return "application/javascript";
  }
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".pptx")) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (lower.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
  return "application/octet-stream";
}

function entryName(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? path;
}

function collectDirectoryPaths(): Set<string> {
  const dirs = new Set<string>(["/"]);
  for (const filePath of Object.keys(FIXTURE_FILES)) {
    const segments = filePath.split("/").filter(Boolean);
    let current = "";
    for (let i = 0; i < segments.length - 1; i += 1) {
      current += `/${segments[i]}`;
      dirs.add(current);
    }
  }
  return dirs;
}

const DIRECTORY_PATHS = collectDirectoryPaths();

function buildTreeFromPaths(): VaultTreeNode[] {
  const childMap = new Map<string, VaultTreeNode[]>();

  for (const dir of DIRECTORY_PATHS) {
    if (dir === "/") continue;
    const parent = dir.split("/").slice(0, -1).join("") || "/";
    const parentKey = parent === "" ? "/" : parent;
    const node: VaultTreeNode = {
      name: entryName(dir),
      path: dir,
      kind: "directory",
      children: [],
    };
    const siblings = childMap.get(parentKey) ?? [];
    siblings.push(node);
    childMap.set(parentKey, siblings);
  }

  for (const [filePath, file] of Object.entries(FIXTURE_FILES)) {
    const parent = filePath.split("/").slice(0, -1).join("") || "/";
    const parentKey = parent === "" ? "/" : parent;
    const node: VaultTreeNode = {
      name: entryName(filePath),
      path: filePath,
      kind: "file",
      mime_type: file.mime_type,
    };
    const siblings = childMap.get(parentKey) ?? [];
    siblings.push(node);
    childMap.set(parentKey, siblings);
  }

  function attachChildren(path: string): VaultTreeNode[] {
    const nodes = childMap.get(path) ?? [];
    return nodes
      .map((node) => {
        if (node.kind === "directory") {
          const children = attachChildren(node.path);
          return { ...node, children };
        }
        return node;
      })
      .sort(compareNodes);
  }

  return attachChildren("/");
}

function compareNodes(a: VaultTreeNode, b: VaultTreeNode): number {
  if (a.kind !== b.kind) {
    return a.kind === "directory" ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}

export function createFixtureVaultContentProvider(): VaultContentProvider {
  const tree = buildTreeFromPaths();

  return {
    async listEntries(rawPath: string): Promise<VaultEntry[]> {
      const path = normalizeVaultPath(rawPath);
      if (!DIRECTORY_PATHS.has(path)) {
        return [];
      }

      const entries: VaultEntry[] = [];

      for (const dir of DIRECTORY_PATHS) {
        if (parentPath(dir) === path && dir !== path) {
          entries.push({
            name: entryName(dir),
            path: dir,
            kind: "directory",
          });
        }
      }

      for (const filePath of Object.keys(FIXTURE_FILES)) {
        if (parentPath(filePath) === path) {
          const file = FIXTURE_FILES[filePath]!;
          entries.push({
            name: entryName(filePath),
            path: filePath,
            kind: "file",
            mime_type: file.mime_type,
          });
        }
      }

      return entries.sort((a, b) => {
        if (a.kind !== b.kind) {
          return a.kind === "directory" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
    },

    async readFile(rawPath: string): Promise<VaultFileContent | null> {
      const path = normalizeVaultPath(rawPath);
      const file = FIXTURE_FILES[path];
      if (!file) {
        return null;
      }

      const sizeBytes =
        file.encoding === "utf-8"
          ? Buffer.byteLength(file.content, "utf-8")
          : Buffer.from(file.content, "base64").length;

      return {
        path,
        kind: "file",
        mime_type: file.mime_type ?? mimeForPath(path),
        encoding: file.encoding,
        content: file.content,
        size_bytes: sizeBytes,
      };
    },

    async getTree(): Promise<VaultTreeNode[]> {
      return tree;
    },
  };
}

function parentPath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 1) {
    return "/";
  }
  return `/${segments.slice(0, -1).join("/")}`;
}