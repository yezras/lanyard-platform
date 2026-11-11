import { randomUUID } from "node:crypto";

import { isUniqueViolation, type SqlClient } from "./db.js";
import type { SessionShareGrant, SessionShareMode } from "./types.js";

export class SessionShareNotFoundError extends Error {
  readonly code = "SESSION_SHARE_NOT_FOUND";

  constructor(grant_id: string) {
    super(`Session share grant not found: ${grant_id}`);
    this.name = "SessionShareNotFoundError";
  }
}

export class SessionShareGranteeNotFoundError extends Error {
  readonly code = "SESSION_SHARE_GRANTEE_NOT_FOUND";

  constructor(email: string) {
    super(`Grantee user not found: ${email}`);
    this.name = "SessionShareGranteeNotFoundError";
  }
}

export class SessionShareSelfGrantError extends Error {
  readonly code = "SESSION_SHARE_SELF_GRANT";

  constructor() {
    super("Cannot share a session with yourself");
    this.name = "SessionShareSelfGrantError";
  }
}

export class SessionShareOwnerNotFoundError extends Error {
  readonly code = "SESSION_SHARE_OWNER_NOT_FOUND";

  constructor(owner_user_id: string) {
    super(`Owner user not found in tenant: ${owner_user_id}`);
    this.name = "SessionShareOwnerNotFoundError";
  }
}

export class SessionShareConflictError extends Error {
  readonly code = "SESSION_SHARE_CONFLICT";

  constructor(thread_id: string, grantee_user_id: string) {
    super(
      `Active share already exists for thread ${thread_id} and user ${grantee_user_id}`,
    );
    this.name = "SessionShareConflictError";
  }
}

type AuditRecorder = (input: {
  tenant_id: string | null;
  action: "session_share.created" | "session_share.revoked";
  actor: string | null;
  metadata: Record<string, unknown>;
}) => Promise<void> | void;

function mapGrantRow(row: {
  grant_id: string;
  tenant_id: string;
  thread_id: string;
  owner_user_id: string;
  grantee_user_id: string;
  mode: string;
  created_at: string;
  revoked_at: string | null;
}): SessionShareGrant {
  return {
    grant_id: row.grant_id,
    tenant_id: row.tenant_id,
    thread_id: row.thread_id,
    owner_user_id: row.owner_user_id,
    grantee_user_id: row.grantee_user_id,
    mode: row.mode as SessionShareMode,
    created_at: row.created_at,
    revoked_at: row.revoked_at,
  };
}

export async function getUserByEmail(
  db: SqlClient,
  tenant_id: string,
  email: string,
): Promise<{ user_id: string; email: string } | null> {
  const row = await db.get<{ user_id: string; email: string }>(
    `SELECT user_id, email
     FROM users
     WHERE tenant_id = ? AND email = ?`,
    [tenant_id, email.trim().toLowerCase()],
  );

  return row ?? null;
}

export async function createSessionShareGrant(
  db: SqlClient,
  recordAudit: AuditRecorder,
  input: {
    tenant_id: string;
    owner_user_id: string;
    thread_id: string;
    grantee_email: string;
    mode: SessionShareMode;
    actor?: string;
  },
): Promise<SessionShareGrant> {
  // Owner must be a user of this tenant (app + DB trigger defense-in-depth).
  const owner = await db.get<{ user_id: string }>(
    `SELECT user_id FROM users WHERE user_id = ? AND tenant_id = ?`,
    [input.owner_user_id, input.tenant_id],
  );
  if (!owner) {
    throw new SessionShareOwnerNotFoundError(input.owner_user_id);
  }

  const grantee = await getUserByEmail(db, input.tenant_id, input.grantee_email);
  if (!grantee) {
    throw new SessionShareGranteeNotFoundError(input.grantee_email);
  }

  if (grantee.user_id === input.owner_user_id) {
    throw new SessionShareSelfGrantError();
  }

  const existing = await db.get<{ grant_id: string }>(
    `SELECT grant_id
     FROM session_share_grants
     WHERE tenant_id = ? AND thread_id = ? AND grantee_user_id = ?
       AND revoked_at IS NULL`,
    [input.tenant_id, input.thread_id, grantee.user_id],
  );

  if (existing) {
    throw new SessionShareConflictError(input.thread_id, grantee.user_id);
  }

  const grant_id = randomUUID();
  const created_at = new Date().toISOString();

  try {
    await db.run(
      `INSERT INTO session_share_grants
       (grant_id, tenant_id, thread_id, owner_user_id, grantee_user_id, mode, created_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        grant_id,
        input.tenant_id,
        input.thread_id,
        input.owner_user_id,
        grantee.user_id,
        input.mode,
        created_at,
      ],
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new SessionShareConflictError(input.thread_id, grantee.user_id);
    }
    throw error;
  }

  const grant = mapGrantRow({
    grant_id,
    tenant_id: input.tenant_id,
    thread_id: input.thread_id,
    owner_user_id: input.owner_user_id,
    grantee_user_id: grantee.user_id,
    mode: input.mode,
    created_at,
    revoked_at: null,
  });

  await recordAudit({
    tenant_id: input.tenant_id,
    action: "session_share.created",
    actor: input.actor ?? null,
    metadata: {
      grant_id,
      thread_id: input.thread_id,
      owner_user_id: input.owner_user_id,
      grantee_user_id: grantee.user_id,
      grantee_email: grantee.email,
      mode: input.mode,
    },
  });

  return grant;
}

export async function listSessionShareGrantsForGrantee(
  db: SqlClient,
  tenant_id: string,
  grantee_user_id: string,
): Promise<SessionShareGrant[]> {
  const rows = await db.all<{
    grant_id: string;
    tenant_id: string;
    thread_id: string;
    owner_user_id: string;
    grantee_user_id: string;
    mode: string;
    created_at: string;
    revoked_at: string | null;
  }>(
    `SELECT grant_id, tenant_id, thread_id, owner_user_id, grantee_user_id,
            mode, created_at, revoked_at
     FROM session_share_grants
     WHERE tenant_id = ? AND grantee_user_id = ? AND revoked_at IS NULL
     ORDER BY created_at DESC`,
    [tenant_id, grantee_user_id],
  );

  return rows.map(mapGrantRow);
}

export async function listSessionShareGrantsForThread(
  db: SqlClient,
  tenant_id: string,
  owner_user_id: string,
  thread_id: string,
): Promise<SessionShareGrant[]> {
  const rows = await db.all<{
    grant_id: string;
    tenant_id: string;
    thread_id: string;
    owner_user_id: string;
    grantee_user_id: string;
    mode: string;
    created_at: string;
    revoked_at: string | null;
  }>(
    `SELECT grant_id, tenant_id, thread_id, owner_user_id, grantee_user_id,
            mode, created_at, revoked_at
     FROM session_share_grants
     WHERE tenant_id = ? AND owner_user_id = ? AND thread_id = ?
       AND revoked_at IS NULL
     ORDER BY created_at DESC`,
    [tenant_id, owner_user_id, thread_id],
  );

  return rows.map(mapGrantRow);
}

export async function getActiveSessionShareGrant(
  db: SqlClient,
  tenant_id: string,
  thread_id: string,
  grantee_user_id: string,
): Promise<SessionShareGrant | null> {
  const row = await db.get<{
    grant_id: string;
    tenant_id: string;
    thread_id: string;
    owner_user_id: string;
    grantee_user_id: string;
    mode: string;
    created_at: string;
    revoked_at: string | null;
  }>(
    `SELECT grant_id, tenant_id, thread_id, owner_user_id, grantee_user_id,
            mode, created_at, revoked_at
     FROM session_share_grants
     WHERE tenant_id = ? AND thread_id = ? AND grantee_user_id = ?
       AND revoked_at IS NULL`,
    [tenant_id, thread_id, grantee_user_id],
  );

  return row ? mapGrantRow(row) : null;
}

export async function revokeSessionShareGrant(
  db: SqlClient,
  recordAudit: AuditRecorder,
  input: {
    tenant_id: string;
    owner_user_id: string;
    thread_id: string;
    grantee_user_id: string;
    actor?: string;
  },
): Promise<SessionShareGrant> {
  const row = await db.get<{
    grant_id: string;
    tenant_id: string;
    thread_id: string;
    owner_user_id: string;
    grantee_user_id: string;
    mode: string;
    created_at: string;
    revoked_at: string | null;
  }>(
    `SELECT grant_id, tenant_id, thread_id, owner_user_id, grantee_user_id,
            mode, created_at, revoked_at
     FROM session_share_grants
     WHERE tenant_id = ? AND owner_user_id = ? AND thread_id = ?
       AND grantee_user_id = ? AND revoked_at IS NULL`,
    [
      input.tenant_id,
      input.owner_user_id,
      input.thread_id,
      input.grantee_user_id,
    ],
  );

  if (!row) {
    throw new SessionShareNotFoundError(
      `${input.thread_id}:${input.grantee_user_id}`,
    );
  }

  const revoked_at = new Date().toISOString();
  await db.run(
    `UPDATE session_share_grants SET revoked_at = ? WHERE grant_id = ?`,
    [revoked_at, row.grant_id],
  );

  const grant = mapGrantRow({ ...row, revoked_at });

  await recordAudit({
    tenant_id: input.tenant_id,
    action: "session_share.revoked",
    actor: input.actor ?? null,
    metadata: {
      grant_id: row.grant_id,
      thread_id: input.thread_id,
      owner_user_id: input.owner_user_id,
      grantee_user_id: input.grantee_user_id,
    },
  });

  return grant;
}
