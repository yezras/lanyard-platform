#!/usr/bin/env node
/**
 * Local LA harness for Muse Spark via the LiteLLM provider client (lp-k5c4.17).
 *
 * Replaces the lp-k5c4.13 /tmp harness wrapper. That file forked a Meta
 * complete() fetch because LITELLM_BASE_URL included `/v1` and LiteLlmClient
 * posted `/v1/v1/chat/completions` (404, empty turns). This file does not
 * fetch api.meta.ai itself.
 *
 * Contract:
 *   LITELLM_BASE_URL=https://api.meta.ai   (no trailing /v1)
 *   LITELLM_API_KEY or META_API_KEY
 *   HARNESS_MODEL=muse-spark-1.2-contributor
 *
 * Keys: ~/.lanyard-agent/meta.env (mode 600). Never log them.
 * Not a Portal/BFF gateway.
 */
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  applyMuseSparkLiteLlmEnv,
  bindEnvLiteLlmTurnRunner,
} from "./litellm-base-url.mjs";

export { applyMuseSparkLiteLlmEnv, bindEnvLiteLlmTurnRunner };

export const SCHEDULED_TASK_CREATE_TOOL_NAME = "scheduled_task.create";
export const SCHEDULED_TASK_TOOL_NAME = "scheduled_task";

export const LOCALHOST_CONTROL_PLANE_URL = "http://127.0.0.1:3100";
export const LOCALHOST_CONTROL_PLANE_SERVICE_TOKEN =
  "placeholder-control-plane-service-token";

/** Host schema Bill is told to use. BFF hops this onto POST /api/settings/crons. */
export const HOST_SCHEDULED_TASK_CREATE_TOOL = {
  type: "function",
  function: {
    name: SCHEDULED_TASK_CREATE_TOOL_NAME,
    description:
      "Create a scheduled task (cron / every N minutes). Host persists the job under Scheduled Tasks. Do not use bash.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["name", "prompt", "schedule"],
      properties: {
        name: { type: "string", minLength: 1, description: "Job name." },
        prompt: {
          type: "string",
          minLength: 1,
          description: "Task prompt to run on schedule.",
        },
        schedule: {
          type: "string",
          minLength: 1,
          description: "Cron expression (e.g. * * * * *) or every-N string.",
        },
        enabled: { type: "boolean", description: "Default true." },
      },
    },
  },
};

function fail(message) {
  console.error(`[muse-spark-harness] ${message}`);
  process.exit(1);
}

export function resolveHarnessModule(env = process.env) {
  const requested = env.HARNESS_MODULE?.trim();
  const agentRoot = env.LANYARD_AGENT_ROOT?.trim();
  const candidates = [];
  if (requested) candidates.push(requested);
  if (agentRoot) {
    candidates.push(
      `${agentRoot}/packages/adapters-portal/dist/harness/index.js`,
      `${agentRoot}/packages/adapters-portal/dist/index.js`,
    );
  }
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return "";
}

function isTurnRunner(value) {
  return Boolean(value) && typeof value === "object" && typeof value.run === "function";
}

function readEnvTrim(env, key) {
  const raw = env?.[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : "";
}

function parseDemoEnvAssignments(text) {
  const out = {};
  if (typeof text !== "string" || !text.trim()) return out;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(
      /^(?:export\s+)?(CONTROL_PLANE_URL|CONTROL_PLANE_SERVICE_TOKEN)=(.*)$/,
    );
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) out[match[1]] = value;
  }
  return out;
}

export function readLocalhostDemoEnv(env = process.env) {
  const candidates = [
    readEnvTrim(env, "LANYARD_DEMO_ENV"),
    readEnvTrim(env, "DEMO_ENV_PATH"),
    "portal/.data/demo-env.sh",
    ".data/demo-env.sh",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      return parseDemoEnvAssignments(readFileSync(candidate, "utf8"));
    } catch {
      /* unreadable demo-env is not fatal */
    }
  }
  return {};
}

/**
 * LA registers `scheduled_task` only when CONTROL_PLANE_URL +
 * CONTROL_PLANE_SERVICE_TOKEN are set. Fill from env, demo-env, harness
 * token, then localhost defaults. Never log values.
 */
export function applyLocalhostScheduledTaskEnv(env = process.env) {
  const next = { ...env };
  const demo = readLocalhostDemoEnv(next);
  if (!readEnvTrim(next, "CONTROL_PLANE_URL")) {
    next.CONTROL_PLANE_URL =
      demo.CONTROL_PLANE_URL || LOCALHOST_CONTROL_PLANE_URL;
  }
  if (!readEnvTrim(next, "CONTROL_PLANE_SERVICE_TOKEN")) {
    next.CONTROL_PLANE_SERVICE_TOKEN =
      demo.CONTROL_PLANE_SERVICE_TOKEN ||
      readEnvTrim(next, "LANYARD_HARNESS_SERVICE_TOKEN") ||
      readEnvTrim(next, "HARNESS_SERVICE_TOKEN") ||
      LOCALHOST_CONTROL_PLANE_SERVICE_TOKEN;
  }
  return next;
}

export function scheduledTaskToolNames(tools = []) {
  return (Array.isArray(tools) ? tools : [])
    .map((tool) => tool?.function?.name)
    .filter((name) => typeof name === "string" && name.trim());
}

export function hasScheduledTaskTool(tools = []) {
  const names = new Set(scheduledTaskToolNames(tools));
  return (
    names.has(SCHEDULED_TASK_CREATE_TOOL_NAME) ||
    names.has(SCHEDULED_TASK_TOOL_NAME)
  );
}

export function ensureScheduledTaskTools(tools = []) {
  const list = Array.isArray(tools) ? [...tools] : [];
  if (hasScheduledTaskTool(list)) return list;
  list.push(HOST_SCHEDULED_TASK_CREATE_TOOL);
  return list;
}

export function advertisedScheduledTaskToolNames(runner) {
  const fromRunner = [
    ...(Array.isArray(runner?.toolNames) ? runner.toolNames : []),
    ...scheduledTaskToolNames(runner?.tools),
  ].filter(Boolean);
  const ensured = scheduledTaskToolNames(
    ensureScheduledTaskTools(
      fromRunner.map((name) => ({ type: "function", function: { name } })),
    ),
  );
  return [...new Set(ensured)];
}

function attachScheduledTaskTools(runner) {
  const tools = ensureScheduledTaskTools(runner?.tools ?? []);
  const toolNames = advertisedScheduledTaskToolNames({ ...runner, tools });
  return {
    ...runner,
    tools,
    toolNames,
    run:
      typeof runner.run === "function"
        ? (...args) => runner.run(...args)
        : runner.run,
  };
}

/**
 * Prefer createEnvToolsTurnRunner when the LA dist exports it so host tools
 * (scheduled_task / scheduled_task.create) are advertised. complete is never passed
 * — LiteLlmClient.complete() owns the HTTP.
 *
 * LA registers `scheduled_task` when CONTROL_PLANE_URL + token are set
 * (lp-oop.38.16). This bind fills those from demo-env / localhost defaults
 * and injects the host schema when the runner tools list lacks them.
 * Tools-runner failure does not silently fall back to LiteLLM.
 */
export async function startMuseSparkHarness(options = {}) {
  const env = applyLocalhostScheduledTaskEnv(
    applyMuseSparkLiteLlmEnv(options.env ?? process.env),
  );
  const modulePath = options.modulePath ?? resolveHarnessModule(env);
  if (!modulePath) {
    fail(
      "set LANYARD_AGENT_ROOT (or HARNESS_MODULE) to a built adapters-portal dist",
    );
  }

  const mod = options.mod ?? (await import(pathToFileURL(modulePath).href));
  if (typeof mod.createHarnessTurnServer !== "function") {
    fail("createHarnessTurnServer not exported (need LA PR 242+)");
  }

  let runner = null;
  let runnerKind = "litellm";
  if (typeof mod.createEnvToolsTurnRunner === "function") {
    let built;
    try {
      built = await mod.createEnvToolsTurnRunner(env, {
        backendHome: env.BACKEND_HOME,
      });
    } catch (err) {
      throw new Error(
        `createEnvToolsTurnRunner failed (not falling back to LiteLLM): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    if (!isTurnRunner(built)) {
      throw new Error(
        "createEnvToolsTurnRunner did not return { run } (not falling back to LiteLLM)",
      );
    }
    runner = attachScheduledTaskTools(built);
    runnerKind = "tools";
  }
  if (!runner) {
    if (typeof mod.createEnvLiteLlmTurnRunner !== "function") {
      fail("createEnvLiteLlmTurnRunner not exported (need LA LiteLLM runner)");
    }
    const bound = bindEnvLiteLlmTurnRunner(mod.createEnvLiteLlmTurnRunner, env);
    runner = bound.runner;
    runnerKind = "litellm";
  }
  if (!runner || typeof runner.run !== "function") {
    fail("LITELLM_BASE_URL + LITELLM_API_KEY/MASTER_KEY required");
  }

  const port = Number(env.LANYARD_HARNESS_PORT ?? env.HARNESS_PORT ?? 4310);
  const host = env.HARNESS_HOST || "127.0.0.1";
  const serviceToken =
    env.LANYARD_HARNESS_SERVICE_TOKEN ||
    env.HARNESS_SERVICE_TOKEN ||
    "placeholder-harness-service-token";

  const settingsSnapshot =
    typeof mod.createEnvHarnessSettingsLoader === "function"
      ? mod.createEnvHarnessSettingsLoader(env)
      : undefined;

  const server = mod.createHarnessTurnServer({
    host,
    port,
    serviceToken,
    runner,
    ...(settingsSnapshot ? { settingsSnapshot } : {}),
  });
  await server.start();
  const bound = server.boundPort ?? port;
  return {
    server,
    host,
    port: bound,
    url: `http://${host}:${bound}`,
    model: env.HARNESS_MODEL ?? env.LANYARD_DEFAULT_MODEL ?? null,
    baseUrl: env.LITELLM_BASE_URL,
    runnerKind,
    toolNames:
      runnerKind === "tools" ? advertisedScheduledTaskToolNames(runner) : [],
  };
}

async function main() {
  const started = await startMuseSparkHarness();
  console.log(
    JSON.stringify({
      ok: true,
      service: "lanyard-agent-harness",
      kind: "createHarnessTurnServer",
      runner: started.runnerKind ?? "litellm",
      tools: started.toolNames ?? [],
      complete: null,
      model: started.model,
      litellm_base_url: started.baseUrl,
      url: started.url,
    }),
  );

  const stop = async () => {
    try {
      await started.server.stop();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
