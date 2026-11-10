/**
 * Channel roster validator (lp-cxhb.5 / lp-cxhb.6).
 *
 * A channel is a named group room whose roster points at durable agents.
 * Illegal: empty name at create, fewer than two unique members, unknown
 * member ids, removing a non-member. Catalog existence is checked at this
 * boundary; the store trusts the result only after calling this again at
 * write time. Membership edit after create uses the same floor of two.
 */

export const CHANNEL_MIN_MEMBERS = 2;

export type CreateChannelIssue =
  | { code: "name_required" }
  | { code: "members_min"; min: typeof CHANNEL_MIN_MEMBERS; got: number }
  | { code: "members_duplicate"; agent_id: string }
  | { code: "member_not_found"; agent_id: string }
  | { code: "member_not_in_channel"; agent_id: string };

export type ParsedCreateChannel = {
  name: string;
  member_agent_ids: string[];
};

export type ParseCreateChannelResult =
  | { ok: true; value: ParsedCreateChannel }
  | { ok: false; issues: CreateChannelIssue[] };

export type ParsedAddChannelMember = {
  agent_id: string;
};

export type ParseAddChannelMemberResult =
  | { ok: true; value: ParsedAddChannelMember }
  | { ok: false; issues: CreateChannelIssue[] };

export type ParsedRemoveChannelMember = {
  agent_id: string;
  remaining_agent_ids: string[];
};

export type ParseRemoveChannelMemberResult =
  | { ok: true; value: ParsedRemoveChannelMember }
  | { ok: false; issues: CreateChannelIssue[] };

export class CreateChannelError extends Error {
  readonly issues: CreateChannelIssue[];

  constructor(issues: CreateChannelIssue[]) {
    super(formatCreateChannelIssues(issues));
    this.name = "CreateChannelError";
    this.issues = issues;
  }
}

export function createChannelIssueMessage(issue: CreateChannelIssue): string {
  switch (issue.code) {
    case "name_required":
      return "Channel name is required";
    case "members_min":
      return `Channel needs at least ${issue.min} members`;
    case "members_duplicate":
      return `Duplicate member ${issue.agent_id}`;
    case "member_not_found":
      return `Unknown agent ${issue.agent_id}`;
    case "member_not_in_channel":
      return `Agent ${issue.agent_id} is not in this channel`;
  }
}

export function formatCreateChannelIssues(issues: CreateChannelIssue[]): string {
  return issues.map(createChannelIssueMessage).join("; ");
}

function uniqueAgentIds(raw: unknown): {
  ids: string[];
  duplicates: string[];
} {
  if (!Array.isArray(raw)) {
    return { ids: [], duplicates: [] };
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const id = entry.trim();
    if (!id) continue;
    if (seen.has(id)) {
      if (!duplicates.includes(id)) duplicates.push(id);
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return { ids, duplicates };
}

/**
 * Parse a create-channel request against the owner's durable-agent catalog.
 * First remaining member id is the create-time lead (lp-cxhb.7 may change it).
 */
export function parseCreateChannel(
  raw: { name?: unknown; member_agent_ids?: unknown },
  catalogIds: ReadonlySet<string>,
): ParseCreateChannelResult {
  const issues: CreateChannelIssue[] = [];
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) {
    issues.push({ code: "name_required" });
  }

  const { ids, duplicates } = uniqueAgentIds(raw.member_agent_ids);
  for (const agent_id of duplicates) {
    issues.push({ code: "members_duplicate", agent_id });
  }
  if (ids.length < CHANNEL_MIN_MEMBERS) {
    issues.push({
      code: "members_min",
      min: CHANNEL_MIN_MEMBERS,
      got: ids.length,
    });
  }
  for (const agent_id of ids) {
    if (!catalogIds.has(agent_id)) {
      issues.push({ code: "member_not_found", agent_id });
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value: { name, member_agent_ids: ids } };
}

function parseAgentId(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim();
}

/**
 * Add one catalog agent to an existing roster. Rejects unknown, duplicate,
 * or empty ids. The resulting roster stays at or above the floor of two.
 */
export function parseAddChannelMember(
  rawAgentId: unknown,
  currentIds: readonly string[],
  catalogIds: ReadonlySet<string>,
): ParseAddChannelMemberResult {
  const agent_id = parseAgentId(rawAgentId);
  const issues: CreateChannelIssue[] = [];
  if (!agent_id) {
    issues.push({ code: "member_not_found", agent_id: "" });
    return { ok: false, issues };
  }
  if (currentIds.includes(agent_id)) {
    issues.push({ code: "members_duplicate", agent_id });
  }
  if (!catalogIds.has(agent_id)) {
    issues.push({ code: "member_not_found", agent_id });
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value: { agent_id } };
}

/**
 * Remove one member. Remaining unique ids must stay at the floor of two.
 * Last pair only leave by deleting the channel.
 */
export function parseRemoveChannelMember(
  rawAgentId: unknown,
  currentIds: readonly string[],
): ParseRemoveChannelMemberResult {
  const agent_id = parseAgentId(rawAgentId);
  const issues: CreateChannelIssue[] = [];
  if (!agent_id) {
    issues.push({ code: "member_not_in_channel", agent_id: "" });
    return { ok: false, issues };
  }
  if (!currentIds.includes(agent_id)) {
    issues.push({ code: "member_not_in_channel", agent_id });
  }
  const remaining_agent_ids = currentIds.filter((id) => id !== agent_id);
  if (remaining_agent_ids.length < CHANNEL_MIN_MEMBERS) {
    issues.push({
      code: "members_min",
      min: CHANNEL_MIN_MEMBERS,
      got: remaining_agent_ids.length,
    });
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value: { agent_id, remaining_agent_ids } };
}
