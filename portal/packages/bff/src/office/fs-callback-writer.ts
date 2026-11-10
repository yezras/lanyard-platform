/**
 * Lab filesystem vault.write for ONLYOFFICE callbacks (lp-bhcg.16).
 *
 * Used when Brain RPC is off and VAULT_ROOT is the local vault. Does not
 * call Secrets Manager or a guest. Bytes stay under the vault root.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { VaultWriteHttpBody } from "@lanyard/backend-runtime";
import { normalizeVaultPath } from "@lanyard/shared";

import type { OfficeCallbackVaultWriter } from "./callback.js";

export function createFsOfficeCallbackVaultWriter(
  vaultRoot: string,
): OfficeCallbackVaultWriter {
  const root = path.resolve(vaultRoot);

  return async ({ params }) => {
    if (params.content === undefined) {
      throw Object.assign(new Error("Office callback is missing file bytes"), {
        code: "invalid_payload",
      });
    }
    const encoding = params.encoding ?? "base64";
    const bytes =
      encoding === "base64"
        ? Buffer.from(params.content, "base64")
        : Buffer.from(params.content, "utf8");
    const vaultPath = normalizeVaultPath(params.path);
    const relative = vaultPath === "/" ? "" : vaultPath.slice(1);
    const full = path.resolve(root, ...relative.split("/"));
    const rel = path.relative(root, full);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw Object.assign(new Error("Vault path escapes VAULT_ROOT"), {
        code: "bad_path",
      });
    }
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, bytes);
    const token = `rev-${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}`;
    const writtenAt = new Date().toISOString();
    const body: VaultWriteHttpBody = {
      path: vaultPath,
      revision: {
        token,
        kind: "content_hash",
        size_bytes: bytes.byteLength,
        modified_at: writtenAt,
      },
      size_bytes: bytes.byteLength,
      mime_type:
        params.mimeType ??
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      written_at: writtenAt,
      source: "fs_vault_root",
      write_kind: "replace",
    };
    return body;
  };
}
