/**
 * Provider API keys saved from Settings.
 *
 * The vault file is the localhost stand-in for encrypted cloud storage.
 * Reads return the last four characters only. Environment variables such as
 * OPENAI_API_KEY are shown the same way and are not copied into the file.
 */

import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadModelCatalog, type ModelCatalog } from "./model-catalog.js";

/** Provider name → process env var. One name per variable. */
export const PROVIDER_ENV_NAMES: Readonly<Record<string, string>> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  xai: "XAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  mistral: "MISTRAL_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  fireworks_ai: "FIREWORKS_API_KEY",
  together_ai: "TOGETHERAI_API_KEY",
  azure: "AZURE_API_KEY",
  meta: "META_API_KEY",
  poolside: "POOLSIDE_API_KEY",
};

export type ProviderKeyPublic = {
  id: string;
  provider: string;
  last4: string;
  source: "vault" | "environment";
};

type StoredProviderKey = {
  id: string;
  provider: string;
  api_key: string;
};

export class InvalidProviderKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProviderKeyError";
  }
}

export class ProviderKeyNotFoundError extends Error {
  constructor(id: string) {
    super(`Unknown provider key: ${id}`);
    this.name = "ProviderKeyNotFoundError";
  }
}

export class ProviderKeyInUseError extends Error {
  constructor() {
    super("This key is used by a model");
    this.name = "ProviderKeyInUseError";
  }
}

export function providerKeysPath(root: string): string {
  return path.join(root, "admin", "provider-keys.json");
}

function last4(apiKey: string): string {
  return apiKey.slice(-4);
}

function assertProvider(provider: string): string {
  const trimmed = provider.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,39}$/.test(trimmed)) {
    throw new InvalidProviderKeyError("Invalid provider");
  }
  return trimmed;
}

function assertApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length < 8 || trimmed.length > 512 || /\s/.test(trimmed)) {
    throw new InvalidProviderKeyError("Invalid API key");
  }
  return trimmed;
}

async function readStored(root: string): Promise<StoredProviderKey[]> {
  let raw: string;
  try {
    raw = await readFile(providerKeysPath(root), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const parsed = JSON.parse(raw) as { keys?: unknown };
  if (!parsed || !Array.isArray(parsed.keys)) return [];
  const keys: StoredProviderKey[] = [];
  for (const entry of parsed.keys) {
    if (!entry || typeof entry !== "object") continue;
    const id = (entry as { id?: unknown }).id;
    const provider = (entry as { provider?: unknown }).provider;
    const apiKey = (entry as { api_key?: unknown }).api_key;
    if (typeof id !== "string" || typeof provider !== "string" || typeof apiKey !== "string") {
      continue;
    }
    keys.push({ id, provider, api_key: apiKey });
  }
  return keys;
}

async function writeStored(root: string, keys: StoredProviderKey[]): Promise<void> {
  const file = providerKeysPath(root);
  await mkdir(path.dirname(file), { recursive: true });
  const body = `${JSON.stringify({ keys }, null, 2)}\n`;
  await writeFile(file, body, { encoding: "utf8", mode: 0o600 });
  await chmod(path.dirname(file), 0o700);
  await chmod(file, 0o600);
}

export function environmentProviderKeys(env: NodeJS.ProcessEnv = process.env): ProviderKeyPublic[] {
  const rows: ProviderKeyPublic[] = [];
  for (const [provider, envName] of Object.entries(PROVIDER_ENV_NAMES)) {
    const value = env[envName]?.trim();
    if (!value || value.length < 8 || /\s/.test(value)) continue;
    rows.push({
      id: `env:${provider}`,
      provider,
      last4: last4(value),
      source: "environment",
    });
  }
  return rows;
}

/** Public list. Vault keys first, then environment keys. No secret material. */
export async function listProviderKeys(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProviderKeyPublic[]> {
  const stored = await readStored(root);
  const vault: ProviderKeyPublic[] = stored.map((key) => ({
    id: key.id,
    provider: key.provider,
    last4: last4(key.api_key),
    source: "vault",
  }));
  return [...vault, ...environmentProviderKeys(env)];
}

export async function saveProviderKey(
  root: string,
  input: { provider: string; api_key: string },
): Promise<ProviderKeyPublic> {
  const provider = assertProvider(input.provider);
  const apiKey = assertApiKey(input.api_key);
  const stored = await readStored(root);
  let id = `${provider}-${randomBytes(3).toString("hex")}`;
  while (stored.some((key) => key.id === id)) {
    id = `${provider}-${randomBytes(3).toString("hex")}`;
  }
  stored.push({ id, provider, api_key: apiKey });
  await writeStored(root, stored);
  return { id, provider, last4: last4(apiKey), source: "vault" };
}

export async function deleteProviderKey(root: string, id: string): Promise<void> {
  if (id.startsWith("env:")) {
    throw new InvalidProviderKeyError("Environment keys are not stored here");
  }
  const catalog = await loadModelCatalog(root);
  if (catalog.models.some((model) => model.key_id === id)) {
    throw new ProviderKeyInUseError();
  }
  const stored = await readStored(root);
  const next = stored.filter((key) => key.id !== id);
  if (next.length === stored.length) {
    throw new ProviderKeyNotFoundError(id);
  }
  await writeStored(root, next);
}

export async function assertCatalogKeyIds(
  root: string,
  catalog: ModelCatalog,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const known = new Set((await listProviderKeys(root, env)).map((key) => key.id));
  for (const model of catalog.models) {
    if (model.key_id && !known.has(model.key_id)) {
      throw new ProviderKeyNotFoundError(model.key_id);
    }
  }
}

/** Raw secret for a vault or environment key. Callers must not return this from HTTP. */
export async function loadProviderKeyValue(
  root: string,
  keyId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  if (keyId.startsWith("env:")) {
    const provider = keyId.slice("env:".length);
    const envName = PROVIDER_ENV_NAMES[provider];
    const value = envName ? env[envName]?.trim() : "";
    return value || null;
  }
  const stored = await readStored(root);
  return stored.find((key) => key.id === keyId)?.api_key ?? null;
}

/** YAML scalar for a model api_key. Environment keys stay `os.environ/NAME`. */
export async function providerKeyYamlScalar(
  root: string,
  keyId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  if (keyId.startsWith("env:")) {
    const provider = keyId.slice("env:".length);
    const envName = PROVIDER_ENV_NAMES[provider];
    const value = envName ? env[envName]?.trim() : undefined;
    if (!envName || !value) return null;
    return JSON.stringify(`os.environ/${envName}`);
  }
  const stored = await readStored(root);
  const row = stored.find((key) => key.id === keyId);
  if (!row) return null;
  return JSON.stringify(row.api_key);
}
