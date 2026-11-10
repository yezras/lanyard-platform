/**
 * Thread → harness TurnId registry (plan 0015 / lp-oop.16 / lp-k5c4.12).
 *
 * POST /messages remembers the turn. GET …/events and POST …/cancel look
 * it up so browser contracts stay per-thread while the harness wire is
 * per-turn. Same single-task assumption as thread live-events (G6) for the
 * in-process default.
 *
 * Multi-replica BFF injects the Postgres implementation
 * (`harness-turn-registry-pg.ts`) so turn_id survives restart and cancel
 * on another replica still finds it.
 */

import { asTurnId, type TurnId } from "@lanyard/shared";

export type HarnessTurnHandler = (turnId: TurnId) => void;

export type HarnessTurnRegistry = {
  remember(threadId: string, turnId: string): TurnId | Promise<TurnId>;
  latest(threadId: string): TurnId | undefined | Promise<TurnId | undefined>;
  /** All remembered turn ids for the thread, oldest first (lp-znef.1). */
  all(threadId: string): TurnId[] | Promise<TurnId[]>;
  /** True once per (thread, turn): exactly-once SSE streaming claim. */
  claim(threadId: string, turnId: string): boolean | Promise<boolean>;
  /**
   * Mark a claimed turn finished so failover will not re-stream it.
   * In-process default is a no-op (claim is already terminal).
   */
  complete?(threadId: string, turnId: string): void | Promise<void>;
  /** Wait until durable backing (LISTEN) is up. In-process is a no-op. */
  ready?(): Promise<void>;
  subscribe(threadId: string, handler: HarnessTurnHandler): () => void;
  listenerCount(threadId: string): number;
  close?(): Promise<void>;
};

export function createHarnessTurnRegistry(): HarnessTurnRegistry {
  const turnsByThread = new Map<string, TurnId[]>();
  const claimed = new Set<string>();
  const handlersByThread = new Map<string, Set<HarnessTurnHandler>>();

  return {
    remember(threadId, turnId) {
      const id = asTurnId(turnId);
      const turns = turnsByThread.get(threadId);
      if (turns) {
        turns.push(id);
      } else {
        turnsByThread.set(threadId, [id]);
      }
      const handlers = handlersByThread.get(threadId);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(id);
          } catch {
            /* subscriber errors must not break remember */
          }
        }
      }
      return id;
    },

    latest(threadId) {
      const turns = turnsByThread.get(threadId);
      return turns?.[turns.length - 1];
    },

    all(threadId) {
      return [...(turnsByThread.get(threadId) ?? [])];
    },

    claim(threadId, turnId) {
      const key = `${threadId}::${turnId}`;
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    },

    complete(threadId, turnId) {
      claimed.add(`${threadId}::${turnId}`);
    },

    subscribe(threadId, handler) {
      let set = handlersByThread.get(threadId);
      if (!set) {
        set = new Set();
        handlersByThread.set(threadId, set);
      }
      set.add(handler);
      return () => {
        const current = handlersByThread.get(threadId);
        if (!current) return;
        current.delete(handler);
        if (current.size === 0) {
          handlersByThread.delete(threadId);
        }
      };
    },

    listenerCount(threadId) {
      return handlersByThread.get(threadId)?.size ?? 0;
    },
  };
}
