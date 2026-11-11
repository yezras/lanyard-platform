/**
 * Chat `scheduled_task` create → vault `cron/jobs.json` (lp-oop.38.16).
 *
 * Same document CP fire reads (`fireScheduledTaskHarnessTurn`). No guest
 * `$BACKEND_HOME`, no Daytona ticker. Parse the tool schedule string at
 * this boundary; store a typed cron|once row.
 */

import { randomUUID } from "node:crypto";

import { nextCronOccurrenceUtc } from "./schedule-evaluator.js";
import type { ScheduledJob, ScheduledJobSchedule } from "./scheduled-job-registry.js";
import { stampScheduledTaskConnectorBinding } from "./scheduled-task-connectors.js";
import { HARNESS_SCHEDULED_TASK_DELIVER } from "./scheduled-task-harness-fire.js";
import {
  VAULT_SCHEDULED_JOBS_RELATIVE_PATH,
  type VaultScheduledJobStore,
} from "./vault-scheduled-job-store.js";

export const HARNESS_SCHEDULED_TASK_TOOL_NAME = "scheduled_task" as const;

const DURATION_RE =
  /^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i;
const EVERY_RE =
  /^every\s+(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i;

export class HarnessScheduledTaskCreateError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "HarnessScheduledTaskCreateError";
    this.code = code;
  }
}

export type HarnessScheduledTaskCreateInput = {
  prompt: string;
  schedule: string;
  name?: string;
  skills?: string[];
  tenant_id: string;
  user_id: string;
  instance_id: string;
  id?: string;
};

export type ParseHarnessScheduledTaskScheduleOptions = {
  now?: Date;
};

function requireNonEmpty(value: string | undefined, field: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new HarnessScheduledTaskCreateError(
      "INVALID_CREATE",
      `${field} is required`,
    );
  }
  return trimmed;
}

function durationMinutes(n: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u.startsWith("m")) return n;
  if (u.startsWith("h")) return n * 60;
  return n * 60 * 24;
}

function looksLikeCronExpression(input: string): boolean {
  const parts = input.trim().split(/\s+/);
  return parts.length === 5 || parts.length === 6;
}

/**
 * Tool `schedule` string → durable cron|once object.
 * `30m` / ISO → once. 5-field expr → cron. `every 30m` → step cron when possible.
 */
export function parseHarnessScheduledTaskSchedule(
  input: string,
  options: ParseHarnessScheduledTaskScheduleOptions = {},
): ScheduledJobSchedule {
  const raw = input.trim();
  if (!raw) {
    throw new HarnessScheduledTaskCreateError(
      "INVALID_SCHEDULE",
      "schedule is required",
    );
  }
  const now = options.now ?? new Date();

  const every = EVERY_RE.exec(raw);
  if (every) {
    const minutes = durationMinutes(Number(every[1]), every[2] ?? "m");
    if (minutes > 0 && minutes < 60 && 60 % minutes === 0) {
      const expr = `*/${minutes} * * * *`;
      return { kind: "cron", expr, display: `every ${minutes}m` };
    }
    if (minutes > 0 && minutes % 60 === 0 && minutes / 60 < 24) {
      const hours = minutes / 60;
      if (24 % hours === 0) {
        const expr = `0 */${hours} * * *`;
        return { kind: "cron", expr, display: `every ${hours}h` };
      }
    }
    const runAt = new Date(now.getTime() + minutes * 60_000).toISOString();
    return { kind: "once", run_at: runAt, display: `once in ${raw}` };
  }

  if (looksLikeCronExpression(raw)) {
    return { kind: "cron", expr: raw, display: raw };
  }

  if (raw.includes("T") || /^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const ms = Date.parse(raw);
    if (!Number.isFinite(ms)) {
      throw new HarnessScheduledTaskCreateError(
        "INVALID_SCHEDULE",
        "schedule timestamp is not a valid ISO date",
      );
    }
    const runAt = new Date(ms).toISOString();
    return { kind: "once", run_at: runAt, display: runAt };
  }

  const duration = DURATION_RE.exec(raw);
  if (duration) {
    const minutes = durationMinutes(Number(duration[1]), duration[2] ?? "m");
    const runAt = new Date(now.getTime() + minutes * 60_000).toISOString();
    return { kind: "once", run_at: runAt, display: `once in ${raw}` };
  }

  throw new HarnessScheduledTaskCreateError(
    "INVALID_SCHEDULE",
    "schedule must be a cron expr, ISO timestamp, duration (30m), or every <duration>",
  );
}

export function newHarnessScheduledTaskJobId(): string {
  return `st_${randomUUID()}`;
}

function nextRunAtFor(
  schedule: ScheduledJobSchedule,
  now: Date,
): string | null {
  if (schedule.kind === "once" && typeof schedule.run_at === "string") {
    return schedule.run_at;
  }
  if (schedule.kind === "cron" && typeof schedule.expr === "string") {
    const next = nextCronOccurrenceUtc(schedule.expr, now);
    return next ? next.toISOString() : null;
  }
  return null;
}

/** Map a chat-tool create payload onto a CP-readable vault job row. */
export function createVaultJobFromHarnessScheduledTaskTool(
  input: HarnessScheduledTaskCreateInput,
  now: Date = new Date(),
): ScheduledJob {
  const tenantId = requireNonEmpty(input.tenant_id, "tenant_id");
  const userId = requireNonEmpty(input.user_id, "user_id");
  const instanceId = requireNonEmpty(input.instance_id, "instance_id");
  const prompt = input.prompt?.trim() ?? "";
  const skills = (input.skills ?? []).map((s) => s.trim()).filter(Boolean);
  if (!prompt && skills.length === 0) {
    throw new HarnessScheduledTaskCreateError(
      "INVALID_CREATE",
      "create requires prompt or at least one skill",
    );
  }
  const schedule = parseHarnessScheduledTaskSchedule(input.schedule, { now });
  const id = input.id?.trim() || newHarnessScheduledTaskJobId();
  const name =
    input.name?.trim() ||
    (prompt ? prompt.slice(0, 48) : skills[0] ?? id);
  const row: ScheduledJob = {
    id,
    name,
    enabled: true,
    state: "scheduled",
    schedule,
    prompt,
    skills: skills.length > 0 ? skills : undefined,
    deliver: HARNESS_SCHEDULED_TASK_DELIVER,
    path: VAULT_SCHEDULED_JOBS_RELATIVE_PATH,
    tenant_id: tenantId,
    user_id: userId,
    instance_id: instanceId,
    created_at: now.toISOString(),
    next_run_at: nextRunAtFor(schedule, now),
    last_run_at: null,
    last_status: null,
  };
  return stampScheduledTaskConnectorBinding(row, {
    skills,
    prompt,
    user_id: userId,
  });
}

/**
 * Persist a chat-tool create onto the vault store (no ensure_online).
 */
export async function putHarnessScheduledTaskCreate(input: {
  store: VaultScheduledJobStore;
  s3VaultPrefix: string;
  create: HarnessScheduledTaskCreateInput;
  now?: Date;
}): Promise<ScheduledJob> {
  const job = createVaultJobFromHarnessScheduledTaskTool(
    input.create,
    input.now ?? new Date(),
  );
  return input.store.putJob(input.s3VaultPrefix, job);
}
