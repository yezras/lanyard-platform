/**
 * scheduled_task.create host tool schema (lp-k5c4.21).
 *
 * Host tool wrapping POST /api/settings/crons as owner identity.
 * Model-visible fields are { name, prompt, schedule, enabled? }.
 * Host stamps tenant_id/user_id, never model-settable.
 */

const NAME_MAX = 128;
const PROMPT_MAX = 4096;
const SCHEDULE_MAX = 128;

export const SCHEDULED_TASK_CREATE_TOOL_NAME =
  "scheduled_task.create" as const;

export const SCHEDULED_TASK_CREATE_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  required: ["name", "prompt", "schedule"],
  properties: {
    name: {
      type: "string",
      minLength: 1,
      maxLength: NAME_MAX,
      description: "Scheduled task name (job name).",
    },
    prompt: {
      type: "string",
      minLength: 1,
      maxLength: PROMPT_MAX,
      description: "Task prompt/instructions to run on schedule.",
    },
    schedule: {
      type: "string",
      minLength: 1,
      maxLength: SCHEDULE_MAX,
      description:
        "Cron expression (e.g. 0 9 * * *) or host-understood schedule string.",
    },
    enabled: {
      type: "boolean",
      description: "Whether the task is enabled (default true).",
    },
  },
} as const;

export type ScheduledTaskCreateInput = {
  name: string;
  prompt: string;
  schedule: string;
  enabled?: boolean;
};

export type ScheduledTaskCreateErrorCode =
  | "bad_request"
  | "forbidden"
  | "unavailable";

function assertString(
  value: unknown,
  label: string,
  min: number,
  max: number,
): string {
  if (typeof value !== "string") throw new Error(`invalid ${label}`);
  const t = value.trim();
  if (t.length < min || t.length > max) throw new Error(`invalid ${label}`);
  return t;
}

export function parseScheduledTaskCreateInput(
  raw: unknown,
): ScheduledTaskCreateInput {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("invalid input");
  const rec = raw as Record<string, unknown>;
  const allowed = new Set(["name", "prompt", "schedule", "enabled"]);
  for (const k of Object.keys(rec)) if (!allowed.has(k)) throw new Error(`invalid ${k}`);
  const name = assertString(rec.name, "name", 1, NAME_MAX);
  const prompt = assertString(rec.prompt, "prompt", 1, PROMPT_MAX);
  const schedule = assertString(rec.schedule, "schedule", 1, SCHEDULE_MAX);
  let enabled: boolean | undefined;
  if ("enabled" in rec && rec.enabled !== undefined) {
    if (typeof rec.enabled !== "boolean") throw new Error("invalid enabled");
    enabled = rec.enabled;
  }
  return { name, prompt, schedule, enabled };
}
