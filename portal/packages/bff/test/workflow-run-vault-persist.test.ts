import { describe, expect, it, vi } from "vitest";

import { durableOutboundFromRelayEvent } from "../src/chat-store.js";
import {
  createCpS3WorkflowRunVaultPutJson,
  createWorkflowRunVaultPersist,
  WORKFLOW_RUN_VAULT_PERSIST_FAILED,
} from "../src/workflow-run-vault-persist.js";

describe("durableOutboundFromRelayEvent citation projection", () => {
  it("strips guest /mnt/vault from message_send citations", () => {
    const durable = durableOutboundFromRelayEvent({
      type: "message_send",
      chat_id: "thr_1",
      citations: [
        {
          path: "/mnt/vault/workflows/runs/wf_03e3fb5b2224a1d2/state.json",
          title: "state.json",
        },
      ],
      metadata: {
        citations: [
          {
            path: "/mnt/vault/workflows/runs/wf_03e3fb5b2224a1d2/state.json",
            title: "state.json",
          },
        ],
      },
    });
    expect(durable?.citations).toEqual([
      {
        path: "/workflows/runs/wf_03e3fb5b2224a1d2/state.json",
        title: "state.json",
      },
    ]);
    expect(
      (durable?.metadata as { citations?: Array<{ path: string }> }).citations,
    ).toEqual([
      {
        path: "/workflows/runs/wf_03e3fb5b2224a1d2/state.json",
        title: "state.json",
      },
    ]);
  });
});

describe("createWorkflowRunVaultPersist", () => {
  const event = {
    type: "tool_progress",
    tool_name: "workflow",
    tool_kind: "workflow",
    metadata: {
      portal_event: "workflow_progress",
      tool_kind: "workflow",
      workflow_id: "wf_03e3fb5b2224a1d2",
      workflow_name: "research-lite",
      workflow_status: "running",
    },
  };

  it("creates state.json once per run and skips later events", async () => {
    const putJson = vi.fn(async () => "created" as const);
    const persist = createWorkflowRunVaultPersist({
      putJson,
      now: () => new Date("2026-08-21T16:50:00.000Z"),
    });
    persist.persistFromChatEvent("tenant_demo", event);
    persist.persistFromChatEvent("tenant_demo", event);
    await vi.waitFor(() => expect(putJson).toHaveBeenCalledTimes(1));
    expect(putJson).toHaveBeenCalledWith(
      "tenant_demo",
      "/workflows/runs/wf_03e3fb5b2224a1d2/state.json",
      expect.stringContaining('"run_id": "wf_03e3fb5b2224a1d2"'),
    );
  });

  it("logs persist failure instead of swallowing it", async () => {
    const warns: Array<{ msg: string; fields?: Record<string, unknown> }> = [];
    const persist = createWorkflowRunVaultPersist({
      putJson: async () => {
        throw new Error("S3 put denied");
      },
      logger: {
        warn: (msg, fields) => {
          warns.push({ msg, fields });
        },
        error: () => undefined,
      },
    });
    persist.persistFromChatEvent("tenant_demo", event);
    await vi.waitFor(() => expect(warns.length).toBe(1));
    expect(warns[0]?.msg).toBe("workflow run vault persist failed");
    expect(warns[0]?.fields?.metric).toBe(WORKFLOW_RUN_VAULT_PERSIST_FAILED);
    expect(warns[0]?.fields?.run_id).toBe("wf_03e3fb5b2224a1d2");
    expect(warns[0]?.fields?.error).toBe("S3 put denied");
  });

  it("logs when no writer is bound", () => {
    const warns: Array<{ msg: string }> = [];
    const persist = createWorkflowRunVaultPersist({
      putJson: null,
      logger: {
        warn: (msg) => {
          warns.push({ msg });
        },
        error: () => undefined,
      },
    });
    persist.persistFromChatEvent("tenant_demo", event);
    expect(warns[0]?.msg).toMatch(/no writer/);
  });

  it("persists from a citation path on message_send", async () => {
    const putJson = vi.fn(async () => "created" as const);
    const persist = createWorkflowRunVaultPersist({
      putJson,
      now: () => new Date("2026-08-21T16:50:00.000Z"),
    });
    persist.persistFromChatEvent("tenant_demo", {
      type: "message_send",
      citations: [
        {
          path: "/mnt/vault/workflows/runs/wf_03e3fb5b2224a1d2/state.json",
          title: "state.json",
        },
      ],
    });
    await vi.waitFor(() => expect(putJson).toHaveBeenCalledTimes(1));
    expect(putJson).toHaveBeenCalledWith(
      "tenant_demo",
      "/workflows/runs/wf_03e3fb5b2224a1d2/state.json",
      expect.stringContaining('"run_id": "wf_03e3fb5b2224a1d2"'),
    );
  });

  it("persistMissing materializes state.json from the GET path", async () => {
    const putJson = vi.fn(async () => "created" as const);
    const persist = createWorkflowRunVaultPersist({
      putJson,
      now: () => new Date("2026-08-21T16:50:00.000Z"),
    });
    await expect(
      persist.persistMissing(
        "tenant_demo",
        "/workflows/runs/wf_03e3fb5b2224a1d2/state.json",
      ),
    ).resolves.toBe("created");
    expect(putJson).toHaveBeenCalledTimes(1);
  });
});

describe("createCpS3WorkflowRunVaultPutJson", () => {
  it("create-if-absent via GET 404 then PUT create_new", async () => {
    const calls: Array<{ method?: string; url: string; body?: string }> = [];
    const putJson = createCpS3WorkflowRunVaultPutJson({
      baseUrl: "http://cp.test",
      serviceToken: "tok",
      requestFn: async (input, init) => {
        const url = String(input);
        const method = init?.method;
        const body = typeof init?.body === "string" ? init.body : undefined;
        calls.push({ method, url, body });
        if (url.includes("/vault/get")) {
          return new Response(JSON.stringify({ code: "VAULT_OBJECT_NOT_FOUND" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ path: "workflows/runs/wf_1/state.json" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    await expect(
      putJson("ten_1", "/workflows/runs/wf_1/state.json", '{"run_id":"wf_1"}\n'),
    ).resolves.toBe("created");
    expect(calls.some((c) => c.method === "GET" && c.url.includes("/vault/get"))).toBe(
      true,
    );
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.url).toContain("/vault/put");
    expect(put?.body).toContain('"mode":"create_new"');
    expect(put?.body).toContain("workflows/runs/wf_1/state.json");
  });

  it("does not treat SPA HTML 200 as an existing object", async () => {
    const calls: Array<{ method?: string }> = [];
    const putJson = createCpS3WorkflowRunVaultPutJson({
      baseUrl: "http://cp.test",
      requestFn: async (_input, init) => {
        calls.push({ method: init?.method });
        if (init?.method === "GET" || !init?.method) {
          return new Response("<!DOCTYPE html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          });
        }
        return new Response(JSON.stringify({ path: "workflows/runs/wf_1/state.json" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    await expect(
      putJson("ten_1", "/workflows/runs/wf_1/state.json", "{}"),
    ).resolves.toBe("created");
    expect(calls.some((c) => c.method === "PUT")).toBe(true);
  });

  it("treats an existing object as success without overwrite", async () => {
    const putJson = createCpS3WorkflowRunVaultPutJson({
      baseUrl: "http://cp.test",
      requestFn: async (input) => {
        const url = String(input);
        if (url.includes("/vault/get")) {
          return new Response(JSON.stringify({ path: "workflows/runs/wf_1/state.json" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error("put must not run when object exists");
      },
    });
    await expect(
      putJson("ten_1", "/workflows/runs/wf_1/state.json", "{}"),
    ).resolves.toBe("exists");
  });
});
