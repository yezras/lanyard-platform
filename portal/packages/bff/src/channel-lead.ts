/**
 * Channel lead (lp-cxhb.7).
 *
 * Lead is the unmentioned-wake persona. First member at create; the user
 * may point it at any current member. Catalog id equals group persona id.
 */

export type SetChannelLeadIssue =
  | { code: "lead_required" }
  | { code: "lead_not_member"; agent_id: string };

export type ParsedSetChannelLead = {
  lead_agent_id: string;
};

export type ParseSetChannelLeadResult =
  | { ok: true; value: ParsedSetChannelLead }
  | { ok: false; issues: SetChannelLeadIssue[] };

export class SetChannelLeadError extends Error {
  readonly issues: SetChannelLeadIssue[];

  constructor(issues: SetChannelLeadIssue[]) {
    super(formatSetChannelLeadIssues(issues));
    this.name = "SetChannelLeadError";
    this.issues = issues;
  }
}

export function setChannelLeadIssueMessage(issue: SetChannelLeadIssue): string {
  switch (issue.code) {
    case "lead_required":
      return "Channel lead is required";
    case "lead_not_member":
      return `Lead ${issue.agent_id} is not a channel member`;
  }
}

export function formatSetChannelLeadIssues(
  issues: SetChannelLeadIssue[],
): string {
  return issues.map(setChannelLeadIssueMessage).join("; ");
}

/**
 * Parse a lead change against the current channel roster.
 * Lead must be one of the member agent ids (persona ids on the group thread).
 */
export function parseSetChannelLead(
  raw: { lead_agent_id?: unknown },
  memberIds: ReadonlySet<string>,
): ParseSetChannelLeadResult {
  const issues: SetChannelLeadIssue[] = [];
  const lead =
    typeof raw.lead_agent_id === "string" ? raw.lead_agent_id.trim() : "";
  if (!lead) {
    issues.push({ code: "lead_required" });
    return { ok: false, issues };
  }
  if (!memberIds.has(lead)) {
    issues.push({ code: "lead_not_member", agent_id: lead });
    return { ok: false, issues };
  }
  return { ok: true, value: { lead_agent_id: lead } };
}
