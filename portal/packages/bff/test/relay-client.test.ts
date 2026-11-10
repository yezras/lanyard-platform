import { describe, expect, it } from "vitest";

import { RelayClient, type RelayRequestFn } from "../src/relay-client.js";

const BASE = "http://relay.test";
const EVENT = {
  type: "message_send" as const,
  source: { platform: "lanyard_web" },
  text: "hello",
};

function unreachableClient(): RelayClient {
  const requestFn: RelayRequestFn = async () => {
    throw new TypeError("fetch failed");
  };
  return new RelayClient(BASE, "tok", requestFn);
}

describe("lp-8sh4.6: relay transport failures are structured", () => {
  it("deliverInbound network failure maps to 503 with actionable error", async () => {
    const delivered = await unreachableClient().deliverInbound({
      instanceId: "inst_1",
      tenantId: "ten_1",
      event: EVENT as Parameters<RelayClient["deliverInbound"]>[0]["event"],
    });
    expect(delivered).toMatchObject({ ok: false, status: 503 });
    if (!delivered.ok) {
      expect(delivered.error).toMatch(/unreachable/);
      expect(delivered.error).toContain(BASE);
    }
  });

  it("interruptInbound network failure maps to 503, not a throw", async () => {
    const result = await unreachableClient().interruptInbound({
      instanceId: "inst_1",
      sessionKey: "sess_1",
      chatId: "chat_1",
    });
    expect(result).toMatchObject({ ok: false, status: 503 });
  });

  it("haltMailbox / thawMailbox / isMailboxFrozen network failure maps to 503", async () => {
    const client = unreachableClient();
    const halt = await client.haltMailbox({
      instanceId: "inst_1",
      threadId: "thr_1",
    });
    expect(halt).toMatchObject({ ok: false, status: 503 });
    const thaw = await client.thawMailbox({
      instanceId: "inst_1",
      threadId: "thr_1",
    });
    expect(thaw).toMatchObject({ ok: false, status: 503 });
    const frozen = await client.isMailboxFrozen({
      instanceId: "inst_1",
      threadId: "thr_1",
    });
    expect(frozen).toMatchObject({ ok: false, status: 503 });
  });

  it("getInstanceOwner network failure maps to 503, not a throw", async () => {
    const owner = await unreachableClient().getInstanceOwner("inst_1");
    expect(owner).toMatchObject({ ok: false, status: 503 });
    if (!owner.ok) {
      expect(owner.error).toMatch(/unreachable/);
    }
  });

  it("resolveChatBaseUrl falls back to service URL when owner lookup fails", async () => {
    const base = await unreachableClient().resolveChatBaseUrl("inst_1");
    expect(base).toBe(BASE);
  });

  it("fetchChatHistory network failure maps to 503 so history never 500s", async () => {
    const history = await unreachableClient().fetchChatHistory("chat_1", {
      instanceId: "inst_1",
    });
    expect(history).toMatchObject({ ok: false, status: 503 });
    if (!history.ok) {
      expect(history.error).toMatch(/unreachable/);
    }
  });

  it("fetchChatHistory without instanceId also maps network failure to 503", async () => {
    const history = await unreachableClient().fetchChatHistory("chat_1");
    expect(history).toMatchObject({ ok: false, status: 503 });
  });

  it("openChatEventStream network failure returns synthetic 503 Response", async () => {
    const response = await unreachableClient().openChatEventStream("chat_1", {
      instanceId: "inst_1",
    });
    expect(response.ok).toBe(false);
    expect(response.status).toBe(503);
  });

  it("invokeBrainRpc network failure maps to 503 unavailable, not a throw", async () => {
    const result = await unreachableClient().invokeBrainRpc({
      instanceId: "inst_1",
      tenantId: "ten_1",
      request: {
        type: "brain_rpc_request",
        contract_version: 1,
        request_id: "req_1",
        method: "brain.ping",
        timeout_ms: 10_000,
        auth: {
          tenant_id: "ten_1",
          instance_id: "inst_1",
          user_id: "user_1",
          session_id: "sess_1",
        },
        params: {},
      },
    } as Parameters<RelayClient["invokeBrainRpc"]>[0]);
    expect(result).toMatchObject({ ok: false, status: 503 });
    if (!result.ok) {
      expect(result.error).toMatch(/unreachable/);
    }
  });
});
