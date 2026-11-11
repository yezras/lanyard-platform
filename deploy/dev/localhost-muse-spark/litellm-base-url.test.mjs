import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MUSE_SPARK_LITELLM_BASE_URL,
  MUSE_SPARK_MODEL,
  applyMuseSparkLiteLlmEnv,
  bindEnvLiteLlmTurnRunner,
  liteLlmChatCompletionsUrl,
  normalizeLiteLlmBaseUrl,
} from "./litellm-base-url.mjs";

describe("normalizeLiteLlmBaseUrl", () => {
  it("keeps https://api.meta.ai (no trailing /v1)", () => {
    assert.equal(
      normalizeLiteLlmBaseUrl("https://api.meta.ai"),
      MUSE_SPARK_LITELLM_BASE_URL,
    );
  });

  it("strips trailing slash and /v1 so the client does not double the path", () => {
    assert.equal(
      normalizeLiteLlmBaseUrl("https://api.meta.ai/"),
      "https://api.meta.ai",
    );
    assert.equal(
      normalizeLiteLlmBaseUrl("https://api.meta.ai/v1"),
      "https://api.meta.ai",
    );
    assert.equal(
      normalizeLiteLlmBaseUrl("https://api.meta.ai/v1/"),
      "https://api.meta.ai",
    );
  });
});

describe("liteLlmChatCompletionsUrl", () => {
  it("joins {base}/v1/chat/completions exactly once", () => {
    assert.equal(
      liteLlmChatCompletionsUrl("https://api.meta.ai"),
      "https://api.meta.ai/v1/chat/completions",
    );
    assert.equal(
      liteLlmChatCompletionsUrl("https://api.meta.ai/v1"),
      "https://api.meta.ai/v1/chat/completions",
    );
    assert.notEqual(
      liteLlmChatCompletionsUrl("https://api.meta.ai/v1"),
      "https://api.meta.ai/v1/v1/chat/completions",
    );
  });
});

describe("applyMuseSparkLiteLlmEnv", () => {
  it("defaults base + Muse Spark model without logging keys", () => {
    const applied = applyMuseSparkLiteLlmEnv({
      META_API_KEY: "test-not-a-secret",
    });
    assert.equal(applied.LITELLM_BASE_URL, "https://api.meta.ai");
    assert.equal(applied.LITELLM_API_KEY, "test-not-a-secret");
    assert.equal(applied.HARNESS_MODEL, MUSE_SPARK_MODEL);
    assert.doesNotMatch(JSON.stringify(applied), /\/v1\/v1/);
  });

  it("rewrites LITELLM_BASE_URL=.../v1 to the contract base", () => {
    const applied = applyMuseSparkLiteLlmEnv({
      LITELLM_BASE_URL: "https://api.meta.ai/v1",
      LITELLM_API_KEY: "test-not-a-secret",
      HARNESS_MODEL: "muse-spark-1.2-contributor",
    });
    assert.equal(applied.LITELLM_BASE_URL, "https://api.meta.ai");
  });
});

describe("bindEnvLiteLlmTurnRunner", () => {
  it("calls the factory with env only (no complete wrapper)", () => {
    const calls = [];
    const fakeRunner = { run: async () => {} };
    const factory = (...args) => {
      calls.push(args);
      return fakeRunner;
    };
    const { runner, env } = bindEnvLiteLlmTurnRunner(factory, {
      LITELLM_BASE_URL: "https://api.meta.ai/v1",
      LITELLM_API_KEY: "test-not-a-secret",
    });
    assert.equal(runner, fakeRunner);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].length, 1);
    assert.equal(calls[0][0].LITELLM_BASE_URL, "https://api.meta.ai");
    assert.equal(env.LITELLM_BASE_URL, "https://api.meta.ai");
  });
});
