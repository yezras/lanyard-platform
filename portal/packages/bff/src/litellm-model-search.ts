/**
 * LiteLLM's published model catalog.
 * Providers and models come from the public price map. A short built-in list
 * is used when that fetch fails so Settings can still add a model.
 */

export type LiteLLMCatalogModel = {
  id: string;
  provider: string;
  name: string;
};

const CATALOG_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

const CHAT_MODES = new Set(["chat", "completion", "responses"]);

export const FALLBACK_LITELLM_MODELS: readonly LiteLLMCatalogModel[] = [
  { id: "openai/gpt-4o", provider: "openai", name: "gpt-4o" },
  { id: "openai/gpt-4.1", provider: "openai", name: "gpt-4.1" },
  { id: "anthropic/claude-sonnet-4-20250514", provider: "anthropic", name: "claude-sonnet-4-20250514" },
  { id: "anthropic/claude-opus-4-20250514", provider: "anthropic", name: "claude-opus-4-20250514" },
  { id: "xai/grok-3", provider: "xai", name: "grok-3" },
  { id: "xai/grok-4", provider: "xai", name: "grok-4" },
  { id: "gemini/gemini-2.5-pro", provider: "gemini", name: "gemini-2.5-pro" },
  { id: "groq/llama-3.3-70b-versatile", provider: "groq", name: "llama-3.3-70b-versatile" },
  { id: "deepseek/deepseek-chat", provider: "deepseek", name: "deepseek-chat" },
  { id: "mistral/mistral-large-latest", provider: "mistral", name: "mistral-large-latest" },
];

let cached: Promise<LiteLLMCatalogModel[]> | null = null;

export function resetLiteLLMCatalogCache(): void {
  cached = null;
}

function parsePriceMap(raw: unknown): LiteLLMCatalogModel[] {
  if (!raw || typeof raw !== "object") return [];
  const models: LiteLLMCatalogModel[] = [];
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || key === "sample_spec") continue;
    const record = value as { litellm_provider?: unknown; mode?: unknown };
    const provider = typeof record.litellm_provider === "string" ? record.litellm_provider : "";
    if (!provider) continue;
    const mode = typeof record.mode === "string" ? record.mode : "";
    if (mode && !CHAT_MODES.has(mode)) continue;
    const id = key.includes("/") ? key : `${provider}/${key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const name = key.includes("/") ? key.slice(key.indexOf("/") + 1) : key;
    models.push({ id, provider, name });
  }
  return models;
}

async function loadCatalog(fetchImpl: typeof fetch): Promise<LiteLLMCatalogModel[]> {
  if (!cached) {
    cached = (async () => {
      try {
        const response = await fetchImpl(CATALOG_URL, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) return [...FALLBACK_LITELLM_MODELS];
        const body = (await response.json()) as unknown;
        const parsed = parsePriceMap(body);
        return parsed.length > 0 ? parsed : [...FALLBACK_LITELLM_MODELS];
      } catch {
        return [...FALLBACK_LITELLM_MODELS];
      }
    })();
  }
  return cached;
}

export async function listLiteLLMProviders(options?: {
  fetchImpl?: typeof fetch;
  records?: readonly LiteLLMCatalogModel[];
}): Promise<string[]> {
  const records = options?.records ?? (await loadCatalog(options?.fetchImpl ?? fetch));
  return [...new Set(records.map((model) => model.provider))].sort((a, b) => a.localeCompare(b));
}

export async function listLiteLLMProviderModels(
  provider: string,
  options?: {
    fetchImpl?: typeof fetch;
    records?: readonly LiteLLMCatalogModel[];
  },
): Promise<LiteLLMCatalogModel[]> {
  const name = provider.trim().toLowerCase();
  if (!name) return [];
  const records = options?.records ?? (await loadCatalog(options?.fetchImpl ?? fetch));
  return records
    .filter((model) => model.provider.toLowerCase() === name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export { parsePriceMap as parseLiteLLMPriceMap };
