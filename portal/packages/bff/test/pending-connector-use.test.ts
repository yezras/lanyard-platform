import { describe, expect, it } from "vitest";

import { GMAIL_DRAFTS_CREATE_ARGV, buildPendingConnectorUse } from "@lanyard/connectors";

import {
  MemoryPendingConnectorUseStore,
  consumePendingConnectorUse,
} from "../src/pending-connector-use.js";

describe("MemoryPendingConnectorUseStore", () => {
  it("keeps one pending tool per user and consumes it on resume", async () => {
    const store = new MemoryPendingConnectorUseStore();
    const first = buildPendingConnectorUse({
      tenant_id: "t1",
      user_id: "u1",
      thread_id: "th-1",
      connector_id: "google",
      argv: [...GMAIL_DRAFTS_CREATE_ARGV, "--subject", "One"],
      now: Date.now(),
    });
    const second = buildPendingConnectorUse({
      tenant_id: "t1",
      user_id: "u1",
      thread_id: "th-2",
      connector_id: "google",
      argv: [...GMAIL_DRAFTS_CREATE_ARGV, "--subject", "Two"],
      now: Date.now(),
    });
    await store.put(first);
    await store.put(second);
    const resume = await consumePendingConnectorUse({
      store,
      tenantId: "t1",
      userId: "u1",
      connectorId: "google",
      source: "chat",
    });
    expect(resume).toMatchObject({
      kind: "resume",
      args: ["gmail", "users", "drafts", "create", "--subject", "Two"],
      thread_id: "th-2",
    });
    const again = await consumePendingConnectorUse({
      store,
      tenantId: "t1",
      userId: "u1",
      connectorId: "google",
      source: "chat",
    });
    expect(again.kind).toBe("connected_no_resume");
  });

  it("expired pending does not auto-send", async () => {
    const store = new MemoryPendingConnectorUseStore();
    await store.put(
      buildPendingConnectorUse({
        tenant_id: "t1",
        user_id: "u1",
        thread_id: "th-1",
        connector_id: "google",
        argv: [...GMAIL_DRAFTS_CREATE_ARGV],
        now: 1,
        ttl_ms: 10,
      }),
    );
    const expired = await consumePendingConnectorUse({
      store,
      tenantId: "t1",
      userId: "u1",
      connectorId: "google",
      source: "chat",
      now: 20,
    });
    expect(expired).toMatchObject({
      kind: "connected_no_resume",
      reason: "expired",
      message: "Google connected. The pending tool was not sent.",
    });
  });

  it("page consume never returns the stored tool", async () => {
    const store = new MemoryPendingConnectorUseStore();
    await store.put(
      buildPendingConnectorUse({
        tenant_id: "t1",
        user_id: "u1",
        thread_id: "th-1",
        connector_id: "google",
        argv: [...GMAIL_DRAFTS_CREATE_ARGV],
        now: Date.now(),
      }),
    );
    const page = await consumePendingConnectorUse({
      store,
      tenantId: "t1",
      userId: "u1",
      connectorId: "google",
      source: "page",
    });
    expect(page).toMatchObject({
      kind: "connected_no_resume",
      reason: "page_connect",
    });
  });
});
