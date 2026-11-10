/**
 * Fan-out for BFF-originated chat live events (lp-u7z / lp-k5c4.12).
 *
 * Message POST (ensure_online) publishes; GET …/events SSE subscribers receive
 * on the same connection that later proxies relay/harness chat events.
 *
 * Default is process-local. Multi-replica BFF injects the Postgres
 * LISTEN/NOTIFY hub (`thread-live-events-pg.ts`) so a publish on one
 * replica reaches SSE subscribers on another.
 */

import type { AgentWakeLiveEvent } from "./agent-starting-events.js";
import type { ChatHistoryEvent } from "./chat-store.js";
import type { MailboxFuseTripLiveEvent } from "./mailbox-fuse-notice.js";

export type ConnectorQrLiveEvent = {
  type: "connector.qr";
  chat_id: string;
  message_id?: string;
  connector_id: "whatsapp";
  pairing_id: string;
  code: string;
  ts: number;
  phase: "code" | "complete" | "failed" | "needs_reauth";
  content?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
};

export type ThreadLiveEvent =
  | AgentWakeLiveEvent
  | ConnectorQrLiveEvent
  | MailboxFuseTripLiveEvent
  | ChatHistoryEvent;

export type ThreadLiveEventHandler = (
  event: ThreadLiveEvent,
) => void | Promise<void>;

export type ThreadLiveEventsHub = {
  publish(threadId: string, event: ThreadLiveEvent): void | Promise<void>;
  subscribe(threadId: string, handler: ThreadLiveEventHandler): () => void;
  /** Test/support: number of active handlers for a thread. */
  listenerCount(threadId: string): number;
  close?(): Promise<void>;
};

/**
 * Create a process-local pub/sub hub. Handlers run in parallel; publish does
 * not await them (fire-and-forget with caught rejections) so message POST
 * never blocks on a slow SSE write.
 */
export function createThreadLiveEventsHub(): ThreadLiveEventsHub {
  const byThread = new Map<string, Set<ThreadLiveEventHandler>>();

  return {
    publish(threadId: string, event: ThreadLiveEvent): void {
      const handlers = byThread.get(threadId);
      if (!handlers || handlers.size === 0) return;
      for (const handler of handlers) {
        try {
          const result = handler(event);
          if (result && typeof (result as Promise<void>).then === "function") {
            void (result as Promise<void>).catch(() => {
              /* subscriber write failures must not break publish */
            });
          }
        } catch {
          /* ignore sync handler errors */
        }
      }
    },

    subscribe(threadId: string, handler: ThreadLiveEventHandler): () => void {
      let set = byThread.get(threadId);
      if (!set) {
        set = new Set();
        byThread.set(threadId, set);
      }
      set.add(handler);
      return () => {
        const current = byThread.get(threadId);
        if (!current) return;
        current.delete(handler);
        if (current.size === 0) {
          byThread.delete(threadId);
        }
      };
    },

    listenerCount(threadId: string): number {
      return byThread.get(threadId)?.size ?? 0;
    },
  };
}
