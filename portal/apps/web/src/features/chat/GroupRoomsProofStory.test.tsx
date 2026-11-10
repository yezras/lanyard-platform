import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GROUP_ROOM_FIXTURE_PARTICIPANTS } from "../../api/groupRoom.js";

import { GroupRoomsProofStory } from "./GroupRoomsProofStory.js";
import { buildComposerTriggers } from "./chatComposerTriggers.js";
import { rosterToSearchItems } from "./groupRoom.js";

afterEach(() => {
  cleanup();
});

describe("GroupRoomsProofStory", () => {
  it("U1-U4: title sheet, three speakers, nested Skip subagent, composer", () => {
    render(<GroupRoomsProofStory />);

    expect(screen.getByTestId("group-rooms-proof-story")).toBeTruthy();
    // lp-cxhb.15.2: roster is not in the chat chrome; the header exposes a
    // title button that opens members+purposes behind the click.
    expect(screen.queryByTestId("group-room-roster")).toBeNull();
    expect(
      screen.getByTestId("agent-chat-header-title-button-room-skip-lev-bana"),
    ).toBeTruthy();

    expect(screen.getByTestId("chat-speaker-persona-skip")).toBeTruthy();
    expect(screen.getByTestId("chat-speaker-persona-lev")).toBeTruthy();
    expect(screen.getByTestId("chat-speaker-persona-bana")).toBeTruthy();

    // lp-cxhb.15.3: channel rows keep the historical chat-turn-* testid; the
    // Skip run now has two grouped bubbles (first + last).
    const skipTurns = screen.getAllByTestId("chat-turn-persona-skip");
    expect(skipTurns.length).toBe(2);
    expect(skipTurns[0].getAttribute("data-channel-group")).toBe("first");
    expect(skipTurns[1].getAttribute("data-channel-group")).toBe("last");
    // lp-cxhb.15.4: channels hide the tool/activity dump — Skip's private
    // subagent renders no chip / avatar roster in the room transcript.
    expect(
      skipTurns[0].querySelector('[data-testid="dither-avatar-roster"]') ??
        skipTurns[0].querySelector('[data-testid="chat-subagent-chip-wrap"]'),
    ).toBeNull();
    expect(screen.queryByTestId("chat-speaker-persona-qa-helper")).toBeNull();

    expect(screen.getByTestId("group-rooms-composer")).toBeTruthy();
  });

  it("lp-cxhb.15.4: composer @ completion still targets the room roster", () => {
    render(<GroupRoomsProofStory />);

    // Same trigger wiring the story mounts: roster wins the @ trigger.
    const triggers = buildComposerTriggers({
      roster: rosterToSearchItems(GROUP_ROOM_FIXTURE_PARTICIPANTS),
    });
    const mention = triggers.find((t) => t.character === "@");
    expect(mention).toBeTruthy();
    expect(mention?.menuLabel).toBe("Room");
  });
});
