import { describe, expect, it } from "vitest";

import { ChatThreadStore } from "../src/chat-store.js";
import { ContextPoolStore, emptyHumanPoolSession, humanPoolDelta, markHumanPoolDelivered } from "../src/context-pool.js";
import { harnessWakeMetadata } from "../src/harness-wake-payload.js";

describe("lp-ornl human-scoped 1:1 context pool", () => {
  it("A human-scoped: key is (tenant, human) — same human shares pool across 1:1s", () => {
    const store = new ChatThreadStore();
    const pool = new ContextPoolStore();
    store.setContextPoolStore(pool);

    const tenant = "ten_1";
    const human = "jack";
    const lev = store.createAgent({ tenant_id: tenant, user_id: human, name: "Lev" });
    const fizz = store.createAgent({ tenant_id: tenant, user_id: human, name: "Fizz" });
    const levThread = store.findDirectThreadForAgent(lev.agent_id)!;
    const fizzThread = store.findDirectThreadForAgent(fizz.agent_id)!;

    // Jack -> Lev: research NDA clause 4
    store.appendHistory(levThread.thread_id, {
      type: "user_message",
      message_id: "m1",
      content: "Lev, research NDA clause 4",
      created_at: new Date().toISOString(),
      chat_id: levThread.thread_id,
      speaker: { kind: "human", id: human, display_name: "Jack" },
    });
    // Lev replies
    store.appendHistory(levThread.thread_id, {
      type: "message_send",
      message_id: "m2",
      content: "NDA clause 4 says mutual non-disclosure for 2 years, carve-out for public info.",
      created_at: new Date().toISOString(),
      chat_id: levThread.thread_id,
      speaker: { kind: "persona", id: lev.agent_id, display_name: "Lev" },
    });

    const key = { tenant_id: tenant, human_user_id: human };
    const fetched = pool.fetch(key);
    expect(fetched.revision_id).toBe(2);
    expect(fetched.events).toHaveLength(2);
    expect(fetched.events[0]!.content).toContain("NDA clause 4");
    expect(fetched.events[1]!.content).toContain("mutual non-disclosure");

    // participants-only: pool contains both 1:1s for same human, persona_ids lists Lev + Fizz
    const personaIds = pool.listParticipantPersonaIds(store, key);
    expect(personaIds).toContain(lev.agent_id);
    expect(personaIds).toContain(fizz.agent_id);
  });

  it("A live per-call: BFF live fetches on every turn — revision bumps on append", () => {
    const store = new ChatThreadStore();
    const pool = new ContextPoolStore();
    store.setContextPoolStore(pool);
    const tenant = "ten_1";
    const human = "jack";
    const lev = store.createAgent({ tenant_id: tenant, user_id: human, name: "Lev" });
    const f = store.findDirectThreadForAgent(lev.agent_id)!;
    const key = { tenant_id: tenant, human_user_id: human };

    expect(pool.fetch(key).revision_id).toBe(0);
    store.appendHistory(f.thread_id, {
      type: "user_message",
      message_id: "m1",
      content: "hi lev",
      created_at: new Date().toISOString(),
      chat_id: f.thread_id,
    });
    expect(pool.fetch(key).revision_id).toBe(1);
    store.appendHistory(f.thread_id, {
      type: "message_send",
      message_id: "m2",
      content: "hi jack",
      created_at: new Date().toISOString(),
      chat_id: f.thread_id,
    });
    expect(pool.fetch(key).revision_id).toBe(2);
  });

  it("A harness delta: SessionState per human-pool with delivered_event_ids + standing_context_sent", () => {
    const store = new ChatThreadStore();
    const pool = new ContextPoolStore();
    store.setContextPoolStore(pool);
    const tenant = "ten_1";
    const human = "jack";
    const lev = store.createAgent({ tenant_id: tenant, user_id: human, name: "Lev" });
    const f = store.findDirectThreadForAgent(lev.agent_id)!;
    store.appendHistory(f.thread_id, {
      type: "user_message",
      message_id: "m1",
      content: "research NDA clause 4",
      created_at: new Date().toISOString(),
      chat_id: f.thread_id,
    });
    store.appendHistory(f.thread_id, {
      type: "message_send",
      message_id: "m2",
      content: "NDA 2 years",
      created_at: new Date().toISOString(),
      chat_id: f.thread_id,
    });

    const key = { tenant_id: tenant, human_user_id: human };
    const fetched = pool.fetch(key);
    let session = emptyHumanPoolSession(key);
    expect(session.standing_context_sent).toBe(false);
    expect(session.delivered_event_ids.size).toBe(0);

    const delta1 = humanPoolDelta(fetched, session);
    expect(delta1).toHaveLength(2);
    session = markHumanPoolDelivered(session, delta1, true);
    expect(session.delivered_event_ids.size).toBe(2);
    expect(session.standing_context_sent).toBe(true);
    expect(session.last_revision_id).toBe(2);

    // new message after delta — only new event is unseen
    store.appendHistory(f.thread_id, {
      type: "message_send",
      message_id: "m3",
      content: "more detail: carve-out public info",
      created_at: new Date().toISOString(),
      chat_id: f.thread_id,
    });
    const fetched2 = pool.fetch(key);
    const delta2 = humanPoolDelta(fetched2, session);
    expect(delta2).toHaveLength(1);
    expect(delta2[0]!.event_id).toBe("m3");
  });

  it("B broadcast: pool is shared across human's 1:1s — Fizz sees Lev's excerpt via persona_ids", () => {
    const store = new ChatThreadStore();
    const pool = new ContextPoolStore();
    store.setContextPoolStore(pool);
    const tenant = "ten_1";
    const human = "jack";
    const lev = store.createAgent({ tenant_id: tenant, user_id: human, name: "Lev" });
    const fizz = store.createAgent({ tenant_id: tenant, user_id: human, name: "Fizz" });
    const levThread = store.findDirectThreadForAgent(lev.agent_id)!;
    const fizzThread = store.findDirectThreadForAgent(fizz.agent_id)!;

    store.appendHistory(levThread.thread_id, {
      type: "user_message",
      message_id: "m1",
      content: "research NDA clause 4",
      created_at: new Date().toISOString(),
      chat_id: levThread.thread_id,
    });
    store.appendHistory(levThread.thread_id, {
      type: "message_send",
      message_id: "m2",
      content: "NDA clause 4: mutual for 2 years",
      created_at: new Date().toISOString(),
      chat_id: levThread.thread_id,
    });

    // Jack -> Fizz: what did Lev research?
    const key = { tenant_id: tenant, human_user_id: human };
    const fetched = pool.fetch(key);
    const personaIds = pool.listParticipantPersonaIds(store, key);
    const meta = harnessWakeMetadata({
      roomTail: store.listHistory(fizzThread.thread_id),
      contextPool: {
        tenant_id: key.tenant_id,
        human_user_id: key.human_user_id,
        revision_id: fetched.revision_id,
        events: fetched.events.map((e) => e.event_json),
        persona_ids: personaIds,
      },
    });
    // Fizz's wake must contain Lev's pool excerpt
    expect(meta.human_context_pool).toBeDefined();
    expect(meta.human_context_pool!.revision_id).toBe(2);
    expect(meta.human_context_pool!.persona_ids).toContain(lev.agent_id);
    expect(meta.human_context_pool!.persona_ids).toContain(fizz.agent_id);
    const poolTexts = (meta.human_context_pool!.events as Array<{ content?: string }>).map((e) => e.content ?? "");
    expect(poolTexts.join(" ")).toContain("NDA clause 4");
    expect(poolTexts.join(" ")).toContain("mutual for 2 years");
  });

  it("C shared API: canonical types in @lanyard/shared, physical table in BFF, CP via API", async () => {
    // types are importable from @lanyard/shared
    const { parseContextPoolKey, isContextPoolKey } = await import("@lanyard/shared");
    expect(isContextPoolKey({ tenant_id: "t", human_user_id: "h" })).toBe(true);
    expect(parseContextPoolKey({ tenant_id: "t", human_user_id: "h" })).toEqual({ tenant_id: "t", human_user_id: "h" });
    // BFF store is BFF-owned
    const pool = new ContextPoolStore();
    expect(pool.fetch({ tenant_id: "t", human_user_id: "h" }).revision_id).toBe(0);
  });

  it("A messages-only: pool ignores tool_progress / typing", () => {
    const store = new ChatThreadStore();
    const pool = new ContextPoolStore();
    store.setContextPoolStore(pool);
    const tenant = "ten_1";
    const human = "jack";
    const lev = store.createAgent({ tenant_id: tenant, user_id: human, name: "Lev" });
    const f = store.findDirectThreadForAgent(lev.agent_id)!;
    store.appendHistory(f.thread_id, {
      type: "tool_progress",
      chat_id: f.thread_id,
      content: "tool ran",
      created_at: new Date().toISOString(),
    } as any);
    expect(pool.fetch({ tenant_id: tenant, human_user_id: human }).events).toHaveLength(0);
    store.appendHistory(f.thread_id, {
      type: "user_message",
      message_id: "m1",
      content: "hello",
      created_at: new Date().toISOString(),
      chat_id: f.thread_id,
    });
    expect(pool.fetch({ tenant_id: tenant, human_user_id: human }).events).toHaveLength(1);
  });

  it("A any writer: human and any persona in human's 1:1s may append", () => {
    const store = new ChatThreadStore();
    const pool = new ContextPoolStore();
    store.setContextPoolStore(pool);
    const tenant = "ten_1";
    const human = "jack";
    const lev = store.createAgent({ tenant_id: tenant, user_id: human, name: "Lev" });
    const f = store.findDirectThreadForAgent(lev.agent_id)!;
    // human writes
    store.appendHistory(f.thread_id, {
      type: "user_message",
      message_id: "m1",
      content: "human hello",
      created_at: new Date().toISOString(),
      chat_id: f.thread_id,
    });
    // persona writes
    store.appendHistory(f.thread_id, {
      type: "message_send",
      message_id: "m2",
      content: "persona hello",
      created_at: new Date().toISOString(),
      chat_id: f.thread_id,
    });
    expect(pool.fetch({ tenant_id: tenant, human_user_id: human }).events).toHaveLength(2);
  });

  it("A participants-only: pool read is scoped to human's participants", () => {
    const store = new ChatThreadStore();
    const pool = new ContextPoolStore();
    store.setContextPoolStore(pool);
    const tenant = "ten_1";
    const jack = "jack";
    const maya = "maya";
    const lev = store.createAgent({ tenant_id: tenant, user_id: jack, name: "Lev" });
    const fizzMaya = store.createAgent({ tenant_id: tenant, user_id: maya, name: "Fizz" });
    const levThread = store.findDirectThreadForAgent(lev.agent_id)!;
    store.appendHistory(levThread.thread_id, {
      type: "user_message",
      message_id: "m1",
      content: "secret for jack",
      created_at: new Date().toISOString(),
      chat_id: levThread.thread_id,
    });
    const jackKey = { tenant_id: tenant, human_user_id: jack };
    const mayaKey = { tenant_id: tenant, human_user_id: maya };
    expect(pool.fetch(jackKey).events).toHaveLength(1);
    expect(pool.fetch(mayaKey).events).toHaveLength(0);
    // participants-only: Lev is participant for jack, not for maya
    expect(pool.isParticipant(store, jackKey, lev.agent_id)).toBe(true);
    expect(pool.isParticipant(store, mayaKey, fizzMaya.agent_id)).toBe(true);
    expect(pool.isParticipant(store, mayaKey, lev.agent_id)).toBe(false);
    // Jack<->Fizz must NOT see Maya<->Fizz text
    expect(pool.fetch(mayaKey).events.map((e) => e.content).join(" ")).not.toContain("secret for jack");
  });

  it("TDD delegation chain: Jack→Lev research NDA clause 4 → Lev replies → Jack→Fizz what did Lev research? Pass if Fizz quotes pool via persona_ids", () => {
    const store = new ChatThreadStore();
    const pool = new ContextPoolStore();
    store.setContextPoolStore(pool);
    const tenant = "ten_1";
    const human = "jack";
    const lev = store.createAgent({ tenant_id: tenant, user_id: human, name: "Lev" });
    const fizz = store.createAgent({ tenant_id: tenant, user_id: human, name: "Fizz" });
    const levThread = store.findDirectThreadForAgent(lev.agent_id)!;
    const fizzThread = store.findDirectThreadForAgent(fizz.agent_id)!;

    // Jack→Lev
    store.appendHistory(levThread.thread_id, {
      type: "user_message",
      message_id: "m1",
      content: "research NDA clause 4",
      created_at: new Date().toISOString(),
      chat_id: levThread.thread_id,
      speaker: { kind: "human", id: human, display_name: "Jack" },
    });
    // Lev replies
    store.appendHistory(levThread.thread_id, {
      type: "message_send",
      message_id: "m2",
      content: "NDA clause 4: mutual non-disclosure 2 years, carve-out public info.",
      created_at: new Date().toISOString(),
      chat_id: levThread.thread_id,
      speaker: { kind: "persona", id: lev.agent_id, display_name: "Lev" },
    });
    // Jack→Fizz
    store.appendHistory(fizzThread.thread_id, {
      type: "user_message",
      message_id: "m3",
      content: "what did Lev just research?",
      created_at: new Date().toISOString(),
      chat_id: fizzThread.thread_id,
      speaker: { kind: "human", id: human, display_name: "Jack" },
    });

    const key = { tenant_id: tenant, human_user_id: human };
    const fetched = pool.fetch(key);
    // pool must contain both Jack↔Lev messages, not just Fizz thread
    expect(fetched.events.map((e) => e.content).join(" ")).toContain("research NDA clause 4");
    expect(fetched.events.map((e) => e.content).join(" ")).toContain("mutual non-disclosure 2 years");

    // Fizz's wake includes human-scoped pool via persona_ids
    const personaIds = pool.listParticipantPersonaIds(store, key);
    const meta = harnessWakeMetadata({
      roomTail: store.listHistory(fizzThread.thread_id),
      contextPool: {
        tenant_id: key.tenant_id,
        human_user_id: key.human_user_id,
        revision_id: fetched.revision_id,
        events: fetched.events.map((e) => e.event_json),
        persona_ids: personaIds,
      },
    });
    // harness delta: Fizz has not yet delivered these events
    let session = emptyHumanPoolSession(key);
    const delta = humanPoolDelta(fetched, session);
    expect(delta.length).toBe(3); // m1,m2,m3 all in human pool
    const deltaText = delta.map((e) => e.content).join(" ");
    expect(deltaText).toContain("NDA clause 4");
    // Pass if Fizz quotes Jack↔Lev pool — simulate Lev excerpt in prompt
    expect(meta.human_context_pool!.events.length).toBe(3);
    const metaText = (meta.human_context_pool!.events as Array<{ content?: string }>).map((e) => e.content).join(" ");
    expect(metaText).toContain("NDA clause 4");
    expect(meta.human_context_pool!.persona_ids).toContain(lev.agent_id);
    expect(meta.human_context_pool!.persona_ids).toContain(fizz.agent_id);
  });
});
