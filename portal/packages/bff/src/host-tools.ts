/**
 * Host tools scheduled_task.create and workflow.create (lp-k5c4.21).
 *
 * Host-owned wrappers around existing BFF create paths, executed as the
 * owning tenant/user (not as spoofed Portal session). Model only supplies
 * {name, prompt, ...}; host stamps identity. Fail closed, no turn recurse.
 */

import { parseScheduledTaskCreateInput, type ScheduledTaskCreateInput } from "@lanyard/shared";
import { parseWorkflowCreateInput, type WorkflowCreateInput } from "@lanyard/shared";

export const SCHEDULED_TASK_CREATE_TOOL_NAME =
  "scheduled_task.create" as const;
export const WORKFLOW_CREATE_TOOL_NAME = "workflow.create" as const;

export type HostToolOk<T> = { ok: true; data: T };
export type HostToolErr = { ok: false; error: string; status: number };
export type HostToolResult<T> = HostToolOk<T> | HostToolErr;

/**
 * Validate and normalize scheduled_task.create input at host boundary.
 * Caller must still route through the existing POST /api/settings/crons
 * implementation (vault jobs.json or Brain RPC) to actually persist.
 * This helper is the boundary parser so tests can prove no raw HTTP.
 */
export function parseScheduledTaskToolInput(
  raw: unknown,
): HostToolResult<ScheduledTaskCreateInput> {
  try {
    const data = parseScheduledTaskCreateInput(raw);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: (e as Error).message, status: 400 };
  }
}

export function parseWorkflowToolInput(
  raw: unknown,
): HostToolResult<WorkflowCreateInput> {
  try {
    const data = parseWorkflowCreateInput(raw);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: (e as Error).message, status: 400 };
  }
}
