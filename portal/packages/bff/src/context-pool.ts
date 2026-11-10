/**
 * BFF context pools — unified (lp-692u + lp-ornl + lp-0akr window).
 *
 * Channel-shared pool (lp-692u): hybrid per-thread lease + channel-wide read,
 * BFF live fetch from context_pool table, harness SessionState, channel description.
 * Human-scoped 1:1 pool (lp-ornl): key (tenant, human), messages-only, any writer,
 * participants-only, BFF-owned table, live per-call fetch, SessionState per human.
 * Double-window rotate: compact at 80% once, rotate at next 80% doubles window.
 */

import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { umask } from "node:process";
import { DatabaseSync } from "node:sqlite";

import type { ChannelContext, ChannelContextExcerpt } from "@lanyard/shared";
import type { ContextPoolEvent, ContextPoolFetchResult, ContextPoolKey } from "@lanyard/shared";

import type { ChatHistoryEvent, ChatThread, ChatThreadStore } from "./chat-store.js";

// ---------------------------------------------------------------------------
// Channel-shared pool (lp-692u)
// ---------------------------------------------------------------------------

/** Postgres + SQLite schema for BFF live fetch (channel pool). */
export const CONTEXT_POOL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS context_pool (
  tenant_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  window_budget INTEGER NOT NULL DEFAULT 8000,
  compacted_once BOOLEAN NOT NULL DEFAULT FALSE,
  excerpts JSONB NOT NULL DEFAULT '[]',
  delivered_event_ids JSONB NOT NULL DEFAULT '[]',
  channel_description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, channel_id)
);
CREATE INDEX IF NOT EXISTS idx_context_pool_tenant_channel
  ON context_pool (tenant_id, channel_id);
`;

export const CONTEXT_POOL_INITIAL_BUDGET = 8000;
export const CONTEXT_POOL_COMPACT_THRESHOLD = 0.8;
export const CONTEXT_POOL_ROTATE_THRESHOLD = 0.8;
export const CONTEXT_POOL_EXCERPT_MAX_CHARS = 500;
export const CONTEXT_POOL_MAX_EXCERPTS = 50;

/** Lease stays (tenant,thread) — do not key by channel. */
export type ContextPoolLeaseKey = {
  tenant_id: string;
  thread_id: string;
};

export type ContextPoolRow = {
  tenant_id: string;
  channel_id: string;
  revision_id: string;
  window_budget: number;
  compacted_once: boolean;
  excerpts: ChannelContextExcerpt[];
  delivered_event_ids: string[];
  channel_description: string | null;
  updated_at: string;
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function totalTokens(excerpts: ChannelContextExcerpt[]): number {
  return excerpts.reduce((sum, e) => sum + estimateTokens(e.text), 0);
}

export function shouldCompact(row: ContextPoolRow): boolean {
  return (
    !row.compacted_once &&
    totalTokens(row.excerpts) >= row.window_budget * CONTEXT_POOL_COMPACT_THRESHOLD
  );
}

export function shouldRotate(row: ContextPoolRow): boolean {
  return (
    row.compacted_once &&
    totalTokens(row.excerpts) >= row.window_budget * CONTEXT_POOL_ROTATE_THRESHOLD
  );
}

export function compactExcerpts(row: ContextPoolRow): ChannelContextExcerpt[] {
  if (row.excerpts.length <= 2) return row.excerpts;
  const half = Math.floor(row.excerpts.length / 2);
  const toCompact = row.excerpts.slice(0, half);
  const remaining = row.excerpts.slice(half);
  const summary = toCompact.map((e) => `${e.speaker}: ${e.text}`).join(" | ");
  const compacted: ChannelContextExcerpt = {
    event_id: `compact-${row.revision_id.slice(0, 8)}`,
    speaker: "system",
    text: `[Compacted ${toCompact.length} prior excerpts: ${summary.slice(0, 400)}]`,
    created_at: new Date().toISOString(),
  };
  return [compacted, ...remaining];
}

export function rotateWindow(row: ContextPoolRow): ContextPoolRow {
  return {
    ...row,
    window_budget: row.window_budget * 2,
    compacted_once: false,
    revision_id: randomUUID(),
  };
}

export function nextRevisionId(): string {
  return randomUUID();
}

export function toChannelContext(row: ContextPoolRow): ChannelContext {
  return {
    revision_id: row.revision_id,
    excerpts: row.excerpts,
    delivered_event_ids: row.delivered_event_ids,
    ...(row.channel_description ? { channel_description: row.channel_description } : {}),
    window_budget: row.window_budget,
    compacted_once: row.compacted_once,
  };
}

export function channelContextBlock(context: ChannelContext): string {
  const desc = context.channel_description?.trim() || "Group channel";
  const excerpts = context.excerpts
    .filter((e) => !context.delivered_event_ids.includes(e.event_id))
    .slice(-10)
    .map((e) => `- ${e.speaker} (${e.created_at}): ${e.text.slice(0, CONTEXT_POOL_EXCERPT_MAX_CHARS)}`)
    .join("\n");
  return `[Context] channel: ${desc}\nRevision: ${context.revision_id}\n${excerpts ? `Sibling excerpts:\n${excerpts}` : "No sibling excerpts yet."}`;
}

export function broadcastChannelContext(
  deliveries: Array<{ targetPersonaId: string; metadata: Record<string, unknown> }>,
  context: ChannelContext,
): void {
  for (const d of deliveries) {
    (d.metadata as Record<string, unknown>).channel_context = context;
  }
}

/** Channel pool store interface (renamed to avoid collision with human pool class). */
export type ChannelPoolStore = {
  fetchChannelContext(input: {
    tenant_id: string;
    channel_id: string;
  }): Promise<ChannelContext | null>;
  appendExcerpt(input: {
    tenant_id: string;
    channel_id: string;
    excerpt: ChannelContextExcerpt;
    channel_description?: string;
  }): Promise<ChannelContext>;
  markDelivered(input: {
    tenant_id: string;
    channel_id: string;
    event_ids: string[];
  }): Promise<void>;
  getRow(input: { tenant_id: string; channel_id: string }): Promise<ContextPoolRow | null>;
};
// ChannelPoolStore is the single channel pool type — no alias.

export function excerptFromHistoryEvent(event: ChatHistoryEvent): ChannelContextExcerpt | null {
  const text =
    event.type === "user_message"
      ? event.content
      : event.type === "message_send" || event.type === "message_edit"
        ? event.content ?? ""
        : (event as { content?: string }).content ?? "";
  if (!text || !text.trim()) return null;
  const speaker =
    event.type === "user_message"
      ? (event as { speaker?: { display_name?: string } }).speaker?.display_name ?? "user"
      : (event as { speaker?: { display_name?: string }; tool_name?: string }).speaker?.display_name ??
        (event as { tool_name?: string }).tool_name ??
        "agent";
  const eventId =
    event.message_id?.trim() ||
    `${event.type}-${event.chat_id}-${event.created_at ?? Date.now()}`;
  return {
    event_id: eventId,
    speaker,
    text: text.trim().slice(0, CONTEXT_POOL_EXCERPT_MAX_CHARS),
    created_at: event.created_at ?? new Date().toISOString(),
  };
}

export function undeliveredExcerpts(context: ChannelContext): ChannelContextExcerpt[] {
  const delivered = new Set(context.delivered_event_ids);
  return context.excerpts.filter((e) => !delivered.has(e.event_id));
}

export function createInMemoryChannelPoolStore(): ChannelPoolStore {
  const rows = new Map<string, ContextPoolRow>();
  const keyOf = (tenant_id: string, channel_id: string) => `${tenant_id}::${channel_id}`;

  function getOrCreate(tenant_id: string, channel_id: string, desc?: string): ContextPoolRow {
    const key = keyOf(tenant_id, channel_id);
    let row = rows.get(key);
    if (!row) {
      row = {
        tenant_id,
        channel_id,
        revision_id: nextRevisionId(),
        window_budget: CONTEXT_POOL_INITIAL_BUDGET,
        compacted_once: false,
        excerpts: [],
        delivered_event_ids: [],
        channel_description: desc ?? null,
        updated_at: new Date().toISOString(),
      };
      rows.set(key, row);
    }
    return row;
  }

  return {
    async fetchChannelContext(input) {
      const row = rows.get(keyOf(input.tenant_id, input.channel_id));
      if (!row) return null;
      let current = row;
      if (shouldCompact(current)) {
        current = {
          ...current,
          excerpts: compactExcerpts(current),
          compacted_once: true,
          revision_id: nextRevisionId(),
          updated_at: new Date().toISOString(),
        };
        rows.set(keyOf(input.tenant_id, input.channel_id), current);
      } else if (shouldRotate(current)) {
        current = rotateWindow(current);
        current.updated_at = new Date().toISOString();
        rows.set(keyOf(input.tenant_id, input.channel_id), current);
      }
      return {
        revision_id: current.revision_id,
        excerpts: [...current.excerpts],
        delivered_event_ids: [...current.delivered_event_ids],
        ...(current.channel_description ? { channel_description: current.channel_description } : {}),
        window_budget: current.window_budget,
        compacted_once: current.compacted_once,
      };
    },

    async appendExcerpt(input) {
      const row = getOrCreate(input.tenant_id, input.channel_id, input.channel_description);
      if (row.delivered_event_ids.includes(input.excerpt.event_id)) {
        return toChannelContext(row);
      }
      if (row.excerpts.some((e) => e.event_id === input.excerpt.event_id)) {
        return toChannelContext(row);
      }
      row.excerpts.push(input.excerpt);
      if (row.excerpts.length > CONTEXT_POOL_MAX_EXCERPTS) {
        row.excerpts = row.excerpts.slice(-CONTEXT_POOL_MAX_EXCERPTS);
      }
      if (input.channel_description) {
        row.channel_description = input.channel_description;
      }
      row.updated_at = new Date().toISOString();
      if (shouldCompact(row)) {
        row.excerpts = compactExcerpts(row);
        row.compacted_once = true;
        row.revision_id = nextRevisionId();
      } else if (shouldRotate(row)) {
        const rotated = rotateWindow(row);
        row.window_budget = rotated.window_budget;
        row.compacted_once = rotated.compacted_once;
        row.revision_id = rotated.revision_id;
      }
      return toChannelContext(row);
    },

    async markDelivered(input) {
      const row = rows.get(keyOf(input.tenant_id, input.channel_id));
      if (!row) return;
      const set = new Set(row.delivered_event_ids);
      for (const id of input.event_ids) set.add(id);
      row.delivered_event_ids = [...set];
      row.updated_at = new Date().toISOString();
    },

    async getRow(input) {
      const row = rows.get(keyOf(input.tenant_id, input.channel_id));
      return row ? { ...row, excerpts: [...row.excerpts], delivered_event_ids: [...row.delivered_event_ids] } : null;
    },
  };
}

export function contextPoolSharedApi(store: ChannelPoolStore) {
  return {
    async fetch(tenant_id: string, channel_id: string): Promise<ChannelContext | null> {
      return store.fetchChannelContext({ tenant_id, channel_id });
    },
    async append(
      tenant_id: string,
      channel_id: string,
      excerpt: ChannelContextExcerpt,
      channel_description?: string,
    ): Promise<ChannelContext> {
      return store.appendExcerpt({ tenant_id, channel_id, excerpt, channel_description });
    },
  };
}

export type HarnessSessionState = {
  tenant_id: string;
  channel_id: string;
  channelContext: ChannelContext | null;
  threadId: string;
};

export function createHarnessSessionState(input: {
  tenant_id: string;
  channel_id: string;
  thread_id: string;
  channelContext: ChannelContext | null;
}): HarnessSessionState {
  return {
    tenant_id: input.tenant_id,
    channel_id: input.channel_id,
    threadId: input.thread_id,
    channelContext: input.channelContext,
  };
}

export function harnessSessionStateToContextBlock(state: HarnessSessionState): string | null {
  if (!state.channelContext) return null;
  return channelContextBlock(state.channelContext);
}

export function channelDescriptionFromThread(thread: ChatThread): string {
  const parts: string[] = [];
  if (thread.title?.trim()) parts.push(`#${thread.title.trim()}`);
  if (thread.system_prompt?.trim()) parts.push(thread.system_prompt.trim().slice(0, 300));
  const participantNames = thread.participants
    .map((p) => p.display_name ?? (p.kind === "persona" ? p.persona_id : p.user_id))
    .join(", ");
  if (participantNames) parts.push(`Members: ${participantNames}`);
  return parts.join(" — ") || `Channel ${thread.thread_id}`;
}

// ---------------------------------------------------------------------------
// Human-scoped 1:1 pool (lp-ornl)
// ---------------------------------------------------------------------------

const MESSAGES_ONLY = new Set(["user_message", "message_send", "system_notice"]);

/**
 * lp-v62i.17 — human pool now includes mailbox.send tool traces so follow-up
 * "Message him" can resolve "him" via pool delta (Bill → Fred).
 * Generic tool_progress is still filtered to keep pool messages-only for other tools.
 */
function isMessagesOnly(event: ChatHistoryEvent): boolean {
  if (event.type === "tool_progress") {
    const toolName =
      (event as { tool_name?: string }).tool_name ??
      (event as { tool_label?: string }).tool_label ??
      "";
    if (toolName === "mailbox.send") return true;
    const meta = (event as { metadata?: Record<string, unknown> }).metadata;
    if (meta && typeof meta === "object") {
      if ("mailbox_send" in meta) return true;
      if ((meta as Record<string, unknown>).tool_name === "mailbox.send") return true;
    }
    return false;
  }
  return MESSAGES_ONLY.has(event.type);
}

function eventIdForHistory(event: ChatHistoryEvent): string {
  if (event.type === "user_message") return event.message_id;
  if (event.type === "system_notice") return event.message_id;
  return event.message_id ?? randomUUID();
}

function contentForHistory(event: ChatHistoryEvent): string {
  return (event as { content?: string }).content ?? "";
}

export class ContextPoolStore {
  private readonly mem = new Map<string, ContextPoolEvent[]>();
  private readonly revisions = new Map<string, string>();
  private db: DatabaseSync | null = null;
  private stmts: {
    insert: ReturnType<DatabaseSync["prepare"]>;
    list: ReturnType<DatabaseSync["prepare"]>;
    maxRevision: ReturnType<DatabaseSync["prepare"]>;
  } | null = null;

  constructor(dbPath?: string) {
    if (dbPath) {
      this.db = openContextPoolDb(dbPath);
      this.stmts = {
        insert: this.db.prepare(
          `INSERT INTO context_pool (tenant_id, human_user_id, revision_id, event_id, thread_id, type, content, speaker_json, created_at, event_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ),
        list: this.db.prepare(
          `SELECT tenant_id, human_user_id, revision_id, event_id, thread_id, type, content, speaker_json, created_at, event_json FROM context_pool WHERE tenant_id = ? AND human_user_id = ? ORDER BY revision_id ASC`,
        ),
        maxRevision: this.db.prepare(
          `SELECT COALESCE(MAX(revision_id), 0) as max_rev FROM context_pool WHERE tenant_id = ? AND human_user_id = ?`,
        ),
      };
    }
  }

  private keyString(key: ContextPoolKey): string {
    return `${key.tenant_id}:${key.human_user_id}`;
  }

  append(input: { key: ContextPoolKey; threadId: string; event: ChatHistoryEvent }): string | null {
    if (!isMessagesOnly(input.event)) return null;
    const k = this.keyString(input.key);
    const eventId = eventIdForHistory(input.event);
    const content = contentForHistory(input.event);
    const speaker = (input.event as { speaker?: ContextPoolEvent["speaker"] }).speaker ?? undefined;
    const createdAt = (input.event as { created_at?: string }).created_at ?? new Date().toISOString();

    let revision: string = randomUUID();
    if (this.db && this.stmts) {
      // Shared revision_id is UUID string — maxRevision is legacy integer, ignore and use UUID
      void this.stmts.maxRevision.get(input.key.tenant_id, input.key.human_user_id);
      const speakerJson = speaker ? JSON.stringify(speaker) : null;
      const eventJson = JSON.stringify(input.event);
      this.stmts.insert.run(
        input.key.tenant_id,
        input.key.human_user_id,
        revision,
        eventId,
        input.threadId,
        input.event.type,
        content,
        speakerJson,
        createdAt,
        eventJson,
      );
      const arr = this.mem.get(k) ?? [];
      arr.push({
        event_id: eventId,
        revision_id: revision as unknown as number,
        tenant_id: input.key.tenant_id,
        human_user_id: input.key.human_user_id,
        thread_id: input.threadId,
        type: input.event.type as ContextPoolEvent["type"],
        content,
        speaker,
        created_at: createdAt,
        event_json: input.event,
      });
      this.mem.set(k, arr);
      this.revisions.set(k, revision);
      return revision;
    } else {
      const arr = this.mem.get(k) ?? [];
      // Shared revision_id: new UUID for each append, unified with ChannelPoolStore
      revision = randomUUID();
      arr.push({
        event_id: eventId,
        revision_id: revision as unknown as number,
        tenant_id: input.key.tenant_id,
        human_user_id: input.key.human_user_id,
        thread_id: input.threadId,
        type: input.event.type as ContextPoolEvent["type"],
        content,
        speaker,
        created_at: createdAt,
        event_json: input.event,
      });
      this.mem.set(k, arr);
      this.revisions.set(k, revision);
      return revision;
    }
  }

  fetch(key: ContextPoolKey): ContextPoolFetchResult {
    const k = this.keyString(key);
    if (this.db && this.stmts) {
      const rows = this.stmts.list.all(key.tenant_id, key.human_user_id) as Array<{
        tenant_id: string;
        human_user_id: string;
        revision_id: string;
        event_id: string;
        thread_id: string;
        type: string;
        content: string;
        speaker_json: string | null;
        created_at: string;
        event_json: string;
      }>;
      const events: ContextPoolEvent[] = rows.map((r) => ({
        event_id: r.event_id,
        revision_id: r.revision_id as unknown as number,
        tenant_id: r.tenant_id,
        human_user_id: r.human_user_id,
        thread_id: r.thread_id,
        type: r.type as ContextPoolEvent["type"],
        content: r.content,
        speaker: r.speaker_json ? (JSON.parse(r.speaker_json) as ContextPoolEvent["speaker"]) : undefined,
        created_at: r.created_at,
        event_json: JSON.parse(r.event_json),
      }));
      const revision_id = (events.length > 0 ? events[events.length - 1]!.revision_id : "") as unknown as number;
      return { key, revision_id, events } as unknown as ContextPoolFetchResult;
    }
    const events = this.mem.get(k) ?? [];
    const revision_id = (this.revisions.get(k) ?? "") as unknown as number;
    return { key, revision_id, events: [...events] } as unknown as ContextPoolFetchResult;
  }

  isParticipant(store: ChatThreadStore, key: ContextPoolKey, personaId: string): boolean {
    const threads = store.listThreadsForUser(key.tenant_id, key.human_user_id);
    for (const t of threads) {
      if (t.kind === "chat" && t.agent_id === personaId) return true;
    }
    return false;
  }

  listParticipantPersonaIds(store: ChatThreadStore, key: ContextPoolKey): string[] {
    const threads = store.listThreadsForUser(key.tenant_id, key.human_user_id);
    const ids = new Set<string>();
    for (const t of threads) {
      if (t.kind === "chat" && t.agent_id) ids.add(t.agent_id);
    }
    return [...ids];
  }

  close(): void {
    try {
      this.db?.close();
    } catch {}
  }
}

function openContextPoolDb(dbPath: string): DatabaseSync {
  const resolved = path.resolve(dbPath);
  const dir = path.dirname(resolved);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {}
  const prev = umask(0o077);
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(resolved);
  } finally {
    umask(prev);
  }
  try {
    chmodSync(resolved, 0o600);
  } catch {}
  db.exec(`PRAGMA foreign_keys = ON`);
  db.exec(`PRAGMA journal_mode = WAL`);
  db.exec(`PRAGMA synchronous = NORMAL`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS context_pool (
      tenant_id TEXT NOT NULL,
      human_user_id TEXT NOT NULL,
      revision_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      speaker_json TEXT,
      created_at TEXT NOT NULL,
      event_json TEXT NOT NULL,
      PRIMARY KEY (tenant_id, human_user_id, revision_id),
      UNIQUE (tenant_id, human_user_id, event_id)
    );
    CREATE INDEX IF NOT EXISTS idx_context_pool_human ON context_pool(tenant_id, human_user_id, revision_id);
  `);
  return db;
}

export type HumanPoolSessionState = {
  key: ContextPoolKey;
  delivered_event_ids: Set<string>;
  standing_context_sent: boolean;
  last_revision_id: string;
};

export function emptyHumanPoolSession(key: ContextPoolKey): HumanPoolSessionState {
  return {
    key,
    delivered_event_ids: new Set<string>(),
    standing_context_sent: false,
    last_revision_id: "",
  };
}

export function humanPoolDelta(
  pool: ContextPoolFetchResult,
  session: HumanPoolSessionState,
): ContextPoolEvent[] {
  return pool.events.filter((e) => !session.delivered_event_ids.has(e.event_id));
}

export function markHumanPoolDelivered(
  session: HumanPoolSessionState,
  events: ContextPoolEvent[],
  standingSent = true,
): HumanPoolSessionState {
  const next = new Set(session.delivered_event_ids);
  for (const e of events) next.add(e.event_id);
  return {
    key: session.key,
    delivered_event_ids: next,
    standing_context_sent: standingSent ? true : session.standing_context_sent,
    last_revision_id: events.length > 0 ? (events[events.length - 1]!.revision_id as unknown as string) : session.last_revision_id,
  };
}
