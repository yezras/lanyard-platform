/**
 * Ops tenant people and person-connector grants (lp-hdzm.6).
 *
 * Admin|Member lives on the user row. A person grant is presence of
 * (tenant_id, user_id, connector_id) — insert on, delete off. Not
 * Hermes role×connector.
 */
import { randomUUID } from "node:crypto";

import {
  parseConnectorId,
  type ConnectorId,
} from "./connectors.js";
import { isUniqueViolation, type SqlClient } from "./db.js";
import { UserEmailConflictError, UserNotFoundError } from "./rbac.js";
import type { AuditAction } from "./types.js";
import {
  OPS_TENANT_USER_ROLES,
  type OpsConnectorUser,
  type OpsTenantUser,
  type OpsTenantUserRole,
} from "./types.js";

type AuditRecorder = (input: {
  tenant_id: string | null;
  action: AuditAction;
  actor: string | null;
  metadata: Record<string, unknown>;
}) => Promise<void> | void;

export class LastTenantAdminError extends Error {
  readonly code = "LAST_TENANT_ADMIN";

  constructor() {
    super("Cannot remove the last tenant admin");
    this.name = "LastTenantAdminError";
  }
}

export class InvalidTenantRoleError extends Error {
  readonly code = "INVALID_TENANT_ROLE";

  constructor(value: string) {
    super(`Unknown tenant role: ${value}`);
    this.name = "InvalidTenantRoleError";
  }
}

export function isOpsTenantUserRole(value: string): value is OpsTenantUserRole {
  return (OPS_TENANT_USER_ROLES as readonly string[]).includes(value);
}

export function parseOpsTenantUserRole(value: string): OpsTenantUserRole {
  if (!isOpsTenantUserRole(value)) {
    throw new InvalidTenantRoleError(value);
  }
  return value;
}

export function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0]?.trim() ?? "";
  return local || email;
}

export function opsRoleLabel(role: OpsTenantUserRole): string {
  return role === "tenant_admin" ? "Tenant admin" : "Member";
}

type UserRow = {
  user_id: string;
  display_name: string;
  email: string;
  tenant_role: string;
  last_active_at: string | null;
};

function mapRole(value: string): OpsTenantUserRole {
  return parseOpsTenantUserRole(value);
}

async function countTenantAdmins(
  db: SqlClient,
  tenant_id: string,
): Promise<number> {
  const row = await db.get<{ n: number | string }>(
    `SELECT COUNT(*) AS n
     FROM users
     WHERE tenant_id = ? AND tenant_role = 'tenant_admin'`,
    [tenant_id],
  );
  return Number(row?.n ?? 0);
}

async function getUserRow(
  db: SqlClient,
  tenant_id: string,
  user_id: string,
): Promise<UserRow> {
  const row = await db.get<UserRow>(
    `SELECT u.user_id,
            CASE
              WHEN u.display_name IS NULL OR u.display_name = '' THEN split_part(u.email, '@', 1)
              ELSE u.display_name
            END AS display_name,
            u.email,
            u.tenant_role,
            (
              SELECT MAX(gi.last_activity_at)
              FROM gateway_instances gi
              WHERE gi.tenant_id = u.tenant_id
                AND gi.owner_user_id = u.user_id
            ) AS last_active_at
     FROM users u
     WHERE u.tenant_id = ? AND u.user_id = ?`,
    [tenant_id, user_id],
  );
  if (!row) {
    throw new UserNotFoundError(user_id);
  }
  return row;
}

async function grantsByUser(
  db: SqlClient,
  tenant_id: string,
  userIds: string[],
): Promise<Map<string, ConnectorId[]>> {
  const map = new Map<string, ConnectorId[]>();
  for (const id of userIds) {
    map.set(id, []);
  }
  if (userIds.length === 0) {
    return map;
  }
  const rows = await db.all<{ user_id: string; connector_id: string }>(
    `SELECT user_id, connector_id
     FROM person_connector_grants
     WHERE tenant_id = ?
     ORDER BY user_id, connector_id`,
    [tenant_id],
  );
  for (const row of rows) {
    const list = map.get(row.user_id);
    if (!list) {
      continue;
    }
    list.push(row.connector_id as ConnectorId);
  }
  return map;
}

function toOpsUser(row: UserRow, connectors: ConnectorId[]): OpsTenantUser {
  return {
    user_id: row.user_id,
    display_name: row.display_name,
    email: row.email,
    role: mapRole(row.tenant_role),
    connectors,
    last_active_at: row.last_active_at,
  };
}

export async function listOpsTenantUsers(
  db: SqlClient,
  tenant_id: string,
): Promise<OpsTenantUser[]> {
  const rows = await db.all<UserRow>(
    `SELECT u.user_id,
            CASE
              WHEN u.display_name IS NULL OR u.display_name = '' THEN split_part(u.email, '@', 1)
              ELSE u.display_name
            END AS display_name,
            u.email,
            u.tenant_role,
            (
              SELECT MAX(gi.last_activity_at)
              FROM gateway_instances gi
              WHERE gi.tenant_id = u.tenant_id
                AND gi.owner_user_id = u.user_id
            ) AS last_active_at
     FROM users u
     WHERE u.tenant_id = ?
     ORDER BY u.email ASC`,
    [tenant_id],
  );
  const grants = await grantsByUser(
    db,
    tenant_id,
    rows.map((row) => row.user_id),
  );
  return rows.map((row) => toOpsUser(row, grants.get(row.user_id) ?? []));
}

export async function getOpsTenantUser(
  db: SqlClient,
  tenant_id: string,
  user_id: string,
): Promise<OpsTenantUser> {
  const row = await getUserRow(db, tenant_id, user_id);
  const grants = await grantsByUser(db, tenant_id, [user_id]);
  return toOpsUser(row, grants.get(user_id) ?? []);
}

export async function provisionOpsTenantUser(
  db: SqlClient,
  recordAudit: AuditRecorder,
  input: {
    tenant_id: string;
    display_name: string;
    email: string;
    role: OpsTenantUserRole;
    actor?: string | null;
  },
): Promise<OpsTenantUser> {
  const email = input.email.trim().toLowerCase();
  const display_name = input.display_name.trim();
  const user_id = randomUUID();
  const created_at = new Date().toISOString();

  try {
    await db.run(
      `INSERT INTO users
         (user_id, tenant_id, email, password_hash, password_salt, google_sub,
          display_name, tenant_role, created_at)
       VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, ?)`,
      [
        user_id,
        input.tenant_id,
        email,
        display_name,
        input.role,
        created_at,
      ],
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new UserEmailConflictError(email, input.tenant_id);
    }
    throw error;
  }

  await recordAudit({
    tenant_id: input.tenant_id,
    action: "user.provisioned",
    actor: input.actor ?? null,
    metadata: { user_id, email, role: input.role },
  });

  return getOpsTenantUser(db, input.tenant_id, user_id);
}

export async function updateOpsTenantUser(
  db: SqlClient,
  recordAudit: AuditRecorder,
  input: {
    tenant_id: string;
    user_id: string;
    display_name?: string;
    role?: OpsTenantUserRole;
    actor?: string | null;
  },
): Promise<OpsTenantUser> {
  const existing = await getUserRow(db, input.tenant_id, input.user_id);
  const currentRole = mapRole(existing.tenant_role);
  const nextRole = input.role ?? currentRole;
  const nextName = input.display_name?.trim() ?? existing.display_name;

  if (currentRole === "tenant_admin" && nextRole === "member") {
    const admins = await countTenantAdmins(db, input.tenant_id);
    if (admins <= 1) {
      throw new LastTenantAdminError();
    }
  }

  await db.run(
    `UPDATE users
     SET display_name = ?, tenant_role = ?
     WHERE tenant_id = ? AND user_id = ?`,
    [nextName, nextRole, input.tenant_id, input.user_id],
  );

  await recordAudit({
    tenant_id: input.tenant_id,
    action: "user.role_updated",
    actor: input.actor ?? null,
    metadata: {
      user_id: input.user_id,
      role: nextRole,
      display_name: nextName,
    },
  });

  return getOpsTenantUser(db, input.tenant_id, input.user_id);
}

export async function deleteOpsTenantUser(
  db: SqlClient,
  recordAudit: AuditRecorder,
  input: {
    tenant_id: string;
    user_id: string;
    actor?: string | null;
  },
): Promise<void> {
  const existing = await getUserRow(db, input.tenant_id, input.user_id);
  if (mapRole(existing.tenant_role) === "tenant_admin") {
    const admins = await countTenantAdmins(db, input.tenant_id);
    if (admins <= 1) {
      throw new LastTenantAdminError();
    }
  }

  const result = await db.run(
    `DELETE FROM users WHERE tenant_id = ? AND user_id = ?`,
    [input.tenant_id, input.user_id],
  );
  if (result.changes === 0) {
    throw new UserNotFoundError(input.user_id);
  }

  await recordAudit({
    tenant_id: input.tenant_id,
    action: "user.removed",
    actor: input.actor ?? null,
    metadata: { user_id: input.user_id, email: existing.email },
  });
}

export async function listOpsConnectorUsers(
  db: SqlClient,
  tenant_id: string,
  connector_id: ConnectorId,
): Promise<OpsConnectorUser[]> {
  const users = await listOpsTenantUsers(db, tenant_id);
  return users.map((user) => ({
    user_id: user.user_id,
    display_name: user.display_name,
    email: user.email,
    role_label: opsRoleLabel(user.role),
    granted: user.connectors.includes(connector_id),
  }));
}

export async function setPersonConnectorGrant(
  db: SqlClient,
  recordAudit: AuditRecorder,
  input: {
    tenant_id: string;
    user_id: string;
    connector_id: string;
    granted: boolean;
    actor?: string | null;
  },
): Promise<{
  tenant_id: string;
  user_id: string;
  connector_id: ConnectorId;
  granted: boolean;
}> {
  await getUserRow(db, input.tenant_id, input.user_id);
  const connector_id = await parseConnectorId(db, input.connector_id);
  const now = new Date().toISOString();

  if (input.granted) {
    await db.run(
      `INSERT INTO person_connector_grants
         (tenant_id, user_id, connector_id, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (tenant_id, user_id, connector_id) DO NOTHING`,
      [input.tenant_id, input.user_id, connector_id, now],
    );
  } else {
    await db.run(
      `DELETE FROM person_connector_grants
       WHERE tenant_id = ? AND user_id = ? AND connector_id = ?`,
      [input.tenant_id, input.user_id, connector_id],
    );
  }

  await recordAudit({
    tenant_id: input.tenant_id,
    action: "connector.person_grant_set",
    actor: input.actor ?? null,
    metadata: {
      user_id: input.user_id,
      connector_id,
      granted: input.granted,
    },
  });

  return {
    tenant_id: input.tenant_id,
    user_id: input.user_id,
    connector_id,
    granted: input.granted,
  };
}
