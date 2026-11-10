/**
 * ONLYOFFICE editor config + JWT mint (lp-5q6.26).
 *
 * Browser never builds editor config. BFF owns document URLs, callback URLs,
 * permissions, document.key, and JWT signing.
 *
 * Threat notes §5.3: secret from env/SM only; claims match session; TTL ≤ session.
 * Domain: docs/architecture/portal-document-session-domain-model.md §1.3, §4
 */

import { createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

import { InvalidVaultPathError, normalizeVaultPath } from "@lanyard/shared";

import type {
  DocumentRevision,
  OfficeFileType,
  OfficeSessionMode,
} from "./types.js";
import { OFFICE_DOWNLOAD_FILE_TYPES } from "./types.js";

/** Lab-only default JWT secret (matches deploy lab Document Server compose). */
export const DEV_OFFICE_JWT_SECRET =
  "lab-jwt-secret-placeholder";

/** Lab default DS-visible BFF base (runbook LAB_BFF_PUBLIC_BASE_URL). */
export const DEV_OFFICE_PUBLIC_BASE_URL =
  "http://host.docker.internal:4000";

/** ONLYOFFICE documentType values. */
export type OnlyOfficeDocumentType = "word" | "cell" | "slide" | "pdf";

/**
 * Document permissions embedded in editor config / JWT.
 * Derived from mode + ui.can.vault_edit + file type (never client-supplied).
 */
export type OnlyOfficePermissions = {
  edit: boolean;
  review: boolean;
  comment: boolean;
  download: boolean;
  print: boolean;
  fillForms: boolean;
  modifyFilter: boolean;
  modifyContentControl: boolean;
  copy: boolean;
  chat: boolean;
};

export type OnlyOfficeDocumentConfig = {
  fileType: OfficeFileType;
  key: string;
  title: string;
  url: string;
  permissions: OnlyOfficePermissions;
};

export type OnlyOfficeEditorConfigInner = {
  mode: OfficeSessionMode;
  callbackUrl: string;
  user: {
    id: string;
    name: string;
  };
  lang: string;
};

/**
 * Config returned to the React editor host (and signed into JWT payload).
 * Field names match ONLYOFFICE Docs API config object.
 */
export type OnlyOfficeEditorConfig = {
  documentType: OnlyOfficeDocumentType;
  document: OnlyOfficeDocumentConfig;
  editorConfig: OnlyOfficeEditorConfigInner;
  /** HS256 JWT over documentType + document + editorConfig. */
  token: string;
};

export type OfficeJwtSecretConfig = {
  secret: string;
  /** True when using the lab/dev placeholder (forbidden in production). */
  isDevPlaceholder: boolean;
};

export class OfficeJwtSecretError extends Error {
  readonly code = "MISSING_JWT_SECRET" as const;

  constructor(message: string) {
    super(message);
    this.name = "OfficeJwtSecretError";
  }
}

export class OfficePublicBaseUrlError extends Error {
  readonly code = "MISSING_PUBLIC_BASE_URL" as const;

  constructor(message: string) {
    super(message);
    this.name = "OfficePublicBaseUrlError";
  }
}

/**
 * Load ONLYOFFICE JWT signing secret.
 *
 * Env (never commit values):
 * - BFF_OFFICE_JWT_SECRET (preferred)
 * - ONLYOFFICE_JWT_SECRET
 * - JWT_SECRET (lab DS compose shared name)
 *
 * Production: rejects missing or lab placeholder secret.
 */
export function loadOfficeJwtSecret(
  env: NodeJS.ProcessEnv = process.env,
): OfficeJwtSecretConfig {
  const raw =
    env.BFF_OFFICE_JWT_SECRET?.trim() ||
    env.ONLYOFFICE_JWT_SECRET?.trim() ||
    env.JWT_SECRET?.trim() ||
    "";

  const isProduction = env.NODE_ENV === "production";

  if (isProduction) {
    if (!raw || raw === DEV_OFFICE_JWT_SECRET) {
      throw new OfficeJwtSecretError(
        "BFF_OFFICE_JWT_SECRET (or ONLYOFFICE_JWT_SECRET) must be configured " +
          "to a non-development value in production",
      );
    }
    return { secret: raw, isDevPlaceholder: false };
  }

  if (!raw) {
    return { secret: DEV_OFFICE_JWT_SECRET, isDevPlaceholder: true };
  }
  return {
    secret: raw,
    isDevPlaceholder: raw === DEV_OFFICE_JWT_SECRET,
  };
}

/**
 * DS-reachable BFF public base for document.url and callbackUrl.
 *
 * Env: BFF_OFFICE_PUBLIC_BASE_URL | LAB_BFF_PUBLIC_BASE_URL
 * Production requires an absolute http(s) URL.
 */
export function loadOfficePublicBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw =
    env.BFF_OFFICE_PUBLIC_BASE_URL?.trim() ||
    env.LAB_BFF_PUBLIC_BASE_URL?.trim() ||
    "";

  const isProduction = env.NODE_ENV === "production";

  if (!raw) {
    if (isProduction) {
      throw new OfficePublicBaseUrlError(
        "BFF_OFFICE_PUBLIC_BASE_URL must be configured in production " +
          "(Document Server must reach BFF download + callback URLs)",
      );
    }
    return DEV_OFFICE_PUBLIC_BASE_URL;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new OfficePublicBaseUrlError(
      `BFF_OFFICE_PUBLIC_BASE_URL is not a valid URL: ${raw}`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new OfficePublicBaseUrlError(
      "BFF_OFFICE_PUBLIC_BASE_URL must use http or https",
    );
  }
  return raw.replace(/\/+$/, "");
}

/** Map Office file type → ONLYOFFICE documentType. */
export function documentTypeForFileType(
  fileType: OfficeFileType,
): OnlyOfficeDocumentType {
  switch (fileType) {
    case "docx":
    case "doc":
    case "odt":
      return "word";
    case "xlsx":
    case "xls":
    case "ods":
      return "cell";
    case "pptx":
    case "ppt":
    case "odp":
      return "slide";
    case "pdf":
      return "pdf";
    default: {
      const _exhaustive: never = fileType;
      return _exhaustive;
    }
  }
}

/** File types that support edit mode writeback (not PDF). */
export const EDITABLE_OFFICE_FILE_TYPES: ReadonlySet<OfficeFileType> = new Set([
  "docx",
  "xlsx",
  "pptx",
  "doc",
  "xls",
  "ppt",
  "odt",
  "ods",
  "odp",
]);

export function isEditableOfficeFileType(fileType: OfficeFileType): boolean {
  return EDITABLE_OFFICE_FILE_TYPES.has(fileType);
}

export function isSupportedOfficeFileType(
  value: string,
): value is OfficeFileType {
  return OFFICE_DOWNLOAD_FILE_TYPES.has(value as OfficeFileType);
}

/**
 * Derive Office file type from vault path extension.
 * Returns null when missing or unsupported.
 */
export function fileTypeFromPath(path: string): OfficeFileType | null {
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0 || dot === lower.length - 1) return null;
  const ext = lower.slice(dot + 1);
  return isSupportedOfficeFileType(ext) ? ext : null;
}

/** Display title from path basename (or optional override). */
export function titleFromPath(path: string, override?: string): string {
  const trimmed = override?.trim();
  if (trimmed) return trimmed.slice(0, 200);
  const normalized = path.replace(/\\/g, "/");
  const base = normalized.split("/").filter(Boolean).pop() || "document";
  return base.slice(0, 200);
}

/**
 * Resolve ONLYOFFICE permissions from mode, capability, and file type.
 *
 * - view mode → edit false
 * - edit mode without vault_edit → edit false (caller should fail closed before mint)
 * - pdf → never edit
 * - download/print remain true for authorized sessions
 */
export function resolveOfficePermissions(input: {
  mode: OfficeSessionMode;
  vault_edit: boolean;
  file_type: OfficeFileType;
}): OnlyOfficePermissions {
  const canEdit =
    input.mode === "edit" &&
    input.vault_edit &&
    isEditableOfficeFileType(input.file_type);

  return {
    edit: canEdit,
    review: canEdit,
    comment: canEdit,
    download: true,
    print: true,
    fillForms: canEdit,
    modifyFilter: canEdit,
    modifyContentControl: canEdit,
    copy: true,
    chat: false,
  };
}

export type BuildOnlyOfficeEditorConfigInput = {
  file_type: OfficeFileType;
  document_key: string;
  title: string;
  document_url: string;
  callback_url: string;
  mode: OfficeSessionMode;
  vault_edit: boolean;
  user_id: string;
  user_name: string;
  /** ISO-8601 session expiry — JWT exp aligns with this. */
  expires_at: string;
  lang?: string;
  /** Inject JWT secret (tests). */
  jwt_secret: string;
  /** Inject clock for tests. */
  now?: Date;
};

/**
 * Build editor config object and sign JWT (HS256).
 * Does not create sessions — call after OfficeDocumentSession is stored.
 */
export async function buildOnlyOfficeEditorConfig(
  input: BuildOnlyOfficeEditorConfigInput,
): Promise<OnlyOfficeEditorConfig> {
  const documentType = documentTypeForFileType(input.file_type);
  const permissions = resolveOfficePermissions({
    mode: input.mode,
    vault_edit: input.vault_edit,
    file_type: input.file_type,
  });

  // Effective editor mode must match permissions.edit (never claim edit without it).
  const effectiveMode: OfficeSessionMode = permissions.edit ? "edit" : "view";

  const document: OnlyOfficeDocumentConfig = {
    fileType: input.file_type,
    key: input.document_key,
    title: input.title,
    url: input.document_url,
    permissions,
  };

  const editorConfig: OnlyOfficeEditorConfigInner = {
    mode: effectiveMode,
    callbackUrl: input.callback_url,
    user: {
      id: input.user_id,
      name: input.user_name,
    },
    lang: input.lang?.trim() || "en",
  };

  const token = await signOnlyOfficeEditorJwt({
    documentType,
    document,
    editorConfig,
    expires_at: input.expires_at,
    secret: input.jwt_secret,
    now: input.now,
  });

  return {
    documentType,
    document,
    editorConfig,
    token,
  };
}

/**
 * Sign ONLYOFFICE editor JWT. Payload mirrors config fields DS validates.
 * Never log the token or secret.
 */
export async function signOnlyOfficeEditorJwt(input: {
  documentType: OnlyOfficeDocumentType;
  document: OnlyOfficeDocumentConfig;
  editorConfig: OnlyOfficeEditorConfigInner;
  expires_at: string;
  secret: string;
  now?: Date;
}): Promise<string> {
  if (!input.secret) {
    throw new OfficeJwtSecretError("JWT secret is empty");
  }

  const expMs = Date.parse(input.expires_at);
  if (!Number.isFinite(expMs)) {
    throw new Error("signOnlyOfficeEditorJwt requires valid expires_at");
  }

  const now = input.now ?? new Date();
  const expSec = Math.floor(expMs / 1000);
  const iatSec = Math.floor(now.getTime() / 1000);
  if (expSec <= iatSec) {
    throw new Error("signOnlyOfficeEditorJwt: expires_at must be in the future");
  }

  const key = new TextEncoder().encode(input.secret);

  return new SignJWT({
    documentType: input.documentType,
    document: input.document,
    editorConfig: input.editorConfig,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(iatSec)
    .setExpirationTime(expSec)
    .sign(key);
}

/**
 * Verify editor JWT shape (tests + optional runtime checks).
 * Returns payload claims; does not re-validate session store.
 */
export async function verifyOnlyOfficeEditorJwt(
  token: string,
  secret: string,
): Promise<{
  documentType: OnlyOfficeDocumentType;
  document: OnlyOfficeDocumentConfig;
  editorConfig: OnlyOfficeEditorConfigInner;
  exp?: number;
  iat?: number;
}> {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key, {
    algorithms: ["HS256"],
  });

  const documentType = payload.documentType as OnlyOfficeDocumentType;
  const document = payload.document as OnlyOfficeDocumentConfig;
  const editorConfig = payload.editorConfig as OnlyOfficeEditorConfigInner;

  if (!documentType || !document || !editorConfig) {
    throw new Error("JWT missing documentType/document/editorConfig claims");
  }

  return {
    documentType,
    document,
    editorConfig,
    exp: typeof payload.exp === "number" ? payload.exp : undefined,
    iat: typeof payload.iat === "number" ? payload.iat : undefined,
  };
}

/**
 * Content-hash revision from vault file bytes (lab / local provider).
 * Prefer host etag when Brain RPC vault.stat exposes it later.
 */
export function revisionFromVaultContent(content: {
  content: string;
  encoding: "utf-8" | "base64";
  size_bytes?: number;
}): DocumentRevision {
  const bytes =
    content.encoding === "base64"
      ? Buffer.from(content.content, "base64")
      : Buffer.from(content.content, "utf8");
  const token = createHash("sha256").update(bytes).digest("hex");
  return {
    token,
    kind: "content_hash",
    size_bytes: content.size_bytes ?? bytes.byteLength,
  };
}

/**
 * Normalize vault path for mint; throws InvalidVaultPathError on bad path.
 */
export function normalizeOfficeMintPath(path: string): string {
  return normalizeVaultPath(path);
}

export { InvalidVaultPathError };
