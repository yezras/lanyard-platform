/**
 * Mint Office session + ONLYOFFICE editor config (lp-5q6.26).
 *
 * Orchestrates: path normalize → ACL → capability → revision → document.key
 * → session create/retrieve → signed download URL → callback URL → JWT.
 */

import { InvalidVaultPathError } from "@lanyard/shared";

import type { VaultContentProvider } from "../vault/types.js";
import { buildOfficeCallbackUrl } from "./callback.js";
import { mintDocumentKey, DocumentKeyMintError } from "./document-key.js";
import { buildOfficeDownloadUrl } from "./download.js";
import {
  buildOnlyOfficeEditorConfig,
  fileTypeFromPath,
  isEditableOfficeFileType,
  isSupportedOfficeFileType,
  loadOfficeJwtSecret,
  loadOfficePublicBaseUrl,
  normalizeOfficeMintPath,
  revisionFromVaultContent,
  titleFromPath,
  type OnlyOfficeEditorConfig,
  type OfficeJwtSecretError,
  type OfficePublicBaseUrlError,
} from "./editor-config.js";
import {
  generateOfficeSecret,
  hashDownloadToken,
} from "./tokens.js";
import type {
  DocumentRevision,
  OfficeDocumentSession,
  OfficeFileType,
  OfficeSessionMode,
} from "./types.js";
import { DEFAULT_OFFICE_SESSION_TTL_SECONDS } from "./types.js";
import type { OfficeDocumentSessionStore } from "./store.js";

export type MintOfficeSessionDenyReason =
  | "bad_path"
  | "unsupported_file_type"
  | "missing_write_capability"
  | "file_type_not_editable"
  | "missing_file"
  | "missing_revision"
  | "missing_jwt_secret"
  | "missing_public_base_url"
  | "acl_denied"
  | "invalid_mode"
  | "invalid_body";

export type MintOfficeSessionRequest = {
  path: string;
  mode: OfficeSessionMode;
  /** Optional display title override. */
  title?: string;
  /** Caller idempotency key (web open id). */
  caller_key?: string;
  /**
   * Optional host revision when caller already has vault.stat / write result.
   * When omitted, BFF derives content_hash from vault bytes.
   */
  revision?: DocumentRevision;
  /** Optional explicit file type; default from path extension. */
  file_type?: string;
};

export type MintOfficeSessionResult =
  | {
      ok: true;
      session_id: string;
      document_key: string;
      base_revision: DocumentRevision;
      mode: OfficeSessionMode;
      file_type: OfficeFileType;
      path: string;
      expires_at: string;
      editor_config: OnlyOfficeEditorConfig;
      idempotent_replay: boolean;
    }
  | {
      ok: false;
      reason: MintOfficeSessionDenyReason;
      message: string;
      status: number;
    };

export type MintOfficeSessionDeps = {
  store: OfficeDocumentSessionStore;
  vaultContentProvider: VaultContentProvider;
  tenant_id: string;
  user_id: string;
  user_email: string;
  /**
   * ui.can.vault_edit (or lab equivalent). Required true for mode=edit.
   */
  vault_edit: boolean;
  /**
   * Path ACL check already performed by caller via assertVaultPathAccess,
   * or provide allowed path prefixes for mint to re-check.
   * When `path_allowed` is false, mint returns acl_denied.
   */
  path_allowed: boolean;
  /** DS-reachable BFF base; defaults to loadOfficePublicBaseUrl(). */
  public_base_url?: string;
  /** Path-first prefix e.g. `/alpha`; empty for subdomain routing. */
  tenant_path_prefix?: string;
  jwt_secret?: string;
  ttl_seconds?: number;
  now?: Date;
  lang?: string;
};

function deny(
  reason: MintOfficeSessionDenyReason,
  message: string,
  status: number,
): MintOfficeSessionResult {
  return { ok: false, reason, message, status };
}

function displayNameFromEmail(email: string, userId: string): string {
  const local = email?.split("@")[0]?.trim();
  if (local) return local.slice(0, 80);
  return userId.slice(0, 80) || "user";
}

/**
 * Create or retrieve an Office session and return ONLYOFFICE editor config + JWT.
 */
export async function mintOfficeEditorSession(
  request: MintOfficeSessionRequest,
  deps: MintOfficeSessionDeps,
): Promise<MintOfficeSessionResult> {
  const mode = request.mode;
  if (mode !== "view" && mode !== "edit") {
    return deny("invalid_mode", "mode must be view or edit", 400);
  }

  let path: string;
  try {
    path = normalizeOfficeMintPath(request.path);
  } catch (err) {
    if (err instanceof InvalidVaultPathError) {
      return deny("bad_path", err.message || "Invalid vault path", 400);
    }
    throw err;
  }

  if (!deps.path_allowed) {
    return deny(
      "acl_denied",
      "Vault path not permitted for user role",
      403,
    );
  }

  const fileTypeRaw = request.file_type?.trim().toLowerCase() || fileTypeFromPath(path);
  if (!fileTypeRaw || !isSupportedOfficeFileType(fileTypeRaw)) {
    return deny(
      "unsupported_file_type",
      "Unsupported or missing Office file type for this path",
      400,
    );
  }
  const file_type: OfficeFileType = fileTypeRaw;

  // Edit requires ui.can.vault_edit (capability honesty).
  if (mode === "edit" && !deps.vault_edit) {
    return deny(
      "missing_write_capability",
      "Edit mode requires ui.can.vault_edit (vault_editor affordance)",
      403,
    );
  }

  // PDF and other non-editable types cannot open in edit mode.
  if (mode === "edit" && !isEditableOfficeFileType(file_type)) {
    return deny(
      "file_type_not_editable",
      `File type ${file_type} does not support edit mode`,
      400,
    );
  }

  let revision: DocumentRevision | undefined = request.revision;
  if (revision) {
    if (!revision.token?.trim()) {
      return deny("missing_revision", "revision.token is required", 400);
    }
    revision = {
      token: revision.token.trim(),
      kind: revision.kind,
      ...(revision.size_bytes !== undefined
        ? { size_bytes: revision.size_bytes }
        : {}),
      ...(revision.modified_at !== undefined
        ? { modified_at: revision.modified_at }
        : {}),
    };
  } else {
    const file = await deps.vaultContentProvider.readFile(path);
    if (!file) {
      // 422 (not 404): portal-static-edge SPA custom_error_response rewrites
      // distribution-wide 403/404 → index.html, which masks mint JSON as
      // text/html (lp-zuh.7.7 / lp-zuh.10.3 mint_spa_html_fallback residual).
      return deny("missing_file", "Vault file not found", 422);
    }
    revision = revisionFromVaultContent(file);
  }

  if (!revision.token) {
    return deny(
      "missing_revision",
      "Cannot mint editor config without content revision",
      400,
    );
  }

  let document_key: string;
  try {
    document_key = mintDocumentKey({
      tenant_id: deps.tenant_id,
      path,
      revision,
      mode,
    });
  } catch (err) {
    if (err instanceof DocumentKeyMintError) {
      if (err.code === "INVALID_PATH") {
        return deny("bad_path", err.message, 400);
      }
      if (err.code === "MISSING_REVISION") {
        return deny("missing_revision", err.message, 400);
      }
      return deny("invalid_body", err.message, 400);
    }
    throw err;
  }

  let jwtSecret: string;
  try {
    jwtSecret =
      deps.jwt_secret ??
      loadOfficeJwtSecret(process.env).secret;
  } catch (err) {
    if ((err as OfficeJwtSecretError)?.name === "OfficeJwtSecretError") {
      return deny(
        "missing_jwt_secret",
        (err as Error).message,
        503,
      );
    }
    throw err;
  }

  let publicBaseUrl: string;
  try {
    publicBaseUrl =
      deps.public_base_url ?? loadOfficePublicBaseUrl(process.env);
  } catch (err) {
    if ((err as OfficePublicBaseUrlError)?.name === "OfficePublicBaseUrlError") {
      return deny(
        "missing_public_base_url",
        (err as Error).message,
        503,
      );
    }
    throw err;
  }

  const now = deps.now ?? new Date();
  const ttl =
    deps.ttl_seconds && deps.ttl_seconds > 0
      ? deps.ttl_seconds
      : DEFAULT_OFFICE_SESSION_TTL_SECONDS;

  const created = await deps.store.create({
    tenant_id: deps.tenant_id,
    user_id: deps.user_id,
    path,
    revision,
    mode,
    file_type,
    document_key,
    caller_key: request.caller_key,
    ttl_seconds: ttl,
    now,
  });

  let session: OfficeDocumentSession = created.session;
  let downloadToken = created.download_token;
  let idempotent_replay = created.idempotent_replay;

  // Idempotent replay does not re-emit the download token. Re-issue a short-lived
  // download capability so document.url stays usable without rotating session id.
  if (idempotent_replay || !downloadToken) {
    downloadToken = generateOfficeSecret();
    const downloadTtlMs = Math.min(
      120_000,
      Math.max(1_000, Date.parse(session.expires_at) - now.getTime()),
    );
    session = {
      ...session,
      download_token_hash: hashDownloadToken(downloadToken),
      download_expires_at: new Date(now.getTime() + downloadTtlMs).toISOString(),
    };
    await deps.store.put(session);
  }

  const document_url = buildOfficeDownloadUrl({
    publicBaseUrl,
    sessionId: session.session_id,
    downloadToken,
    tenantPathPrefix: deps.tenant_path_prefix,
  });

  const callback_url = buildOfficeCallbackUrl({
    publicBaseUrl,
    sessionId: session.session_id,
    callbackNonce: session.callback_nonce,
    tenantPathPrefix: deps.tenant_path_prefix,
  });

  const title = titleFromPath(path, request.title);
  const user_name = displayNameFromEmail(deps.user_email, deps.user_id);

  const editor_config = await buildOnlyOfficeEditorConfig({
    file_type,
    document_key: session.document_key,
    title,
    document_url,
    callback_url,
    mode,
    vault_edit: deps.vault_edit,
    user_id: deps.user_id,
    user_name,
    expires_at: session.expires_at,
    lang: deps.lang,
    jwt_secret: jwtSecret,
    now,
  });

  return {
    ok: true,
    session_id: session.session_id,
    document_key: session.document_key,
    base_revision: session.revision,
    mode: session.mode,
    file_type: session.file_type,
    path: session.path,
    expires_at: session.expires_at,
    editor_config,
    idempotent_replay,
  };
}
