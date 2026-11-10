/**
 * Per-agent backend, cron list, and memory files (lp-bhcg.3).
 *
 * Files live under VAULT_ROOT/agents/<agent_id>/. One agent's write does not
 * appear in another agent's directory. The API key stays on disk; reads
 * return a hint, not the secret.
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  isAgentBackendProtocol,
  type AgentBackendConfig,
  type AgentBackendProtocol,
} from "./agent-backend.js";

const AGENT_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const MEMORY_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const JOB_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

export type AgentCronJob = {
  id: string;
  name: string;
};

export type StoredAgentBackend = AgentBackendConfig;

export class AgentPersonaPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentPersonaPathError";
  }
}

export function assertAgentId(agentId: string): string {
  const id = agentId.trim();
  if (!AGENT_ID_RE.test(id)) {
    throw new AgentPersonaPathError("Invalid agent id");
  }
  return id;
}

function agentDir(vaultRoot: string, agentId: string): string {
  const root = path.resolve(vaultRoot);
  const dir = path.resolve(root, "agents", assertAgentId(agentId));
  const rel = path.relative(root, dir);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new AgentPersonaPathError("Agent path escapes VAULT_ROOT");
  }
  return dir;
}

function assertInside(rootDir: string, full: string): void {
  const rel = path.relative(rootDir, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new AgentPersonaPathError("Path escapes the agent directory");
  }
}

export async function saveAgentBackend(
  vaultRoot: string,
  agentId: string,
  config: AgentBackendConfig,
): Promise<void> {
  if (!isAgentBackendProtocol(config.protocol)) {
    throw new AgentPersonaPathError("Invalid agent backend protocol");
  }
  const dir = agentDir(vaultRoot, agentId);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "backend.json");
  await writeFile(
    file,
    JSON.stringify({
      base_url: config.baseUrl,
      api_key: config.apiKey,
      protocol: config.protocol,
      model: config.model || "default",
    }),
    { mode: 0o600 },
  );
}

export async function loadAgentBackend(
  vaultRoot: string,
  agentId: string,
): Promise<StoredAgentBackend | null> {
  const file = path.join(agentDir(vaultRoot, agentId), "backend.json");
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const parsed = JSON.parse(raw) as {
    base_url?: unknown;
    api_key?: unknown;
    protocol?: unknown;
    model?: unknown;
  };
  if (
    typeof parsed.base_url !== "string" ||
    typeof parsed.api_key !== "string" ||
    typeof parsed.protocol !== "string" ||
    !isAgentBackendProtocol(parsed.protocol)
  ) {
    return null;
  }
  return {
    baseUrl: parsed.base_url.replace(/\/$/, ""),
    apiKey: parsed.api_key,
    protocol: parsed.protocol,
    model: typeof parsed.model === "string" && parsed.model.trim()
      ? parsed.model.trim()
      : "default",
  };
}

export function agentBackendPublicView(config: AgentBackendConfig | null): {
  base_url: string | null;
  protocol: AgentBackendProtocol | null;
  model: string | null;
  api_key_set: boolean;
  api_key_last4: string | null;
} {
  if (!config) {
    return {
      base_url: null,
      protocol: null,
      model: null,
      api_key_set: false,
      api_key_last4: null,
    };
  }
  const key = config.apiKey;
  return {
    base_url: config.baseUrl,
    protocol: config.protocol,
    model: config.model,
    api_key_set: key.length > 0,
    api_key_last4: key.length >= 4 ? key.slice(-4) : key,
  };
}

/**
 * Persona backend wins when that agent has one stored. Otherwise the process
 * three-field backend is the fallback.
 */
export async function resolveChatAgentBackend(input: {
  vaultRoot?: string;
  agentId?: string | null;
  fallback?: AgentBackendConfig;
}): Promise<AgentBackendConfig | undefined> {
  if (input.vaultRoot && input.agentId) {
    const stored = await loadAgentBackend(input.vaultRoot, input.agentId);
    if (stored) return stored;
  }
  return input.fallback;
}

export async function saveAgentCrons(
  vaultRoot: string,
  agentId: string,
  jobs: AgentCronJob[],
): Promise<AgentCronJob[]> {
  const cleaned: AgentCronJob[] = [];
  const seen = new Set<string>();
  for (const job of jobs) {
    const id = job.id.trim();
    const name = job.name.trim();
    if (!JOB_ID_RE.test(id) || !name || name.length > 120) {
      throw new AgentPersonaPathError("Invalid cron job");
    }
    if (seen.has(id)) continue;
    seen.add(id);
    cleaned.push({ id, name });
  }
  const dir = path.join(agentDir(vaultRoot, agentId), "cron");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "jobs.json"),
    JSON.stringify({ jobs: cleaned }),
    "utf8",
  );
  return cleaned;
}

export async function listAgentCrons(
  vaultRoot: string,
  agentId: string,
): Promise<AgentCronJob[]> {
  const file = path.join(agentDir(vaultRoot, agentId), "cron", "jobs.json");
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as { jobs?: unknown };
    if (!Array.isArray(parsed.jobs)) return [];
    return parsed.jobs.flatMap((job) => {
      if (!job || typeof job !== "object") return [];
      const id = (job as { id?: unknown }).id;
      const name = (job as { name?: unknown }).name;
      if (typeof id !== "string" || typeof name !== "string") return [];
      return [{ id, name }];
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function assertMemoryName(name: string): string {
  const trimmed = name.trim();
  if (!MEMORY_NAME_RE.test(trimmed) || trimmed.includes("..")) {
    throw new AgentPersonaPathError("Invalid memory file name");
  }
  return trimmed;
}

export async function writeAgentMemory(
  vaultRoot: string,
  agentId: string,
  name: string,
  content: string,
): Promise<void> {
  const safe = assertMemoryName(name);
  const dir = path.join(agentDir(vaultRoot, agentId), "memory");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, safe);
  assertInside(dir, file);
  await writeFile(file, content, "utf8");
}

export async function readAgentMemory(
  vaultRoot: string,
  agentId: string,
  name: string,
): Promise<string | null> {
  const safe = assertMemoryName(name);
  const dir = path.join(agentDir(vaultRoot, agentId), "memory");
  const file = path.join(dir, safe);
  assertInside(dir, file);
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function listAgentMemory(
  vaultRoot: string,
  agentId: string,
): Promise<string[]> {
  const dir = path.join(agentDir(vaultRoot, agentId), "memory");
  try {
    const names = await readdir(dir);
    return names.filter((name) => MEMORY_NAME_RE.test(name)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Thread job id is namespaced so two agents can both have a job called daily. */
export function personaJobThreadId(agentId: string, jobId: string): string {
  return `${assertAgentId(agentId)}:${jobId.trim()}`;
}
