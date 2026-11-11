/**
 * Materialize MockLab v1 `subagents.enabled` on the harness BACKEND_HOME.
 *
 * LA createEnvToolsTurnRunner advertises spawn_subagent only when
 * `$BACKEND_HOME/config.yaml` has that flag. File tools are always on.
 * Live MockLab had no such file, so forced-spawn turns used bash instead.
 *
 * Does not clobber an existing `subagents.enabled` (true or false).
 * Kitchen-sink overlay is lp-oop.38.18 (`/var/lib/lanyard-backend`).
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const DEFAULT_HARNESS_BACKEND_HOME = "/var/lib/lanyard-agent";
export const KITCHEN_SINK_BACKEND_HOME = "/var/lib/lanyard-backend";

export const MOCKLAB_V1_SUBAGENTS_YAML = [
  "subagents:",
  "  enabled: true",
  "  default_isolation: none",
  "  max_depth: 1",
  "",
].join("\n");

/**
 * @param {NodeJS.Dict<string>} [env]
 * @param {{ exists?: (path: string) => boolean }} [io]
 */
export function resolveHarnessBackendHome(env = process.env, io = {}) {
  const exists = typeof io.exists === "function" ? io.exists : existsSync;
  const raw = String(env.BACKEND_HOME || env.LANYARD_BACKEND_HOME || "").trim();
  if (raw) return raw.replace(/\/$/, "");
  // 38.18 bakes kitchen-sink here. Prefer it over an empty spawn-only home.
  if (exists(join(KITCHEN_SINK_BACKEND_HOME, "config.yaml"))) {
    return KITCHEN_SINK_BACKEND_HOME;
  }
  return DEFAULT_HARNESS_BACKEND_HOME;
}

/**
 * @param {string} text
 * @returns {boolean | null} true/false when the key is present, else null
 */
export function subagentsEnabledFromYaml(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  let inBlock = false;
  for (const line of lines) {
    if (/^subagents:\s*(?:#.*)?$/.test(line)) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    if (/^[A-Za-z_]/.test(line)) break;
    const m = line.match(/^\s+enabled:\s*(true|false)\s*(?:#.*)?$/i);
    if (m) return m[1].toLowerCase() === "true";
  }
  return null;
}

/**
 * @param {string} backendHome
 * @returns {Promise<{
 *   backendHome: string,
 *   enabled: boolean,
 *   wrote: boolean,
 *   error?: string,
 * }>}
 */
export async function ensureHarnessSubagentsConfig(backendHome) {
  const home = String(backendHome ?? "").trim().replace(/\/$/, "");
  if (!home) {
    return { backendHome: "", enabled: false, wrote: false, error: "empty BACKEND_HOME" };
  }
  const path = join(home, "config.yaml");
  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch (err) {
    if (err && typeof err === "object" && err.code !== "ENOENT") {
      return {
        backendHome: home,
        enabled: false,
        wrote: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (existing) {
    const parsed = subagentsEnabledFromYaml(existing);
    if (parsed !== null) {
      return { backendHome: home, enabled: parsed, wrote: false };
    }
  }

  const next = existing
    ? `${existing.replace(/\s*$/, "")}\n\n${MOCKLAB_V1_SUBAGENTS_YAML}`
    : MOCKLAB_V1_SUBAGENTS_YAML;

  try {
    await mkdir(home, { recursive: true });
    await writeFile(path, next, "utf8");
  } catch (err) {
    return {
      backendHome: home,
      enabled: false,
      wrote: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return { backendHome: home, enabled: true, wrote: true };
}
