import { describe, expect, it } from "vitest";

import {
  GROUP_ROOM_FIXTURE_PARTICIPANTS,
  isGroupThread,
  parseHistorySpeaker,
  parseThreadParticipant,
  parseThreadParticipants,
  participantDisplayName,
  participantKey,
  rosterToSearchItems,
  speakerFromChatEvent,
  speakerKey,
} from "./groupRoom.js";

describe("parseHistorySpeaker", () => {
  it("accepts group-rooms-v1 historySpeaker", () => {
    expect(
      parseHistorySpeaker({
        kind: "persona",
        id: "skip",
        display_name: "Skip",
      }),
    ).toEqual({ kind: "persona", id: "skip", display_name: "Skip" });
  });

  it("rejects colon ids and missing display_name", () => {
    expect(
      parseHistorySpeaker({
        kind: "persona",
        id: "skip:evil",
        display_name: "Skip",
      }),
    ).toBeUndefined();
    expect(
      parseHistorySpeaker({ kind: "human", id: "usr_alice" }),
    ).toBeUndefined();
  });
});

describe("parseThreadParticipants", () => {
  it("keeps Skip, Lev, Bana, and the human in roster order", () => {
    const parsed = parseThreadParticipants(GROUP_ROOM_FIXTURE_PARTICIPANTS);
    expect(parsed.map(participantDisplayName)).toEqual([
      "Alice",
      "Skip",
      "Lev",
      "Bana",
    ]);
    expect(parsed.map(participantKey)).toEqual([
      "human:usr_alice",
      "persona:skip",
      "persona:lev",
      "persona:bana",
    ]);
  });

  it("drops illegal rows at the boundary", () => {
    expect(parseThreadParticipant({ kind: "persona" })).toBeUndefined();
    expect(
      parseThreadParticipants([
        { kind: "persona", persona_id: "skip", display_name: "Skip" },
        { kind: "ghost", id: "x" },
        { kind: "persona", persona_id: "skip", display_name: "Dup" },
      ]),
    ).toEqual([
      { kind: "persona", persona_id: "skip", display_name: "Skip" },
    ]);
  });
});

describe("speakerFromChatEvent", () => {
  it("prefers top-level speaker then metadata.speaker", () => {
    expect(
      speakerFromChatEvent({
        speaker: { kind: "persona", id: "lev", display_name: "Lev" },
        metadata: {
          speaker: { kind: "persona", id: "skip", display_name: "Skip" },
        },
      }),
    ).toEqual({ kind: "persona", id: "lev", display_name: "Lev" });
    expect(
      speakerFromChatEvent({
        metadata: {
          speaker: { kind: "persona", id: "bana", display_name: "Bana" },
        },
      }),
    ).toEqual({ kind: "persona", id: "bana", display_name: "Bana" });
  });
});

describe("rosterToSearchItems", () => {
  it("U3: @-complete rows are the roster ids and display names", () => {
    const items = rosterToSearchItems(GROUP_ROOM_FIXTURE_PARTICIPANTS);
    expect(items.map((item) => item.id)).toEqual([
      "usr_alice",
      "skip",
      "lev",
      "bana",
    ]);
    expect(items.map((item) => item.label)).toEqual([
      "Alice",
      "Skip",
      "Lev",
      "Bana",
    ]);
  });
});

describe("isGroupThread", () => {
  it("is true only for kind=group", () => {
    expect(isGroupThread({ kind: "group" })).toBe(true);
    expect(isGroupThread({ kind: "chat" })).toBe(false);
    expect(isGroupThread({ kind: "scheduled_task" })).toBe(false);
    expect(isGroupThread(undefined)).toBe(false);
  });
});

describe("speakerKey", () => {
  it("does not treat a nested subagent name as a peer speaker", () => {
    const skip = {
      kind: "persona" as const,
      id: "skip",
      display_name: "Skip",
    };
    expect(speakerKey(skip)).toBe("persona:skip");
    expect(speakerKey(skip)).not.toContain("qa-helper");
  });
});
