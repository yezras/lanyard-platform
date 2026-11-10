import { InvalidVaultPathError, normalizeVaultPath } from "@lanyard/shared";

import {
  generateOfficeSecret,
  generateOfficeSessionId,
  hashDownloadToken,
  hashIdempotencyKey,
  officeIdempotencyMaterial,
} from "./tokens.js";
import { authorizeOfficeSession } from "./authorize.js";
import type {
  CreateOfficeDocumentSessionInput,
  CreateOfficeDocumentSessionResult,
  OfficeDocumentSession,
  OfficeLastSaveStatus,
  OfficeSessionAuthzResult,
  OfficeSessionLifecycle,
  OfficeSessionPurpose,
  DocumentRevision,
  ActiveOfficePathOwnership,
} from "./types.js";
import {
  DEFAULT_OFFICE_DOWNLOAD_TTL_SECONDS,
  DEFAULT_OFFICE_SESSION_TTL_SECONDS,
  MAX_OFFICE_DOWNLOAD_TTL_SECONDS,
} from "./types.js";

/** Lifecycles that can still represent an open editor for agent write gating. */
const ACTIVE_OWNERSHIP_LIFECYCLES: ReadonlySet<OfficeSessionLifecycle> = new Set([
  "active",
  "saving",
  "conflict",
  "superseded_base",
  "saved",
]);

/**
 * Project a session into path ownership for agent write policy (lp-5q6.32).
 * Returns null when the session should not gate agent writes.
 */
export function projectActivePathOwnership(
  session: OfficeDocumentSession,
  now: Date = new Date(),
): ActiveOfficePathOwnership | null {
  if (!ACTIVE_OWNERSHIP_LIFECYCLES.has(session.lifecycle)) {
    return null;
  }
  if (session.lifecycle === "expired" || session.lifecycle === "closed") {
    return null;
  }
  const expiresMs = Date.parse(session.expires_at);
  if (Number.isFinite(expiresMs) && expiresMs <= now.getTime()) {
    return null;
  }

  let path: string;
  try {
    path = normalizeVaultPath(session.path);
  } catch {
    return null;
  }

  return {
    path,
    tenant_id: session.tenant_id,
    dirty: session.dirty === true && session.mode === "edit",
    mode: session.mode,
    session_id: session.session_id,
    base_revision_token: session.revision?.token,
    user_id: session.user_id,
  };
}

/**
 * Server-owned Office document session store (lp-5q6.21).
 * Memory for lab; Redis for multi-instance BFF.
 */
export interface OfficeDocumentSessionStore {
  /**
   * Create a session. When `caller_key` is set and an active matching session
   * already exists, returns that session (idempotent replay).
   */
  create(
    input: CreateOfficeDocumentSessionInput,
  ): Promise<CreateOfficeDocumentSessionResult>;

  /** Load by opaque id. Returns null if missing. Does not auto-delete expired. */
  get(sessionId: string): Promise<OfficeDocumentSession | null>;

  /**
   * Load + authorize for a purpose. Expired / closed / tenant or user mismatch
   * fail closed without granting download or write.
   */
  authorize(input: {
    session_id: string;
    tenant_id: string;
    user_id?: string;
    purpose: OfficeSessionPurpose;
    now?: Date;
  }): Promise<OfficeSessionAuthzResult>;

  /**
   * Authoritative dirty/active ownership for agent write policy (lp-5q6.32).
   * Prefers a dirty edit session when multiple match; otherwise any active
   * view/edit session on the path; null when none.
   */
  findActiveOwnership(input: {
    tenant_id: string;
    path: string;
    now?: Date;
  }): Promise<ActiveOfficePathOwnership | null>;

  /** Persist a full session record (lifecycle updates, save status, etc.). */
  put(session: OfficeDocumentSession): Promise<void>;

  updateLifecycle(
    sessionId: string,
    lifecycle: OfficeSessionLifecycle,
    patch?: {
      last_save_status?: OfficeLastSaveStatus;
      saved_revision?: DocumentRevision;
      dirty?: boolean;
      last_callback_at?: string;
    },
  ): Promise<OfficeDocumentSession | null>;

  /** Mark closed (user discard). Idempotent if already closed/missing. */
  close(sessionId: string, now?: Date): Promise<void>;

  /** Test / lab only. */
  clear(): Promise<void>;

  ready(): Promise<boolean>;
  closeStore?(): Promise<void>;
}

/** Normalize path for ownership lookup; returns null on invalid. */
export function normalizeOwnershipPath(path: string): string | null {
  try {
    return normalizeVaultPath(path);
  } catch (err) {
    if (err instanceof InvalidVaultPathError) return null;
    throw err;
  }
}

/**
 * Pick the best ownership among candidate sessions for a path.
 * Dirty edit wins over clean/view so agent policy blocks overwrite.
 */
export function selectPreferredOwnership(
  candidates: ActiveOfficePathOwnership[],
): ActiveOfficePathOwnership | null {
  if (candidates.length === 0) return null;
  const dirtyEdit = candidates.find((c) => c.dirty && c.mode === "edit");
  if (dirtyEdit) return dirtyEdit;
  const edit = candidates.find((c) => c.mode === "edit");
  if (edit) return edit;
  return candidates[0] ?? null;
}

/** Resolve download-token TTL: positive, ≤ hard max, ≤ session TTL. */
export function resolveDownloadTtlSeconds(
  sessionTtlSeconds: number,
  downloadTtlSeconds?: number,
): number {
  const requested =
    downloadTtlSeconds && downloadTtlSeconds > 0
      ? downloadTtlSeconds
      : DEFAULT_OFFICE_DOWNLOAD_TTL_SECONDS;
  return Math.min(
    requested,
    MAX_OFFICE_DOWNLOAD_TTL_SECONDS,
    sessionTtlSeconds,
  );
}

function buildSession(
  input: CreateOfficeDocumentSessionInput,
  secrets: {
    session_id: string;
    download_token: string;
    callback_nonce: string;
  },
): OfficeDocumentSession {
  const now = input.now ?? new Date();
  const ttl =
    input.ttl_seconds && input.ttl_seconds > 0
      ? input.ttl_seconds
      : DEFAULT_OFFICE_SESSION_TTL_SECONDS;
  const expires = new Date(now.getTime() + ttl * 1000);
  const downloadTtl = resolveDownloadTtlSeconds(ttl, input.download_ttl_seconds);
  const downloadExpires = new Date(now.getTime() + downloadTtl * 1000);

  return {
    session_id: secrets.session_id,
    tenant_id: input.tenant_id,
    user_id: input.user_id,
    path: input.path,
    revision: { ...input.revision },
    mode: input.mode,
    file_type: input.file_type,
    document_key: input.document_key,
    download_token_hash: hashDownloadToken(secrets.download_token),
    download_expires_at: downloadExpires.toISOString(),
    callback_nonce: secrets.callback_nonce,
    lifecycle: "active",
    dirty: input.mode === "edit",
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
    last_save_status: "none",
    ...(input.caller_key ? { caller_key: input.caller_key } : {}),
  };
}

function idemKeyFor(input: {
  tenant_id: string;
  user_id: string;
  caller_key: string;
  path: string;
  revision: DocumentRevision;
  mode: string;
}): string {
  return hashIdempotencyKey(
    officeIdempotencyMaterial({
      tenant_id: input.tenant_id,
      user_id: input.user_id,
      caller_key: input.caller_key,
      path: input.path,
      revision_token: input.revision.token,
      mode: input.mode,
    }),
  );
}

/**
 * Process-local Office session store.
 * Default for local `pnpm dev` and single-task lab deploy.
 * Not safe for multi-instance without sticky sessions — use Redis.
 */
export class MemoryOfficeDocumentSessionStore
  implements OfficeDocumentSessionStore
{
  private readonly sessions = new Map<string, OfficeDocumentSession>();
  /** idempotency hash → session_id */
  private readonly idemIndex = new Map<string, string>();

  async create(
    input: CreateOfficeDocumentSessionInput,
  ): Promise<CreateOfficeDocumentSessionResult> {
    if (input.caller_key) {
      const idem = idemKeyFor({
        tenant_id: input.tenant_id,
        user_id: input.user_id,
        caller_key: input.caller_key,
        path: input.path,
        revision: input.revision,
        mode: input.mode,
      });
      const existingId = this.idemIndex.get(idem);
      if (existingId) {
        const existing = this.sessions.get(existingId);
        if (existing && existing.lifecycle !== "closed") {
          const now = input.now ?? new Date();
          const expiredByTime =
            Date.parse(existing.expires_at) <= now.getTime();
          const expiredByLifecycle = existing.lifecycle === "expired";
          if (!expiredByTime && !expiredByLifecycle) {
            // Idempotent replay: do not rotate secrets; raw token not re-emitted.
            return {
              session: existing,
              download_token: "",
              idempotent_replay: true,
            };
          }
          // Expired — drop index and create fresh.
          this.idemIndex.delete(idem);
          this.sessions.delete(existingId);
        } else {
          this.idemIndex.delete(idem);
        }
      }
    }

    const download_token = input.download_token ?? generateOfficeSecret();
    const session = buildSession(input, {
      session_id: generateOfficeSessionId(),
      download_token,
      callback_nonce: input.callback_nonce ?? generateOfficeSecret(),
    });

    this.sessions.set(session.session_id, session);
    if (input.caller_key) {
      this.idemIndex.set(
        idemKeyFor({
          tenant_id: input.tenant_id,
          user_id: input.user_id,
          caller_key: input.caller_key,
          path: input.path,
          revision: input.revision,
          mode: input.mode,
        }),
        session.session_id,
      );
    }

    return { session, download_token, idempotent_replay: false };
  }

  async get(sessionId: string): Promise<OfficeDocumentSession | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async authorize(input: {
    session_id: string;
    tenant_id: string;
    user_id?: string;
    purpose: OfficeSessionPurpose;
    now?: Date;
  }): Promise<OfficeSessionAuthzResult> {
    const session = await this.get(input.session_id);
    return authorizeOfficeSession({
      session,
      tenant_id: input.tenant_id,
      user_id: input.user_id,
      purpose: input.purpose,
      now: input.now,
    });
  }

  async findActiveOwnership(input: {
    tenant_id: string;
    path: string;
    now?: Date;
  }): Promise<ActiveOfficePathOwnership | null> {
    const wantPath = normalizeOwnershipPath(input.path);
    if (!wantPath) return null;
    const now = input.now ?? new Date();
    const candidates: ActiveOfficePathOwnership[] = [];
    for (const session of this.sessions.values()) {
      if (session.tenant_id !== input.tenant_id) continue;
      let sessionPath: string;
      try {
        sessionPath = normalizeVaultPath(session.path);
      } catch {
        continue;
      }
      if (sessionPath !== wantPath) continue;
      const projected = projectActivePathOwnership(session, now);
      if (projected) candidates.push(projected);
    }
    return selectPreferredOwnership(candidates);
  }

  async put(session: OfficeDocumentSession): Promise<void> {
    this.sessions.set(session.session_id, session);
  }

  async updateLifecycle(
    sessionId: string,
    lifecycle: OfficeSessionLifecycle,
    patch?: {
      last_save_status?: OfficeLastSaveStatus;
      saved_revision?: DocumentRevision;
      dirty?: boolean;
      last_callback_at?: string;
    },
  ): Promise<OfficeDocumentSession | null> {
    const current = this.sessions.get(sessionId);
    if (!current) return null;
    const next: OfficeDocumentSession = {
      ...current,
      lifecycle,
      ...(patch?.last_save_status !== undefined
        ? { last_save_status: patch.last_save_status }
        : {}),
      ...(patch?.saved_revision !== undefined
        ? { saved_revision: patch.saved_revision }
        : {}),
      ...(patch?.dirty !== undefined ? { dirty: patch.dirty } : {}),
      ...(patch?.last_callback_at !== undefined
        ? { last_callback_at: patch.last_callback_at }
        : {}),
    };
    this.sessions.set(sessionId, next);
    return next;
  }

  async close(sessionId: string, now?: Date): Promise<void> {
    const current = this.sessions.get(sessionId);
    if (!current) return;
    const closedAt = (now ?? new Date()).toISOString();
    this.sessions.set(sessionId, {
      ...current,
      lifecycle: "closed",
      dirty: false,
      last_callback_at: current.last_callback_at ?? closedAt,
    });
  }

  async clear(): Promise<void> {
    this.sessions.clear();
    this.idemIndex.clear();
  }

  async ready(): Promise<boolean> {
    return true;
  }
}

export const OfficeDocumentSessionStore = MemoryOfficeDocumentSessionStore;
