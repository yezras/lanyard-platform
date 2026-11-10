import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createAgent,
  listAgents,
  renameAgent,
  threadSummaryFromDurableAgent,
} from "./agents.js";

vi.mock("./client.js", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "./client.js";

describe("createAgent", () => {
  afterEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("POSTs /api/agents and returns the catalog row plus 1:1 thread_id", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        agent_id: "agent-1",
        name: "Legal",
        avatar: "deadbeef",
        objective: "Review NDAs.",
        thread_id: "thread-1",
        created_at: "2026-08-23T00:00:00.000Z",
      }),
    } as Response);

    await expect(
      createAgent({
        name: "Legal",
        avatar: "deadbeef",
        objective: "Review NDAs.",
      }),
    ).resolves.toEqual({
      agent_id: "agent-1",
      name: "Legal",
      avatar: "deadbeef",
      objective: "Review NDAs.",
      thread_id: "thread-1",
      created_at: "2026-08-23T00:00:00.000Z",
    });

    expect(apiFetch).toHaveBeenCalledWith("/api/agents", {
      method: "POST",
      body: JSON.stringify({
        name: "Legal",
        avatar: "deadbeef",
        objective: "Review NDAs.",
      }),
    });
  });

  it("sends an empty object when the + New agent path supplies no fields", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        agent_id: "agent-2",
        name: "New agent",
        avatar: "seed",
        objective: "",
        thread_id: "thread-2",
        created_at: "2026-08-23T00:00:00.000Z",
      }),
    } as Response);

    const agent = await createAgent();
    expect(agent.agent_id).toBe("agent-2");
    expect(agent.thread_id).toBe("thread-2");
    expect(apiFetch).toHaveBeenCalledWith("/api/agents", {
      method: "POST",
      body: JSON.stringify({}),
    });
  });

  it("throws on a non-OK response", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: "Invalid agent" }),
    } as Response);

    await expect(createAgent({ name: "x" })).rejects.toThrow("Invalid agent");
  });
});

describe("renameAgent", () => {
  afterEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("PATCHes /api/agents/:id with {name}", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        agent_id: "agent-1",
        name: "Alice",
        avatar: "deadbeef",
        objective: "Review NDAs.",
        thread_id: "thread-1",
        created_at: "2026-08-23T00:00:00.000Z",
      }),
    } as Response);

    await expect(
      renameAgent({ agentId: "agent-1", name: "Alice" }),
    ).resolves.toEqual({
      agent_id: "agent-1",
      name: "Alice",
      avatar: "deadbeef",
      objective: "Review NDAs.",
      thread_id: "thread-1",
      created_at: "2026-08-23T00:00:00.000Z",
    });

    expect(apiFetch).toHaveBeenCalledWith("/api/agents/agent-1", {
      method: "PATCH",
      body: JSON.stringify({ name: "Alice" }),
    });
  });

  it("throws on a non-OK response", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "Agent not found" }),
    } as Response);

    await expect(
      renameAgent({ agentId: "missing", name: "Alice" }),
    ).rejects.toThrow("Agent not found");
  });
});

describe("listAgents", () => {
  afterEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("returns catalog rows from GET /api/agents", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        agents: [
          {
            agent_id: "agent-1",
            name: "Legal",
            avatar: "a",
            objective: "",
            thread_id: "thread-1",
            created_at: "2026-08-23T00:00:00.000Z",
          },
        ],
      }),
    } as Response);

    const listed = await listAgents();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.agent_id).toBe("agent-1");
    expect(apiFetch).toHaveBeenCalledWith("/api/agents");
  });
});

describe("threadSummaryFromDurableAgent", () => {
  it("maps the catalog person onto the one interactive 1:1", () => {
    const summary = threadSummaryFromDurableAgent({
      agent_id: "agent-1",
      name: "Legal",
      avatar: "deadbeef",
      objective: "Review NDAs.",
      thread_id: "thread-1",
      created_at: "2026-08-23T00:00:00.000Z",
    });
    expect(summary).toMatchObject({
      thread_id: "thread-1",
      title: "Legal",
      avatar_seed: "deadbeef",
      title_source: "user",
      kind: "chat",
      agent_id: "agent-1",
      system_prompt: "Review NDAs.",
      system_prompt_source: "user",
      access: "owner",
      scheduled_job_id: null,
    });
  });
});
