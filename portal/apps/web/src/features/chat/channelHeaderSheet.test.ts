import { describe, expect, it } from "vitest";

import type { Channel, DurableAgent } from "../../api/types.js";

import {
  buildChannelMemberRows,
  findChannelForThread,
  isChannelSheetEligible,
} from "./channelHeaderSheet.js";

function makeChannel(
  overrides: Partial<Channel> = {},
): Channel {
  return {
    thread_id: "chan-1",
    name: "Ops room",
    kind: "group",
    lead_agent_id: "agent-a",
    members: [
      { agent_id: "agent-a", joined_at: "2026-08-01T00:00:00.000Z" },
      { agent_id: "agent-b", joined_at: "2026-08-02T00:00:00.000Z" },
    ],
    created_at: "2026-08-01T00:00:00.000Z",
    title: "Ops room",
    avatar_seed: "seed",
    title_source: "user",
    project_id: null,
    project_vault_path: null,
    ...overrides,
  };
}

function makeAgent(
  overrides: Partial<DurableAgent> = {},
): DurableAgent {
  return {
    agent_id: "agent-a",
    name: "Atlas",
    avatar: "",
    objective: "Coordinate the ops room",
    thread_id: "thread-a",
    created_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("isChannelSheetEligible", () => {
  it("only group-kind threads get the header sheet", () => {
    expect(isChannelSheetEligible({ kind: "group" })).toBe(true);
    expect(isChannelSheetEligible({ kind: "chat" })).toBe(false);
    expect(isChannelSheetEligible({ kind: "scheduled_task" })).toBe(false);
    expect(isChannelSheetEligible(null)).toBe(false);
  });
});

describe("findChannelForThread", () => {
  it("matches by thread_id and returns null when absent", () => {
    const channels = [makeChannel(), makeChannel({ thread_id: "chan-2" })];
    expect(findChannelForThread(channels, "chan-2")?.thread_id).toBe("chan-2");
    expect(findChannelForThread(channels, "nope")).toBeNull();
  });
});

describe("buildChannelMemberRows", () => {
  it("maps members to names + purposes and flags the lead", () => {
    const rows = buildChannelMemberRows(makeChannel(), [
      makeAgent(),
      makeAgent({
        agent_id: "agent-b",
        name: "Borealis",
        objective: "Draft the weekly report",
      }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      agent_id: "agent-a",
      name: "Atlas",
      purpose: "Coordinate the ops room",
      isLead: true,
    });
    expect(rows[1]).toEqual({
      agent_id: "agent-b",
      name: "Borealis",
      purpose: "Draft the weekly report",
      isLead: false,
    });
  });

  it("falls back for members missing from the catalog without raw ids (lp-8sh4.3)", () => {
    const rows = buildChannelMemberRows(makeChannel(), []);
    expect(rows).toEqual([
      {
        agent_id: "agent-a",
        name: "Unknown agent",
        purpose: "",
        isLead: true,
      },
      {
        agent_id: "agent-b",
        name: "Unknown agent",
        purpose: "",
        isLead: false,
      },
    ]);
  });

  it("returns no rows without a channel roster", () => {
    expect(buildChannelMemberRows(null, [makeAgent()])).toEqual([]);
  });
});
