import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";

import type { Channel, DurableAgent } from "../../api/types.js";

import { NewChannelDialog } from "./NewChannelDialog.js";

const listAgents = vi.fn();
const createAgent = vi.fn();
const createChannel = vi.fn();

vi.mock("../../api/agents.js", () => ({
  listAgents: (...args: unknown[]) => listAgents(...args),
  createAgent: (...args: unknown[]) => createAgent(...args),
}));

vi.mock("../../api/channels.js", () => ({
  createChannel: (...args: unknown[]) => createChannel(...args),
  getChannel: vi.fn(),
  setChannelLead: vi.fn(),
  listChannels: vi.fn().mockResolvedValue([]),
}));

const legal: DurableAgent = {
  agent_id: "agent-legal",
  name: "Legal",
  avatar: "seed-legal",
  objective: "",
  thread_id: "t-legal",
  created_at: "2026-08-01T00:00:00.000Z",
};
const ops: DurableAgent = {
  agent_id: "agent-ops",
  name: "Ops",
  avatar: "seed-ops",
  objective: "",
  thread_id: "t-ops",
  created_at: "2026-08-01T00:00:01.000Z",
};

const createdChannel: Channel = {
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

function renderDialog(
  onCreated = vi.fn(),
  onOpenChange = vi.fn(),
) {
  return render(
    <Theme theme={neutralTheme}>
      <NewChannelDialog
        isOpen
        onOpenChange={onOpenChange}
        onCreated={onCreated}
      />
    </Theme>,
  );
}

function submitButton() {
  return screen.getByRole("button", { name: "Create channel" });
}

function isDisabledControl(el: HTMLElement): boolean {
  return (
    el.hasAttribute("disabled") ||
    el.getAttribute("aria-disabled") === "true" ||
    (el as HTMLButtonElement).disabled === true
  );
}

describe("NewChannelDialog (lp-cxhb.5 I4/I5/I6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listAgents.mockResolvedValue([legal, ops]);
    createAgent.mockImplementation(async (input: { name: string }) => ({
      agent_id: `agent-${input.name.toLowerCase()}`,
      name: input.name,
      avatar: "seed",
      objective: "",
      thread_id: `t-${input.name.toLowerCase()}`,
      created_at: "2026-08-01T00:00:03.000Z",
    }));
    createChannel.mockResolvedValue(createdChannel);
  });

  afterEach(() => {
    cleanup();
  });

  it("I4: cannot submit without two members", async () => {
    renderDialog();
    await screen.findByText("Legal");
    fireEvent.change(screen.getByLabelText("Channel name"), {
      target: { value: "Deal room" },
    });
    expect(isDisabledControl(submitButton())).toBe(true);

    fireEvent.click(screen.getByText("Legal"));
    expect(isDisabledControl(submitButton())).toBe(true);
    expect(createChannel).not.toHaveBeenCalled();
  });

  it("lp-8sh4.2: agents render as dither icon + name chips and toggle", async () => {
    renderDialog();
    await screen.findByText("Legal");

    expect(
      screen.queryByText("Name the room and pick at least two agents."),
    ).toBeNull();
    expect(screen.queryByTestId("channel-member-count")).toBeNull();

    const legalChip = screen.getByTestId("channel-member-pick-agent-legal");
    expect(legalChip.querySelector('[data-testid="dither-avatar"]')).toBeTruthy();
    expect(legalChip.getAttribute("data-avatar-seed") ?? legalChip.querySelector('[data-testid="dither-avatar"]')?.getAttribute("data-avatar-seed")).toBe("seed-legal");

    fireEvent.click(screen.getByText("Legal"));
    fireEvent.click(screen.getByText("Legal"));
    fireEvent.change(screen.getByLabelText("Channel name"), {
      target: { value: "Deal room" },
    });
    expect(isDisabledControl(submitButton())).toBe(true);
    expect(createChannel).not.toHaveBeenCalled();
  });

  it("I5: name plus two picked agents creates a channel", async () => {
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    renderDialog(onCreated, onOpenChange);
    await screen.findByText("Legal");
    fireEvent.change(screen.getByLabelText("Channel name"), {
      target: { value: "Deal room" },
    });
    fireEvent.click(screen.getByText("Legal"));
    fireEvent.click(screen.getByText("Ops"));
    expect(isDisabledControl(submitButton())).toBe(false);
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(createChannel).toHaveBeenCalledWith({
        name: "Deal room",
        member_agent_ids: ["agent-legal", "agent-ops"],
      });
    });
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(createdChannel);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("I6: empty catalog, create two agents, then submit", async () => {
    listAgents.mockResolvedValue([]);
    const onCreated = vi.fn();
    renderDialog(onCreated);
    expect(
      await screen.findByText("No agents yet. Create two members to continue."),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Channel name"), {
      target: { value: "Fresh room" },
    });
    expect(isDisabledControl(submitButton())).toBe(true);

    fireEvent.change(screen.getByLabelText("New agent name"), {
      target: { value: "Skip" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add agent" }));
    expect(await screen.findByText("Skip")).toBeTruthy();
    expect(isDisabledControl(submitButton())).toBe(true);

    fireEvent.change(screen.getByLabelText("New agent name"), {
      target: { value: "Lev" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add agent" }));
    expect(await screen.findByText("Lev")).toBeTruthy();
    expect(isDisabledControl(submitButton())).toBe(false);

    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(createAgent).toHaveBeenCalledTimes(2);
      expect(createChannel).toHaveBeenCalledWith({
        name: "Fresh room",
        member_agent_ids: ["agent-skip", "agent-lev"],
      });
    });
  });
});
