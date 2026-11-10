/**
 * UI-side new-scheduled-task draft (lp-cxhb.11 I14).
 * Continue is legal only with exactly one durable agent.
 * Catalog existence is enforced by POST /api/chat/threads/ensure-for-job.
 */

export type CreateScheduledTaskDraft = {
  agentId: string | null;
};

export function canSubmitBindScheduledTask(
  draft: CreateScheduledTaskDraft,
): boolean {
  const agentId = draft.agentId?.trim() ?? "";
  return agentId.length > 0;
}
