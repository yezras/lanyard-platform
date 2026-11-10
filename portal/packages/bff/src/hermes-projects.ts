/**
 * Hermes projects.db reader — local/dev fallback for agent working directories.
 *
 * Production (BRAIN_RPC_ENABLED): list/create go through BackendRuntimeService
 * → Brain RPC (`projects.list` / `projects.create`). This module is for offline
 * fixtures and intentional local shell create only.
 *
 * DB: $BACKEND_HOME/projects.db (HERMES_HOME legacy; default ~/.hermes/projects.db)
 * Tables: projects, project_folders
 *
 * Local create (when Brain RPC is off):
 *   Resolve binary via HERMES_BIN, then well-known install paths, then PATH
 *   (`hermes`). Do not tell operators to run `hermes project create` against
 *   customer-host paths the BFF cannot reach.
 *
 * Shared API contract (preferred + legacy dual-mount):
 *   GET  /api/agent/projects  → { projects: HermesProject[] }  [preferred]
 *   GET  /api/hermes/projects → same + deprecation headers     [legacy]
 *   POST /api/agent/projects  body: { name: string; folders?: string[] }
 *   POST /api/hermes/projects same body + deprecation headers
 */
import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { resolveHermesHome } from "./settings-discover.js";

export type HermesProjectFolder = {
  path: string;
  label?: string | null;
  is_primary: boolean;
};

export type HermesProject = {
  id: string;
  slug: string;
  name: string;
  primary_path: string | null;
  folders: HermesProjectFolder[];
};

export type CreateHermesProjectInput = {
  name: string;
  folders?: string[];
};

/** Injectable store for list/get (tests can supply a fixture). */
export type HermesProjectsStore = {
  listProjects(): HermesProject[];
  getProject(id: string): HermesProject | null;
};

export type HermesProjectsService = HermesProjectsStore & {
  createProject(input: CreateHermesProjectInput): Promise<HermesProject>;
};

type ProjectRow = {
  id: string;
  slug: string;
  name: string;
  primary_path: string | null;
  archived: number;
};

type FolderRow = {
  project_id: string;
  path: string;
  label: string | null;
  is_primary: number;
};

export function resolveHermesProjectsDbPath(
  hermesHome?: string,
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  const home = hermesHome
    ? path.resolve(hermesHome)
    : resolveHermesHome(env, homedir);
  return path.join(home, "projects.db");
}

/** Expand ~ and resolve to an absolute path. */
export function resolveFolderPath(
  input: string,
  homedir: () => string = os.homedir,
): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (trimmed === "~") {
    return homedir();
  }
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.resolve(homedir(), trimmed.slice(2));
  }
  return path.resolve(trimmed);
}

function openReadonlyDb(dbPath: string): DatabaseSync {
  return new DatabaseSync(dbPath, { readOnly: true });
}

function mapProject(
  row: ProjectRow,
  folders: HermesProjectFolder[],
): HermesProject {
  const primary =
    folders.find((f) => f.is_primary)?.path ??
    row.primary_path ??
    folders[0]?.path ??
    null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    primary_path: primary ? path.resolve(primary) : null,
    folders: folders.map((f) => ({
      path: path.resolve(f.path),
      label: f.label ?? null,
      is_primary: f.is_primary,
    })),
  };
}

/**
 * Read non-archived projects from a Hermes projects.db file.
 * Returns [] when the file is missing (empty state).
 */
export function listHermesProjectsFromDb(dbPath: string): HermesProject[] {
  if (!existsSync(dbPath)) {
    return [];
  }

  const db = openReadonlyDb(dbPath);
  try {
    const projectRows = db
      .prepare(
        `SELECT id, slug, name, primary_path, archived
         FROM projects
         WHERE archived = 0
         ORDER BY name COLLATE NOCASE ASC`,
      )
      .all() as ProjectRow[];

    if (projectRows.length === 0) {
      return [];
    }

    const folderRows = db
      .prepare(
        `SELECT project_id, path, label, is_primary
         FROM project_folders
         ORDER BY is_primary DESC, path ASC`,
      )
      .all() as FolderRow[];

    const foldersByProject = new Map<string, HermesProjectFolder[]>();
    for (const folder of folderRows) {
      const list = foldersByProject.get(folder.project_id) ?? [];
      list.push({
        path: folder.path,
        label: folder.label,
        is_primary: Boolean(folder.is_primary),
      });
      foldersByProject.set(folder.project_id, list);
    }

    return projectRows.map((row) =>
      mapProject(row, foldersByProject.get(row.id) ?? []),
    );
  } finally {
    db.close();
  }
}

export function getHermesProjectFromDb(
  dbPath: string,
  projectId: string,
): HermesProject | null {
  return (
    listHermesProjectsFromDb(dbPath).find((p) => p.id === projectId) ?? null
  );
}

export function createSqliteHermesProjectsStore(
  dbPath: string,
): HermesProjectsStore {
  return {
    listProjects: () => listHermesProjectsFromDb(dbPath),
    getProject: (id) => getHermesProjectFromDb(dbPath, id),
  };
}

/** In-memory store for unit/integration tests. */
export function createMemoryHermesProjectsStore(
  initial: HermesProject[] = [],
): HermesProjectsStore & {
  projects: HermesProject[];
  upsert(project: HermesProject): void;
} {
  const projects = [...initial];
  return {
    projects,
    listProjects: () => [...projects],
    getProject: (id) => projects.find((p) => p.id === id) ?? null,
    upsert(project) {
      const idx = projects.findIndex((p) => p.id === project.id);
      if (idx >= 0) {
        projects[idx] = project;
      } else {
        projects.push(project);
      }
    },
  };
}

export type CreateHermesProjectViaCliOptions = {
  /**
   * Hermes binary name or absolute path.
   * Prefer {@link resolveHermesBin} / `HERMES_BIN` for local/dev installs.
   * Default: resolve from env + well-known paths, else `"hermes"`.
   */
  hermesBin?: string;
  /** Working directory for the CLI (default: process.cwd()). */
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Timeout in ms (default: 30_000). */
  timeoutMs?: number;
  /** After CLI success, re-read from this db path (required to return full record). */
  dbPath: string;
  homedir?: () => string;
};

/** Well-known absolute install locations checked when HERMES_BIN / PATH miss. */
export const HERMES_BIN_WELL_KNOWN_PATHS = [
  "/opt/hermes-lanyard/bin/hermes",
  "/opt/company-brain/hermes-lanyard/bin/hermes",
] as const;

/**
 * Resolve the Hermes CLI binary for intentional local/dev shell create.
 *
 * Order:
 * 1. Explicit `override` (caller-supplied)
 * 2. `HERMES_BIN` env (absolute path or name on PATH)
 * 3. First executable among {@link HERMES_BIN_WELL_KNOWN_PATHS}
 * 4. Bare `"hermes"` (PATH lookup at spawn time)
 *
 * Production cloud BFF should not rely on this path — use BRAIN_RPC_ENABLED
 * host-backed create instead.
 */
export function resolveHermesBin(
  env: NodeJS.ProcessEnv = process.env,
  override?: string,
): string {
  const explicit = override?.trim();
  if (explicit) {
    return explicit;
  }
  const fromEnv = env.HERMES_BIN?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  for (const candidate of HERMES_BIN_WELL_KNOWN_PATHS) {
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // continue
    }
  }
  return "hermes";
}

/** Honest message when local shell create cannot find the Hermes binary. */
export function hermesCliNotFoundMessage(hermesBin: string): string {
  return (
    `hermes CLI not found (${hermesBin}). ` +
    "Creating a project on the agent is unavailable. " +
    "For local/dev shell create set HERMES_BIN to the hermes binary " +
    "(e.g. /opt/hermes-lanyard/bin/hermes) or put hermes on PATH. " +
    "Do not run hermes project create on the BFF for paths that only exist on the customer host."
  );
}

function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Timed out running ${command}`));
    }, options.timeoutMs ?? 30_000);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * Parse `Created project <slug> (<id>)` from hermes CLI stdout/stderr.
 */
export function parseHermesCreateOutput(
  combined: string,
): { slug: string; id: string } | null {
  const match = combined.match(
    /Created project\s+(\S+)\s+\(([^)]+)\)/i,
  );
  if (!match) {
    return null;
  }
  return { slug: match[1]!, id: match[2]! };
}

export class HermesCliNotFoundError extends Error {
  constructor(message = hermesCliNotFoundMessage("hermes")) {
    super(message);
    this.name = "HermesCliNotFoundError";
  }
}

export class HermesProjectCreateError extends Error {
  readonly stdout: string;
  readonly stderr: string;

  constructor(message: string, stdout = "", stderr = "") {
    super(message);
    this.name = "HermesProjectCreateError";
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

/**
 * Shell `hermes project create <name> [folders...]` then re-read projects.db.
 */
export async function createHermesProjectViaCli(
  input: CreateHermesProjectInput,
  options: CreateHermesProjectViaCliOptions,
): Promise<HermesProject> {
  const name = input.name.trim();
  if (!name) {
    throw new HermesProjectCreateError("Project name is required");
  }

  const homedir = options.homedir ?? os.homedir;
  const folders = (input.folders ?? []).map((f) =>
    resolveFolderPath(f, homedir),
  );
  const hermesBin = resolveHermesBin(options.env ?? process.env, options.hermesBin);

  const args = ["project", "create", name, ...folders];

  let result: { code: number | null; stdout: string; stderr: string };
  try {
    result = await runCommand(hermesBin, args, {
      cwd: options.cwd,
      env: options.env,
      timeoutMs: options.timeoutMs,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new HermesCliNotFoundError(hermesCliNotFoundMessage(hermesBin));
    }
    throw error;
  }

  const combined = `${result.stdout}\n${result.stderr}`;
  if (result.code !== 0) {
    throw new HermesProjectCreateError(
      result.stderr.trim() ||
        result.stdout.trim() ||
        `hermes project create failed (exit ${result.code})`,
      result.stdout,
      result.stderr,
    );
  }

  const parsed = parseHermesCreateOutput(combined);
  const projects = listHermesProjectsFromDb(options.dbPath);

  if (parsed) {
    const byId = projects.find((p) => p.id === parsed.id);
    if (byId) {
      return byId;
    }
    const bySlug = projects.find((p) => p.slug === parsed.slug);
    if (bySlug) {
      return bySlug;
    }
  }

  const byName = projects.find(
    (p) => p.name.toLowerCase() === name.toLowerCase(),
  );
  if (byName) {
    return byName;
  }

  throw new HermesProjectCreateError(
    "hermes project create succeeded but project was not found in projects.db",
    result.stdout,
    result.stderr,
  );
}

export type DefaultHermesProjectsServiceOptions = {
  hermesHome?: string;
  hermesBin?: string;
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
  /** Inject store (tests). When set, list/get use it; create still uses CLI unless createImpl provided. */
  store?: HermesProjectsStore;
  createImpl?: (
    input: CreateHermesProjectInput,
  ) => Promise<HermesProject>;
};

export function createDefaultHermesProjectsService(
  options: DefaultHermesProjectsServiceOptions = {},
): HermesProjectsService {
  const env = options.env ?? process.env;
  const homedir = options.homedir ?? os.homedir;
  const dbPath = resolveHermesProjectsDbPath(
    options.hermesHome,
    env,
    homedir,
  );
  const store =
    options.store ?? createSqliteHermesProjectsStore(dbPath);

  const hermesBin = resolveHermesBin(env, options.hermesBin);

  return {
    listProjects: () => store.listProjects(),
    getProject: (id) => store.getProject(id),
    createProject: async (input) => {
      if (options.createImpl) {
        return options.createImpl(input);
      }
      return createHermesProjectViaCli(input, {
        hermesBin,
        env,
        dbPath,
        homedir,
      });
    },
  };
}

/** True when hermes binary appears executable on PATH (best-effort). */
export function isHermesOnPath(
  hermesBin = "hermes",
  pathEnv = process.env.PATH ?? "",
): boolean {
  if (path.isAbsolute(hermesBin) || hermesBin.includes(path.sep)) {
    try {
      accessSync(hermesBin, fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, hermesBin);
    try {
      accessSync(candidate, fsConstants.X_OK);
      return true;
    } catch {
      // continue
    }
  }
  return false;
}

/**
 * Build a minimal projects.db fixture for tests (writable).
 * Uses node:sqlite; schema mirrors Hermes.
 */
export function writeHermesProjectsDbFixture(
  dbPath: string,
  projects: Array<{
    id: string;
    slug: string;
    name: string;
    primary_path?: string | null;
    folders?: Array<{
      path: string;
      label?: string | null;
      is_primary?: boolean;
    }>;
    archived?: boolean;
  }>,
): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id            TEXT PRIMARY KEY,
        slug          TEXT NOT NULL UNIQUE,
        name          TEXT NOT NULL,
        description   TEXT,
        icon          TEXT,
        color         TEXT,
        board_slug    TEXT,
        primary_path  TEXT,
        created_at    INTEGER NOT NULL,
        archived      INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS project_folders (
        project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        path        TEXT NOT NULL,
        label       TEXT,
        is_primary  INTEGER NOT NULL DEFAULT 0,
        added_at    INTEGER NOT NULL,
        PRIMARY KEY (project_id, path)
      );
    `);

    const now = Math.floor(Date.now() / 1000);
    const insertProject = db.prepare(
      `INSERT INTO projects (id, slug, name, primary_path, created_at, archived)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertFolder = db.prepare(
      `INSERT INTO project_folders (project_id, path, label, is_primary, added_at)
       VALUES (?, ?, ?, ?, ?)`,
    );

    for (const project of projects) {
      insertProject.run(
        project.id,
        project.slug,
        project.name,
        project.primary_path ?? null,
        now,
        project.archived ? 1 : 0,
      );
      for (const folder of project.folders ?? []) {
        insertFolder.run(
          project.id,
          folder.path,
          folder.label ?? null,
          folder.is_primary ? 1 : 0,
          now,
        );
      }
    }
  } finally {
    db.close();
  }
}
