/**
 * Harness turn contract (plan 0015 / lp-oop.2).
 *
 * BFF → harness HTTP start uses TurnRequest + branded TurnId.
 * SSE events alias the existing Relay chat event shape so the web mapper
 * is not forked. Types only — no chat delivery flag here (lp-oop.3).
 */

import type { McqChoice } from "../relay/portal-metadata.js";

declare const turnIdBrand: unique symbol;

/** Opaque id for one harness turn. Runtime value is a non-empty string. */
export type TurnId = string & { readonly [turnIdBrand]: void };

/**
 * lp-znef.1 / T3 persona stamp on a harness wake.
 * Single source for agent identity (display_name + system_prompt). BFF builds
 * this from the DurableAgent catalog (name/objective); harness must not
 * derive display_name or system_prompt from hermes_profile or other fields.
 */
export type TurnRequestPersona = {
  persona_id: string;
  display_name: string;
  avatar_seed?: string;
  system_prompt?: string;
};

/**
 * Wake payload for the agent prompt assembler (lp-v62i.3.6).
 * `room_tail` is BFF `ChatHistoryEvent[]` (bounded). Agent maps rows.
 * `hidden_instruction` is 1:1-hop Bill text; not a speaker bubble.
 * `channel_context` is lp-692u channel-shared pool: read-only sibling excerpts
 * stamped via API. BFF live fetch from context_pool table.
 *
 * `human_context_pool` is lp-ornl human-scoped 1:1 pool. BFF live-fetches per call
 * from context_pool table keyed by (tenant, human). Harness keeps
 * SessionState per human-pool with delivered_event_ids + standing_context_sent.
 * BFF sends full pool slice + revision_id; harness deltas via delivered_event_ids.
 */
export type ChannelContextExcerpt = {
  event_id: string;
  speaker: string;
  text: string;
  created_at: string;
};

export type ChannelContext = {
  /** Monotonic revision for double-window rotate. */
  revision_id: string;
  /** Read-only sibling excerpts from the channel pool (hybrid per-thread lease + channel-wide read). */
  excerpts: ChannelContextExcerpt[];
  /** IDs already delivered — prevents re-delivery. */
  delivered_event_ids: string[];
  /** Channel description rendered in [Context] block. */
  channel_description?: string;
  /** Compact/rotate state for double-window rotate. */
  window_budget?: number;
  compacted_once?: boolean;
};

export type TurnRequestMetadata = {
  host_playbook?: string;
  persona?: TurnRequestPersona;
  room_tail?: unknown[];
  hidden_instruction?: string;
  /** lp-692u: channel-shared context pool — read-only sibling excerpts. */
  channel_context?: ChannelContext;
  /** lp-ornl: human-scoped 1:1 context pool (messages-only, any writer, participants-only). */
  human_context_pool?: {
    tenant_id: string;
    human_user_id: string;
    revision_id: number;
    events: unknown[];
    /** Full roster of persona_ids that share this human pool (for prompt injection). */
    persona_ids?: string[];
  };
  /** Standing context (system prompt / host playbook) — sent once per pool session (lp-ornl string) or StandingContext object (lp-0akr). */
  standing_context?: unknown;
  /** Context pool revision for delta (lp-0akr). */
  revision_id?: string;
  /** Ordered prompt blocks shared API (lp-0akr). */
  prompt_blocks?: unknown[];
  /** Token budget for double-window (lp-0akr). */
  budget_tokens?: number;
  /** Whether this turn is a compact or rotate (lp-0akr observability). */
  pool_action?: "compact" | "rotate";
};

export type TurnRequest = {
  tenant_id: string;
  user_id: string;
  instance_id: string;
  thread_id: string;
  message: string;
  /** Daytona box for ToolboxClient file/bash exec (from ensure_online). */
  sandbox_id?: string;
  /** Optional wake metadata. parseTurnRequest must not strip it. */
  metadata?: TurnRequestMetadata;
};

/** Same wire kinds as BFF `RelayChatEvent` / web `ChatEvent`. */
export const RELAY_CHAT_EVENT_TYPES = [
  "message_send",
  "message_edit",
  "typing",
  "tool_progress",
  "reasoning",
  "mcq",
] as const;

export type RelayChatEventType = (typeof RELAY_CHAT_EVENT_TYPES)[number];

/**
 * BFF relay SSE payload. Kept here so harness events can alias it without
 * importing `@lanyard/bff`. Field set matches `portal/packages/bff/src/relay-client.ts`.
 */
export type RelayChatEvent = {
  type: RelayChatEventType;
  chat_id: string;
  message_id?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  tool_label?: string;
  tool_name?: string;
  tool_call_id?: string;
  tool_status?: string;
  tool_target?: string;
  duration?: string;
  error_message?: string;
  errorMessage?: string;
  additions?: number;
  deletions?: number;
  node?: string;
  tool_kind?: string;
  subagent_name?: string;
  result?: string;
  result_detail?: string;
  mcq_id?: string;
  choices?: McqChoice[];
  model?: string;
  citations?: Array<{ path: string; title: string }>;
  created_at?: string;
};

/** Harness SSE event. Alias — do not add harness-only fields here. */
export type TurnEvent = RelayChatEvent;

export type TurnEventType = RelayChatEventType;

const TURN_REQUEST_KEYS = [
  "tenant_id",
  "user_id",
  "instance_id",
  "thread_id",
  "message",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  value: unknown,
  field: (typeof TURN_REQUEST_KEYS)[number],
): string {
  if (typeof value !== "string") {
    throw new TypeError(`TurnRequest.${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new TypeError(`TurnRequest.${field} must be a non-empty string`);
  }
  return trimmed;
}

/** Optional sandbox_id: omit when missing/blank; reject a non-string. */
function optionalSandboxId(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new TypeError("TurnRequest.sandbox_id must be a string when present");
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

/**
 * Keep persona / room_tail / hidden_instruction so assemblePrompt can
 * consume them after JSON.stringify + parseTurnRequest (lp-v62i.3.6).
 */
function optionalMetadata(value: unknown): TurnRequestMetadata | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new TypeError("TurnRequest.metadata must be an object when present");
  }
  const metadata: TurnRequestMetadata = {};
  if (value.persona !== undefined) {
    if (!isRecord(value.persona)) {
      throw new TypeError(
        "TurnRequest.metadata.persona must be an object when present",
      );
    }
    const rawPersona = value.persona as Record<string, unknown>;
    const persona_id =
      typeof rawPersona.persona_id === "string"
        ? rawPersona.persona_id.trim()
        : "";
    const display_name =
      typeof rawPersona.display_name === "string"
        ? rawPersona.display_name.trim()
        : "";
    if (!persona_id) {
      throw new TypeError(
        "TurnRequest.metadata.persona.persona_id must be a non-empty string",
      );
    }
    if (!display_name) {
      throw new TypeError(
        "TurnRequest.metadata.persona.display_name must be a non-empty string",
      );
    }
    if (
      rawPersona.persona_id !== undefined &&
      typeof rawPersona.persona_id !== "string"
    ) {
      throw new TypeError(
        "TurnRequest.metadata.persona.persona_id must be a string",
      );
    }
    if (
      rawPersona.display_name !== undefined &&
      typeof rawPersona.display_name !== "string"
    ) {
      throw new TypeError(
        "TurnRequest.metadata.persona.display_name must be a string",
      );
    }
    if (
      rawPersona.avatar_seed !== undefined &&
      typeof rawPersona.avatar_seed !== "string"
    ) {
      throw new TypeError(
        "TurnRequest.metadata.persona.avatar_seed must be a string when present",
      );
    }
    if (
      rawPersona.system_prompt !== undefined &&
      typeof rawPersona.system_prompt !== "string"
    ) {
      throw new TypeError(
        "TurnRequest.metadata.persona.system_prompt must be a string when present",
      );
    }
    const persona: TurnRequestPersona = {
      persona_id,
      display_name,
      ...(typeof rawPersona.avatar_seed === "string" &&
      rawPersona.avatar_seed.trim()
        ? { avatar_seed: rawPersona.avatar_seed.trim() }
        : {}),
      ...(typeof rawPersona.system_prompt === "string" &&
      rawPersona.system_prompt.trim()
        ? { system_prompt: rawPersona.system_prompt.trim() }
        : {}),
    };
    metadata.persona = persona;
  }
  if (value.room_tail !== undefined) {
    if (!Array.isArray(value.room_tail)) {
      throw new TypeError(
        "TurnRequest.metadata.room_tail must be an array when present",
      );
    }
    metadata.room_tail = [...value.room_tail];
  }
  if (value.hidden_instruction !== undefined) {
    if (typeof value.hidden_instruction !== "string") {
      throw new TypeError(
        "TurnRequest.metadata.hidden_instruction must be a string when present",
      );
    }
    const trimmed = value.hidden_instruction.trim();
    if (trimmed) {
      metadata.hidden_instruction = trimmed;
    }
  }
  if (value.channel_context !== undefined) {
    if (!isRecord(value.channel_context)) {
      throw new TypeError(
        "TurnRequest.metadata.channel_context must be an object when present",
      );
    }
    const cc = value.channel_context as Record<string, unknown>;
    const revision_id =
      typeof cc.revision_id === "string" ? cc.revision_id.trim() : "";
    if (!revision_id) {
      throw new TypeError(
        "TurnRequest.metadata.channel_context.revision_id must be a non-empty string",
      );
    }
    const excerpts = Array.isArray(cc.excerpts) ? cc.excerpts : [];
    const delivered = Array.isArray(cc.delivered_event_ids)
      ? cc.delivered_event_ids.filter((x): x is string => typeof x === "string")
      : [];
    metadata.channel_context = {
      revision_id,
      excerpts: excerpts as ChannelContextExcerpt[],
      delivered_event_ids: delivered,
      ...(typeof cc.channel_description === "string" && cc.channel_description.trim()
        ? { channel_description: cc.channel_description.trim() }
        : {}),
      ...(typeof cc.window_budget === "number" ? { window_budget: cc.window_budget } : {}),
      ...(typeof cc.compacted_once === "boolean" ? { compacted_once: cc.compacted_once } : {}),
    } as ChannelContext;
  }
  if (value.human_context_pool !== undefined) {
    if (!isRecord(value.human_context_pool)) {
      throw new TypeError(
        "TurnRequest.metadata.human_context_pool must be an object when present",
      );
    }
    const pool = value.human_context_pool as Record<string, unknown>;
    if (typeof pool.tenant_id !== "string" || typeof pool.human_user_id !== "string" || typeof pool.revision_id !== "number" || !Array.isArray(pool.events)) {
      throw new TypeError("TurnRequest.metadata.human_context_pool has invalid shape");
    }
    metadata.human_context_pool = {
      tenant_id: (pool.tenant_id as string).trim(),
      human_user_id: (pool.human_user_id as string).trim(),
      revision_id: pool.revision_id as number,
      events: [...(pool.events as unknown[])],
      ...(Array.isArray(pool.persona_ids) ? { persona_ids: [...(pool.persona_ids as string[])] } : {}),
    };
  }
  if (value.standing_context !== undefined) {
    // Unified: accept string (lp-ornl) or object (lp-0akr StandingContext)
    if (typeof value.standing_context === "string") {
      const trimmed = value.standing_context.trim();
      if (trimmed) metadata.standing_context = trimmed;
    } else if (typeof value.standing_context === "object" && value.standing_context !== null) {
      metadata.standing_context = value.standing_context;
    } else {
      throw new TypeError("TurnRequest.metadata.standing_context must be a string or object when present");
    }
  }
  if (value.host_playbook !== undefined) {
    if (typeof value.host_playbook !== "string") {
      throw new TypeError("TurnRequest.metadata.host_playbook must be a string when present");
    }
    const trimmed = value.host_playbook.trim();
    if (trimmed) metadata.host_playbook = trimmed;
  }
  if (value.revision_id !== undefined) {
    if (typeof value.revision_id !== "string") {
      throw new TypeError(
        "TurnRequest.metadata.revision_id must be a string when present",
      );
    }
    const trimmed = value.revision_id.trim();
    if (trimmed) metadata.revision_id = trimmed;
  }
  if (value.prompt_blocks !== undefined) {
    if (!Array.isArray(value.prompt_blocks)) {
      throw new TypeError(
        "TurnRequest.metadata.prompt_blocks must be an array when present",
      );
    }
    metadata.prompt_blocks = [...value.prompt_blocks];
  }
  if (value.budget_tokens !== undefined) {
    if (typeof value.budget_tokens !== "number") {
      throw new TypeError(
        "TurnRequest.metadata.budget_tokens must be a number when present",
      );
    }
    metadata.budget_tokens = value.budget_tokens;
  }
  if (value.pool_action !== undefined) {
    if (value.pool_action !== "compact" && value.pool_action !== "rotate") {
      throw new TypeError(
        "TurnRequest.metadata.pool_action must be compact or rotate when present",
      );
    }
    metadata.pool_action = value.pool_action;
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

/** Brand a known turn id. Rejects empty / whitespace-only values. */
/**
 * Build a TurnRequestPersona from a DurableAgent catalog row — the single
 * source for display_name / system_prompt (T3). BFF `harness-persona` and
 * channel roster must use this, not hermes_profile.
 */
export function personaFromCatalog(input: {
  persona_id: string;
  display_name: string;
  avatar_seed?: string;
  system_prompt?: string;
}): TurnRequestPersona {
  const persona_id = input.persona_id.trim();
  const display_name = input.display_name.trim();
  if (!persona_id) throw new TypeError("persona_id must be non-empty");
  if (!display_name) throw new TypeError("display_name must be non-empty");
  return {
    persona_id,
    display_name,
    ...(input.avatar_seed?.trim() ? { avatar_seed: input.avatar_seed.trim() } : {}),
    ...(input.system_prompt?.trim()
      ? { system_prompt: input.system_prompt.trim() }
      : {}),
  };
}

/**
 * True when two personas represent the same identity (1:1 vs channel).
 * Matches on persona_id, display_name, and system_prompt.
 */
export function isSamePersonaIdentity(
  a: TurnRequestPersona,
  b: TurnRequestPersona,
): boolean {
  return (
    a.persona_id === b.persona_id &&
    a.display_name === b.display_name &&
    (a.system_prompt ?? "") === (b.system_prompt ?? "")
  );
}

export function asTurnId(value: string): TurnId {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new TypeError("TurnId must be a non-empty string");
  }
  return trimmed as TurnId;
}

export function isTurnId(value: unknown): value is TurnId {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseTurnRequest(value: unknown): TurnRequest {
  if (!isRecord(value)) {
    throw new TypeError("TurnRequest must be an object");
  }
  const sandbox_id = optionalSandboxId(value.sandbox_id);
  const metadata = optionalMetadata(value.metadata);
  return {
    tenant_id: requiredString(value.tenant_id, "tenant_id"),
    user_id: requiredString(value.user_id, "user_id"),
    instance_id: requiredString(value.instance_id, "instance_id"),
    thread_id: requiredString(value.thread_id, "thread_id"),
    message: requiredString(value.message, "message"),
    ...(sandbox_id ? { sandbox_id } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

export function isTurnRequest(value: unknown): value is TurnRequest {
  try {
    parseTurnRequest(value);
    return true;
  } catch {
    return false;
  }
}

export function isRelayChatEvent(value: unknown): value is RelayChatEvent {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.chat_id !== "string" || !value.chat_id) {
    return false;
  }
  return (RELAY_CHAT_EVENT_TYPES as readonly string[]).includes(
    value.type as string,
  );
}

export function isTurnEvent(value: unknown): value is TurnEvent {
  return isRelayChatEvent(value);
}
