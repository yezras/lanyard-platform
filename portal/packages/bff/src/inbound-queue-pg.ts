/**
 * Postgres SKIP LOCKED inbound queue (plan 0019 §4.3 / lp-k5c4.3).
 *
 * Table lives on the control-plane database (CONTROL_PLANE_DATABASE_URL).
 * Do not point this at Prisma DATABASE_URL / portal_app.
 */

import { randomUUID } from "node:crypto";

import {
  parseInboundWorkItem,
  type InboundWorkItem,
  type TurnId,
} from "@lanyard/shared";
import pg from "pg";

import {
  DEFAULT_INBOUND_LEASE_TTL_MS,
  type InboundItemStatus,
  type InboundQueueStore,
  type InboundRoomKey,
  type InboundStoredItem,
} from "./inbound-queue.js";

const { Pool } = pg;

export const INBOUND_QUEUE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS inbound_rooms (
  tenant_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, thread_id),
  lease_owner TEXT,
  lease_until TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS inbound_work_items (
  item_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'leased', 'started', 'done', 'failed')),
  correlation_id TEXT NOT NULL,
  enqueue_at BIGINT NOT NULL,
  lease_owner TEXT,
  lease_until TIMESTAMPTZ,
  turn_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, thread_id) REFERENCES inbound_rooms (tenant_id, thread_id)
);

CREATE INDEX IF NOT EXISTS inbound_work_items_room_open
  ON inbound_work_items (tenant_id, thread_id, enqueue_at, item_id)
  WHERE status IN ('queued', 'leased', 'started');
`;

export type CreatePgInboundQueueOptions = {
  connectionString: string;
  schema?: string;
  leaseTtlMs?: number;
};

type ItemRow = {
  item_id: string;
  tenant_id: string;
  thread_id: string;
  payload: unknown;
  status: string;
  turn_id: string | null;
  error: string | null;
};

function quoteIdent(ident: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(ident)) {
    throw new Error(`Invalid SQL identifier: ${ident}`);
  }
  return `"${ident}"`;
}

function asStatus(value: string): InboundItemStatus {
  if (
    value === "queued" ||
    value === "leased" ||
    value === "started" ||
    value === "done" ||
    value === "failed"
  ) {
    return value;
  }
  throw new TypeError(`Unknown inbound item status: ${value}`);
}

function asTurnId(value: string | null): TurnId | null {
  if (!value || !value.trim()) return null;
  return value.trim() as TurnId;
}

function rowToItem(row: ItemRow): InboundStoredItem {
  return {
    item_id: row.item_id,
    tenant_id: row.tenant_id,
    thread_id: row.thread_id,
    payload: parseInboundWorkItem(row.payload),
    status: asStatus(row.status),
    turn_id: asTurnId(row.turn_id),
    error: row.error,
  };
}

function resolveInboundQueueDatabaseUrl(explicit?: string): string {
  const url =
    explicit?.trim() ||
    process.env.CONTROL_PLANE_DATABASE_URL?.trim() ||
    "";
  if (!url) {
    throw new Error(
      "Inbound queue requires CONTROL_PLANE_DATABASE_URL (Postgres). " +
        "Do not reuse Prisma DATABASE_URL / portal_app.",
    );
  }
  return url;
}

export function inboundQueueDatabaseUrl(): string | undefined {
  const url = process.env.CONTROL_PLANE_DATABASE_URL?.trim();
  return url || undefined;
}

export async function createPgInboundQueue(
  options: CreatePgInboundQueueOptions,
): Promise<InboundQueueStore> {
  const connectionString = resolveInboundQueueDatabaseUrl(
    options.connectionString,
  );
  const schema = options.schema?.trim() || null;
  const defaultTtlMs = options.leaseTtlMs ?? DEFAULT_INBOUND_LEASE_TTL_MS;

  if (schema) {
    const bootstrap = new Pool({ connectionString });
    try {
      await bootstrap.query(
        `CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)}`,
      );
    } finally {
      await bootstrap.end();
    }
  }

  const pool = new Pool({
    connectionString,
    ...(schema ? { options: `-c search_path=${schema},public` } : {}),
  });
  await pool.query("SELECT 1");
  await pool.query(INBOUND_QUEUE_SCHEMA_SQL);

  const ttl = (ttlMs?: number) => ttlMs ?? defaultTtlMs;

  const store: InboundQueueStore = {
    async enqueue(item: InboundWorkItem) {
      const itemId = randomUUID();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO inbound_rooms (tenant_id, thread_id)
           VALUES ($1, $2)
           ON CONFLICT (tenant_id, thread_id) DO NOTHING`,
          [item.tenant_id, item.thread_id],
        );
        await client.query(
          `INSERT INTO inbound_work_items (
             item_id, tenant_id, thread_id, payload, status,
             correlation_id, enqueue_at
           ) VALUES ($1, $2, $3, $4::jsonb, 'queued', $5, $6)`,
          [
            itemId,
            item.tenant_id,
            item.thread_id,
            JSON.stringify(item),
            item.correlation_id,
            item.enqueue_at,
          ],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      return { item_id: itemId };
    },

    async stealUnleasedRooms(input) {
      const limit = Math.max(0, Math.floor(input.limit));
      if (limit === 0) return [];
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const picked = await client.query<InboundRoomKey>(
          `SELECT tenant_id, thread_id
           FROM inbound_rooms
           WHERE (lease_until IS NULL OR lease_until < NOW())
             AND EXISTS (
               SELECT 1 FROM inbound_work_items i
               WHERE i.tenant_id = inbound_rooms.tenant_id
                 AND i.thread_id = inbound_rooms.thread_id
                 AND i.status IN ('queued', 'leased', 'started')
             )
           ORDER BY tenant_id, thread_id
           FOR UPDATE SKIP LOCKED
           LIMIT $1`,
          [limit],
        );
        if (picked.rows.length === 0) {
          await client.query("COMMIT");
          return [];
        }
        const leased: InboundRoomKey[] = [];
        for (const room of picked.rows) {
          await client.query(
            `UPDATE inbound_rooms
             SET lease_owner = $3,
                 lease_until = NOW() + ($4::text || ' milliseconds')::interval
             WHERE tenant_id = $1 AND thread_id = $2`,
            [room.tenant_id, room.thread_id, input.owner, String(ttl(input.ttlMs))],
          );
          leased.push(room);
        }
        await client.query("COMMIT");
        return leased;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async leaseRoom(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const picked = await client.query<InboundRoomKey>(
          `SELECT tenant_id, thread_id
           FROM inbound_rooms
           WHERE tenant_id = $1
             AND thread_id = $2
             AND (lease_until IS NULL OR lease_until < NOW())
           FOR UPDATE SKIP LOCKED`,
          [input.tenant_id, input.thread_id],
        );
        if (picked.rows.length === 0) {
          await client.query("COMMIT");
          return false;
        }
        await client.query(
          `UPDATE inbound_rooms
           SET lease_owner = $3,
               lease_until = NOW() + ($4::text || ' milliseconds')::interval
           WHERE tenant_id = $1 AND thread_id = $2`,
          [
            input.tenant_id,
            input.thread_id,
            input.owner,
            String(ttl(input.ttlMs)),
          ],
        );
        await client.query("COMMIT");
        return true;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async nextItem(room) {
      const result = await pool.query<ItemRow>(
        `SELECT item_id, tenant_id, thread_id, payload, status, turn_id, error
         FROM inbound_work_items
         WHERE tenant_id = $1
           AND thread_id = $2
           AND status IN ('queued', 'leased', 'started')
         ORDER BY enqueue_at ASC, item_id ASC
         LIMIT 1`,
        [room.tenant_id, room.thread_id],
      );
      const row = result.rows[0];
      return row ? rowToItem(row) : null;
    },

    async markStarted(itemId, turnId) {
      await pool.query(
        `UPDATE inbound_work_items
         SET status = 'started', turn_id = $2
         WHERE item_id = $1`,
        [itemId, turnId],
      );
    },

    async markDone(itemId) {
      await pool.query(
        `UPDATE inbound_work_items
         SET status = 'done'
         WHERE item_id = $1`,
        [itemId],
      );
    },

    async markFailed(itemId, error) {
      await pool.query(
        `UPDATE inbound_work_items
         SET status = 'failed', error = $2
         WHERE item_id = $1`,
        [itemId, error],
      );
    },

    async releaseRoom(room) {
      await pool.query(
        `UPDATE inbound_rooms
         SET lease_owner = NULL, lease_until = NULL
         WHERE tenant_id = $1 AND thread_id = $2`,
        [room.tenant_id, room.thread_id],
      );
    },

    async getItem(itemId) {
      const result = await pool.query<ItemRow>(
        `SELECT item_id, tenant_id, thread_id, payload, status, turn_id, error
         FROM inbound_work_items
         WHERE item_id = $1`,
        [itemId],
      );
      const row = result.rows[0];
      return row ? rowToItem(row) : null;
    },

    async close() {
      try {
        if (schema) {
          await pool.query(
            `DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`,
          );
        }
      } finally {
        await pool.end();
      }
    },
  };

  return store;
}

export function createLazyPgInboundQueue(
  connectionString: string,
): InboundQueueStore {
  let ready: Promise<InboundQueueStore> | undefined;
  const get = () => {
    ready ??= createPgInboundQueue({ connectionString });
    return ready;
  };
  return {
    enqueue: async (item) => (await get()).enqueue(item),
    stealUnleasedRooms: async (input) => (await get()).stealUnleasedRooms(input),
    leaseRoom: async (input) => (await get()).leaseRoom(input),
    nextItem: async (room) => (await get()).nextItem(room),
    markStarted: async (itemId, turnId) =>
      (await get()).markStarted(itemId, turnId),
    markDone: async (itemId) => (await get()).markDone(itemId),
    markFailed: async (itemId, error) => (await get()).markFailed(itemId, error),
    releaseRoom: async (room) => (await get()).releaseRoom(room),
    getItem: async (itemId) => (await get()).getItem(itemId),
    close: async () => {
      if (ready) {
        await (await ready).close();
      }
    },
  };
}
