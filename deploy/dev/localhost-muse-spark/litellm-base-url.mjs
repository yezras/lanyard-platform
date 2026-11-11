/**
 * LiteLLM base-URL contract for Meta Model API / Muse Spark (lp-k5c4.17).
 *
 * LiteLlmClient POSTs `{baseUrl}/v1/chat/completions`. Operators must set
 * LITELLM_BASE_URL=https://api.meta.ai — not .../v1 — or the client hits
 * /v1/v1/chat/completions (404, empty harness turns).
 *
 * Keys stay in ~/.lanyard-agent/meta.env (mode 600). Never log them.
 */

export const MUSE_SPARK_LITELLM_BASE_URL = "https://api.meta.ai";
export const MUSE_SPARK_MODEL = "muse-spark-1.2-contributor";

/**
 * Strip trailing slashes and a trailing `/v1` so LiteLlmClient can append
 * `/v1/chat/completions` exactly once.
 */
export function normalizeLiteLlmBaseUrl(raw) {
  if (typeof raw !== "string") return "";
  let url = raw.trim().replace(/\/+$/, "");
  if (/\/v1$/i.test(url)) {
    url = url.slice(0, -3).replace(/\/+$/, "");
  }
  return url;
}

/** OpenAI-compat chat completions URL LiteLlmClient will POST. */
export function liteLlmChatCompletionsUrl(baseUrl) {
  const normalized = normalizeLiteLlmBaseUrl(baseUrl);
  if (!normalized) return "";
  return `${normalized}/v1/chat/completions`;
}

/**
 * Env the LA factory reads. Maps META_API_KEY → LITELLM_API_KEY when the
 * LiteLLM key is unset. Does not log values.
 */
export function applyMuseSparkLiteLlmEnv(env = process.env) {
  const next = { ...env };
  const rawBase =
    typeof next.LITELLM_BASE_URL === "string" && next.LITELLM_BASE_URL.trim()
      ? next.LITELLM_BASE_URL
      : MUSE_SPARK_LITELLM_BASE_URL;
  next.LITELLM_BASE_URL =
    normalizeLiteLlmBaseUrl(rawBase) || MUSE_SPARK_LITELLM_BASE_URL;

  const liteKey =
    typeof next.LITELLM_API_KEY === "string" ? next.LITELLM_API_KEY.trim() : "";
  const masterKey =
    typeof next.LITELLM_MASTER_KEY === "string"
      ? next.LITELLM_MASTER_KEY.trim()
      : "";
  const metaKey =
    typeof next.META_API_KEY === "string" ? next.META_API_KEY.trim() : "";
  if (!liteKey && !masterKey && metaKey) {
    next.LITELLM_API_KEY = metaKey;
  }

  const harnessModel =
    typeof next.HARNESS_MODEL === "string" ? next.HARNESS_MODEL.trim() : "";
  const defaultModel =
    typeof next.LANYARD_DEFAULT_MODEL === "string"
      ? next.LANYARD_DEFAULT_MODEL.trim()
      : "";
  if (!harnessModel && !defaultModel) {
    next.HARNESS_MODEL = MUSE_SPARK_MODEL;
  }

  return next;
}

/**
 * Bind createEnvLiteLlmTurnRunner from env only. Never pass `complete` —
 * that was the one-off Meta fetch wrapper this bead deletes.
 */
export function bindEnvLiteLlmTurnRunner(factory, env = process.env) {
  if (typeof factory !== "function") {
    return { runner: null, env: applyMuseSparkLiteLlmEnv(env) };
  }
  const applied = applyMuseSparkLiteLlmEnv(env);
  const runner = factory(applied);
  return { runner, env: applied };
}
