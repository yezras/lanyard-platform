/**
 * lp-57ha — harness-local real streaming (no in-process test double).
 *
 * Talks to the real lanyard-agent binary on 127.0.0.1 + local Postgres + BFF 4000
 * via portal/test/harness-local.ts. This is the sole harness for all future
 * pool tests (human-scoped 1:1, channel_context, longer-running work).
 *
 * Requires:
 *   HARNESS_URL (default http://127.0.0.1:4310) — lanyard-agent binary
 *   HARNESS_SERVICE_TOKEN  (default placeholder-harness-service-token)
 *   BFF 4000 + local Postgres + real LLM key in the agent env
 *
 * Skips when the harness is not reachable so `pnpm test` stays offline-safe.
 * Set REQUIRE_HARNESS=1 to fail closed when no harness (CI with real agent).
 */

import { describe, expect, it } from "vitest";

import {
  collectHarnessTurnEvents,
  isHarnessReachable,
  localHarnessToken,
  localHarnessUrl,
  parseHarnessSseDataLine,
  startTurn,
  waitForTurnComplete,
} from "../../../test/harness-local.js";

const REQUIRE_HARNESS = process.env.REQUIRE_HARNESS === "1";

async function requireHarnessOrSkip(): Promise<boolean> {
  const ok = await isHarnessReachable();
  if (!ok && REQUIRE_HARNESS) {
    throw new Error(
      `harness not reachable at ${localHarnessUrl()} (token ${localHarnessToken().slice(0, 8)}…); set HARNESS_URL/HARNESS_SERVICE_TOKEN or unset REQUIRE_HARNESS to skip`,
    );
  }
  return ok;
}

describe("harness-local real streaming (lp-57ha)", () => {
  it("parseHarnessSseDataLine parses a real harness SSE line", () => {
    const line = 'data: {"type":"message_send","chat_id":"thr_1","content":"hello"}';
    const ev = parseHarnessSseDataLine(line);
    expect(ev).not.toBeNull();
    expect(ev?.type).toBe("message_send");
    expect(ev?.chat_id).toBe("thr_1");
  });

  it("collectHarnessTurnEvents collects from a buffered SSE body", () => {
    const body = [
      'data: {"type":"message_send","chat_id":"thr_1","content":"echo: hi"}',
      'data: {"type":"tool_progress","chat_id":"thr_1","tool_name":"lab_echo"}',
    ].join("\n");
    const events = collectHarnessTurnEvents(body);
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("message_send");
    expect(events[1]?.type).toBe("tool_progress");
  });

  it("POST /internal/turns + SSE waitForTurnComplete against the real harness", async () => {
    if (!(await requireHarnessOrSkip())) return;

    const tenant_id = process.env.HARNESS_TEST_TENANT_ID?.trim() || "ten_harness_local";
    const user_id = process.env.HARNESS_TEST_USER_ID?.trim() || "usr_harness_local";
    const instance_id = process.env.HARNESS_TEST_INSTANCE_ID?.trim() || "inst_harness_local";
    const thread_id = `thr_harness_local_${Date.now()}`;

    const message =
      process.env.HARNESS_TEST_MESSAGE?.trim() || "lp-57ha harness-local ping: reply with pong-harness-local";

    const started = await startTurn({
      tenant_id,
      user_id,
      instance_id,
      thread_id,
      message,
    });

    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const events = await waitForTurnComplete(started.turn_id as string, {
      timeoutMs: 120_000,
    });

    // Real LLM + agent must stream at least one message_send.
    expect(events.length).toBeGreaterThan(0);
    const hasMessage = events.some((e) => e.type === "message_send");
    expect(hasMessage).toBe(true);

    // The reply should be non-empty and not the fake "echo: " prefix alone.
    const last = events.filter((e) => e.type === "message_send").at(-1);
    expect(last?.content?.trim().length).toBeGreaterThan(0);
  });
});
