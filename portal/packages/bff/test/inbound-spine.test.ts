import { describe, expect, it, vi } from "vitest";

import * as config from "../src/config.js";
import {
  chatHopDelivery,
  isHarnessChatHop,
  resolveChatHop,
  spineEnabled,
} from "../src/inbound-spine.js";

describe("spineEnabled (lp-k5c4.3)", () => {
  it("is true only when tenant persist is harness and HARNESS_URL is wired", () => {
    expect(
      spineEnabled({
        tenantChatDelivery: "harness",
        harnessUrlWired: true,
      }),
    ).toBe(true);
  });

  it("is false for env-only harness (no tenant persist)", () => {
    expect(
      spineEnabled({
        tenantChatDelivery: null,
        harnessUrlWired: true,
      }),
    ).toBe(false);
    expect(
      spineEnabled({
        tenantChatDelivery: undefined,
        harnessUrlWired: true,
      }),
    ).toBe(false);
  });

  it("is false when HARNESS_URL is not wired", () => {
    expect(
      spineEnabled({
        tenantChatDelivery: "harness",
        harnessUrlWired: false,
      }),
    ).toBe(false);
  });

  it("is false for relay persist", () => {
    expect(
      spineEnabled({
        tenantChatDelivery: "relay",
        harnessUrlWired: true,
      }),
    ).toBe(false);
  });
});

describe("resolveChatHop (lp-k5c4.8)", () => {
  it("returns spine for MockLab persist harness + wired HARNESS_URL without consulting resolveChatDelivery", () => {
    const consult = vi.spyOn(config, "resolveChatDelivery");
    expect(
      resolveChatHop({
        tenantChatDelivery: "harness",
        harnessUrlWired: true,
        envChatDelivery: "relay",
      }),
    ).toEqual({ kind: "spine" });
    expect(consult).not.toHaveBeenCalled();
    consult.mockRestore();
  });

  it("ignores global CHAT_DELIVERY=harness when persist is missing", () => {
    const hop = resolveChatHop({
      tenantChatDelivery: null,
      harnessUrlWired: true,
      envChatDelivery: "harness",
    });
    expect(hop).toEqual({ kind: "legacy", chatDelivery: "harness" });
    expect(hop.kind).not.toBe("spine");
  });

  it("keeps EC2/guest residual on legacy Relay", () => {
    expect(
      resolveChatHop({
        tenantChatDelivery: "relay",
        harnessUrlWired: true,
        envChatDelivery: "relay",
      }),
    ).toEqual({ kind: "legacy", chatDelivery: "relay" });
    expect(
      resolveChatHop({
        tenantChatDelivery: undefined,
        harnessUrlWired: false,
        envChatDelivery: "relay",
      }),
    ).toEqual({ kind: "legacy", chatDelivery: "relay" });
  });

  it("maps spine to harness delivery without a chatDelivery field", () => {
    const hop = resolveChatHop({
      tenantChatDelivery: "harness",
      harnessUrlWired: true,
      envChatDelivery: "relay",
    });
    expect("chatDelivery" in hop).toBe(false);
    expect(chatHopDelivery(hop)).toBe("harness");
    expect(isHarnessChatHop(hop)).toBe(true);
  });

  it("consults resolveChatDelivery only on the legacy branch", () => {
    const consult = vi.spyOn(config, "resolveChatDelivery");
    expect(
      resolveChatHop({
        tenantChatDelivery: null,
        harnessUrlWired: true,
        envChatDelivery: "relay",
      }),
    ).toEqual({ kind: "legacy", chatDelivery: "relay" });
    expect(consult).toHaveBeenCalledOnce();
    expect(consult).toHaveBeenCalledWith({
      env: "relay",
      tenant: null,
    });
    consult.mockRestore();
  });
});
