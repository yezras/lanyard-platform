/**
 * Tenant model catalog (lp-bhcg.21).
 *
 * Stored at VAULT_ROOT/admin/model-catalog.json. The tier ids match the
 * LiteLLM pins in deploy/litellm/config.yaml. Chat does not classify the
 * message here. It asks the proxy for `lanyard-auto`, and LiteLLM's
 * complexity_router picks the tier. This module does not call AWS, a
 * provider, or Secrets Manager.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const MODEL_TIERS = ["simple", "moderate", "complex"] as const;

export type ModelTier = (typeof MODEL_TIERS)[number];

export type ModelCatalogEntry = {
  id: string;
  tier: ModelTier;
  enabled: boolean;
  /** LiteLLM model id, for example `openai/gpt-4o`. */
  litellm_model?: string;
  /** Saved provider key id. The secret itself is not stored on the model. */
  key_id?: string;
};

export type ModelCatalog = {
  models: ModelCatalogEntry[];
};

/** LiteLLM `model_name` for auto_router/complexity_router. */
export const LITELLM_AUTO_ROUTER_MODEL = "lanyard-auto";

export type RouteCatalogModelResult =
  | { ok: true; modelId: typeof LITELLM_AUTO_ROUTER_MODEL }
  | { ok: false; error: string };

const NO_MODEL_ERROR = "No model is available";

/** Local stand-in for LiteLLM tier model names when the catalog file is absent. */
export const DEFAULT_MODEL_CATALOG: ModelCatalog = {
  models: [
    { id: "lanyard-simple", tier: "simple", enabled: true },
    { id: "lanyard-moderate", tier: "moderate", enabled: true },
    { id: "lanyard-complex", tier: "complex", enabled: true },
  ],
};

export function modelCatalogPath(root: string): string {
  return path.join(root, "admin", "model-catalog.json");
}

function isModelTier(value: unknown): value is ModelTier {
  return value === "simple" || value === "moderate" || value === "complex";
}

function cloneCatalog(catalog: ModelCatalog): ModelCatalog {
  return {
    models: catalog.models.map((model) => ({ ...model })),
  };
}

function optionalToken(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new Error("Invalid model catalog");
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200 || /[\s]/.test(trimmed)) {
    throw new Error("Invalid model catalog");
  }
  return trimmed;
}

/** Validate a catalog write. Unknown fields, including raw API keys, are dropped. */
export function normalizeModelCatalog(raw: unknown): ModelCatalog {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { models?: unknown }).models)) {
    throw new Error("Invalid model catalog");
  }
  const models: ModelCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const entry of (raw as { models: unknown[] }).models) {
    if (!entry || typeof entry !== "object") {
      throw new Error("Invalid model catalog");
    }
    const id = (entry as { id?: unknown }).id;
    const tier = (entry as { tier?: unknown }).tier;
    const enabled = (entry as { enabled?: unknown }).enabled;
    if (typeof id !== "string" || !isModelTier(tier) || typeof enabled !== "boolean") {
      throw new Error("Invalid model catalog");
    }
    const trimmedId = optionalToken(id);
    if (!trimmedId || seen.has(trimmedId)) {
      throw new Error("Invalid model catalog");
    }
    seen.add(trimmedId);
    const litellmModel = optionalToken((entry as { litellm_model?: unknown }).litellm_model);
    const keyId = optionalToken((entry as { key_id?: unknown }).key_id);
    if (Boolean(litellmModel) !== Boolean(keyId)) {
      throw new Error("Invalid model catalog");
    }
    const model: ModelCatalogEntry = { id: trimmedId, tier, enabled };
    if (litellmModel && keyId) {
      model.litellm_model = litellmModel;
      model.key_id = keyId;
    }
    models.push(model);
  }
  return { models };
}

export async function loadModelCatalog(root: string): Promise<ModelCatalog> {
  let raw: string;
  try {
    raw = await readFile(modelCatalogPath(root), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return cloneCatalog(DEFAULT_MODEL_CATALOG);
    }
    throw error;
  }
  return normalizeModelCatalog(JSON.parse(raw) as unknown);
}

/** Admin write. Persists only validated catalog entries. */
export async function saveModelCatalog(root: string, catalog: ModelCatalog): Promise<void> {
  const cleaned = normalizeModelCatalog(catalog);
  const file = modelCatalogPath(root);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(cleaned, null, 2)}\n`, "utf8");
}

/**
 * Gate the send, then hand classification to LiteLLM.
 * Any enabled catalog model allows the turn. The request model is always
 * `lanyard-auto`. Tier targets are written to the vault LiteLLM config when
 * a model has a saved key. The git seed stays `deploy/litellm/config.yaml`.
 */
export function routeCatalogModel(
  catalog: ModelCatalog,
  _message: string,
): RouteCatalogModelResult {
  if (!catalog.models.some((model) => model.enabled)) {
    return { ok: false, error: NO_MODEL_ERROR };
  }
  return { ok: true, modelId: LITELLM_AUTO_ROUTER_MODEL };
}
