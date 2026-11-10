import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { STAGING_UPLOADS_ROOT } from "@lanyard/shared";

import type { StagingFileRecord, StagingStorageProvider } from "./types.js";

/**
 * Filesystem-backed staging store for same-host pilot / lab (lp-uxy.21.5).
 *
 * Portal stamps logical paths under {@link STAGING_UPLOADS_ROOT}
 * (`/staging/uploads/...`). Host tools (LA `parse_document`) need those
 * bytes on disk. This provider writes the relative suffix under `fsRoot`:
 *
 *   logical `/staging/uploads/Clients/a.docx`
 *     → `{fsRoot}/Clients/a.docx`
 *
 * Configure BFF with `STAGING_FS_ROOT` and Lanyard Agent with the same path
 * via `PARSE_DOCUMENT_STAGING_ROOT` (logical→physical rewrite).
 */
export function createFsStagingStorageProvider(
  fsRoot: string,
): StagingStorageProvider {
  const absoluteRoot = path.resolve(fsRoot);

  function toFsPath(logicalPath: string): string {
    const normalized = logicalPath.replace(/\\/g, "/");
    if (
      normalized !== STAGING_UPLOADS_ROOT &&
      !normalized.startsWith(`${STAGING_UPLOADS_ROOT}/`)
    ) {
      throw new Error(
        `Staging path must be under ${STAGING_UPLOADS_ROOT}: ${logicalPath}`,
      );
    }
    const relative =
      normalized === STAGING_UPLOADS_ROOT
        ? ""
        : normalized.slice(STAGING_UPLOADS_ROOT.length + 1);
    if (!relative) {
      throw new Error("Staging write path must include a filename");
    }
    if (relative.includes("..")) {
      throw new Error("Staging path must not contain '..'");
    }
    const full = path.resolve(absoluteRoot, ...relative.split("/"));
    const rootPrefix = absoluteRoot.endsWith(path.sep)
      ? absoluteRoot
      : absoluteRoot + path.sep;
    if (full !== absoluteRoot && !full.startsWith(rootPrefix)) {
      throw new Error("Staging path escapes STAGING_FS_ROOT");
    }
    return full;
  }

  function toLogicalPath(fsPath: string): string {
    const relative = path.relative(absoluteRoot, fsPath);
    if (!relative || relative === ".") {
      return STAGING_UPLOADS_ROOT;
    }
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Staging list path escapes STAGING_FS_ROOT");
    }
    return `${STAGING_UPLOADS_ROOT}/${relative.split(path.sep).join("/")}`;
  }

  return {
    async writeFile(input) {
      const full = toFsPath(input.path);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, input.bytes);
      const uploaded_at = new Date().toISOString();
      const st = await stat(full);
      return {
        path: input.path,
        filename: input.filename,
        mime_type: input.mime_type,
        size_bytes: st.size,
        uploaded_at,
      };
    },

    async listFiles() {
      const out: StagingFileRecord[] = [];

      async function walk(dir: string): Promise<void> {
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(full);
            continue;
          }
          if (!entry.isFile()) continue;
          const st = await stat(full);
          const logical = toLogicalPath(full);
          out.push({
            path: logical,
            filename: entry.name,
            mime_type: "application/octet-stream",
            size_bytes: st.size,
            uploaded_at: st.mtime.toISOString(),
          });
        }
      }

      await walk(absoluteRoot);
      return out.sort((a, b) => a.path.localeCompare(b.path));
    },

    async readFile(logicalPath) {
      const full = toFsPath(logicalPath);
      try {
        const st = await stat(full);
        if (!st.isFile()) return null;
        // Ensure file is readable (touch content).
        await readFile(full);
        return {
          path: logicalPath,
          filename: path.basename(full),
          mime_type: "application/octet-stream",
          size_bytes: st.size,
          uploaded_at: st.mtime.toISOString(),
        };
      } catch {
        return null;
      }
    },
  };
}
