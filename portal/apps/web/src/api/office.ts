/**
 * BFF Office session client (lp-5q6.27).
 * Browser consumes mint output only — never builds editor JWT or document URLs.
 */

import { apiFetch } from "./client.js";
import type {
  DocumentRevisionWire,
  OfficeEditorSessionConfig,
  OfficeFileType,
  OfficeSessionMode,
  OnlyOfficeEditorConfig,
} from "../features/chat/documentPane/onlyOfficeTypes.js";
import {
  getOnlyOfficeDocumentServerUrl,
  validateOnlyOfficeDocumentServerUrl,
} from "../features/chat/documentPane/onlyOfficeFeatureFlag.js";

export type MintOfficeSessionRequest = {
  path: string;
  mode?: OfficeSessionMode;
  title?: string;
  file_type?: string;
  caller_key?: string;
  revision?: DocumentRevisionWire;
};

export type MintOfficeSessionSuccess = {
  session_id: string;
  document_key: string;
  base_revision: DocumentRevisionWire;
  mode: OfficeSessionMode;
  file_type: string;
  path: string;
  expires_at: string;
  editor_config: OnlyOfficeEditorConfig;
  idempotent_replay: boolean;
};

export class OfficeApiError extends Error {
  readonly status: number;
  readonly reason?: string;

  constructor(message: string, status: number, reason?: string) {
    super(message);
    this.name = "OfficeApiError";
    this.status = status;
    this.reason = reason;
  }
}

type ApiErrorBody = {
  error?: string;
  message?: string;
  reason?: string;
};

async function parseError(
  res: Response,
  fallback: string,
): Promise<OfficeApiError> {
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
  const message = body.message ?? body.error ?? fallback;
  return new OfficeApiError(message, res.status, body.reason);
}

/**
 * POST /api/office/sessions — mint OfficeDocumentSession + editor_config JWT.
 */
export async function mintOfficeSession(
  request: MintOfficeSessionRequest,
): Promise<MintOfficeSessionSuccess> {
  const res = await apiFetch("/api/office/sessions", {
    method: "POST",
    body: JSON.stringify({
      path: request.path,
      mode: request.mode ?? "view",
      ...(request.title ? { title: request.title } : {}),
      ...(request.file_type ? { file_type: request.file_type } : {}),
      ...(request.caller_key ? { caller_key: request.caller_key } : {}),
      ...(request.revision ? { revision: request.revision } : {}),
    }),
  });

  if (!res.ok) {
    throw await parseError(
      res,
      `Office session mint failed (${res.status})`,
    );
  }

  return (await res.json()) as MintOfficeSessionSuccess;
}

/**
 * Map mint response + Document Server origin into host session config.
 * DS origin is validated (lp-p37.3); empty when missing or untrusted.
 */
export function toOfficeEditorSessionConfig(
  mint: MintOfficeSessionSuccess,
  documentServerUrl?: string,
): OfficeEditorSessionConfig {
  const raw =
    documentServerUrl?.trim() || getOnlyOfficeDocumentServerUrl();
  // Explicit mint-time override (tests/stories): scheme rules only.
  // Default path already went through getOnlyOfficeDocumentServerUrl allowlist.
  const validated = raw
    ? validateOnlyOfficeDocumentServerUrl(raw, {
        skipAllowlist: Boolean(documentServerUrl?.trim()),
        allowLocalhost: true,
      })
    : ({ ok: false as const, reason: "missing" });
  const ds = validated.ok ? validated.origin : "";
  return {
    sessionId: mint.session_id,
    documentKey: mint.document_key,
    mode: mint.mode,
    fileType: mint.file_type as OfficeFileType,
    path: mint.path,
    expiresAt: mint.expires_at,
    baseRevision: mint.base_revision,
    editorConfig: mint.editor_config,
    documentServerUrl: ds,
  };
}
