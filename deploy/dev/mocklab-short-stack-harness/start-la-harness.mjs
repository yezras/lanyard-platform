#!/usr/bin/env node
/**
 * Start LA createHarnessTurnServer (lp-oop.37.4).
 *
 * Thin wrapper — not an agent. Requires a built @lanyard-agent/adapters-portal
 * that exports createHarnessTurnServer, spawn_subagent (PR 253, pin 2477b22),
 * memory_read (PR 252, pin c41aca0 stacked on that spawn SHA),
 * and workflow (PR 259, pin 4a5a0fe).
 *
 * Optional runner (lp-oop.38.2): prefer a tools factory if present
 * (createEnvToolsTurnRunner / createAgentCoreTurnRunner, or
 * create.*Tools.*TurnRunner / create.*AgentCore.*TurnRunner — never
 * no-tools). If it returns { run }, pass it and log runner=tools.
 * Missing/null/throw falls back to createEnvLiteLlmTurnRunner
 * (runner=litellm). If that is also missing, bind createToolsTurnRunner
 * with a lab complete that calls search_tool then use_tool on vault_fs
 * (runner=tools-lab) so local UI QA is not echo:. Server default remains
 * createEchoTurnRunner only when the lab bind is also absent.
 *
 * lp-oop.38.16: the tools runner registers scheduled_task when
 * CONTROL_PLANE_URL + CONTROL_PLANE_SERVICE_TOKEN are set. Create writes
 * vault cron/jobs.json via CP HTTP (same store fire reads). No guest ticker.
 * Live SCHEDULE_EVALUATOR_ENABLED stays an operator residual.
 *
 * Token from HARNESS_SERVICE_TOKEN / LANYARD_HARNESS_SERVICE_TOKEN only
 * (ECS secrets map in live). Never log the value or provider keys.
 *
 * Seed `$BACKEND_HOME/config.yaml` `subagents.enabled` before binding the
 * tools factory with `{ backendHome }` (lp-oop.38.14). Spawn schemas come
 * from LA 2477b22; config seed cannot advertise a missing export.
 * Image bake sets HARNESS_REQUIRE_SPAWN=1 so a file/bash-only dist fails
 * boot instead of serving SPAWN_TOOL_MISSING.
 *
 * memory_read is on by default (lp-oop.38.13). Fargate has no guest
 * config.yaml. Execute is toolbox argv against /mnt/vault/mempalace.
 * Image bake sets HARNESS_REQUIRE_MEMORY=1 so a spawn-only dist fails
 * boot instead of serving TOOL_NOT_AVAILABLE. Do not run mempalace
 * on this host.
 *
 * MCP catalog (lp-oop.38.17): merge secret-free lab_echo into
 * BACKEND_HOME/config.yaml (fill-missing) before the tools factory binds.
 * Tools snapshot and use_tool read that document. Do not dump MCP secrets
 * into guest create-env.
 *
 * MCP catalog (lp-oop.38.19): fill-missing-merge secret-free vault_fs
 * (requires_vault, cwd /mnt/vault) into BACKEND_HOME/config.yaml *before*
 * the tools factory binds. The stdio binary lives on Daytona /mnt/vault.
 */
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { ensureHarnessSubagentsConfig, resolveHarnessBackendHome } from "./ensure-subagents-config.mjs";
import {
  DEFAULT_LAB_ECHO_SERVER,
  ensureLabEchoMcpConfig,
} from "./merge-lab-echo-mcp.mjs";
import { ensureVaultFsMcpConfig } from "./merge-vault-fs-mcp.mjs";

const HARNESS_SUBTREE =
  "/opt/lanyard-agent/packages/adapters-portal/dist/harness/index.js";

const TOOLS_FACTORY_NAMES = [
  "createEnvToolsTurnRunner",
  "createAgentCoreTurnRunner",
];

const LITELLM_FACTORY_NAMES = [
  "createEnvLiteLlmTurnRunner",
  "createEnvLiteLLMTurnRunner",
  "createLiteLlmTurnRunner",
];
// LiteLLM bind is factory(env) only. Do not pass complete — Meta/Muse Spark
// uses LiteLlmClient (LITELLM_BASE_URL=https://api.meta.ai, no trailing /v1).

function isPackageRootIndex(p) {
  return typeof p === "string" && /(?:^|\/)packages\/adapters-portal\/dist\/index\.js$/.test(p);
}

function remapPackageRoot(p) {
  if (!isPackageRootIndex(p)) return p;
  const sibling = p.replace(/index\.js$/, "harness/index.js");
  if (existsSync(sibling)) return sibling;
  return HARNESS_SUBTREE;
}

function isTurnRunner(value) {
  return Boolean(value) && typeof value === "object" && typeof value.run === "function";
}

function createLabVaultMcpComplete() {
  let round = 0;
  return async (input) => {
    round += 1;
    const names = new Set(
      (input?.tools ?? []).map((tool) => tool?.function?.name).filter(Boolean),
    );
    if (names.has("search_tool") && names.has("use_tool")) {
      if (round === 1) {
        return {
          tool_calls: [
            {
              id: "lab_search_vault_fs",
              type: "function",
              function: {
                name: "search_tool",
                arguments: JSON.stringify({ query: "vault_fs" }),
              },
            },
          ],
        };
      }
      if (round === 2) {
        return {
          tool_calls: [
            {
              id: "lab_use_vault_fs",
              type: "function",
              function: {
                name: "use_tool",
                arguments: JSON.stringify({
                  toolName: "mcp__vault_fs__list_vault",
                  toolInput: {},
                }),
              },
            },
          ],
        };
      }
    }
    const toolMsg = (input?.messages ?? []).find((row) => row?.role === "tool");
    const text =
      typeof toolMsg?.content === "string" && toolMsg.content.trim()
        ? toolMsg.content
        : "vault MCP session bound";
    return { content: text };
  };
}

function bindLabVaultMcpRunner(mod, backendHome) {
  if (typeof mod.createToolsTurnRunner !== "function") return null;
  let vaultSession;
  if (typeof mod.createEnvDaytonaToolboxSessionClient === "function") {
    try {
      vaultSession = mod.createEnvDaytonaToolboxSessionClient();
    } catch {
      vaultSession = undefined;
    }
  }
  if (!vaultSession && typeof mod.FakeToolboxProcessSession === "function") {
    const handler =
      typeof mod.fakeVaultMcpJsonRpcHandler === "function"
        ? mod.fakeVaultMcpJsonRpcHandler({
            toolName: "list_vault",
            callResult: {
              content: [{ type: "text", text: "/mnt/vault/AGENTS.md" }],
            },
          })
        : undefined;
    vaultSession = new mod.FakeToolboxProcessSession(
      handler ? { jsonRpcHandler: handler } : {},
    );
  }
  if (!vaultSession) return null;
  const built = mod.createToolsTurnRunner({
    complete: createLabVaultMcpComplete(),
    model: "lab-vault-mcp",
    vaultSession,
    ...(backendHome ? { backendHome } : {}),
  });
  return isTurnRunner(built) ? built : null;
}

function isNoToolsFactoryName(name) {
  return /no.?tools/i.test(name);
}

function findNamedFactory(mod, names, regex) {
  for (const name of names) {
    const fn = mod[name];
    if (typeof fn === "function") return fn;
  }
  for (const [name, value] of Object.entries(mod)) {
    if (typeof value === "function" && regex.test(name) && !isNoToolsFactoryName(name)) {
      return value;
    }
  }
  return null;
}

function toolsTurnRunnerFactory(mod) {
  return findNamedFactory(
    mod,
    TOOLS_FACTORY_NAMES,
    /create.*(?:Tools|AgentCore).*TurnRunner/i,
  );
}

function envLiteLlmTurnRunnerFactory(mod) {
  return findNamedFactory(
    mod,
    LITELLM_FACTORY_NAMES,
    /create.*LiteLlm.*TurnRunner/i,
  );
}

function requireSpawnSchemas(env = process.env) {
  return /^(1|true|yes)$/i.test(String(env.HARNESS_REQUIRE_SPAWN || "").trim());
}

function requireMemorySchemas(env = process.env) {
  return /^(1|true|yes)$/i.test(String(env.HARNESS_REQUIRE_MEMORY || "").trim());
}

function logMcpMerge(name, mcp) {
  if (mcp.changed) {
    console.log(`[start-la-harness] mcp=${name} (merged into BACKEND_HOME)`);
  } else if (mcp.present) {
    console.log(`[start-la-harness] mcp=${name}`);
  } else if (mcp.skipped && mcp.skipped !== "no_binary") {
    console.log(`[start-la-harness] mcp=${name} skipped=${mcp.skipped}`);
  }
}

// Slim image cannot load package-root dist/index.js (re-exports gateway-core + ws).
const requested = process.env.HARNESS_MODULE;
const moduleHint = !requested ? HARNESS_SUBTREE : remapPackageRoot(requested);

const candidates = [moduleHint, HARNESS_SUBTREE].filter(
  (p, i, arr) => Boolean(p) && arr.indexOf(p) === i,
);

let modulePath = "";
for (const candidate of candidates) {
  if (existsSync(candidate)) {
    modulePath = candidate;
    break;
  }
}

if (!modulePath) {
  console.error(
    "[start-la-harness] missing adapters-portal dist (build lanyard-agent at PR 252 SHA c41aca0 stacked on 2477b22)",
  );
  process.exit(1);
}

const mod = await import(pathToFileURL(modulePath).href);
if (typeof mod.createHarnessTurnServer !== "function") {
  console.error(
    "[start-la-harness] createHarnessTurnServer not exported (need LA PR 242+)",
  );
  process.exit(1);
}

const spawnToolName =
  typeof mod.SPAWN_SUBAGENT_TOOL_NAME === "string"
    ? mod.SPAWN_SUBAGENT_TOOL_NAME
    : "";
if (spawnToolName === "spawn_subagent") {
  console.log("[start-la-harness] spawn_schemas=present");
  console.log(`[start-la-harness] spawn_tool=${spawnToolName}`);
} else {
  console.error(
    "[start-la-harness] spawn_schemas=missing (need LA PR 252 SHA c41aca0 stacked on 2477b22; ad0ef5a is file/bash only)",
  );
  if (requireSpawnSchemas()) {
    process.exit(1);
  }
}

const memoryToolName =
  typeof mod.MEMORY_READ_TOOL_NAME === "string"
    ? mod.MEMORY_READ_TOOL_NAME
    : "";
if (memoryToolName === "memory_read") {
  console.log("[start-la-harness] memory_read=present");
} else {
  console.error(
    "[start-la-harness] memory_read=missing (need LA PR 252 SHA c41aca0; live 2477b22 is spawn-only)",
  );
  if (requireMemorySchemas()) {
    process.exit(1);
  }
}

const host = process.env.HARNESS_HOST || "0.0.0.0";
const port = Number(process.env.HARNESS_PORT || 8080);
const serviceToken =
  process.env.LANYARD_HARNESS_SERVICE_TOKEN ||
  process.env.HARNESS_SERVICE_TOKEN ||
  "";

if (!serviceToken) {
  console.error(
    "[start-la-harness] HARNESS_SERVICE_TOKEN / LANYARD_HARNESS_SERVICE_TOKEN is empty",
  );
  process.exit(1);
}

const backendHome = resolveHarnessBackendHome(process.env);
process.env.BACKEND_HOME = backendHome;
const subagents = await ensureHarnessSubagentsConfig(backendHome);
if (subagents.error) {
  console.error(`[start-la-harness] subagents_seed_error=${subagents.error}`);
}
console.log(`[start-la-harness] subagents=${subagents.enabled ? "enabled" : "disabled"}`);
if (subagents.wrote) {
  console.log("[start-la-harness] subagents_seed=mocklab-v1");
}
const labEchoServer =
  process.env.LANYARD_LAB_MCP_SERVER || DEFAULT_LAB_ECHO_SERVER;
if (backendHome) {
  const labEcho = ensureLabEchoMcpConfig({
    backendHome,
    serverPath: labEchoServer,
  });
  logMcpMerge("lab_echo", labEcho);
  const vaultFs = ensureVaultFsMcpConfig({ backendHome });
  logMcpMerge("vault_fs", vaultFs);
}

let runner;
let runnerKind = "echo";
const toolsFactory = toolsTurnRunnerFactory(mod);
if (typeof toolsFactory === "function") {
  try {
    const built = await toolsFactory(process.env, { backendHome });
    if (isTurnRunner(built)) {
      runner = built;
      runnerKind = "tools";
    }
  } catch {
    // Tools factory present but env/config failed. Try LiteLLM, then echo.
  }
}
if (!runner) {
  const factory = envLiteLlmTurnRunnerFactory(mod);
  if (typeof factory === "function") {
    try {
      const built = await factory();
      if (isTurnRunner(built)) {
        runner = built;
        runnerKind = "litellm";
      }
    } catch {
      // Factory present but env/config failed. Try lab vault MCP, then echo.
      console.error("[start-la-harness] env runner factory failed; trying tools-lab");
    }
  }
}
if (!runner) {
  try {
    const lab = bindLabVaultMcpRunner(mod, backendHome);
    if (isTurnRunner(lab)) {
      runner = lab;
      runnerKind = "tools-lab";
    }
  } catch {
    // Lab bind missing FakeToolboxProcessSession / createToolsTurnRunner.
  }
}

const loaderEnv = { ...process.env, BACKEND_HOME: backendHome };
const settingsSnapshot =
  typeof mod.createEnvHarnessSettingsLoader === "function"
    ? mod.createEnvHarnessSettingsLoader(loaderEnv)
    : undefined;

const server = mod.createHarnessTurnServer({
  host,
  port,
  serviceToken,
  ...(runner ? { runner } : {}),
  ...(settingsSnapshot ? { settingsSnapshot } : {}),
  ...(backendHome ? { backendHome } : {}),
});
await server.start();
const bound = server.boundPort ?? port;
console.log(`[start-la-harness] listening http://${host}:${bound}`);
console.log("[start-la-harness] kind=createHarnessTurnServer");
console.log(`[start-la-harness] runner=${runnerKind}`);
console.log(`[start-la-harness] BACKEND_HOME=${backendHome}`);

const stop = async () => {
  try {
    await server.stop();
  } finally {
    process.exit(0);
  }
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
