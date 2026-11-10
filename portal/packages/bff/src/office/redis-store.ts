import { normalizeVaultPath } from "@lanyard/shared";

import type { RedisLike } from "../redis-session-store.js";
import { authorizeOfficeSession } from "./authorize.js";
import {
  normalizeOwnershipPath,
  projectActivePathOwnership,
  resolveDownloadTtlSeconds,
  selectPreferredOwnership,
  type OfficeDocumentSessionStore,
} from "./store.js";
import {
  generateOfficeSecret,
  generateOfficeSessionId,
  hashDownloadToken,
  hashIdempotencyKey,
  officeIdempotencyMaterial,
} from "./tokens.js";
import type {
  ActiveOfficePathOwnership,
  CreateOfficeDocumentSessionInput,
  CreateOfficeDocumentSessionResult,
  DocumentRevision,
  OfficeDocumentSession,
  OfficeLastSaveStatus,
  OfficeSessionAuthzResult,
  OfficeSessionLifecycle,
  OfficeSessionPurpose,
} from "./types.js";
import {
  DEFAULT_OFFICE_SESSION_TTL_SECONDS,
  OFFICE_SESSION_IDEM_REDIS_KEY_PREFIX,
  OFFICE_SESSION_REDIS_KEY_PREFIX,
} from "./types.js";

export type RedisOfficeDocumentSessionStoreOptions = {
  /** Absolute TTL seconds for session keys (default 1h). */
  ttlSeconds?: number;
  maxRetries?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function remainingTtlSeconds(expiresAtIso: string, now: Date): number {
  const expiresMs = Date.parse(expiresAtIso);
  if (!Number.isFinite(expiresMs)) return 1;
  return Math.max(1, Math.ceil((expiresMs - now.getTime()) / 1000));
}

/**
 * Redis/Valkey-backed Office document session store for multi-instance BFF.
 *
 * Key layout:
 * - `bff:v1:office:sess:{sessionId}` → JSON OfficeDocumentSession
 * - `bff:v1:office:idem:{sha256(...)}` → sessionId (idempotent create)
 *
 * Fail-closed: read errors after retries return null / not_found.
 */
export class RedisOfficeDocumentSessionStore
  implements OfficeDocumentSessionStore
{
  private readonly ttlSeconds: number;
  private readonly maxRetries: number;

  constructor(
    private readonly redis: RedisLike,
    options: RedisOfficeDocumentSessionStoreOptions = {},
  ) {
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_OFFICE_SESSION_TTL_SECONDS;
    this.maxRetries = options.maxRetries ?? 3;
  }

  private sessKey(sessionId: string): string {
    return `${OFFICE_SESSION_REDIS_KEY_PREFIX}${sessionId}`;
  }

  private idemKey(hash: string): string {
    return `${OFFICE_SESSION_IDEM_REDIS_KEY_PREFIX}${hash}`;
  }

  private async withRetry<T>(op: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await op();
      } catch (error) {
        lastError = error;
        if (attempt + 1 >= this.maxRetries) break;
        await sleep(Math.min(50 * 2 ** attempt, 500));
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError));
  }

  private parseSession(raw: string): OfficeDocumentSession | null {
    try {
      const session = JSON.parse(raw) as OfficeDocumentSession;
      if (
        !session.session_id ||
        !session.tenant_id ||
        !session.user_id ||
        !session.path ||
        !session.revision?.token ||
        !session.download_token_hash ||
        !session.callback_nonce ||
        !session.expires_at
      ) {
        return null;
      }
      return session;
    } catch {
      return null;
    }
  }

  private computeIdemHash(input: {
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

  async create(
    input: CreateOfficeDocumentSessionInput,
  ): Promise<CreateOfficeDocumentSessionResult> {
    const now = input.now ?? new Date();
    const ttl =
      input.ttl_seconds && input.ttl_seconds > 0
        ? input.ttl_seconds
        : this.ttlSeconds;

    if (input.caller_key) {
      const idemHash = this.computeIdemHash({
        tenant_id: input.tenant_id,
        user_id: input.user_id,
        caller_key: input.caller_key,
        path: input.path,
        revision: input.revision,
        mode: input.mode,
      });
      const existingId = await this.withRetry(() =>
        this.redis.get(this.idemKey(idemHash)),
      );
      if (existingId) {
        const raw = await this.withRetry(() =>
          this.redis.get(this.sessKey(existingId)),
        );
        if (raw) {
          const existing = this.parseSession(raw);
          if (
            existing &&
            existing.lifecycle !== "closed" &&
            existing.lifecycle !== "expired" &&
            Date.parse(existing.expires_at) > now.getTime()
          ) {
            return {
              session: existing,
              download_token: "",
              idempotent_replay: true,
            };
          }
        }
      }
    }

    const download_token = input.download_token ?? generateOfficeSecret();
    const expires = new Date(now.getTime() + ttl * 1000);
    const downloadTtl = resolveDownloadTtlSeconds(
      ttl,
      input.download_ttl_seconds,
    );
    const downloadExpires = new Date(now.getTime() + downloadTtl * 1000);
    const session: OfficeDocumentSession = {
      session_id: generateOfficeSessionId(),
      tenant_id: input.tenant_id,
      user_id: input.user_id,
      path: input.path,
      revision: { ...input.revision },
      mode: input.mode,
      file_type: input.file_type,
      document_key: input.document_key,
      download_token_hash: hashDownloadToken(download_token),
      download_expires_at: downloadExpires.toISOString(),
      callback_nonce: input.callback_nonce ?? generateOfficeSecret(),
      lifecycle: "active",
      dirty: input.mode === "edit",
      created_at: now.toISOString(),
      expires_at: expires.toISOString(),
      last_save_status: "none",
      ...(input.caller_key ? { caller_key: input.caller_key } : {}),
    };

    await this.withRetry(() =>
      this.redis.set(
        this.sessKey(session.session_id),
        JSON.stringify(session),
        "EX",
        ttl,
      ),
    );

    if (input.caller_key) {
      const idemHash = this.computeIdemHash({
        tenant_id: input.tenant_id,
        user_id: input.user_id,
        caller_key: input.caller_key,
        path: input.path,
        revision: input.revision,
        mode: input.mode,
      });
      await this.withRetry(() =>
        this.redis.set(
          this.idemKey(idemHash),
          session.session_id,
          "EX",
          ttl,
        ),
      );
    }

    return { session, download_token, idempotent_replay: false };
  }

  async get(sessionId: string): Promise<OfficeDocumentSession | null> {
    try {
      const raw = await this.withRetry(() =>
        this.redis.get(this.sessKey(sessionId)),
      );
      if (!raw) return null;
      return this.parseSession(raw);
    } catch {
      return null;
    }
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

  /**
   * Lab/staging ownership lookup via SCAN of session keys (lp-5q6.32).
   * Acceptable for small session sets; production may add a path index later.
   */
  async findActiveOwnership(input: {
    tenant_id: string;
    path: string;
    now?: Date;
  }): Promise<ActiveOfficePathOwnership | null> {
    const wantPath = normalizeOwnershipPath(input.path);
    if (!wantPath) return null;
    const now = input.now ?? new Date();
    const candidates: ActiveOfficePathOwnership[] = [];

    let cursor = "0";
    do {
      let next: string;
      let keys: string[];
      try {
        [next, keys] = await this.withRetry(() =>
          this.redis.scan(
            cursor,
            "MATCH",
            `${OFFICE_SESSION_REDIS_KEY_PREFIX}*`,
            "COUNT",
            100,
          ),
        );
      } catch {
        return selectPreferredOwnership(candidates);
      }
      cursor = next;
      for (const key of keys) {
        let raw: string | null;
        try {
          raw = await this.withRetry(() => this.redis.get(key));
        } catch {
          continue;
        }
        if (!raw) continue;
        const session = this.parseSession(raw);
        if (!session || session.tenant_id !== input.tenant_id) continue;
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
    } while (cursor !== "0");

    return selectPreferredOwnership(candidates);
  }

  async put(session: OfficeDocumentSession): Promise<void> {
    const ttl = remainingTtlSeconds(session.expires_at, new Date());
    await this.withRetry(() =>
      this.redis.set(
        this.sessKey(session.session_id),
        JSON.stringify(session),
        "EX",
        ttl,
      ),
    );
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
    const current = await this.get(sessionId);
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
    await this.put(next);
    return next;
  }

  async close(sessionId: string, now?: Date): Promise<void> {
    const current = await this.get(sessionId);
    if (!current) return;
    const closedAt = (now ?? new Date()).toISOString();
    await this.put({
      ...current,
      lifecycle: "closed",
      dirty: false,
      last_callback_at: current.last_callback_at ?? closedAt,
    });
  }

  async clear(): Promise<void> {
    for (const prefix of [
      OFFICE_SESSION_REDIS_KEY_PREFIX,
      OFFICE_SESSION_IDEM_REDIS_KEY_PREFIX,
    ]) {
      let cursor = "0";
      do {
        const [next, keys] = await this.redis.scan(
          cursor,
          "MATCH",
          `${prefix}*`,
          "COUNT",
          100,
        );
        cursor = next;
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } while (cursor !== "0");
    }
  }

  async ready(): Promise<boolean> {
    try {
      const pong = await this.withRetry(() => this.redis.ping());
      return pong === "PONG";
    } catch {
      return false;
    }
  }

  async closeStore(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      // ignore
    }
  }
}
