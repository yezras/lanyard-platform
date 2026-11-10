import {
  accessSync,
  constants as fsConstants,
} from "node:fs";
import { access, readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveBackendHome } from "@lanyard/hermes-compat";
import { parse as parseYaml } from "yaml";

import type {
  RawSettingsSnapshot,
  SettingsCron,
  SettingsIntegration,
  SettingsMcpServer,
  SettingsModel,
  SettingsSkill,
  SettingsWorkflow,
} from "./settings-snapshot.js";

/** Well-known developer CLIs to surface under Integrations when present on PATH. */
const DEFAULT_PATH_CLI_NAMES = [
  "gws",
  "gh",
  "git",
  "node",
  "npm",
  "pnpm",
  "python3",
  "python",
  "docker",
  "kubectl",
  "uv",
  "uvx",
  "tirith",
  "hermes",
  "code",
  "cursor",
] as const;

/**
 * Default runtime home basename when neither BACKEND_HOME nor HERMES_HOME is set.
 * Product code must not hardcode this path; go through {@link resolveHermesHome}.
 */
export const DEFAULT_BACKEND_HOME_BASENAME = ".hermes";

export type DiscoverSettingsOptions = {
  /**
   * Override backend/runtime home (default: BACKEND_HOME, legacy HERMES_HOME,
   * else `~/.hermes` via {@link resolveHermesHome}).
   */
  hermesHome?: string;
  /** PATH string used for CLI discovery (default: process.env.PATH). */
  pathEnv?: string;
  /** Extra CLI binary names to resolve on PATH. */
  pathCliNames?: readonly string[];
  /** Clock for exported_at (tests). */
  now?: () => Date;
};

/**
 * Resolve the local backend/runtime home directory.
 *
 * Preference order (lp-rt5.3 / hermes-compat):
 * 1. BACKEND_HOME (preferred)
 * 2. HERMES_HOME (legacy alias)
 * 3. `~/.hermes` when neither env is set
 *
 * Throws {@link EnvAliasConflictError} when both env vars are set and differ.
 */
export function resolveHermesHome(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  const fromAlias = resolveBackendHome(env);
  if (fromAlias) {
    return path.resolve(fromAlias);
  }
  return path.join(homedir(), DEFAULT_BACKEND_HOME_BASENAME);
}

export async function hermesHomePresent(hermesHome: string): Promise<boolean> {
  try {
    const info = await stat(hermesHome);
    return info.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Discover a live settings snapshot from a Hermes home directory.
 * Never includes secret fields (api keys, tokens, env maps, auth blobs).
 */
export async function discoverSettingsFromHermes(
  options: DiscoverSettingsOptions = {},
): Promise<RawSettingsSnapshot> {
  const hermesHome = options.hermesHome
    ? path.resolve(options.hermesHome)
    : resolveHermesHome();
  const now = options.now ?? (() => new Date());
  const pathEnv = options.pathEnv ?? process.env.PATH ?? "";
  const pathCliNames = options.pathCliNames ?? DEFAULT_PATH_CLI_NAMES;

  const config = await readHermesConfig(hermesHome);
  const disabledSkills = collectDisabledSkills(config);

  const [skills, crons, mcpServers, models, integrations, workflows] =
    await Promise.all([
      discoverSkills(hermesHome, disabledSkills),
      discoverCrons(hermesHome),
      Promise.resolve(discoverMcpServers(config)),
      discoverModels(hermesHome, config),
      discoverIntegrations(hermesHome, pathEnv, pathCliNames, config),
      discoverWorkflows(hermesHome),
    ]);

  return {
    exported_at: now().toISOString(),
    hermes_home: hermesHome,
    source: "hermes",
    skills,
    crons,
    mcp_servers: mcpServers,
    models,
    integrations,
    workflows,
  };
}

/**
 * List user-created workflow IR files under BACKEND_HOME/.lanyard/workflows
 * (and a plain workflows/ fallback). Residual: dedicated agent list RPC may
 * replace filesystem discovery later.
 */
export async function discoverWorkflows(
  hermesHome: string,
): Promise<SettingsWorkflow[]> {
  const candidateDirs = [
    {
      abs: path.join(hermesHome, ".lanyard", "workflows"),
      rel: ".lanyard/workflows",
    },
    {
      abs: path.join(hermesHome, "workflows"),
      rel: "workflows",
    },
  ];
  const byId = new Map<string, SettingsWorkflow>();

  for (const { abs, rel } of candidateDirs) {
    let names: string[];
    try {
      names = await readdir(abs);
    } catch {
      continue;
    }
    for (const base of names) {
      // Accept def files (yaml/json/md) or bare id names (directories).
      let id: string;
      let fileName: string;
      if (/\.(ya?ml|json|md)$/i.test(base)) {
        id = base.replace(/\.(ya?ml|json|md)$/i, "");
        fileName = base;
      } else if (!base.includes(".")) {
        // Directory or extension-less IR file named as the workflow id.
        id = base;
        fileName = base;
      } else {
        continue;
      }
      if (!id || byId.has(id)) continue;
      const absPath = path.join(abs, fileName);
      let updated_at: string | null = null;
      try {
        const st = await stat(absPath);
        updated_at = st.mtime.toISOString();
      } catch {
        continue;
      }
      byId.set(id, {
        id,
        name: id,
        path: `${rel}/${fileName}`,
        enabled: true,
        updated_at,
      });
    }
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

type HermesConfig = Record<string, unknown>;

async function readHermesConfig(hermesHome: string): Promise<HermesConfig> {
  const configPath = path.join(hermesHome, "config.yaml");
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = parseYaml(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as HermesConfig;
    }
  } catch {
    // Missing or invalid config is non-fatal for discovery.
  }
  return {};
}

function collectDisabledSkills(config: HermesConfig): Set<string> {
  const skills = asRecord(config.skills);
  const disabled = skills?.disabled;
  if (!Array.isArray(disabled)) {
    return new Set();
  }
  return new Set(
    disabled
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

async function discoverSkills(
  hermesHome: string,
  disabledSkills: Set<string>,
): Promise<SettingsSkill[]> {
  const skillsRoot = path.join(hermesHome, "skills");
  const skillFiles: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase() === "skill.md") {
        skillFiles.push(full);
      }
    }
  }

  await walk(skillsRoot);

  const skills: SettingsSkill[] = [];
  for (const skillFile of skillFiles.sort()) {
    const skillDir = path.dirname(skillFile);
    const relDir = path.relative(hermesHome, skillDir).split(path.sep).join("/");
    const folderName = path.basename(skillDir);
    let name = folderName;
    try {
      const text = await readFile(skillFile, "utf8");
      const fromFrontmatter = extractFrontmatterName(text);
      if (fromFrontmatter) {
        name = fromFrontmatter;
      }
    } catch {
      // keep folder name
    }

    const id = slugify(name) || slugify(folderName) || relDir;
    const enabled = !(
      disabledSkills.has(name) ||
      disabledSkills.has(folderName) ||
      disabledSkills.has(id)
    );

    skills.push({
      id,
      name,
      path: relDir,
      enabled,
    });
  }

  return skills;
}

function extractFrontmatterName(text: string): string | null {
  if (!text.startsWith("---")) {
    return null;
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) {
    return null;
  }
  const block = text.slice(3, end);
  const match = block.match(/^\s*name:\s*(.+)\s*$/m);
  if (!match?.[1]) {
    return null;
  }
  let value = match[1].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value || null;
}

async function discoverCrons(hermesHome: string): Promise<SettingsCron[]> {
  const jobsPath = path.join(hermesHome, "cron", "jobs.json");
  try {
    const raw = await readFile(jobsPath, "utf8");
    const parsed = JSON.parse(raw) as {
      jobs?: Array<Record<string, unknown>>;
    };
    const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
    return jobs.map((job, index) => {
      const id =
        (typeof job.id === "string" && job.id) ||
        (typeof job.name === "string" && slugify(job.name)) ||
        `cron-${index}`;
      const name =
        (typeof job.name === "string" && job.name) ||
        (typeof job.id === "string" && job.id) ||
        `Cron ${index + 1}`;
      const schedule = formatCronSchedule(job);
      const enabled = job.enabled !== false;
      const lastRunAt = pickTimestamp(job, [
        "last_run_at",
        "lastRunAt",
        "last_run",
        "lastRun",
        "last_execution_at",
      ]);
      const nextRunAt = pickTimestamp(job, [
        "next_run_at",
        "nextRunAt",
        "next_run",
        "nextRun",
        "next_execution_at",
      ]);
      return {
        id,
        name,
        schedule,
        path: "cron/jobs.json",
        enabled,
        last_run_at: lastRunAt,
        next_run_at: nextRunAt,
      };
    });
  } catch {
    return [];
  }
}

function pickTimestamp(
  job: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = job[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      // Assume seconds if small; milliseconds if large.
      const ms = value < 1e12 ? value * 1000 : value;
      return new Date(ms).toISOString();
    }
  }
  return null;
}

/**
 * Prefer schedule_display / display; otherwise humanize a 5-field cron expression.
 * Falls back to the raw expression when the pattern is uncommon.
 */
export function humanizeCronExpression(expr: string): string {
  const trimmed = expr.trim();
  if (!trimmed) return "—";

  // Already prose (contains letters beyond typical cron tokens).
  if (/[a-zA-Z]/.test(trimmed) && !/^(@\w+)/.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith("@")) {
    const nick: Record<string, string> = {
      "@yearly": "Yearly",
      "@annually": "Yearly",
      "@monthly": "Monthly",
      "@weekly": "Weekly",
      "@daily": "Daily",
      "@midnight": "Daily at midnight",
      "@hourly": "Hourly",
    };
    return nick[trimmed.toLowerCase()] ?? trimmed;
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length < 5) {
    return trimmed;
  }
  const [min, hour, dom, mon, dow] = parts;

  const everyMin = min.match(/^\*\/(\d+)$/);
  if (
    everyMin &&
    hour === "*" &&
    dom === "*" &&
    mon === "*" &&
    dow === "*"
  ) {
    const n = Number(everyMin[1]);
    if (n === 1) return "Every minute";
    return `Every ${n} minutes`;
  }

  if (min === "0" && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    return "Hourly";
  }

  if (
    /^\d+$/.test(min) &&
    hour === "*" &&
    dom === "*" &&
    mon === "*" &&
    dow === "*"
  ) {
    return `Hourly at :${min.padStart(2, "0")}`;
  }

  if (
    /^\d+$/.test(min) &&
    /^\d+$/.test(hour) &&
    dom === "*" &&
    mon === "*" &&
    dow === "*"
  ) {
    return `Daily at ${formatClock(hour, min)}`;
  }

  if (
    /^\d+$/.test(min) &&
    /^\d+$/.test(hour) &&
    dom === "*" &&
    mon === "*" &&
    dow !== "*"
  ) {
    return `Weekly on ${weekdayLabel(dow)} at ${formatClock(hour, min)}`;
  }

  if (
    /^\d+$/.test(min) &&
    /^\d+$/.test(hour) &&
    /^\d+$/.test(dom) &&
    mon === "*" &&
    dow === "*"
  ) {
    return `Monthly on day ${dom} at ${formatClock(hour, min)}`;
  }

  return trimmed;
}

function formatClock(hour: string, min: string): string {
  const h = Number(hour);
  const m = Number(min);
  if (!Number.isFinite(h) || !Number.isFinite(m)) {
    return `${hour}:${min.padStart(2, "0")}`;
  }
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function weekdayLabel(dow: string): string {
  const names = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  if (/^\d+$/.test(dow)) {
    const n = Number(dow) % 7;
    return names[n] ?? dow;
  }
  const map: Record<string, string> = {
    sun: "Sunday",
    mon: "Monday",
    tue: "Tuesday",
    wed: "Wednesday",
    thu: "Thursday",
    fri: "Friday",
    sat: "Saturday",
  };
  return map[dow.toLowerCase()] ?? dow;
}

function formatCronSchedule(job: Record<string, unknown>): string {
  if (typeof job.schedule_display === "string" && job.schedule_display.trim()) {
    const display = job.schedule_display.trim();
    // schedule_display may still be a raw cron expression — humanize when so.
    return humanizeCronExpression(display);
  }
  const schedule = job.schedule;
  if (typeof schedule === "string") {
    return humanizeCronExpression(schedule);
  }
  if (schedule && typeof schedule === "object" && !Array.isArray(schedule)) {
    const rec = schedule as Record<string, unknown>;
    if (typeof rec.display === "string" && rec.display.trim()) {
      return humanizeCronExpression(rec.display.trim());
    }
    if (typeof rec.expr === "string" && rec.expr.trim()) {
      return humanizeCronExpression(rec.expr.trim());
    }
    if (typeof rec.kind === "string" && rec.kind.trim()) {
      return rec.kind.trim();
    }
  }
  return "—";
}

function discoverMcpServers(config: HermesConfig): Array<
  SettingsMcpServer & Record<string, unknown>
> {
  const servers = asRecord(config.mcp_servers);
  if (!servers) {
    return [];
  }

  const results: Array<SettingsMcpServer & Record<string, unknown>> = [];
  for (const [name, value] of Object.entries(servers)) {
    const rec = asRecord(value) ?? {};
    const transport = inferMcpTransport(rec);
    const command = pickString(rec, ["command", "cmd", "bin"]);
    const url = pickString(rec, ["url", "endpoint"]);
    const entry: SettingsMcpServer & Record<string, unknown> = {
      name,
      transport,
    };
    if (command) {
      entry.command = command;
    } else if (url) {
      // URL is not a secret; useful for operators. Do not copy headers/auth.
      entry.command = url;
    }
    if (rec.enabled === false) {
      entry.enabled = false;
    }
    results.push(entry);
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

function inferMcpTransport(rec: Record<string, unknown>): string {
  const explicit = pickString(rec, ["transport", "type"]);
  if (explicit) {
    return explicit;
  }
  if (pickString(rec, ["command", "cmd", "bin"])) {
    return "stdio";
  }
  if (pickString(rec, ["url", "endpoint"])) {
    return "http";
  }
  return "unknown";
}

async function discoverModels(
  hermesHome: string,
  config: HermesConfig,
): Promise<Array<SettingsModel & Record<string, unknown>>> {
  const connectedProviders = await readConnectedProviders(hermesHome, config);
  const connectedSet = new Set(
    connectedProviders.flatMap((p) => [p, normalizeProvider(p)]),
  );

  const modelSection = asRecord(config.model);
  const activeProvider =
    (modelSection ? pickString(modelSection, ["provider"]) : null) ??
    connectedProviders[0] ??
    null;
  const activeModel = modelSection
    ? pickString(modelSection, ["default", "model"])
    : null;

  type ModelEntry = SettingsModel & Record<string, unknown>;
  const models: ModelEntry[] = [];
  const seen = new Set<string>();

  const push = (provider: string, model: string) => {
    const p = provider.trim();
    const m = model.trim();
    if (!p || !m) return;
    const key = `${p}::${m}`;
    if (seen.has(key)) return;
    seen.add(key);
    const isActive =
      Boolean(activeProvider && activeModel) &&
      p === activeProvider &&
      m === activeModel;
    const connected =
      connectedSet.has(p) || connectedSet.has(normalizeProvider(p));
    models.push({
      provider: p,
      model: m,
      is_active: isActive,
      connected,
    });
  };

  if (modelSection) {
    const provider = activeProvider ?? "default";
    if (activeModel) {
      push(provider, activeModel);
    }
  }

  const providers = asRecord(config.providers);
  if (providers) {
    for (const [providerName, value] of Object.entries(providers)) {
      const rec = asRecord(value);
      const model = rec ? pickString(rec, ["model", "default"]) : null;
      if (model) {
        push(providerName, model);
      }
    }
  }

  const fallback = asRecord(config.fallback_providers);
  if (fallback) {
    const provider = pickString(fallback, ["provider"]) ?? "fallback";
    const model = pickString(fallback, ["model"]);
    if (model) {
      push(provider, model);
    }
  }

  // Connected provider model catalogs (no API keys).
  const catalog = await readProviderModelsCache(hermesHome);
  for (const provider of connectedProviders) {
    const list = catalog.get(provider) ?? catalog.get(normalizeProvider(provider));
    if (!list) continue;
    // Cap per provider so the UI stays usable.
    for (const model of list.slice(0, 40)) {
      push(provider, model);
    }
  }

  return models;
}

async function readConnectedProviders(
  hermesHome: string,
  config: HermesConfig,
): Promise<string[]> {
  const names = new Set<string>();

  const modelSection = asRecord(config.model);
  const primary = modelSection
    ? pickString(modelSection, ["provider"])
    : null;
  if (primary) names.add(primary);

  const providers = asRecord(config.providers);
  if (providers) {
    for (const key of Object.keys(providers)) {
      names.add(key);
    }
  }

  const fallback = asRecord(config.fallback_providers);
  const fallbackProvider = fallback
    ? pickString(fallback, ["provider"])
    : null;
  if (fallbackProvider) names.add(fallbackProvider);

  try {
    const authRaw = await readFile(path.join(hermesHome, "auth.json"), "utf8");
    const auth = JSON.parse(authRaw) as Record<string, unknown>;
    if (typeof auth.active_provider === "string" && auth.active_provider) {
      names.add(auth.active_provider);
    }
    const authProviders = asRecord(auth.providers);
    if (authProviders) {
      for (const key of Object.keys(authProviders)) {
        names.add(key);
      }
    }
    const pool = asRecord(auth.credential_pool);
    if (pool) {
      for (const key of Object.keys(pool)) {
        // Skip corrupted / binary-tainted keys.
        if (/[\x00-\x1f]/.test(key)) continue;
        names.add(key);
      }
    }
  } catch {
    // optional
  }

  return [...names].sort();
}

async function readProviderModelsCache(
  hermesHome: string,
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const candidates = [
    path.join(hermesHome, "provider_models_cache.json"),
    path.join(hermesHome, "cache", "model_catalog.json"),
  ];

  for (const file of candidates) {
    try {
      const raw = await readFile(file, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (file.endsWith("provider_models_cache.json")) {
        const rec = asRecord(parsed);
        if (!rec) continue;
        for (const [provider, value] of Object.entries(rec)) {
          const entry = asRecord(value);
          const models = entry?.models;
          if (Array.isArray(models)) {
            map.set(
              provider,
              models.filter((m): m is string => typeof m === "string"),
            );
          } else if (models && typeof models === "object") {
            map.set(provider, Object.keys(models as Record<string, unknown>));
          }
        }
      } else {
        // model_catalog.json: { providers: { name: { models: ... } } }
        const rec = asRecord(parsed);
        const providers = asRecord(rec?.providers);
        if (!providers) continue;
        for (const [provider, value] of Object.entries(providers)) {
          const entry = asRecord(value);
          const models = entry?.models;
          if (Array.isArray(models)) {
            const ids = models
              .map((m) => {
                if (typeof m === "string") return m;
                const mr = asRecord(m);
                return mr
                  ? pickString(mr, ["id", "model", "name"])
                  : null;
              })
              .filter((m): m is string => Boolean(m));
            if (ids.length) map.set(provider, ids);
          }
        }
      }
    } catch {
      // optional cache
    }
  }

  return map;
}

function normalizeProvider(name: string): string {
  return name.replace(/-oauth$/i, "").replace(/-api$/i, "");
}

async function discoverIntegrations(
  hermesHome: string,
  pathEnv: string,
  pathCliNames: readonly string[],
  config: HermesConfig,
): Promise<SettingsIntegration[]> {
  const integrations: SettingsIntegration[] = [];
  const seen = new Set<string>();

  const push = (item: SettingsIntegration) => {
    const id = item.id || slugify(item.name);
    if (!id || seen.has(id)) return;
    seen.add(id);
    integrations.push({ ...item, id });
  };

  // Hermes local bin tools
  const binDir = path.join(hermesHome, "bin");
  try {
    const entries = await readdir(binDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      const full = path.join(binDir, entry.name);
      if (!(await isExecutable(full))) continue;
      push({
        id: slugify(entry.name),
        name: entry.name,
        type: "cli",
        bin: entry.name,
        path: full,
      });
    }
  } catch {
    // optional
  }

  // PATH CLIs
  for (const bin of pathCliNames) {
    const resolved = whichOnPath(bin, pathEnv);
    if (!resolved) continue;
    push({
      id: slugify(bin),
      name: bin,
      type: "cli",
      bin,
      path: resolved,
    });
  }

  // MCP server commands as configured tools
  const servers = asRecord(config.mcp_servers);
  if (servers) {
    for (const [name, value] of Object.entries(servers)) {
      const rec = asRecord(value) ?? {};
      const command = pickString(rec, ["command", "cmd", "bin"]);
      if (command) {
        const bin = command.split(/\s+/)[0] ?? command;
        const resolved = path.isAbsolute(bin)
          ? bin
          : whichOnPath(bin, pathEnv);
        push({
          id: `mcp-${slugify(name)}`,
          name,
          type: "mcp",
          bin,
          path: resolved ?? undefined,
        });
      } else {
        push({
          id: `mcp-${slugify(name)}`,
          name,
          type: "mcp",
        });
      }
    }
  }

  // known_plugin_toolsets.cli entries
  const known = asRecord(config.known_plugin_toolsets);
  const cliPlugins = known?.cli;
  if (Array.isArray(cliPlugins)) {
    for (const plugin of cliPlugins) {
      if (typeof plugin !== "string" || !plugin.trim()) continue;
      const bin = plugin.trim();
      const resolved = whichOnPath(bin, pathEnv);
      push({
        id: slugify(bin),
        name: bin,
        type: "cli",
        bin,
        path: resolved ?? undefined,
      });
    }
  }

  return integrations.sort((a, b) => a.name.localeCompare(b.name));
}

function whichOnPath(bin: string, pathEnv: string): string | null {
  if (!bin || bin.includes("/") || bin.includes("\\")) {
    return null;
  }
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, bin);
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function pickString(
  rec: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
