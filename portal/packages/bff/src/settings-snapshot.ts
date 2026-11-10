import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import {
  discoverSettingsFromHermes,
  hermesHomePresent,
  resolveHermesHome,
  type DiscoverSettingsOptions,
} from "./settings-discover.js";

export type SettingsSkill = {
  id: string;
  name: string;
  path?: string;
  enabled: boolean;
};

export type SettingsCron = {
  id: string;
  name: string;
  schedule: string;
  /** Relative path to the jobs file when discovered from Hermes. */
  path?: string;
  enabled: boolean;
  /** ISO timestamp of last run when known. */
  last_run_at?: string | null;
  /** ISO timestamp of next scheduled run when known. */
  next_run_at?: string | null;
};

export type SettingsMcpServer = {
  name: string;
  transport: string;
  command?: string;
  /** When false, server is disabled in Hermes config. */
  enabled?: boolean;
};

export type SettingsModel = {
  provider: string;
  model: string;
  /** True when this is the configured default / active model. */
  is_active?: boolean;
  /** True when the provider has credentials / is considered connected. */
  connected?: boolean;
};

export type SettingsIntegration = {
  id: string;
  name: string;
  type: string;
  /** Command name (e.g. `gws`). */
  bin?: string;
  /** Absolute or resolved binary path when known. */
  path?: string;
};

/** User-created workflow definition (settings.snapshot.workflows). */
export type SettingsWorkflow = {
  id: string;
  name: string;
  path?: string;
  description?: string;
  enabled?: boolean;
  updated_at?: string | null;
};

export type SettingsSnapshotSource = "fixture" | "hermes";

export type RawSettingsSnapshot = {
  exported_at: string;
  hermes_home?: string | null;
  source?: SettingsSnapshotSource;
  skills: SettingsSkill[];
  crons: SettingsCron[];
  mcp_servers: Array<SettingsMcpServer & Record<string, unknown>>;
  models: Array<SettingsModel & Record<string, unknown>>;
  integrations: SettingsIntegration[];
  workflows?: SettingsWorkflow[];
};

export type RedactedSettingsSnapshot = {
  exported_at: string;
  hermes_home?: string | null;
  source?: SettingsSnapshotSource;
  skills: SettingsSkill[];
  crons: SettingsCron[];
  mcp_servers: SettingsMcpServer[];
  models: SettingsModel[];
  integrations: SettingsIntegration[];
  workflows?: SettingsWorkflow[];
};

const SECRET_KEY_PATTERN =
  /^(api[_-]?key|secret|token|password|access[_-]?token|refresh[_-]?token|private[_-]?key|client[_-]?secret|auth|authorization|headers|env)$/i;

export function isSecretField(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

export function redactSettingsSnapshot(
  snapshot: RawSettingsSnapshot,
): RedactedSettingsSnapshot {
  return {
    exported_at: snapshot.exported_at,
    hermes_home: snapshot.hermes_home ?? null,
    source: snapshot.source,
    skills: snapshot.skills.map((skill) => ({ ...skill })),
    crons: snapshot.crons.map((cron) => ({ ...cron })),
    mcp_servers: snapshot.mcp_servers.map(redactRecord),
    models: snapshot.models.map(redactRecord),
    integrations: snapshot.integrations.map((integration) => ({
      ...integration,
    })),
    workflows: (snapshot.workflows ?? []).map((workflow) => ({
      ...workflow,
    })),
  };
}

/** In-process overrides applied when snapshot source is fixture (no Hermes write). */
const fixtureSkillEnabled = new Map<string, boolean>();
const fixtureCronEnabled = new Map<string, boolean>();
const fixtureMcpEnabled = new Map<string, boolean>();
/** fixture key: `${provider}::${model}` → is_active */
let fixtureActiveModel: { provider: string; model: string } | null = null;

/** Test helper: clear fixture-mode toggle overrides. */
export function clearFixtureSettingsOverrides(): void {
  fixtureSkillEnabled.clear();
  fixtureCronEnabled.clear();
  fixtureMcpEnabled.clear();
  fixtureActiveModel = null;
}

function applyFixtureOverrides(
  snapshot: RedactedSettingsSnapshot,
): RedactedSettingsSnapshot {
  if (snapshot.source !== "fixture") {
    return snapshot;
  }
  if (
    fixtureSkillEnabled.size === 0 &&
    fixtureCronEnabled.size === 0 &&
    fixtureMcpEnabled.size === 0 &&
    !fixtureActiveModel
  ) {
    return snapshot;
  }
  return {
    ...snapshot,
    skills: snapshot.skills.map((skill) => {
      const override = fixtureSkillEnabled.get(skill.id);
      return override === undefined ? skill : { ...skill, enabled: override };
    }),
    crons: snapshot.crons.map((cron) => {
      const override = fixtureCronEnabled.get(cron.id);
      return override === undefined ? cron : { ...cron, enabled: override };
    }),
    mcp_servers: snapshot.mcp_servers.map((server) => {
      const override = fixtureMcpEnabled.get(server.name);
      if (override === undefined) {
        return server;
      }
      return { ...server, enabled: override };
    }),
    models: snapshot.models.map((model) => {
      if (!fixtureActiveModel) {
        return model;
      }
      const isActive =
        model.provider === fixtureActiveModel.provider &&
        model.model === fixtureActiveModel.model;
      return { ...model, is_active: isActive };
    }),
  };
}

function redactRecord<T extends Record<string, unknown>>(record: T): T {
  const redacted = { ...record };
  for (const key of Object.keys(redacted)) {
    if (isSecretField(key)) {
      delete redacted[key];
    }
  }
  return redacted as T;
}

export function assertNoSecrets(value: unknown, path = "$"): void {
  if (value === null || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`));
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (isSecretField(key)) {
      throw new Error(`Secret field leaked at ${path}.${key}`);
    }
    assertNoSecrets(child, `${path}.${key}`);
  }
}

export async function loadSettingsSnapshotFromFile(
  snapshotPath: string,
): Promise<RedactedSettingsSnapshot> {
  const raw = await readFile(snapshotPath, "utf8");
  const parsed = JSON.parse(raw) as RawSettingsSnapshot;
  const withSource: RawSettingsSnapshot = {
    ...parsed,
    source: parsed.source ?? "fixture",
    hermes_home: parsed.hermes_home ?? null,
  };
  const redacted = redactSettingsSnapshot(withSource);
  assertNoSecrets(redacted);
  return redacted;
}

/** Lab-only MCP server advertised when SETTINGS_SEED_LAB_MCP=1 (lp-zuh.14.3). */
export const LAB_ECHO_MCP_SERVER: SettingsMcpServer = {
  name: "lab_echo",
  transport: "stdio",
  command: "python3",
  enabled: true,
};

/**
 * Ensure `lab_echo` is present in the snapshot (secret-free MockLab seed).
 * Used on VaultPlane=cp_s3 when guest LA / LANYARD_ENTRY_SEED_MCP is N/A
 * (tool-only short stack). Idempotent.
 */
export function ensureLabMcpSeed(
  snapshot: RedactedSettingsSnapshot,
): RedactedSettingsSnapshot {
  const existing = snapshot.mcp_servers ?? [];
  if (existing.some((s) => s.name === LAB_ECHO_MCP_SERVER.name)) {
    return snapshot;
  }
  return {
    ...snapshot,
    mcp_servers: [
      {
        name: LAB_ECHO_MCP_SERVER.name,
        transport: LAB_ECHO_MCP_SERVER.transport,
        command: LAB_ECHO_MCP_SERVER.command,
        enabled: LAB_ECHO_MCP_SERVER.enabled,
      },
      ...existing,
    ],
  };
}

/**
 * Load settings: prefer live discovery when BACKEND_HOME / HERMES_HOME (or
 * default ~/.hermes via resolveHermesHome) is present; otherwise fixture JSON.
 *
 * Discover failures fall back to fixture (lp-zuh.14.3): production BFF on
 * VaultPlane=cp_s3 must not 500 when HERMES_HOME is partial or fixtures were
 * previously omitted from the image (`files` now includes `fixtures/`).
 */
export async function loadSettingsSnapshot(
  snapshotPath: string,
  options: {
    hermesHome?: string;
    discoverOptions?: DiscoverSettingsOptions;
    /** Force fixture path even if Hermes is present (tests). */
    preferFixture?: boolean;
    /** When true, ensure lab_echo is in mcp_servers (MockLab short-stack). */
    seedLabMcp?: boolean;
  } = {},
): Promise<RedactedSettingsSnapshot> {
  const finish = (snapshot: RedactedSettingsSnapshot): RedactedSettingsSnapshot =>
    options.seedLabMcp ? ensureLabMcpSeed(snapshot) : snapshot;

  if (!options.preferFixture) {
    const hermesHome =
      options.hermesHome ??
      options.discoverOptions?.hermesHome ??
      resolveHermesHome();
    try {
      if (await hermesHomePresent(hermesHome)) {
        const discovered = await discoverSettingsFromHermes({
          ...options.discoverOptions,
          hermesHome,
        });
        const redacted = redactSettingsSnapshot(discovered);
        assertNoSecrets(redacted);
        return finish(redacted);
      }
    } catch {
      // Fall through to fixture — do not 500 Tools → MCP on short-stack.
    }
  }

  const fromFile = await loadSettingsSnapshotFromFile(snapshotPath);
  return finish(applyFixtureOverrides(fromFile));
}

export type SettingsPatchOptions = {
  snapshotPath: string;
  hermesHome?: string;
  preferFixture?: boolean;
};

export type SettingsSkillPatchResult = {
  skill: SettingsSkill;
  source: "fixture" | "hermes";
};

export type SettingsCronPatchResult = {
  cron: SettingsCron;
  source: "fixture" | "hermes";
};

export type SettingsMcpPatchResult = {
  mcp: SettingsMcpServer;
  source: "fixture" | "hermes";
};

export type SettingsModelPatchResult = {
  model: SettingsModel;
  source: "fixture" | "hermes";
};

/**
 * Toggle a skill's enabled flag. Writes Hermes config when live; otherwise
 * applies an in-memory fixture override for the process lifetime.
 */
export async function patchSettingsSkill(
  skillId: string,
  enabled: boolean,
  options: SettingsPatchOptions,
): Promise<SettingsSkillPatchResult> {
  const resolved = await resolveWritableHermesHome(options);
  if (resolved) {
    const skill = await writeHermesSkillEnabled(resolved, skillId, enabled);
    return { skill, source: "hermes" };
  }

  const snapshot = await loadSettingsSnapshotFromFile(options.snapshotPath);
  const skill = snapshot.skills.find((s) => s.id === skillId);
  if (!skill) {
    throw new SettingsPatchNotFoundError(`Skill not found: ${skillId}`);
  }
  fixtureSkillEnabled.set(skillId, enabled);
  return { skill: { ...skill, enabled }, source: "fixture" };
}

/**
 * Toggle a cron job's enabled flag. Writes jobs.json when live; otherwise
 * applies an in-memory fixture override for the process lifetime.
 */
export async function patchSettingsCron(
  cronId: string,
  enabled: boolean,
  options: SettingsPatchOptions,
): Promise<SettingsCronPatchResult> {
  const resolved = await resolveWritableHermesHome(options);
  if (resolved) {
    const cron = await writeHermesCronEnabled(resolved, cronId, enabled);
    return { cron, source: "hermes" };
  }

  const snapshot = await loadSettingsSnapshotFromFile(options.snapshotPath);
  const cron = snapshot.crons.find((c) => c.id === cronId);
  if (!cron) {
    throw new SettingsPatchNotFoundError(`Cron not found: ${cronId}`);
  }
  fixtureCronEnabled.set(cronId, enabled);
  return { cron: { ...cron, enabled }, source: "fixture" };
}

/**
 * Toggle an MCP server's enabled flag in Hermes config.yaml mcp_servers.
 */
export async function patchSettingsMcp(
  mcpName: string,
  enabled: boolean,
  options: SettingsPatchOptions,
): Promise<SettingsMcpPatchResult> {
  const resolved = await resolveWritableHermesHome(options);
  if (resolved) {
    const mcp = await writeHermesMcpEnabled(resolved, mcpName, enabled);
    return { mcp, source: "hermes" };
  }

  const snapshot = await loadSettingsSnapshotFromFile(options.snapshotPath);
  const mcp = snapshot.mcp_servers.find((s) => s.name === mcpName);
  if (!mcp) {
    throw new SettingsPatchNotFoundError(`MCP server not found: ${mcpName}`);
  }
  fixtureMcpEnabled.set(mcpName, enabled);
  return { mcp: { ...mcp, enabled }, source: "fixture" };
}

/**
 * Set the active Hermes model (config.model.provider + config.model.default).
 */
export async function patchSettingsActiveModel(
  provider: string,
  model: string,
  options: SettingsPatchOptions,
): Promise<SettingsModelPatchResult> {
  const resolved = await resolveWritableHermesHome(options);
  if (resolved) {
    const active = await writeHermesActiveModel(resolved, provider, model);
    return { model: active, source: "hermes" };
  }

  const snapshot = await loadSettingsSnapshotFromFile(options.snapshotPath);
  const found = snapshot.models.find(
    (m) => m.provider === provider && m.model === model,
  );
  if (!found) {
    throw new SettingsPatchNotFoundError(
      `Model not found: ${provider}/${model}`,
    );
  }
  fixtureActiveModel = { provider, model };
  return { model: { ...found, is_active: true }, source: "fixture" };
}

export class SettingsPatchNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsPatchNotFoundError";
  }
}

async function resolveWritableHermesHome(
  options: SettingsPatchOptions,
): Promise<string | null> {
  if (options.preferFixture) {
    return null;
  }
  const hermesHome = options.hermesHome ?? resolveHermesHome();
  if (await hermesHomePresent(hermesHome)) {
    return path.resolve(hermesHome);
  }
  return null;
}

async function writeHermesSkillEnabled(
  hermesHome: string,
  skillId: string,
  enabled: boolean,
): Promise<SettingsSkill> {
  const snapshot = await discoverSettingsFromHermes({ hermesHome });
  const skill = snapshot.skills.find(
    (s) =>
      s.id === skillId ||
      s.name === skillId ||
      s.path?.endsWith(`/${skillId}`) ||
      s.path === skillId,
  );
  if (!skill) {
    throw new SettingsPatchNotFoundError(`Skill not found: ${skillId}`);
  }

  const configPath = path.join(hermesHome, "config.yaml");
  let config: Record<string, unknown> = {};
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = parseYaml(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      config = parsed as Record<string, unknown>;
    }
  } catch {
    // start from empty
  }

  const skillsSection =
    config.skills && typeof config.skills === "object" && !Array.isArray(config.skills)
      ? ({ ...(config.skills as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  const disabledRaw = skillsSection.disabled;
  const disabled = new Set(
    Array.isArray(disabledRaw)
      ? disabledRaw.filter((item): item is string => typeof item === "string")
      : [],
  );

  // Hermes matches disabled by name, folder, or id — keep all aliases in sync.
  const aliases = [skill.name, skill.id, path.basename(skill.path ?? "")].filter(
    Boolean,
  ) as string[];
  for (const alias of aliases) {
    if (enabled) {
      disabled.delete(alias);
    } else {
      disabled.add(alias);
    }
  }

  skillsSection.disabled = [...disabled].sort();
  config.skills = skillsSection;
  await writeFile(configPath, stringifyYaml(config), "utf8");

  return { ...skill, enabled };
}

async function writeHermesCronEnabled(
  hermesHome: string,
  cronId: string,
  enabled: boolean,
): Promise<SettingsCron> {
  const jobsPath = path.join(hermesHome, "cron", "jobs.json");
  let raw: string;
  try {
    raw = await readFile(jobsPath, "utf8");
  } catch {
    throw new SettingsPatchNotFoundError(`Cron not found: ${cronId}`);
  }

  const parsed = JSON.parse(raw) as {
    jobs?: Array<Record<string, unknown>>;
    updated_at?: string;
  };
  const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
  const index = jobs.findIndex((job) => {
    const id =
      (typeof job.id === "string" && job.id) ||
      (typeof job.name === "string" && slugifyLocal(job.name)) ||
      "";
    return id === cronId;
  });
  if (index < 0) {
    throw new SettingsPatchNotFoundError(`Cron not found: ${cronId}`);
  }

  jobs[index] = { ...jobs[index], enabled };
  const next = {
    ...parsed,
    jobs,
    updated_at: new Date().toISOString(),
  };
  await writeFile(jobsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");

  const refreshed = await discoverSettingsFromHermes({ hermesHome });
  const cron = refreshed.crons.find((c) => c.id === cronId);
  if (!cron) {
    throw new SettingsPatchNotFoundError(`Cron not found after write: ${cronId}`);
  }
  return cron;
}

function slugifyLocal(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function readHermesConfig(
  hermesHome: string,
): Promise<Record<string, unknown>> {
  const configPath = path.join(hermesHome, "config.yaml");
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = parseYaml(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // start from empty
  }
  return {};
}

async function writeHermesConfig(
  hermesHome: string,
  config: Record<string, unknown>,
): Promise<void> {
  const configPath = path.join(hermesHome, "config.yaml");
  await writeFile(configPath, stringifyYaml(config), "utf8");
}

async function writeHermesMcpEnabled(
  hermesHome: string,
  mcpName: string,
  enabled: boolean,
): Promise<SettingsMcpServer> {
  const snapshot = await discoverSettingsFromHermes({ hermesHome });
  const mcp = snapshot.mcp_servers.find((s) => s.name === mcpName);
  if (!mcp) {
    throw new SettingsPatchNotFoundError(`MCP server not found: ${mcpName}`);
  }

  const config = await readHermesConfig(hermesHome);
  const servers =
    config.mcp_servers &&
    typeof config.mcp_servers === "object" &&
    !Array.isArray(config.mcp_servers)
      ? ({ ...(config.mcp_servers as Record<string, unknown>) } as Record<
          string,
          unknown
        >)
      : {};

  const existing = servers[mcpName];
  const rec =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? ({ ...(existing as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  rec.enabled = enabled;
  servers[mcpName] = rec;
  config.mcp_servers = servers;
  await writeHermesConfig(hermesHome, config);

  return { ...mcp, enabled };
}

async function writeHermesActiveModel(
  hermesHome: string,
  provider: string,
  model: string,
): Promise<SettingsModel> {
  const snapshot = await discoverSettingsFromHermes({ hermesHome });
  const found = snapshot.models.find(
    (m) => m.provider === provider && m.model === model,
  );
  if (!found) {
    throw new SettingsPatchNotFoundError(
      `Model not found: ${provider}/${model}`,
    );
  }

  const config = await readHermesConfig(hermesHome);
  const modelSection =
    config.model && typeof config.model === "object" && !Array.isArray(config.model)
      ? ({ ...(config.model as Record<string, unknown>) } as Record<
          string,
          unknown
        >)
      : {};
  modelSection.provider = provider;
  modelSection.default = model;
  config.model = modelSection;
  await writeHermesConfig(hermesHome, config);

  return { ...found, is_active: true, provider, model };
}

export function defaultSettingsSnapshotPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "..", "fixtures", "settings-snapshot.json");
}
