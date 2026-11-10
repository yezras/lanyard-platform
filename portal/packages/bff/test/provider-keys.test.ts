import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import { materializeLiteLLMConfig } from "../src/litellm-generated-config.js";
import {
  listLiteLLMProviderModels,
  listLiteLLMProviders,
  parseLiteLLMPriceMap,
} from "../src/litellm-model-search.js";
import { addModelKey } from "../src/model-keys.js";
import { ProviderKeyRejectedError } from "../src/litellm-provider-call.js";
import {
  loadModelCatalog,
  saveModelCatalog,
} from "../src/model-catalog.js";
import {
  deleteProviderKey,
  listProviderKeys,
  ProviderKeyInUseError,
  saveProviderKey,
} from "../src/provider-keys.js";

async function tempRoot(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

describe("provider keys", () => {
  it("stores the secret and returns only the last four characters", async () => {
    const root = await tempRoot("provider-keys-");
    const secret = "sk-test-secret-value";
    const saved = await saveProviderKey(root, { provider: "openai", api_key: secret });
    expect(saved.last4).toBe("alue");
    expect(saved.source).toBe("vault");
    expect(JSON.stringify(saved)).not.toContain(secret);

    const listed = await listProviderKeys(root, {});
    expect(listed).toEqual([
      { id: saved.id, provider: "openai", last4: "alue", source: "vault" },
    ]);
    expect(JSON.stringify(listed)).not.toContain(secret);

    const file = await readFile(path.join(root, "admin", "provider-keys.json"), "utf8");
    expect(file).toContain(secret);
  });

  it("lists an environment key without copying it into the vault", async () => {
    const root = await tempRoot("provider-env-");
    const secret = "xai-test-key-1234";
    const listed = await listProviderKeys(root, { XAI_API_KEY: secret });
    expect(listed).toEqual([
      { id: "env:xai", provider: "xai", last4: "1234", source: "environment" },
    ]);
    await expect(
      readFile(path.join(root, "admin", "provider-keys.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses to delete a key that a model still uses", async () => {
    const root = await tempRoot("provider-in-use-");
    const saved = await saveProviderKey(root, {
      provider: "openai",
      api_key: "sk-openai-test-key",
    });
    await saveModelCatalog(root, {
      models: [
        {
          id: "openai/gpt-4o",
          tier: "simple",
          enabled: true,
          litellm_model: "openai/gpt-4o",
          key_id: saved.id,
        },
      ],
    });
    await expect(deleteProviderKey(root, saved.id)).rejects.toBeInstanceOf(ProviderKeyInUseError);
  });

  it("drops a raw api_key field from the model catalog", async () => {
    const root = await tempRoot("catalog-strip-");
    await saveModelCatalog(root, {
      models: [
        {
          id: "lanyard-simple",
          tier: "simple",
          enabled: true,
          api_key: "sk-should-not-persist",
        },
      ],
    } as never);
    const catalog = await loadModelCatalog(root);
    expect(catalog.models).toEqual([
      { id: "lanyard-simple", tier: "simple", enabled: true },
    ]);
    const file = await readFile(path.join(root, "admin", "model-catalog.json"), "utf8");
    expect(file).not.toContain("sk-should-not-persist");
  });

  it("writes a LiteLLM config that keeps environment secrets out of the file", async () => {
    const root = await tempRoot("litellm-config-");
    const vaultSecret = "sk-vault-openai-key";
    const envSecret = "sk-env-anthropic-key";
    const openai = await saveProviderKey(root, { provider: "openai", api_key: vaultSecret });
    await saveModelCatalog(root, {
      models: [
        {
          id: "openai/gpt-4o",
          tier: "simple",
          enabled: true,
          litellm_model: "openai/gpt-4o",
          key_id: openai.id,
        },
        {
          id: "anthropic/claude-sonnet-4-20250514",
          tier: "complex",
          enabled: true,
          litellm_model: "anthropic/claude-sonnet-4-20250514",
          key_id: "env:anthropic",
        },
      ],
    });
    await materializeLiteLLMConfig(root, { ANTHROPIC_API_KEY: envSecret });
    const yaml = await readFile(path.join(root, "admin", "litellm.generated.yaml"), "utf8");
    expect(yaml).toContain(vaultSecret);
    expect(yaml).not.toContain(envSecret);
    expect(yaml).toContain("os.environ/ANTHROPIC_API_KEY");
    expect(yaml).not.toContain("lanyard_intelligence");
    expect(yaml).not.toContain("complexity_router");
    const parsed = parse(yaml) as {
      model_list: Array<{ model_name: string; litellm_params: { api_key?: string; model?: string } }>;
    };
    const names = parsed.model_list.map((model) => model.model_name);
    expect(names).toContain("openai/gpt-4o");
    expect(names).not.toContain("lanyard-auto");
    const openaiModel = parsed.model_list.find((model) => model.model_name === "openai/gpt-4o");
    expect(openaiModel?.litellm_params.api_key).toBe(vaultSecret);
    const anthropic = parsed.model_list.find(
      (model) => model.model_name === "anthropic/claude-sonnet-4-20250514",
    );
    expect(anthropic?.litellm_params.api_key).toBe("os.environ/ANTHROPIC_API_KEY");
  });
});

describe("LiteLLM catalog", () => {
  const records = parseLiteLLMPriceMap({
    sample_spec: { litellm_provider: "openai", mode: "chat" },
    "gpt-4o": { litellm_provider: "openai", mode: "chat" },
    "gpt-4.1": { litellm_provider: "openai", mode: "chat" },
    "text-embedding-3-small": { litellm_provider: "openai", mode: "embedding" },
    "claude-sonnet-4-20250514": { litellm_provider: "anthropic", mode: "chat" },
  });

  it("lists providers and the models for one provider", async () => {
    expect(await listLiteLLMProviders({ records })).toEqual(["anthropic", "openai"]);
    expect((await listLiteLLMProviderModels("openai", { records })).map((model) => model.name)).toEqual([
      "gpt-4.1",
      "gpt-4o",
    ]);
  });

  it("rejects a provider key that the provider refuses and does not store it", async () => {
    const root = await tempRoot("model-key-reject-");
    const secret = "sk-rejected-key-0000";
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: { message: `Incorrect API key provided: ${secret}` } }), {
        status: 401,
      })) as typeof fetch;
    await expect(
      addModelKey(
        root,
        { provider: "openai", model: "openai/gpt-4o", api_key: secret },
        { records, fetchImpl },
      ),
    ).rejects.toBeInstanceOf(ProviderKeyRejectedError);
    await expect(readFile(path.join(root, "admin", "provider-keys.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("stores a key after the provider accepts it", async () => {
    const root = await tempRoot("model-key-ok-");
    const secret = "sk-accepted-key-9911";
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
      })) as typeof fetch;
    const saved = await addModelKey(
      root,
      { provider: "openai", model: "openai/gpt-4o", api_key: secret },
      { records, fetchImpl },
    );
    expect(saved).toEqual({
      id: "openai/gpt-4o",
      provider: "openai",
      name: "gpt-4o",
      last4: "9911",
    });
    expect(JSON.stringify(saved)).not.toContain(secret);
    const file = await readFile(path.join(root, "admin", "provider-keys.json"), "utf8");
    expect(file).toContain(secret);
  });
});
