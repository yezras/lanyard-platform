/**
 * Short-stack / tool-only Daytona create-env invariants (plan 0015 / lp-oop.28).
 *
 * Guest on the harness path is a tool, not a host. Cold create `env` must
 * not carry provider keys or GATEWAY_RELAY_SECRET — those stay on the
 * harness. Vault mount / STS inject is unchanged.
 *
 * Default profile remains `guest_gateway` (today's Relay + provider inject).
 */

import type { CreateSandboxParams } from "./daytona-client.js";
import { GATEWAY_ENV_RELAY_SECRET } from "./gateway-relay-env.js";
import { PROVIDER_WAKE_ENV_KEYS } from "./provider-wake-env.js";

export const SANDBOX_CREATE_PROFILES = ["guest_gateway", "tool_only"] as const;

export type SandboxCreateProfile = (typeof SANDBOX_CREATE_PROFILES)[number];

export const DEFAULT_SANDBOX_CREATE_PROFILE: SandboxCreateProfile =
  "guest_gateway";

/**
 * HTTP search/parse keys that stay on the Fargate harness (lp-oop.38.12).
 * Never wake-inject these onto the guest even if present on CP process env.
 * XAI_API_KEY is already in PROVIDER_WAKE_ENV_KEYS.
 */
export const SHORT_STACK_CREATE_ENV_HTTP_KEYS = [
  "TAVILY_API_KEY",
  "BRAVE_API_KEY",
  "BRAVE_SEARCH_API_KEY",
  "FIRECRAWL_API_KEY",
  "X_BEARER_TOKEN",
] as const;

/**
 * Keys forbidden on tool-only create env.
 * Provider wake allowlist + Relay secret + harness HTTP search keys.
 * Other GATEWAY_RELAY_* are omitted because tool_only skips Relay inject
 * entirely.
 *
 * MCP secrets (lp-oop.38.17 / lp-oop.38.19) stay on the harness. Any env
 * key whose name contains `MCP` is also denied (predicate, not this tuple).
 */
export const SHORT_STACK_CREATE_ENV_DENYLIST = [
  ...PROVIDER_WAKE_ENV_KEYS,
  GATEWAY_ENV_RELAY_SECRET,
  ...SHORT_STACK_CREATE_ENV_HTTP_KEYS,
] as const;

export type ShortStackDeniedCreateEnvKey =
  (typeof SHORT_STACK_CREATE_ENV_DENYLIST)[number];

const DENYLIST_SET = new Set<string>(SHORT_STACK_CREATE_ENV_DENYLIST);

export class ShortStackCreateEnvError extends Error {
  readonly code = "SHORT_STACK_CREATE_ENV_DENIED" as const;
  readonly keys: string[];

  constructor(keys: readonly string[]) {
    const listed = keys.join(", ");
    super(
      `tool_only create env must not include provider keys, GATEWAY_RELAY_SECRET, harness HTTP search keys, or MCP secrets (${listed})`,
    );
    this.name = "ShortStackCreateEnvError";
    this.keys = [...keys];
  }
}

export function isSandboxCreateProfile(
  value: unknown,
): value is SandboxCreateProfile {
  return (
    typeof value === "string" &&
    (SANDBOX_CREATE_PROFILES as readonly string[]).includes(value)
  );
}

/**
 * Parse request/profile input. Omitted / empty → guest_gateway (today).
 * Unknown values fail closed.
 */
export function parseSandboxCreateProfile(
  value: unknown,
): SandboxCreateProfile {
  if (value === undefined || value === null) {
    return DEFAULT_SANDBOX_CREATE_PROFILE;
  }
  if (typeof value !== "string") {
    throw new TypeError("sandbox_create_profile must be a string");
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_SANDBOX_CREATE_PROFILE;
  }
  if (!isSandboxCreateProfile(trimmed)) {
    throw new TypeError(
      `sandbox_create_profile must be ${SANDBOX_CREATE_PROFILES.join(" | ")}`,
    );
  }
  return trimmed;
}

/** MCP auth/env keys belong on the Fargate harness, never guest create-env. */
export function isMcpSecretCreateEnvKey(key: string): boolean {
  return /MCP/i.test(key);
}

export function isShortStackDeniedCreateEnvKey(key: string): boolean {
  return DENYLIST_SET.has(key) || isMcpSecretCreateEnvKey(key);
}

export function listShortStackDeniedCreateEnvKeys(
  env: Readonly<Record<string, string>> | undefined | null,
): string[] {
  if (!env) return [];
  return Object.keys(env)
    .filter((key) => isShortStackDeniedCreateEnvKey(key))
    .sort();
}

export function assertShortStackCreateEnv(
  env: Readonly<Record<string, string>> | undefined | null,
): void {
  const denied = listShortStackDeniedCreateEnvKeys(env);
  if (denied.length > 0) {
    throw new ShortStackCreateEnvError(denied);
  }
}

export function stripShortStackDeniedCreateEnv(
  env: Readonly<Record<string, string>> | undefined | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!env) return out;
  for (const [key, value] of Object.entries(env)) {
    if (isShortStackDeniedCreateEnvKey(key)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Defense-in-depth for tool_only create params: strip denylist keys
 * then assert none remain (including empty-string values).
 */
export function applyShortStackCreateEnvInvariants(
  params: CreateSandboxParams,
): CreateSandboxParams {
  if (!params.env) {
    return params;
  }
  const stripped = stripShortStackDeniedCreateEnv(params.env);
  assertShortStackCreateEnv(stripped);
  return { ...params, env: stripped };
}
