/**
 * Agent display-name assignment (lp-fn5.3.4 / lp-lv9.3 / lp-pxr.2 / lp-7st.1).
 *
 * Interactive chats get a generic title eagerly on create (bootstrap /
 * empty context), then **model-invented** short names after the first user
 * message via host `chat.suggest_title`. Names are applied only when
 * `title_source` is still overwritable; never when `user` or `job`.
 *
 * ## Name brief (product contract)
 *
 * Prefer a short creative agent codename that fits the *purpose* of the chat:
 * - 1–3 words (often a single evocative word)
 * - Not a paraphrase, quote, or word-snippet of the user prompt
 * - No wrapping quotes, no full sentence, no trailing punctuation
 *
 * Real creative quality depends on the host model. Offline/mock does **not**
 * use a product keyword → codename map (that trained every sales chat as
 * "Hound"). Fallback is a neutral deterministic hash pool only.
 *
 * Resolution order (BFF):
 * 1. Bootstrap (empty message): always `"New agent"` — no host, no keyword map
 * 2. After first message: optional host Brain RPC `chat.suggest_title` when
 *    brain RPC is enabled (model invents the name)
 * 3. Neutral offline fixture pool when host unavailable (CI / mocklab)
 *
 * Mock-gateway implements `chat.suggest_title` with a non-sales-specific
 * canned name so local demo with BRAIN_RPC_ENABLED still gets a deterministic
 * label. Live hosts must implement model-backed suggest_title.
 */

import type { ThreadTitleSource } from "./chat-store.js";

/** Canned name returned by dev-mock-gateway for `chat.suggest_title`. */
export const MOCK_GATEWAY_CANNED_AGENT_NAME = "Mock Lab Agent";

/** Fixture when the first message is empty / whitespace (eager bootstrap). */
export const OFFLINE_FIXTURE_EMPTY_NAME = "New agent";

/** Max length for agent display names (matches PATCH title max). */
export const AGENT_NAME_MAX_LEN = 48;

/** Product max words for codenames (1–3). Hosts and sanitize policy use this. */
export const AGENT_NAME_MAX_WORDS = 3;

/** Brain RPC method for host-side short name suggestion (optional). */
export const CHAT_SUGGEST_TITLE_METHOD = "chat.suggest_title";

/**
 * Instruction sent to host `chat.suggest_title` (and documented for LA hosts).
 * Asks the model to invent a creative codename, not a prompt excerpt and not
 * a fixed domain keyword map.
 */
export const CHAT_SUGGEST_TITLE_PROMPT = [
  "Suggest a short creative agent codename that fits the purpose of this chat.",
  "Rules:",
  "- 1 to 3 words only (prefer a single evocative word when possible)",
  "- Invent a name that fits the *purpose* of the user's request (vary freely; do not reuse a fixed domain map)",
  "- Do NOT paraphrase, quote, or reuse the first words of the user message",
  "- No quotation marks, no sentence, no trailing punctuation",
  "- Return only the codename text",
].join("\n");

/**
 * Neutral offline codename pool when host suggest_title is unavailable.
 * Picked deterministically from message content (not a prompt excerpt, not a
 * product keyword map — see lp-7st.1).
 */
export const OFFLINE_CODENAME_FALLBACKS = [
  "Atlas",
  "Orbit",
  "Nimbus",
  "Pulse",
  "Warden",
  "Cipher",
  "Drift",
  "Ember",
] as const;

/**
 * Distinct seeding pool for DurableAgent display_name when no explicit name
 * is provided (T3 identity). Ensures three agents without names do not all
 * become "New agent" — each gets a distinct codename. When pool is exhausted
 * falls back to "Agent N" suffix.
 */
export const DISTINCT_AGENT_SEED_NAMES = [
  "Josh",
  "Bill",
  "Bob",
  "Atlas",
  "Orbit",
  "Nimbus",
  "Pulse",
  "Warden",
  "Cipher",
  "Drift",
  "Ember",
] as const;

/**
 * Pick the next unused seed name for a DurableAgent when no explicit name
 * is provided. `taken` is the set of existing agent names (case-insensitive).
 * Returns a distinct name not in `taken`.
 */
export function seedDistinctAgentName(
  taken: Iterable<string>,
): string {
  const normalized = new Set(
    [...taken].map((n) => n.trim().toLowerCase()).filter(Boolean),
  );
  for (const candidate of DISTINCT_AGENT_SEED_NAMES) {
    if (!normalized.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  let n = 2;
  const base = DISTINCT_AGENT_SEED_NAMES[0]!;
  while (normalized.has(`${base} ${n}`.toLowerCase())) n += 1;
  return `${base} ${n}`;
}

/**
 * True when an LLM/fixture assign may update the title (refine path).
 * `user` renames and `job` stream titles are sticky.
 */
export function canAssignLlmTitle(titleSource: ThreadTitleSource): boolean {
  return titleSource === "default" || titleSource === "llm";
}

/**
 * Eager bootstrap on create (empty message): only apply while still
 * `title_source=default`. Prevents a late bootstrap response from overwriting
 * a first-message refine that already set `title_source=llm`.
 */
export function canAssignBootstrapTitle(
  titleSource: ThreadTitleSource,
): boolean {
  return titleSource === "default";
}

/** True when the assign-name body is bootstrap/empty context (lp-lv9.3). */
export function isBootstrapAssignMessage(message: string): boolean {
  return message.trim().length === 0;
}

/**
 * Sanitize a raw model/host/fixture string into a short agent display name.
 * Enforces codename shape: strip quotes/sentence punctuation noise, collapse
 * whitespace, cap length and word count. Returns null when empty after cleanup.
 */
export function sanitizeAgentName(
  raw: string,
  max = AGENT_NAME_MAX_LEN,
): string | null {
  let cleaned = raw
    .trim()
    .replace(/\s+/g, " ")
    // Drop wrapping quotes models sometimes emit.
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim();
  if (!cleaned) {
    return null;
  }
  // If the model returned a full sentence, keep only the first clause-ish chunk.
  const sentenceBreak = cleaned.search(/[.!?\n]/);
  if (sentenceBreak > 0) {
    cleaned = cleaned.slice(0, sentenceBreak).trim();
  }
  // Cap to codename word budget (still allow longer host titles via length max).
  const words = cleaned.split(" ").filter(Boolean);
  if (words.length > AGENT_NAME_MAX_WORDS) {
    cleaned = words.slice(0, AGENT_NAME_MAX_WORDS).join(" ");
  }
  // Trailing separators models sometimes leave after truncation.
  cleaned = cleaned.replace(/[,:;]+$/g, "").trim();
  if (!cleaned) {
    return null;
  }
  if (cleaned.length <= max) {
    return cleaned;
  }
  return `${cleaned.slice(0, max - 1).trimEnd()}…`;
}

/** Stable non-crypto hash for offline fallback pick. */
function simpleHash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * Offline / mock fixture name when host `chat.suggest_title` is unavailable.
 *
 * - Empty message → `"New agent"` (eager bootstrap; naming moment is later)
 * - Non-empty → deterministic pick from {@link OFFLINE_CODENAME_FALLBACKS}
 *
 * **Not** a true LLM, **not** a first-N-words excerpt, and **not** a product
 * keyword map (lp-7st.1 — sales must not always become "Hound").
 */
export function fixtureAgentNameFromMessage(message: string): string {
  const cleaned = message.trim().replace(/\s+/g, " ");
  if (!cleaned) {
    return OFFLINE_FIXTURE_EMPTY_NAME;
  }
  const idx =
    simpleHash(cleaned.toLowerCase()) % OFFLINE_CODENAME_FALLBACKS.length;
  return OFFLINE_CODENAME_FALLBACKS[idx]!;
}

/**
 * True when `name` looks like a naive first-N-words excerpt of `message`
 * (the pre-lp-pxr.2 fixture strategy). Used by tests / policy checks.
 */
export function looksLikePromptWordSnippet(
  name: string,
  message: string,
  maxWords = 5,
): boolean {
  const nameNorm = name.trim().replace(/\s+/g, " ").toLowerCase();
  if (!nameNorm) return false;
  const msg = message.trim().replace(/\s+/g, " ");
  if (!msg) return false;
  const clause = (msg.split(/[.!?\n]/)[0] ?? msg).trim() || msg;
  const snippet = clause
    .split(" ")
    .filter(Boolean)
    .slice(0, maxWords)
    .join(" ")
    .toLowerCase();
  if (!snippet) return false;
  // Exact first-N match (case-insensitive), or title-cased first letter only.
  return (
    nameNorm === snippet ||
    nameNorm === snippet.charAt(0).toUpperCase() + snippet.slice(1)
  );
}

/**
 * Resolve a name string from a Brain RPC result body.
 * Host returns `{ title: string }` (preferred) or `{ name: string }`.
 */
export function titleFromSuggestTitleResult(
  result: unknown,
): string | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  const rec = result as { title?: unknown; name?: unknown };
  if (typeof rec.title === "string") {
    return sanitizeAgentName(rec.title);
  }
  if (typeof rec.name === "string") {
    return sanitizeAgentName(rec.name);
  }
  return null;
}
