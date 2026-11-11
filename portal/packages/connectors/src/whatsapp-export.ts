/**
 * WhatsApp durable material is session.db only (whatsmeow keys).
 * Never upload wacli.db (messages/FTS) or media/ to CP.
 */

export const WHATSAPP_SESSION_FILENAME = "session.db" as const;
export const WHATSAPP_FORBIDDEN_EXPORT_NAMES = [
  "wacli.db",
  "wacli.db-wal",
  "wacli.db-shm",
  "media",
] as const;

export type WhatsAppExportFile = {
  filename: string;
  contents_base64: string;
};

export type WhatsAppExportResult =
  | {
      ok: true;
      filename: typeof WHATSAPP_SESSION_FILENAME;
      contents_base64: string;
    }
  | {
      ok: false;
      reason: "forbidden_file" | "empty" | "invalid_encoding";
      filename: string;
    };

export class WhatsAppExportError extends Error {
  readonly code = "WHATSAPP_EXPORT_REJECTED" as const;
  readonly reason: "forbidden_file" | "empty" | "invalid_encoding";
  readonly filename: string;

  constructor(result: Extract<WhatsAppExportResult, { ok: false }>) {
    super(
      result.reason === "forbidden_file"
        ? `Refusing to store ${result.filename} on the control plane`
        : result.reason === "empty"
          ? "WhatsApp session.db export is empty"
          : "WhatsApp session.db must be base64",
    );
    this.name = "WhatsAppExportError";
    this.reason = result.reason;
    this.filename = result.filename;
  }
}

function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "");
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? path;
}

export function isWhatsAppForbiddenExportName(filename: string): boolean {
  const name = basename(filename).toLowerCase();
  if (
    (WHATSAPP_FORBIDDEN_EXPORT_NAMES as readonly string[]).includes(name)
  ) {
    return true;
  }
  if (name.startsWith("media")) return true;
  if (name !== WHATSAPP_SESSION_FILENAME && name.includes("wacli.db")) {
    return true;
  }
  return false;
}

export function isWhatsAppSessionFilename(filename: string): boolean {
  return basename(filename) === WHATSAPP_SESSION_FILENAME;
}

function isBase64(value: string): boolean {
  if (!value.trim()) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value.trim()) && value.trim().length % 4 === 0;
}

/** Allowlist: only session.db ciphertext material may leave the sandbox. */
export function selectWhatsAppSessionExport(
  file: WhatsAppExportFile,
): WhatsAppExportResult {
  const filename = basename(file.filename.trim());
  if (!filename) {
    return { ok: false, reason: "empty", filename: file.filename };
  }
  if (isWhatsAppForbiddenExportName(filename)) {
    return { ok: false, reason: "forbidden_file", filename };
  }
  if (!isWhatsAppSessionFilename(filename)) {
    return { ok: false, reason: "forbidden_file", filename };
  }
  const contents_base64 = file.contents_base64.trim();
  if (!contents_base64) {
    return { ok: false, reason: "empty", filename };
  }
  if (!isBase64(contents_base64)) {
    return { ok: false, reason: "invalid_encoding", filename };
  }
  return { ok: true, filename: WHATSAPP_SESSION_FILENAME, contents_base64 };
}

export function requireWhatsAppSessionExport(
  file: WhatsAppExportFile,
): Extract<WhatsAppExportResult, { ok: true }> {
  const result = selectWhatsAppSessionExport(file);
  if (!result.ok) {
    throw new WhatsAppExportError(result);
  }
  return result;
}

export function rejectForbiddenWhatsAppSecretKeys(
  secrets: Record<string, unknown>,
): void {
  for (const key of Object.keys(secrets)) {
    const lower = key.toLowerCase();
    if (
      lower === "wacli.db" ||
      lower === "wacli_db" ||
      lower === "media" ||
      lower === "media_dir" ||
      lower.includes("wacli.db")
    ) {
      throw new WhatsAppExportError({
        ok: false,
        reason: "forbidden_file",
        filename: key,
      });
    }
  }
}
