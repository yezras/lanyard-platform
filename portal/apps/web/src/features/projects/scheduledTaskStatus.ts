/**
 * Composite run status for scheduled-task job streams (lp-lv9.2).
 *
 * Live stream/fire open wins; else host last_status; enabled=false → explicit Off
 * (never looks like a failure solely because the last run failed).
 */

import type { SettingsCron } from "../../api/types.js";

import type {
  AgentSideNavStatus,
  ThreadResponseStatus,
} from "./threadResponseStatus.js";

/** Minimal cron fields needed to join sidenav status by scheduled_job_id. */
export type ScheduledTaskJobMeta = Pick<
  SettingsCron,
  "id" | "enabled" | "last_status" | "state"
>;

/**
 * Map a host outcome / state string to a sidebar status.
 * Empty / unknown → neutral (not error).
 */
export function mapHostLastStatus(
  lastStatus: string | null | undefined,
): ThreadResponseStatus {
  const raw = String(lastStatus ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!raw) {
    return "neutral";
  }
  if (
    raw === "ok" ||
    raw === "success" ||
    raw === "succeeded" ||
    raw === "completed" ||
    raw === "complete" ||
    raw === "done" ||
    raw === "finished"
  ) {
    return "success";
  }
  if (
    raw === "error" ||
    raw === "failed" ||
    raw === "failure" ||
    raw === "fail" ||
    raw === "timeout" ||
    raw === "timed_out" ||
    raw === "aborted" ||
    raw === "cancelled" ||
    raw === "canceled"
  ) {
    return "error";
  }
  if (
    raw === "running" ||
    raw === "in_progress" ||
    raw === "started" ||
    raw === "active" ||
    raw === "executing" ||
    raw === "working"
  ) {
    return "generating";
  }
  return "neutral";
}

export type DeriveScheduledTaskCompositeStatusInput = {
  /** Session-local timeline status for this job stream (ChatView). */
  liveStatus?: ThreadResponseStatus | null;
  /** Host cron.enabled; only explicit false yields Off. */
  enabled?: boolean | null;
  /** Host last run outcome (ok | error | …). */
  lastStatus?: string | null;
  /** Host job state when provided (running | scheduled | paused | …). */
  state?: string | null;
};

/**
 * Composite status for `kind=scheduled_task` sidenav rows.
 *
 * Priority:
 * 1. Live stream open (`liveStatus === "generating"`) → generating
 * 2. Host currently running (`state` / `last_status` → generating) → generating
 * 3. `enabled === false` → off (independent of last outcome)
 * 4. Host `last_status` outcome → success | error | neutral
 * 5. Remaining live success/error/neutral when host has no outcome
 * 6. neutral
 */
export function deriveScheduledTaskCompositeStatus(
  input: DeriveScheduledTaskCompositeStatusInput,
): AgentSideNavStatus {
  if (input.liveStatus === "generating") {
    return "generating";
  }

  // Host may report a fire in progress before/without local stream observation.
  const fromState = mapHostLastStatus(input.state);
  if (fromState === "generating") {
    return "generating";
  }
  const fromLastAsRun = mapHostLastStatus(input.lastStatus);
  if (fromLastAsRun === "generating") {
    return "generating";
  }

  if (input.enabled === false) {
    return "off";
  }

  if (fromLastAsRun !== "neutral") {
    return fromLastAsRun;
  }

  if (
    input.liveStatus === "success" ||
    input.liveStatus === "error" ||
    input.liveStatus === "neutral"
  ) {
    return input.liveStatus;
  }

  return "neutral";
}

/** Index snapshot crons by id for O(1) join on scheduled_job_id. */
export function indexCronsByJobId(
  crons: readonly ScheduledTaskJobMeta[] | null | undefined,
): ReadonlyMap<string, ScheduledTaskJobMeta> {
  const map = new Map<string, ScheduledTaskJobMeta>();
  if (!crons) {
    return map;
  }
  for (const cron of crons) {
    const id = typeof cron.id === "string" ? cron.id.trim() : "";
    if (!id) {
      continue;
    }
    map.set(id, cron);
  }
  return map;
}

/**
 * Resolve composite status for a job-stream thread using live map + cron join.
 */
export function resolveScheduledTaskSideNavStatus(input: {
  liveStatus?: ThreadResponseStatus | null;
  scheduledJobId?: string | null;
  cronsById: ReadonlyMap<string, ScheduledTaskJobMeta>;
}): AgentSideNavStatus {
  const jobId =
    typeof input.scheduledJobId === "string"
      ? input.scheduledJobId.trim()
      : "";
  const cron = jobId ? input.cronsById.get(jobId) : undefined;
  return deriveScheduledTaskCompositeStatus({
    liveStatus: input.liveStatus,
    enabled: cron?.enabled,
    lastStatus: cron?.last_status,
    state: cron?.state,
  });
}
