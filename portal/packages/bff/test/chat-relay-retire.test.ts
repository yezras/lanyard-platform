/**
 * lp-oop.35 — Daytona harness hop has no deliverInbound.
 * EC2/guest dual-run still uses Relay.
 */
import { describe, expect, it, vi } from "vitest";
import type { TurnId } from "@lanyard/shared";

import {
  deliverChatTurn,
  interruptChatTurn,
  type DeliverHarnessChatTurnInput,
  type DeliverRelayChatTurnInput,
} from "../src/chat-delivery-send.js";
import { createApp } from "../src/app.js";
import { ChatThreadStore } from "../src/chat-store.js";
import { SessionStore } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import { cookieHeader, createTestBindings } from "./test-helpers.js";

const tenant: TenantContext = {
  tenant_id: "tenant-relay-retire",
  tenant_slug: "demo",
  display_name: "Demo",
  host: "demo.withlanyard.com",
};
const userId = "user-relay-retire";

function harnessTurn(): DeliverHarnessChatTurnInput["turn"] {
  return {
    tenant_id: tenant.tenant_id,
    user_id: userId,
    instance_id: "inst-daytona",
    thread_id: "thr-1",
    message: "hello harness",
  };
}

describe("deliverChatTurn retire Relay (lp-oop.35)", () => {
  it("Daytona harness variant starts a turn and has no deliverInbound field", async () => {
    const startTurn = vi.fn(async () => ({
      ok: true as const,
      turn_id: "turn-1" as TurnId,
    }));
    const input: DeliverHarnessChatTurnInput = {
      chatDelivery: "harness",
      harnessClient: { startTurn },
      turn: harnessTurn(),
    };
    expect("relayClient" in input).toBe(false);
    expect("relay" in input).toBe(false);

    const result = await deliverChatTurn(input);
    expect(result).toEqual({
      ok: true,
      path: "harness",
      turn_id: "turn-1",
    });
    expect(startTurn).toHaveBeenCalledOnce();
  });

  it("EC2/guest relay dual-run still calls deliverInbound", async () => {
    const deliverInbound = vi.fn(async () => ({ ok: true as const }));
    const input: DeliverRelayChatTurnInput = {
      chatDelivery: "relay",
      relayClient: { deliverInbound },
      relay: {
        instanceId: "inst-ec2",
        tenantId: tenant.tenant_id,
        event: { type: "message", text: "hello guest" } as never,
      },
    };
    expect("harnessClient" in input).toBe(false);

    const result = await deliverChatTurn(input);
    expect(result).toEqual({ ok: true, path: "relay" });
    expect(deliverInbound).toHaveBeenCalledOnce();
    expect(deliverInbound).toHaveBeenCalledWith({
      instanceId: "inst-ec2",
      tenantId: tenant.tenant_id,
      event: { type: "message", text: "hello guest" },
    });
  });
});

describe("interruptChatTurn retire Relay (lp-oop.35)", () => {
  it("Daytona harness interrupt does not call interruptInbound", async () => {
    const interruptTurn = vi.fn(async () => ({ ok: true as const }));
    const result = await interruptChatTurn({
      chatDelivery: "harness",
      harnessClient: { interruptTurn },
      turnId: "turn-1" as TurnId,
    });
    expect(result).toEqual({
      ok: true,
      path: "harness",
      interrupted: true,
    });
    expect(interruptTurn).toHaveBeenCalledWith("turn-1");
  });

  it("EC2/guest relay dual-run still calls interruptInbound", async () => {
    const interruptInbound = vi.fn(async () => ({ ok: true as const }));
    const result = await interruptChatTurn({
      chatDelivery: "relay",
      relayClient: { interruptInbound },
      relay: {
        instanceId: "inst-ec2",
        sessionKey: "agent:main:relay:dm:thr-1",
        chatId: "thr-1",
      },
    });
    expect(result).toEqual({ ok: true, path: "relay" });
    expect(interruptInbound).toHaveBeenCalledOnce();
  });
});

describe("POST cancel harness hop (lp-oop.35)", () => {
  it("harness cancel does not resolve a Relay primary instance", async () => {
    const chatThreads = new ChatThreadStore();
    const thread = chatThreads.create({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      title: "Retire",
    });
    const sessions = new SessionStore();
    const session = await sessions.create({
      userId,
      tenantId: tenant.tenant_id,
      email: "retire@example.com",
    });
    const getPrimaryGatewayInstance = vi.fn(async () => ({
      instance_id: "inst-should-not-resolve",
    }));
    const interruptInbound = vi.fn(async () => ({ ok: true as const }));
    const interruptTurn = vi.fn(async () => ({ ok: true as const }));
    const app = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          sessions,
          chatThreads,
          chatDelivery: "harness",
          harnessClient: {
            startTurn: async () => ({
              ok: true as const,
              turn_id: "turn-cancel" as TurnId,
            }),
            interruptTurn,
            openTurnEventStream: async () => {
              throw new Error("unused");
            },
          } as never,
          authClient: {
            getUserRbac: async () => ({
              user_id: userId,
              tenant_id: tenant.tenant_id,
              hermes_profile: "default",
              allowed_path_prefixes: ["/"],
              role_names: ["member"],
            }),
            getPrimaryGatewayInstance,
            ensureOnlineByUser: async () => ({
              instance_id: "inst-user",
              tenant_id: tenant.tenant_id,
              user_id: userId,
              presence: "online",
              sandbox_id: "sbx",
              runtime_kind: "daytona",
              already_online: true,
              wake_joined: false,
              source: "user",
            }),
            getActiveSessionShare: async () => null,
          } as never,
          relayClient: { interruptInbound } as never,
        },
      ),
    );
    const cookies = {
      lanyard_session: session.sessionId,
      lanyard_csrf: "test-csrf-relay-retire",
    };
    const res = await app.request(`/api/chat/threads/${thread.thread_id}/cancel`, {
      method: "POST",
      headers: {
        host: tenant.host,
        "content-type": "application/json",
        cookie: cookieHeader(cookies),
        "x-csrf-token": cookies.lanyard_csrf,
      },
    });
    expect(res.status).toBe(200);
    expect(getPrimaryGatewayInstance).not.toHaveBeenCalled();
    expect(interruptInbound).not.toHaveBeenCalled();
  });
});
