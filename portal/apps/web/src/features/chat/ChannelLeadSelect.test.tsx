import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";

import { ChannelLeadSelect } from "./ChannelLeadSelect.js";

const getChannel = vi.fn();
const setChannelLead = vi.fn();
const listAgents = vi.fn();

vi.mock("../../api/channels.js", () => ({
  getChannel: (...args: unknown[]) => getChannel(...args),
  setChannelLead: (...args: unknown[]) => setChannelLead(...args),
}));

vi.mock("../../api/agents.js", () => ({
  listAgents: (...args: unknown[]) => listAgents(...args),
}));

const channel = {
  thread_id: "thread-room",
  name: "Deal room",
  kind: "group" as const,
  lead_agent_id: "agent-legal",
  members: [
    { agent_id: "agent-legal", joined_at: "2026-08-23T00:00:00.000Z" },
    { agent_id: "agent-ops", joined_at: "2026-08-23T00:00:01.000Z" },
  ],
  created_at: "2026-08-23T00:00:00.000Z",
  title: "Deal room",
  avatar_seed: "seed",
  title_source: "user" as const,
  project_id: null,
  project_vault_path: null,
};

describe("ChannelLeadSelect (lp-cxhb.7 I9)", () => {
  afterEach(() => {
    cleanup();
    getChannel.mockReset();
    setChannelLead.mockReset();
    listAgents.mockReset();
  });

  it("shows the create-time lead and lets the user change it", async () => {
    getChannel.mockResolvedValue(channel);
    listAgents.mockResolvedValue([
      {
        agent_id: "agent-legal",
        name: "Legal",
        avatar: "a",
        objective: "",
        thread_id: "t-legal",
        created_at: "2026-08-23T00:00:00.000Z",
      },
      {
        agent_id: "agent-ops",
        name: "Ops",
        avatar: "b",
        objective: "",
        thread_id: "t-ops",
        created_at: "2026-08-23T00:00:00.000Z",
      },
    ]);
    setChannelLead.mockResolvedValue({
      ...channel,
      lead_agent_id: "agent-ops",
    });

    render(
      <Theme theme={neutralTheme}>
        <ChannelLeadSelect threadId="thread-room" />
      </Theme>,
    );

    const select = (await screen.findByTestId(
      "channel-lead-select-input-thread-room",
    )) as HTMLSelectElement;
    expect(select.value).toBe("agent-legal");
    expect(screen.getByRole("option", { name: "Legal" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Ops" })).toBeTruthy();

    fireEvent.change(select, { target: { value: "agent-ops" } });
    await waitFor(() => {
      expect(setChannelLead).toHaveBeenCalledWith("thread-room", "agent-ops");
    });
    await waitFor(() => {
      expect(
        (screen.getByTestId(
          "channel-lead-select-input-thread-room",
        ) as HTMLSelectElement).value,
      ).toBe("agent-ops");
    });
  });
});
