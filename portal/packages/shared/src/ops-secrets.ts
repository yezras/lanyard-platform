/**
 * Class B ops-secret slot allowlists (`lp-2qs.4`,
 * dual-auth-credential-planes.md §6).
 *
 * `PROVIDER_WAKE_ENV_KEYS` is the wake-inject env allowlist consumed by
 * Control Plane `buildProviderWakeEnv` (guest LiteLLM). `OPS_OAUTH_SLOT_IDS`
 * matches the backend-runtime secrets-envelope oauth ids
 * (backend-runtime-secrets.md). Slots are a closed allowlist, never free text.
 */

export const PROVIDER_WAKE_ENV_KEYS = [
  "OPENAI_API_KEY",
  "XAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
  "META_API_KEY",
  "CORP_LLM_API_KEY",
  "POOLSIDE_API_KEY",
  "LITELLM_MASTER_KEY",
] as const;

export type ProviderWakeEnvKey = (typeof PROVIDER_WAKE_ENV_KEYS)[number];

/**
 * OAuth slots ops may manage when ops holds the grant. Ids are the secrets
 * envelope oauth ids; the Agent id for Grok OAuth is `xai-grok`, Hermes uses
 * `xai-oauth`.
 */
export const OPS_OAUTH_SLOT_IDS = [
  "xai-grok",
  "xai-oauth",
  "openai-codex",
] as const;

export type OpsOauthSlotId = (typeof OPS_OAUTH_SLOT_IDS)[number];

import type { OpsSecretSlot } from "./auth-planes.js";

/** Parse a slot id into its typed slot, or null when outside the allowlist. */
export function parseOpsSecretSlot(value: string): OpsSecretSlot | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if ((PROVIDER_WAKE_ENV_KEYS as readonly string[]).includes(trimmed)) {
    return { kind: "env_key", env_name: trimmed as ProviderWakeEnvKey };
  }
  if ((OPS_OAUTH_SLOT_IDS as readonly string[]).includes(trimmed)) {
    return { kind: "oauth_slot", provider_id: trimmed as OpsOauthSlotId };
  }
  return null;
}

/** Stable string id for a slot (URL segment + storage key). */
export function opsSecretSlotId(slot: OpsSecretSlot): string {
  return slot.kind === "env_key" ? slot.env_name : slot.provider_id;
}
