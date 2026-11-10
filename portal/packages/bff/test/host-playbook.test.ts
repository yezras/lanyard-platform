import { describe, expect, it } from "vitest";

import { HOST_PLAYBOOK } from "../src/host-playbook.js";

describe("HOST_PLAYBOOK (lp-v62i.20.3 / lp-v62i.24)", () => {
  it("tells agents to speak in a shared room instead of hopping 1:1", () => {
    expect(HOST_PLAYBOOK).toContain("@Name or @here");
    expect(HOST_PLAYBOOK).toContain(
      "mailbox.send to their 1:1 only when you are not already together",
    );
  });

  it("does not tell the model to quote thread_id, UUID, or nonce", () => {
    expect(HOST_PLAYBOOK).toContain("mailbox.send {to, text}");
    expect(HOST_PLAYBOOK).toContain("Host fills room");
    expect(HOST_PLAYBOOK).not.toContain("thread_id");
    expect(HOST_PLAYBOOK).not.toMatch(/nonce/i);
    expect(HOST_PLAYBOOK).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
  });
});
