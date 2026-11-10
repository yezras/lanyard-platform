import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";

import type { Channel, ChatThreadSummary, DurableAgent } from "../../api/types.js";

import { AgentChatHeader } from "./AgentChatHeader.js";
import {
  buildChannelMemberRows,
  findChannelForThread,
} from "./channelHeaderSheet.js";

vi.mock("../../api/channels.js", () => ({
  listChannels: vi.fn(async () => [makeChannel()]),
  addChannelMember: vi.fn(async () => makeChannel()),
  removeChannelMember: vi.fn(async () =>
    makeChannel({
      members: [
        { agent_id: "agent-a", joined_at: "2026-08-01T00:00:00.000Z" },
        { agent_id: "agent-b", joined_at: "2026-08-02T00:00:00.000Z" },
        { agent_id: "agent-c", joined_at: "2026-08-03T00:00:00.000Z" },
      ],
    }),
  ),
}));

vi.mock("../../api/agents.js", () => ({
  listAgents: vi.fn(async () => [
    makeAgent(),
    makeAgent({
      agent_id: "agent-b",
      name: "Borealis",
      objective: "Draft the weekly report",
    }),
  ]),
}));

import { addChannelMember, removeChannelMember } from "../../api/channels.js";
import { listAgents } from "../../api/agents.js";
import { listChannels } from "../../api/channels.js";

function makeThread(
  overrides: Partial<ChatThreadSummary> = {},
): ChatThreadSummary {
  return {
    thread_id: "chan-thread-1",
    title: "Ops room",
    project_id: null,
    project_vault_path: null,
    created_at: "2026-08-01T12:00:00.000Z",
    avatar_seed: "seed-chan",
    title_source: "user",
    kind: "group",
    scheduled_job_id: null,
    access: "owner",
    ...overrides,
  };
}

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    thread_id: "chan-thread-1",
    name: "Ops room",
    kind: "group",
    lead_agent_id: "agent-a",
    members: [
      { agent_id: "agent-a", joined_at: "2026-08-01T00:00:00.000Z" },
      { agent_id: "agent-b", joined_at: "2026-08-02T00:00:00.000Z" },
    ],
    created_at: "2026-08-01T12:00:00.000Z",
    title: "Ops room",
    avatar_seed: "seed-chan",
    title_source: "user",
    project_id: null,
    project_vault_path: null,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<DurableAgent> = {}): DurableAgent {
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

function sheetOpen(): boolean {
  return document.querySelector("dialog[open]") != null;
}

describe("AgentChatHeader channels (lp-cxhb.15.2)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps lead selector and member roster out of the chat chrome", () => {
    render(
      <Theme theme={neutralTheme}>
        <AgentChatHeader thread={makeThread()} canRename onRename={vi.fn()} />
      </Theme>,
    );

    // No roster rows, no lead affordance rendered inline in the header chrome.
    expect(screen.queryByTestId(/^channel-sheet-member-/)).toBeNull();
    expect(
      screen.getByTestId("agent-chat-header-title-button-chan-thread-1"),
    ).toBeTruthy();
    expect(listChannels).not.toHaveBeenCalled();
    expect(listAgents).not.toHaveBeenCalled();
  });

  it("opens members + purposes sheet from the channel title click", async () => {
    render(
      <Theme theme={neutralTheme}>
        <AgentChatHeader thread={makeThread()} canRename onRename={vi.fn()} />
      </Theme>,
    );

    const button = screen.getByTestId(
      "agent-chat-header-title-button-chan-thread-1",
    );
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(button.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(button);
    await waitFor(() => {
      expect(sheetOpen()).toBe(true);
    });
    expect(button.getAttribute("aria-expanded")).toBe("true");

    await waitFor(() => {
      expect(listChannels).toHaveBeenCalled();
    });

    const channel = findChannelForThread([makeChannel()], "chan-thread-1");
    const rows = buildChannelMemberRows(channel, [
      makeAgent(),
      makeAgent({
        agent_id: "agent-b",
        name: "Borealis",
        objective: "Draft the weekly report",
      }),
    ]);

    for (const row of rows) {
      await waitFor(() => {
        expect(
          screen.getByTestId(`channel-sheet-member-${row.agent_id}`),
        ).toBeTruthy();
      });
      // lp-8sh4.3: dither avatar beside every member name.
      expect(
        screen.getByTestId(`channel-sheet-avatar-${row.agent_id}`),
      ).toBeTruthy();
    }
    // Display names only — never a raw agent id (lp-8sh4.3).
    expect(screen.getByText("Atlas · Lead")).toBeTruthy();
    expect(screen.queryByText(/agent-a/)).toBeNull();
    expect(screen.getByText("Coordinate the ops room")).toBeTruthy();
    expect(screen.getByText("Borealis")).toBeTruthy();
    expect(screen.getByText("Draft the weekly report")).toBeTruthy();

    fireEvent.click(screen.getByTestId("channel-sheet-close-chan-thread-1"));
    await waitFor(() => {
      expect(sheetOpen()).toBe(false);
    });
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("does not open the purpose editor from a channel title click", async () => {
    const onSaveSystemPrompt = vi.fn().mockResolvedValue(undefined);
    render(
      <Theme theme={neutralTheme}>
        <AgentChatHeader
          thread={makeThread()}
          canRename
          onRename={vi.fn()}
          canEditSystemPrompt
          onSaveSystemPrompt={onSaveSystemPrompt}
        />
      </Theme>,
    );

    fireEvent.click(
      screen.getByTestId("agent-chat-header-title-button-chan-thread-1"),
    );

    await waitFor(() => {
      expect(sheetOpen()).toBe(true);
    });
    // Sheet subtitle — not the Purpose editor.
    expect(screen.getByText("Members and purposes")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Purpose" })).toBeNull();
  });

  it("1:1 chat header keeps its ghost UI — no title-button affordance", async () => {
    const onSaveSystemPrompt = vi.fn().mockResolvedValue(undefined);
    render(
      <Theme theme={neutralTheme}>
        <AgentChatHeader
          thread={makeThread({
            thread_id: "thread-dm",
            title: "Atlas",
            kind: "chat",
          })}
          canRename
          onRename={vi.fn()}
          canEditSystemPrompt
          onSaveSystemPrompt={onSaveSystemPrompt}
        />
      </Theme>,
    );

    // No button affordance added for 1:1.
    expect(
      screen.queryByTestId("agent-chat-header-title-button-thread-dm"),
    ).toBeNull();

    // Legacy single-click opens the purpose editor, not a member sheet.
    fireEvent.click(screen.getByTestId("agent-chat-header-title-wrap-thread-dm"));
    await waitFor(
      () => {
        expect(sheetOpen()).toBe(true);
      },
      { timeout: 1000 },
    );
    expect(screen.getByRole("heading", { name: "Purpose" })).toBeTruthy();
    expect(screen.queryByText("Members and purposes")).toBeNull();
  });

  it("member management lives in the sheet; remove disabled at floor of two (lp-rxr9)", async () => {
    render(
      <Theme theme={neutralTheme}>
        <AgentChatHeader thread={makeThread()} canRename onRename={vi.fn()} />
      </Theme>,
    );

    fireEvent.click(
      screen.getByTestId("agent-chat-header-title-button-chan-thread-1"),
    );
    await waitFor(() => {
      expect(sheetOpen()).toBe(true);
    });

    await waitFor(() => {
      expect(screen.getByTestId("channel-sheet-member-agent-a")).toBeTruthy();
    });
    expect(screen.getByText("Atlas · Lead")).toBeTruthy();

    const removeA = screen.getByTestId("channel-sheet-remove-agent-a") as HTMLButtonElement;
    const removeB = screen.getByTestId("channel-sheet-remove-agent-b") as HTMLButtonElement;
    expect(removeA).toBeTruthy();
    expect(removeB).toBeTruthy();
    expect(removeA.disabled).toBe(true);
    expect(removeB.disabled).toBe(true);

    expect(
      screen.getByTestId("channel-sheet-floor-hint-chan-thread-1"),
    ).toBeTruthy();
    expect(screen.queryByTestId(/^channel-sheet-add-/)).toBeNull();

    fireEvent.click(screen.getByTestId("channel-sheet-close-chan-thread-1"));
    await waitFor(() => {
      expect(sheetOpen()).toBe(false);
    });
  });

  it("removes a member when above the floor (lp-rxr9)", async () => {
    (listChannels as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      makeChannel({
        members: [
          { agent_id: "agent-a", joined_at: "2026-08-01T00:00:00.000Z" },
          { agent_id: "agent-b", joined_at: "2026-08-02T00:00:00.000Z" },
          { agent_id: "agent-c", joined_at: "2026-08-03T00:00:00.000Z" },
        ],
      }),
    ]);

    render(
      <Theme theme={neutralTheme}>
        <AgentChatHeader thread={makeThread()} canRename onRename={vi.fn()} />
      </Theme>,
    );

    fireEvent.click(
      screen.getByTestId("agent-chat-header-title-button-chan-thread-1"),
    );
    await waitFor(() => {
      expect(sheetOpen()).toBe(true);
    });

    const removeC = await waitFor(() => {
      const row = screen.getByTestId(`channel-sheet-member-agent-c`);
      return row.querySelector(
        '[data-testid="channel-sheet-remove-agent-c"]',
      ) as HTMLButtonElement;
    });
    expect(removeC.disabled).toBe(false);

    fireEvent.click(removeC);
    await waitFor(() => {
      expect(removeChannelMember).toHaveBeenCalledWith(
        "chan-thread-1",
        "agent-c",
      );
    });
    expect(addChannelMember).not.toHaveBeenCalled();
  });

  it("lists non-member agents under Add agents and adds on click (lp-rxr9)", async () => {
    (listAgents as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      makeAgent(),
      makeAgent({
        agent_id: "agent-b",
        name: "Borealis",
        objective: "Draft the weekly report",
      }),
      makeAgent({
        agent_id: "agent-c",
        name: "Cygnus",
        objective: "Field research",
      }),
    ]);

    render(
      <Theme theme={neutralTheme}>
        <AgentChatHeader thread={makeThread()} canRename onRename={vi.fn()} />
      </Theme>,
    );

    fireEvent.click(
      screen.getByTestId("agent-chat-header-title-button-chan-thread-1"),
    );
    await waitFor(() => {
      expect(sheetOpen()).toBe(true);
    });

    const addC = await waitFor(() => {
      return screen.getByTestId(`channel-sheet-add-agent-c`) as HTMLElement;
    });
    expect(screen.getByText("Cygnus")).toBeTruthy();
    expect(
      screen.getByTestId(`channel-sheet-avatar-agent-c`),
    ).toBeTruthy();

    fireEvent.click(addC);
    await waitFor(() => {
      expect(addChannelMember).toHaveBeenCalledWith(
        "chan-thread-1",
        "agent-c",
      );
    });
    expect(removeChannelMember).not.toHaveBeenCalled();
  });
});
