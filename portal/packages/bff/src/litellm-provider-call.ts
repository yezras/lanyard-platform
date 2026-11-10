/**
 * Calls a provider the way LiteLLM does: OpenAI-compatible chat completions,
 * or Anthropic messages. Bases are LiteLLM's provider endpoints.
 */

export class ProviderKeyRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderKeyRejectedError";
  }
}

type ProviderCall = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

const OPENAI_COMPATIBLE: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  xai: "https://api.x.ai/v1",
  groq: "https://api.groq.com/openai/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  mistral: "https://api.mistral.ai/v1",
  deepseek: "https://api.deepseek.com",
  openrouter: "https://openrouter.ai/api/v1",
  together_ai: "https://api.together.xyz/v1",
  fireworks_ai: "https://api.fireworks.ai/inference/v1",
};

function providerModelName(provider: string, modelId: string): string {
  const prefix = `${provider}/`;
  return modelId.startsWith(prefix) ? modelId.slice(prefix.length) : modelId;
}

function safeProviderMessage(message: string, apiKey: string): string {
  let text = message;
  if (apiKey) text = text.split(apiKey).join("");
  text = text.replace(/\b(?:sk|xai|rk)-[A-Za-z0-9_-]{4,}\b/g, "");
  text = text.replace(/\s+/g, " ").trim();
  return text || "API key was rejected";
}

function providerRequest(input: {
  provider: string;
  modelId: string;
  apiKey: string;
  message: string;
  maxTokens: number;
}): ProviderCall | null {
  const model = providerModelName(input.provider, input.modelId);
  if (input.provider === "anthropic") {
    return {
      url: "https://api.anthropic.com/v1/messages",
      headers: {
        "content-type": "application/json",
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: {
        model,
        max_tokens: input.maxTokens,
        messages: [{ role: "user", content: input.message }],
      },
    };
  }
  const base = OPENAI_COMPATIBLE[input.provider];
  if (!base) return null;
  return {
    url: `${base}/chat/completions`,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.apiKey}`,
    },
    body: {
      model,
      max_tokens: input.maxTokens,
      messages: [{ role: "user", content: input.message }],
    },
  };
}

function assistantText(provider: string, body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  if (provider === "anthropic") {
    const content = (body as { content?: unknown }).content;
    if (!Array.isArray(content)) return null;
    const text = content
      .map((block) => {
        if (!block || typeof block !== "object") return "";
        return typeof (block as { text?: unknown }).text === "string"
          ? (block as { text: string }).text
          : "";
      })
      .join("")
      .trim();
    return text || null;
  }
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  const content = message?.content;
  return typeof content === "string" && content.trim() ? content : null;
}

function errorMessage(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  const message = (body as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

export async function callProviderModel(
  input: {
    provider: string;
    modelId: string;
    apiKey: string;
    message: string;
    maxTokens?: number;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  const request = providerRequest({
    provider: input.provider,
    modelId: input.modelId,
    apiKey: input.apiKey,
    message: input.message,
    maxTokens: input.maxTokens ?? 16,
  });
  if (!request) {
    return { ok: false, error: "This provider is not available" };
  }
  let response: Response;
  try {
    response = await fetchImpl(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return { ok: false, error: "The provider did not respond" };
  }
  const body = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) {
    return {
      ok: false,
      error: safeProviderMessage(errorMessage(body), input.apiKey),
    };
  }
  return { ok: true, content: assistantText(input.provider, body) ?? "" };
}

export async function verifyProviderKey(
  input: { provider: string; modelId: string; apiKey: string },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const result = await callProviderModel(
    { ...input, message: "ping", maxTokens: 1 },
    fetchImpl,
  );
  if (!result.ok) {
    throw new ProviderKeyRejectedError(result.error);
  }
}
