import {
  InvalidVaultPathError,
  STAGING_UPLOADS_ROOT,
  StagingPathNotAllowedError,
  assertStagingUploadDestination,
  isStagingPathAllowed,
  normalizeVaultPath,
} from "@lanyard/shared";
import { HTTPException } from "hono/http-exception";

import type { UserRbac } from "../control-plane-client.js";
import type { StagingFileRecord, StagingStorageProvider } from "./types.js";

export type StagingUploadInput = {
  filename: string;
  mime_type: string;
  bytes: Uint8Array;
  project_vault_path?: string | null;
};

export class StagingService {
  constructor(
    private readonly provider: StagingStorageProvider,
    private readonly maxUploadBytes: number,
  ) {}

  async upload(
    rbac: UserRbac,
    input: StagingUploadInput,
  ): Promise<StagingFileRecord> {
    if (input.bytes.byteLength === 0) {
      throw new HTTPException(400, { message: "Upload file is empty" });
    }
    if (input.bytes.byteLength > this.maxUploadBytes) {
      throw new HTTPException(413, {
        message: `Upload exceeds max size of ${this.maxUploadBytes} bytes`,
      });
    }

    const destination = assertStagingUploadDestination(
      rbac.allowed_path_prefixes,
      input.project_vault_path,
      input.filename,
    );

    return this.provider.writeFile({
      path: destination.path,
      filename: input.filename,
      mime_type: input.mime_type || "application/octet-stream",
      bytes: input.bytes,
    });
  }

  async listUploads(rbac: UserRbac): Promise<{ root: string; files: StagingFileRecord[] }> {
    const all = await this.provider.listFiles();
    const files = all.filter((file) =>
      isStagingPathAllowed(rbac.allowed_path_prefixes, file.path),
    );
    return { root: STAGING_UPLOADS_ROOT, files };
  }

  assertReadablePath(rbac: UserRbac, rawPath: string): string {
    try {
      const path = normalizeVaultPath(rawPath);
      if (!isStagingPathAllowed(rbac.allowed_path_prefixes, path)) {
        throw new StagingPathNotAllowedError(path);
      }
      return path;
    } catch (error) {
      if (error instanceof InvalidVaultPathError) {
        throw new HTTPException(400, { message: error.message });
      }
      if (error instanceof StagingPathNotAllowedError) {
        throw new HTTPException(403, { message: error.message });
      }
      throw error;
    }
  }
}

/** Append staging references so Hermes can locate uploaded context in the next turn. */
export function formatStagingReferences(paths: readonly string[]): string {
  if (paths.length === 0) {
    return "";
  }
  const lines = paths.map((path) => `- ${path}`);
  return `\n\n[staging uploads]\n${lines.join("\n")}`;
}