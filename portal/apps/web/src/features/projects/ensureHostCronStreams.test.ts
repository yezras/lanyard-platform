import { describe, expect, it, vi } from "vitest";

import type { ChatThreadSummary } from "../../api/types.js";

import {
  ensureAgentChatsForHostCrons,
  mergeEnsuredJobStreams,
} from "./ensureHostCronStreams.js";

function jobStream(
  partial: Partial<ChatThreadSummary> &
    Pick<ChatThreadSummary, "thread_id" | "scheduled_job_id" | "title">,
): ChatThreadSummary {
  return {
    project_id: null,
    project_vault_path: null,
    created_at: "2026-08-01T00:00:00.000Z",
    avatar_seed: "seed",
    title_source: "job",
    kind: "scheduled_task",
    access: "owner",
    ...partial,
  };
}

describe("ensureAgentChatsForHostCrons", () => {
  it("calls ensure for each host cron id (inventory SoT)", async () => {
    const ensure = vi.fn(async (input: { jobId: string; name: string }) => ({
      ...jobStream({
        thread_id: `t-${input.jobId}`,
        title: input.name,
        scheduled_job_id: input.jobId,
      }),
      created: true,
    }));

    const results = await ensureAgentChatsForHostCrons(
      [
        { id: "cron-a", name: "Daily digest" },
        { id: "cron-b", name: "Weekly report" },
      ],
      ensure,
    );

    expect(ensure).toHaveBeenCalledTimes(2);
    expect(ensure).toHaveBeenCalledWith({
      jobId: "cron-a",
      name: "Daily digest",
    });
    expect(ensure).toHaveBeenCalledWith({
      jobId: "cron-b",
      name: "Weekly report",
    });
    expect(results.map((r) => r.thread_id)).toEqual(["t-cron-a", "t-cron-b"]);
  });

  it("skips blank ids and uses id as name fallback", async () => {
    const ensure = vi.fn(async (input: { jobId: string; name: string }) => ({
      ...jobStream({
        thread_id: `t-${input.jobId}`,
        title: input.name,
        scheduled_job_id: input.jobId,
      }),
      created: false,
    }));

    await ensureAgentChatsForHostCrons(
      [
        { id: "  ", name: "noop" },
        { id: "cron-x", name: "  " },
        { id: "", name: "empty" },
      ],
      ensure,
    );

    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure).toHaveBeenCalledWith({ jobId: "cron-x", name: "cron-x" });
  });

  it("continues when an individual ensure fails", async () => {
    const ensure = vi.fn(async (input: { jobId: string; name: string }) => {
      if (input.jobId === "bad") {
        throw new Error("ensure failed");
      }
      return {
        ...jobStream({
          thread_id: `t-${input.jobId}`,
          title: input.name,
          scheduled_job_id: input.jobId,
        }),
        created: true,
      };
    });

    const results = await ensureAgentChatsForHostCrons(
      [
        { id: "bad", name: "Broken" },
        { id: "good", name: "Ok" },
      ],
      ensure,
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.scheduled_job_id).toBe("good");
  });

  it("returns empty for empty inventory without calling ensure", async () => {
    const ensure = vi.fn();
    await expect(ensureAgentChatsForHostCrons([], ensure)).resolves.toEqual([]);
    expect(ensure).not.toHaveBeenCalled();
  });
});

describe("mergeEnsuredJobStreams", () => {
  it("upserts by thread_id and replaces same scheduled_job_id", () => {
    const current: ChatThreadSummary[] = [
      {
        thread_id: "chat-1",
        title: "General chat",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-07-01T00:00:00.000Z",
        avatar_seed: "s",
        title_source: "default",
      },
      jobStream({
        thread_id: "old-stream",
        title: "Old name",
        scheduled_job_id: "cron-a",
      }),
    ];

    const ensured = [
      jobStream({
        thread_id: "new-stream",
        title: "Daily digest",
        scheduled_job_id: "cron-a",
      }),
      jobStream({
        thread_id: "t-cron-b",
        title: "Weekly",
        scheduled_job_id: "cron-b",
      }),
    ];

    const merged = mergeEnsuredJobStreams(current, ensured);
    expect(merged.map((t) => t.thread_id)).toEqual([
      "new-stream",
      "t-cron-b",
      "chat-1",
    ]);
    expect(merged.find((t) => t.thread_id === "old-stream")).toBeUndefined();
  });
});
