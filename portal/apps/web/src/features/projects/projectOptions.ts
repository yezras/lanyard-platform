import type { Project } from "../../api/types.js";

/**
 * Agent working directory / vault root for new project create defaults.
 *
 * Product rule (lp-75r.5): projects are subdirectories of the agent WD /
 * vault root (e.g. `/Acme`, `/clients/Acme`, `/Business/relationships`).
 * Do **not** invent a generic `/Projects/…` namespace as the default create
 * location — operators may still type `/Projects/…` explicitly if their
 * vault layout uses that folder.
 *
 * Paths are vault-root-relative (leading `/`), never home-relative (`~/…`).
 * Host materializes the real dir under VAULT_ROOT.
 */
export const DEFAULT_PROJECTS_ROOT = "/";

/**
 * Empty-state copy for agent Directory when no host projects exist.
 * Create is host-backed via Portal API — not a cloud-BFF CLI.
 */
export const HERMES_PROJECT_CREATE_HINT =
  "Use New project, or ask an operator to create a host working directory";

function slugifyProjectName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project";
}

/** Readable folder segment from a project name (or slug for special chars). */
function folderSegmentFromName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "Project";
  }
  return /^[A-Za-z0-9._ -]+$/.test(trimmed)
    ? trimmed
    : slugifyProjectName(trimmed);
}

/**
 * Normalize a parent project vault_path / primary_path for nesting.
 * Empty, `/`, or null → no parent (create at vault root).
 * Strips trailing slashes; ensures a leading `/` for relative segments.
 */
export function normalizeVaultParentPath(
  parentPath?: string | null,
): string | null {
  if (parentPath == null) {
    return null;
  }
  let p = parentPath.trim();
  if (!p || p === "/") {
    return null;
  }
  // Drop trailing slashes (keep root as handled above).
  p = p.replace(/\/+$/, "");
  if (!p || p === "/") {
    return null;
  }
  if (!p.startsWith("/") && !p.startsWith("~")) {
    p = `/${p}`;
  }
  return p;
}

/**
 * Default working-directory path for new project create.
 *
 * - At vault root: `/<Name>` (e.g. `/Acme`, `/clients` when user types nested).
 * - Under selected parent: `{parent.vault_path}/{Name}`
 *   (e.g. `/Business/relationships`).
 * - Always vault-root-relative leading `/` (or an existing absolute parent
 *   path from the host), never `~/…` and never forced under `/Projects`.
 */
export function defaultFolderPath(
  name: string,
  options?: { parentPath?: string | null },
): string {
  const folder = folderSegmentFromName(name);
  const parent = normalizeVaultParentPath(options?.parentPath);
  if (parent) {
    return `${parent}/${folder}`;
  }
  return `/${folder}`;
}

export function projectSelectOptions(projects: Project[]) {
  return [
    { value: "", label: "No project" },
    ...projects.map((project) => {
      const pathSuffix = project.vault_path ? ` (${project.vault_path})` : "";
      return {
        value: project.project_id,
        label: `${project.parent_project_id ? "↳ " : ""}${project.name}${pathSuffix}`,
      };
    }),
  ];
}
