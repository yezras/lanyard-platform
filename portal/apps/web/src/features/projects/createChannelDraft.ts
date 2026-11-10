/**
 * UI-side create-channel draft (lp-cxhb.5).
 * Submit is legal only with a required name and ≥2 unique members.
 * Catalog existence is enforced by POST /api/channels.
 */

export const CHANNEL_MIN_MEMBERS = 2;

export type CreateChannelDraft = {
  name: string;
  memberAgentIds: readonly string[];
};

export function uniqueMemberIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

export function canSubmitCreateChannel(draft: CreateChannelDraft): boolean {
  const name = draft.name.trim();
  const members = uniqueMemberIds(draft.memberAgentIds);
  return name.length > 0 && members.length >= CHANNEL_MIN_MEMBERS;
}

/** Last pair only leave by deleting the channel (lp-cxhb.6 I7). */
export function canRemoveChannelMember(memberCount: number): boolean {
  return memberCount > CHANNEL_MIN_MEMBERS;
}
