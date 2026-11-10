/**
 * Per-thread system / purpose prompt (lp-lv9.4).
 *
 * After 1–2 interactive turns, Portal can derive a short purpose summary for
 * the chat. Purpose is applied only when `system_prompt_source` is still
 * overwritable (`default`); never when `user` has edited it.
 *
 * On subsequent chat sends the BFF injects a purpose block via inbound
 * metadata (does not replace vault / AGENTS.md host context).
 *
 * Resolution order (BFF assign endpoint):
 * 1. Optional host Brain RPC `chat.suggest_purpose` when brain RPC is enabled
 * 2. Offline/mock fixture summarizer (always available; used by CI + mocklab)
 */

import type { ThreadKind, ThreadSystemPromptSource } from "./chat-store.js";

/** Canned purpose returned by dev-mock-gateway for `chat.suggest_purpose`. */
export const MOCK_GATEWAY_CANNED_SYSTEM_PROMPT =
  "Help with the user's current task in this chat.";

/** Fixture when conversation context is empty / whitespace. */
export const OFFLINE_FIXTURE_EMPTY_SYSTEM_PROMPT =
  "General interactive agent assistance.";

/** Soft cap: ~10 lines / ~800 chars (product acceptance). */
export const SYSTEM_PROMPT_MAX_CHARS = 800;
export const SYSTEM_PROMPT_MAX_LINES = 10;

/** Brain RPC method for host-side purpose suggestion (optional). */
export const CHAT_SUGGEST_PURPOSE_METHOD = "chat.suggest_purpose";

/**
 * True when an LLM/fixture assign may update the system prompt.
 * User edits are sticky. Prior `llm` is not re-assigned ("runs once").
 */
export function canAssignLlmSystemPrompt(
  source: ThreadSystemPromptSource,
): boolean {
  return source === "default";
}

/**
 * Auto-generate gate for interactive chats only.
 * Requires at least one completed user turn and overwritable source.
 */
export function shouldGenerateSystemPrompt(input: {
  kind: ThreadKind;
  system_prompt_source: ThreadSystemPromptSource;
  /** Count of user_message history events (proxy for completed turns). */
  completedTurnCount: number;
}): boolean {
  if (input.kind !== "chat") return false;
  if (!canAssignLlmSystemPrompt(input.system_prompt_source)) return false;
  // Intended window: after 1–2 early turns (still allow if client is late).
  return input.completedTurnCount >= 1;
}

/**
 * Sanitize a raw model/host/fixture string into a short purpose prompt.
 * Returns null when the input is empty after cleanup.
 */
export function sanitizeSystemPrompt(
  raw: string,
  maxChars = SYSTEM_PROMPT_MAX_CHARS,
  maxLines = SYSTEM_PROMPT_MAX_LINES,
): string | null {
  const lines = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    // Drop wrapping quotes models sometimes emit on the whole blob.
    .map((line) => line.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trimEnd());

  // Trim leading/trailing blank lines.
  while (lines.length > 0 && !lines[0]!.trim()) lines.shift();
  while (lines.length > 0 && !lines[lines.length - 1]!.trim()) lines.pop();

  if (lines.length === 0) return null;

  const limitedLines = lines.slice(0, maxLines);
  let text = limitedLines.join("\n").trim();
  if (!text) return null;

  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars - 1).trimEnd()}…`;
  }
  return text;
}

/**
 * Offline / mock fixture purpose derived from early conversation messages.
 * Deterministic short summary for CI and lab without a host.
 */
export function fixtureSystemPromptFromMessages(
  messages: readonly string[],
): string {
  const cleaned = messages
    .map((m) => m.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  if (cleaned.length === 0) {
    return OFFLINE_FIXTURE_EMPTY_SYSTEM_PROMPT;
  }

  // Prefer first user message clause so a long paste still yields a short purpose.
  const first = cleaned[0]!;
  const clause = (first.split(/[.!?\n]/)[0] ?? first).trim() || first;
  const words = clause.split(" ").filter(Boolean).slice(0, 16);
  let purpose = `Help the user with: ${words.join(" ")}`;
  if (purpose.length > SYSTEM_PROMPT_MAX_CHARS) {
    purpose = `${purpose.slice(0, SYSTEM_PROMPT_MAX_CHARS - 1).trimEnd()}…`;
  }
  return purpose;
}

/**
 * Resolve a purpose string from a Brain RPC result body.
 * Host returns `{ system_prompt: string }` (preferred) or `{ purpose: string }`.
 */
export function purposeFromSuggestResult(result: unknown): string | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  const rec = result as {
    system_prompt?: unknown;
    purpose?: unknown;
    prompt?: unknown;
  };
  if (typeof rec.system_prompt === "string") {
    return sanitizeSystemPrompt(rec.system_prompt);
  }
  if (typeof rec.purpose === "string") {
    return sanitizeSystemPrompt(rec.purpose);
  }
  if (typeof rec.prompt === "string") {
    return sanitizeSystemPrompt(rec.prompt);
  }
  return null;
}

/** Format the purpose block injected as host metadata (additive). */
export function formatPurposeBlock(systemPrompt: string): string {
  const text = systemPrompt.trim();
  if (!text) return "";
  return `## Chat purpose\n${text}`;
}

/**
 * Build inbound metadata that stamps per-thread purpose for the host.
 * Omitted entirely when the thread has no purpose text.
 * Does not replace vault / AGENTS.md — host should prepend this block.
 */
export function chatSystemPromptMetadata(
  systemPrompt: string | null | undefined,
): { system_prompt: string; purpose_block: string } | undefined {
  if (typeof systemPrompt !== "string") return undefined;
  const trimmed = systemPrompt.trim();
  if (!trimmed) return undefined;
  return {
    system_prompt: trimmed,
    purpose_block: formatPurposeBlock(trimmed),
  };
}

/** Count user turns from durable history (for generate gate). */
export function countCompletedUserTurns(
  events: readonly { type: string }[],
): number {
  return events.filter((event) => event.type === "user_message").length;
}
