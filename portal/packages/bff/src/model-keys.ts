/**
 * Settings save path: a LiteLLM catalog model plus the provider API key.
 * The key is checked with a provider call before it is stored.
 */

import { randomUUID } from "node:crypto";

import { materializeLiteLLMConfig } from "./litellm-generated-config.js";
import {
  listLiteLLMProviderModels,
  type LiteLLMCatalogModel,
} from "./litellm-model-search.js";
import {
  callProviderModel,
  ProviderKeyRejectedError,
  verifyProviderKey,
} from "./litellm-provider-call.js";
import {
  loadModelCatalog,
  saveModelCatalog,
  type ModelCatalogEntry,
} from "./model-catalog.js";
import {
  deleteProviderKey,
  loadProviderKeyValue,
  ProviderKeyInUseError,
  saveProviderKey,
} from "./provider-keys.js";

export type SavedModelPublic = {
  id: string;
  provider: string;
  name: string;
  last4: string;
};

function providerOf(modelId: string): string {
  const slash = modelId.indexOf("/");
  return slash === -1 ? modelId : modelId.slice(0, slash);
}

function nameOf(modelId: string): string {
  const slash = modelId.indexOf("/");
  return slash === -1 ? modelId : modelId.slice(slash + 1);
}

export async function listSavedModels(root: string): Promise<SavedModelPublic[]> {
  const catalog = await loadModelCatalog(root);
  const saved: SavedModelPublic[] = [];
  for (const model of catalog.models) {
    if (!model.litellm_model || !model.key_id) continue;
    const secret = await loadProviderKeyValue(root, model.key_id);
    if (!secret) continue;
    saved.push({
      id: model.id,
      provider: providerOf(model.litellm_model),
      name: nameOf(model.litellm_model),
      last4: secret.slice(-4),
    });
  }
  return saved;
}

export async function addModelKey(
  root: string,
  input: { provider: string; model: string; api_key: string },
  options?: {
    fetchImpl?: typeof fetch;
    records?: readonly LiteLLMCatalogModel[];
  },
): Promise<SavedModelPublic> {
  const provider = input.provider.trim().toLowerCase();
  const modelId = input.model.trim();
  const known = await listLiteLLMProviderModels(provider, options);
  if (!known.some((model) => model.id === modelId)) {
    throw new ProviderKeyRejectedError("This provider is not available");
  }
  await verifyProviderKey(
    { provider, modelId, apiKey: input.api_key },
    options?.fetchImpl,
  );
  const key = await saveProviderKey(root, { provider, api_key: input.api_key });
  const catalog = await loadModelCatalog(root);
  const next: ModelCatalogEntry[] = catalog.models.filter((model) => model.id !== modelId);
  const previous = catalog.models.find((model) => model.id === modelId);
  next.push({
    id: modelId,
    tier: "moderate",
    enabled: true,
    litellm_model: modelId,
    key_id: key.id,
  });
  await saveModelCatalog(root, { models: next });
  if (previous?.key_id && previous.key_id !== key.id) {
    try {
      await deleteProviderKey(root, previous.key_id);
    } catch (error) {
      if (!(error instanceof ProviderKeyInUseError)) throw error;
    }
  }
  await materializeLiteLLMConfig(root);
  return {
    id: modelId,
    provider,
    name: nameOf(modelId),
    last4: key.last4,
  };
}

export async function removeSavedModel(root: string, modelId: string): Promise<void> {
  const catalog = await loadModelCatalog(root);
  const current = catalog.models.find((model) => model.id === modelId);
  if (!current) return;
  await saveModelCatalog(root, {
    models: catalog.models.filter((model) => model.id !== modelId),
  });
  if (current.key_id && !current.key_id.startsWith("env:")) {
    try {
      await deleteProviderKey(root, current.key_id);
    } catch (error) {
      if (!(error instanceof ProviderKeyInUseError)) throw error;
    }
  }
  await materializeLiteLLMConfig(root);
}

/** Uses the most recently saved LiteLLM model. Returns null when none is saved. */
export async function completeSavedModelTurn(
  root: string,
  message: string,
  fetchImpl: typeof fetch = fetch,
): Promise<
  | { ok: true; content: string; message_id: string; created_at: string }
  | { ok: false; status: number; error: string }
  | null
> {
  const catalog = await loadModelCatalog(root);
  const model = [...catalog.models].reverse().find((entry) => entry.enabled && entry.litellm_model && entry.key_id);
  if (!model?.litellm_model || !model.key_id) return null;
  const apiKey = await loadProviderKeyValue(root, model.key_id);
  if (!apiKey) return null;
  const provider = providerOf(model.litellm_model);
  const result = await callProviderModel(
    {
      provider,
      modelId: model.litellm_model,
      apiKey,
      message,
      maxTokens: 1024,
    },
    fetchImpl,
  );
  if (!result.ok) {
    return { ok: false, status: 502, error: result.error };
  }
  return {
    ok: true,
    content: result.content,
    message_id: randomUUID(),
    created_at: new Date().toISOString(),
  };
}
