/**
 * Provider / model API keys for Daytona guest wake inject (Bucket C).
 *
 * Non-secret LiteLLM model_list binds keys via `os.environ/<NAME>`
 * (`deploy/litellm/config.yaml`). Control Plane reads the same names from
 * process env (ECS secrets / SM) and copies non-empty values into create
 * `env` so the agent + LiteLLM proxy see them after cold create/start.
 *
 * Do not invent Daytona-only key names — gateway-env-contract parity.
 * Never log values; redaction covers `*_API_KEY` via daytona-env-redact.
 *
 * Class C registry connector tokens are not this path (`class-c-attach.ts`).
 */

import type { CreateSandboxParams } from "./daytona-client.js";

/**
 * Ordered allowlist of process-env names that may be wake-injected into the
 * guest when present. SoT lives in @lanyard/shared so the ops secrets UI
 * (`lp-2qs.4`) validates against the same closed set. Keep in sync with
 * `deploy/litellm/env.secrets.example` model-provider slots (not Relay / AWS /
 * Daytona control keys).
 */
export { PROVIDER_WAKE_ENV_KEYS } from "@lanyard/shared";
export type { ProviderWakeEnvKey } from "@lanyard/shared";

import { PROVIDER_WAKE_ENV_KEYS } from "@lanyard/shared";

/**
 * Build create-env fragment from process env (or a test map).
 * Omits missing/empty values. Values are secrets — do not log.
 */
export function buildProviderWakeEnv(
  source: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>> = process.env,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const key of PROVIDER_WAKE_ENV_KEYS) {
    const raw = source[key];
    if (typeof raw !== "string") continue;
    const v = raw.trim();
    if (!v) continue;
    out[key] = v;
  }
  return out;
}

/**
 * Merge provider wake env into create params. Existing env keys win on
 * conflict (caller-injected vault/relay take precedence only if already set;
 * providers are additive).
 */
export function applyProviderWakeEnvToCreateParams(
  params: CreateSandboxParams,
  providerEnv: Readonly<Record<string, string>>,
): CreateSandboxParams {
  const keys = Object.keys(providerEnv);
  if (keys.length === 0) return params;
  const prev = params.env ?? {};
  const merged: Record<string, string> = { ...providerEnv, ...prev };
  return { ...params, env: merged };
}
