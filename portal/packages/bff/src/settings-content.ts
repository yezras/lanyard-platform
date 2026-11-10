/**
 * On-demand settings host file / cron job detail (lp-a8u.8).
 *
 * Snapshot lists stay light; skill SKILL.md and workflow defs are read here
 * under BACKEND_HOME / HERMES_HOME with path containment. Vault content APIs
 * cover project vault paths only — settings inventory lives on the host home.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  isLexicallyUnderRoot,
  resolveContainedRealpath,
} from "./vault/path-security.js";
import { hermesHomePresent, resolveHermesHome } from "./settings-discover.js";
import { isSecretField } from "./settings-snapshot.js";

/** Soft cap for settings detail bodies (skills / workflow IR). */
export const SETTINGS_CONTENT_MAX_BYTES = 512 * 1024; // 512 KiB

/** Soft cap for one-level skill-pack directory listings (lp-75r.4). */
export const SETTINGS_LIST_MAX_ENTRIES = 200;

export type SettingsHostContent = {
  path: string;
  content: string;
  mime_type: string;
  encoding: "utf-8";
  byte_length: number;
};

export type SettingsHostListEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
};

export type SettingsHostList = {
  path: string;
  entries: SettingsHostListEntry[];
};

export type SettingsCronJobDetail = {
  id: string;
  name: string;
  schedule?: string;
  enabled?: boolean;
  path?: string;
  last_run_at?: string | null;
  next_run_at?: string | null;
  /** Command / shell / tool invocation when present on the job record. */
  command?: string;
  /** Prompt text when present (common for agent cron jobs). */
  prompt?: string;
  /** JSON-serializable payload fragment when present and non-secret. */
  payload?: unknown;
};

export class SettingsContentError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "SettingsContentError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Resolve a skill inventory path (directory or file) to the SKILL.md body path.
 */
export function resolveSkillContentPath(skillPath: string): string {
  const trimmed = skillPath.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!trimmed) return "SKILL.md";
  if (/skill\.md$/i.test(trimmed)) return trimmed;
  if (/\.(md|ya?ml|json|txt)$/i.test(trimmed)) return trimmed;
  return `${trimmed}/SKILL.md`;
}

/**
 * Normalize a host-relative path: no absolute, no `..`, POSIX separators.
 */
export function normalizeSettingsRelativePath(raw: string): string {
  const trimmed = raw.trim().replace(/\\/g, "/");
  if (!trimmed) {
    throw new SettingsContentError("path is required", 400, "invalid_path");
  }
  if (trimmed.startsWith("/") || /^[a-zA-Z]:/.test(trimmed)) {
    throw new SettingsContentError(
      "path must be relative to backend home",
      400,
      "invalid_path",
    );
  }
  const segments = trimmed.split("/").filter((s) => s.length > 0 && s !== ".");
  if (segments.some((s) => s === "..")) {
    throw new SettingsContentError(
      "path must not contain parent segments",
      400,
      "invalid_path",
    );
  }
  if (segments.length === 0) {
    throw new SettingsContentError("path is required", 400, "invalid_path");
  }
  return segments.join("/");
}

function mimeForRelativePath(relPath: string): string {
  const lower = relPath.toLowerCase();
  if (lower.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    return "text/yaml; charset=utf-8";
  }
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "text/plain; charset=utf-8";
}

export type ReadSettingsHostContentOptions = {
  /** Override backend/runtime home. */
  hermesHome?: string;
  /** Force "no host" (fixture-only mode). */
  preferFixture?: boolean;
  maxBytes?: number;
};

/**
 * Read a text file under backend home for settings detail bodies.
 */
export async function readSettingsHostContent(
  relativePath: string,
  options: ReadSettingsHostContentOptions = {},
): Promise<SettingsHostContent> {
  if (options.preferFixture) {
    throw new SettingsContentError(
      "No host home available for file content (fixture snapshot)",
      404,
      "no_host_home",
    );
  }

  const rel = normalizeSettingsRelativePath(relativePath);
  const hermesHome = options.hermesHome
    ? path.resolve(options.hermesHome)
    : resolveHermesHome();

  if (!(await hermesHomePresent(hermesHome))) {
    throw new SettingsContentError(
      "No host home available for file content",
      404,
      "no_host_home",
    );
  }

  const absCandidate = path.resolve(hermesHome, ...rel.split("/"));
  if (!isLexicallyUnderRoot(hermesHome, absCandidate)) {
    throw new SettingsContentError(
      "path escapes backend home",
      400,
      "invalid_path",
    );
  }

  const contained = await resolveContainedRealpath(hermesHome, absCandidate);
  if (contained === null) {
    throw new SettingsContentError(
      `File not found at ${rel}`,
      404,
      "not_found",
    );
  }

  let info;
  try {
    info = await stat(contained);
  } catch {
    throw new SettingsContentError(
      `File not found at ${rel}`,
      404,
      "not_found",
    );
  }
  if (!info.isFile()) {
    throw new SettingsContentError(
      `Not a file: ${rel}`,
      400,
      "not_a_file",
    );
  }

  const maxBytes = options.maxBytes ?? SETTINGS_CONTENT_MAX_BYTES;
  if (info.size > maxBytes) {
    throw new SettingsContentError(
      `File exceeds settings content limit (${maxBytes} bytes)`,
      413,
      "too_large",
    );
  }

  const content = await readFile(contained, "utf8");
  return {
    path: rel,
    content,
    mime_type: mimeForRelativePath(rel),
    encoding: "utf-8",
    byte_length: Buffer.byteLength(content, "utf8"),
  };
}

/**
 * List one level of a directory under backend home (skill pack siblings, etc.).
 * Used by Settings skill detail file directory (lp-75r.4).
 */
export async function listSettingsHostDirectory(
  relativePath: string,
  options: ReadSettingsHostContentOptions = {},
): Promise<SettingsHostList> {
  if (options.preferFixture) {
    throw new SettingsContentError(
      "No host home available for directory listing (fixture snapshot)",
      404,
      "no_host_home",
    );
  }

  const rel = normalizeSettingsRelativePath(relativePath);
  const hermesHome = options.hermesHome
    ? path.resolve(options.hermesHome)
    : resolveHermesHome();

  if (!(await hermesHomePresent(hermesHome))) {
    throw new SettingsContentError(
      "No host home available for directory listing",
      404,
      "no_host_home",
    );
  }

  const absCandidate = path.resolve(hermesHome, ...rel.split("/"));
  if (!isLexicallyUnderRoot(hermesHome, absCandidate)) {
    throw new SettingsContentError(
      "path escapes backend home",
      400,
      "invalid_path",
    );
  }

  const contained = await resolveContainedRealpath(hermesHome, absCandidate);
  if (contained === null) {
    throw new SettingsContentError(
      `Directory not found at ${rel}`,
      404,
      "not_found",
    );
  }

  let info;
  try {
    info = await stat(contained);
  } catch {
    throw new SettingsContentError(
      `Directory not found at ${rel}`,
      404,
      "not_found",
    );
  }
  if (!info.isDirectory()) {
    throw new SettingsContentError(
      `Not a directory: ${rel}`,
      400,
      "not_a_directory",
    );
  }

  let dirents;
  try {
    dirents = await readdir(contained, { withFileTypes: true });
  } catch {
    throw new SettingsContentError(
      `Failed to list directory: ${rel}`,
      500,
      "read_failed",
    );
  }

  const maxEntries = SETTINGS_LIST_MAX_ENTRIES;
  const entries: SettingsHostListEntry[] = [];
  // Directories first, then files; alphabetical within kind.
  const sorted = [...dirents].sort((a, b) => {
    const aDir = a.isDirectory() ? 0 : 1;
    const bDir = b.isDirectory() ? 0 : 1;
    if (aDir !== bDir) return aDir - bDir;
    return a.name.localeCompare(b.name);
  });

  for (const entry of sorted) {
    if (entries.length >= maxEntries) break;
    // Skip hidden / non-file-or-dir (sockets, etc.)
    if (entry.name.startsWith(".")) continue;
    const kind: "file" | "directory" | null = entry.isDirectory()
      ? "directory"
      : entry.isFile()
        ? "file"
        : null;
    if (!kind) continue;
    entries.push({
      name: entry.name,
      path: `${rel}/${entry.name}`,
      kind,
    });
  }

  return { path: rel, entries };
}

function pickString(
  rec: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function pickTimestamp(
  job: Record<string, unknown>,
  keys: string[],
): string | null | undefined {
  for (const key of keys) {
    const value = job[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      const ms = value < 1e12 ? value * 1000 : value;
      return new Date(ms).toISOString();
    }
  }
  return undefined;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function jobMatchesId(job: Record<string, unknown>, cronId: string): boolean {
  const id =
    (typeof job.id === "string" && job.id) ||
    (typeof job.name === "string" && slugify(job.name)) ||
    "";
  if (id === cronId) return true;
  if (typeof job.name === "string" && job.name === cronId) return true;
  return false;
}

function redactPayload(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactPayload(item));
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretField(key)) continue;
    out[key] = redactPayload(child);
  }
  return out;
}

function formatSchedule(job: Record<string, unknown>): string | undefined {
  const display = pickString(job, [
    "schedule_display",
    "scheduleDisplay",
    "display",
  ]);
  if (display) return display;
  const schedule = job.schedule;
  if (typeof schedule === "string" && schedule.trim()) {
    return schedule.trim();
  }
  if (schedule && typeof schedule === "object") {
    const rec = schedule as Record<string, unknown>;
    const expr = pickString(rec, ["expr", "expression", "cron"]);
    if (expr) return expr;
  }
  return undefined;
}

/**
 * Load a single cron job's detail fields from host `cron/jobs.json`.
 */
export async function loadSettingsCronJobDetail(
  cronId: string,
  options: ReadSettingsHostContentOptions = {},
): Promise<SettingsCronJobDetail> {
  if (!cronId.trim()) {
    throw new SettingsContentError("cron id is required", 400, "invalid_id");
  }

  if (options.preferFixture) {
    throw new SettingsContentError(
      "No host home available for cron job detail (fixture snapshot)",
      404,
      "no_host_home",
    );
  }

  const hermesHome = options.hermesHome
    ? path.resolve(options.hermesHome)
    : resolveHermesHome();

  if (!(await hermesHomePresent(hermesHome))) {
    throw new SettingsContentError(
      "No host home available for cron job detail",
      404,
      "no_host_home",
    );
  }

  const jobsRel = "cron/jobs.json";
  const jobsAbs = path.resolve(hermesHome, "cron", "jobs.json");
  const contained = await resolveContainedRealpath(hermesHome, jobsAbs);
  if (contained === null) {
    throw new SettingsContentError(
      "cron/jobs.json not found on host",
      404,
      "not_found",
    );
  }

  let parsed: { jobs?: Array<Record<string, unknown>> };
  try {
    const raw = await readFile(contained, "utf8");
    parsed = JSON.parse(raw) as { jobs?: Array<Record<string, unknown>> };
  } catch {
    throw new SettingsContentError(
      "Failed to read cron/jobs.json",
      500,
      "read_failed",
    );
  }

  const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
  const job = jobs.find((j) => jobMatchesId(j, cronId));
  if (!job) {
    throw new SettingsContentError(
      `Cron job not found: ${cronId}`,
      404,
      "not_found",
    );
  }

  const id =
    (typeof job.id === "string" && job.id) ||
    (typeof job.name === "string" && slugify(job.name)) ||
    cronId;
  const name =
    (typeof job.name === "string" && job.name) ||
    (typeof job.id === "string" && job.id) ||
    cronId;

  const command = pickString(job, [
    "command",
    "cmd",
    "bin",
    "shell",
    "script",
  ]);
  const prompt = pickString(job, ["prompt", "message", "text", "body"]);

  let payload: unknown;
  for (const key of ["payload", "params", "args", "data", "input"]) {
    if (key in job && job[key] !== undefined && !isSecretField(key)) {
      payload = redactPayload(job[key]);
      break;
    }
  }

  const last_run_at = pickTimestamp(job, [
    "last_run_at",
    "lastRunAt",
    "last_run",
    "lastRun",
    "last_execution_at",
  ]);
  const next_run_at = pickTimestamp(job, [
    "next_run_at",
    "nextRunAt",
    "next_run",
    "nextRun",
    "next_execution_at",
  ]);

  return {
    id,
    name,
    schedule: formatSchedule(job),
    enabled: job.enabled !== false,
    path: jobsRel,
    ...(last_run_at !== undefined ? { last_run_at } : {}),
    ...(next_run_at !== undefined ? { next_run_at } : {}),
    ...(command ? { command } : {}),
    ...(prompt ? { prompt } : {}),
    ...(payload !== undefined ? { payload } : {}),
  };
}
