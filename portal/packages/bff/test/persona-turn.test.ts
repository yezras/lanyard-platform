import { describe, expect, it } from "vitest";

import { ChatThreadStore } from "../src/chat-store.js";
import {
  buildPersonaSystemPrompt,
  personaMetaForWake,
} from "../src/persona-turn.js";

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function seed() {
  const store = new ChatThreadStore();
  const bill = store.createAgent({
    tenant_id: "ten",
    user_id: "usr",
    name: "Bill",
  });
  const fred = store.createAgent({
    tenant_id: "ten",
    user_id: "usr",
    name: "Fred",
  });
  return { store, bill, fred };
}

describe("buildPersonaSystemPrompt", () => {
  it("1:1 Bill names himself and lists Fred as a teammate", () => {
    const { store, bill, fred } = seed();
    const thread = store.get(bill.thread_id)!;
    const prompt = buildPersonaSystemPrompt({
      thread,
      personaId: bill.agent_id,
      agent: bill,
      teammates: [bill, fred],
    });
    expect(prompt).toContain("You are Bill");
    expect(prompt).toContain("Muse Spark");
    expect(prompt).toContain("Fred");
    expect(prompt).toContain("mailbox.send with to (their name) and text");
    expect(prompt).not.toContain(fred.agent_id);
    expect(prompt).not.toContain(bill.agent_id);
    expect(prompt).not.toContain(thread.thread_id);
    expect(prompt).not.toMatch(/thread_id/i);
    expect(prompt).not.toMatch(/nonce/i);
    expect(prompt).not.toMatch(UUID_RE);
  });

  it("channel prompt lists member display names only", () => {
    const { store, bill, fred } = seed();
    const channel = store.create({
      tenant_id: "ten",
      user_id: "usr",
      title: "teamguys",
      kind: "group",
      participants: [
        { kind: "human", user_id: "usr", display_name: "Jack" },
        { kind: "persona", persona_id: bill.agent_id, display_name: "Bill" },
        { kind: "persona", persona_id: fred.agent_id, display_name: "Fred" },
      ],
      orchestrator_persona_id: bill.agent_id,
    });
    const prompt = buildPersonaSystemPrompt({
      thread: channel,
      personaId: bill.agent_id,
      agent: bill,
    });
    expect(prompt).toContain('channel "teamguys"');
    expect(prompt).toContain("Fred");
    expect(prompt).toContain("Bill");
    expect(prompt).not.toContain(fred.agent_id);
    expect(prompt).not.toContain(bill.agent_id);
    expect(prompt).not.toContain(channel.thread_id);
    expect(prompt).not.toMatch(/\(id /);
    expect(prompt).not.toMatch(/thread_id/i);
    expect(prompt).not.toMatch(/nonce/i);
    expect(prompt).not.toMatch(UUID_RE);
    expect(prompt).toContain("@Name asks that teammate");
    expect(prompt).toContain("@here asks everyone");
    expect(prompt).not.toContain("unless hopping to their 1:1");
  });
});

describe("personaMetaForWake", () => {
  it("stamps display_name Bill", () => {
    const store = new ChatThreadStore();
    const agent = store.createAgent({
      tenant_id: "ten",
      user_id: "usr",
      name: "Bill",
    });
    const meta = personaMetaForWake({
      thread: store.get(agent.thread_id)!,
      personaId: agent.agent_id,
      agent,
    });
    expect(meta.display_name).toBe("Bill");
    expect(meta.persona_id).toBe(agent.agent_id);
    expect(meta.system_prompt).toContain("You are Bill");
    expect(meta.system_prompt).not.toContain(agent.agent_id);
    expect(meta.system_prompt).not.toMatch(UUID_RE);
  });
});
