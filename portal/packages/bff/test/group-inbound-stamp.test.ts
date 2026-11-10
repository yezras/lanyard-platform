import { describe, expect, it } from "vitest";

import { ChatThreadStore } from "../src/chat-store.js";
import {
  parseConnectorMarks,
  parsePersonaMentions,
  parseRosterMentions,
  stampGroupDeliverInbound,
} from "../src/group-inbound-stamp.js";
import { personaId } from "../src/wake-policy.js";

const owner = {
  kind: "human" as const,
  user_id: "usr_alice",
  display_name: "Alice",
};
const skip = {
  kind: "persona" as const,
  persona_id: "skip",
  display_name: "Skip",
};
const lev = {
  kind: "persona" as const,
  persona_id: "lev",
  display_name: "Lev",
};
const bana = {
  kind: "persona" as const,
  persona_id: "bana",
  display_name: "Bana",
};
const roster = [owner, skip, lev, bana];

describe("parseRosterMentions", () => {
  it("resolves @Lev and @lev to persona id lev", () => {
    expect(parseRosterMentions("@Lev please look", roster)).toEqual({
      mentionedPersonaIds: [personaId("lev")],
      mentionedUserIds: [],
      mentionedConnectorIds: [],
    });
    expect(parseRosterMentions("hey @lev", roster).mentionedPersonaIds).toEqual([
      personaId("lev"),
    ]);
  });

  it("keeps roster order for @Bana @Lev", () => {
    expect(
      parseRosterMentions("@Bana and @Lev", roster).mentionedPersonaIds,
    ).toEqual([personaId("lev"), personaId("bana")]);
  });

  it("does not treat emails as mentions", () => {
    expect(parseRosterMentions("mail alice@example.com", roster)).toEqual({
      mentionedPersonaIds: [],
      mentionedUserIds: [],
      mentionedConnectorIds: [],
    });
  });

  it("ignores unknown @tokens", () => {
    expect(parseRosterMentions("@nobody here", roster)).toEqual({
      mentionedPersonaIds: [],
      mentionedUserIds: [],
      mentionedConnectorIds: [],
    });
  });

  it("resolves connector enums separately from personas", () => {
    expect(parseRosterMentions("@google @hubspot", roster)).toEqual({
      mentionedPersonaIds: [],
      mentionedUserIds: [],
      mentionedConnectorIds: ["google", "hubspot"],
    });
    expect(
      parseRosterMentions("@Lev use @HubSpot and @GitHub", roster),
    ).toEqual({
      mentionedPersonaIds: [personaId("lev")],
      mentionedUserIds: [],
      mentionedConnectorIds: ["hubspot", "github"],
    });
  });

  it("matches connector display names including Google Workspace first word", () => {
    expect(parseRosterMentions("@Google @WhatsApp", roster).mentionedConnectorIds).toEqual(
      ["google", "whatsapp"],
    );
    expect(
      parseConnectorMarks("@Google Workspace later"),
    ).toEqual(["google"]);
  });

  it("does not put connector marks into mentionedPersonaIds", () => {
    const withGooglePersona = [
      ...roster,
      { kind: "persona" as const, persona_id: "google", display_name: "Google" },
    ];
    const parsed = parseRosterMentions("@google ping", withGooglePersona);
    expect(parsed.mentionedConnectorIds).toEqual(["google"]);
    expect(parsed.mentionedPersonaIds).toEqual([]);
    expect(parsePersonaMentions("@google ping", withGooglePersona)).toEqual([]);
    expect(parseConnectorMarks("@google ping")).toEqual(["google"]);
  });
});

describe("stampGroupDeliverInbound", () => {
  function makeGroup() {
    const store = new ChatThreadStore();
    const g = store.create({
      tenant_id: "ten_example",
      user_id: "usr_alice",
      title: "Review room",
      kind: "group",
      orchestrator_persona_id: "skip",
      participants: roster,
    });
    const chat = store.create({
      tenant_id: "ten_example",
      user_id: "usr_alice",
      title: "1:1",
    });
    return { store, group: g, chat };
  }
  // Shared group for D1/D2 sequence where sticky is not under test; keep legacy reuse.
  const __shared = makeGroup();
  const store = __shared.store;
  const group = __shared.group;
  const chat = __shared.chat;

  it("is a no-op on kind=chat", () => {
    expect(
      stampGroupDeliverInbound({
        thread: chat,
        authorUserId: "usr_alice",
        authorDisplayName: "Alice",
        text: "@Lev hi",
      }),
    ).toBeNull();
  });

  it("D1 shape: no mention → orchestrator delivery", () => {
    const stamp = stampGroupDeliverInbound({
      thread: group,
      authorUserId: "usr_alice",
      authorDisplayName: "Alice",
      text: "Please review the auth change.",
    });
    expect(stamp?.decision.reason).toBe("orchestrator");
    expect(stamp?.deliveries).toHaveLength(1);
    expect(stamp?.deliveries[0]?.metadata).toEqual({
      target_persona_ids: ["skip"],
      target_persona_id: "skip",
      lead_persona_id: "skip",
      wake_reason: "orchestrator",
      mentioned_persona_ids: [],
      mentioned_user_ids: [],
      persona_ids: ["skip", "lev", "bana"],
    });
    expect(stamp?.authorSpeaker).toEqual({
      kind: "human",
      id: "usr_alice",
      display_name: "Alice",
    });
  });

  it("D2 shape: @Lev → lev + lead (T2 awareness)", () => {
    const stamp = stampGroupDeliverInbound({
      thread: group,
      authorUserId: "usr_alice",
      authorDisplayName: "Alice",
      text: "@Lev please look",
    });
    expect(stamp?.deliveries.map((d) => d.targetPersonaId)).toEqual(["lev"]);
    expect(stamp?.deliveries[0]?.metadata).toEqual({
      target_persona_ids: ["lev"],
      target_persona_id: "lev",
      lead_persona_id: "skip",
      wake_reason: "mention",
      mentioned_persona_ids: ["lev"],
      mentioned_user_ids: [],
      persona_ids: ["skip", "lev", "bana"],
    });
  });

  it("D2: @Skip @Lev wakes both because lead was named", () => {
    const stamp = stampGroupDeliverInbound({
      thread: group,
      authorUserId: "usr_alice",
      authorDisplayName: "Alice",
      text: "@Skip @Lev both of you",
    });
    expect(stamp?.deliveries.map((d) => d.targetPersonaId)).toEqual([
      "skip",
      "lev",
    ]);
    expect(stamp?.deliveries[0]?.metadata.target_persona_ids).toEqual([
      "skip",
      "lev",
    ]);
  });

  it("fans out one delivery per named target with shared target_persona_ids (T2 lead+mentioned)", () => {
    const stamp = stampGroupDeliverInbound({
      thread: group,
      authorUserId: "usr_alice",
      authorDisplayName: "Alice",
      text: "@Lev @Bana review",
    });
    expect(stamp?.deliveries.map((d) => d.metadata.target_persona_id)).toEqual([
      "lev",
      "bana",
    ]);
    expect(stamp?.deliveries[0]?.metadata.target_persona_ids).toEqual([
      "lev",
      "bana",
    ]);
    expect(stamp?.deliveries[1]?.metadata.target_persona_ids).toEqual([
      "lev",
      "bana",
    ]);
  });

  it("capitalized roster names without @ wake those personas (lp-v62i.19.3)", () => {
    const { group: fresh } = makeGroup();
    const stamp = stampGroupDeliverInbound({
      thread: fresh,
      authorUserId: "usr_alice",
      authorDisplayName: "Alice",
      text: "Lev and Bana, help me",
    });
    expect(stamp?.mentionedPersonaIds).toEqual([
      personaId("lev"),
      personaId("bana"),
    ]);
    expect(stamp?.deliveries.map((d) => d.targetPersonaId)).toEqual([
      "lev",
      "bana",
    ]);
  });

  it("lowercase common words do not route", () => {
    const { group: fresh } = makeGroup();
    const stamp = stampGroupDeliverInbound({
      thread: fresh,
      authorUserId: "usr_alice",
      authorDisplayName: "Alice",
      text: "please look around",
    });
    expect(stamp?.mentionedPersonaIds).toEqual([]);
    expect(stamp?.decision.reason).toBe("orchestrator");
    expect(stamp?.deliveries.map((d) => d.targetPersonaId)).toEqual(["skip"]);
  });

  it("connector mark does not wake; unmentioned lead still receives", () => {
    const { group: fresh } = makeGroup();
    const stamp = stampGroupDeliverInbound({
      thread: fresh,
      authorUserId: "usr_alice",
      authorDisplayName: "Alice",
      text: "@HubSpot pull the deal",
    });
    expect(stamp?.mentionedPersonaIds).toEqual([]);
    expect(stamp?.decision.reason).toBe("orchestrator");
    expect(stamp?.deliveries[0]?.metadata.target_persona_ids).toEqual(["skip"]);
  });

  it("unknown @ is ignored and still wakes the lead", () => {
    const { group: fresh } = makeGroup();
    const stamp = stampGroupDeliverInbound({
      thread: fresh,
      authorUserId: "usr_alice",
      authorDisplayName: "Alice",
      text: "@nobody here",
    });
    expect(stamp?.mentionedPersonaIds).toEqual([]);
    expect(stamp?.decision.reason).toBe("orchestrator");
  });

  it("lp-k5c4.19: @Lev then no-@ wakes sticky Lev, not lead (T2 lead+mention for first)", () => {
    const { group: fresh } = makeGroup();
    const s1 = stampGroupDeliverInbound({
      thread: fresh,
      authorUserId: "usr_alice",
      authorDisplayName: "Alice",
      text: "@Lev hi",
    });
    expect(s1?.deliveries.map((d) => d.targetPersonaId)).toEqual(["lev"]);
    expect(s1?.nextStickyPersonaIds).toEqual(["lev"]);
    const s2 = stampGroupDeliverInbound({
      thread: fresh,
      authorUserId: "usr_alice",
      authorDisplayName: "Alice",
      text: "what's the status",
    });
    expect(s2?.deliveries.map((d) => d.targetPersonaId)).toEqual(["lev"]);
    expect(s2?.decision.reason).toBe("mention");
    expect(s2?.nextStickyPersonaIds).toEqual(["lev"]);
    // Lead stays silent
    expect(s2?.deliveries.map((d) => d.targetPersonaId)).not.toContain("skip");
  });

  it("lp-k5c4.19: sticky carries until new @, @Alpha switches", () => {
    const { group: fresh } = makeGroup();
    stampGroupDeliverInbound({
      thread: fresh,
      authorUserId: "usr_alice",
      authorDisplayName: "Alice",
      text: "@Lev hi",
    });
    stampGroupDeliverInbound({
      thread: fresh,
      authorUserId: "usr_alice",
      authorDisplayName: "Alice",
      text: "follow up no @",
    });
    const s3 = stampGroupDeliverInbound({
      thread: fresh,
      authorUserId: "usr_alice",
      authorDisplayName: "Alice",
      text: "@Bana hey",
    });
    expect(s3?.deliveries.map((d) => d.targetPersonaId)).toEqual(["bana"]);
    const s4 = stampGroupDeliverInbound({
      thread: fresh,
      authorUserId: "usr_alice",
      authorDisplayName: "Alice",
      text: "again no @",
    });
    expect(s4?.deliveries.map((d) => d.targetPersonaId)).toEqual(["bana"]);
  });

  it("lp-k5c4.19: first unmentioned in fresh channel still wakes lead", () => {
    const { group: fresh } = makeGroup();
    const stamp = stampGroupDeliverInbound({
      thread: fresh,
      authorUserId: "usr_alice",
      authorDisplayName: "Alice",
      text: "hello everyone",
    });
    expect(stamp?.deliveries.map((d) => d.targetPersonaId)).toEqual(["skip"]);
    expect(stamp?.decision.reason).toBe("orchestrator");
  });

  it("lp-v62i.26: @here wakes every roster persona and clears sticky", () => {
    const { group: fresh } = makeGroup();
    stampGroupDeliverInbound({
      thread: fresh,
      authorUserId: "usr_alice",
      authorDisplayName: "Alice",
      text: "@Lev hi",
    });
    const here = stampGroupDeliverInbound({
      thread: fresh,
      authorUserId: "usr_alice",
      authorDisplayName: "Alice",
      text: "@here anyone?",
    });
    expect(here?.deliveries.map((d) => d.targetPersonaId)).toEqual([
      "skip",
      "lev",
      "bana",
    ]);
    expect(here?.decision.reason).toBe("mention");
    expect(here?.stickyCleared).toBe(true);
    expect(here?.nextStickyPersonaIds).toEqual([]);
    const after = stampGroupDeliverInbound({
      thread: fresh,
      authorUserId: "usr_alice",
      authorDisplayName: "Alice",
      text: "no @ after here",
    });
    expect(after?.deliveries.map((d) => d.targetPersonaId)).toEqual(["skip"]);
  });

  it("lp-v62i.26: @channel and @HERE also wake the whole roster", () => {
    const { group: fresh } = makeGroup();
    const channel = stampGroupDeliverInbound({
      thread: fresh,
      authorUserId: "usr_alice",
      authorDisplayName: "Alice",
      text: "@channel please all",
    });
    expect(channel?.deliveries.map((d) => d.targetPersonaId)).toEqual([
      "skip",
      "lev",
      "bana",
    ]);
    const caps = stampGroupDeliverInbound({
      thread: fresh,
      authorUserId: "usr_alice",
      authorDisplayName: "Alice",
      text: "@HERE check in",
    });
    expect(caps?.deliveries.map((d) => d.targetPersonaId)).toEqual([
      "skip",
      "lev",
      "bana",
    ]);
  });

  it("plain word here does not wake the roster", () => {
    const { group: fresh } = makeGroup();
    const stamp = stampGroupDeliverInbound({
      thread: fresh,
      authorUserId: "usr_alice",
      authorDisplayName: "Alice",
      text: "@nobody here",
    });
    expect(stamp?.deliveries.map((d) => d.targetPersonaId)).toEqual(["skip"]);
  });

  it("lp-k5c4.19: @Drift + @Bana sticky fans out to both, not whole roster (T2)", () => {
    const { group: fresh } = makeGroup();
    const s1 = stampGroupDeliverInbound({
      thread: fresh,
      authorUserId: "usr_alice",
      authorDisplayName: "Alice",
      text: "@Lev @Bana hi",
    });
    expect(s1?.deliveries.map((d) => d.targetPersonaId)).toEqual(["lev", "bana"]);
    const s2 = stampGroupDeliverInbound({
      thread: fresh,
      authorUserId: "usr_alice",
      authorDisplayName: "Alice",
      text: "follow up",
    });
    expect(s2?.deliveries.map((d) => d.targetPersonaId)).toEqual(["lev", "bana"]);
    expect(s2?.deliveries).toHaveLength(2);
  });

  it("lp-v62i.3.9: persona_ids includes full roster in roster order", () => {
    const { group: fresh } = makeGroup();
    const stamp = stampGroupDeliverInbound({
      thread: fresh,
      authorUserId: "usr_alice",
      authorDisplayName: "Alice",
      text: "Please review the auth change.",
    });
    expect(stamp?.deliveries[0]?.metadata.persona_ids).toEqual(["skip", "lev", "bana"]);
    expect(stamp?.deliveries[0]?.metadata.target_persona_ids).toEqual(["skip"]);
  });

  it("lp-v62i.3.9: @Lev wake still carries full persona_ids roster (T2 lead+mention)", () => {
    const { group: fresh } = makeGroup();
    const stamp = stampGroupDeliverInbound({
      thread: fresh,
      authorUserId: "usr_alice",
      authorDisplayName: "Alice",
      text: "@Lev please look",
    });
    expect(stamp?.deliveries[0]?.metadata.target_persona_ids).toEqual(["lev"]);
    expect(stamp?.deliveries[0]?.metadata.persona_ids).toEqual(["skip", "lev", "bana"]);
    expect(stamp?.deliveries[0]?.metadata.lead_persona_id).toBe("skip");
  });
});
