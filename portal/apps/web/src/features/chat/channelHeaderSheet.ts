import type { Channel, ChatThreadSummary, DurableAgent } from "../../api/types.js";

/**
 * One row in the channel members + purposes sheet (lp-cxhb.15.2).
 * Lead and membership live behind the header title click — never inline
 * in the chat chrome.
 */
export type ChannelMemberRow = {
  agent_id: string;
  name: string;
  purpose: string;
  isLead: boolean;
};

/** Find the channel roster matching a group-thread id (null when absent). */
export function findChannelForThread(
  channels: Channel[],
  threadId: string,
): Channel | null {
  return (
    channels.find((channel) => channel.thread_id === threadId) ?? null
  );
}

/**
 * Map a channel roster + agent catalog into display rows.
 *
 * - Members render in roster order (`members[].joined_at` order from API).
 * - Names / purposes come from the durable-agent catalog; unknown members
 *   fall back to `Unknown agent` — never a raw agent id (lp-8sh4.3).
 * - The lead is flagged via `lead_agent_id` (badge only — no separate
 *   lead selector anywhere in the chrome).
 */
export function buildChannelMemberRows(
  channel: Pick<Channel, "lead_agent_id" | "members"> | null | undefined,
  agents: DurableAgent[],
): ChannelMemberRow[] {
  if (!channel) {
    return [];
  }
  const byId = new Map(agents.map((agent) => [agent.agent_id, agent]));
  return channel.members.map((member) => {
    const agent = byId.get(member.agent_id);
    return {
      agent_id: member.agent_id,
      name: agent?.name ?? UNKNOWN_MEMBER_NAME,
      purpose: agent?.objective ?? "",
      isLead: member.agent_id === channel.lead_agent_id,
    };
  });
}

/** Display fallback for members missing from the catalog (lp-8sh4.3). */
export const UNKNOWN_MEMBER_NAME = "Unknown agent";

/** True only for named channel rosters; 1:1 ghost UI must never change. */
export function isChannelSheetEligible(
  thread: Pick<ChatThreadSummary, "kind"> | null | undefined,
): boolean {
  return thread?.kind === "group";
}
