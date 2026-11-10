/**
 * Postgres LISTEN/NOTIFY fan-out for BFF-originated chat live events
 * (plan 0019 §4.3 / lp-k5c4.12).
 *
 * Events stay ephemeral (same as the in-process hub). The bus is durable
 * enough that a publish on replica A reaches SSE subscribers on replica B.
 * Kill/restart of the publishing replica does not drop the subscriber's
 * connection on another replica.
 *
 * Uses CONTROL_PLANE_DATABASE_URL. Do not point this at Prisma DATABASE_URL.
 */

import { randomUUID } from "node:crypto";

import pg from "pg";

import type {
  ThreadLiveEvent,
  ThreadLiveEventHandler,
  ThreadLiveEventsHub,
} from "./thread-live-events.js";

const { Pool } = pg;

export const THREAD_LIVE_EVENTS_NOTIFY_CHANNEL = "thread_live_events";

export type CreatePgThreadLiveEventsHubOptions = {
  connectionString: string;
  schema?: string;
  owner?: string;
  notifyChannel?: string;
  dropSchemaOnClose?: boolean;
};

type NotifyPayload = {
  origin: string;
  thread_id: string;
  event: ThreadLiveEvent;
};

function quoteIdent(ident: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(ident)) {
    throw new Error(`Invalid SQL identifier: ${ident}`);
  }
  return `"${ident}"`;
}

function resolveLiveEventsDatabaseUrl(explicit?: string): string {
  const url =
    explicit?.trim() || process.env.CONTROL_PLANE_DATABASE_URL?.trim() || "";
  if (!url) {
    throw new Error(
      "Thread live-events hub requires CONTROL_PLANE_DATABASE_URL (Postgres). " +
        "Do not reuse Prisma DATABASE_URL / portal_app.",
    );
  }
  return url;
}

function parseNotifyPayload(raw: string): NotifyPayload | null {
  try {
    const value = JSON.parse(raw) as Partial<NotifyPayload>;
    if (
      typeof value.origin !== "string" ||
      typeof value.thread_id !== "string" ||
      !value.event ||
      typeof value.event !== "object" ||
      typeof (value.event as { type?: unknown }).type !== "string"
    ) {
      return null;
    }
    return {
      origin: value.origin,
      thread_id: value.thread_id,
      event: value.event as ThreadLiveEvent,
    };
  } catch {
    return null;
  }
}

export async function createPgThreadLiveEventsHub(
  options: CreatePgThreadLiveEventsHubOptions,
): Promise<ThreadLiveEventsHub> {
  const connectionString = resolveLiveEventsDatabaseUrl(
    options.connectionString,
  );
  const schema = options.schema?.trim() || null;
  const owner = options.owner?.trim() || randomUUID();
  const channel =
    options.notifyChannel?.trim() || THREAD_LIVE_EVENTS_NOTIFY_CHANNEL;
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(channel)) {
    throw new Error(`Invalid NOTIFY channel: ${channel}`);
  }
  const dropSchemaOnClose = options.dropSchemaOnClose ?? Boolean(schema);

  if (schema) {
    const bootstrap = new Pool({ connectionString });
    try {
      await bootstrap.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)}`);
    } finally {
      await bootstrap.end();
    }
  }

  const pool = new Pool({
    connectionString,
    ...(schema ? { options: `-c search_path=${schema},public` } : {}),
  });
  await pool.query("SELECT 1");

  const byThread = new Map<string, Set<ThreadLiveEventHandler>>();

  const fireLocal = (threadId: string, event: ThreadLiveEvent) => {
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
  };

  const listenClient = await pool.connect();
  listenClient.on("error", () => {
    /* LISTEN connection errors must not crash the replica */
  });
  await listenClient.query(`LISTEN ${channel}`);
  listenClient.on("notification", (message) => {
    if (message.channel !== channel || !message.payload) return;
    const payload = parseNotifyPayload(message.payload);
    if (!payload || payload.origin === owner) return;
    fireLocal(payload.thread_id, payload.event);
  });

  let closed = false;

  const hub: ThreadLiveEventsHub = {
    publish(threadId, event) {
      fireLocal(threadId, event);
      const payload: NotifyPayload = {
        origin: owner,
        thread_id: threadId,
        event,
      };
      const encoded = JSON.stringify(payload);
      if (encoded.length > 8000) {
        console.error(
          `[thread-live-events] NOTIFY payload exceeds 8000 bytes (${encoded.length}); dropping cross-replica fan-out`,
        );
        return;
      }
      return pool
        .query("SELECT pg_notify($1, $2)", [channel, encoded])
        .then(() => undefined);
    },

    subscribe(threadId, handler) {
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

    listenerCount(threadId) {
      return byThread.get(threadId)?.size ?? 0;
    },

    async close() {
      if (closed) return;
      closed = true;
      try {
        await listenClient.query(`UNLISTEN ${channel}`);
      } catch {
        /* closing */
      }
      listenClient.release();
      try {
        if (schema && dropSchemaOnClose) {
          await pool.query(
            `DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`,
          );
        }
      } finally {
        await pool.end();
      }
    },
  };

  return hub;
}

export function createLazyPgThreadLiveEventsHub(
  connectionString: string,
  options: Omit<CreatePgThreadLiveEventsHubOptions, "connectionString"> = {},
): ThreadLiveEventsHub {
  let resolved: ThreadLiveEventsHub | undefined;
  const ready = createPgThreadLiveEventsHub({
    ...options,
    connectionString,
  }).then((hub) => {
    resolved = hub;
    return hub;
  });
  const get = () => ready;

  return {
    publish: async (threadId, event) => {
      await (await get()).publish(threadId, event);
    },
    subscribe(threadId, handler) {
      if (resolved) {
        return resolved.subscribe(threadId, handler);
      }
      let unsub = () => {};
      let cancelled = false;
      void get().then((hub) => {
        if (cancelled) return;
        unsub = hub.subscribe(threadId, handler);
      });
      return () => {
        cancelled = true;
        unsub();
      };
    },
    listenerCount(threadId) {
      return resolved?.listenerCount(threadId) ?? 0;
    },
    close: async () => {
      await (await get()).close?.();
    },
  };
}
