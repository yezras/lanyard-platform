/**
 * Dual-run chat SSE (plan 0015 / lp-oop.16).
 *
 * `ChatDelivery=harness` proxies harness turn SSE onto the existing
 * GET /api/chat/threads/:id/events connection. Shapes stay RelayChatEvent.
 *
 * lp-v62i.8: a harness turn that streams nothing (wedged harness, dead box)
 * used to hang this proxy forever with no tokens and no error — live MockLab
 * turn_37 was silently eaten on 2026-08-26. Each turn body now runs behind a
 * no-activity watchdog: if no bytes arrive within
 * `stallTimeoutMs` (default {@link DEFAULT_HARNESS_TURN_STALL_TIMEOUT_MS}, 0
 * disables) the stream is torn down, an SSE `error` is surfaced to the client,
 * and the loop moves on. A turn that closes cleanly without ever emitting a
 * byte is surfaced the same way ("completed without a response"). Every turn
 * gets a completion log line so silence is diagnosable afterwards.
 */

import type { TurnId } from "@lanyard/shared";

import {
  harnessEventStreamBody,
  type HarnessClient,
} from "./harness-client.js";
import type { HarnessTurnRegistry } from "./harness-turn-registry.js";

/**
 * Default max silence (no bytes from harness) before a proxied turn is
 * declared stalled. Generous enough for long model thinking; far below the
 * "Taste waited 105s and gave up" UX floor plus idle-reap window that made
 * lp-v62i.8 invisible.
 */
export const DEFAULT_HARNESS_TURN_STALL_TIMEOUT_MS = 120_000;

/** Error thrown by the watchdog when a turn emits nothing for too long. */
export class HarnessTurnStallError extends Error {
  readonly stallTimeoutMs: number;
  constructor(stallTimeoutMs: number) {
    super(`harness turn stalled after ${stallTimeoutMs}ms of silence`);
    this.name = "HarnessTurnStallError";
    this.stallTimeoutMs = stallTimeoutMs;
  }
}

/**
 * Wrap a turn body so reads race a no-activity timer. The wrapper (not the
 * consumer) owns the source reader: when the timer wins we cancel the source
 * and error the wrapped stream, which rejects the consumer's pending read.
 * A `stallTimeoutMs <= 0` disables the watchdog entirely.
 */
export function guardTurnBodyAgainstStall(
  body: ReadableStream<Uint8Array>,
  opts: { stallTimeoutMs: number; onActivity: () => void },
): ReadableStream<Uint8Array> {
  if (opts.stallTimeoutMs <= 0) return body;
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new HarnessTurnStallError(opts.stallTimeoutMs)),
              opts.stallTimeoutMs,
            );
          }),
        ]);
        if (result.done) {
          controller.close();
          return;
        }
        opts.onActivity();
        controller.enqueue(result.value);
      } catch (error) {
        void reader.cancel().catch(() => {});
        controller.error(error);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
    cancel(reason) {
      void reader.cancel(reason).catch(() => {});
    },
  });
}

export async function proxyHarnessTurnsUntilAbort(input: {
  threadId: string;
  harnessClient: Pick<HarnessClient, "openTurnEventStream">;
  registry: HarnessTurnRegistry;
  abort: AbortSignal;
  proxyBody: (body: ReadableStream<Uint8Array>) => Promise<void>;
  writeError: (message: string) => Promise<void>;
  /** Fired after a turn's event stream closes (turn done) — lp-znef.3 hop chain. */
  onTurnComplete?: (turnId: TurnId) => Promise<void>;
  /**
   * lp-k5c4.7 — fired when this proxy is done with a claimed turn (success,
   * empty close, stall, or stream open failure). Used to clear mid_turn so
   * the hot window can stop the box. Not fired on client abort.
   */
  onTurnSettled?: (turnId: TurnId) => Promise<void>;
  /**
   * lp-v62i.8 — max ms of total silence (no bytes) tolerated per proxied
   * harness turn before surfacing an SSE error. 0 disables the watchdog.
   * Default {@link DEFAULT_HARNESS_TURN_STALL_TIMEOUT_MS}.
   */
  stallTimeoutMs?: number;
  /**
   * Drain currently remembered turns (claiming exactly-once) then return.
   * Mailbox hop persist uses this so Bill's output is stored without a
   * GET /events subscriber and without waiting for later remembers.
   */
  existingOnly?: boolean;
}): Promise<void> {
  const pending: TurnId[] = [];
  const seen = new Set<string>();
  let notify: (() => void) | undefined;

  const enqueue = async (turnId: TurnId) => {
    if (seen.has(turnId)) return;
    // Exactly-once: a turn another connection already streamed (or an old
    // turn replayed on reconnect) must not re-enter this queue, or durable
    // history would double-append (lp-znef.1 live-QA finding). Durable
    // claims are leases: a dead replica's claim expires so failover can
    // steal; complete() is terminal.
    if (!(await input.registry.claim(input.threadId, turnId))) return;
    seen.add(turnId);
    pending.push(turnId);
    notify?.();
  };

  if (typeof input.registry.ready === "function") {
    await input.registry.ready();
  }
  const unsub = input.existingOnly
    ? () => {}
    : input.registry.subscribe(input.threadId, (turnId) => {
        void enqueue(turnId);
      });
  // lp-znef.1: drain every remembered turn (persona fan-out starts several
  // before the SSE connection opens; registry.latest alone loses all but the
  // last). claim() makes the drain exactly-once across connections.
  for (const turnId of await input.registry.all(input.threadId)) {
    await enqueue(turnId);
  }

  const waitForTurn = (): Promise<void> => {
    if (pending.length > 0 || input.abort.aborted) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const onAbort = () => {
        input.abort.removeEventListener("abort", onAbort);
        notify = undefined;
        resolve();
      };
      notify = () => {
        input.abort.removeEventListener("abort", onAbort);
        notify = undefined;
        resolve();
      };
      input.abort.addEventListener("abort", onAbort);
    });
  };

  const stallTimeoutMs =
    input.stallTimeoutMs ?? DEFAULT_HARNESS_TURN_STALL_TIMEOUT_MS;

  try {
    while (!input.abort.aborted) {
      if (pending.length === 0) {
        if (input.existingOnly) break;
        await waitForTurn();
        if (input.abort.aborted) break;
      }
      const turnId = pending.shift();
      if (!turnId) continue;
      console.error(`[harness-proxy] streaming turn ${turnId} (${input.threadId})`);

      const settleTurn = async () => {
        if (input.abort.aborted || !input.onTurnSettled) return;
        try {
          await input.onTurnSettled(turnId);
        } catch (error) {
          console.error(
            `[harness-proxy] onTurnSettled ${turnId} failed:`,
            error instanceof Error ? error.message : error,
          );
        }
      };

      let response;
      try {
        response = await input.harnessClient.openTurnEventStream(
          turnId,
          input.abort,
        );
      } catch (error) {
        if (input.abort.aborted) break;
        await input.writeError(
          error instanceof Error ? error.message : "Harness event stream error",
        );
        await settleTurn();
        continue;
      }

      if (!response.ok) {
        console.error(`[harness-proxy] stream ${turnId} failed: ${response.status}`);
        await input.writeError(
          `Failed to connect to harness event stream (${response.status})`,
        );
        await settleTurn();
        continue;
      }

      const body = await harnessEventStreamBody(response);
      if (!body) {
        await input.writeError("Failed to connect to harness event stream");
        await settleTurn();
        continue;
      }

      // lp-v62i.8: count activity chunks so a clean close with zero bytes is
      // still surfaced instead of silently eating the turn.
      let activityChunks = 0;
      const guarded = guardTurnBodyAgainstStall(body, {
        stallTimeoutMs,
        onActivity: () => {
          activityChunks += 1;
        },
      });

      try {
        await input.proxyBody(guarded);
      } catch (error) {
        if (input.abort.aborted) break;
        if (error instanceof HarnessTurnStallError) {
          console.error(
            `[harness-proxy] stream ${turnId} stalled after ${error.stallTimeoutMs}ms of silence`,
          );
          await input.writeError(
            `Agent turn stalled — no activity from the agent for ${Math.round(
              error.stallTimeoutMs / 1000,
            )}s`,
          );
          await input.registry.complete?.(input.threadId, turnId);
          await settleTurn();
          continue;
        }
        throw error;
      }

      if (input.abort.aborted) break;

      console.error(`[harness-proxy] stream ${turnId} complete`);
      await input.registry.complete?.(input.threadId, turnId);
      if (activityChunks === 0 && !input.abort.aborted) {
        console.error(
          `[harness-proxy] stream ${turnId} completed without any events`,
        );
        await input.writeError("Agent turn completed without a response");
      }
      if (input.onTurnComplete && !input.abort.aborted) {
        try {
          await input.onTurnComplete(turnId);
        } catch (error) {
          // Hop-chain failures must never break the SSE proxy loop.
          console.error(
            `[harness-proxy] onTurnComplete ${turnId} failed:`,
            error instanceof Error ? error.message : error,
          );
        }
      }
      await settleTurn();
    }
  } finally {
    unsub();
  }
}
