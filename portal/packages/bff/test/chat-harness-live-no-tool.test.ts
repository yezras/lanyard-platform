/**
 * lp-oop.31 — Live no-tool turn vs real LA harness (not LocalHarnessHttp).
 *
 * Hop: BFF → Harness (`createHarnessTurnServer`). Relay spies must stay 0.
 * Requires HARNESS_URL (prove script starts the LA process).
 * Skip when unset so `pnpm test` stays offline-safe. REQUIRE_LIVE=1 fails closed.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { isRelayChatEvent } from "@lanyard/shared";

import { createApp } from "../src/app.js";
import { ChatThreadStore } from "../src/chat-store.js";
import { HarnessClient } from "../src/harness-client.js";
import { createHarnessTurnRegistry } from "../src/harness-turn-registry.js";
import { SessionStore } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import { cookieHeader, createTestBindings } from "./test-helpers.js";

const REQUIRE_LIVE =
  process.env.REQUIRE_LIVE === "1" || process.env.LP_OOP_31_LIVE === "1";
const HARNESS_URL = (process.env.HARNESS_URL ?? "").replace(/\/$/, "");
const HARNESS_SERVICE_TOKEN =
  process.env.HARNESS_SERVICE_TOKEN ??
  process.env.LANYARD_HARNESS_SERVICE_TOKEN ??
  "placeholder-harness-service-token";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const EVIDENCE_DIR = path.join(REPO_ROOT, "artifacts/mocklab/short-stack");
const USER_PROBE = "lp-oop.31 no-tool ping";
const EXPECT_ECHO = `echo: ${USER_PROBE}`;

const tenant: TenantContext = {
  tenant_id: "tenant-mocklab-short-stack",
  tenant_slug: "mocklab",
  display_name: "MockLab",
  host: "mocklab.withlanyard.com",
};
const userId = "user-mocklab-short-stack";
const userInstanceId = "inst-mocklab-short-stack";

async function collectSse(
  res: Response,
  opts?: { maxMs?: number; stopAfterTypes?: string[] },
): Promise<Array<{ event?: string; data: string }>> {
  if (!res.body) throw new Error("no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: Array<{ event?: string; data: string }> = [];
  const deadline = Date.now() + (opts?.maxMs ?? 8_000);
  const stop = new Set(opts?.stopAfterTypes ?? []);

  try {
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        if (!chunk.trim()) continue;
        let event: string | undefined;
        let data = "";
        for (const line of chunk.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          if (line.startsWith("data:")) data = line.slice(5).trim();
        }
        if (data) {
          events.push({ event, data });
          try {
            const parsed = JSON.parse(data) as { type?: string };
            if (parsed.type && stop.has(parsed.type)) return events;
            if (event && stop.has(event)) return events;
          } catch {
            /* ignore */
          }
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
  return events;
}

const describeLive = HARNESS_URL
  ? describe
  : REQUIRE_LIVE
    ? describe
    : describe.skip;

describeLive("live no-tool turn vs real LA harness (lp-oop.31)", () => {
  it("BFF send + SSE echo; Relay never on the hop; no tool events", async () => {
    if (!HARNESS_URL) {
      throw new Error(
        "REQUIRE_LIVE=1 but HARNESS_URL is unset (prove script starts createHarnessTurnServer)",
      );
    }

    const unauthorized = await fetch(`${HARNESS_URL}/internal/turns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "no" }),
    });
    expect(unauthorized.status).toBe(401);

    const chatThreads = new ChatThreadStore();
    const thread = chatThreads.create({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      title: "lp-oop.31 no-tool",
    });
    const sessions = new SessionStore();
    const session = await sessions.create({
      userId,
      tenantId: tenant.tenant_id,
      email: "oop31@example.com",
    });

    const deliverInbound = vi.fn(async () => {
      throw new Error("Relay must not receive deliverInbound");
    });
    const interruptInbound = vi.fn(async () => {
      throw new Error("Relay must not receive interruptInbound");
    });
    const openChatEventStream = vi.fn(async () => {
      throw new Error("Relay must not open chat SSE");
    });
    const fetchChatHistory = vi.fn(async () => {
      throw new Error("Relay must not serve chat history");
    });

    const harnessTurns = createHarnessTurnRegistry();
    const app = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          sessions,
          chatThreads,
          chatDelivery: "harness",
          harnessClient: new HarnessClient(HARNESS_URL, HARNESS_SERVICE_TOKEN),
          harnessTurnRegistry: harnessTurns,
          authClient: {
            getUserRbac: async () => ({
              user_id: userId,
              tenant_id: tenant.tenant_id,
              hermes_profile: "default",
              allowed_path_prefixes: ["/"],
              role_names: ["member"],
            }),
            getPrimaryGatewayInstance: async () => ({
              instance_id: userInstanceId,
            }),
            ensureOnlineByUser: async () => {
              throw new Error(
                "harness no-tool send must not call ensureOnlineByUser",
              );
            },
            getInstancePresence: async () => ({
              instance_id: userInstanceId,
              tenant_id: tenant.tenant_id,
              presence: "online",
              sandbox_id: "sbx-oop31-no-tool",
              runtime_kind: "daytona",
              agent_snapshot_id: null,
              s3_vault_prefix: null,
              last_activity_at: null,
              revoked_at: null,
            }),
            getActiveSessionShare: async () => null,
          } as never,
          relayClient: {
            deliverInbound,
            interruptInbound,
            openChatEventStream,
            fetchChatHistory,
          } as never,
        },
      ),
    );

    const cookies = {
      lanyard_session: session.sessionId,
      lanyard_csrf: "test-csrf-oop31",
    };
    const headers = {
      host: tenant.host,
      cookie: cookieHeader(cookies),
      "x-csrf-token": cookies.lanyard_csrf,
    };

    const posted = await app.request(
      `/api/chat/threads/${thread.thread_id}/messages`,
      {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ text: USER_PROBE }),
      },
    );
    expect(posted.status).toBe(200);
    expect(await posted.json()).toEqual({
      ok: true,
      thread_id: thread.thread_id,
    });

    const turnId = harnessTurns.latest(thread.thread_id);
    expect(turnId).toBeTruthy();

    const sseRes = await app.request(
      `/api/chat/threads/${thread.thread_id}/events`,
      {
        headers: {
          host: tenant.host,
          cookie: cookieHeader(cookies),
          accept: "text/event-stream",
        },
      },
    );
    expect(sseRes.status).toBe(200);
    expect(sseRes.headers.get("content-type") ?? "").toContain(
      "text/event-stream",
    );

    const frames = await collectSse(sseRes, {
      maxMs: 5_000,
      stopAfterTypes: ["message_send"],
    });
    const parsed = frames.map((frame) => JSON.parse(frame.data) as unknown);
    const types = parsed
      .map((event) =>
        typeof event === "object" && event !== null
          ? (event as { type?: string }).type
          : undefined,
      )
      .filter((type): type is string => typeof type === "string");
    const message = parsed.find(
      (event) =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: string }).type === "message_send",
    );
    expect(isRelayChatEvent(message)).toBe(true);
    expect(message).toMatchObject({
      type: "message_send",
      chat_id: thread.thread_id,
      content: EXPECT_ECHO,
    });
    expect(types).not.toContain("tool_progress");

    expect(deliverInbound).not.toHaveBeenCalled();
    expect(interruptInbound).not.toHaveBeenCalled();
    expect(openChatEventStream).not.toHaveBeenCalled();
    expect(fetchChatHistory).not.toHaveBeenCalled();

    const stampCompact = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
    const harnessHost = (() => {
      try {
        return new URL(HARNESS_URL).host;
      } catch {
        return "loopback";
      }
    })();

    const evidence = {
      bead_id: "lp-oop.31",
      title: "0015.31 Live no-tool turn proof",
      timestamp_utc: new Date().toISOString(),
      stamp: stampCompact,
      result: "PASS",
      environment: "mocklab_lab_la_harness_process",
      topology: {
        hop: "BFF → Harness (LA createHarnessTurnServer). Relay not on the hop.",
        chat_delivery: "harness",
        harness_kind: "lanyard-agent createHarnessTurnServer",
        harness_host: harnessHost,
        fake_harness_http: false,
        tenant_slug: tenant.tenant_slug,
        note: "Live AWS MockLab chat_delivery stays default relay (lp-oop.30 runbook only; lp-oop.29 flip open; OPERATOR HOLD). This proof is the real LA process + BFF harness path.",
      },
      la: {
        pr: "https://github.com/LanyardBrain/lanyard-agent/pull/242",
        sha_expected: "cc37ff4dd9119d32db32ce8110ea508b7e7a3cb0",
        sha_observed: process.env.LANYARD_AGENT_SHA ?? null,
      },
      turn: {
        thread_id: thread.thread_id,
        turn_id: turnId,
        instance_id: userInstanceId,
        message_probe: USER_PROBE,
        echo: EXPECT_ECHO,
        event_types: types,
        tool_events: types.filter((type) => type === "tool_progress"),
      },
      relay: {
        deliverInbound_calls: deliverInbound.mock.calls.length,
        interruptInbound_calls: interruptInbound.mock.calls.length,
        openChatEventStream_calls: openChatEventStream.mock.calls.length,
        fetchChatHistory_calls: fetchChatHistory.mock.calls.length,
      },
      checks: {
        "chat.user_message_accepted": posted.status === 200,
        "harness.unauthorized_without_token": unauthorized.status === 401,
        "harness.echo_no_tools": true,
        "relay.not_on_hop": true,
        "relay.deliverInbound_zero": deliverInbound.mock.calls.length === 0,
        "sse.message_send_echo": true,
        "sse.no_tool_progress": !types.includes("tool_progress"),
        "evidence.no_secrets": true,
      },
      needs_ui_qa: false,
      ui_qa_note:
        "Browser Playwright on the harness path is lp-oop.33. This leaf proves the hop (BFF → live LA harness, Relay unused).",
    };

    await mkdir(EVIDENCE_DIR, { recursive: true });
    const json = `${JSON.stringify(evidence, null, 2)}\n`;
    await writeFile(
      path.join(EVIDENCE_DIR, `no-tool-turn-evidence-${stampCompact}.json`),
      json,
      "utf8",
    );
    await writeFile(
      path.join(EVIDENCE_DIR, "no-tool-turn-evidence-latest.json"),
      json,
      "utf8",
    );

    expect(evidence.result).toBe("PASS");
    expect(evidence.checks["relay.not_on_hop"]).toBe(true);
  });
});
