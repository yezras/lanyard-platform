/**
 * Scheduled-job stream bind (lp-cxhb.11 I14).
 *
 * Unique key is still (tenant, user, job_id). Product creates also require
 * one catalog agent_id. The job stream is kind=scheduled_task; fire appends
 * there and never to a channel (kind=group).
 */

export type BindScheduledJobIssue =
  | { code: "job_id_required" }
  | { code: "name_required" }
  | { code: "agent_id_required" }
  | { code: "agent_not_found"; agent_id: string };

export type ParsedBindScheduledJob = {
  job_id: string;
  name: string;
  agent_id: string | null;
};

export type ParseBindScheduledJobResult =
  | { ok: true; value: ParsedBindScheduledJob }
  | { ok: false; issues: BindScheduledJobIssue[] };

export class BindScheduledJobError extends Error {
  readonly issues: BindScheduledJobIssue[];

  constructor(issues: BindScheduledJobIssue[]) {
    super(formatBindScheduledJobIssues(issues));
    this.name = "BindScheduledJobError";
    this.issues = issues;
  }
}

export function bindScheduledJobIssueMessage(
  issue: BindScheduledJobIssue,
): string {
  switch (issue.code) {
    case "job_id_required":
      return "job_id is required";
    case "name_required":
      return "job name is required";
    case "agent_id_required":
      return "agent_id is required";
    case "agent_not_found":
      return `Unknown agent ${issue.agent_id}`;
  }
}

export function formatBindScheduledJobIssues(
  issues: BindScheduledJobIssue[],
): string {
  return issues.map(bindScheduledJobIssueMessage).join("; ");
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Parse a job-stream bind. `scheduled_job_id` uniqueness is unchanged.
 * When `agentRequired` is true (product + path), agent_id must be a catalog id.
 * When false, a provided agent_id is still checked against the catalog.
 */
export function parseBindScheduledJob(
  raw: { job_id?: unknown; name?: unknown; agent_id?: unknown },
  catalogIds: ReadonlySet<string>,
  options: { agentRequired?: boolean } = {},
): ParseBindScheduledJobResult {
  const issues: BindScheduledJobIssue[] = [];
  const job_id = normalizeId(raw.job_id);
  const name = normalizeId(raw.name);
  const agent_id = normalizeId(raw.agent_id);

  if (!job_id) issues.push({ code: "job_id_required" });
  if (!name) issues.push({ code: "name_required" });
  if (!agent_id) {
    if (options.agentRequired) {
      issues.push({ code: "agent_id_required" });
    }
  } else if (!catalogIds.has(agent_id)) {
    issues.push({ code: "agent_not_found", agent_id });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    value: {
      job_id: job_id as string,
      name: name as string,
      agent_id,
    },
  };
}
