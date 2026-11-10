import type { StagingFileRecord, StagingStorageProvider } from "./types.js";

type StoredObject = {
  filename: string;
  mime_type: string;
  bytes: Uint8Array;
  uploaded_at: string;
};

/**
 * In-memory staging store for local dev and integration tests.
 * Production replaces this with customer transfer (agent tool / SFTP sidecar).
 *
 * Ingest follow-up: customer `ingest` / `vault-writer` beads pick up files under
 * `staging/uploads/` and promote into canonical vault paths.
 */
export function createFixtureStagingStorageProvider(): StagingStorageProvider {
  const objects = new Map<string, StoredObject>();

  return {
    async writeFile(input) {
      const uploaded_at = new Date().toISOString();
      objects.set(input.path, {
        filename: input.filename,
        mime_type: input.mime_type,
        bytes: input.bytes,
        uploaded_at,
      });

      return {
        path: input.path,
        filename: input.filename,
        mime_type: input.mime_type,
        size_bytes: input.bytes.byteLength,
        uploaded_at,
      };
    },

    async listFiles() {
      return [...objects.entries()]
        .map(([path, object]) => ({
          path,
          filename: object.filename,
          mime_type: object.mime_type,
          size_bytes: object.bytes.byteLength,
          uploaded_at: object.uploaded_at,
        }))
        .sort((a, b) => a.path.localeCompare(b.path));
    },

    async readFile(path) {
      const object = objects.get(path);
      if (!object) {
        return null;
      }
      return {
        path,
        filename: object.filename,
        mime_type: object.mime_type,
        size_bytes: object.bytes.byteLength,
        uploaded_at: object.uploaded_at,
      };
    },
  };
}