/**
 * lp-v62i.8 — harness-proxy must never silently eat a turn.
 *
 * Live MockLab 2026-08-26: Taste send 200d onto harness turn_37; BFF
 * [harness-proxy] opened the turn event stream which emitted nothing forever;
 * no reply, no error, and the idle reaper killed the bound box mid-turn.
 *
 * Acceptance proven here:
 * - A silent turn is torn down after `stallTimeoutMs` and surfaces an SSE
 *   error ("Agent turn stalled") instead of hanging forever.
 * - Activity resets the watchdog (long legitimate turns are not killed).
 * - A turn that closes cleanly without emitting anything also surfaces an
 *   error ("completed without a response").
 * - Every turn gets a `[harness-proxy] stream <id> complete` bookend log.
 * - `stallTimeoutMs: 0` disables the watchdog (old behavior opt-in).
 * - The proxy loop survives a stall and keeps serving later turns.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { asTurnId } from "@lanyard/shared";

import {
  DEFAULT_HARNESS_TURN_STALL_TIMEOUT_MS,
  HarnessTurnStallError,
  guardTurnBodyAgainstStall,
  proxyHarnessTurnsUntilAbort,
} from "../src/chat-delivery-events.js";
import type { HarnessHttpResponse } from "../src/harness-client.js";
import { createHarnessTurnRegistry } from "../src/harness-turn-registry.js";

function manualBody() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    stream,
    push(text: string) {
      controller.enqueue(new TextEncoder().encode(text));
    },
    close() {
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  };
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

async function waitFor(cond: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("waitFor: condition not met");
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function drainBody(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

describe("lp-v62i.8: harness-proxy turn watchdog", () => {
  let consoleError: ReturnType<typeof vi.spyOn> | undefined;

  afterEach(() => {
    consoleError?.mockRestore();
    consoleError = undefined;
    vi.restoreAllMocks();
  });

  function spyLog() {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    return consoleError;
  }

  it("default stall timeout is 120s and stall error carries it", () => {
    expect(DEFAULT_HARNESS_TURN_STALL_TIMEOUT_MS).toBe(120_000);
    const err = new HarnessTurnStallError(120_000);
    expect(err.stallTimeoutMs).toBe(120_000);
    expect(err.name).toBe("HarnessTurnStallError");
  });

  it("streams a healthy turn with no error and logs the complete bookend", async () => {
    const log = spyLog();
    const box = manualBody();
    const registry = createHarnessTurnRegistry();
    registry.remember("t1", asTurnId("turn_1"));
    const errors: string[] = [];
    const completed: string[] = [];
    const abort = new AbortController();

    const run = proxyHarnessTurnsUntilAbort({
      threadId: "t1",
      harnessClient: {
        openTurnEventStream: async () => sseResponse(box.stream),
      },
      registry,
      abort: abort.signal,
      proxyBody: async (body) => {
        await drainBody(body);
      },
      writeError: async (message) => {
        errors.push(message);
      },
      onTurnComplete: async (turnId) => {
        completed.push(String(turnId));
      },
    });

    box.push('data: {"type":"message_send","content":"hi"}\n');
    box.close();
    await waitFor(() => completed.length > 0);
    abort.abort();
    await run;

    expect(errors).toEqual([]);
    expect(completed).toEqual(["turn_1"]);
    expect(
      log.mock.calls.some((args) =>
        String(args[0]).includes("[harness-proxy] stream turn_1 complete"),
      ),
    ).toBe(true);
  });

  it("a silent turn is torn down after stallTimeoutMs and surfaces an error", async () => {
    const log = spyLog();
    const box = manualBody();
    const registry = createHarnessTurnRegistry();
    registry.remember("t1", asTurnId("turn_1"));
    const errors: string[] = [];
    const abort = new AbortController();

    const run = proxyHarnessTurnsUntilAbort({
      threadId: "t1",
      harnessClient: {
        openTurnEventStream: async () => sseResponse(box.stream),
      },
      registry,
      abort: abort.signal,
      proxyBody: async (body) => {
        await drainBody(body);
      },
      writeError: async (message) => {
        errors.push(message);
      },
      stallTimeoutMs: 25,
    });

    // Live turn_37 shape: stream opens, nothing ever arrives.
    await waitFor(() => errors.length > 0);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Agent turn stalled");
    expect(
      log.mock.calls.some((args) =>
        String(args[0]).includes(
          "[harness-proxy] stream turn_1 stalled after 25ms of silence",
        ),
      ),
    ).toBe(true);

    abort.abort();
    await run;
  });

  it("survives a stalled turn and keeps proxying later turns", async () => {
    const log = spyLog();
    const deadBox = manualBody();
    const liveBox = manualBody();
    const bodies: Record<string, ReadableStream<Uint8Array>> = {
      turn_37: deadBox.stream,
      turn_38: liveBox.stream,
    };
    const registry = createHarnessTurnRegistry();
    registry.remember("t1", asTurnId("turn_37"));
    registry.remember("t1", asTurnId("turn_38"));
    const errors: string[] = [];
    const completed: string[] = [];
    const abort = new AbortController();

    const run = proxyHarnessTurnsUntilAbort({
      threadId: "t1",
      harnessClient: {
        openTurnEventStream: async (turnId) =>
          sseResponse(bodies[String(turnId)]),
      },
      registry,
      abort: abort.signal,
      proxyBody: async (body) => {
        await drainBody(body);
      },
      writeError: async (message) => {
        errors.push(message);
      },
      onTurnComplete: async (turnId) => {
        completed.push(String(turnId));
      },
      stallTimeoutMs: 25,
    });

    // turn_38 streams healthily (buffered chunks) while turn_37 wedges.
    liveBox.push('data: {"type":"message_send","content":"reply"}\n');
    liveBox.close();

    await waitFor(() => completed.includes("turn_38"));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("stalled");
    expect(completed).toEqual(["turn_38"]);
    expect(
      log.mock.calls.some((args) =>
        String(args[0]).includes("[harness-proxy] stream turn_37 stalled"),
      ),
    ).toBe(true);

    abort.abort();
    await run;
  });

  it("onTurnSettled fires for a stalled turn and a later healthy turn (lp-k5c4.7)", async () => {
    spyLog();
    const deadBox = manualBody();
    const liveBox = manualBody();
    const bodies: Record<string, ReadableStream<Uint8Array>> = {
      turn_37: deadBox.stream,
      turn_38: liveBox.stream,
    };
    const registry = createHarnessTurnRegistry();
    registry.remember("t1", asTurnId("turn_37"));
    registry.remember("t1", asTurnId("turn_38"));
    const settled: string[] = [];
    const abort = new AbortController();

    const run = proxyHarnessTurnsUntilAbort({
      threadId: "t1",
      harnessClient: {
        openTurnEventStream: async (turnId) =>
          sseResponse(bodies[String(turnId)]),
      },
      registry,
      abort: abort.signal,
      proxyBody: async (body) => {
        await drainBody(body);
      },
      writeError: async () => {},
      onTurnSettled: async (turnId) => {
        settled.push(String(turnId));
      },
      stallTimeoutMs: 25,
    });

    liveBox.push('data: {"type":"message_send","content":"reply"}\n');
    liveBox.close();
    await waitFor(() => settled.includes("turn_38"));
    expect(settled).toEqual(["turn_37", "turn_38"]);
    abort.abort();
    await run;
  });

  it("activity resets the watchdog — long turns with steady output survive", async () => {
    const log = spyLog();
    const box = manualBody();
    const registry = createHarnessTurnRegistry();
    registry.remember("t1", asTurnId("turn_1"));
    const errors: string[] = [];
    const abort = new AbortController();
    let sawDone = false;

    const run = proxyHarnessTurnsUntilAbort({
      threadId: "t1",
      harnessClient: {
        openTurnEventStream: async () => sseResponse(box.stream),
      },
      registry,
      abort: abort.signal,
      proxyBody: async (body) => {
        await drainBody(body);
        sawDone = true;
      },
      writeError: async (message) => {
        errors.push(message);
      },
      // Total streamed duration (~150ms of 15ms ticks) far exceeds the
      // 40ms watchdog — only per-chunk resets keep this alive.
      stallTimeoutMs: 40,
    });

    const ticker = setInterval(() => {
      box.push('data: {"type":"message_send","content":"tick"}\n');
    }, 15);
    setTimeout(() => {
      clearInterval(ticker);
      box.close();
    }, 160);

    await waitFor(() => sawDone, 3_000);
    expect(errors).toEqual([]);
    expect(
      log.mock.calls.some((args) =>
        String(args[0]).includes("[harness-proxy] stream turn_1 complete"),
      ),
    ).toBe(true);

    abort.abort();
    await run;
  });

  it("a turn that closes without ever emitting surfaces 'completed without a response'", async () => {
    const log = spyLog();
    const box = manualBody();
    const registry = createHarnessTurnRegistry();
    registry.remember("t1", asTurnId("turn_1"));
    const errors: string[] = [];
    const completed: string[] = [];
    const abort = new AbortController();

    const run = proxyHarnessTurnsUntilAbort({
      threadId: "t1",
      harnessClient: {
        openTurnEventStream: async () => sseResponse(box.stream),
      },
      registry,
      abort: abort.signal,
      proxyBody: async (body) => {
        await drainBody(body);
      },
      writeError: async (message) => {
        errors.push(message);
      },
      onTurnComplete: async (turnId) => {
        completed.push(String(turnId));
      },
      stallTimeoutMs: 5_000,
    });

    box.close();
    await waitFor(() => errors.length > 0);
    abort.abort();
    await run;

    expect(errors).toEqual(["Agent turn completed without a response"]);
    expect(
      log.mock.calls.some((args) =>
        String(args[0]).includes("completed without any events"),
      ),
    ).toBe(true);
    // Harness did close the turn — hop chain still fires.
    expect(completed).toEqual(["turn_1"]);
  });

  it("stallTimeoutMs 0 disables the watchdog (silent stream is not torn down)", async () => {
    const log = spyLog();
    const box = manualBody();
    const registry = createHarnessTurnRegistry();
    registry.remember("t1", asTurnId("turn_1"));
    const errors: string[] = [];
    const abort = new AbortController();

    const run = proxyHarnessTurnsUntilAbort({
      threadId: "t1",
      harnessClient: {
        openTurnEventStream: async () => sseResponse(box.stream),
      },
      registry,
      abort: abort.signal,
      proxyBody: async (body) => {
        await drainBody(body);
      },
      writeError: async (message) => {
        errors.push(message);
      },
      stallTimeoutMs: 0,
    });

    await new Promise((r) => setTimeout(r, 80));
    expect(errors).toEqual([]);
    expect(
      log.mock.calls.some((args) => String(args[0]).includes("stalled")),
    ).toBe(false);

    abort.abort();
    box.close();
    await run;
  });

  it("existingOnly drains remembered turns then returns without waiting", async () => {
    spyLog();
    const box = manualBody();
    const registry = createHarnessTurnRegistry();
    registry.remember("t1", asTurnId("turn_1"));
    const proxied: string[] = [];
    const abort = new AbortController();

    const run = proxyHarnessTurnsUntilAbort({
      threadId: "t1",
      harnessClient: {
        openTurnEventStream: async () => sseResponse(box.stream),
      },
      registry,
      abort: abort.signal,
      existingOnly: true,
      stallTimeoutMs: 0,
      proxyBody: async (body) => {
        proxied.push(await drainBody(body));
      },
      writeError: async () => {},
    });

    box.push('data: {"type":"message_send","content":"hi"}\n');
    box.close();
    await run;

    expect(proxied.length).toBe(1);
    expect(await registry.claim("t1", asTurnId("turn_1"))).toBe(false);
  });

  describe("guardTurnBodyAgainstStall unit", () => {
    it("passes bytes through and reports them via onActivity", async () => {
      const box = manualBody();
      let activity = 0;
      const guarded = guardTurnBodyAgainstStall(box.stream, {
        stallTimeoutMs: 1_000,
        onActivity: () => {
          activity += 1;
        },
      });
      const drained = drainBody(guarded);
      box.push("hello");
      box.close();
      expect(await drained).toBe("hello");
      expect(activity).toBe(1);
    });

    it("rejects pending reads with HarnessTurnStallError on silence", async () => {
      const box = manualBody();
      const guarded = guardTurnBodyAgainstStall(box.stream, {
        stallTimeoutMs: 10,
        onActivity: () => {},
      });
      const reader = guarded.getReader();
      await expect(reader.read()).rejects.toMatchObject({
        name: "HarnessTurnStallError",
      });
    });

    it("returns the same stream untouched when disabled", () => {
      const box = manualBody();
      const guarded = guardTurnBodyAgainstStall(box.stream, {
        stallTimeoutMs: 0,
        onActivity: () => {},
      });
      expect(guarded).toBe(box.stream);
    });
  });
});
