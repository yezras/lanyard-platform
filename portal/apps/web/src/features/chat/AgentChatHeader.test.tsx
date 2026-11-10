import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";

import { GROUP_ROOM_FIXTURE_PARTICIPANTS } from "../../api/groupRoom.js";
import type { ChatThreadSummary } from "../../api/types.js";

import { AgentChatHeader } from "./AgentChatHeader.js";

vi.mock("../../api/channels.js", () => ({
  getChannel: vi.fn().mockResolvedValue(null),
  setChannelLead: vi.fn(),
  listChannels: vi.fn().mockResolvedValue([]),
  createChannel: vi.fn(),
}));

vi.mock("../../api/agents.js", () => ({
  listAgents: vi.fn().mockResolvedValue([]),
}));

function makeThread(
  overrides: Partial<ChatThreadSummary> = {},
): ChatThreadSummary {
  return {
    thread_id: "thread-1",
    title: "Header agent",
    project_id: "p1",
    project_vault_path: "/Projects/A",
    created_at: "2026-07-01T12:00:00.000Z",
    avatar_seed: "seed-header",
    title_source: "default",
    kind: "chat",
    scheduled_job_id: null,
    system_prompt: "Existing purpose",
    system_prompt_source: "llm",
    access: "owner",
    ...overrides,
  };
}

/** Astryx Dialog keeps children mounted when closed; open state is dialog[open]. */
function purposeDialogOpen(): boolean {
  return document.querySelector("dialog[open]") != null;
}

describe("AgentChatHeader", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows dither avatar and title; double-click renames when allowed", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(
      <Theme theme={neutralTheme}>
        <AgentChatHeader
          thread={makeThread()}
          canRename
          onRename={onRename}
        />
      </Theme>,
    );

    expect(screen.getByTestId("agent-chat-header-thread-1")).toBeTruthy();
    expect(
      screen.getByTestId("agent-chat-header-avatar-thread-1").getAttribute(
        "data-avatar-seed",
      ),
    ).toBe("seed-header");
    expect(screen.getByText("Header agent")).toBeTruthy();

    fireEvent.doubleClick(
      screen.getByTestId("agent-chat-header-title-thread-1"),
    );
    const input = screen.getByLabelText("Agent name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "From header" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith("From header");
    });
  });

  it("does not enter edit when canRename is false", () => {
    render(
      <Theme theme={neutralTheme}>
        <AgentChatHeader
          thread={makeThread({ access: "read" })}
          canRename={false}
          onRename={vi.fn()}
        />
      </Theme>,
    );

    fireEvent.doubleClick(
      screen.getByTestId("agent-chat-header-title-thread-1"),
    );
    expect(screen.queryByLabelText("Agent name")).toBeNull();
  });

  it("single-click opens Purpose dialog; save sets user purpose (lp-pxr.4)", async () => {
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

    fireEvent.click(screen.getByTestId("agent-chat-header-title-wrap-thread-1"));

    await waitFor(
      () => {
        expect(purposeDialogOpen()).toBe(true);
      },
      { timeout: 1000 },
    );

    // Dialog title is Purpose — not "System prompt".
    expect(screen.getByRole("heading", { name: "Purpose" })).toBeTruthy();
    expect(screen.queryByText(/System prompt/i)).toBeNull();

    const textarea = screen.getByTestId(
      "agent-system-prompt-input-thread-1",
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Existing purpose");

    // Astryx TextArea onChange receives the string value directly.
    fireEvent.change(textarea, {
      target: { value: "User edited purpose for this chat" },
    });
    fireEvent.click(screen.getByTestId("agent-system-prompt-save-thread-1"));

    await waitFor(() => {
      expect(onSaveSystemPrompt).toHaveBeenCalledWith(
        "User edited purpose for this chat",
      );
    });
    await waitFor(() => {
      expect(purposeDialogOpen()).toBe(false);
    });
  });

  it("Cancel discards draft and does not save (lp-pxr.4)", async () => {
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

    fireEvent.click(screen.getByTestId("agent-chat-header-title-wrap-thread-1"));

    await waitFor(
      () => {
        expect(purposeDialogOpen()).toBe(true);
      },
      { timeout: 1000 },
    );

    const textarea = screen.getByTestId(
      "agent-system-prompt-input-thread-1",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: "Discarded draft purpose" },
    });
    expect(textarea.value).toBe("Discarded draft purpose");

    fireEvent.click(screen.getByTestId("agent-system-prompt-cancel-thread-1"));

    await waitFor(() => {
      expect(purposeDialogOpen()).toBe(false);
    });
    expect(onSaveSystemPrompt).not.toHaveBeenCalled();

    // Re-open: draft must reset to persisted purpose.
    fireEvent.click(screen.getByTestId("agent-chat-header-title-wrap-thread-1"));
    await waitFor(
      () => {
        expect(purposeDialogOpen()).toBe(true);
      },
      { timeout: 1000 },
    );
    expect(
      (
        screen.getByTestId(
          "agent-system-prompt-input-thread-1",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("Existing purpose");
  });

  it("double-click does not open purpose dialog", async () => {
    const onSaveSystemPrompt = vi.fn().mockResolvedValue(undefined);
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(
      <Theme theme={neutralTheme}>
        <AgentChatHeader
          thread={makeThread()}
          canRename
          onRename={onRename}
          canEditSystemPrompt
          onSaveSystemPrompt={onSaveSystemPrompt}
        />
      </Theme>,
    );

    fireEvent.doubleClick(
      screen.getByTestId("agent-chat-header-title-thread-1"),
    );

    // Rename editor opens; purpose dialog must stay closed.
    expect(screen.getByLabelText("Agent name")).toBeTruthy();
    expect(purposeDialogOpen()).toBe(false);
    await new Promise((r) => setTimeout(r, 350));
    expect(purposeDialogOpen()).toBe(false);
  });

  it("U1: group header keeps roster out of chrome; members live behind title click", async () => {
    const { fireEvent } = await import("@testing-library/react");
    render(
      <Theme theme={neutralTheme}>
        <AgentChatHeader
          thread={makeThread({
            thread_id: "room-1",
            title: "Review room",
            kind: "group",
            participants: GROUP_ROOM_FIXTURE_PARTICIPANTS,
            orchestrator_persona_id: "skip",
          })}
          canRename={false}
        />
      </Theme>,
    );

    // lp-cxhb.15.2: no roster / lead selector in the chat chrome.
    expect(screen.queryByTestId("group-room-roster")).toBeNull();
    expect(
      screen.queryByTestId("channel-lead-select-room-1"),
    ).toBeNull();
    expect(screen.queryByTestId("agent-chat-header-avatar-room-1")).toBeNull();
    // Title is a button that opens the members+purposes sheet.
    const titleButton = screen.getByTestId(
      "agent-chat-header-title-button-room-1",
    );
    expect(titleButton.getAttribute("aria-haspopup")).toBe("dialog");
    fireEvent.click(titleButton);
    await new Promise((r) => setTimeout(r, 0));
  });
});
