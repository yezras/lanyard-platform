import { describe, expect, it, vi } from "vitest";

import {
  deliverHarnessPersonaTurns,
  isRelayGatewayNotReady,
} from "../src/chat-delivery-send.js";
import type { HarnessClient } from "./harness-client.js";

const turn = (threadId: string) => ({
  tenant_id: "ten_1",
  user_id: "usr_1",
  instance_id: "inst_1",
  thread_id: threadId,
  message: "hello",
  metadata: {
    room_tail: [{ type: "user_message", content: "prior", chat_id: threadId }],
    persona: { persona_id: "agt_1", display_name: "Skip" },
  },
});

function harnessClient(
  impl: (request: { thread_id: string }) => Promise<{ turn_id: string }>,
): Pick<HarnessClient, "startTurn"> {
  return {
    startTurn: vi.fn(async (request) => {
      const { turn_id } = await impl(request);
      return { ok: true as const, turn_id };
    }),
  };
}

describe("deliverHarnessPersonaTurns (lp-znef.1)", () => {
  it("starts one turn per persona and returns the last turn id", async () => {
    const started: string[] = [];
    const client = harnessClient(async (request) => {
      started.push(request.thread_id);
      return { turn_id: `turn_${started.length}` };
    });
    const remembered: string[] = [];
    const result = await deliverHarnessPersonaTurns({
      harnessClient: client,
      turns: [turn("thr_a"), turn("thr_b")],
      remember: (turnId) => remembered.push(turnId),
    });
    expect(result).toEqual({
      ok: true,
      path: "harness",
      turn_id: "turn_2",
    });
    expect(started).toEqual(["thr_a", "thr_b"]);
    expect(remembered).toEqual(["turn_1", "turn_2"]);
    expect(client.startTurn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        thread_id: "thr_a",
        message: "hello",
        metadata: {
          room_tail: [{ type: "user_message", content: "prior", chat_id: "thr_a" }],
          persona: { persona_id: "agt_1", display_name: "Skip" },
        },
      }),
    );
  });

  it("fails closed on the first start error and stops the fan-out", async () => {
    const started: string[] = [];
    const client: Pick<HarnessClient, "startTurn"> = {
      startTurn: vi.fn(async (request) => {
        started.push(request.thread_id);
        return { ok: false as const, status: 503, error: "down" };
      }),
    };
    const result = await deliverHarnessPersonaTurns({
      harnessClient: client,
      turns: [turn("thr_a"), turn("thr_b")],
      remember: () => {},
    });
    expect(result).toEqual({ ok: false, status: 503, error: "down" });
    expect(started).toEqual(["thr_a"]);
  });

  it("errors when there are no turns to deliver", async () => {
    const client = harnessClient(async () => ({ turn_id: "turn_x" }));
    const result = await deliverHarnessPersonaTurns({
      harnessClient: client,
      turns: [],
      remember: () => {},
    });
    expect(result.ok).toBe(false);
  });
});

describe("isRelayGatewayNotReady (lp-vqr0.8 T4)", () => {
  it("treats handshake 502/503 as agent-not-ready", () => {
    expect(
      isRelayGatewayNotReady({
        status: 502,
        error: "Gateway not connected or handshake incomplete",
      }),
    ).toBe(true);
    expect(
      isRelayGatewayNotReady({
        status: 503,
        error: "Agent gateway unreachable at http://relay.test — start the gateway",
      }),
    ).toBe(true);
  });

  it("does not swallow vault/wake 502 or generic relay errors", () => {
    expect(
      isRelayGatewayNotReady({
        status: 502,
        error: "s3_vault_prefix is required for vault mount",
      }),
    ).toBe(false);
    expect(
      isRelayGatewayNotReady({
        status: 500,
        error: "Gateway not connected or handshake incomplete",
      }),
    ).toBe(false);
    expect(
      isRelayGatewayNotReady({ status: 502, error: "Relay down" }),
    ).toBe(false);
  });
});
