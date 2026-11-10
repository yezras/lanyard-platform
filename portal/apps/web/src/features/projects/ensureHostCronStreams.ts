import type { EnsureAgentChatForJobResult } from "../../api/chat.js";
import type { ChatThreadSummary, SettingsCron } from "../../api/types.js";

/** Minimal host cron identity for inventory ensure (settings snapshot SoT). */
export type HostCronRef = Pick<SettingsCron, "id" | "name">;

export type EnsureForJobFn = (input: {
  jobId: string;
  name: string;
}) => Promise<EnsureAgentChatForJobResult>;

/**
 * Idempotently ensure a durable agent chat stream for each host cron (lp-lv9.1).
 * Host inventory is SoT; per-job failures are skipped so one bad job cannot
 * block the rest of the folder.
 */
export async function ensureAgentChatsForHostCrons(
  crons: readonly HostCronRef[],
  ensureForJob: EnsureForJobFn,
): Promise<EnsureAgentChatForJobResult[]> {
  const jobs = (crons ?? [])
    .map((cron) => {
      const jobId = typeof cron.id === "string" ? cron.id.trim() : "";
      const name =
        typeof cron.name === "string" && cron.name.trim().length > 0
          ? cron.name.trim()
          : jobId;
      return { jobId, name };
    })
    .filter((job) => job.jobId.length > 0);

  if (jobs.length === 0) {
    return [];
  }

  const settled = await Promise.all(
    jobs.map(async (job) => {
      try {
        return await ensureForJob(job);
      } catch {
        return null;
      }
    }),
  );

  return settled.filter(
    (row): row is EnsureAgentChatForJobResult => row != null,
  );
}

/**
 * Upsert ensured job-stream rows into the sidenav thread list.
 * Prefer by `thread_id`; also drop any prior row with the same `scheduled_job_id`
 * so inventory ensure never duplicates a stream.
 */
export function mergeEnsuredJobStreams(
  current: ChatThreadSummary[],
  ensured: readonly ChatThreadSummary[],
): ChatThreadSummary[] {
  if (!ensured.length) {
    return current;
  }

  const ensuredById = new Map(
    ensured.map((thread) => [thread.thread_id, thread] as const),
  );
  const ensuredJobIds = new Set(
    ensured
      .map((thread) => thread.scheduled_job_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );

  const kept = current.filter((thread) => {
    if (ensuredById.has(thread.thread_id)) {
      return false;
    }
    const jobId = thread.scheduled_job_id;
    if (typeof jobId === "string" && jobId.length > 0 && ensuredJobIds.has(jobId)) {
      return false;
    }
    return true;
  });

  return [...ensured, ...kept];
}
