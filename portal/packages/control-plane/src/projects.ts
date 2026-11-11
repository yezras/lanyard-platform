import {
  InvalidVaultPathError,
  isVaultPathAllowed,
  normalizeVaultPath,
} from "@lanyard/shared";
import { randomUUID } from "node:crypto";

import type { SqlClient } from "./db.js";
import { getUserRbac } from "./rbac.js";
import type { Project, UserRbac } from "./types.js";

export class ProjectNotFoundError extends Error {
  readonly code = "PROJECT_NOT_FOUND";

  constructor(project_id: string) {
    super(`Project not found: ${project_id}`);
    this.name = "ProjectNotFoundError";
  }
}

export class ProjectParentNotFoundError extends Error {
  readonly code = "PROJECT_PARENT_NOT_FOUND";

  constructor(parent_project_id: string) {
    super(`Parent project not found: ${parent_project_id}`);
    this.name = "ProjectParentNotFoundError";
  }
}

export class VaultPathAccessDeniedError extends Error {
  readonly code = "VAULT_PATH_ACCESS_DENIED";

  constructor(path: string) {
    super(`Vault path not permitted for user role: ${path}`);
    this.name = "VaultPathAccessDeniedError";
  }
}

export class SubprojectVaultPathError extends Error {
  readonly code = "SUBPROJECT_VAULT_PATH_INVALID";

  constructor(path: string, parentPath: string) {
    super(
      `Subproject vault path must be under parent path ${parentPath}: ${path}`,
    );
    this.name = "SubprojectVaultPathError";
  }
}

function mapProjectRow(row: {
  project_id: string;
  tenant_id: string;
  parent_project_id: string | null;
  name: string;
  vault_path: string;
  created_at: string;
  updated_at: string;
}): Project {
  return {
    project_id: row.project_id,
    tenant_id: row.tenant_id,
    parent_project_id: row.parent_project_id,
    name: row.name,
    vault_path: row.vault_path,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function requireUserRbac(
  db: SqlClient,
  tenant_id: string,
  user_id: string,
): Promise<UserRbac> {
  const rbac = await getUserRbac(db, tenant_id, user_id);
  if (!rbac) {
    throw new VaultPathAccessDeniedError("(no role mapping)");
  }
  return rbac;
}

function assertVaultPathForUser(rbac: UserRbac, path: string): string {
  let normalized: string;
  try {
    normalized = normalizeVaultPath(path);
  } catch (error) {
    if (error instanceof InvalidVaultPathError) {
      throw error;
    }
    throw error;
  }

  if (!isVaultPathAllowed(rbac.allowed_path_prefixes, normalized)) {
    throw new VaultPathAccessDeniedError(normalized);
  }

  return normalized;
}

function assertSubprojectPath(vault_path: string, parentPath: string): void {
  if (vault_path === parentPath) {
    return;
  }
  if (!vault_path.startsWith(`${parentPath}/`)) {
    throw new SubprojectVaultPathError(vault_path, parentPath);
  }
}

async function getProjectRow(
  db: SqlClient,
  tenant_id: string,
  project_id: string,
): Promise<Project | null> {
  const row = await db.get<{
    project_id: string;
    tenant_id: string;
    parent_project_id: string | null;
    name: string;
    vault_path: string;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT project_id, tenant_id, parent_project_id, name, vault_path, created_at, updated_at
     FROM projects WHERE project_id = ? AND tenant_id = ?`,
    [project_id, tenant_id],
  );

  return row ? mapProjectRow(row) : null;
}

function isProjectVisibleToUser(project: Project, rbac: UserRbac): boolean {
  return isVaultPathAllowed(rbac.allowed_path_prefixes, project.vault_path);
}

export async function createProject(
  db: SqlClient,
  recordAudit: (input: {
    tenant_id: string | null;
    action: "project.created";
    actor: string | null;
    metadata: Record<string, unknown>;
  }) => Promise<void> | void,
  input: {
    tenant_id: string;
    user_id: string;
    name: string;
    vault_path: string;
    parent_project_id?: string | null;
    actor?: string;
  },
): Promise<Project> {
  const rbac = await requireUserRbac(db, input.tenant_id, input.user_id);
  const vault_path = assertVaultPathForUser(rbac, input.vault_path);
  const name = input.name.trim();

  let parent_project_id: string | null = null;
  if (input.parent_project_id) {
    const parent = await getProjectRow(
      db,
      input.tenant_id,
      input.parent_project_id,
    );
    if (!parent) {
      throw new ProjectParentNotFoundError(input.parent_project_id);
    }
    if (!isProjectVisibleToUser(parent, rbac)) {
      throw new VaultPathAccessDeniedError(parent.vault_path);
    }
    assertSubprojectPath(vault_path, parent.vault_path);
    parent_project_id = parent.project_id;
  }

  const project_id = randomUUID();
  const now = new Date().toISOString();

  await db.run(
    `INSERT INTO projects
     (project_id, tenant_id, parent_project_id, name, vault_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      project_id,
      input.tenant_id,
      parent_project_id,
      name,
      vault_path,
      now,
      now,
    ],
  );

  await recordAudit({
    tenant_id: input.tenant_id,
    action: "project.created",
    actor: input.actor ?? null,
    metadata: {
      project_id,
      user_id: input.user_id,
      name,
      vault_path,
      parent_project_id,
    },
  });

  return mapProjectRow({
    project_id,
    tenant_id: input.tenant_id,
    parent_project_id,
    name,
    vault_path,
    created_at: now,
    updated_at: now,
  });
}

export async function listProjects(
  db: SqlClient,
  tenant_id: string,
  user_id: string,
): Promise<Project[]> {
  const rbac = await requireUserRbac(db, tenant_id, user_id);
  const rows = await db.all<{
    project_id: string;
    tenant_id: string;
    parent_project_id: string | null;
    name: string;
    vault_path: string;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT project_id, tenant_id, parent_project_id, name, vault_path, created_at, updated_at
     FROM projects WHERE tenant_id = ?
     ORDER BY name ASC`,
    [tenant_id],
  );

  return rows
    .map(mapProjectRow)
    .filter((project) => isProjectVisibleToUser(project, rbac));
}

export async function getProject(
  db: SqlClient,
  tenant_id: string,
  user_id: string,
  project_id: string,
): Promise<Project | null> {
  const rbac = await requireUserRbac(db, tenant_id, user_id);
  const project = await getProjectRow(db, tenant_id, project_id);
  if (!project || !isProjectVisibleToUser(project, rbac)) {
    return null;
  }
  return project;
}

export async function updateProject(
  db: SqlClient,
  recordAudit: (input: {
    tenant_id: string | null;
    action: "project.updated";
    actor: string | null;
    metadata: Record<string, unknown>;
  }) => Promise<void> | void,
  input: {
    tenant_id: string;
    user_id: string;
    project_id: string;
    name?: string;
    vault_path?: string;
    actor?: string;
  },
): Promise<Project> {
  const rbac = await requireUserRbac(db, input.tenant_id, input.user_id);
  const existing = await getProjectRow(db, input.tenant_id, input.project_id);
  if (!existing || !isProjectVisibleToUser(existing, rbac)) {
    throw new ProjectNotFoundError(input.project_id);
  }

  const name = input.name?.trim() ?? existing.name;
  const vault_path =
    input.vault_path !== undefined
      ? assertVaultPathForUser(rbac, input.vault_path)
      : existing.vault_path;

  if (existing.parent_project_id) {
    const parent = await getProjectRow(
      db,
      input.tenant_id,
      existing.parent_project_id,
    );
    if (parent) {
      assertSubprojectPath(vault_path, parent.vault_path);
    }
  }

  const updated_at = new Date().toISOString();

  await db.run(
    `UPDATE projects SET name = ?, vault_path = ?, updated_at = ? WHERE project_id = ?`,
    [name, vault_path, updated_at, input.project_id],
  );

  await recordAudit({
    tenant_id: input.tenant_id,
    action: "project.updated",
    actor: input.actor ?? null,
    metadata: {
      project_id: input.project_id,
      user_id: input.user_id,
      name,
      vault_path,
    },
  });

  return mapProjectRow({
    ...existing,
    name,
    vault_path,
    updated_at,
  });
}

export async function deleteProject(
  db: SqlClient,
  recordAudit: (input: {
    tenant_id: string | null;
    action: "project.deleted";
    actor: string | null;
    metadata: Record<string, unknown>;
  }) => Promise<void> | void,
  input: {
    tenant_id: string;
    user_id: string;
    project_id: string;
    actor?: string;
  },
): Promise<void> {
  const rbac = await requireUserRbac(db, input.tenant_id, input.user_id);
  const existing = await getProjectRow(db, input.tenant_id, input.project_id);
  if (!existing || !isProjectVisibleToUser(existing, rbac)) {
    throw new ProjectNotFoundError(input.project_id);
  }

  await db.run(`DELETE FROM projects WHERE project_id = ?`, [input.project_id]);

  await recordAudit({
    tenant_id: input.tenant_id,
    action: "project.deleted",
    actor: input.actor ?? null,
    metadata: {
      project_id: input.project_id,
      user_id: input.user_id,
      name: existing.name,
      vault_path: existing.vault_path,
    },
  });
}
