import type { ChatThreadSummary } from "../../api/types.js";

/** Perpetual sidenav folder for multi-agent rooms (lp-cxhb.3 / lp-cxhb.5). */
export const CHANNELS_GROUP_KEY = "__channels__";
export const CHANNELS_GROUP_NAME = "Channels";

/** Perpetual sidenav folder for durable agents (one row per interactive 1:1). */
export const AGENTS_GROUP_KEY = "__agents__";
export const AGENTS_GROUP_NAME = "Agents";

/** Synthetic Agents sidenav folder for durable job streams (lp-fn5.5.2). */
export const SCHEDULED_TASKS_GROUP_KEY = "__scheduled_tasks__";
export const SCHEDULED_TASKS_GROUP_NAME = "Scheduled Tasks";

/**
 * Kind of a side-nav section.
 * Fixed IA order: Channels, Agents, Scheduled Tasks. Project folders are gone.
 */
export type ThreadGroupKind = "channels" | "agents" | "scheduled_tasks";

export type ThreadProjectGroup = {
  key: string;
  /**
   * Always `null` for IA sections (Channels / Agents / Scheduled Tasks).
   * Kept so folder row props stay a single shape.
   */
  projectId: string | null;
  name: string;
  vaultPath: string | null;
  threads: ChatThreadSummary[];
  kind: ThreadGroupKind;
};

/** Truncate first-user-message text into a side-nav thread title. */
export function truncateThreadTitle(text: string, max = 48): string {
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (!cleaned) {
    return "New chat";
  }
  if (cleaned.length <= max) {
    return cleaned;
  }
  return `${cleaned.slice(0, max - 1).trimEnd()}…`;
}

/**
 * True when a thread is a durable scheduled-job stream (lp-fn5.5.1 binding).
 * Prefer `kind=scheduled_task`; also accept a non-null `scheduled_job_id` so
 * legacy/partial rows still land under Scheduled Tasks.
 */
export function isScheduledTaskThread(
  thread: Pick<ChatThreadSummary, "kind" | "scheduled_job_id">,
): boolean {
  if (thread.kind === "scheduled_task") {
    return true;
  }
  const jobId = thread.scheduled_job_id;
  return typeof jobId === "string" && jobId.trim().length > 0;
}

/** True when a thread is a named channel roster (`kind=group`). */
export function isChannelThread(
  thread: Pick<ChatThreadSummary, "kind">,
): boolean {
  return thread.kind === "group";
}

/**
 * Scheduled-task rows for the agent currently open in the portal (lp-bhcg.3).
 * A selected agent sees only its own jobs. No selection keeps the full list.
 */
export function visibleScheduledTaskThreads(
  threads: ChatThreadSummary[],
  selectedAgentId: string | null | undefined,
): ChatThreadSummary[] {
  const jobs = threads.filter(isScheduledTaskThread);
  if (!selectedAgentId) {
    return sortScheduledTaskThreads(jobs);
  }
  return sortScheduledTaskThreads(
    jobs.filter((thread) => thread.agent_id === selectedAgentId),
  );
}

/**
 * Sort job-stream chats under Scheduled Tasks.
 *
 * Policy (lp-fn5.5.2 — documented):
 * 1. Case-insensitive title (job name) ascending
 * 2. Tie-break: `created_at` ascending (stable older-first)
 * 3. Final tie-break: `thread_id` for deterministic order
 *
 * Interactive agent rows keep list order from the API (not re-sorted here).
 */
export function sortScheduledTaskThreads(
  threads: ChatThreadSummary[],
): ChatThreadSummary[] {
  return [...threads].sort((a, b) => {
    const titleCmp = (a.title || "").localeCompare(b.title || "", undefined, {
      sensitivity: "base",
    });
    if (titleCmp !== 0) {
      return titleCmp;
    }
    const createdCmp = (a.created_at || "").localeCompare(b.created_at || "");
    if (createdCmp !== 0) {
      return createdCmp;
    }
    return a.thread_id.localeCompare(b.thread_id);
  });
}

function iaSection(
  kind: ThreadGroupKind,
  key: string,
  name: string,
  threads: ChatThreadSummary[],
): ThreadProjectGroup {
  return {
    key,
    projectId: null,
    name,
    vaultPath: null,
    kind,
    threads,
  };
}

/**
 * Group chat threads for the Agents sidenav (lp-cxhb.3).
 *
 * **Sort / placement policy:**
 * 1. **Channels** — always first, always present. `kind=group` rows live here.
 * 2. **Agents** — all interactive 1:1 rows, not grouped by vault project.
 * 3. **Scheduled Tasks** — always last, always present (even with zero jobs).
 *
 * Job-stream threads (`kind=scheduled_task` or bound `scheduled_job_id`) never
 * appear under Channels or Agents. Project folders are not a grouping axis.
 */
export function groupThreadsForSideNav(
  threads: ChatThreadSummary[],
): ThreadProjectGroup[] {
  const safeThreads = threads ?? [];
  const scheduled: ChatThreadSummary[] = [];
  const channels: ChatThreadSummary[] = [];
  const agents: ChatThreadSummary[] = [];

  for (const thread of safeThreads) {
    if (isScheduledTaskThread(thread)) {
      scheduled.push(thread);
      continue;
    }
    if (isChannelThread(thread)) {
      channels.push(thread);
      continue;
    }
    agents.push(thread);
  }

  return [
    iaSection("channels", CHANNELS_GROUP_KEY, CHANNELS_GROUP_NAME, channels),
    iaSection("agents", AGENTS_GROUP_KEY, AGENTS_GROUP_NAME, agents),
    iaSection(
      "scheduled_tasks",
      SCHEDULED_TASKS_GROUP_KEY,
      SCHEDULED_TASKS_GROUP_NAME,
      sortScheduledTaskThreads(scheduled),
    ),
  ];
}
