/**
 * Durable Postgres harness turn registry (plan 0019 §4.3 / lp-k5c4.12).
 *
 * `harness_turns` is the restart-safe thread → turn_id map. Claims are a
 * lease so a dead replica's in-flight stream can be stolen; `completed`
 * is terminal so reconnect does not double-append history.
 *
 * Cross-replica `subscribe` uses LISTEN/NOTIFY. Local handlers fire in
 * `remember` without waiting for the echo.
 *
 * Table lives on the control-plane database (CONTROL_PLANE_DATABASE_URL).
 * Do not point this at Prisma DATABASE_URL / portal_app.
 */

import { randomUUID } from "node:crypto";

import { asTurnId, type TurnId } from "@lanyard/shared";
import pg from "pg";

import type {
  HarnessTurnHandler,
  HarnessTurnRegistry,
} from "./harness-turn-registry.js";

const { Pool } = pg;

export const DEFAULT_HARNESS_TURN_CLAIM_TTL_MS = 10_000;
export const HARNESS_TURNS_NOTIFY_CHANNEL = "harness_turns";

export const HARNESS_TURNS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS harness_turns (
  thread_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  seq BIGSERIAL NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, turn_id)
);

CREATE INDEX IF NOT EXISTS harness_turns_thread_seq
  ON harness_turns (thread_id, seq);

CREATE TABLE IF NOT EXISTS harness_turn_claims (
  thread_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  PRIMARY KEY (thread_id, turn_id),
  claim_owner TEXT,
  claim_until TIMESTAMPTZ,
  completed BOOLEAN NOT NULL DEFAULT FALSE
);
`;

export type CreatePgHarnessTurnRegistryOptions = {
  connectionString: string;
  schema?: string;
  /** Replica id. Default random UUID. */
  owner?: string;
  /** Streaming claim lease. Default 10s; heartbeat is ttl/3. */
  claimTtlMs?: number;
  notifyChannel?: string;
  dropSchemaOnClose?: boolean;
};

type TurnRow = { turn_id: string };
type NotifyPayload = { origin: string; thread_id: string; turn_id: string };

function quoteIdent(ident: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(ident)) {
    throw new Error(`Invalid SQL identifier: ${ident}`);
  }
  return `"${ident}"`;
}

function resolveHarnessTurnsDatabaseUrl(explicit?: string): string {
  const url =
    explicit?.trim() || process.env.CONTROL_PLANE_DATABASE_URL?.trim() || "";
  if (!url) {
    throw new Error(
      "Harness turn registry requires CONTROL_PLANE_DATABASE_URL (Postgres). " +
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
      typeof value.turn_id !== "string"
    ) {
      return null;
    }
    return {
      origin: value.origin,
      thread_id: value.thread_id,
      turn_id: value.turn_id,
    };
  } catch {
    return null;
  }
}

export async function createPgHarnessTurnRegistry(
  options: CreatePgHarnessTurnRegistryOptions,
): Promise<HarnessTurnRegistry> {
  const connectionString = resolveHarnessTurnsDatabaseUrl(
    options.connectionString,
  );
  const schema = options.schema?.trim() || null;
  const owner = options.owner?.trim() || randomUUID();
  const claimTtlMs = Math.max(
    50,
    options.claimTtlMs ?? DEFAULT_HARNESS_TURN_CLAIM_TTL_MS,
  );
  const channel = options.notifyChannel?.trim() || HARNESS_TURNS_NOTIFY_CHANNEL;
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(channel)) {
    throw new Error(`Invalid NOTIFY channel: ${channel}`);
  }
  const dropSchemaOnClose = options.dropSchemaOnClose ?? Boolean(schema);
  const heartbeatMs = Math.max(50, Math.floor(claimTtlMs / 3));

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
  await pool.query(HARNESS_TURNS_SCHEMA_SQL);

  const handlersByThread = new Map<string, Set<HarnessTurnHandler>>();
  const heartbeats = new Map<string, ReturnType<typeof setInterval>>();
  const claimKey = (threadId: string, turnId: string) =>
    `${threadId}::${turnId}`;

  const fireLocal = (threadId: string, turnId: TurnId) => {
    const handlers = handlersByThread.get(threadId);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(turnId);
      } catch {
        /* subscriber errors must not break remember */
      }
    }
  };

  const stopHeartbeat = (threadId: string, turnId: string) => {
    const key = claimKey(threadId, turnId);
    const timer = heartbeats.get(key);
    if (!timer) return;
    clearInterval(timer);
    heartbeats.delete(key);
  };

  const renewClaim = async (threadId: string, turnId: string) => {
    await pool.query(
      `UPDATE harness_turn_claims
       SET claim_until = NOW() + ($3::text || ' milliseconds')::interval
       WHERE thread_id = $1
         AND turn_id = $2
         AND completed = FALSE
         AND claim_owner = $4`,
      [threadId, turnId, String(claimTtlMs), owner],
    );
  };

  const startHeartbeat = (threadId: string, turnId: string) => {
    const key = claimKey(threadId, turnId);
    if (heartbeats.has(key)) return;
    const timer = setInterval(() => {
      void renewClaim(threadId, turnId).catch(() => {
        /* lease renew is best-effort; steal after TTL */
      });
    }, heartbeatMs);
    heartbeats.set(key, timer);
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
    fireLocal(payload.thread_id, asTurnId(payload.turn_id));
  });

  let closed = false;
  const ready = Promise.resolve();

  const registry: HarnessTurnRegistry = {
    async remember(threadId, turnId) {
      const id = asTurnId(turnId);
      await pool.query(
        `INSERT INTO harness_turns (thread_id, turn_id)
         VALUES ($1, $2)
         ON CONFLICT (thread_id, turn_id) DO NOTHING`,
        [threadId, id],
      );
      fireLocal(threadId, id);
      const payload: NotifyPayload = {
        origin: owner,
        thread_id: threadId,
        turn_id: id,
      };
      await pool.query("SELECT pg_notify($1, $2)", [
        channel,
        JSON.stringify(payload),
      ]);
      return id;
    },

    async latest(threadId) {
      const result = await pool.query<TurnRow>(
        `SELECT turn_id
         FROM harness_turns
         WHERE thread_id = $1
         ORDER BY seq DESC
         LIMIT 1`,
        [threadId],
      );
      const row = result.rows[0];
      return row ? asTurnId(row.turn_id) : undefined;
    },

    async all(threadId) {
      const result = await pool.query<TurnRow>(
        `SELECT turn_id
         FROM harness_turns
         WHERE thread_id = $1
         ORDER BY seq ASC, turn_id ASC`,
        [threadId],
      );
      return result.rows.map((row) => asTurnId(row.turn_id));
    },

    async claim(threadId, turnId) {
      const result = await pool.query<{ turn_id: string }>(
        `INSERT INTO harness_turn_claims (
           thread_id, turn_id, claim_owner, claim_until, completed
         ) VALUES ($1, $2, $3, NOW() + ($4::text || ' milliseconds')::interval, FALSE)
         ON CONFLICT (thread_id, turn_id) DO UPDATE
         SET claim_owner = EXCLUDED.claim_owner,
             claim_until = EXCLUDED.claim_until
         WHERE harness_turn_claims.completed = FALSE
           AND (
             harness_turn_claims.claim_until IS NULL
             OR harness_turn_claims.claim_until < NOW()
             OR harness_turn_claims.claim_owner = EXCLUDED.claim_owner
           )
         RETURNING turn_id`,
        [threadId, turnId, owner, String(claimTtlMs)],
      );
      if (result.rows.length === 0) return false;
      startHeartbeat(threadId, turnId);
      return true;
    },

    async complete(threadId, turnId) {
      stopHeartbeat(threadId, turnId);
      await pool.query(
        `INSERT INTO harness_turn_claims (
           thread_id, turn_id, claim_owner, claim_until, completed
         ) VALUES ($1, $2, $3, NULL, TRUE)
         ON CONFLICT (thread_id, turn_id) DO UPDATE
         SET completed = TRUE,
             claim_until = NULL,
             claim_owner = EXCLUDED.claim_owner`,
        [threadId, turnId, owner],
      );
    },

    ready() {
      return ready;
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

    async close() {
      if (closed) return;
      closed = true;
      for (const timer of heartbeats.values()) {
        clearInterval(timer);
      }
      heartbeats.clear();
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

  return registry;
}

export function createLazyPgHarnessTurnRegistry(
  connectionString: string,
  options: Omit<CreatePgHarnessTurnRegistryOptions, "connectionString"> = {},
): HarnessTurnRegistry {
  let resolved: HarnessTurnRegistry | undefined;
  const ready = createPgHarnessTurnRegistry({
    ...options,
    connectionString,
  }).then((registry) => {
    resolved = registry;
    return registry;
  });
  const get = () => ready;

  return {
    remember: async (threadId, turnId) =>
      (await get()).remember(threadId, turnId),
    latest: async (threadId) => (await get()).latest(threadId),
    all: async (threadId) => (await get()).all(threadId),
    claim: async (threadId, turnId) => (await get()).claim(threadId, turnId),
    complete: async (threadId, turnId) => {
      const registry = await get();
      await registry.complete?.(threadId, turnId);
    },
    ready: async () => {
      await get();
    },
    subscribe(threadId, handler) {
      if (resolved) {
        return resolved.subscribe(threadId, handler);
      }
      let unsub = () => {};
      let cancelled = false;
      void get().then((registry) => {
        if (cancelled) return;
        unsub = registry.subscribe(threadId, handler);
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
      if (resolved) {
        await resolved.close?.();
        return;
      }
      await (await get()).close?.();
    },
  };
}
