/**
 * Human-scoped 1:1 context pool — canonical types (lp-ornl).
 *
 * Grilled A human-scoped + A live per-call + A harness delta
 * + B broadcast + C shared API + A messages-only + A any writer
 * + A participants-only.
 *
 * Key: (tenant_id, human_user_id). Physical table lives in BFF
 * (portal/packages/bff/src/context-pool.ts). CP fetches via BFF API.
 * Harness keeps SessionState per human-pool with delivered_event_ids
 * + standing_context_sent (see context-pool-session.ts).
 *
 * Pool is messages-only: only user_message and message_send events
 * are pooled. Any writer (human or persona) in a 1:1 with that human
 * may append. Reads are participants-only: only the human and
 * personas that have a 1:1 with that human may read.
 */

export type ContextPoolKey = {
  tenant_id: string;
  human_user_id: string;
};

export type ContextPoolEvent = {
  event_id: string;
  revision_id: number;
  tenant_id: string;
  human_user_id: string;
  thread_id: string;
  type: "user_message" | "message_send" | "system_notice";
  content: string;
  speaker?: { kind: "human" | "persona"; id: string; display_name: string };
  created_at: string;
  /** Raw ChatHistoryEvent JSON for lossless round-trip. */
  event_json: unknown;
};

export type ContextPoolFetchResult = {
  key: ContextPoolKey;
  revision_id: number;
  events: ContextPoolEvent[];
};

export type ContextPoolUpsertInput = {
  tenant_id: string;
  human_user_id: string;
  thread_id: string;
  event: unknown;
};

/**
 * Harness SessionState per human-pool (lp-ornl).
 * Harness keeps delivered_event_ids + standing_context_sent to
 * compute delta on each live per-call fetch.
 */
export type ContextPoolSessionState = {
  key: ContextPoolKey;
  delivered_event_ids: Set<string>;
  standing_context_sent: boolean;
  last_revision_id: number;
};

export function contextPoolKeyString(key: ContextPoolKey): string {
  return `${key.tenant_id}:${key.human_user_id}`;
}

export function isContextPoolKey(value: unknown): value is ContextPoolKey {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.tenant_id === "string" &&
    rec.tenant_id.trim().length > 0 &&
    typeof rec.human_user_id === "string" &&
    rec.human_user_id.trim().length > 0
  );
}

export function parseContextPoolKey(value: unknown): ContextPoolKey {
  if (!isContextPoolKey(value)) throw new TypeError("invalid ContextPoolKey");
  const rec = value as Record<string, unknown>;
  return {
    tenant_id: (rec.tenant_id as string).trim(),
    human_user_id: (rec.human_user_id as string).trim(),
  };
}

export const CONTEXT_POOL_MESSAGES_ONLY_TYPES = [
  "user_message",
  "message_send",
  "system_notice",
] as const;

export type ContextPoolMessageType =
  (typeof CONTEXT_POOL_MESSAGES_ONLY_TYPES)[number];

export function isContextPoolMessageType(value: string): boolean {
  return (CONTEXT_POOL_MESSAGES_ONLY_TYPES as readonly string[]).includes(value);
}

/**
 * Delta helper — harness uses this to filter live fetch to unseen events.
 */
export function contextPoolDelta(
  pool: ContextPoolFetchResult,
  session: ContextPoolSessionState,
): ContextPoolEvent[] {
  if (pool.revision_id === session.last_revision_id && session.delivered_event_ids.size === pool.events.length) {
    // fast path: check revision
    const unseen = pool.events.filter((e) => !session.delivered_event_ids.has(e.event_id));
    return unseen;
  }
  return pool.events.filter((e) => !session.delivered_event_ids.has(e.event_id));
}

export function emptyContextPoolSession(key: ContextPoolKey): ContextPoolSessionState {
  return {
    key,
    delivered_event_ids: new Set<string>(),
    standing_context_sent: false,
    last_revision_id: 0,
  };
}

export function markContextPoolDelivered(
  session: ContextPoolSessionState,
  events: ContextPoolEvent[],
  standingSent = true,
): ContextPoolSessionState {
  const next = new Set(session.delivered_event_ids);
  for (const e of events) next.add(e.event_id);
  return {
    key: session.key,
    delivered_event_ids: next,
    standing_context_sent: standingSent ? true : session.standing_context_sent,
    last_revision_id: events.length > 0 ? Math.max(...events.map((e) => e.revision_id), session.last_revision_id) : session.last_revision_id,
  };
}

/**
 * Context window pool — grilled A live per-call + A harness delta + C shared API
 * + double-window rotate (compact at 80% once, rotate at next 80%).
 *
 * BFF live fetch from context_pool table, revision_id, StandingContext once, prompt_blocks.
 *
 * Design (lp-0akr):
 * - Pool key: (tenant_id, thread_id) for thread-scoped pools. Human-scoped and
 *   channel_context are siblings (lp-692u, lp-ornl) but share this contract.
 * - StandingContext is injected once per revision (not per message) as a
 *   system block. It carries persona prompt + vault stance + purpose.
 * - prompt_blocks is the shared API: ordered blocks the harness assembles into
 *   the LLM context. BFF builds them; harness deltas on revision_id.
 * - Budget small 8/4k, grows with compact/rotate. Double-window:
 *   compact at 80% once, rotate (double budget) at next 80%.
 * - revision_id on wire (TurnRequestMetadata.revision_id) so harness can
 *   skip re-sending StandingContext when unchanged.
 */

export type ContextPoolRevisionId = string;

export type StandingContext = {
  /** Stable revision for this standing prompt (uuid v4). */
  revision_id: ContextPoolRevisionId;
  /** Persona / purpose system prompt, sent once per revision. */
  system_prompt: string;
  /** Optional extra static context (vault stance, host playbook ref). */
  playbook?: string;
  /** When this revision was created (ISO). */
  created_at: string;
};

export type ContextPoolMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
};

export type PromptBlock =
  | {
      type: "standing_context";
      revision_id: ContextPoolRevisionId;
      content: string;
    }
  | { type: "compact_summary"; content: string }
  | { type: "recent_messages"; messages: ContextPoolMessage[] }
  | { type: "room_tail"; messages: ContextPoolMessage[] };

export type PromptBlocks = PromptBlock[];

/** Initial budget tokens (lp-0akr: small 8k, test 4k variant). */
export const CONTEXT_POOL_INITIAL_BUDGET_TOKENS = 8_000;
export const CONTEXT_POOL_SMALL_BUDGET_TOKENS = 4_000;

/** Thresholds for double-window. */
export const CONTEXT_POOL_COMPACT_THRESHOLD = 0.8;
export const CONTEXT_POOL_ROTATE_THRESHOLD = 0.8;

/** Very rough token estimator: ~4 chars per token, min 1. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateMessagesTokens(messages: readonly ContextPoolMessage[]): number {
  let total = 0;
  for (const m of messages) total += estimateTokens(m.content);
  return total;
}

export function estimatePromptBlocksTokens(blocks: PromptBlocks): number {
  let total = 0;
  for (const b of blocks) {
    if (b.type === "standing_context" || b.type === "compact_summary") {
      total += estimateTokens(b.content);
    } else {
      total += estimateMessagesTokens(b.messages);
    }
  }
  return total;
}

export type ContextPoolState = {
  revision_id: ContextPoolRevisionId;
  standingContext: StandingContext | null;
  messages: ContextPoolMessage[];
  compactSummary: string | null;
  budgetTokens: number;
  hasCompactedOnce: boolean;
};

export type DoubleWindowAction = "none" | "compact" | "rotate";

export function decideDoubleWindowAction(state: {
  tokenCount: number;
  budgetTokens: number;
  hasCompactedOnce: boolean;
}): DoubleWindowAction {
  const ratio = state.tokenCount / Math.max(1, state.budgetTokens);
  if (ratio < CONTEXT_POOL_COMPACT_THRESHOLD) return "none";
  if (!state.hasCompactedOnce) return "compact";
  return "rotate";
}

export function nextBudgetAfterCompact(budgetTokens: number): number {
  // Compact keeps budget but will shrink tokenCount via summary.
  return budgetTokens;
}

export function nextBudgetAfterRotate(budgetTokens: number): number {
  // Rotate doubles window (lp-0akr: compact once then rotate doubles window).
  return budgetTokens * 2;
}

export function buildPromptBlocks(input: {
  standingContext: StandingContext | null;
  compactSummary: string | null;
  messages: readonly ContextPoolMessage[];
  /** When true, omit standing_context (harness already has this revision). */
  omitStandingContext?: boolean;
}): PromptBlocks {
  const blocks: PromptBlocks = [];
  if (input.standingContext && !input.omitStandingContext) {
    blocks.push({
      type: "standing_context",
      revision_id: input.standingContext.revision_id,
      content: input.standingContext.system_prompt,
    });
  }
  if (input.compactSummary) {
    blocks.push({ type: "compact_summary", content: input.compactSummary });
  }
  // Recent messages as one block; caller slices to budget.
  blocks.push({
    type: "recent_messages",
    messages: [...input.messages],
  });
  return blocks;
}

/** Slice recent messages to fit budget minus standing + summary. */
export function sliceMessagesForBudget(
  messages: readonly ContextPoolMessage[],
  budgetTokens: number,
  overheadTokens: number,
): ContextPoolMessage[] {
  const available = Math.max(0, budgetTokens - overheadTokens);
  if (available === 0) return [];
  // Walk from newest, keep as many as fit.
  let acc = 0;
  let keepFrom = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = estimateTokens(messages[i]!.content);
    if (acc + t > available) break;
    acc += t;
    keepFrom = i;
  }
  return messages.slice(keepFrom);
}

export function createStandingContext(
  systemPrompt: string,
  opts?: { playbook?: string; revisionId?: string },
): StandingContext {
  const rev = opts?.revisionId ?? `rev_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
  return {
    revision_id: rev,
    system_prompt: systemPrompt,
    ...(opts?.playbook ? { playbook: opts.playbook } : {}),
    created_at: new Date().toISOString(),
  };
}

export function isStandingContext(value: unknown): value is StandingContext {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return typeof r.revision_id === "string" && typeof r.system_prompt === "string";
}

export function isPromptBlocks(value: unknown): value is PromptBlocks {
  if (!Array.isArray(value)) return false;
  for (const b of value) {
    if (typeof b !== "object" || b === null) return false;
    const r = b as Record<string, unknown>;
    if (r.type === "standing_context") {
      if (typeof r.revision_id !== "string" || typeof r.content !== "string") return false;
    } else if (r.type === "compact_summary") {
      if (typeof r.content !== "string") return false;
    } else if (r.type === "recent_messages" || r.type === "room_tail") {
      if (!Array.isArray(r.messages)) return false;
    } else {
      return false;
    }
  }
  return true;
}
