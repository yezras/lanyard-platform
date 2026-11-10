/**
 * Harness wake payload: room tail + short trigger (lp-v62i.3.6).
 *
 * Channel wakes send last N `listHistory` events of the TARGET room in
 * `metadata.room_tail`, plus user/mailbox text as `message`. Never set
 * `message` to the previous persona reply alone.
 *
 * 1:1 hop: same tail from Jack↔to (often empty) plus
 * `metadata.hidden_instruction` (Bill's text). Hidden is not a bubble.
 *
 * N matches fuse-hour order of magnitude (40). Agent assemblePrompt maps
 * `ChatHistoryEvent[]` → `RoomContextRow[]`; BFF does not assemble.
 */

import type {
  ChannelContext,
  TurnRequestMetadata,
  TurnRequestPersona,
} from "@lanyard/shared";

import type { ChatHistoryEvent } from "./chat-store.js";

/** Last N durable history events on a harness wake. Same order as fuse hour. */
export const ROOM_TAIL_MAX_EVENTS = 40;

export function boundRoomTail(
  history: readonly ChatHistoryEvent[],
): ChatHistoryEvent[] {
  if (history.length <= ROOM_TAIL_MAX_EVENTS) {
    return [...history];
  }
  return history.slice(-ROOM_TAIL_MAX_EVENTS);
}

export function harnessWakeMetadata(input: {
  hostPlaybook?: string;
  roomTail: readonly ChatHistoryEvent[];
  persona?: TurnRequestPersona;
  hiddenInstruction?: string;
  /** lp-692u: read-only channel_context sibling excerpts stamped via API (BFF live fetch from context_pool table) */
  channelContext?: ChannelContext | null;
  contextPool?: { tenant_id: string; human_user_id: string; revision_id: number; events: unknown[]; persona_ids?: string[] };
  standingContext?: unknown;
  /** Context pool revision for delta (lp-0akr). */
  revisionId?: string;
  promptBlocks?: unknown[];
  budgetTokens?: number;
  poolAction?: "compact" | "rotate";
}): TurnRequestMetadata {
  const metadata: TurnRequestMetadata = {
    ...(input.hostPlaybook ? { host_playbook: input.hostPlaybook } : {}),
    room_tail: boundRoomTail(input.roomTail),
  };
  if (input.persona) {
    metadata.persona = input.persona;
  }
  const hidden = input.hiddenInstruction?.trim();
  if (hidden) {
    metadata.hidden_instruction = hidden;
  }
  // lp-692u: Hybrid per-thread lease + channel-wide read — channel_context is read-only
  if (input.channelContext) {
    metadata.channel_context = input.channelContext;
  }
  if (input.contextPool) {
    metadata.human_context_pool = input.contextPool;
  }
  if (typeof input.standingContext === "string") {
    const trimmed = input.standingContext.trim();
    if (trimmed) metadata.standing_context = trimmed;
  } else if (input.standingContext) {
    metadata.standing_context = input.standingContext;
  }
  if (input.revisionId) metadata.revision_id = input.revisionId;
  if (input.promptBlocks) metadata.prompt_blocks = input.promptBlocks;
  if (input.budgetTokens) metadata.budget_tokens = input.budgetTokens;
  if (input.poolAction) metadata.pool_action = input.poolAction;
  return metadata;
}

/** lp-692u: build channel_context for BFF live fetch + harness SessionState */
export function channelContextForHarness(input: {
  channelContext: ChannelContext | null;
}): ChannelContext | undefined {
  return input.channelContext ?? undefined;
}

/** Build prompt_blocks from pool (shared API). lp-0akr */
export function buildPoolPromptBlocks(input: {
  standingContext: unknown | null;
  revisionId: string;
  compactSummary: string | null;
  messages: readonly { id: string; role: string; content: string; created_at: string }[];
  omitStandingContext?: boolean;
}): unknown[] {
  const blocks: unknown[] = [];
  if (input.standingContext && !input.omitStandingContext) {
    blocks.push({
      type: "standing_context",
      revision_id: input.revisionId,
      content: (input.standingContext as { system_prompt?: string }).system_prompt ?? "",
    });
  }
  if (input.compactSummary) {
    blocks.push({ type: "compact_summary", content: input.compactSummary });
  }
  blocks.push({ type: "recent_messages", messages: [...input.messages] });
  return blocks;
}
