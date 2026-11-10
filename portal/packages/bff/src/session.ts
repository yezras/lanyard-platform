import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

export const SESSION_COOKIE = "lanyard_session";
export const CSRF_COOKIE = "lanyard_csrf";
/** Lanyard ops console cookie (`/admin`). Never a tenant Portal session. */
export const OPS_SESSION_COOKIE = "lanyard_ops_session";

/** Redis key prefix for portal browser sessions (G5). */
export const SESSION_REDIS_KEY_PREFIX = "bff:v1:sess:";

/** Sliding TTL default: 7 days. */
export const DEFAULT_SESSION_TTL_SECONDS = 604_800;

/** Absolute max age default: 30 days from createdAt. */
export const DEFAULT_SESSION_MAX_AGE_SECONDS = 2_592_000;

export type SessionRecord = {
  sessionId: string;
  userId: string;
  tenantId: string;
  email: string;
  createdAt: number;
};

export type SessionUser = {
  user_id: string;
  email: string;
  tenant_id: string;
};

/**
 * Session store contract (G5.1/G5.2).
 * Memory backend for lab/single-task; Redis for multi-instance.
 */
export interface SessionStore {
  create(input: {
    userId: string;
    tenantId: string;
    email: string;
  }): Promise<SessionRecord>;
  get(sessionId: string): Promise<SessionRecord | null>;
  delete(sessionId: string): Promise<void>;
  /** Test / lab only. */
  clear(): Promise<void>;
  /** Readiness: memory always true; redis PINGs. */
  ready(): Promise<boolean>;
  /** Optional dispose (redis connection). */
  close?(): Promise<void>;
}

/**
 * Process-local session store.
 * Default for local `pnpm dev` and single-task deploy (desired count = 1).
 * Not safe for multi-instance without sticky sessions.
 */
export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  async create(input: {
    userId: string;
    tenantId: string;
    email: string;
  }): Promise<SessionRecord> {
    const session: SessionRecord = {
      sessionId: randomBytes(24).toString("base64url"),
      userId: input.userId,
      tenantId: input.tenantId,
      email: input.email,
      createdAt: Date.now(),
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  async get(sessionId: string): Promise<SessionRecord | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async clear(): Promise<void> {
    this.sessions.clear();
  }

  async ready(): Promise<boolean> {
    return true;
  }
}

/**
 * Value alias so `new SessionStore()` still constructs the memory backend.
 * Type `SessionStore` remains the interface (merged with this const).
 */
export const SessionStore = MemorySessionStore;

export function createCsrfToken(): string {
  return randomBytes(24).toString("base64url");
}

export function signOAuthState(
  payload: Record<string, string>,
  secret: string,
): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyOAuthState(
  state: string,
  secret: string,
): Record<string, string> | null {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature) {
    return null;
  }

  const expected = createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");
  const actual = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (
    actual.length !== expectedBuf.length ||
    !timingSafeEqual(actual, expectedBuf)
  ) {
    return null;
  }

  try {
    return JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Record<string, string>;
  } catch {
    return null;
  }
}

type CookieContext = Parameters<typeof setCookie>[0];

export function setSessionCookie(
  c: CookieContext,
  sessionId: string,
  secure: boolean,
): void {
  setCookie(c, SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
  });
}

export function clearSessionCookie(c: CookieContext, secure: boolean): void {
  deleteCookie(c, SESSION_COOKIE, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
  });
}

export function setCsrfCookie(
  c: CookieContext,
  token: string,
  secure: boolean,
): void {
  setCookie(c, CSRF_COOKIE, token, {
    httpOnly: false,
    secure,
    sameSite: "Lax",
    path: "/",
  });
}

export function readSessionId(c: Context): string | null {
  return getCookie(c, SESSION_COOKIE) ?? null;
}

export function readCsrfToken(c: Context): string | null {
  return getCookie(c, CSRF_COOKIE) ?? null;
}

export function readOpsSessionId(c: Context): string | null {
  return getCookie(c, OPS_SESSION_COOKIE) ?? null;
}

export async function resolveSessionUser(
  store: SessionStore,
  sessionId: string | null,
  tenantId: string,
): Promise<SessionUser | null> {
  if (!sessionId) {
    return null;
  }

  const session = await store.get(sessionId);
  if (!session || session.tenantId !== tenantId) {
    return null;
  }

  return {
    user_id: session.userId,
    email: session.email,
    tenant_id: session.tenantId,
  };
}
