/**
 * Plan 0019 §4.2 sandbox_need matrix (lp-k5c4.6).
 * Callers do not choose sandbox_need.
 */
import { describe, expect, it } from "vitest";

import type { InboundSandboxNeed, InboundWorkSource } from "@lanyard/shared";

import {
  classifySandboxNeed,
  promptHasFileToolIntent,
  type ClassifySandboxNeedInput,
} from "../src/inbound-sandbox-need.js";
import { inboundWorkItemFromClassifiedTurn } from "../src/inbound-queue.js";

const TURN = {
  tenant_id: "ten-1",
  user_id: "usr-1",
  instance_id: "inst-1",
  thread_id: "thr-1",
  message: "hello",
};

describe("classifySandboxNeed §4.2 matrix", () => {
  const rows: Array<{
    name: string;
    input: ClassifySandboxNeedInput;
    need: InboundSandboxNeed;
  }> = [
    { name: "web hi", input: { source: "web", text: "hi" }, need: "none" },
    {
      name: "web vault path",
      input: { source: "web", text: "open /mnt/vault/notes.md" },
      need: "toolbox",
    },
    {
      name: "web parse_document",
      input: { source: "web", text: "run parse_document on the NDA" },
      need: "toolbox",
    },
    {
      name: "web staging attachment",
      input: { source: "web", text: "hi", hasAttachment: true },
      need: "toolbox",
    },
    {
      name: "web please read this",
      input: { source: "web", text: "please read this" },
      need: "none",
    },
    {
      name: "slack plain",
      input: { source: "slack", text: "standup notes" },
      need: "none",
    },
    {
      name: "slack attachment",
      input: { source: "slack", text: "see file", hasAttachment: true },
      need: "toolbox",
    },
    {
      name: "email grep",
      input: { source: "email", text: "grep the vault logs" },
      need: "toolbox",
    },
    {
      name: "whatsapp memory_read",
      input: { source: "whatsapp", text: "memory_read yesterday" },
      need: "toolbox",
    },
    {
      name: "cron tool_only",
      input: { source: "cron", sandboxCreateProfile: "tool_only" },
      need: "toolbox",
    },
    {
      name: "cron guest_gateway",
      input: { source: "cron", sandboxCreateProfile: "guest_gateway" },
      need: "none",
    },
    {
      name: "cron omitted profile",
      input: { source: "cron", text: "digest" },
      need: "none",
    },
    {
      name: "mailbox hidden_instruction default",
      input: { source: "mailbox", hiddenInstruction: true, text: "take this" },
      need: "none",
    },
    {
      name: "mailbox inherit toolbox",
      input: {
        source: "mailbox",
        hiddenInstruction: true,
        priorNeed: "toolbox",
      },
      need: "toolbox",
    },
  ];

  it.each(rows)("$name → $need", ({ input, need }) => {
    expect(classifySandboxNeed(input)).toBe(need);
  });

  it("covers every inbound source", () => {
    const sources = new Set(rows.map((row) => row.input.source));
    const expected: InboundWorkSource[] = [
      "web",
      "slack",
      "email",
      "whatsapp",
      "cron",
      "mailbox",
    ];
    expect([...sources].sort()).toEqual([...expected].sort());
  });
});

describe("promptHasFileToolIntent", () => {
  it("matches vault and named file tools, not conversational read", () => {
    expect(promptHasFileToolIntent("touch /mnt/vault/x")).toBe(true);
    expect(promptHasFileToolIntent("bash ls")).toBe(true);
    expect(promptHasFileToolIntent("please read this")).toBe(false);
    expect(promptHasFileToolIntent("hi")).toBe(false);
  });
});

describe("inboundWorkItemFromClassifiedTurn", () => {
  it("does not take a caller-chosen sandbox_need", () => {
    const hi = inboundWorkItemFromClassifiedTurn(TURN, { source: "web" });
    expect(hi.sandbox_need).toBe("none");
    expect(hi.source).toBe("web");
    const vault = inboundWorkItemFromClassifiedTurn(
      { ...TURN, message: "cat /mnt/vault/secret" },
      { source: "web" },
    );
    expect(vault.sandbox_need).toBe("toolbox");
  });
});
