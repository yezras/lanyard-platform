import { apiFetch } from "./client.js";
import { withApiBase } from "./tenantBase.js";
import type { HermesProject, Project } from "./types.js";

export type CreateHermesProjectInput = {
  name: string;
  folders?: string[];
};

/** Map Hermes project → UI Project (primary_path as vault_path / agent cwd). */
export function hermesProjectToProject(project: HermesProject): Project {
  return {
    project_id: project.id,
    name: project.name,
    vault_path: project.primary_path ?? "",
    parent_project_id: null,
  };
}

/**
 * List agent working directories (source of truth for chat Directory).
 * Preferred: GET /api/agent/projects (legacy /api/hermes/projects dual-mount remains on BFF).
 * Does not use control-plane vault_path projects.
 *
 * Throws when the list is unavailable (non-OK / network) so callers can show
 * honest empty Directory rather than a silent empty success (lp-rt5.5).
 */
export async function fetchHermesProjects(): Promise<HermesProject[]> {
  const res = await fetch(withApiBase("/api/agent/projects"), {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Failed to list agent projects (${res.status})`);
  }
  const body = (await res.json()) as { projects?: HermesProject[] };
  return body.projects ?? [];
}

/** Fetch agent projects mapped into the chat Project shape. */
export async function fetchProjects(): Promise<Project[]> {
  const projects = await fetchHermesProjects();
  return projects.map(hermesProjectToProject);
}

/**
 * Create an agent working directory via POST /api/agent/projects.
 * Production: BFF → Brain RPC projects.create on the customer host.
 * Offline/dev (BRAIN_RPC off): BFF may shell local Hermes when HERMES_BIN/PATH
 * is set — never assume the BFF can reach customer-host folder paths.
 */
export async function createHermesProject(
  input: CreateHermesProjectInput,
): Promise<HermesProject> {
  const res = await apiFetch("/api/agent/projects", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      folders: input.folders?.length ? input.folders : undefined,
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(
      body.error ??
        body.message ??
        `Failed to create agent project (${res.status})`,
    );
  }
  return (await res.json()) as HermesProject;
}

export async function createProject(input: {
  name: string;
  vault_path: string;
  parent_project_id?: string | null;
}): Promise<Project> {
  const hermes = await createHermesProject({
    name: input.name,
    folders: input.vault_path ? [input.vault_path] : undefined,
  });
  return hermesProjectToProject(hermes);
}

/** Soft-delete (archive) via DELETE /api/agent/projects/:id. */
export async function deleteHermesProject(
  projectId: string,
): Promise<{ id: string; archived: true }> {
  const id = projectId.trim();
  if (!id) {
    throw new Error("project id required");
  }
  const res = await apiFetch(
    `/api/agent/projects/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(
      body.error ??
        body.message ??
        `Failed to delete agent project (${res.status})`,
    );
  }
  return (await res.json()) as { id: string; archived: true };
}

export async function deleteProject(projectId: string): Promise<void> {
  await deleteHermesProject(projectId);
}
