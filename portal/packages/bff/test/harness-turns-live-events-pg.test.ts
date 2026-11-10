/**
 * Durable harness_turns + live-events hub (lp-k5c4.12).
 * Requires CONTROL_PLANE_DATABASE_URL or DATABASE_URL.
 */
import { randomUUID } from "node:crypto";

import { asTurnId } from "@lanyard/shared";
import { describe, expect, it } from "vitest";

import {
  proxyHarnessTurnsUntilAbort,
} from "../src/chat-delivery-events.js";
import type { HarnessHttpResponse } from "../src/harness-client.js";
import { createPgHarnessTurnRegistry } from "../src/harness-turn-registry-pg.js";
import type { ThreadLiveEvent } from "../src/thread-live-events.js";
import { createPgThreadLiveEventsHub } from "../src/thread-live-events-pg.js";

const pgUrl =
  process.env.CONTROL_PLANE_DATABASE_URL?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  "";

const describePg = pgUrl ? describe : describe.skip;

async function waitFor(
  cond: () => boolean | Promise<boolean>,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await cond()) return;
    if (Date.now() >= deadline) throw new Error("waitFor: condition not met");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function ident(prefix: string): string {
  return `${prefix}${randomUUID().replace(/-/g, "")}`;
}

function sseResponse(body: ReadableStream<Uint8Array>): HarnessHttpResponse {
  return {
    status: 200,
    ok: true,
    headers: { get: () => "text/event-stream" },
    body,
    text: async () => "",
    json: async () => ({}),
  };
}

function agentReady(threadId: string): ThreadLiveEvent {
  return {
    type: "agent_ready",
    instance_id: "inst-ht",
    thread_id: threadId,
    already_online: true,
    wake_joined: false,
    created_at: new Date().toISOString(),
  };
}

describePg("durable harness_turns + live-events hub (lp-k5c4.12)", () => {
  it("survives restart: latest/all/cancel turn_id still resolve", async () => {
    const schema = ident("ht");
    const threadId = ident("thr_");
    const turnId = asTurnId(`turn_${ident("x")}`);
    const first = await createPgHarnessTurnRegistry({
      connectionString: pgUrl,
      schema,
      owner: "replica-a",
      dropSchemaOnClose: false,
      claimTtlMs: 500,
    });
    try {
      await first.remember(threadId, turnId);
      expect(await first.latest(threadId)).toBe(turnId);
      await first.close();

      const restarted = await createPgHarnessTurnRegistry({
        connectionString: pgUrl,
        schema,
        owner: "replica-restart",
        dropSchemaOnClose: true,
        claimTtlMs: 500,
      });
      try {
        expect(await restarted.latest(threadId)).toBe(turnId);
        expect(await restarted.all(threadId)).toEqual([turnId]);
      } finally {
        await restarted.close();
      }
    } catch (error) {
      await first.close?.().catch(() => {});
      throw error;
    }
  });

  it("cancel on replica B finds turn_id remembered on replica A", async () => {
    const schema = ident("ht");
    const threadId = ident("thr_");
    const turnId = asTurnId(`turn_${ident("x")}`);
    const a = await createPgHarnessTurnRegistry({
      connectionString: pgUrl,
      schema,
      owner: "replica-a",
      dropSchemaOnClose: false,
      claimTtlMs: 500,
    });
    const b = await createPgHarnessTurnRegistry({
      connectionString: pgUrl,
      schema,
      owner: "replica-b",
      dropSchemaOnClose: true,
      claimTtlMs: 500,
    });
    try {
      await a.remember(threadId, turnId);
      expect(await b.latest(threadId)).toBe(turnId);
    } finally {
      await a.close();
      await b.close();
    }
  });

  it("claim is exclusive until lease expires; complete is terminal", async () => {
    const schema = ident("ht");
    const threadId = ident("thr_");
    const turnId = asTurnId(`turn_${ident("x")}`);
    const a = await createPgHarnessTurnRegistry({
      connectionString: pgUrl,
      schema,
      owner: "replica-a",
      dropSchemaOnClose: false,
      claimTtlMs: 250,
    });
    const b = await createPgHarnessTurnRegistry({
      connectionString: pgUrl,
      schema,
      owner: "replica-b",
      dropSchemaOnClose: true,
      claimTtlMs: 250,
    });
    try {
      await a.remember(threadId, turnId);
      expect(await a.claim(threadId, turnId)).toBe(true);
      expect(await b.claim(threadId, turnId)).toBe(false);
      await a.complete?.(threadId, turnId);
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(await b.claim(threadId, turnId)).toBe(false);
    } finally {
      await a.close();
      await b.close();
    }
  });

  it("kills replica A mid-turn; replica B still streams", async () => {
    const schema = ident("ht");
    const threadId = ident("thr_");
    const turnId = asTurnId(`turn_${ident("x")}`);
    const a = await createPgHarnessTurnRegistry({
      connectionString: pgUrl,
      schema,
      owner: "replica-a",
      dropSchemaOnClose: false,
      claimTtlMs: 300,
    });
    const b = await createPgHarnessTurnRegistry({
      connectionString: pgUrl,
      schema,
      owner: "replica-b",
      dropSchemaOnClose: true,
      claimTtlMs: 300,
    });

    const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
    const harnessClient = {
      openTurnEventStream: async () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controllers.push(controller);
          },
        });
        return sseResponse(stream);
      },
    };

    const chunksA: string[] = [];
    const chunksB: string[] = [];
    const abortA = new AbortController();
    const abortB = new AbortController();

    try {
      await a.remember(threadId, turnId);

      const runA = proxyHarnessTurnsUntilAbort({
        threadId,
        harnessClient,
        registry: a,
        abort: abortA.signal,
        proxyBody: async (body) => {
          const reader = body.getReader();
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunksA.push(decoder.decode(value));
          }
        },
        writeError: async () => {},
        stallTimeoutMs: 60_000,
      });

      await waitFor(() => controllers.length === 1);
      controllers[0]?.enqueue(new TextEncoder().encode("data: from-a\n\n"));
      await waitFor(() => chunksA.some((chunk) => chunk.includes("from-a")));

      abortA.abort();
      try {
        controllers[0]?.error(new Error("replica-a killed"));
      } catch {
        /* already closed */
      }
      await runA.catch(() => {});
      await a.close();

      await waitFor(async () => b.claim(threadId, turnId), 2_000);

      const runB = proxyHarnessTurnsUntilAbort({
        threadId,
        harnessClient,
        registry: b,
        abort: abortB.signal,
        proxyBody: async (body) => {
          const reader = body.getReader();
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunksB.push(decoder.decode(value));
          }
        },
        writeError: async () => {},
        stallTimeoutMs: 60_000,
      });

      await waitFor(() => controllers.length === 2);
      controllers[1]?.enqueue(new TextEncoder().encode("data: from-b\n\n"));
      controllers[1]?.close();
      await waitFor(() => chunksB.some((chunk) => chunk.includes("from-b")));
      abortB.abort();
      await runB;

      expect(chunksB.join("")).toContain("from-b");
      expect(await b.latest(threadId)).toBe(turnId);
    } finally {
      abortA.abort();
      abortB.abort();
      await a.close?.().catch(() => {});
      await b.close?.().catch(() => {});
    }
  });

  it("subscribe on replica B fires when replica A remembers a turn", async () => {
    const schema = ident("ht");
    const threadId = ident("thr_");
    const turnId = asTurnId(`turn_${ident("x")}`);
    const a = await createPgHarnessTurnRegistry({
      connectionString: pgUrl,
      schema,
      owner: "replica-a",
      dropSchemaOnClose: false,
      claimTtlMs: 500,
    });
    const b = await createPgHarnessTurnRegistry({
      connectionString: pgUrl,
      schema,
      owner: "replica-b",
      dropSchemaOnClose: true,
      claimTtlMs: 500,
    });
    const seen: string[] = [];
    try {
      await a.ready?.();
      await b.ready?.();
      b.subscribe(threadId, (id) => {
        seen.push(String(id));
      });
      await a.remember(threadId, turnId);
      await waitFor(() => seen.includes(String(turnId)));
      expect(seen).toContain(String(turnId));
    } finally {
      await a.close();
      await b.close();
    }
  });

  it("live-events publish on replica A reaches subscribers on replica B", async () => {
    const schema = ident("tle");
    const threadId = ident("thr_");
    const a = await createPgThreadLiveEventsHub({
      connectionString: pgUrl,
      schema,
      owner: "replica-a",
      dropSchemaOnClose: false,
    });
    const b = await createPgThreadLiveEventsHub({
      connectionString: pgUrl,
      schema,
      owner: "replica-b",
      dropSchemaOnClose: true,
    });
    const received: ThreadLiveEvent[] = [];
    try {
      b.subscribe(threadId, (event) => {
        received.push(event);
      });
      await a.publish(threadId, agentReady(threadId));
      await waitFor(() => received.length === 1);
      expect(received[0]).toMatchObject({
        type: "agent_ready",
        thread_id: threadId,
      });
    } finally {
      await a.close?.();
      await b.close?.();
    }
  });
});
