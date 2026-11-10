/**
 * Binary content source for Office signed download (lp-5q6.22).
 *
 * Lab/tests: wraps VaultContentProvider (fixture/FS).
 * Short stack (`VaultPlane=cp_s3`): `createCpS3OfficeBinaryContentSource`
 * reads CP getObject (lp-oop.12). No gRPC. No Brain RPC chunked read.
 * Brain RPC binary transfer (lp-5q6.17) remains the existing production plane.
 */

import type { VaultContentProvider, VaultFileContent } from "../vault/types.js";
import {
  assertOfficeDownloadSize,
  mimeForOfficeFileType,
  vaultContentToBytes,
} from "./download.js";
import {
  DEFAULT_OFFICE_FILE_MAX_BYTES,
  type OfficeFileType,
} from "./types.js";

export type OfficeBinaryReadOk = {
  bytes: Uint8Array;
  mime_type: string;
  size_bytes: number;
  path: string;
};

export type OfficeBinaryReadError = {
  ok: false;
  reason: "missing_file" | "oversized" | "payload_too_large";
};

export type OfficeBinaryReadResult =
  | ({ ok: true } & OfficeBinaryReadOk)
  | OfficeBinaryReadError;

/**
 * Read vault bytes for a bound Office session path.
 * Callers must already have authorized the session (path from session only).
 */
export type OfficeBinaryContentSource = {
  read(input: {
    path: string;
    file_type: OfficeFileType;
    max_bytes: number;
    /** Optional known size from session.revision.size_bytes for early reject. */
    known_size_bytes?: number;
  }): Promise<OfficeBinaryReadResult>;
};

/**
 * Adapter over existing vault content providers (fixture / FS / multi-root).
 * Streams via full read for lab sizes; production Brain RPC can replace this.
 */
export function createVaultOfficeBinaryContentSource(
  provider: VaultContentProvider,
): OfficeBinaryContentSource {
  return {
    async read(input): Promise<OfficeBinaryReadResult> {
      const maxBytes = input.max_bytes || DEFAULT_OFFICE_FILE_MAX_BYTES;

      if (input.known_size_bytes !== undefined) {
        const early = assertOfficeDownloadSize(input.known_size_bytes, maxBytes);
        if (!early.ok) {
          return { ok: false, reason: "oversized" };
        }
      }

      const file: VaultFileContent | null = await provider.readFile(input.path);
      if (!file) {
        return { ok: false, reason: "missing_file" };
      }

      const sizeCheck = assertOfficeDownloadSize(file.size_bytes, maxBytes);
      if (!sizeCheck.ok) {
        return { ok: false, reason: "oversized" };
      }

      const bytes = vaultContentToBytes(file);
      if (bytes.byteLength > maxBytes) {
        return { ok: false, reason: "payload_too_large" };
      }

      return {
        ok: true,
        bytes,
        mime_type: mimeForOfficeFileType(input.file_type) || file.mime_type,
        size_bytes: bytes.byteLength,
        path: file.path,
      };
    },
  };
}

/**
 * In-memory binary source for unit tests (path → bytes).
 */
export function createMemoryOfficeBinaryContentSource(
  files: Record<
    string,
    { bytes: Uint8Array; mime_type?: string } | null
  >,
): OfficeBinaryContentSource {
  return {
    async read(input): Promise<OfficeBinaryReadResult> {
      const maxBytes = input.max_bytes || DEFAULT_OFFICE_FILE_MAX_BYTES;
      if (input.known_size_bytes !== undefined) {
        const early = assertOfficeDownloadSize(input.known_size_bytes, maxBytes);
        if (!early.ok) {
          return { ok: false, reason: "oversized" };
        }
      }

      if (!(input.path in files)) {
        return { ok: false, reason: "missing_file" };
      }
      const entry = files[input.path];
      if (!entry) {
        return { ok: false, reason: "missing_file" };
      }

      if (entry.bytes.byteLength > maxBytes) {
        return { ok: false, reason: "oversized" };
      }

      return {
        ok: true,
        bytes: entry.bytes,
        mime_type:
          entry.mime_type ?? mimeForOfficeFileType(input.file_type),
        size_bytes: entry.bytes.byteLength,
        path: input.path,
      };
    },
  };
}
