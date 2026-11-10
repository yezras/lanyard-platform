import { describe, expect, it } from "vitest";
import {
  PROVIDER_WAKE_ENV_KEYS,
  applyProviderWakeEnvToCreateParams,
  buildProviderWakeEnv,
} from "../src/provider-wake-env.js";
import type { CreateSandboxParams } from "../src/daytona-client.js";

describe("buildProviderWakeEnv", () => {
  it("copies only non-empty allowlisted provider keys", () => {
    const env = buildProviderWakeEnv({
      OPENAI_API_KEY: " sk-openai ",
      XAI_API_KEY: "",
      POOLSIDE_API_KEY: "psk-poolside",
      DAYTONA_API_KEY: "must-not-inject",
      RANDOM: "nope",
    });
    expect(env).toEqual({
      OPENAI_API_KEY: "sk-openai",
      POOLSIDE_API_KEY: "psk-poolside",
    });
    expect(env).not.toHaveProperty("DAYTONA_API_KEY");
  });

  it("includes POOLSIDE_API_KEY in the allowlist", () => {
    expect(PROVIDER_WAKE_ENV_KEYS).toContain("POOLSIDE_API_KEY");
  });
});

describe("applyProviderWakeEnvToCreateParams", () => {
  it("merges provider env under existing create env (existing wins)", () => {
    const params: CreateSandboxParams = {
      snapshotId: "snap",
      env: { VAULT_ROOT: "/mnt/vault", OPENAI_API_KEY: "keep-me" },
    };
    const next = applyProviderWakeEnvToCreateParams(params, {
      OPENAI_API_KEY: "overwrite-me",
      POOLSIDE_API_KEY: "psk",
    });
    expect(next.env).toEqual({
      OPENAI_API_KEY: "keep-me",
      POOLSIDE_API_KEY: "psk",
      VAULT_ROOT: "/mnt/vault",
    });
  });

  it("no-ops when provider map empty", () => {
    const params: CreateSandboxParams = { snapshotId: "snap" };
    expect(applyProviderWakeEnvToCreateParams(params, {})).toBe(params);
  });
});
