import { describe, expect, it } from "vitest";

import {
  avatarSeedFromThreadId,
  normalizeChatThreadSummary,
  resolveAvatarSeed,
} from "./threadMeta.js";

describe("avatarSeedFromThreadId", () => {
  it("is stable for the same thread_id", () => {
    const a = avatarSeedFromThreadId("thread-abc");
    const b = avatarSeedFromThreadId("thread-abc");
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(1);
  });

  it("differs across thread ids", () => {
    expect(avatarSeedFromThreadId("thread-a")).not.toBe(
      avatarSeedFromThreadId("thread-b"),
    );
  });
});

describe("resolveAvatarSeed", () => {
  it("prefers stored seed over hash fallback", () => {
    expect(
      resolveAvatarSeed({
        thread_id: "thread-1",
        avatar_seed: "deadbeef",
      }),
    ).toBe("deadbeef");
  });

  it("falls back to thread_id hash when seed empty", () => {
    const seed = resolveAvatarSeed({
      thread_id: "thread-1",
      avatar_seed: "",
    });
    expect(seed).toBe(avatarSeedFromThreadId("thread-1"));
  });

  it("accepts numeric seeds", () => {
    expect(
      resolveAvatarSeed({ thread_id: "t", avatar_seed: 42 }),
    ).toBe("42");
  });
});

describe("normalizeChatThreadSummary", () => {
  it("backfills missing avatar_seed and title_source", () => {
    const normalized = normalizeChatThreadSummary({
      thread_id: "legacy-1",
      title: "Old chat",
      project_id: null,
      project_vault_path: null,
      created_at: "2026-01-01T00:00:00.000Z",
    });
    expect(normalized.avatar_seed).toBe(avatarSeedFromThreadId("legacy-1"));
    expect(normalized.title_source).toBe("default");
    expect(normalized.kind).toBe("chat");
    expect(normalized.scheduled_job_id).toBeNull();
  });

  it("preserves server-assigned seed and title_source", () => {
    const normalized = normalizeChatThreadSummary({
      thread_id: "t1",
      title: "Renamed",
      project_id: "p1",
      project_vault_path: "/p",
      created_at: "2026-01-01T00:00:00.000Z",
      avatar_seed: "aabbccdd",
      title_source: "user",
      access: "owner",
    });
    expect(normalized.avatar_seed).toBe("aabbccdd");
    expect(normalized.title_source).toBe("user");
    expect(normalized.access).toBe("owner");
  });

  it("preserves job stream binding fields (lp-fn5.5.1)", () => {
    const normalized = normalizeChatThreadSummary({
      thread_id: "t-job",
      title: "Daily digest",
      project_id: null,
      project_vault_path: null,
      created_at: "2026-01-01T00:00:00.000Z",
      avatar_seed: "seed1",
      title_source: "job",
      kind: "scheduled_task",
      scheduled_job_id: "job-123",
    });
    expect(normalized.kind).toBe("scheduled_task");
    expect(normalized.scheduled_job_id).toBe("job-123");
    expect(normalized.title_source).toBe("job");
  });

  it("preserves kind=group for channels (lp-cxhb.5)", () => {
    const normalized = normalizeChatThreadSummary({
      thread_id: "ch-1",
      title: "Deal room",
      created_at: "2026-08-01T00:00:00.000Z",
      kind: "group",
      title_source: "user",
    });
    expect(normalized.kind).toBe("group");
  });

  it("infers scheduled_task kind when scheduled_job_id is present", () => {
    const normalized = normalizeChatThreadSummary({
      thread_id: "t-infer",
      title: "Weekly report",
      created_at: "2026-01-01T00:00:00.000Z",
      scheduled_job_id: "job-abc",
    });
    expect(normalized.kind).toBe("scheduled_task");
    expect(normalized.scheduled_job_id).toBe("job-abc");
  });

  it("preserves durable agent_id on interactive 1:1 rows (lp-cxhb.4)", () => {
    const normalized = normalizeChatThreadSummary({
      thread_id: "t-legal",
      title: "Legal",
      created_at: "2026-08-23T00:00:00.000Z",
      agent_id: "agent-legal",
    });
    expect(normalized.agent_id).toBe("agent-legal");
    expect(normalized.kind).toBe("chat");
  });

  it("preserves kind=group roster (lac-bx3.16)", () => {
    const normalized = normalizeChatThreadSummary({
      thread_id: "room-skip-lev-bana",
      title: "Review room",
      created_at: "2026-08-23T00:00:00.000Z",
      kind: "group",
      orchestrator_persona_id: "skip",
      participants: [
        { kind: "human", user_id: "usr_alice", display_name: "Alice" },
        { kind: "persona", persona_id: "skip", display_name: "Skip" },
        { kind: "persona", persona_id: "lev", display_name: "Lev" },
        { kind: "persona", persona_id: "bana", display_name: "Bana" },
      ],
    });
    expect(normalized.kind).toBe("group");
    expect(normalized.orchestrator_persona_id).toBe("skip");
    expect(normalized.participants?.map((p) =>
      p.kind === "persona" ? p.persona_id : p.user_id,
    )).toEqual(["usr_alice", "skip", "lev", "bana"]);
  });
});
