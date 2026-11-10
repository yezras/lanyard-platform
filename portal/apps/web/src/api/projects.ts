/**
 * Chat Directory projects — Hermes agent working directories are the source of truth.
 * Re-exports the Hermes-backed client used by chat UI hooks.
 *
 * Control-plane `/api/projects` (vault_path ACL records) remains available for
 * other surfaces; chat does not depend on it as SoT.
 */
export {
  createHermesProject,
  createProject,
  deleteHermesProject,
  deleteProject,
  fetchHermesProjects,
  fetchProjects,
  hermesProjectToProject,
  type CreateHermesProjectInput,
} from "./hermesProjects.js";

/** @deprecated Prefer CreateHermesProjectInput; vault_path maps to Hermes folders. */
export type CreateProjectInput = {
  name: string;
  vault_path: string;
  parent_project_id?: string | null;
};