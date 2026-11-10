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

import type { DurableAgent } from "../../api/types.js";

import { NewScheduledTaskDialog } from "./NewScheduledTaskDialog.js";

const listAgents = vi.fn();
const createAgent = vi.fn();

vi.mock("../../api/agents.js", () => ({
  listAgents: (...args: unknown[]) => listAgents(...args),
  createAgent: (...args: unknown[]) => createAgent(...args),
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

function renderDialog(
  onBound = vi.fn(),
  onOpenChange = vi.fn(),
) {
  return render(
    <Theme theme={neutralTheme}>
      <NewScheduledTaskDialog
        isOpen
        onOpenChange={onOpenChange}
        onBound={onBound}
      />
    </Theme>,
  );
}

function continueButton() {
  return screen.getByRole("button", { name: "Continue" });
}

function isDisabledControl(el: HTMLElement): boolean {
  return (
    el.hasAttribute("disabled") ||
    el.getAttribute("aria-disabled") === "true" ||
    (el as HTMLButtonElement).disabled === true
  );
}

describe("NewScheduledTaskDialog (lp-cxhb.11 I14)", () => {
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
  });

  afterEach(() => {
    cleanup();
  });

  it("I14: cannot continue without one agent", async () => {
    renderDialog();
    await screen.findByText("Legal");
    expect(isDisabledControl(continueButton())).toBe(true);
  });

  it("I14: pick one existing agent and continue", async () => {
    const onBound = vi.fn();
    const onOpenChange = vi.fn();
    renderDialog(onBound, onOpenChange);
    await screen.findByText("Legal");
    fireEvent.click(screen.getByText("Legal"));
    expect(isDisabledControl(continueButton())).toBe(false);
    fireEvent.click(continueButton());
    await waitFor(() => {
      expect(onBound).toHaveBeenCalledWith(legal);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("I14: empty catalog, create one agent, then continue", async () => {
    listAgents.mockResolvedValue([]);
    const onBound = vi.fn();
    renderDialog(onBound);
    expect(
      await screen.findByText("No agents yet. Create one to continue."),
    ).toBeTruthy();
    expect(isDisabledControl(continueButton())).toBe(true);

    fireEvent.change(screen.getByLabelText("New agent name"), {
      target: { value: "Skip" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add agent" }));
    expect(await screen.findByText("Skip")).toBeTruthy();
    expect(isDisabledControl(continueButton())).toBe(false);

    fireEvent.click(continueButton());
    await waitFor(() => {
      expect(createAgent).toHaveBeenCalledTimes(1);
      expect(onBound).toHaveBeenCalledWith(
        expect.objectContaining({
          agent_id: "agent-skip",
          name: "Skip",
          thread_id: "t-skip",
        }),
      );
    });
  });

  it("I14: picking a second agent replaces the first (one bind)", async () => {
    const onBound = vi.fn();
    renderDialog(onBound);
    await screen.findByText("Legal");
    fireEvent.click(screen.getByText("Legal"));
    fireEvent.click(screen.getByText("Ops"));
    fireEvent.click(continueButton());
    await waitFor(() => {
      expect(onBound).toHaveBeenCalledTimes(1);
      expect(onBound).toHaveBeenCalledWith(ops);
    });
  });
});
