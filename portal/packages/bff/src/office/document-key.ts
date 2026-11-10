/**
 * ONLYOFFICE document.key mint and revision invalidation (lp-5q6.24).
 *
 * Policy: docs/architecture/portal-document-key-invalidation.md
 * Domain: conflict policy §4; session model §5.1–§5.2
 *
 * BFF owns mint. Document Server only caches by the key we supply.
 * Never use raw vault path as document.key.
 */

import { createHash } from "node:crypto";

import { InvalidVaultPathError, normalizeVaultPath } from "@lanyard/shared";

import type { DocumentRevision, OfficeSessionMode } from "./types.js";

/** Schema version prefix inside the hashed material (not the key string). */
export const DOCUMENT_KEY_MATERIAL_VERSION = "v1" as const;

/**
 * ONLYOFFICE practical limits: length ≤ 128; safe charset for keys.
 * Portal uses SHA-256 hex (64 chars of [0-9a-f]).
 */
export const ONLYOFFICE_DOCUMENT_KEY_MAX_LENGTH = 128;

/** Hex digest length for SHA-256. */
export const DOCUMENT_KEY_HEX_LENGTH = 64;

/** Allowed characters for Portal-minted keys (subset of ONLYOFFICE-safe set). */
export const ONLYOFFICE_DOCUMENT_KEY_CHARSET = /^[0-9a-f]+$/;

export class DocumentKeyMintError extends Error {
  readonly code:
    | "MISSING_TENANT"
    | "MISSING_PATH"
    | "MISSING_REVISION"
    | "INVALID_PATH"
    | "INVALID_MODE";

  constructor(
    code: DocumentKeyMintError["code"],
    message: string,
  ) {
    super(message);
    this.name = "DocumentKeyMintError";
    this.code = code;
  }
}

export type MintDocumentKeyInput = {
  tenant_id: string;
  /** Vault path; normalized before hashing. */
  path: string;
  /** Host revision; token is required (fail closed). */
  revision: Pick<DocumentRevision, "token"> | { token: string };
  mode: OfficeSessionMode;
};

/**
 * Build canonical material for the digest.
 * Format: v1|{tenant_id}|{normalized_path}|{revision.token}|{mode}
 */
export function buildDocumentKeyMaterial(input: MintDocumentKeyInput): string {
  const tenant = input.tenant_id?.trim() ?? "";
  if (!tenant) {
    throw new DocumentKeyMintError(
      "MISSING_TENANT",
      "document.key mint requires tenant_id",
    );
  }

  const rawPath = input.path?.trim() ?? "";
  if (!rawPath) {
    throw new DocumentKeyMintError(
      "MISSING_PATH",
      "document.key mint requires path",
    );
  }

  let normalizedPath: string;
  try {
    normalizedPath = normalizeVaultPath(rawPath);
  } catch (err) {
    if (err instanceof InvalidVaultPathError) {
      throw new DocumentKeyMintError(
        "INVALID_PATH",
        `document.key mint rejected path: ${rawPath}`,
      );
    }
    throw err;
  }

  const revisionToken = input.revision?.token?.trim() ?? "";
  if (!revisionToken) {
    throw new DocumentKeyMintError(
      "MISSING_REVISION",
      "document.key mint requires content revision token (fail closed)",
    );
  }

  const mode = input.mode;
  if (mode !== "view" && mode !== "edit") {
    throw new DocumentKeyMintError(
      "INVALID_MODE",
      "document.key mint requires mode view|edit",
    );
  }

  return [
    DOCUMENT_KEY_MATERIAL_VERSION,
    tenant,
    normalizedPath,
    revisionToken,
    mode,
  ].join("|");
}

/**
 * Mint ONLYOFFICE document.key: SHA-256 hex of canonical material.
 * Deterministic: same inputs ⇒ same key. Includes tenant + path + revision + mode.
 */
export function mintDocumentKey(input: MintDocumentKeyInput): string {
  const material = buildDocumentKeyMaterial(input);
  const key = createHash("sha256").update(material, "utf8").digest("hex");
  if (!isValidOnlyOfficeDocumentKey(key)) {
    // Should be unreachable for SHA-256 hex; guard against future algorithm drift.
    throw new Error("mintDocumentKey produced key outside ONLYOFFICE constraints");
  }
  return key;
}

/** True when key meets Portal mint constraints (charset + length). */
export function isValidOnlyOfficeDocumentKey(key: string): boolean {
  if (!key || key.length === 0) return false;
  if (key.length > ONLYOFFICE_DOCUMENT_KEY_MAX_LENGTH) return false;
  if (key.length !== DOCUMENT_KEY_HEX_LENGTH) return false;
  return ONLYOFFICE_DOCUMENT_KEY_CHARSET.test(key);
}

// ---------------------------------------------------------------------------
// Revision invalidation (BFF session / policy decisions)
// ---------------------------------------------------------------------------

export type DocumentKeyInvalidationAction = "none" | "reload" | "conflict";

export type DocumentKeyInvalidationDecision =
  | {
      action: "none";
      auto_refresh: false;
      revisions_match: true;
    }
  | {
      action: "reload";
      auto_refresh: true;
      revisions_match: false;
      reason: "external_revision_advance";
      /** When mint inputs are provided, the key for the new revision. */
      new_document_key?: string;
    }
  | {
      action: "conflict";
      auto_refresh: false;
      revisions_match: false;
      reason: "superseded_base";
      /** BFF session lifecycle to apply when dirty edit is open. */
      session_lifecycle: "superseded_base";
      banner_message: string;
      offered_actions: ReadonlyArray<
        "reload" | "save_as_conflict_copy" | "discard_local"
      >;
    };

export type EvaluateDocumentKeyInvalidationInput = {
  /** Revision frozen at open / last clean save. */
  base_revision_token: string | null | undefined;
  /** Latest host revision for the path. */
  current_revision_token: string | null | undefined;
  /**
   * True when human has unsaved work or an active edit session that must
   * not auto-swap document.key (server dirty or conservative localDirty).
   */
  dirty: boolean;
  /**
   * Optional: when action is reload and mint inputs are complete, include
   * the new document key for the current revision.
   */
  mint?: MintDocumentKeyInput;
};

/**
 * Decide reload vs conflict when host revision may have advanced.
 *
 * - Revisions equal → none
 * - Differ + not dirty → reload (auto-refresh; new key on next mint)
 * - Differ + dirty → conflict (no auto-refresh; banner; superseded_base)
 */
export function evaluateDocumentKeyInvalidation(
  input: EvaluateDocumentKeyInvalidationInput,
): DocumentKeyInvalidationDecision {
  const base = input.base_revision_token?.trim() ?? "";
  const current = input.current_revision_token?.trim() ?? "";

  // Missing current revision: cannot assert advance; treat as unchanged.
  if (!current || (base && base === current)) {
    return {
      action: "none",
      auto_refresh: false,
      revisions_match: true,
    };
  }

  // No base yet (e.g. first open) but current known — not an invalidation event.
  if (!base) {
    return {
      action: "none",
      auto_refresh: false,
      revisions_match: true,
    };
  }

  if (input.dirty) {
    return {
      action: "conflict",
      auto_refresh: false,
      revisions_match: false,
      reason: "superseded_base",
      session_lifecycle: "superseded_base",
      banner_message:
        "Document changed while you were editing. Reload or save a conflict copy.",
      offered_actions: ["reload", "save_as_conflict_copy", "discard_local"],
    };
  }

  let new_document_key: string | undefined;
  if (input.mint) {
    new_document_key = mintDocumentKey({
      ...input.mint,
      revision: { token: current },
    });
  }

  return {
    action: "reload",
    auto_refresh: true,
    revisions_match: false,
    reason: "external_revision_advance",
    new_document_key,
  };
}
