import { describe, expect, it } from "vitest";

import {
  DEFAULT_HOP_CAP,
  decideWake,
  personaId,
  type HopState,
  type Roster,
  type Speaker,
  type WakeInput,
} from "../src/wake-policy.js";

const skip = personaId("skip");
const lev = personaId("lev");
const bana = personaId("bana");

const roster: Roster = {
  orchestratorPersonaId: skip,
  personaIds: [skip, lev, bana],
  humanIds: ["usr_alice"],
};

const alice: Speaker = { kind: "human", userId: "usr_alice" };

function freshHop(origin = skip): HopState {
  return {
    hopCount: 0,
    cap: DEFAULT_HOP_CAP,
    originPersonaId: origin,
    edges: [],
  };
}

function decide(
  overrides: Partial<WakeInput> &
    Pick<WakeInput, "message"> & { hop?: HopState },
) {
  return decideWake({
    roster,
    hop: freshHop(),
    keywordTriggersEnabled: false,
    ...overrides,
  });
}

describe("decideWake (lac-bx3.10 W1-W6)", () => {
  it("W1: human message, no mention → [orchestrator]", () => {
    const decision = decide({
      message: { author: alice, mentionedPersonaIds: [] },
    });
    expect(decision).toEqual({
      targetPersonaIds: [skip],
      reason: "orchestrator",
    });
  });

  it("W2: @Lev → [lev] (lead stays silent; lp-k5c4.15)", () => {
    const decision = decide({
      message: { author: alice, mentionedPersonaIds: [lev] },
    });
    expect(decision).toEqual({
      targetPersonaIds: [lev],
      reason: "mention",
    });
  });

  it("W3: @Lev @Bana → [lev, bana] in roster order (no lead)", () => {
    const mentionedFirst = decide({
      message: { author: alice, mentionedPersonaIds: [lev, bana] },
    });
    const mentionedReversed = decide({
      message: { author: alice, mentionedPersonaIds: [bana, lev] },
    });
    expect(mentionedFirst).toEqual({
      targetPersonaIds: [lev, bana],
      reason: "mention",
    });
    expect(mentionedReversed).toEqual(mentionedFirst);
  });

  it("human @lead wakes lead once because they were named", () => {
    const decision = decide({
      message: { author: alice, mentionedPersonaIds: [skip] },
    });
    expect(decision).toEqual({
      targetPersonaIds: [skip],
      reason: "mention",
    });
  });

  it("human @lead @Lev wakes both (lead included only when named)", () => {
    const decision = decide({
      message: { author: alice, mentionedPersonaIds: [skip, lev] },
    });
    expect(decision).toEqual({
      targetPersonaIds: [skip, lev],
      reason: "mention",
    });
  });

  it("W4: Skip @Lev hop 1; Lev @Skip result hop 2; Lev @Bana dropped", () => {
    const hop1 = decide({
      message: {
        author: { kind: "persona", personaId: skip },
        mentionedPersonaIds: [lev],
      },
      hop: freshHop(skip),
    });
    expect(hop1).toEqual({
      targetPersonaIds: [lev],
      reason: "hop",
    });

    const hop2 = decide({
      message: {
        author: { kind: "persona", personaId: lev },
        mentionedPersonaIds: [skip, bana],
      },
      hop: {
        hopCount: 1,
        cap: DEFAULT_HOP_CAP,
        originPersonaId: skip,
        edges: [{ from: skip, to: lev }],
      },
    });
    expect(hop2).toEqual({
      targetPersonaIds: [skip],
      reason: "hop",
    });
  });

  it("W5: A @B then B @A inside the hop window → loop_notice", () => {
    const first = decide({
      message: {
        author: { kind: "persona", personaId: lev },
        mentionedPersonaIds: [bana],
      },
      hop: {
        hopCount: 0,
        cap: DEFAULT_HOP_CAP,
        originPersonaId: skip,
        edges: [],
      },
    });
    expect(first).toEqual({
      targetPersonaIds: [bana],
      reason: "hop",
    });

    const pingPong = decide({
      message: {
        author: { kind: "persona", personaId: bana },
        mentionedPersonaIds: [lev],
      },
      hop: {
        hopCount: 1,
        cap: DEFAULT_HOP_CAP,
        originPersonaId: skip,
        edges: [{ from: lev, to: bana }],
      },
    });
    expect(pingPong).toEqual({
      targetPersonaIds: [],
      reason: "loop_notice",
    });
  });

  it("W6: keyword triggers do not fire when the feature flag is off", () => {
    const off = decide({
      message: { author: alice, mentionedPersonaIds: [] },
      keywordTriggersEnabled: false,
      keywordMatchedPersonaIds: [lev],
    });
    expect(off).toEqual({
      targetPersonaIds: [skip],
      reason: "orchestrator",
    });

    const on = decide({
      message: { author: alice, mentionedPersonaIds: [] },
      keywordTriggersEnabled: true,
      keywordMatchedPersonaIds: [lev],
    });
    expect(on).toEqual({
      targetPersonaIds: [lev],
      reason: "keyword",
    });

    const mentionsWin = decide({
      message: { author: alice, mentionedPersonaIds: [bana] },
      keywordTriggersEnabled: true,
      keywordMatchedPersonaIds: [lev],
    });
    expect(mentionsWin).toEqual({
      targetPersonaIds: [bana],
      reason: "mention",
    });
  });

  it("is pure: same input yields the same WakeDecision twice", () => {
    const input: WakeInput = {
      roster,
      message: { author: alice, mentionedPersonaIds: [bana, lev] },
      hop: freshHop(),
      keywordTriggersEnabled: false,
    };
    expect(decideWake(input)).toEqual(decideWake(input));
  });
});

describe("decideWake sticky addressee (lp-k5c4.19)", () => {
  it("no @ with no sticky → lead (first unmentioned still lead)", () => {
    const decision = decide({
      message: { author: alice, mentionedPersonaIds: [] },
      stickyPersonaIds: [],
    });
    expect(decision).toEqual({ targetPersonaIds: [skip], reason: "orchestrator" });
  });

  it("no @ with sticky Lev → Lev, not lead", () => {
    const decision = decide({
      message: { author: alice, mentionedPersonaIds: [] },
      stickyPersonaIds: [lev],
    });
    expect(decision).toEqual({ targetPersonaIds: [lev], reason: "mention" });
  });

  it("@Lev then no-@ stays sticky until new @, @Bana switches", () => {
    // Human @Lev sets sticky (caller persists); next no-@ uses sticky Lev
    const afterLev = decide({
      message: { author: alice, mentionedPersonaIds: [lev] },
    });
    expect(afterLev).toEqual({ targetPersonaIds: [lev], reason: "mention" });
    const follow = decide({
      message: { author: alice, mentionedPersonaIds: [] },
      stickyPersonaIds: [lev],
    });
    expect(follow).toEqual({ targetPersonaIds: [lev], reason: "mention" });
    // New explicit @Bana overrides sticky
    const afterBana = decide({
      message: { author: alice, mentionedPersonaIds: [bana] },
    });
    expect(afterBana).toEqual({ targetPersonaIds: [bana], reason: "mention" });
    const followBana = decide({
      message: { author: alice, mentionedPersonaIds: [] },
      stickyPersonaIds: [bana],
    });
    expect(followBana).toEqual({ targetPersonaIds: [bana], reason: "mention" });
  });

  it("sticky Lev @Bana is roster-ordered, not mention-order", () => {
    const stickyReversed = decide({
      message: { author: alice, mentionedPersonaIds: [] },
      stickyPersonaIds: [bana, lev],
    });
    expect(stickyReversed).toEqual({ targetPersonaIds: [lev, bana], reason: "mention" });
  });

  it("explicit @ overrides sticky even when sticky exists", () => {
    const decision = decide({
      message: { author: alice, mentionedPersonaIds: [bana] },
      stickyPersonaIds: [lev],
    });
    expect(decision).toEqual({ targetPersonaIds: [bana], reason: "mention" });
  });

  it("@here / @channel wakes the whole roster and ignores sticky", () => {
    const decision = decide({
      message: { author: alice, mentionedPersonaIds: [] },
      stickyPersonaIds: [lev],
      isRoomAddress: true,
    });
    expect(decision).toEqual({
      targetPersonaIds: [skip, lev, bana],
      reason: "mention",
    });
  });

  it("sticky filters stale ids not on roster", () => {
    const stray = personaId("ghost");
    const decision = decide({
      message: { author: alice, mentionedPersonaIds: [] },
      stickyPersonaIds: [stray, lev],
    });
    expect(decision).toEqual({ targetPersonaIds: [lev], reason: "mention" });
  });

  it("sticky does not fan out to whole roster (no auto wake)", () => {
    const twoSticky = decide({
      message: { author: alice, mentionedPersonaIds: [] },
      stickyPersonaIds: [lev, bana],
    });
    expect(twoSticky.targetPersonaIds).toEqual([lev, bana]);
    expect(twoSticky.targetPersonaIds).not.toContain(skip);
  });

  it("persona @ does not set sticky; next human still uses prior sticky", () => {
    // Persona hop is not sticky-aware; verify human sticky unchanged by persona prose
    const hop = decide({
      message: { author: { kind: "persona", personaId: lev }, mentionedPersonaIds: [bana] },
      hop: freshHop(skip),
    });
    expect(hop).toEqual({ targetPersonaIds: [bana], reason: "hop" });
    // Human no-@ still sticky Lev
    const human = decide({
      message: { author: alice, mentionedPersonaIds: [] },
      stickyPersonaIds: [lev],
    });
    expect(human).toEqual({ targetPersonaIds: [lev], reason: "mention" });
  });

  it("nextStickyPersonaIds pure helper", async () => {
    const { nextStickyPersonaIds } = await import("../src/wake-policy.js");
    expect(nextStickyPersonaIds({ currentSticky: [], mentioned: [], isRoomAddress: false })).toEqual([]);
    expect(nextStickyPersonaIds({ currentSticky: [lev], mentioned: [], isRoomAddress: false })).toEqual([lev]);
    expect(nextStickyPersonaIds({ currentSticky: [lev], mentioned: [bana], isRoomAddress: false })).toEqual([bana]);
    expect(nextStickyPersonaIds({ currentSticky: [lev], mentioned: [], isRoomAddress: true })).toEqual([]);
    expect(nextStickyPersonaIds({ currentSticky: [lev], mentioned: [bana], isRoomAddress: true })).toEqual([]);
  });
});
