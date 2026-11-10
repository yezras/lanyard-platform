import { describe, expect, it } from "vitest";

import type { ChatThreadSummary } from "../../api/types.js";

import {
  AGENTS_GROUP_KEY,
  AGENTS_GROUP_NAME,
  CHANNELS_GROUP_KEY,
  CHANNELS_GROUP_NAME,
  groupThreadsForSideNav,
  visibleScheduledTaskThreads,
  isChannelThread,
  isScheduledTaskThread,
  SCHEDULED_TASKS_GROUP_KEY,
  SCHEDULED_TASKS_GROUP_NAME,
  sortScheduledTaskThreads,
  truncateThreadTitle,
} from "./threadGroups.js";

const threads: ChatThreadSummary[] = [
  {
    thread_id: "t1",
    title: "Alpha planning",
    project_id: "p1",
    project_vault_path: "/Projects/A",
    created_at: "2026-07-01T10:00:00.000Z",
    avatar_seed: "seed-t1",
    title_source: "default",
  },
  {
    thread_id: "t2",
    title: "General chat",
    project_id: null,
    project_vault_path: null,
    created_at: "2026-07-01T11:00:00.000Z",
    avatar_seed: "seed-t2",
    title_source: "default",
  },
  {
    thread_id: "t3",
    title: "More alpha",
    project_id: "p1",
    project_vault_path: "/Projects/A",
    created_at: "2026-07-01T12:00:00.000Z",
    avatar_seed: "seed-t3",
    title_source: "user",
  },
];

describe("truncateThreadTitle", () => {
  it("returns short text unchanged", () => {
    expect(truncateThreadTitle("Hello world")).toBe("Hello world");
  });

  it("truncates long text near 48 characters", () => {
    const long =
      "This is a very long first user message that should be truncated for the side nav";
    const title = truncateThreadTitle(long);
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(48);
  });

  it("normalizes whitespace", () => {
    expect(truncateThreadTitle("  hello   \n  world  ")).toBe("hello world");
  });
});

describe("isScheduledTaskThread", () => {
  it("matches kind=scheduled_task", () => {
    expect(
      isScheduledTaskThread({ kind: "scheduled_task", scheduled_job_id: null }),
    ).toBe(true);
  });

  it("matches bound scheduled_job_id even without kind", () => {
    expect(
      isScheduledTaskThread({ kind: "chat", scheduled_job_id: "cron-1" }),
    ).toBe(true);
    expect(
      isScheduledTaskThread({ scheduled_job_id: "cron-1" }),
    ).toBe(true);
  });

  it("rejects interactive chats", () => {
    expect(
      isScheduledTaskThread({ kind: "chat", scheduled_job_id: null }),
    ).toBe(false);
    expect(isScheduledTaskThread({})).toBe(false);
  });

  it("does not treat group channels as scheduled tasks", () => {
    expect(
      isScheduledTaskThread({ kind: "group", scheduled_job_id: null }),
    ).toBe(false);
  });
});

describe("isChannelThread", () => {
  it("matches kind=group", () => {
    expect(isChannelThread({ kind: "group" })).toBe(true);
    expect(isChannelThread({ kind: "chat" })).toBe(false);
    expect(isChannelThread({})).toBe(false);
  });
});

describe("sortScheduledTaskThreads", () => {
  it("sorts by title then created_at then thread_id", () => {
    const sorted = sortScheduledTaskThreads([
      {
        thread_id: "z",
        title: "Zebra",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-07-01T00:00:00.000Z",
        avatar_seed: "s",
        title_source: "job",
        kind: "scheduled_task",
        scheduled_job_id: "j-z",
      },
      {
        thread_id: "a2",
        title: "Alpha",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-07-02T00:00:00.000Z",
        avatar_seed: "s",
        title_source: "job",
        kind: "scheduled_task",
        scheduled_job_id: "j-a2",
      },
      {
        thread_id: "a1",
        title: "alpha",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-07-01T00:00:00.000Z",
        avatar_seed: "s",
        title_source: "job",
        kind: "scheduled_task",
        scheduled_job_id: "j-a1",
      },
    ]);
    expect(sorted.map((t) => t.thread_id)).toEqual(["a1", "a2", "z"]);
  });
});

describe("groupThreadsForSideNav (lp-cxhb.3 I1/I2)", () => {
  it("always returns Channels, Agents, Scheduled Tasks in that order", () => {
    const groups = groupThreadsForSideNav(threads);

    expect(groups.map((group) => group.kind)).toEqual([
      "channels",
      "agents",
      "scheduled_tasks",
    ]);
    expect(groups.map((group) => group.name)).toEqual([
      CHANNELS_GROUP_NAME,
      AGENTS_GROUP_NAME,
      SCHEDULED_TASKS_GROUP_NAME,
    ]);
    expect(groups.map((group) => group.key)).toEqual([
      CHANNELS_GROUP_KEY,
      AGENTS_GROUP_KEY,
      SCHEDULED_TASKS_GROUP_KEY,
    ]);
    expect(groups.every((group) => group.projectId === null)).toBe(true);
    expect(groups.every((group) => group.vaultPath === null)).toBe(true);
  });

  it("I1: lists interactive threads as agent rows, not project folders", () => {
    const groups = groupThreadsForSideNav(threads);
    const agents = groups.find((group) => group.kind === "agents");
    expect(agents?.threads.map((thread) => thread.thread_id)).toEqual([
      "t1",
      "t2",
      "t3",
    ]);
    expect(groups.some((group) => group.name === "Alpha")).toBe(false);
    expect(groups.some((group) => group.name === "General")).toBe(false);
    expect(groups.some((group) => group.name === "Beta")).toBe(false);
  });

  it("I2: empty catalog still shows the three IA sections, no Projects", () => {
    const groups = groupThreadsForSideNav([]);
    expect(groups).toHaveLength(3);
    expect(groups.map((group) => group.name)).toEqual([
      CHANNELS_GROUP_NAME,
      AGENTS_GROUP_NAME,
      SCHEDULED_TASKS_GROUP_NAME,
    ]);
    expect(groups[0]?.threads).toEqual([]);
    expect(groups[1]?.threads).toEqual([]);
    expect(groups[2]?.threads).toEqual([]);
  });

  it("puts orphan and project-bound chats under Agents", () => {
    const groups = groupThreadsForSideNav([
      {
        thread_id: "orphan",
        title: "Orphan chat",
        project_id: "gone",
        project_vault_path: "/Projects/Old",
        created_at: "2026-07-01T00:00:00.000Z",
        avatar_seed: "s",
        title_source: "default",
      },
    ]);
    const agents = groups.find((group) => group.kind === "agents");
    expect(agents?.threads.map((thread) => thread.thread_id)).toEqual([
      "orphan",
    ]);
  });

  it("I5: routes kind=group threads under Channels, not Agents", () => {
    const groups = groupThreadsForSideNav([
      {
        thread_id: "ch-1",
        title: "Deal room",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-08-01T00:00:00.000Z",
        avatar_seed: "s",
        title_source: "user",
        kind: "group",
      },
      {
        thread_id: "t-legal",
        title: "Legal",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-08-01T00:00:01.000Z",
        avatar_seed: "s",
        title_source: "user",
        kind: "chat",
      },
    ]);
    expect(
      groups.find((group) => group.kind === "channels")?.threads.map(
        (thread) => thread.thread_id,
      ),
    ).toEqual(["ch-1"]);
    expect(
      groups.find((group) => group.kind === "agents")?.threads.map(
        (thread) => thread.thread_id,
      ),
    ).toEqual(["t-legal"]);
  });

  it("I14: job streams with agent_id stay under Scheduled Tasks, never Agents/Channels", () => {
    const groups = groupThreadsForSideNav([
      ...threads,
      {
        thread_id: "job-daily",
        title: "Daily digest",
        project_id: "p1",
        project_vault_path: "/Projects/A",
        created_at: "2026-07-03T00:00:00.000Z",
        avatar_seed: "s",
        title_source: "job",
        kind: "scheduled_task",
        scheduled_job_id: "cron-daily",
        agent_id: "agent-legal",
      },
      {
        thread_id: "job-weekly",
        title: "Weekly report",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-07-02T00:00:00.000Z",
        avatar_seed: "s",
        title_source: "job",
        kind: "scheduled_task",
        scheduled_job_id: "cron-weekly",
      },
    ]);

    const scheduled = groups.find((g) => g.kind === "scheduled_tasks");
    expect(scheduled?.threads.map((t) => t.thread_id)).toEqual([
      "job-daily",
      "job-weekly",
    ]);

    const agents = groups.find((g) => g.kind === "agents");
    expect(agents?.threads.map((t) => t.thread_id)).toEqual(["t1", "t2", "t3"]);
    expect(agents?.threads.every((t) => !isScheduledTaskThread(t))).toBe(true);

    const channels = groups.find((g) => g.kind === "channels");
    expect(channels?.threads).toEqual([]);
  });

  it("shows only the selected agent's scheduled tasks", () => {
    const jobs = [
      {
        thread_id: "job-a",
        title: "Alpha digest",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-07-02T00:00:00.000Z",
        avatar_seed: "s",
        title_source: "job" as const,
        kind: "scheduled_task" as const,
        scheduled_job_id: "a:digest",
        agent_id: "agent-a",
      },
      {
        thread_id: "job-b",
        title: "Beta digest",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-07-03T00:00:00.000Z",
        avatar_seed: "s",
        title_source: "job" as const,
        kind: "scheduled_task" as const,
        scheduled_job_id: "b:digest",
        agent_id: "agent-b",
      },
    ];
    expect(
      visibleScheduledTaskThreads(jobs, "agent-a").map((thread) => thread.title),
    ).toEqual(["Alpha digest"]);
    expect(
      visibleScheduledTaskThreads(jobs, "agent-b").map((thread) => thread.title),
    ).toEqual(["Beta digest"]);
    expect(visibleScheduledTaskThreads(jobs, null)).toHaveLength(2);
  });
});
