import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addChannelMember,
  createChannel,
  deleteChannel,
  getChannel,
  removeChannelMember,
  setChannelLead,
} from "./channels.js";
import type { Channel } from "./types.js";

vi.mock("./client.js", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "./client.js";

const channelBody = {
  thread_id: "thread-room",
  name: "Deal room",
  title: "Deal room",
  kind: "group",
  lead_agent_id: "agent-legal",
  members: [
    { agent_id: "agent-legal", joined_at: "2026-08-23T00:00:00.000Z" },
    { agent_id: "agent-ops", joined_at: "2026-08-23T00:00:01.000Z" },
  ],
  created_at: "2026-08-23T00:00:00.000Z",
  avatar_seed: "seed",
  title_source: "user",
  project_id: null,
  project_vault_path: null,
};

describe("channels API (lp-cxhb.7)", () => {
  afterEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("POSTs /api/channels to create", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => channelBody,
    } as Response);
    await expect(
      createChannel({
        name: "Deal room",
        member_agent_ids: ["agent-legal", "agent-ops"],
      }),
    ).resolves.toMatchObject({
      thread_id: "thread-room",
      lead_agent_id: "agent-legal",
    });
    expect(apiFetch).toHaveBeenCalledWith("/api/channels", {
      method: "POST",
      body: JSON.stringify({
        name: "Deal room",
        member_agent_ids: ["agent-legal", "agent-ops"],
      }),
    });
  });

  it("GETs /api/channels/:id", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => channelBody,
    } as Response);
    await expect(getChannel("thread-room")).resolves.toMatchObject({
      lead_agent_id: "agent-legal",
      members: [
        { agent_id: "agent-legal", joined_at: "2026-08-23T00:00:00.000Z" },
        { agent_id: "agent-ops", joined_at: "2026-08-23T00:00:01.000Z" },
      ],
    });
    expect(apiFetch).toHaveBeenCalledWith("/api/channels/thread-room");
  });

  it("PATCHes /api/channels/:id with lead_agent_id", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ...channelBody, lead_agent_id: "agent-ops" }),
    } as Response);
    await expect(
      setChannelLead("thread-room", "agent-ops"),
    ).resolves.toMatchObject({ lead_agent_id: "agent-ops" });
    expect(apiFetch).toHaveBeenCalledWith("/api/channels/thread-room", {
      method: "PATCH",
      body: JSON.stringify({ lead_agent_id: "agent-ops" }),
    });
  });
});

const channel: Channel = {
  thread_id: "ch-1",
  name: "Deal room",
  kind: "group",
  lead_agent_id: "agent-legal",
  members: [
    { agent_id: "agent-legal", joined_at: "2026-08-01T00:00:00.000Z" },
    { agent_id: "agent-ops", joined_at: "2026-08-01T00:00:00.001Z" },
  ],
  created_at: "2026-08-01T00:00:02.000Z",
  title: "Deal room",
  avatar_seed: "seed-ch",
  title_source: "user",
  project_id: null,
  project_vault_path: null,
};

describe("channel membership API (lp-cxhb.6)", () => {
  afterEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("GET /api/channels/:id", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => channel,
    } as Response);
    await expect(getChannel("ch-1")).resolves.toMatchObject({
      thread_id: "ch-1",
      kind: "group",
    });
    expect(apiFetch).toHaveBeenCalledWith("/api/channels/ch-1");
  });

  it("POST /api/channels/:id/members", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        ...channel,
        members: [
          ...channel.members,
          { agent_id: "agent-fin", joined_at: "2026-08-01T00:00:03.000Z" },
        ],
      }),
    } as Response);
    const next = await addChannelMember("ch-1", "agent-fin");
    expect(next.members.map((row) => row.agent_id)).toContain("agent-fin");
    expect(apiFetch).toHaveBeenCalledWith("/api/channels/ch-1/members", {
      method: "POST",
      body: JSON.stringify({ agent_id: "agent-fin" }),
    });
  });

  it("DELETE /api/channels/:id/members/:agentId surfaces floor errors", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "Channel needs at least 2 members" }),
    } as Response);
    await expect(removeChannelMember("ch-1", "agent-legal")).rejects.toThrow(
      /at least 2 members/i,
    );
  });

  it("DELETE /api/channels/:id", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);
    await expect(deleteChannel("ch-1")).resolves.toBeUndefined();
    expect(apiFetch).toHaveBeenCalledWith("/api/channels/ch-1", {
      method: "DELETE",
    });
  });
});

