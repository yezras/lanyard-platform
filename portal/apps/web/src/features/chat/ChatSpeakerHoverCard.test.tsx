import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";

import type { ChatThreadSummary } from "../../api/types.js";

import {
  ChatSpeakerHoverCard,
  findAgentDmThread,
} from "./ChatSpeakerHoverCard.js";

const selectThread = vi.fn();

const threadsStub: ChatThreadSummary[] = [
  {
    thread_id: "dm-skip",
    title: "Skip",
    kind: "chat",
    agent_id: "skip",
    avatar_seed: "seed-skip",
    title_source: "user",
    project_id: null,
    project_vault_path: null,
  },
  {
    thread_id: "room-1",
    title: "Ops room",
    kind: "group",
    agent_id: null,
    avatar_seed: "seed-room",
    title_source: "user",
    project_id: null,
    project_vault_path: null,
  },
] as ChatThreadSummary[];

vi.mock("../projects/ChatThreadContext.js", () => ({
  useOptionalChatThread: () => ({
    threads: threadsStub,
    selectThread,
  }),
}));

const personaSpeaker = {
  kind: "persona" as const,
  id: "skip",
  display_name: "Skip",
};

function renderCard() {
  return render(
    <Theme theme={neutralTheme}>
      <ChatSpeakerHoverCard speaker={personaSpeaker}>
        <button type="button">Skip</button>
      </ChatSpeakerHoverCard>
    </Theme>,
  );
}

describe("findAgentDmThread", () => {
  it("matches the durable agent 1:1, never a group room", () => {
    expect(findAgentDmThread(threadsStub, "skip")?.thread_id).toBe("dm-skip");
    expect(findAgentDmThread(threadsStub, "ghost")).toBeNull();
  });
});

describe("ChatSpeakerHoverCard (lp-8sh4.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("hover shows the agent card and Message opens the 1:1", async () => {
    renderCard();
    const trigger = screen.getByRole("button", { name: "Skip" });
    fireEvent.focus(trigger);
    fireEvent.mouseEnter(trigger);

    expect(
      await screen.findByTestId("speaker-hover-card-skip"),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByTestId("speaker-hover-open-dm-skip"),
    );
    expect(selectThread).toHaveBeenCalledWith("dm-skip");
  });

  it("human speakers render the trigger without a hover card", () => {
    render(
      <Theme theme={neutralTheme}>
        <ChatSpeakerHoverCard
          speaker={{ kind: "human", id: "usr_alice", display_name: "Alice" }}
        >
          <button type="button">Alice</button>
        </ChatSpeakerHoverCard>
      </Theme>,
    );
    expect(screen.getByRole("button", { name: "Alice" })).toBeTruthy();
    fireEvent.focus(screen.getByRole("button", { name: "Alice" }));
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Alice" }));
    expect(screen.queryByTestId("speaker-hover-card-usr_alice")).toBeNull();
  });
});
