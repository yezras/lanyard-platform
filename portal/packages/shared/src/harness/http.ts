/**
 * Harness HTTP wire surface (plan 0015 / lp-oop.5).
 *
 * BFF → harness uses these paths and the service-token header.
 * Live LA server implements this contract (real harness, no fake).
 */

import type { TurnEvent } from "./turn.js";
import { isTurnEvent } from "./turn.js";

export const HARNESS_SERVICE_TOKEN_HEADER = "x-harness-service-token";

export const HARNESS_TURNS_PATH = "/internal/turns";

/** Settings SoT on VaultPlane=cp_s3 + ChatDelivery=harness (lp-oop.38.4). */
export const HARNESS_SETTINGS_SNAPSHOT_PATH = "/internal/settings/snapshot";

/** Active model write on the same harness hop (lp-oop.38.5). */
export const HARNESS_SETTINGS_MODELS_ACTIVE_PATH =
  "/internal/settings/models/active";

/** Skill enable toggle (lp-oop.38.6). */
export const HARNESS_SETTINGS_SKILLS_PREFIX = "/internal/settings/skills/";

/** MCP enable toggle (lp-oop.38.6). */
export const HARNESS_SETTINGS_MCP_PREFIX = "/internal/settings/mcp/";

export function harnessSettingsSkillPath(skillId: string): string {
  return `${HARNESS_SETTINGS_SKILLS_PREFIX}${encodeURIComponent(skillId)}`;
}

export function harnessSettingsMcpPath(mcpName: string): string {
  return `${HARNESS_SETTINGS_MCP_PREFIX}${encodeURIComponent(mcpName)}`;
}

export function harnessTurnEventsPath(turnId: string): string {
  return `${HARNESS_TURNS_PATH}/${encodeURIComponent(turnId)}/events`;
}

export function harnessTurnInterruptPath(turnId: string): string {
  return `${HARNESS_TURNS_PATH}/${encodeURIComponent(turnId)}/interrupt`;
}

/** Parse one SSE `data:` line into a TurnEvent (real harness SSE). */
export function parseHarnessSseDataLine(line: string): TurnEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice("data:".length).trim();
  if (!payload) return null;
  try {
    const parsed: unknown = JSON.parse(payload);
    return isTurnEvent(parsed) ? (parsed as TurnEvent) : null;
  } catch {
    return null;
  }
}
