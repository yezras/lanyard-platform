import { CONNECTOR_CATALOG } from "./catalog.generated.js";
import { ACTION_CLASS_GATES, UNMAPPED_GATE } from "./types.js";
import type { ActionClass, ActionGate } from "./types.js";

export type ClassifyCommandResult = {
  action_class: ActionClass | null;
  gate: ActionGate;
  mapped: boolean;
};

type CommandMapEntry = (typeof CONNECTOR_CATALOG.command_map)[number];

const SORTED_MAP: readonly CommandMapEntry[] = [
  ...CONNECTOR_CATALOG.command_map,
].sort((a, b) => b.argv.length - a.argv.length);

function basename(token: string): string {
  const normalized = token.replaceAll("\\", "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || token;
}

/**
 * Positional subcommand tokens. Stops at the first flag so values like
 * `--to alice` are not treated as argv prefixes.
 */
export function commandTokens(argv: readonly string[]): string[] {
  const tokens: string[] = [];
  for (const raw of argv) {
    const token = raw.trim();
    if (!token) {
      continue;
    }
    if (token.startsWith("-")) {
      break;
    }
    tokens.push(tokens.length === 0 ? basename(token) : token);
  }
  return tokens;
}

function prefixMatches(
  tokens: readonly string[],
  prefix: readonly string[],
): boolean {
  if (tokens.length < prefix.length) {
    return false;
  }
  for (let i = 0; i < prefix.length; i++) {
    if (tokens[i] !== prefix[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Classify a host command from argv. Longest catalog prefix wins.
 * Unmapped commands are every_call. Does not accept model or prompt input.
 */
export function classifyCommand(
  argv: readonly string[],
): ClassifyCommandResult {
  const tokens = commandTokens(argv);
  for (const entry of SORTED_MAP) {
    if (prefixMatches(tokens, entry.argv)) {
      return {
        action_class: entry.action_class,
        gate: ACTION_CLASS_GATES[entry.action_class],
        mapped: true,
      };
    }
  }
  return {
    action_class: null,
    gate: UNMAPPED_GATE,
    mapped: false,
  };
}
