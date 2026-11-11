import { mergePathPrefixes, normalizeVaultPath } from "@lanyard/shared";
import { randomUUID } from "node:crypto";

import { isUniqueViolation, type SqlClient } from "./db.js";
import type { Role, UserRbac } from "./types.js";

export class RoleNotFoundError extends Error {
  readonly code = "ROLE_NOT_FOUND";

  constructor(role_id: string) {
    super(`Role not found: ${role_id}`);
    this.name = "RoleNotFoundError";
  }
}

export class RoleNameConflictError extends Error {
  readonly code = "ROLE_NAME_CONFLICT";

  constructor(name: string, tenant_id: string) {
    super(`Role name already exists for tenant ${tenant_id}: ${name}`);
    this.name = "RoleNameConflictError";
  }
}

export class UserNotFoundError extends Error {
  readonly code = "USER_NOT_FOUND";

  constructor(user_id: string) {
    super(`User not found: ${user_id}`);
    this.name = "UserNotFoundError";
  }
}

export class UserEmailConflictError extends Error {
  readonly code = "USER_EMAIL_CONFLICT";

  constructor(email: string, tenant_id: string) {
    super(`Email already registered for tenant ${tenant_id}: ${email}`);
    this.name = "UserEmailConflictError";
  }
}

function mapRoleRow(
  row: {
    role_id: string;
    tenant_id: string;
    name: string;
    hermes_profile: string;
    created_at: string;
  },
  prefixes: string[],
): Role {
  return {
    role_id: row.role_id,
    tenant_id: row.tenant_id,
    name: row.name,
    hermes_profile: row.hermes_profile,
    path_prefixes: prefixes,
    created_at: row.created_at,
  };
}

export async function createRole(
  db: SqlClient,
  recordAudit: (input: {
    tenant_id: string | null;
    action: "role.created";
    actor: string | null;
    metadata: Record<string, unknown>;
  }) => Promise<void> | void,
  input: {
    tenant_id: string;
    name: string;
    hermes_profile: string;
    path_prefixes: string[];
    actor?: string;
  },
): Promise<Role> {
  const role_id = randomUUID();
  const created_at = new Date().toISOString();
  const name = input.name.trim();
  const hermes_profile = input.hermes_profile.trim();
  const path_prefixes = input.path_prefixes.map((prefix) =>
    normalizeVaultPath(prefix),
  );

  try {
    await db.run(
      `INSERT INTO roles (role_id, tenant_id, name, hermes_profile, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [role_id, input.tenant_id, name, hermes_profile, created_at],
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new RoleNameConflictError(name, input.tenant_id);
    }
    throw error;
  }

  for (const prefix of path_prefixes) {
    await db.run(
      `INSERT INTO role_path_prefixes (role_id, path_prefix) VALUES (?, ?)`,
      [role_id, prefix],
    );
  }

  await recordAudit({
    tenant_id: input.tenant_id,
    action: "role.created",
    actor: input.actor ?? null,
    metadata: {
      role_id,
      name,
      hermes_profile,
      path_prefixes,
    },
  });

  return mapRoleRow(
    {
      role_id,
      tenant_id: input.tenant_id,
      name,
      hermes_profile,
      created_at,
    },
    path_prefixes,
  );
}

export async function setUserRoles(
  db: SqlClient,
  recordAudit: (input: {
    tenant_id: string | null;
    action: "user.roles_updated";
    actor: string | null;
    metadata: Record<string, unknown>;
  }) => Promise<void> | void,
  input: {
    tenant_id: string;
    user_id: string;
    role_ids: string[];
    actor?: string;
  },
): Promise<UserRbac> {
  const userRow = await db.get<{ user_id: string; tenant_id: string }>(
    `SELECT user_id, tenant_id FROM users WHERE user_id = ? AND tenant_id = ?`,
    [input.user_id, input.tenant_id],
  );

  if (!userRow) {
    throw new UserNotFoundError(input.user_id);
  }

  for (const role_id of input.role_ids) {
    const role = await db.get<{ role_id: string }>(
      `SELECT role_id FROM roles WHERE role_id = ? AND tenant_id = ?`,
      [role_id, input.tenant_id],
    );
    if (!role) {
      throw new RoleNotFoundError(role_id);
    }
  }

  await db.run(`DELETE FROM user_roles WHERE user_id = ?`, [input.user_id]);

  for (const role_id of input.role_ids) {
    await db.run(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`, [
      input.user_id,
      role_id,
    ]);
  }

  await recordAudit({
    tenant_id: input.tenant_id,
    action: "user.roles_updated",
    actor: input.actor ?? null,
    metadata: {
      user_id: input.user_id,
      role_ids: input.role_ids,
    },
  });

  const rbac = await getUserRbac(db, input.tenant_id, input.user_id);
  if (!rbac) {
    throw new Error("RBAC resolution failed after role assignment");
  }
  return rbac;
}

export async function getUserRbac(
  db: SqlClient,
  tenant_id: string,
  user_id: string,
): Promise<UserRbac | null> {
  const userRow = await db.get<{ user_id: string; tenant_id: string }>(
    `SELECT user_id, tenant_id FROM users WHERE user_id = ?`,
    [user_id],
  );

  if (!userRow || userRow.tenant_id !== tenant_id) {
    return null;
  }

  const roleRows = await db.all<{
    role_id: string;
    tenant_id: string;
    name: string;
    hermes_profile: string;
    created_at: string;
  }>(
    `SELECT r.role_id, r.tenant_id, r.name, r.hermes_profile, r.created_at
     FROM roles r
     INNER JOIN user_roles ur ON ur.role_id = r.role_id
     WHERE ur.user_id = ? AND r.tenant_id = ?
     ORDER BY r.name ASC`,
    [user_id, tenant_id],
  );

  if (roleRows.length === 0) {
    return null;
  }

  const rolePrefixGroups: string[][] = [];
  for (const role of roleRows) {
    const prefixes = await db.all<{ path_prefix: string }>(
      `SELECT path_prefix FROM role_path_prefixes WHERE role_id = ? ORDER BY path_prefix ASC`,
      [role.role_id],
    );
    rolePrefixGroups.push(prefixes.map((row) => row.path_prefix));
  }

  const allowed_path_prefixes = mergePathPrefixes(rolePrefixGroups);

  return {
    user_id,
    tenant_id,
    hermes_profile: roleRows[0]!.hermes_profile,
    allowed_path_prefixes,
    role_names: roleRows.map((row) => row.name),
  };
}

export async function listRoles(
  db: SqlClient,
  tenant_id: string,
): Promise<Role[]> {
  const roleRows = await db.all<{
    role_id: string;
    tenant_id: string;
    name: string;
    hermes_profile: string;
    created_at: string;
  }>(
    `SELECT role_id, tenant_id, name, hermes_profile, created_at
     FROM roles WHERE tenant_id = ?
     ORDER BY name ASC`,
    [tenant_id],
  );

  const roles: Role[] = [];
  for (const row of roleRows) {
    const prefixes = await db.all<{ path_prefix: string }>(
      `SELECT path_prefix FROM role_path_prefixes WHERE role_id = ? ORDER BY path_prefix ASC`,
      [row.role_id],
    );
    roles.push(mapRoleRow(row, prefixes.map((p) => p.path_prefix)));
  }
  return roles;
}
