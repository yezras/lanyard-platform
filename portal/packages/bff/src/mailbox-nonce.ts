/**
 * Mailbox nonce → message_id store (lp-v62i.3.1).
 * Nonce IS externalMessageId. Dedupe on nonce, not raw text.
 * unique(thread_id, nonce). No outbox table.
 */

import { DatabaseSync } from "node:sqlite";
import path from "node:path";

import { mailboxDedupeKey } from "@lanyard/shared";

export type MailboxNonceClaim = {
  message_id: string;
  replayed: boolean;
};

export function ensureMailboxNonceTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mailbox_nonces (
      thread_id TEXT NOT NULL,
      nonce TEXT NOT NULL,
      message_id TEXT NOT NULL,
      PRIMARY KEY (thread_id, nonce)
    );
  `);
}

export class MailboxNonceStore {
  private readonly db: DatabaseSync;
  private readonly ownsDb: boolean;
  private readonly insertIgnore: ReturnType<DatabaseSync["prepare"]>;
  private readonly selectStmt: ReturnType<DatabaseSync["prepare"]>;

  constructor(options?: { db?: DatabaseSync; dbPath?: string }) {
    if (options?.db) {
      this.db = options.db;
      this.ownsDb = false;
    } else if (options?.dbPath?.trim()) {
      this.db = new DatabaseSync(path.resolve(options.dbPath.trim()));
      this.ownsDb = true;
    } else {
      this.db = new DatabaseSync(":memory:");
      this.ownsDb = true;
    }
    ensureMailboxNonceTable(this.db);
    this.insertIgnore = this.db.prepare(
      `INSERT OR IGNORE INTO mailbox_nonces (thread_id, nonce, message_id)
       VALUES (?, ?, ?)`,
    );
    this.selectStmt = this.db.prepare(
      `SELECT message_id FROM mailbox_nonces WHERE thread_id = ? AND nonce = ?`,
    );
  }

  close(): void {
    if (this.ownsDb) {
      this.db.close();
    }
  }

  lookup(threadId: string, nonce: string): string | undefined {
    const row = this.selectStmt.get(threadId, mailboxDedupeKey(nonce)) as
      | { message_id: string }
      | undefined;
    return row?.message_id;
  }

  /**
   * Remember nonce → message_id. Replay of the same (thread, nonce) returns
   * the original message_id and does not overwrite.
   */
  remember(
    threadId: string,
    nonce: string,
    messageId: string,
  ): MailboxNonceClaim {
    const key = mailboxDedupeKey(nonce);
    const existing = this.lookup(threadId, key);
    if (existing !== undefined) {
      return { message_id: existing, replayed: true };
    }
    this.insertIgnore.run(threadId, key, messageId);
    const stored = this.lookup(threadId, key);
    if (stored === undefined) {
      throw new Error("mailbox nonce row missing after insert");
    }
    return { message_id: stored, replayed: stored !== messageId };
  }

  /**
   * If this nonce already landed, return the original message_id and skip
   * `append`. Otherwise run `append` once and remember the mapping.
   */
  runOnce(
    threadId: string,
    nonce: string,
    append: () => { message_id: string },
  ): MailboxNonceClaim {
    const existing = this.lookup(threadId, nonce);
    if (existing !== undefined) {
      return { message_id: existing, replayed: true };
    }
    const { message_id } = append();
    return this.remember(threadId, nonce, message_id);
  }
}
