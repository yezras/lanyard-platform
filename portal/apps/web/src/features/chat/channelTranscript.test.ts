import { describe, expect, it } from "vitest";

import type { ChatTimelineItem } from "../../hooks/useChatEvents.js";

import { planChannelRows } from "./channelTranscript.js";

const alice = { kind: "human" as const, id: "usr_alice", display_name: "Alice" };
const skip = { kind: "persona" as const, id: "skip", display_name: "Skip" };
const lev = { kind: "persona" as const, id: "lev", display_name: "Lev" };

function userItem(
  id: string,
  speaker?: typeof alice,
  overrides?: Partial<Extract<ChatTimelineItem, { type: "user" }>>,
): ChatTimelineItem {
  return { type: "user", id, content: `msg-${id}`, status: "sent", ...(speaker ? { speaker } : {}), ...overrides };
}

function turnItem(
  id: string,
  speaker?: typeof skip | typeof lev,
): ChatTimelineItem {
  return {
    type: "assistant_turn",
    id,
    content: `answer-${id}`,
    toolCalls: [],
    ...(speaker ? { speaker } : {}),
  };
}

describe("planChannelRows (lp-cxhb.15.3)", () => {
  it("assigns first/last group positions across consecutive same-speaker rows", () => {
    const plans = planChannelRows([
      userItem("u1", alice),
      turnItem("skip-1", skip),
      turnItem("skip-2", skip),
      turnItem("lev-1", lev),
    ]);

    expect(plans).toHaveLength(4);
    // Local user rows never carry gutter avatar / name.
    expect(plans[0]).toMatchObject({
      group: undefined,
      showGutter: false,
      showName: false,
    });
    // Skip run: first shows gutter + name, second is the tail.
    expect(plans[1]).toMatchObject({
      group: "first",
      showGutter: true,
      showName: true,
    });
    expect(plans[2]).toMatchObject({
      group: "last",
      showGutter: false,
      showName: false,
    });
    // Solo Lev row: standalone bubble with its own identity chrome.
    expect(plans[3]).toMatchObject({
      group: undefined,
      showGutter: true,
      showName: true,
    });
  });

  it("emits middle positions for long runs and resets when the speaker changes", () => {
    const plans = planChannelRows([
      turnItem("skip-1", skip),
      turnItem("skip-2", skip),
      turnItem("skip-3", skip),
      turnItem("lev-1", lev),
      turnItem("skip-4", skip),
    ]);

    expect(plans.map((p) => p.group ?? "single")).toEqual([
      "first",
      "middle",
      "last",
      "single",
      "single",
    ]);
  });

  it("groups consecutive local (speakerless) user messages iMessage-style", () => {
    const plans = planChannelRows([
      userItem("u1"),
      userItem("u2"),
      turnItem("skip-1", skip),
      userItem("u3"),
    ]);

    expect(plans[0]).toMatchObject({ group: "first", showGutter: false });
    expect(plans[1]).toMatchObject({ group: "last", showGutter: false });
    expect(plans[3]).toMatchObject({ group: undefined, showGutter: false });
  });

  it("breaks runs on non-message items (mcq / legacy reasoning)", () => {
    const plans = planChannelRows([
      turnItem("skip-1", skip),
      {
        type: "mcq",
        mcqId: "mcq-1",
        messageId: "p1",
        content: "Pick",
        choices: [{ id: "a", label: "A" }],
        selectedChoiceId: null,
        disabled: false,
      },
      turnItem("skip-2", skip),
    ]);

    expect(plans[0].group).toBeUndefined();
    expect(plans[0].showGutter).toBe(true);
    expect(plans[2].group).toBeUndefined();
    expect(plans[2].showGutter).toBe(true);
  });
});
