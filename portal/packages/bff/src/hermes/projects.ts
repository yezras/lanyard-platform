/**
 * Hermes projects helpers for vault multi-root wiring.
 * Canonical store/create API lives in `../hermes-projects.ts`.
 */

import path from "node:path";

import type { HermesProject } from "../hermes-projects.js";
import {
  listHermesProjectsFromDb,
  resolveHermesProjectsDbPath,
} from "../hermes-projects.js";
import { resolveHermesHome } from "../settings-discover.js";

export type { HermesProject, HermesProjectFolder } from "../hermes-projects.js";

export type ListHermesProjectsOptions = {
  /** Override backend home (default: BACKEND_HOME / HERMES_HOME / ~/.hermes). */
  hermesHome?: string;
  /** Explicit projects.db path (tests). */
  dbPath?: string;
};

export function projectsDbPath(hermesHome: string): string {
  return resolveHermesProjectsDbPath(hermesHome);
}

export async function projectsDbPresent(dbPath: string): Promise<boolean> {
  const { access, constants: fsConstants } = await import("node:fs/promises");
  try {
    await access(dbPath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * List Hermes projects for the active profile.
 * Returns [] when the DB is missing or unreadable.
 */
export function listHermesProjects(
  options: ListHermesProjectsOptions = {},
): HermesProject[] {
  const hermesHome = options.hermesHome
    ? path.resolve(options.hermesHome)
    : resolveHermesHome();
  const dbPath = options.dbPath
    ? path.resolve(options.dbPath)
    : projectsDbPath(hermesHome);
  return listHermesProjectsFromDb(dbPath);
}

/**
 * Flatten project folders into ordered vault roots.
 * Primary folders first; then non-primary. Dedupes by absolute path.
 */
export function hermesProjectVaultRoots(
  projects: readonly HermesProject[],
): Array<{
  absolutePath: string;
  name: string;
  description: string;
  projectId: string;
  projectName: string;
  isPrimary: boolean;
}> {
  const seen = new Set<string>();
  const roots: Array<{
    absolutePath: string;
    name: string;
    description: string;
    projectId: string;
    projectName: string;
    isPrimary: boolean;
  }> = [];

  for (const project of projects) {
    const folders = [...project.folders].sort((a, b) => {
      if (a.is_primary !== b.is_primary) {
        return a.is_primary ? -1 : 1;
      }
      return a.path.localeCompare(b.path);
    });

    for (const folder of folders) {
      const absolutePath = path.resolve(folder.path);
      if (seen.has(absolutePath)) {
        continue;
      }
      seen.add(absolutePath);

      const basename = path.basename(absolutePath) || absolutePath;
      const name = (folder.label?.trim() || basename).trim() || project.name;

      roots.push({
        absolutePath,
        name,
        description: absolutePath,
        projectId: project.id,
        projectName: project.name,
        isPrimary: folder.is_primary,
      });
    }
  }

  return roots;
}
